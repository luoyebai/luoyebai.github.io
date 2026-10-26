"""把 Wallpaper Engine 的视频壁纸转码成网页背景用的短循环片（2560x1440 / 2K）。

    python tools/make-bg-video.py            # 全部视频类主题
    python tools/make-bg-video.py dusk neon  # 指定主题
    python tools/make-bg-video.py --crf 34   # 调整码率（默认 33）

输出 assets/bg/<theme>.mp4（无声 / 快启 / faststart / 5 秒循环），并更新 manifest.json。
manifest 里 kind == "photo" 的主题（静态大图合成的活壁纸）由 tools/make-bg-photo.py
负责，这里会自动跳过。
"""
import json
import os
import subprocess
import sys

import imageio.v2 as imageio

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = os.path.join(ROOT, "assets", "bg")
WE = r"D:\SteamLibrary\steamapps\workshop\content\431960"

DURATION = 5          # 目标片段长度（秒）—— 背景是循环播放，短一点更省流量
WIDTH, HEIGHT = 2560, 1440
CRF = 33
PRESET = "slow"


def probe_duration(path: str) -> float:
    try:
        r = imageio.get_reader(path, "ffmpeg")
        dur = float(r.get_meta_data().get("duration") or 0)
        r.close()
        return dur
    except Exception:
        return 0.0


def frame_std(ffmpeg: str, src: str, t: float) -> float:
    """取 src 在 t 秒处的一帧，返回亮度标准差。纯黑/纯色帧会接近 0。

    有些壁纸源在入点上是淡入的黑帧（paper 就是），直接拿它当循环起点，
    背景会先黑一下再亮起来。这里用来把入点往后挪开。
    """
    import io

    import numpy as np
    from PIL import Image

    cmd = [ffmpeg, "-v", "error", "-ss", f"{t:.2f}", "-i", src,
           "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=90).stdout
        if not out:
            return -1.0
        with Image.open(io.BytesIO(out)) as im:
            a = np.asarray(im.convert("L").resize((120, 68))).astype(float)
        return float(a.std())
    except Exception:
        return -1.0


def pick_start(ffmpeg: str, src: str, dur: float, take: float) -> tuple[float, float]:
    """挑一个不会落在空白帧上的入点。返回 (起点, 该帧的 σ)。"""
    start = max(0.0, (dur - take) * 0.25) if dur > 0 else 0.0
    if dur <= 0 or dur <= take:
        return 0.0, frame_std(ffmpeg, src, 0.0)
    limit = max(0.0, dur - take)
    s = frame_std(ffmpeg, src, start)
    tries = 0
    while s >= 0 and s < 3.0 and tries < 24:
        start += 0.5
        if start > limit:
            start = 0.0
            break
        s = frame_std(ffmpeg, src, start)
        tries += 1
    return start, s


def main() -> int:
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    with open(os.path.join(BG, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)

    argv = sys.argv[1:]
    crf = CRF
    only: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--crf":
            crf = int(argv[i + 1])
            i += 2
            continue
        if not a.startswith("-"):
            only.append(a)
        i += 1
    themes = only or list(manifest.keys())

    for theme in themes:
        info = manifest.get(theme)
        if not info:
            print(f"  {theme}: manifest 里没有记录")
            continue
        if info.get("kind") == "photo":
            print(f"  {theme:<8} 跳过（静态大图合成的活壁纸，用 make-bg-photo.py 重建）")
            continue
        wid, source = info.get("wid"), info.get("source")
        src = os.path.join(WE, str(wid), str(source))
        if not os.path.isfile(src):
            print(f"  {theme}: 源视频不存在 {src}")
            continue

        # 按源时长决定截取长度与起点：短视频整段用，长视频取中段；
        # 入点再避开淡入的黑帧，否则循环片会从一片黑开始。
        dur = probe_duration(src)
        take = min(DURATION, dur) if dur > 0 else DURATION
        start, s0 = pick_start(ffmpeg, src, dur, take)

        out = os.path.join(BG, f"{theme}.mp4")
        cmd = [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start:.2f}", "-i", src, "-t", f"{take:.2f}",
            "-an",
            "-vf", f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
                   f"crop={WIDTH}:{HEIGHT},fps=24",
            "-c:v", "libx264", "-preset", PRESET, "-crf", str(crf),
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "5.1",
            "-movflags", "+faststart",
            out,
        ]
        r = subprocess.run(cmd, capture_output=True, timeout=900)
        if r.returncode != 0 or not os.path.isfile(out) or os.path.getsize(out) < 4096:
            tail = r.stderr.decode("utf-8", "replace")[:300]
            print(f"  {theme}: 转码失败（源 {dur:.1f}s，取 {start:.1f}+{take:.1f}s） {tail}")
            if os.path.isfile(out):
                os.remove(out)
            continue

        kb = os.path.getsize(out) // 1024
        manifest[theme]["video"] = f"assets/bg/{theme}.mp4"
        manifest[theme]["video_kb"] = kb
        note = "" if s0 < 0 else f"  入点帧σ={s0:.1f}"
        if 0 <= s0 < 3.0:
            note += "（仍是低对比帧，源里可能缺素材）"
        print(f"  {theme:<8} {kb:>5} KB   源 {dur:>5.1f}s  "
              f"取 {start:.1f}s 起 {take:.1f}s{note}")

    with open(os.path.join(BG, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    total = sum(os.path.getsize(os.path.join(BG, f))
                for f in os.listdir(BG) if f.endswith(".mp4"))
    print(f"\n  视频总计 {total // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

