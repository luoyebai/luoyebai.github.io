"""从构建产物反推主题配置（site.config.json 的 themes 段）并写回。

    python tools/restore-themes.py

来源：
  public/index.html  的 <script id="theme-meta"> 里有 name / nameEn / swatch / bg
   其中 swatch = [accent, accent2, darkBg]（构建时由种子色推导写入）
  public/assets/themes.css 里有每套主题浅色模式的 --bg（= lightBg 种子）
tintHue 按强调色的色相推算。
"""
import colorsys
import json
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "site.config.json")


def hex_to_hue(h: str) -> int:
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return int(colorsys.rgb_to_hsv(r, g, b)[0] * 360)


def main() -> int:
    idx = os.path.join(ROOT, "public", "index.html")
    css_path = os.path.join(ROOT, "public", "assets", "themes.css")
    if not (os.path.isfile(idx) and os.path.isfile(css_path)):
        print("找不到构建产物，先跑 python tools/build.py")
        return 1

    html = open(idx, encoding="utf-8").read()
    m = re.search(r'id="theme-meta">(.*?)</script>', html, re.S)
    if not m:
        print("index.html 里没有 theme-meta")
        return 1
    meta = json.loads(m.group(1))

    css = open(css_path, encoding="utf-8").read()
    light_bg = {}
    for tid in meta:
        mm = re.search(r'\[data-theme="' + re.escape(tid) + r'"\]\[data-mode="light"\]\{(.*?)\}',
                       css, re.S)
        if mm:
            d = dict(re.findall(r'--([a-z0-9-]+):\s*([^;]+);', mm.group(1)))
            if d.get("bg"):
                light_bg[tid] = d["bg"]

    themes = []
    for tid, info in meta.items():
        sw = info.get("swatch") or []
        accent = sw[0] if len(sw) > 0 else "#7aa2ff"
        accent2 = sw[1] if len(sw) > 1 else "#ff9d5c"
        dark_bg = sw[2] if len(sw) > 2 else "#0a0f1e"
        themes.append({
            "id": tid,
            "name": info.get("name") or tid,
            "nameEn": info.get("nameEn") or tid,
            "bg": info.get("bg") or f"assets/bg/{tid}.jpg",
            "swatch": [accent, accent2, dark_bg],
            "seeds": {
                "accent": accent,
                "accent2": accent2,
                "darkBg": dark_bg,
                "lightBg": light_bg.get(tid, "#f6f4f0"),
                "tintHue": hex_to_hue(accent),
            },
        })

    with open(CONFIG, encoding="utf-8") as fh:
        cfg = json.load(fh)
    cfg["themes"] = themes
    with open(CONFIG, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"  已恢复 {len(themes)} 套主题：")
    for t in themes:
        s = t["seeds"]
        print(f"    {t['id']:<9} {t['name']:<9} accent={s['accent']} accent2={s['accent2']} "
              f"dark={s['darkBg']} light={s['lightBg']} hue={s['tintHue']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
