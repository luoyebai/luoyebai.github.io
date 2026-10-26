"""Check lesson structure, runnable examples, downloads and course numbering.

Requires Node for the browser-demo checks. Does not replace ROS, C/C++ or
OpenCV execution on the environments documented in the lessons.
"""
import ast
import json
from pathlib import Path
import re
import subprocess
import sys
import zipfile

from build import load_config, load_docs
import mdparse

ROOT = Path(__file__).resolve().parents[1]
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
docs, collections, missing = load_docs(load_config())
assert not missing, missing
for collection in collections:
    for position, doc in enumerate(collection['docs'], 1):
        assert doc['index'] == position, (doc['slug'], doc['index'], position)
        assert doc['sibling_count'] == len(collection['docs'])

extra_checks = {
    'mini-sh': r'''
if (JSON.stringify(tokenize('echo ""').tokens) !== '["echo",""]') throw Error('empty argument lost');
if (tokenize('echo "bad').error !== '引号未闭合') throw Error('unclosed quote accepted');
if (!tokenize('echo \\').error) throw Error('trailing escape accepted');
if (JSON.stringify(tokenize("echo 'a b'").tokens) !== '["echo","a b"]') throw Error('single quotes');
if (JSON.stringify(tokenize('echo a\\ b').tokens) !== '["echo","a b"]') throw Error('escaped space');
''',
    'ros-intro': "if (lines.length !== 6) throw Error('unsubscribe regression');",
    'ros-tools': "if (lines.length !== 4) throw Error('missing QoS cases');",
    'face-recognition': "if (Math.abs(cosine([1,2],[2,4])-1)>1e-12) throw Error('cosine'); let rejected=false; try{cosine([0],[1])}catch(e){rejected=true} if(!rejected) throw Error('zero vector accepted');",
}
counts = {'python_syntax': 0, 'python_run': 0, 'javascript_run': 0}
for doc in docs:
    text = (ROOT / doc['source']).read_text(encoding='utf-8')
    meta, body = mdparse.parse_front_matter(text)
    assert not re.search(r'\b(?:TODO|TBD|FIXME)\b|待更新|待补充', body, re.I), doc['slug']
    assert all(slide['title'] and slide['plain'].strip() for slide in doc['slides']), doc['slug']
    assert body.count('```') % 2 == 0, f"Unclosed fence: {doc['slug']}"
    for kind, code in re.findall(r'^```([^\n]*)\n(.*?)^```\s*$', body, re.M | re.S):
        if kind == 'python':
            ast.parse(code, filename=doc['slug'])
            counts['python_syntax'] += 1
            # Only standalone, dependency-free lesson examples, with no I/O.
            if doc['slug'] in {'what-is-programming', 'be-a-detective', 'python-first'}:
                if "average([]))" in code or 'from temperature import' in code:
                    continue  # intentional failing example / multi-file import
                exec(compile(code, doc['slug'], 'exec'), {'__name__': '__main__'})
                counts['python_run'] += 1
        elif kind == 'js run':
            script = 'const lines=[]; const demo={log:(...args)=>lines.push(args)};\n' + code
            script += '\n' + extra_checks.get(doc['slug'], '')
            completed = subprocess.run(['node', '-'], input=script, text=True,
                                       encoding='utf-8', capture_output=True, timeout=10)
            assert completed.returncode == 0, (doc['slug'], completed.stderr)
            counts['javascript_run'] += 1

sample = ROOT / 'assets/docs/camera-handeye-calibration/calibrate_camera.py'
ast.parse(sample.read_text(encoding='utf-8'), filename=str(sample))
starter = ROOT / 'assets/docs/cpp-build-packages/starter'
with zipfile.ZipFile(starter.parent / 'starter.zip') as archive:
    sources = {p.relative_to(starter).as_posix(): p.read_bytes() for p in starter.rglob('*') if p.is_file()}
    assert set(archive.namelist()) == set(sources), 'Starter ZIP file list differs'
    assert all(archive.read(name) == data for name, data in sources.items()), 'Starter ZIP is stale'

print(json.dumps({'docs': len(docs), 'slides': sum(d['slide_count'] for d in docs),
                  'collections': len(collections), **counts, 'starter_zip': 'verified'}, ensure_ascii=False))
