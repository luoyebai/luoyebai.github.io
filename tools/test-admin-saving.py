"""Saving regressions in a temporary workspace; no server or real content is modified."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import admin


class Request(admin.Handler):
    def __init__(self):
        self.result = None
        self.status = None

    def json_out(self, value, status=200):
        self.result, self.status = value, status


class SavingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = self.root / "site.config.json"
        self.config.write_text(json.dumps({"site": {"title": "Original"}, "hero": {},
                                          "appearance": {}, "docs": {"collections": []}}), encoding="utf-8")
        for kind in admin.KINDS.values():
            (self.root / "content" / kind).mkdir(parents=True)
        for name, value in (("ROOT", str(self.root)), ("CONFIG_PATH", str(self.config)),
                            ("load_config", lambda: json.loads(self.config.read_text(encoding="utf-8")))):
            p = patch.object(admin, name, value)
            p.start()
            self.addCleanup(p.stop)

    def call(self, method, payload):
        req = Request()
        getattr(req, method)(payload)
        return req.status, req.result

    def create(self, slug="draft", body="Original text"):
        status, result = self.call("api_save", {"kind": "post", "front": {"slug": slug, "title": slug}, "body": body})
        self.assertEqual(status, 200, result)
        return result

    def save_payload(self, result, **changes):
        return {"kind": "post", "originalSlug": result["slug"], "revision": result["revision"],
                "front": result["front"], "body": "Revised text", **changes}

    def test_new_file_and_rename_cannot_overwrite_existing_content(self):
        a, b = self.create("first"), self.create("second", "Keep this")
        path = self.root / "content/posts/second.md"
        before = path.read_bytes()
        status, _ = self.call("api_save", {"kind": "post", "front": {"slug": "second"}, "body": "overwrite"})
        self.assertEqual(status, 409)
        payload = self.save_payload(a, front={**a["front"], "slug": "second"})
        self.assertEqual(self.call("api_save", payload)[0], 409)
        self.assertEqual(path.read_bytes(), before)
        self.assertTrue((self.root / "content/posts/first.md").exists())

    def test_stale_save_and_delete_leave_newer_content_intact(self):
        saved = self.create()
        payload = self.save_payload(saved)
        self.assertEqual(self.call("api_save", payload)[0], 200)
        path = self.root / "content/posts/draft.md"
        before = path.read_bytes()
        self.assertEqual(self.call("api_save", payload)[0], 409)
        self.assertEqual(self.call("api_delete", {"kind": "post", "slug": "draft", "revision": saved["revision"]})[0], 409)
        self.assertEqual(path.read_bytes(), before)

    def test_external_change_is_detected_and_missing_version_is_rejected(self):
        saved = self.create()
        path = self.root / "content/posts/draft.md"
        path.write_text("External editor changed this", encoding="utf-8")
        self.assertEqual(self.call("api_save", self.save_payload(saved))[0], 409)
        self.assertEqual(self.call("api_save", self.save_payload(saved, revision=None))[0], 428)
        self.assertEqual(path.read_text(encoding="utf-8"), "External editor changed this")

    def test_rename_returns_new_revision_then_can_be_saved_and_deleted(self):
        saved = self.create()
        status, renamed = self.call("api_save", self.save_payload(saved, front={**saved["front"], "slug": "renamed"}))
        self.assertEqual(status, 200)
        self.assertTrue(renamed["renamed"])
        self.assertFalse((self.root / "content/posts/draft.md").exists())
        status, loaded = self.call("api_doc", {"kind": ["post"], "slug": ["renamed"]})
        self.assertEqual(loaded["revision"], renamed["revision"])
        status, saved = self.call("api_save", self.save_payload(renamed, body="Next revision"))
        self.assertEqual(status, 200)
        self.assertNotEqual(saved["revision"], renamed["revision"])
        self.assertEqual(self.call("api_delete", {"kind": "post", "slug": "renamed", "revision": saved["revision"]})[0], 200)

    def test_two_concurrent_saves_cannot_both_accept_the_same_revision(self):
        saved = self.create()
        payloads = [self.save_payload(saved, body="Writer " + str(i)) for i in range(2)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda p: self.call("api_save", p), payloads))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])

    def test_site_revision_prevents_stale_settings_overwrite(self):
        revision = admin.file_revision(str(self.config))
        status, saved = self.call("api_site", {"revision": revision, "site": {"title": "New title"}})
        self.assertEqual(status, 200)
        before = self.config.read_bytes()
        self.assertEqual(self.call("api_site", {"revision": revision, "site": {"title": "Stale title"}})[0], 409)
        self.assertEqual(self.call("api_site", {"site": {"title": "Unversioned"}})[0], 428)
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(saved["revision"], admin.file_revision(str(self.config)))
        self.assertEqual(Request().api_state()["configRevision"], saved["revision"])
        self.assertEqual(json.loads(Path(str(self.config) + ".bak").read_text())["site"]["title"], "Original")

    def test_failed_atomic_replace_keeps_original_and_removes_temp_file(self):
        before = self.config.read_bytes()
        with patch.object(admin.os, "replace", side_effect=OSError("Disk unavailable")):
            with self.assertRaises(OSError):
                admin.atomic_write(str(self.config), "Replacement")
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(list(self.root.glob(".admin-*.tmp")), [])

    def test_canonical_slug_matches_filename_and_prevents_sanitized_collision(self):
        saved = self.create("../../name")
        self.assertEqual(saved["slug"], "name")
        self.assertEqual(saved["front"]["slug"], "name")
        self.assertEqual(self.call("api_save", {"kind": "post", "front": {"slug": "name"}, "body": "other"})[0], 409)


if __name__ == "__main__":
    unittest.main(verbosity=2)
