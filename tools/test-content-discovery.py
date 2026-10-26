"""Route preservation and discovery checks; only temporary output is written."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build


class DiscoveryTests(unittest.TestCase):
    def test_aliases_go_directly_to_current_route(self):
        items = [dict(url='/posts/current/', aliases=['/posts/original/', '/posts/previous/', '/posts/current/'])]
        aliases = build.collect_redirects(items, {'/', '/posts/', '/posts/current/'})
        self.assertEqual(aliases, {'/posts/original/': '/posts/current/', '/posts/previous/': '/posts/current/'})

    def test_alias_collisions_and_unsafe_paths_fail_before_writes(self):
        bad = ['/posts/', '/posts/live/', '/POSTS/LIVE/', '//outside/', '/../outside/',
               '/assets/foo/', '/.blog-history/', '/posts/old?query/', '/posts/old#hash/',
               '/posts/%2e%2e/', '/posts/CON/', '/posts/index.html/', '/404.html/', '/feed.xml/',
               '/posts/page/2/', '/posts/page/', 'https://other.example/', ['/nested/']]
        for alias in bad:
            with self.subTest(alias=alias), self.assertRaises(ValueError):
                build.collect_redirects([dict(url='/posts/new/', aliases=[alias])], {'/posts/', '/posts/live/'})
        with self.assertRaises(ValueError):
            build.collect_redirects([dict(url='/a/', aliases=['/old/']), dict(url='/b/', aliases=['/old/'])], set())

    def test_redirect_preserves_fragment_query_and_subpath(self):
        cfg = {'site': {'url': 'https://example.test'}, 'build': {'basePath': '/blog'}}
        html = build.redirect_document(cfg, '/posts/new/')
        self.assertIn('location.search + location.hash', html)
        self.assertIn('location.replace("/blog/posts/new/"', html)
        self.assertIn('href="https://example.test/blog/posts/new/"', html)
        self.assertIn('noindex,follow', html)
        self.assertIn('<noscript>', html)

    def test_history_directory_cannot_be_used_as_build_output(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                build.output_directory('.blog-history', root)

    def test_editable_pages_use_their_public_routes(self):
        cfg = build.load_config()
        pages = build.load_collection('pages', cfg)
        self.assertTrue(any(p['slug'] == 'learning' for p in pages))
        self.assertTrue(all(p['url'] == '/' + p['slug'] + '/' for p in pages))

    def test_page_covers_render_for_root_and_subpath_sites(self):
        for base in ('', '/blog'):
            for slug in ('about', 'links', 'learning', 'custom'):
                with self.subTest(base=base, slug=slug):
                    builder = object.__new__(build.Builder)
                    builder.cfg = {'build': {'basePath': base}, 'site': {'avatar': 'assets/avatar.svg'}}
                    builder.pages = [dict(slug=slug, title='页面标题', summary='页面简介',
                        subtitle='页面副标题', html='<p>正文内容</p>', has_math=False, site_icons='',
                        cover='assets/custom/封面.gif', cover_alt='封面说明', cover_pos='50% 30%',
                        cover_w=1280, cover_h=720)]
                    builder.engine = build.Engine(build.TEMPLATES)
                    builder.base_ctx = lambda **kw: dict(kw, **builder.cfg)
                    captured = {}
                    builder.emit = lambda path, text: captured.update({path: text})
                    builder.build_pages()
                    html = captured[slug + '/index.html']
                    self.assertIn('class="phero has-media"', html)
                    self.assertIn(f'src="{base}/assets/custom/封面.gif"', html)
                    self.assertIn('alt="封面说明"', html)
                    self.assertIn('width="1280" height="720"', html)
                    self.assertIn('object-position: 50% 30%', html)
                    self.assertIn('页面副标题', html)
                    self.assertIn('<p>正文内容</p>', html)
                    if slug == 'about':
                        self.assertIn(f'src="{base}/assets/avatar.svg"', html)
                    if slug == 'links':
                        self.assertIn('BOOKMARKS', html)

    def test_page_without_cover_does_not_render_an_empty_image(self):
        html = build.Engine(build.TEMPLATES).render('page.html', {
            'content_page': {'title': '无封面', 'cover': '', 'html': '<p>正文</p>'}})
        self.assertIn('class="post-head"', html)
        self.assertNotIn('phero-media', html)
        self.assertNotIn('<img', html)

    def test_page_cover_and_body_assets_in_custom_folders_are_copied(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root, 'assets', 'custom')
            source.mkdir(parents=True)
            (source / 'cover.gif').write_bytes(b'cover fixture')
            (source / 'diagram.svg').write_bytes(b'diagram fixture')
            builder = object.__new__(build.Builder)
            builder.cfg = {'site': {}}
            builder.posts = builder.projects = builder.docs = builder.doc_collections = []
            builder.pages = [dict(cover='assets/custom/cover.gif', html='<img src="/assets/custom/diagram.svg">')]
            builder.out = str(Path(root, 'output'))
            builder.written = []
            with patch.object(build, 'ROOT', root):
                builder._copy_referenced()
            self.assertEqual(Path(builder.out, 'assets/custom/cover.gif').read_bytes(), b'cover fixture')
            self.assertEqual(Path(builder.out, 'assets/custom/diagram.svg').read_bytes(), b'diagram fixture')

    def test_search_keeps_matches_beyond_the_old_truncation(self):
        builder = object.__new__(build.Builder)
        builder.cfg = {'build': {'basePath': '/blog'}}
        item = dict(title='A', url='/posts/a/', tags=[], summary='intro', date_text='', plain='开头' * 700 + '深处的搜索词')
        builder.posts = [item]
        builder.projects = []
        builder.docs = [dict(item, url='/docs/a/', collection_title='课程')]
        captured = {}
        builder.emit = lambda path, text: captured.update({path: text})
        builder.build_search()
        index = json.loads(captured['search-index.json'])
        self.assertTrue(all('深处的搜索词' in entry['text'] for entry in index))
        self.assertEqual(index[1]['t'], 'doc')
        self.assertEqual(index[1]['url'], '/blog/docs/a/')

    def test_home_latest_excludes_featured_and_orders_by_update(self):
        builder = object.__new__(build.Builder)
        builder.cfg = dict(home={'featuredCount': 1, 'latestCount': 5}, hero={'stats': []}, site={'description': ''})
        base = dict(date='2026-01-01', date_text='1月', updated='', updated_text='')
        builder.listed_posts = [dict(base, url='/a/', featured=True), dict(base, url='/b/'),
                                dict(base, url='/c/', updated='2026-10-01', updated_text='10月')]
        builder.projects = builder.all_tag_names = builder.archived_posts = []
        builder.base_ctx = lambda **kw: {}
        builder.tag_entries = lambda: []
        builder.emit = lambda *args: None
        class Engine:
            def render(self, template, ctx):
                self.ctx = ctx
                return ''
        builder.engine = Engine()
        builder.build_home()
        self.assertEqual([p['url'] for p in builder.engine.ctx['posts']], ['/c/', '/b/'])
        self.assertEqual(builder.engine.ctx['posts'][0]['activity_text'], '10月')


if __name__ == '__main__':
    unittest.main()
