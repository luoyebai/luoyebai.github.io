"""扫描 Wallpaper Engine 库，列出可用作背景的候选壁纸。

    python tools/scan-wallpapers.py            # 列出全部
    python tools/scan-wallpapers.py --video    # 只列视频壁纸
"""
import json
import os
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

WE = r"D:\SteamLibrary\steamapps\workshop\content\431960"
VIDEO_EXT = (".mp4", ".webm", ".avi", ".mov", ".mkv")


def main() -> int:
    only_video = "--video" in sys.argv
    if not os.path.isdir(WE):
        print(f"找不到库目录：{WE}")
        return 1

    rows = []
    for wid in sorted(os.listdir(WE)):
        folder = os.path.join(WE, wid)
        if not os.path.isdir(folder):
            continue
        pj = os.path.join(folder, "project.json")
        title, wtype = "(无 project.json)", "?"
        if os.path.isfile(pj):
            try:
                with open(pj, encoding="utf-8-sig") as fh:
                    d = json.load(fh)
                title = d.get("title") or "(无标题)"
                wtype = d.get("type") or "?"
            except Exception as exc:
                title = f"(project.json 解析失败: {exc})"

        # 找最大的媒体文件
        best, best_size = None, 0
        for root, _dirs, files in os.walk(folder):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in VIDEO_EXT:
                    p = os.path.join(root, f)
                    try:
                        sz = os.path.getsize(p)
                    except OSError:
                        continue
                    if sz > best_size:
                        best, best_size = p, sz
        is_video = best is not None
        if only_video and not is_video:
            continue
        rows.append((wid, title, wtype, is_video, best_size,
                     os.path.relpath(best, folder) if best else ""))

    print(f"{'workshop id':<12}{'类型':<9}{'视频':<5}{'大小MB':>8}  标题")
    print("-" * 92)
    for wid, title, wtype, is_video, size, rel in rows:
        print(f"{wid:<12}{wtype:<9}{'是' if is_video else '否':<5}{size / 1048576:>8.1f}  {title}")
        if is_video and size > 40 * 1048576:
            print(f"{'':<12}{'':<9}{'':<5}{'':>8}  └ {rel}")
    print()
    print(f"共 {len(rows)} 个，其中视频壁纸 {sum(1 for r in rows if r[3])} 个")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
