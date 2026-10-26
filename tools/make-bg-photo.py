#!/usr/bin/env python3
"""给没有 2K 视频源的主题，用高分辨率静态壁纸原图（4K/6K/8K）生成
2560x1440 的"活壁纸"短片：缓慢推轨（Ken Burns）+ 多张原图交叉溶解，
并且正放一遍再倒放一遍，得到一个完全没有跳帧的无缝循环。

    python tools/make-bg-photo.py alpine 884307090/imgs/1.jpg 884307090/imgs/9.jpg
    python tools/make-bg-photo.py --anchor 0.6 lumen 2139400761/img/3.png 2139400761/img/6.png

图片路径相对 Wallpaper Engine 创意工坊目录，也可以给绝对路径。
产出 assets/bg/<theme>.mp4 与 <theme>.jpg，并更新 manifest.json。
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import palette  # noqa: E402

BG = ROOT / "assets" / "bg"
MANIFEST = BG / "manifest.json"
WE = Path(r"D:\SteamLibrary\steamapps\workshop\content\431960")

W, H = 2560, 1440
FPS = 24
PLATE_W = 3200           # 预缩放画布：留出 8% 推近余量，又比原图轻得多
SHOT_SECS = 1.7          # 每张原图的停留时间（秒）
XFADE_SECS = 0.75        # 交叉溶解时长（秒）
ZOOM = 0.075             # 推近幅度
CRF = 34
Image.MAX_IMAGE_PIXELS = 400_000_000


def resolve(spec: str) -> Path:
    p = Path(spec)
    if p.is_file():
        return p
    q = WE / spec.replace("\\", "/")
    if q.is_file():
        return q
    raise SystemExit(f"找不到图片：{spec}")


def crop169(im: Image.Image, anchor: float) -> Image.Image:
    w, h = im.size
    ar = 16 / 9
    if w / h > ar:
        nw = int(h * ar)
        left = int((w - nw) * 0.5)
        return im.crop((left, 0, left + nw, h))
    nh = int(w / ar)
    top = int((h - nh) * anchor)
    return im.crop((0, top, w, top + nh))


def make_plate(path: Path, anchor: float, soften: float = 0.0) -> Image.Image:
    with Image.open(path) as raw:
        im = raw.convert("RGB")
    im = crop169(im, anchor)
    im = im.resize((PLATE_W, int(PLATE_W * 9 / 16)), Image.LANCZOS)
    if soften > 0:
        # 去 sensor 噪点：背景本来就在毛玻璃和暗化之下，软化一点几乎看不出来，
        # 但能显著降低 x264 的码率（细节噪点是最贵的）
        im = im.filter(ImageFilter.GaussianBlur(soften))
    return im


def shot_frame(p: Image.Image, k: int, n: int, direction: int) -> Image.Image:
    """一张 plate 的第 k 帧（共 n 帧）：缓慢推近 + 轻微平移。"""
    pw, ph = p.size
    t = k / max(1, n - 1)
    e = t if direction > 0 else 1 - t            # 缓动参数
    z = 1.0 + ZOOM * e
    cw, ch = min(int(W * z), pw), min(int(H * z), ph)
    mx, my = pw - cw, ph - ch
    fx = 0.5 + 0.42 * (2 * e - 1) * direction
    fy = 0.5 + 0.22 * (2 * e - 1) * direction
    x = int(max(0, min(mx, mx * fx)))
    y = int(max(0, min(my, my * fy)))
    return p.crop((x, y, x + cw, y + ch)).resize((W, H), Image.LANCZOS)


class Reel:
    """把若干张 plate 组成一条可随机访问的帧时间线（交叉溶解）。"""

    def __init__(self, plates: list[Image.Image], n: int, fade: int) -> None:
        self.plates = plates
        self.n = n
        self.fade = fade
        self.step = n - fade                      # 每张图推进的输出帧数
        self.total = self.step * (len(plates) - 1) + n

    def frame(self, j: int) -> Image.Image:
        if len(self.plates) == 1:
            return shot_frame(self.plates[0], j, self.total, 1)
        i = min(j // self.step, len(self.plates) - 1)
        k = j - i * self.step
        cur = shot_frame(self.plates[i], k, self.n, 1 if i % 2 == 0 else -1)
        if i > 0 and k < self.fade:
            prev = shot_frame(self.plates[i - 1], self.n - self.fade + k, self.n,
                              1 if (i - 1) % 2 == 0 else -1)
            cur = Image.blend(prev, cur, (k + 1) / (self.fade + 1))
        return cur

    def loop_frames(self, pingpong: bool = True):
        for j in range(self.total):
            yield self.frame(j)
        if pingpong:
            for j in range(self.total - 2, 0, -1):
                yield self.frame(j)


def lqip_data_uri(im: Image.Image, size=(24, 14), quality=42) -> str:
    tiny = im.resize(size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    buf = io.BytesIO()
    tiny.save(buf, "JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def hexof(rgb) -> str:
    return "#%02x%02x%02x" % tuple(int(max(0, min(255, c))) for c in rgb)


def encode(frames, out: Path, crf: int, preset: str, threads: int) -> None:
    import imageio_ffmpeg  # noqa: PLC0415

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
        "-i", "-", "-an",
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
        "-threads", str(threads),
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "5.1",
        "-g", str(FPS * 2), "-movflags", "+faststart",
        str(out),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdin is not None
    try:
        for f in frames:
            proc.stdin.write(f.tobytes())
    except BrokenPipeError:
        pass
    finally:
        proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    if proc.wait() != 0 or not out.is_file() or out.stat().st_size < 4096:
        raise SystemExit(f"转码失败：{err[:400]}")


def workshop_id(path: Path) -> str:
    parts = path.parts
    if "431960" in parts:
        i = parts.index("431960")
        if i + 1 < len(parts):
            return parts[i + 1]
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("theme")
    ap.add_argument("images", nargs="+")
    ap.add_argument("--crf", type=int, default=CRF)
    ap.add_argument("--preset", default="slow")
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--anchor", type=float, default=0.55,
                    help="16:9 裁剪的垂直锚点：0.5 居中，越大越靠下")
    ap.add_argument("--anchors", default="", help="逐图锚点，逗号分隔")
    ap.add_argument("--shot-secs", type=float, default=SHOT_SECS)
    ap.add_argument("--fade-secs", type=float, default=XFADE_SECS)
    ap.add_argument("--one-way", action="store_true", help="不做倒放（会有循环跳帧）")
    ap.add_argument("--soften", type=float, default=0.6,
                    help="plate 预软化半径（去噪、降码率）")
    ap.add_argument("--no-video", action="store_true")
    args = ap.parse_args()

    paths = [resolve(s) for s in args.images]
    anchors = [float(x) for x in args.anchors.split(",")] if args.anchors else []
    plates = [make_plate(p, anchors[i] if i < len(anchors) else args.anchor, args.soften)
              for i, p in enumerate(paths)]

    BG.mkdir(parents=True, exist_ok=True)
    still = plates[0].resize((W, H), Image.LANCZOS)
    jpg = BG / f"{args.theme}.jpg"
    still.save(jpg, "JPEG", quality=88, optimize=True, progressive=True)

    arr = np.asarray(still.resize((64, 36))).astype(float)
    avg = arr.reshape(-1, 3).mean(axis=0).astype(int)

    n = max(4, int(args.shot_secs * FPS))
    fade = max(2, int(args.fade_secs * FPS))
    fade = min(fade, n - 2)
    reel = Reel(plates, n, fade)

    vkb = 0
    if not args.no_video:
        mp4 = BG / f"{args.theme}.mp4"
        encode(reel.loop_frames(not args.one_way), mp4, args.crf, args.preset, args.threads)
        vkb = mp4.stat().st_size // 1024

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.is_file() else {}
    rec = {
        "file": f"assets/bg/{args.theme}.jpg",
        "wid": workshop_id(paths[0]),
        "source": " + ".join(p.name for p in paths),
        "size": [W, H],
        "kb": jpg.stat().st_size // 1024,
        "avg": hexof(avg),
        "lqip": lqip_data_uri(still),
        "kind": "photo",
    }
    if vkb:
        rec["video"] = f"assets/bg/{args.theme}.mp4"
        rec["video_kb"] = vkb
    manifest[args.theme] = rec
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    seeds = palette.suggest_seeds(still)
    print(f"  {args.theme}: 静图 {rec['kb']} KB / 视频 {vkb} KB  {W}x{H}  avg={rec['avg']}")
    print(f"  源: {rec['source']}  (wid={rec['wid']}, 时间线 {reel.total} 帧)")
    print(f"  推荐种子色: {json.dumps(seeds, ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
