"""Recovery API regressions. Every write is inside a disposable fixture root."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import admin
import content_history
import mdparse


class Request(admin.Handler):
    def __init__(self):
        self.result, self.status = None, None

    def json_out(self, value, status=200):
        self.result, self.status = value, status


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for kind in admin.KINDS.values():
            (self.root / "content" / kind).mkdir(parents=True)
        patcher = patch.object(admin, "ROOT", str(self.root))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.store = content_history.Store(str(self.root))

    def call(self, method, args, status=200):
        request = Request()
        getattr(request, method)(args)
        self.assertEqual(request.status, status, request.result)
        return request.result

    def save(self, slug="one", body="First version", old="", revision=None, kind="post", **front):
        return self.call("api_save", dict(kind=kind, originalSlug=old, revision=revision,
            front=dict(title="Recovery fixture", slug=slug, **front), body=body))

    def test_first_edit_preserves_original_and_deduplicates_unchanged_save(self):
        path = Path(admin.doc_path("post", "one"))
        original = "---\ntitle: Existing\nslug: one\n---\n\nOriginal text\n"
        path.write_text(original, encoding="utf-8")
        saved = self.save(body="Second version", old="one", revision=admin.file_revision(str(path)))
        items, total = self.store.versions("post", "one")
        self.assertEqual(total, 2)
        old = next(item for item in items if item["reason"] == "保存前")
        self.assertEqual(self.store.read(self.store.group("post", "one"), old["id"])[1], original)
        self.save(body="Second version", old="one", revision=saved["revision"])
        self.assertEqual(self.store.versions("post", "one")[1], 2)
        self.assertFalse((self.root / "public").exists())

    def test_history_diff_restore_and_revision_conflict(self):
        first = self.save()
        second = self.save(body="Second version", old="one", revision=first["revision"])
        query = dict(kind=["post"], slug=["one"], id=[first["revision"]])
        result = self.call("api_history_version", query)
        self.assertIn("-Second version", result["diff"])
        self.assertIn("+First version", result["diff"])
        restore = dict(kind="post", slug="one", id=first["revision"], revision=first["revision"])
        self.call("api_history_restore", restore, 409)
        self.assertIn("Second version", Path(admin.doc_path("post", "one")).read_text(encoding="utf-8"))
        restore["revision"] = second["revision"]
        self.call("api_history_restore", restore)
        self.assertIn("First version", Path(admin.doc_path("post", "one")).read_text(encoding="utf-8"))
        self.assertEqual(self.store.versions("post", "one")[1], 2)

    def test_successive_renames_keep_aliases_and_history(self):
        first = self.save(aliases=["/posts/legacy/"])
        second = self.save("two", old="one", revision=first["revision"])
        third = self.save("three", old="two", revision=second["revision"])
        self.assertEqual(third["aliases"], ["/posts/legacy/", "/posts/one/", "/posts/two/"])
        self.assertEqual(self.store.versions("post", "three")[1], 3)
        self.assertFalse(Path(admin.doc_path("post", "one")).exists())
        restored = self.call("api_history_restore", dict(kind="post", slug="three", id=first["revision"], revision=third["revision"]))
        self.assertEqual(restored["slug"], "three")
        self.assertEqual(restored["aliases"], third["aliases"])
        back = self.save("one", old="three", revision=restored["revision"])
        self.assertEqual(back["aliases"], ["/posts/legacy/", "/posts/two/", "/posts/three/"])

    def test_page_and_doc_alias_routes(self):
        page = self.save("about", kind="page")
        result = self.save("me", old="about", kind="page", revision=page["revision"])
        self.assertEqual(result["aliases"], ["/about/"])
        with patch.object(admin, "doc_collections", lambda: [{"id": "course"}]):
            doc = self.save("lesson", kind="doc", collection="course")
            result = self.save("lesson-new", old="lesson", kind="doc", revision=doc["revision"], collection="course")
        self.assertEqual(result["aliases"], ["/docs/lesson/"])

    def test_recycle_restore_rejects_overwrite_and_repeated_restore(self):
        first = self.save()
        trash = self.call("api_delete", dict(kind="post", slug="one", revision=first["revision"]))
        self.assertFalse(Path(admin.doc_path("post", "one")).exists())
        items = self.call("api_trash", {})
        self.assertEqual(items["total"], 1)
        other = self.save(body="Different document")
        self.call("api_trash_restore", dict(id=trash["trashId"]), 409)
        self.assertIn("Different document", Path(admin.doc_path("post", "one")).read_text(encoding="utf-8"))
        self.call("api_delete", dict(kind="post", slug="one", revision=other["revision"]))
        self.call("api_trash_restore", dict(id=trash["trashId"]))
        self.assertIn("First version", Path(admin.doc_path("post", "one")).read_text(encoding="utf-8"))
        self.assertEqual(self.call("api_trash", {})["total"], 1)
        self.call("api_trash_restore", dict(id=trash["trashId"]), 404)

    def test_failed_history_write_leaves_content_untouched(self):
        first = self.save()
        path = Path(admin.doc_path("post", "one"))
        original = path.read_bytes()
        with patch.object(content_history.Store, "capture", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.save(body="New text", old="one", revision=first["revision"])
            with self.assertRaises(OSError):
                Request().api_delete(dict(kind="post", slug="one", revision=first["revision"]))
        self.assertEqual(path.read_bytes(), original)

    def test_stale_save_delete_and_rename_collision_preserve_content(self):
        first = self.save()
        self.save("other", body="Keep me")
        self.call("api_delete", dict(kind="post", slug="one", revision="old"), 409)
        self.call("api_save", dict(kind="post", originalSlug="one", revision=first["revision"],
                  front=dict(title="Move", slug="other"), body="Overwrite"), 409)
        self.assertIn("Keep me", Path(admin.doc_path("post", "other")).read_text(encoding="utf-8"))
        self.assertTrue(Path(admin.doc_path("post", "one")).exists())

    def test_slug_cannot_take_another_documents_retained_alias(self):
        first = self.save()
        self.save("moved", old="one", revision=first["revision"])
        self.call("api_save", dict(kind="post", front=dict(title="Another", slug="one"), body="Collision"), 409)
        self.assertFalse(Path(admin.doc_path("post", "one")).exists())

    def test_interrupted_recycle_restore_leaves_no_partial_target(self):
        first = self.save()
        trash = self.call("api_delete", dict(kind="post", slug="one", revision=first["revision"]))
        with patch.object(admin.os, "link", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                Request().api_trash_restore(dict(id=trash["trashId"]))
        self.assertFalse(Path(admin.doc_path("post", "one")).exists())
        self.assertFalse(list((self.root / "content/posts").glob(".restore-*")))
        self.call("api_trash_restore", dict(id=trash["trashId"]))

    def test_recycle_restore_cannot_steal_a_new_alias(self):
        first = self.save()
        trash = self.call("api_delete", dict(kind="post", slug="one", revision=first["revision"]))
        self.save("other", aliases=["/posts/one/"])
        self.call("api_trash_restore", dict(id=trash["trashId"]), 409)
        self.assertFalse(Path(admin.doc_path("post", "one")).exists())
        self.assertEqual(self.call("api_trash", {})["total"], 1)

    def test_untrusted_identifiers_never_leave_history_folder(self):
        self.save()
        self.call("api_history_version", dict(kind=["post"], slug=["one"], id=["../../site.config.json"]), 404)
        self.call("api_trash_restore", dict(id="../../site.config.json"), 404)
        request = Request()
        request.path = "/admin/../../.blog-history/index.json"
        with patch.object(admin, "ADMIN_UI", str(self.root / "theme" / "admin")):
            request.route_get()
        self.assertEqual(request.status, 403)

    def test_version_list_is_bounded_and_older_snapshots_stay_available(self):
        for index in range(45):
            self.store.capture("post", "many", "fixture-" + str(index))
        page1 = self.call("api_history", dict(kind=["post"], slug=["many"]))
        page2 = self.call("api_history", dict(kind=["post"], slug=["many"], offset=["40"]))
        self.assertEqual(page1["total"], 45)
        self.assertEqual(len(page1["items"]), 40)
        self.assertEqual(len(page2["items"]), 5)
        ids = [item["id"] for item in page1["items"] + page2["items"]]
        self.assertEqual(len(set(ids)), 45)


if __name__ == "__main__":
    unittest.main()
