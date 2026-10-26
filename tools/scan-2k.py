"""列出 Wallpaper Engine 库里分辨率 ≥ 2K 的视频壁纸，供挑选替代素材。

    python tools/scan-2k.py            # 只列 ≥2560 宽的
    python tools/scan-2k.py --all      # 列全部并标出分辨率
"""
import json
import os
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import imageio.v2 as imageio      # noqa: E402

WE = r"D:\SteamLibrary\steamapps\workshop\content\431960"
VIDEO_EXT = (".mp4", ".webm", ".avi", ".mov", ".mkv")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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


def title_of(folder):
    pj = os.path.join(folder, "project.json")
    if os.path.isfile(pj):
        try:
            with open(pj, encoding="utf-8-sig") as fh:
                return (json.load(fh).get("title") or "").strip()
        except Exception:
            pass
    return ""


def main() -> int:
    show_all = "--all" in sys.argv
    # 已在用的 wid 就不再列（避免重复挑到同一个）
    used = set()
    mpath = os.path.join(ROOT, "assets", "bg", "manifest.json")
    if os.path.isfile(mpath):
        with open(mpath, encoding="utf-8") as fh:
            used = {str(v.get("wid")) for v in json.load(fh).values()}

    rows = []
    for wid in sorted(os.listdir(WE)):
        folder = os.path.join(WE, wid)
        if not os.path.isdir(folder):
            continue
        vid = find_video(folder)
        if not vid:
            continue
        try:
            r = imageio.get_reader(vid, "ffmpeg")
            m = r.get_meta_data()
            w, h = m.get("size", (0, 0))
            fps = float(m.get("fps") or 0)
            dur = float(m.get("duration") or 0)
            r.close()
        except Exception:
            continue
        if not show_all and w < 2560:
            continue
        rows.append((wid, w, h, fps, dur, title_of(folder), wid in used))

    rows.sort(key=lambda x: (-x[1] * x[2], x[5]))
    print(f"  {'workshop id':<12}{'分辨率':<12}{'fps':<6}{'时长':<8}{'在用':<5}标题")
    print("  " + "-" * 88)
    for wid, w, h, fps, dur, title, inuse in rows:
        print(f"  {wid:<12}{f'{w}x{h}':<12}{fps:<6.0f}{dur:<8.0f}{'是' if inuse else '':<5}{title[:38]}")
    print()
    print(f"  共 {len(rows)} 个 ≥2K 的视频壁纸（其中 {sum(1 for r in rows if not r[6])} 个未在用）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
