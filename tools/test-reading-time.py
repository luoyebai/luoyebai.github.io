"""Reading estimates exclude interactive source, while preserving teaching code."""
from pathlib import Path
import re
import unittest
from unittest.mock import patch

import admin
import build
import deck
import mdparse


def legacy_minutes(text):
    return max(1, round(len(build.CJK.findall(text)) / 380 +
                        len(re.findall(r"[A-Za-z0-9_]+", text)) / 200))


class Request(admin.Handler):
    def __init__(self):
        self.result = None

    def json_out(self, value, status=200):
        self.result, self.status = value, status


class ReadingTimeTests(unittest.TestCase):
    def test_code_only_slides_survive_plain_text_source_filtering(self):
        for fence, info in (("```", "python"), ("````", "text"), ("~~~", "js"), ("~~~", "js run")):
            source = fence + info + "\nprint('teaching example')\n" + fence
            for mapped in (False, True):
                with self.subTest(fence=fence, info=info, mapped=mapped):
                    slides = deck.parse(source, source_map=mapped)
                    self.assertEqual(slides["count"], 1)
                    self.assertEqual(slides["slides"][0]["plain"], "")
        self.assertEqual(deck.parse("\n---\n\n")["count"], 0)

    def test_runnable_source_is_excluded_but_explanations_count(self):
        explanation = "工程说明" * 300
        code = "const sampleValue = 1;\n" * 1000
        text = explanation + "\n\n```js run\n" + code + "```\n\n结束说明"
        self.assertEqual(build.reading_time(text), legacy_minutes(explanation + "结束说明"))
        self.assertLess(build.reading_time(text), legacy_minutes(text))

    def test_normal_teaching_code_and_nonrunnable_languages_still_count(self):
        code = "important_function meaningful_variable next_result\n" * 300
        for info in ("js", "javascript", "python run", "text run", "js runtime", "js run,", "css run"):
            with self.subTest(info=info):
                text = "解释\n\n```" + info + "\n" + code + "```"
                self.assertEqual(build.reading_time(text), legacy_minutes(text))
                self.assertNotIn("important_function", mdparse.to_text(text))

    def test_every_rendered_alias_and_case_insensitive_run_flag_matches(self):
        for language in mdparse.RUNNABLE_LANGS:
            with self.subTest(language=language):
                text = "~~~" + language.upper() + " other RUN\nuniquePayload()\n~~~~\n说明"
                rendered, _ = mdparse.render(text)
                self.assertIn('class="demo"', rendered)
                self.assertNotIn("uniquePayload", mdparse.strip_fenced_code(text, runnable_only=True))
                self.assertEqual(mdparse.to_text(text), "说明")

    def test_outer_teaching_fence_keeps_nested_run_marker_as_teaching_text(self):
        text = "前文\n````text\n```js run\nexample_source();\n```\n````\n后文"
        self.assertEqual(mdparse.strip_fenced_code(text, runnable_only=True), text)
        self.assertEqual(mdparse.to_text(text), "前文 后文")
        rendered, _ = mdparse.render(text)
        self.assertNotIn('class="demo"', rendered)

    def test_short_or_mixed_closers_do_not_terminate_a_long_fence(self):
        text = "before\n`````js run\ninsideOne\n```\ninsideTwo\n~~~~~\ninsideThree\n``````   \nafter"
        filtered = mdparse.strip_fenced_code(text, runnable_only=True)
        self.assertNotIn("inside", filtered)
        self.assertIn("before", filtered)
        self.assertIn("after", filtered)
        self.assertEqual(mdparse.to_text(text), "before after")

    def test_unclosed_fences_and_crlf_follow_renderer_boundary(self):
        text = "说明\r\n\r\n```JS RUN\r\nconst neverClosed = 1;"
        self.assertEqual(mdparse.to_text(text), "说明")
        self.assertEqual(build.reading_time(text), legacy_minutes("说明"))
        self.assertEqual(mdparse.strip_fenced_code("```js\nnormal code", runnable_only=True), "```js\nnormal code")

    def test_recursive_quotes_and_callouts_remove_actual_demos(self):
        examples = (
            "> 说明\n>\n> ```js run\n> quotePayload();\n> ```\n\n后文",
            "> > ~~~~HTML RUN\n> > <p>quotePayload</p>\n> > ~~~~\n\n后文",
            "::: tip 说明\n```javascript run\nquotePayload();\n```\n:::\n\n后文",
        )
        for text in examples:
            with self.subTest(text=text):
                rendered, _ = mdparse.render(text)
                self.assertIn('class="demo"', rendered)
                self.assertNotIn("quotePayload", mdparse.strip_fenced_code(text, runnable_only=True))
                self.assertNotIn("quotePayload", mdparse.to_text(text))
                self.assertIn("后文", mdparse.to_text(text))

    def test_unclosed_fence_in_quote_or_callout_cannot_eat_the_following_article(self):
        for text in ("> ```js run\n> hiddenPayload\n\n后文", "::: note\n```js run\nhiddenPayload\n:::\n\n后文"):
            with self.subTest(text=text):
                self.assertNotIn("hiddenPayload", mdparse.strip_fenced_code(text, runnable_only=True))
                self.assertIn("后文", mdparse.to_text(text))

    def test_fence_looking_raw_html_and_math_are_not_demos(self):
        for text in ("<pre>\n```js run\nrawPayload\n```\n</pre>", "$$\n```js run\nrawPayload\n```\n$$"):
            with self.subTest(text=text):
                self.assertEqual(mdparse.strip_fenced_code(text, runnable_only=True), text)
                rendered, _ = mdparse.render(text)
                self.assertNotIn('class="demo"', rendered)

    def test_fence_looking_list_continuations_and_table_rows_are_not_demos(self):
        examples = (
            "- 教学格式\n  ```js run\n  listPayload\n  ```\n\n后文",
            "| A | B |\n| -- | -- |\n```js run | tablePayload\n``` | ordinaryRow\n\n后文",
        )
        for text in examples:
            with self.subTest(text=text):
                self.assertEqual(mdparse.strip_fenced_code(text, runnable_only=True), text)
                rendered, _ = mdparse.render(text)
                self.assertNotIn('class="demo"', rendered)

    def test_plain_text_preserves_prose_inline_code_and_limit(self):
        text = "开头 `demo.animate()` [文档](https://example.test)\n\n~~~python\nexcluded_source()\n~~~\n\n结束"
        self.assertEqual(mdparse.to_text(text), "开头 demo.animate() 文档 结束")
        self.assertEqual(mdparse.to_text(text, 2), "开头")
        self.assertEqual(build.reading_time(""), 1)

    def test_real_article_static_collection_admin_list_and_unsaved_preview_agree(self):
        path = Path(__file__).resolve().parents[1] / "content/posts/runnable-demos.md"
        _front, body = mdparse.parse_front_matter(path.read_text(encoding="utf-8"))
        expected = build.reading_time(body)
        self.assertGreater(legacy_minutes(body), expected + 15)
        self.assertLessEqual(expected, 6)
        plain = mdparse.to_text(body)
        self.assertLess(len(plain), 5000)
        for implementation in ("function paintFlight", "function resetMemory", "const budget", "uniquePayload"):
            self.assertNotIn(implementation, plain)
        self.assertIn("记忆翻牌", plain)
        article = next(item for item in build.load_collection("posts", build.load_config()) if item["slug"] == "runnable-demos")
        listed = next(item for item in admin.list_docs("post") if item["slug"] == "runnable-demos")
        request = Request()
        with patch.object(admin, "preview_metadata", return_value={}):
            request.api_preview({"kind": "post", "body": body})
        self.assertEqual(request.status, 200)
        self.assertEqual(article["minutes"], expected)
        self.assertEqual(listed["minutes"], expected)
        self.assertEqual(request.result["minutes"], expected)
        self.assertEqual(request.result["chars"], len(plain))
        self.assertEqual(article["html"].count('class="demo"'), 7)


if __name__ == "__main__":
    unittest.main(verbosity=2)
