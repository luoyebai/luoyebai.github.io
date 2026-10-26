"""Preview source positions must follow source lines, never matching text content."""
from html.parser import HTMLParser
from pathlib import Path
import re
import unittest

import deck
import docfigs
import mdparse


SOURCE_ATTRS = re.compile(r' data-source-(?:line|end)="[0-9]+"')


class MappedElements(HTMLParser):
    def __init__(self, markup):
        super().__init__()
        self.elements = []
        self.feed(markup)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if 'data-source-line' in attrs:
            self.elements.append((tag, int(attrs['data-source-line']),
                                  int(attrs['data-source-end'])))

    handle_startendtag = handle_starttag


class SourceMapTests(unittest.TestCase):
    def test_all_block_types_and_repeated_text(self):
        blocks = [
            ('# Repeated', 'h1'),
            ('Repeated\nsecond line', 'p'),
            ('# Repeated', 'h1'),
            ('Repeated\nsecond line', 'p'),
            ('````text\n---\n--\n```\n++++\n````', 'div'),
            ('$$x + y$$', 'div'),
            ('$$\nx = y\n$$', 'div'),
            ('- one\n  - nested\n- two', 'ul'),
            ('3. three\n4. four', 'ol'),
            ('> quote\n> continued', 'blockquote'),
            ('| A | B |\n| --- | --- |\n| 1 | 2 |', 'div'),
            ('::: note Heading\nInside\n\n- nested\n:::', 'aside'),
            ('---', 'hr'),
            ('![movie](/clip.mp4)', 'figure'),
            ('![one](/a.png) ![two](/b.png)', 'div'),
            ('::: gallery 2\n![one](/a.png)\n![two](/b.png)\n:::', 'div'),
            ('```js run\nconsole.log("ok");\n```', 'div'),
            ('<img src="/a.png" title="a and b">', 'img'),
        ]
        expected, lines = [], []
        for text, tag in blocks:
            start = len(lines) + 1
            lines.extend(text.split('\n'))
            expected.append((tag, start, len(lines)))
            lines.append('')
        body = '\n'.join(lines)
        normal, toc = mdparse.render(body)
        mapped, mapped_toc = mdparse.render(body, source_map=True)
        self.assertEqual(MappedElements(mapped).elements, expected)
        self.assertEqual(SOURCE_ATTRS.sub('', mapped), normal)
        self.assertEqual(mapped_toc, toc)

    def test_native_html_maps_roots_without_wrappers(self):
        body = ('<!-- <aside>only a comment</aside> -->\n\n'
                '<div title="x > y">\n<span>inside</span>\n</div>\n'
                '<figure><img src="x.png"></figure>\n\nAfter')
        normal, _ = mdparse.render(body)
        mapped, _ = mdparse.render(body, source_map=True)
        self.assertEqual(MappedElements(mapped).elements,
                         [('div', 3, 5), ('figure', 6, 6), ('p', 8, 8)])
        self.assertEqual(SOURCE_ATTRS.sub('', mapped), normal)

    def test_unclosed_fence_stops_at_source_end(self):
        mapped, _ = mdparse.render('\n```python\nprint(1)', source_map=True)
        self.assertEqual(MappedElements(mapped).elements, [('div', 2, 3)])

    def test_newline_normalization_and_empty_body(self):
        mapped, _ = mdparse.render('# Same\r\n\r\nSame\rSame', source_map=True)
        self.assertEqual(MappedElements(mapped).elements, [('h1', 1, 1), ('p', 3, 4)])
        self.assertEqual(mdparse.render('', source_map=True), mdparse.render(''))

    def test_deck_page_indices_include_empty_pages(self):
        body = ('# Same\n\n--\n\nSame\n\n---\n\n----\n\n# Same\n'
                '\n```text\n---\n--\n++++\n```\n\n++++\n\nLast')
        normal = deck.parse(body)
        mapped = deck.parse(body, source_map=True)
        self.assertEqual(mapped['count'], 3)
        self.assertEqual([(s['block_index'], s['source_line'], s['source_end'])
                          for s in mapped['slides']], [(0, 1, 6), (2, 10, 18), (3, 20, 21)])
        self.assertEqual(MappedElements(mapped['slides'][0]['html']).elements,
                         [('h1', 1, 1), ('div', 4, 5), ('p', 5, 5)])
        self.assertEqual(MappedElements(mapped['slides'][1]['html']).elements,
                         [('h1', 11, 11), ('div', 13, 17)])
        for current, original in zip(mapped['slides'], normal['slides']):
            self.assertEqual(SOURCE_ATTRS.sub('', current['html']), original['html'])

    def test_deck_figure_expansion_preserves_following_positions(self):
        name = next(iter(docfigs.FIGURES))
        body = f'# Before\n\n<!--fig:{name}-->\n\nAfter\n\n--\n\nAfter'
        mapped = deck.parse(body, source_map=True, expand_figures=True)
        expanded, _ = docfigs.expand_figures(body)
        normal = deck.parse(expanded)
        self.assertEqual(mapped['count'], normal['count'])
        self.assertEqual(mapped['missingFigures'], [])
        elements = MappedElements(mapped['slides'][0]['html']).elements
        self.assertIn(('figure', 3, 3), elements)
        self.assertIn(('p', 5, 5), elements)
        self.assertIn(('p', 9, 9), elements)
        self.assertEqual(SOURCE_ATTRS.sub('', mapped['slides'][0]['html']),
                         normal['slides'][0]['html'])
        only_figure = deck.parse(f'<!--fig:{name}-->', source_map=True, expand_figures=True)
        self.assertEqual(only_figure['count'], 1)
        missing = deck.parse('<!--fig:unknown-preview-figure-->', expand_figures=True)
        self.assertEqual(missing['missingFigures'], ['unknown-preview-figure'])

    def test_deck_does_not_rewrite_source_attribute_literals(self):
        literal = 'data-source-line="123" data-source-end="456"'
        body = '# First\n\n---\n\n# Second\n\n' + literal + '\n\n```text\n' + literal + '\n```'
        mapped = deck.parse(body, source_map=True)
        self.assertIn(literal, mapped['slides'][1]['html'])
        self.assertEqual(MappedElements(mapped['slides'][1]['html']).elements,
                         [('h1', 5, 5), ('p', 7, 7), ('div', 9, 11)])

    def test_real_decks_keep_public_rendering_after_figure_expansion(self):
        root = Path(__file__).resolve().parents[1]
        for path in (root / 'content' / 'docs').glob('*.md'):
            _, body = mdparse.parse_front_matter(path.read_text(encoding='utf-8'))
            expanded, _ = docfigs.expand_figures(body)
            normal = deck.parse(expanded)
            mapped = deck.parse(body, source_map=True, expand_figures=True)
            self.assertEqual(mapped['count'], normal['count'], str(path))
            for source, preview in zip(normal['slides'], mapped['slides']):
                self.assertEqual(SOURCE_ATTRS.sub('', preview['html']), source['html'], str(path))

    def test_real_content_mapping_keeps_html_and_toc(self):
        root = Path(__file__).resolve().parents[1]
        count = 0
        for path in (root / 'content').rglob('*.md'):
            _, body = mdparse.parse_front_matter(path.read_text(encoding='utf-8'))
            normal, toc = mdparse.render(body)
            mapped, mapped_toc = mdparse.render(body, source_map=True)
            self.assertEqual(SOURCE_ATTRS.sub('', mapped), normal, str(path))
            self.assertEqual(mapped_toc, toc, str(path))
            total = len(body.replace('\r\n', '\n').replace('\r', '\n').split('\n'))
            for _, first, last in MappedElements(mapped).elements:
                self.assertTrue(1 <= first <= last <= total, (path, first, last, total))
            count += 1
        self.assertGreater(count, 20)


if __name__ == '__main__':
    unittest.main()
