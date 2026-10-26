"""Preview API/resource regressions; all fixtures live in a temporary directory."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import admin


class Request(admin.Handler):
    def __init__(self):
        self.result = None
        self.status = None
        self.data = None
        self.headers_out = None

    def json_out(self, value, status=200):
        self.result, self.status = value, status

    def _send(self, status, data, ctype, extra=None):
        self.status, self.data, self.ctype = status, data, ctype
        self.headers_out = extra or {}


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.public = self.root / "public"
        self.assets = self.public / "assets"
        self.assets.mkdir(parents=True)
        (self.assets / "vendor/fonts").mkdir(parents=True)
        (self.assets / "vendor/katex").mkdir(parents=True)
        (self.assets / "vendor/katex/katex.min.js").write_text("window.katex={};")
        (self.assets / "vendor/fonts/test.woff").write_bytes(b"font fixture")
        for name in ("site.css", "themes.css", "docs.css"):
            (self.assets / name).write_text('body{background:url("/assets/bg/test.webp")}@font-face{src:url("vendor/fonts/test.woff")}', encoding="utf-8")
        runtime = self.root / "theme/static/js"
        runtime.mkdir(parents=True)
        for name in admin.PREVIEW_RUNTIME:
            (runtime / name).write_text("/* shared runtime */", encoding="utf-8")
        (self.root / "secret.json").write_text("private", encoding="utf-8")
        self.cfg = {"site": {"url": "https://example.test/"}, "build": {"enableMath": True},
                    "appearance": {"defaultTheme": "bocchi", "defaultMode": "light", "defaultFont": "sans"}}
        for name, value in (("ROOT", str(self.root)), ("PUBLIC_DIR", str(self.public)),
                            ("_site_port", 4215), ("load_config", lambda: self.cfg)):
            p = patch.object(admin, name, value)
            p.start()
            self.addCleanup(p.stop)

    def preview(self, body, kind="post", front=None):
        request = Request()
        with patch.object(admin, "atomic_write", side_effect=AssertionError("Preview must never write")), \
                patch.object(admin, "Builder", side_effect=AssertionError("Preview must never build")):
            request.api_preview({"body": body, "kind": kind, "front": front or {}})
        self.assertEqual(request.status, 200, request.result)
        return request.result

    def test_article_uses_blog_markup_with_original_line_positions(self):
        result = self.preview("## 标题\n\n正文 $x^2$。\n\n```python\nprint(1)\n```\n")
        self.assertIn('data-source-line="1"', result["html"])
        self.assertIn('data-source-line="3"', result["html"])
        self.assertIn('data-source-line="5"', result["html"])
        self.assertIn('data-source-end="7"', result["html"])
        self.assertIn('math-inline', result["html"])
        self.assertIn('code-block', result["html"])
        self.assertEqual(result["toc"][0]["text"], "标题")

    def test_theme_shared_styles_math_and_scripts_are_advertised(self):
        result = self.preview("hello", front={"title": "Unsaved title", "slug": "../../private", "tags": ["C++"]})
        assets = result["previewAssets"]
        self.assertEqual(result["previewTheme"]["theme"], "bocchi")
        self.assertEqual(result["previewTheme"]["mode"], "light")
        self.assertTrue(assets["styles"][0].startswith("/preview-assets/themes.css?v="))
        self.assertTrue(assets["styles"][1].startswith("/preview-assets/site.css?v="))
        self.assertEqual(assets["mathScripts"], ["/preview-assets/vendor/katex/katex.min.js"])
        self.assertEqual(assets["mathStyle"], "/preview-assets/vendor/katex/katex.min.css")
        self.assertTrue(assets["scripts"][0].startswith("/preview-assets/runtime/site.js?v="))
        self.assertEqual(assets["siteBase"], "http://127.0.0.1:4215/")
        self.assertEqual(assets["assetBase"], "/")
        self.assertEqual(result["front"], {"title": "Unsaved title", "tags": ["C++"]})

    def test_doc_keeps_original_block_positions_across_empty_slides_and_figures(self):
        body = "# First\n\n---\n\n----\n\n## Figure\n\n<!--fig:ros-graph-->\n\n--\n\nLater\n\n---\n\n## Last\n"
        result = self.preview(body, "doc")
        self.assertTrue(result["deck"])
        self.assertEqual(result["count"], 3)
        self.assertEqual([s["blockIndex"] for s in result["slides"]], [0, 2, 3])
        self.assertTrue(any("/docs.css?" in url for url in result["previewAssets"]["styles"]))
        self.assertFalse(result["missingFigures"])
        figure = result["slides"][1]
        self.assertIn("<svg", figure["html"])
        self.assertIn('data-source-line="9"', figure["html"])
        self.assertIn('data-source-line="13"', figure["html"])
        self.assertIn('deck-fragment', figure["html"])
        self.assertLessEqual(figure["source_line"], 7)
        self.assertGreaterEqual(figure["source_end"], 13)

    def test_known_page_styles_and_learning_runtime_are_scoped(self):
        learning = self.preview("# Route", "page", {"slug": "learning"})
        self.assertEqual(learning["previewBodyClass"], "page-single page-learning")
        self.assertTrue(any("discovery.css" in url for url in learning["previewAssets"]["styles"]))
        self.assertTrue(any("runtime/learning.js" in url for url in learning["previewAssets"]["scripts"]))
        links = self.preview("# Links", "page", {"slug": "links"})
        self.assertEqual(links["previewBodyClass"], "page-single page-links")
        self.assertTrue(any("links.css" in url for url in links["previewAssets"]["styles"]))
        self.assertFalse(any("learning.js" in url for url in links["previewAssets"]["scripts"]))
        for kind, slug in (("post", "learning"), ("page", "learning extra-class"), ("page", "about")):
            result = self.preview("# Ordinary content", kind, {"slug": slug})
            self.assertEqual(result["previewBodyClass"], "")
            self.assertFalse(any("learning.js" in url for url in result["previewAssets"]["scripts"]))

    def test_missing_figure_and_fenced_delimiters_still_work(self):
        result = self.preview("# One\n\n```text\n---\n--\n```\n\n<!--fig:no-such-figure-->\n", "doc")
        self.assertEqual(result["count"], 1)
        self.assertIn("no-such-figure", result["missingFigures"])
        self.assertNotIn('class="deck-fragment"', result["slides"][0]["html"])

    def test_doc_icons_have_sprite_and_do_not_leak_to_next_preview(self):
        result = self.preview("# Links\n\n[GitHub](https://github.com/)\n", "doc")
        self.assertIn('id="site-github"', result["sprite"])
        self.assertIn('href="#site-github"', result["slides"][0]["html"])
        self.assertNotIn('id="site-github"', self.preview("No link")["html"])

    def test_css_keeps_relative_fonts_and_rewrites_absolute_asset_urls(self):
        request = Request()
        request.serve_preview_asset("/preview-assets/site.css")
        self.assertEqual(request.status, 200)
        self.assertIn(b'/preview-assets/bg/test.webp', request.data)
        self.assertIn(b'url("vendor/fonts/test.woff")', request.data)
        self.assertEqual(request.headers_out["Access-Control-Allow-Origin"], "*")
        self.assertIn("max-age", request.headers_out["Cache-Control"])

    def test_opaque_preview_can_load_fonts_and_only_allowed_shared_runtime(self):
        request = Request()
        request.serve_preview_asset("/preview-assets/vendor/fonts/test.woff")
        self.assertEqual(request.status, 200)
        self.assertEqual(request.ctype, "font/woff")
        self.assertEqual(request.headers_out["Access-Control-Allow-Origin"], "*")
        request.serve_preview_asset("/preview-assets/runtime/demo.js")
        self.assertEqual(request.status, 200)
        request.serve_preview_asset("/preview-assets/runtime/../../secret.json")
        self.assertEqual(request.status, 404)

    def test_asset_path_traversal_does_not_expose_files(self):
        for path in ("/preview-assets/../../secret.json", "/preview-assets/../assets-other/secret.json"):
            with self.subTest(path=path):
                request = Request()
                request.serve_preview_asset(path)
                self.assertEqual(request.status, 403)
                self.assertIsNone(request.data)

    def test_unknown_kind_rejected_without_rendering(self):
        request = Request()
        request.api_preview({"kind": "unknown", "body": "text"})
        self.assertEqual(request.status, 400)
        self.assertFalse(request.result["ok"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
