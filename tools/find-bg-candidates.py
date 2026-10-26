#!/usr/bin/env python3
"""List Wallpaper Engine *video* wallpapers (mp4/webm) with real resolution + tags.

Scene-type wallpapers ship a .pkg/.json, not a video, so they are skipped:
tools/make-bg.py can only consume video sources.

Usage:
  python tools/find-bg-candidates.py --min-w 2560
  python tools/find-bg-candidates.py --grep city
  python tools/find-bg-candidates.py --sheet 3   # contact sheet of the top N
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

WE_LIB = Path(r"D:\SteamLibrary\steamapps\workshop\content\431960")
ROOT = Path(__file__).resolve().parent.parent
BG_DIR = ROOT / "assets" / "bg"
SHOTS = ROOT / "_shots"

VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv", ".avi"}
SKIP = re.compile(r"(porn|hentai|nsfw|nude|lewd|sex|r18|ecchi|futa|oppai)", re.I)


def ffmpeg() -> str:
    import imageio_ffmpeg  # noqa: PLC0415

    return imageio_ffmpeg.get_ffmpeg_exe()


def probe(path: Path, exe: str) -> tuple[int, int, float]:
    """imageio ships ffmpeg but not ffprobe; ffmpeg -i prints the stream header."""
    cmd = [exe, "-hide_banner", "-i", str(path)]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=40,
                             encoding="utf-8", errors="replace").stderr
    except Exception:
        return (0, 0, 0.0)
    m = re.search(r"Video:.*?,\s*(\d{2,5})x(\d{2,5})", out)
    if not m:
        return (0, 0, 0.0)
    d = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", out)
    dur = (int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3))) if d else 0.0
    return (int(m.group(1)), int(m.group(2)), dur)


def load_videos() -> list[dict]:
    items = []
    for pj in WE_LIB.glob("*/project.json"):
        try:
            meta = json.loads(pj.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        fname = str(meta.get("file") or "")
        if Path(fname).suffix.lower() not in VIDEO_EXT:
            continue
        src = pj.parent / fname
        if not src.is_file():
            continue
        title = str(meta.get("title") or "")
        tags = [str(t) for t in (meta.get("tags") or [])]
        if SKIP.search(" ".join([title, *tags])):
            continue
        items.append(
            {
                "id": pj.parent.name,
                "title": title,
                "tags": tags,
                "src": src,
                "ext": src.suffix.lower(),
                "mb": src.stat().st_size / 1048576,
            }
        )
    return items


def used() -> dict[str, str]:
    """workshop id -> theme id, from assets/bg/manifest.json"""
    man = BG_DIR / "manifest.json"
    out: dict[str, str] = {}
    if man.is_file():
        data = json.loads(man.read_text(encoding="utf-8"))
        for tid, rec in (data.get("items") or data).items():
            if isinstance(rec, dict) and rec.get("wid"):
                out[str(rec["wid"])] = tid
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-w", type=int, default=2560)
    ap.add_argument("--grep", default="")
    ap.add_argument("--sheet", type=int, default=0)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--tile", type=int, default=480)
    ap.add_argument("--out", default="bg-candidates.jpg")
    ap.add_argument("--skip", type=int, default=0)
    ap.add_argument("--ids", nargs="*", default=[])
    args = ap.parse_args()

    exe = ffmpeg()
    usedmap = used()
    print(f"# {len(usedmap)} ids already used by themes")
    rows = []
    for it in load_videos():
        w, h, d = probe(it["src"], exe)
        it["w"], it["h"], it["dur"] = w, h, d
        rows.append(it)
    rows = [r for r in rows if r["w"] >= args.min_w and r["h"] >= 1400]
    if args.grep:
        g = args.grep.lower()
        rows = [r for r in rows if g in (r["title"] + " " + " ".join(r["tags"])).lower()]
    if args.ids:
        rows = [r for r in rows if r["id"] in set(args.ids)]
    rows.sort(key=lambda r: -r["w"])
    for r in rows:
        mark = usedmap.get(r["id"], "")
        print(
            f"[{mark:8s}] {r['id']} {r['w']}x{r['h']} {r['dur']:5.1f}s {r['mb']:6.1f}MB "
            f"{r['title'][:46]:46s} | {','.join(r['tags'][:5])[:56]}"
        )
    print(f"# {len(rows)} candidates >= {args.min_w}px wide")

    if args.sheet and rows:
        SHOTS.mkdir(exist_ok=True)
        picks = rows[args.skip : args.skip + args.sheet]
        cols = max(1, min(args.cols, len(picks)))
        tw = args.tile
        th = int(tw * 9 / 16)
        lab = 24
        rowsn = (len(picks) + cols - 1) // cols
        from PIL import Image, ImageDraw  # noqa: PLC0415

        sheet = Image.new("RGB", (cols * tw, rowsn * (th + lab)), (14, 16, 22))
        d = ImageDraw.Draw(sheet)
        for i, r in enumerate(picks):
            cx, cy = (i % cols) * tw, (i // cols) * (th + lab)
            tmp = SHOTS / f"_tmp_{r['id']}.jpg"
            subprocess.run(
                [exe, "-v", "error", "-y", "-ss", "1.2", "-i", str(r["src"]),
                 "-frames:v", "1", "-vf", f"scale={tw}:{th}:force_original_aspect_ratio=increase,crop={tw}:{th}",
                 str(tmp)],
                capture_output=True,
            )
            if tmp.is_file():
                sheet.paste(Image.open(tmp).convert("RGB"), (cx, cy))
                tmp.unlink()
            d.text((cx + 5, cy + th + 5), f"{args.skip + i + 1}. {r['id']} {r['w']}x{r['h']} {r['title'][:26]}",
                   fill=(215, 225, 245))
        out = SHOTS / args.out
        sheet.save(out, quality=88)
        print(f"# sheet -> {out}  ({sheet.size[0]}x{sheet.size[1]}, {len(picks)} tiles)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
