"""MuJoCo authoring, deployment-prefix, preview and lazy-resource regressions.

Only fixture directories are written; this never builds or edits public/.
"""
import copy
import json
import re
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import urlopen

import admin
import build
import mdparse


FENCE = "```mujoco ankle\n```"


class PreviewRequest(admin.Handler):
    def __init__(self):
        self.result = None
        self.status = None

    def json_out(self, result, status=200):
        self.result, self.status = result, status


class MujocoEmbedTests(unittest.TestCase):
    def test_scene_is_a_lazy_panel_with_a_working_no_script_link(self):
        rendered, toc = mdparse.render("## 测试\n\n" + FENCE, source_map=True)
        self.assertIn('data-mujoco-tool="ankle"', rendered)
        self.assertIn('data-mujoco-load', rendered)
        self.assertIn('href="/lab/ankle/" data-mujoco-link', rendered)
        self.assertIn('data-source-line="3"', rendered)
        self.assertNotIn('<iframe', rendered)
        self.assertNotIn('<script', rendered)
        self.assertNotIn('mujoco.wasm', rendered)
        self.assertEqual(toc[0]['text'], '测试')

    def test_invalid_scene_never_becomes_a_url_or_markup(self):
        for scene in ('', '../private', 'https://evil.test/', 'ankle extra', '<img src=x onerror=alert(1)>'):
            with self.subTest(scene=scene):
                rendered, _ = mdparse.render('```mujoco ' + scene + '\n```')
                self.assertIn('未知 MuJoCo 场景', rendered)
                self.assertNotIn('data-mujoco-load', rendered)
                self.assertNotIn('<img', rendered)
                self.assertNotIn('evil.test', rendered)

    def test_container_and_example_fences_have_distinct_meaning(self):
        nested, _ = mdparse.render('::: note 实验\n' + FENCE + '\n:::')
        nested = mdparse.mujoco_tool_links(nested, '/notes')
        self.assertIn('href="/notes/lab/ankle/" data-mujoco-link', nested)
        quoted, _ = mdparse.render('> ```mujoco ankle\n> ```')
        self.assertIn('data-mujoco-tool="ankle"', quoted)
        example, _ = mdparse.render('````markdown\n' + FENCE + '\n````')
        self.assertIn('class="code-block"', example)
        self.assertNotIn('data-mujoco-tool="ankle"', example)

    def test_engine_fence_never_inflates_reading_time_or_summary(self):
        prose = '阅读' * 500
        executable = '```mujoco ankle\n' + 'runtimeInternal ' * 4000 + '\n```'
        self.assertEqual(build.reading_time(prose + '\n\n' + executable), build.reading_time(prose))
        self.assertNotIn('runtimeInternal', mdparse.to_text(prose + '\n\n' + executable))
        self.assertGreater(build.reading_time(prose + '\n\n```python\n' + 'algorithm ' * 1000 + '\n```'), build.reading_time(prose))

    def fixture_content(self, root, aliases='', slug='parallel-demo'):
        content = Path(root, 'content')
        for kind in ('posts', 'projects', 'pages', 'docs'):
            (content / kind).mkdir(parents=True, exist_ok=True)
        Path(content, 'posts/demo.md').write_text(
            '---\ntitle: Demo\nslug: ' + slug + '\ndate: 2026-10-02\n' + aliases + '\n---\n\n' + FENCE + '\n', encoding='utf-8')
        Path(content, 'docs/demo.md').write_text('---\ntitle: Demo deck\nslug: demo\n---\n\n# Example\n\n' + FENCE, encoding='utf-8')
        return content

    def test_collection_and_deck_links_use_the_deployment_prefix(self):
        with tempfile.TemporaryDirectory() as root:
            content = self.fixture_content(root)
            for prefix in ('', '/blog', '/blog/'):
                cfg = build.load_config()
                cfg['build']['basePath'] = prefix
                with patch.object(build, 'CONTENT', str(content)):
                    post = build.load_collection('posts', cfg)[0]
                    docs = build.load_docs(cfg)[0]
                expected = 'href="' + prefix.rstrip('/') + '/lab/ankle/" data-mujoco-link'
                self.assertIn(expected, post['html'])
                self.assertIn(expected, docs[0]['slides'][0]['html'])

    def test_lab_article_links_get_prefix_without_mutating_demo_source(self):
        source = ('<a href="/lab/ankle/">Tool</a><a href="/posts/parallel-ankle-kinematics/#formula">Article</a>'
                  '<a href="#local">Local</a><a href="//cdn.example/a">CDN</a><a href="https://example.test/">Web</a>'
                  '<script type="application/json">"<a href=\'/lab/ankle/\'>example</a>"</script>'
                  '<pre>&lt;a href="/lab/ankle/"&gt;example&lt;/a&gt;</pre>')
        changed = build.prefix_content_links(source, '/blog')
        self.assertIn('href="/blog/lab/ankle/"', changed)
        self.assertIn('href="/blog/posts/parallel-ankle-kinematics/#formula"', changed)
        for unchanged in ('href="#local"', 'href="//cdn.example/a"', 'href="https://example.test/"',
                          '<a href=\'/lab/ankle/\'>example</a>', '&lt;a href="/lab/ankle/"&gt;'):
            self.assertIn(unchanged, changed)
        self.assertEqual(changed, build.prefix_content_links(changed, '/blog'))

    def test_tool_route_and_sitemap_render_without_building_the_whole_site(self):
        with tempfile.TemporaryDirectory() as root:
            content = self.fixture_content(root)
            cfg = build.load_config()
            cfg['site']['url'] = 'https://example.test'
            cfg['build']['basePath'] = '/blog'
            with patch.object(build, 'CONTENT', str(content)):
                builder = build.Builder(cfg)
            builder.out = str(Path(root, 'output'))
            builder.build_tools()
            builder._emit_sitemap(cfg)
            result = Path(builder.out, 'lab/ankle/index.html').read_text(encoding='utf-8')
            self.assertIn('href="/blog/assets/tools/ankle/lab.css?v=' + builder.asset_version, result)
            self.assertIn('src="/blog/assets/tools/ankle/app.js?v=' + builder.asset_version, result)
            # Version the complete relative module graph, not just app.js: a warm
            # browser cache must not mix a new UI with an old controller API.
            imports = json.loads(re.search(r'<script type="importmap">(.*?)</script>', result, re.S).group(1))['imports']
            for name in ('ankle-model', 'ankle-math', 'simulation', 'comparison', 'mujoco-engine', 'renderer'):
                path = '/blog/assets/tools/ankle/' + name + '.js'
                self.assertEqual(imports[path], path + '?v=' + builder.asset_version)
            self.assertIn('href="https://example.test/blog/lab/ankle/"', result)
            self.assertIn('https://example.test/blog/lab/ankle/', Path(builder.out, 'sitemap.xml').read_text())
            self.assertIn('LimX HU-D04', result)

    def test_tool_route_cannot_be_overwritten_by_content_alias(self):
        with tempfile.TemporaryDirectory() as root:
            content = self.fixture_content(root, aliases='aliases: [/lab/ankle/]')
            with patch.object(build, 'CONTENT', str(content)), self.assertRaisesRegex(ValueError, '冲突'):
                build.Builder(build.load_config())

    def test_admin_preview_links_use_public_port_and_the_same_markup(self):
        for prefix in ('', '/blog'):
            for kind in ('post', 'doc'):
                with self.subTest(prefix=prefix, kind=kind):
                    cfg = build.load_config()
                    cfg['build']['basePath'] = prefix
                    request = PreviewRequest()
                    with patch.object(admin, 'load_config', return_value=cfg), patch.object(admin, '_site_port', 4201), \
                         patch.object(admin, 'Builder', side_effect=AssertionError('preview must not build')), \
                         patch.object(admin, 'atomic_write', side_effect=AssertionError('preview must not save')):
                        request.api_preview({'body': FENCE, 'kind': kind})
                    self.assertEqual(request.status, 200)
                    result = request.result
                    rendered = result['slides'][0]['html'] if kind == 'doc' else result['html']
                    self.assertIn('href="http://127.0.0.1:4201' + prefix + '/lab/ankle/" data-mujoco-link', rendered)
                    self.assertNotIn('4200', rendered)
                    self.assertIn('data-mujoco-load', rendered)
                    self.assertTrue(any('/runtime/mujoco-embed.js?' in url for url in result['previewAssets']['scripts']))

    def test_tool_code_and_model_changes_invalidate_asset_version(self):
        with tempfile.TemporaryDirectory() as root:
            static = Path(root, 'theme/static')
            for name in ('css', 'js'):
                (static / name).mkdir(parents=True)
            directory = Path(root, 'assets/tools/ankle/limx')
            directory.mkdir(parents=True)
            cfg = {'build': {'basePath': ''}}
            with patch.object(build, 'ROOT', root), patch.object(build, 'STATIC', str(static)):
                previous = build.asset_version(cfg)
                for suffix in ('js', 'css', 'json', 'xml'):
                    fixture = directory / ('test.' + suffix)
                    fixture.write_text('first fixture', encoding='utf-8')
                    changed = build.asset_version(cfg)
                    self.assertNotEqual(previous, changed, suffix)
                    fixture.write_text('updated fixture', encoding='utf-8')
                    self.assertNotEqual(changed, build.asset_version(cfg), suffix)
                    previous = build.asset_version(cfg)
                self.assertEqual(previous, build.asset_version(copy.deepcopy(cfg)))

    def test_static_copy_preserves_tool_modules_models_and_license(self):
        with tempfile.TemporaryDirectory() as root:
            fixture_files = ('app.js', 'ankle-math.js', 'limx/descriptor.json', 'limx/model.xml', 'limx/LICENSE')
            for rel in fixture_files:
                path = Path(root, 'assets/tools/ankle', rel)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('fixture ' + rel, encoding='utf-8')
            builder = object.__new__(build.Builder)
            builder.cfg = {'site': {}, 'themes': [], 'build': {}}
            builder.out = str(Path(root, 'output'))
            builder.themes_css = ''
            builder.written = []
            builder.posts = builder.projects = builder.pages = builder.docs = builder.doc_collections = []
            with patch.object(build, 'ROOT', root):
                builder.copy_static()
            for rel in fixture_files:
                self.assertEqual(Path(builder.out, 'assets/tools/ankle', rel).read_text(encoding='utf-8'), 'fixture ' + rel)

    def test_preview_server_supports_prefix_and_only_public_tool_cors(self):
        with tempfile.TemporaryDirectory() as root:
            for rel in ('lab/ankle/index.html', 'assets/tools/ankle/app.js', 'assets/vendor/mujoco/mujoco.wasm',
                        'assets/vendor/three/three.module.min.js', 'assets/other.json'):
                path = Path(root, rel)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'fixture')
            cfg = {'build': {'basePath': '/blog'}}
            with patch.object(admin, 'PUBLIC_DIR', root), patch.object(admin, 'load_config', return_value=cfg):
                server = admin.QuietThreadingHTTPServer(('127.0.0.1', 0), admin.SiteHandler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    origin = 'http://127.0.0.1:' + str(server.server_port)
                    with urlopen(origin + '/blog/lab/ankle/', timeout=5) as response:
                        self.assertEqual(response.read(), b'fixture')
                        self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
                    for rel in ('assets/tools/ankle/app.js?v=123', 'assets/vendor/mujoco/mujoco.wasm', 'assets/vendor/three/three.module.min.js'):
                        with urlopen(origin + '/blog/' + rel, timeout=5) as response:
                            self.assertEqual(response.read(), b'fixture')
                            self.assertEqual(response.headers.get('Access-Control-Allow-Origin'), '*')
                    with urlopen(origin + '/blog/assets/other.json', timeout=5) as response:
                        self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
                    with urlopen(origin + '/blog/assets/tools/ankle/%2e%2e/%2e%2e/other.json', timeout=5) as response:
                        self.assertEqual(response.read(), b'fixture')
                        self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
