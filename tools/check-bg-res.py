#!/usr/bin/env python3
"""核查每套主题背景的**素材原生分辨率**，以及最终输出是不是 2560x1440。

`kind: "video"` 的主题看源视频；`kind: "photo"` 的主题看那几张高分辨率原图
（由 tools/make-bg-photo.py 合成，见 manifest 的 `source` 字段）。

    python tools/check-bg-res.py
    python tools/check-bg-res.py --out          # 顺带核对 assets/bg/*.mp4 的实际分辨率
"""
import json
import os
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import imageio.v2 as imageio      # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = os.path.join(ROOT, "assets", "bg")
WE = r"D:\SteamLibrary\steamapps\workshop\content\431960"
VIDEO_EXT = (".mp4", ".webm", ".avi", ".mov", ".mkv")
WANT = (2560, 1440)


def find_video(folder):
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


def find_source(folder, name):
    for root, _d, files in os.walk(folder):
        for f in files:
            if f == name:
                return os.path.join(root, f)
    return ""


def video_meta(path):
    try:
        r = imageio.get_reader(path, "ffmpeg")
        m = r.get_meta_data()
        r.close()
        w, h = m.get("size", (0, 0))
        return f"{w}x{h}", round(float(m.get("fps") or 0), 1), round(float(m.get("duration") or 0), 1)
    except Exception as exc:  # noqa: BLE001
        return f"读取失败({type(exc).__name__})", "?", "?"


def image_size(path):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 400_000_000
    try:
        with Image.open(path) as im:
            return f"{im.width}x{im.height}"
    except Exception as exc:  # noqa: BLE001
        return f"读取失败({type(exc).__name__})"


def out_size(tid):
    p = os.path.join(BG, f"{tid}.mp4")
    if not os.path.isfile(p):
        return "-"
    try:
        r = imageio.get_reader(p, "ffmpeg")
        m = r.get_meta_data()
        r.close()
        w, h = m.get("size", (0, 0))
        return f"{w}x{h}" + ("" if (w, h) == WANT else "  ← 不是 2560x1440")
    except Exception:  # noqa: BLE001
        return "读取失败"


def main() -> int:
    with open(os.path.join(BG, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)

    check_out = "--out" in sys.argv
    print(f"  {'主题':<9}{'类型':<7}{'素材源':<34}{'原生分辨率':<13}{'时长s':<8}{'输出KB':<8}")
    print("  " + "-" * 82)
    low, small, rows = [], [], 0
    for tid, info in manifest.items():
        kind = info.get("kind", "video")
        wid = str(info.get("wid", ""))
        folder = os.path.join(WE, wid) if wid else ""
        src_name = str(info.get("source", ""))
        if kind == "photo":
            parts = [p.strip() for p in src_name.split("+")]
            found = [find_source(folder, p) for p in parts] if folder else []
            sizes = [image_size(f) for f in found if f] or ["未找到"]
            best = " / ".join(sizes)
            res = sizes[0]
            dur, fps = "静图合成", "-"
        else:
            vid = find_video(folder) if folder else ""
            if not vid:
                res, fps, dur = "未找到", "?", "?"
            else:
                res, fps, dur = video_meta(vid)
            best = src_name or "(未知)"
        kb = info.get("video_kb", 0)
        rows += 1

        flag = ""
        try:
            w = int(str(res).split("x")[0])
            if w < 2560:
                flag = "  ← 源不足 2K"
                low.append(tid)
        except ValueError:
            flag = "  ← 读不到"
            low.append(tid)
        o = out_size(tid) if check_out else ""
        if o and "不是" in o:
            small.append(tid)
        print(f"  {tid:<9}{kind:<7}{best[:32]:<34}{res:<13}{str(dur):<8}{kb:<8}{flag}"
              + (f"   [{o}]" if o else ""))

    print()
    print(f"  共 {rows} 套；素材原生不足 2K 的 {len(low)} 套：{low or '无'}")
    if check_out:
        print(f"  输出不是 2560x1440 的：{small or '无'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
