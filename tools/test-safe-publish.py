"""构建清理与发布回归测试。仅使用临时仓库；不访问网络，也不执行 push。"""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import build
import deploy


class SafePublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="blog-publish-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.pub = self.root / "public"

    def git(self, *args, cwd=None):
        result = subprocess.run(["git", *args], cwd=cwd or self.pub,
                                capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def seed_repository(self):
        self.pub.mkdir()
        self.git("init", "-b", "gh-pages")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        (self.pub / "old.html").write_text("old", encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-m", "original")
        return self.git("rev-parse", "HEAD")

    def test_clean_keeps_history_and_next_commit_is_descendant(self):
        original = self.seed_repository()
        self.git("remote", "add", "origin", "https://example.invalid/blog.git")
        (self.pub / "nested").mkdir()
        (self.pub / "nested" / "stale.txt").write_text("stale")
        build.clean_output_directory(str(self.pub), str(self.root))
        self.assertEqual([p.name for p in self.pub.iterdir()], [".git"])
        self.assertEqual(self.git("rev-parse", "HEAD"), original)
        self.assertEqual(self.git("remote", "get-url", "origin"), "https://example.invalid/blog.git")
        (self.pub / "index.html").write_text("new", encoding="utf-8")
        self.git("add", "-A")
        self.git("commit", "-m", "updated")
        self.assertEqual(self.git("rev-parse", "HEAD^"), original)

    def test_linked_worktree_git_file_is_preserved(self):
        self.seed_repository()
        worktree = self.root / "preview"
        self.git("worktree", "add", "-b", "preview", str(worktree))
        metadata = (worktree / ".git").read_bytes()
        build.clean_output_directory(str(worktree), str(self.root))
        self.assertEqual((worktree / ".git").read_bytes(), metadata)
        self.assertEqual(self.git("symbolic-ref", "--short", "HEAD", cwd=worktree), "preview")
        deploy.prepare_repository(str(worktree), "https://example.invalid/blog.git", "preview")

    def test_unsafe_output_paths_rejected_without_modifying_sources(self):
        for name in ("content", "theme", "assets", "tools", "docs", ".git"):
            folder = self.root / name
            folder.mkdir()
            (folder / "keep.txt").write_text("keep")
        for value in ("", ".", "..", "../outside", str(self.root.parent),
                      "content", "content/posts/output", "theme", "assets", "tools", "docs", ".git",
                      "public/.git", "public/.git/objects"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                build.clean_output_directory(value, str(self.root))
        self.assertTrue(all((self.root / name / "keep.txt").exists()
                            for name in ("content", "theme", "assets", "tools", "docs", ".git")))

    def test_directory_links_are_not_followed(self):
        outside = self.root / "content"
        outside.mkdir()
        sentinel = outside / "keep.txt"
        sentinel.write_text("keep")
        self.pub.mkdir()
        link = self.pub / "link"
        try:
            os.symlink(outside, link, target_is_directory=True)
        except OSError as exc:
            if os.name != "nt":
                self.skipTest(f"当前系统不允许创建符号链接：{exc}")
            # Windows 普通账户通常不能建 symlink，但可建目录 junction。
            import _winapi
            _winapi.CreateJunction(str(outside), str(link))
        with self.assertRaises(ValueError):
            build.clean_output_directory(str(link), str(self.root))
        build.clean_output_directory(str(self.pub), str(self.root))
        self.assertTrue(sentinel.exists())
        self.assertFalse(os.path.lexists(link))

    def test_cleanup_error_aborts_instead_of_leaving_stale_files_silently(self):
        self.seed_repository()
        (self.pub / "stale").mkdir()
        with patch.object(build.shutil, "rmtree", side_effect=PermissionError("in use")) as remove, \
                patch.object(build.time, "sleep"), self.assertRaisesRegex(OSError, "构建已中止"):
            build.clean_output_directory(str(self.pub), str(self.root))
        self.assertEqual(remove.call_count, 4)
        self.assertTrue((self.pub / ".git" / "HEAD").exists())

    def test_wrong_branch_aborts_before_build_or_clean(self):
        original = self.seed_repository()
        with self.assertRaisesRegex(SystemExit, "当前分支"):
            deploy.prepare_repository(str(self.pub), "https://example.invalid/blog.git", "main")
        self.assertEqual(self.git("rev-parse", "HEAD"), original)
        self.assertTrue((self.pub / "old.html").exists())

    def test_different_push_url_aborts_before_clean(self):
        self.seed_repository()
        self.git("remote", "add", "origin", "https://example.invalid/blog.git")
        self.git("remote", "set-url", "--push", "origin", "https://example.invalid/other.git")
        with self.assertRaisesRegex(SystemExit, "实际推送地址"):
            deploy.prepare_repository(str(self.pub), "https://example.invalid/blog.git", "gh-pages")
        self.assertTrue((self.pub / "old.html").exists())

    def test_deploy_uses_checked_remote_and_non_force_head_push(self):
        original = self.seed_repository()
        self.git("remote", "add", "origin-backup", "https://example.invalid/backup.git")
        config = self.root / "site.config.json"
        config.write_text(json.dumps({"build": {"outDir": "public"},
                                      "site": {"url": "https://example.invalid"},
                                      "deploy": {"remote": "https://example.invalid/blog.git", "branch": "gh-pages"}}))
        actual_run = deploy.run
        commands = []

        def fake_build_and_push(cmd, **kwargs):
            commands.append(cmd)
            if cmd[0] == deploy.sys.executable:
                if cmd[1].endswith("build.py"):
                    build.clean_output_directory(str(self.pub), str(self.root))
                    (self.pub / "index.html").write_text("rebuilt")
                return 0, "test output", ""
            if cmd[:2] == ["git", "push"]:
                return 0, "push mocked; no network request", ""
            return actual_run(cmd, **kwargs)

        with patch.object(deploy, "ROOT", str(self.root)), patch.object(deploy, "CONFIG", str(config)), \
                patch.object(deploy, "run", side_effect=fake_build_and_push), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(deploy.main([]), 0)
            pushes = [cmd for cmd in commands if cmd[:2] == ["git", "push"]]
            self.assertEqual(pushes, [["git", "push", "-u", "origin", "HEAD:refs/heads/gh-pages"]])
            commands.clear()
            self.assertEqual(deploy.main(["--dry-run"]), 0)
            self.assertFalse(any(cmd[:2] == ["git", "push"] for cmd in commands))
        self.assertEqual(self.git("rev-parse", "HEAD^"), original)
        self.assertEqual(self.git("remote", "get-url", "origin"), "https://example.invalid/blog.git")

    def test_missing_cli_argument_is_reported_before_config_or_git(self):
        with patch.object(deploy, "run") as runner, contextlib.redirect_stderr(io.StringIO()), \
                self.assertRaises(SystemExit) as result:
            deploy.main(["--message"])
        self.assertEqual(result.exception.code, 2)
        runner.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
