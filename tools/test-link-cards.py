"""Known Python reference links use local icons without a network lookup."""
import unittest

import mdparse
import siteicons


class PythonLinkCards(unittest.TestCase):
    url = "https://peps.pythonlang.cn/pep-0008/"

    def setUp(self):
        mdparse.take_icons()

    def test_python_mirror_bare_and_angle_links_are_cards(self):
        for source in (self.url, f"<{self.url}>"):
            with self.subTest(source=source):
                markup, _ = mdparse.render(source)
                self.assertIn('class="link-card"', markup)
                self.assertIn(f'href="{self.url}"', markup)
                self.assertIn('<use href="#site-python"/>', markup)
                self.assertIn('data-site="peps.pythonlang.cn"', markup)
                self.assertEqual(mdparse.take_icons(), {"python"})

    def test_named_card_retains_title_and_preview_source_mapping(self):
        title = "PEP 8 · Python 代码风格指南（中文）"
        markup, _ = mdparse.render(f"[{title}]({self.url})", source_map=True)
        self.assertIn(f'<span class="link-card-title">{title}</span>', markup)
        self.assertIn('data-source-line="1"', markup)
        self.assertIn('data-source-end="1"', markup)
        self.assertIn('id="site-python"', siteicons.sprite(mdparse.take_icons()))

    def test_inline_reference_remains_inline_with_python_mark(self):
        markup, _ = mdparse.render(f"参考 [PEP 8]({self.url}) 的说明。")
        self.assertNotIn('class="link-card"', markup)
        self.assertIn('class="site-link"', markup)
        self.assertIn('<use href="#site-python"/>', markup)

    def test_domain_matching_uses_label_boundaries(self):
        self.assertEqual(siteicons.slug_for("PEPS.PYTHONLANG.CN:443"), "python")
        self.assertEqual(siteicons.slug_for("docs.pythonlang.cn"), "python")
        self.assertEqual(siteicons.slug_for("peps.python.org"), "python")
        self.assertIsNone(siteicons.slug_for("peps.pythonlang.cn.example.com"))
        self.assertIsNone(siteicons.slug_for("notpythonlang.cn"))


if __name__ == "__main__":
    unittest.main()
