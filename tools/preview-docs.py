#!/usr/bin/env python3
"""把 _shots/ 里的截图拼成 README 用的对照图（docs/preview*.jpg）。

前置：先跑 `python tools/shots.py`（主页各主题）与
`python tools/shot-404.py dusk:dark paper:light moonlit:dark lumen:light`。

    python tools/preview-docs.py
"""
import os
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

from PIL import Image, ImageDraw  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "_shots"
DOCS = ROOT / "docs"

HOME_ORDER = [
    ("home-dark", "暗色 · 暮色风车"),
    ("home-light", "亮色 · 暮色风车"),
    ("home-sakura", "樱色光爆"),
    ("home-neon", "霓虹机房"),
    ("home-mono", "黑白编辑"),
    ("home-alpine", "远山夜湖"),
    ("home-moonlit", "皎月水面"),
    ("home-comet", "彗星山晚"),
    ("home-lantern", "林间提灯"),
    ("home-sketch", "素描线稿"),
    ("home-manga", "漫画分格"),
    ("home-lumen", "暖灯夜色"),
    ("home-paper", "留白纸面"),
    ("home-cyber", "夜城投递"),
    ("home-void", "虚空龙息"),
    ("home-video", "动态视频背景"),
]

SHOT404 = [
    ("404-dusk-dark", "暮色 · 深色"),
    ("404-paper-light", "留白 · 浅色"),
    ("404-moonlit-dark", "皎月 · 深色"),
    ("404-lumen-light", "暖灯 · 浅色"),
]

SHOTGRAPH = [
    ("graph-shelf", "书架布局 · 悬停前"),
    ("graph-hover", "书架布局 · 悬停高亮关联"),
    ("graph-nebula", "星云布局 · 按标签聚拢"),
]

# 「文档」区与封面：截图由 probe-docs.py / probe-cover.py 产出
SHOTSLIDES = [
    ("docs-index", "文档总览 · 两个系列"),
    ("doc-slide", "幻灯片阅读器 · 逐页模式"),
    ("cover-hero-dark", "文章头图 · 深色"),
    ("cover-hero-light", "文章头图 · 浅色"),
]

# 等待加载：截图由 probe-loading.py 产出（它是把资源拖慢之后截的）
SHOTLOADING = [
    ("loading-graph", "3D 书库的启动遮罩"),
    ("loading-shim", "封面图的骨架屏"),
]


def sheet(pairs, out, cols, tile_w, crop_top, label=True, quality=88, ratio=(1440, 1200)):
    tiles = [(SHOTS / f"{n}.png", lab) for n, lab in pairs if (SHOTS / f"{n}.png").is_file()]
    if not tiles:
        print(f"  {out.name}: 没有可用截图")
        return False
    rw, rh = ratio
    ratio_v = rw / rh
    th = int(tile_w / ratio_v)
    lab_h = 22 if label else 0
    rows = (len(tiles) + cols - 1) // cols
    sheet_im = Image.new("RGB", (cols * tile_w, rows * (th + lab_h)), (11, 13, 19))
    d = ImageDraw.Draw(sheet_im)
    for i, (path, lab) in enumerate(tiles):
        im = Image.open(path).convert("RGB")
        if crop_top:
            im = im.crop((0, 0, im.width, min(im.height, int(im.width / ratio_v))))
        im = im.resize((tile_w, th), Image.LANCZOS)
        cx, cy = (i % cols) * tile_w, (i // cols) * (th + lab_h)
        sheet_im.paste(im, (cx, cy))
        if label:
            d.text((cx + 8, cy + th + 6), lab, fill=(206, 214, 232))
    sheet_im.save(out, quality=quality)
    print(f"  {out.relative_to(ROOT)}  {sheet_im.size[0]}x{sheet_im.size[1]}  "
          f"{out.stat().st_size // 1024} KB  ({len(tiles)} 格)")
    return True


def main() -> int:
    DOCS.mkdir(exist_ok=True)
    ok1 = sheet(HOME_ORDER, DOCS / "preview.jpg", 4, 470, True)
    ok2 = sheet(SHOT404, DOCS / "preview-404.jpg", 2, 700, True)
    ok3 = sheet(SHOTGRAPH, DOCS / "preview-graph.jpg", 2, 820, False,
                ratio=(1416, 1100))
    ok4 = sheet(SHOTSLIDES, DOCS / "preview-slides.jpg", 2, 820, False,
                ratio=(1416, 1000))
    ok5 = sheet(SHOTLOADING, DOCS / "preview-loading.jpg", 2, 700, True,
                ratio=(1416, 1008))
    return 0 if (ok1 and ok2 and ok3 and ok4 and ok5) else 1


if __name__ == "__main__":
    sys.exit(main())
