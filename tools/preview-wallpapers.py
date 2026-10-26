"""给候选壁纸抽帧做联系表，便于人工挑选。

    python tools/preview-wallpapers.py 1353794539 1850294968 ...
    python tools/preview-wallpapers.py --all        # 全部视频壁纸

输出 _shots/wallpaper-sheet.jpg，每格标注 workshop id 与标题。
"""
import json
import os
import sys

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WE = r"D:\SteamLibrary\steamapps\workshop\content\431960"
OUT_DIR = os.path.join(ROOT, "_shots")
VIDEO_EXT = (".mp4", ".webm", ".avi", ".mov", ".mkv")
CELL_W, CELL_H, COLS = 400, 225, 5


def find_video(folder):
    best, best_size = None, 0
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


def title_of(folder):
    pj = os.path.join(folder, "project.json")
    if os.path.isfile(pj):
        try:
            with open(pj, encoding="utf-8-sig") as fh:
                return (json.load(fh).get("title") or "").strip()
        except Exception:
            pass
    return ""


def grab(path, frac=0.3):
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


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if "--all" in sys.argv:
        args = [d for d in sorted(os.listdir(WE)) if os.path.isdir(os.path.join(WE, d))]
    if not args:
        print(__doc__)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    cells, labels = [], []
    for wid in args:
        folder = os.path.join(WE, wid)
        vid = find_video(folder)
        if not vid:
            continue
        try:
            im = grab(vid)
        except Exception as exc:
            print(f"  {wid} 抽帧失败: {exc}")
            continue
        # 统一裁成 16:9 并算平均色
        w, h = im.size
        ar = 16 / 9
        if w / h > ar:
            nw = int(h * ar)
            im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = int(w / ar)
            im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
        small = im.resize((CELL_W, CELL_H), Image.LANCZOS)
        arr = np.asarray(small).astype(float)
        avg = arr.reshape(-1, 3).mean(axis=0).astype(int)
        lum = int(0.2126 * avg[0] + 0.7152 * avg[1] + 0.0722 * avg[2])
        sat = int(arr.max(axis=2).mean() - arr.min(axis=2).mean())
        cells.append(small)
        labels.append((wid, title_of(folder)[:26], f"#{avg[0]:02x}{avg[1]:02x}{avg[2]:02x}",
                       f"亮度{lum}", f"饱和{sat}"))
        print(f"  {wid}  {labels[-1][1]:<28} {labels[-1][2]}  {labels[-1][3]} {labels[-1][4]}")

    if not cells:
        print("没有可用样本")
        return 1

    rows = (len(cells) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CELL_W, rows * (CELL_H + 40)), (14, 15, 20))
    d = ImageDraw.Draw(sheet)
    for i, im in enumerate(cells):
        x, y = (i % COLS) * CELL_W, (i // COLS) * (CELL_H + 40)
        sheet.paste(im, (x, y))
        wid, title, hexc, lum, sat = labels[i]
        d.text((x + 4, y + CELL_H + 3), f"{wid}  {hexc}  {lum} {sat}", fill=(200, 205, 220))
        d.text((x + 4, y + CELL_H + 19), title, fill=(150, 158, 178))
    out = os.path.join(OUT_DIR, "wallpaper-sheet.jpg")
    sheet.save(out, quality=82)
    print(f"\n  联系表: {out}  {sheet.size}  {os.path.getsize(out) // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
