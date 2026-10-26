"""把 KaTeX 下载到 assets/vendor/katex/，让公式渲染不依赖 CDN。

用法: python tools/fetch-katex.py [版本]
"""
import os
import re
import sys
import urllib.request

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = sys.argv[1] if len(sys.argv) > 1 else "0.16.11"
BASE = f"https://cdn.jsdelivr.net/npm/katex@{VERSION}/dist"
DEST = os.path.join(ROOT, "assets", "vendor", "katex")
os.makedirs(os.path.join(DEST, "fonts"), exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0 (blog-build)"}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


print(f"KaTeX {VERSION} -> {DEST}")

for name in ("katex.min.js", "katex.min.css"):
    data = get(f"{BASE}/{name}")
    with open(os.path.join(DEST, name), "wb") as fh:
        fh.write(data)
    print(f"  {name:<18} {len(data)//1024:>4} KB")

css_path = os.path.join(DEST, "katex.min.css")
css = open(css_path, encoding="utf-8").read()

fonts = sorted(set(re.findall(r"url\(([^)]+\.woff2)\)", css)))
print(f"  引用字体 {len(fonts)} 个")
ok = 0
for rel in fonts:
    fn = os.path.basename(rel.strip("'\""))
    try:
        data = get(f"{BASE}/fonts/{fn}")
        with open(os.path.join(DEST, "fonts", fn), "wb") as fh:
            fh.write(data)
        ok += 1
    except Exception as exc:
        print(f"    !! {fn}: {exc}")

# 字体路径改为相对 fonts/
css = re.sub(r"url\(([^)]*?)fonts/([A-Za-z0-9_\-]+\.woff2)\)", r"url(fonts/\2)", css)
css = re.sub(r"url\(([^)]*?)([A-Za-z0-9_\-]+\.woff2)\)", r"url(fonts/\2)", css)
with open(css_path, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(css)

total = sum(os.path.getsize(os.path.join(r, f))
            for r, _d, fs in os.walk(DEST) for f in fs)
print(f"  字体成功 {ok}/{len(fonts)}，总体积 {total//1024} KB")
