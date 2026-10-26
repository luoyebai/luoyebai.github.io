"""Independent content covers survive wallpaper-free builds; writes use fixtures only."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build


class CoverBuildTests(unittest.TestCase):
    def test_wallpaper_filter_applies_to_every_content_type_without_losing_custom_covers(self):
        covers = {
            'uploaded': 'assets/uploads/reader-cover.webp',
            'custom': 'assets/custom/article-cover.webp',
            'similar-folder': 'assets/bg-extra/diagram.webp',
            'wallpaper': 'assets/bg/wallpaper.webp',
            'custom-theme': 'assets/custom/theme.webp',
            'uploaded-theme': 'assets/uploads/theme.webp',
        }
        wallpaper_names = {'wallpaper', 'custom-theme', 'uploaded-theme'}
        with tempfile.TemporaryDirectory() as root:
            content = Path(root, 'content')
            for kind in ('posts', 'projects', 'pages'):
                folder = content / kind
                folder.mkdir(parents=True)
                for name, cover in covers.items():
                    front = dict(title=name, slug=kind + '-' + name, cover=cover)
                    metadata = '\n'.join(key + ': ' + json.dumps(value) for key, value in front.items())
                    (folder / (name + '.md')).write_text('---\n' + metadata + '\n---\n\n正文\n', encoding='utf-8')
            for cover in covers.values():
                path = Path(root, cover)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'cover fixture')

            for stripped in (False, True):
                with self.subTest(stripBackgrounds=stripped):
                    cfg = build.load_config()
                    cfg['build']['stripBackgrounds'] = stripped
                    cfg['themes'] = [dict(bg='./assets/custom/theme.webp'), dict(bg='assets/uploads/theme.webp')]
                    with patch.object(build, 'CONTENT', str(content)), \
                            patch.object(build, 'load_docs', return_value=([], [], [])), \
                            patch.object(build, 'build_themes_css', return_value=('', {})):
                        builder = build.Builder(cfg)
                    builder.out = str(Path(root, 'output-' + str(stripped)))
                    for kind, key, template in (('posts', 'post', 'post.html'),
                                                ('projects', 'project', 'project.html'),
                                                ('pages', 'content_page', 'page.html')):
                        for item in getattr(builder, kind):
                            name = item['title']
                            hidden = stripped and name in wallpaper_names
                            with self.subTest(kind=kind, cover=name, stripped=stripped):
                                self.assertEqual(item['cover'], '' if hidden else covers[name])
                                rendered = builder.engine.render(template, {key: item, 'build': {'basePath': '/blog'}})
                                self.assertEqual('phero-media' in rendered, not hidden)
                                if not hidden:
                                    self.assertIn('src="/blog/' + covers[name] + '"', rendered)
                    with patch.object(build, 'ROOT', root):
                        builder._copy_referenced()
                    for name, cover in covers.items():
                        self.assertEqual(Path(builder.out, cover).is_file(), not (stripped and name in wallpaper_names))

    def test_wallpaper_path_matching_uses_whole_normalized_paths(self):
        items = [dict(cover=path) for path in (
            '/assets/bg/a.webp', './assets/bg/b.webp', 'assets\\bg\\c.webp',
            'assets/custom/../custom/theme.webp', 'assets/custom/theme.webp.backup', '')]
        build.strip_wallpaper_covers(items, [dict(bg='assets/custom/theme.webp')])
        self.assertEqual([item['cover'] for item in items], ['', '', '', '', 'assets/custom/theme.webp.backup', ''])


if __name__ == '__main__':
    unittest.main()
