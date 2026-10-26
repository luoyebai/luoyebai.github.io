"""从 Wallpaper Engine 视频壁纸生成站点用的静态背景图与 LQIP，并更新 manifest。

    python tools/make-bg.py <themeId> <workshopId> [抽帧位置 0~1]
    python tools/make-bg.py --from-config          # 按 site.config.json 的 bg 描述补全缺失项

产出：
    assets/bg/<themeId>.jpg    2560x1440 静态背景
    assets/bg/manifest.json    追加 file/wid/source/size/avg/lqip
同时会打印推荐的主题种子色（从画面主色推导），供人工确认后写进 site.config.json。
"""
import colorsys
import json
import os
import sys

import imageio.v2 as imageio
import numpy as np
from PIL import Image

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import palette  # noqa: E402  （复用同一套取色逻辑）
BG = os.path.join(ROOT, "assets", "bg")
MANIFEST = os.path.join(BG, "manifest.json")
CONFIG = os.path.join(ROOT, "site.config.json")
WE = r"D:\SteamLibrary\steamapps\workshop\content\431960"
VIDEO_EXT = (".mp4", ".webm", ".avi", ".mov", ".mkv")
W, H = 2560, 1440


def find_video(folder: str) -> str:
    best, best_size = "", 0
    for root, _d, files in os.walk(folder):
        for f in files:
            if os.path.splitext(f)[1].lower() in VIDEO_EXT:
                p = os.path.join(root, f)
                try:
                    sz = os.path.getsize(p)
                except OSError:
                    continue
                if sz > best_size:
                    best, best_size = p, sz
    return best


def grab(path: str, frac: float = 0.3) -> Image.Image:
    r = imageio.get_reader(path, "ffmpeg")
    try:
        meta = r.get_meta_data()
        dur = float(meta.get("duration") or 0)
        fps = float(meta.get("fps") or 24)
        target = max(1, int(dur * frac * fps)) if dur else 30
        frame = None
        for i, f in enumerate(r):
            frame = f
            if i >= target:
                break
        return Image.fromarray(np.asarray(frame)).convert("RGB")
    finally:
        r.close()


def crop169(im: Image.Image) -> Image.Image:
    w, h = im.size
    ar = 16 / 9
    if w / h > ar:
        nw = int(h * ar)
        return im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    nh = int(w / ar)
    return im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))


def lqip_data_uri(im: Image.Image, size=(24, 14), quality=42) -> str:
    import base64
    import io
    tiny = im.resize(size, Image.LANCZOS).filter(
        __import__("PIL.ImageFilter", fromlist=["GaussianBlur"]).GaussianBlur(0.6))
    buf = io.BytesIO()
    tiny.save(buf, "JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def hexof(rgb) -> str:
    return "#%02x%02x%02x" % tuple(int(max(0, min(255, c))) for c in rgb)


def build(theme_id: str, wid: str, frac: float = 0.3) -> dict:
    folder = os.path.join(WE, str(wid))
    if not os.path.isdir(folder):
        raise SystemExit(f"找不到壁纸目录：{folder}")
    vid = find_video(folder)
    if not vid:
        raise SystemExit(f"{wid} 里没有视频文件")

    im = crop169(grab(vid, frac)).resize((W, H), Image.LANCZOS)
    out = os.path.join(BG, f"{theme_id}.jpg")
    im.save(out, "JPEG", quality=86, optimize=True, progressive=True)

    arr = np.asarray(im.resize((64, 36))).astype(float)
    avg = arr.reshape(-1, 3).mean(axis=0).astype(int)

    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)
    manifest[theme_id] = {
        "file": f"assets/bg/{theme_id}.jpg",
        "wid": str(wid),
        "source": os.path.basename(vid),
        "size": [W, H],
        "kb": os.path.getsize(out) // 1024,
        "avg": hexof(avg),
        "lqip": lqip_data_uri(im),
    }
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    return manifest[theme_id]


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if len(args) < 2:
        print(__doc__)
        return 1
    theme_id, wid = args[0], args[1]
    frac = float(args[2]) if len(args) > 2 else 0.3

    info = build(theme_id, wid, frac)
    im = Image.open(os.path.join(BG, f"{theme_id}.jpg")).convert("RGB")
    seeds = palette.suggest_seeds(im)

    print(f"  {theme_id}: {info['kb']} KB  {W}x{H}  avg={info['avg']}")
    print(f"  源: {info['source']}")
    print(f"  推荐种子色: {json.dumps(seeds, ensure_ascii=False)}")
    print("  （自动取色只是起点，建议在后台「主题管理」里按画面观感微调）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
