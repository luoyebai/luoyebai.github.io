#!/usr/bin/env python3
"""亮色模式的「刺眼」体检：把每套主题的底色/卡片亮度与各档文字对比度列出来。

为什么需要它：`check-palette.py` 只保证「对比度不低于 4.5:1」，
但亮色真正的问题是**对比度过高**——纯白底 + 纯黑字能到 16:1，
数值上"更清楚"，实际是眩光，笔画会在亮底上晕开（衬线体尤其明显）。

这个脚本把关键指标摊开，方便一眼看出哪个主题偏亮：
    底色 / 卡片面的 WCAG 相对亮度（屏幕实际观感），以及 正文 / 次要 / 弱文字 的对比度。

    python tools/check-light.py
    python tools/check-light.py --json
"""
import json
import os
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import palette  # noqa: E402

# 目标区间：底色不超过这个亮度，卡片不超过那个；对比度落在区间里才叫舒服
MAX_BG_LUM = 88.0
MAX_CARD_LUM = 92.0
BODY_LO, BODY_HI = 8.0, 13.0
MIN_TEXT2, MIN_TEXT3 = 4.5, 4.5
# 书库里的书是「深色正文压在布面上」，不是玻璃卡片：
# 布面必须比卡片面明显暗一档（分得出是实物），但正文对比度不能掉到 7:1 以下。
MIN_BOOK_DELTA = 12.0        # 卡片面亮度% - 最亮布面亮度%
MIN_BOOK_CONTRAST = 7.0
BOOKS = 6


def main() -> int:
    if "--json" in sys.argv:
        cfg = json.load(open(os.path.join(ROOT, "site.config.json"), encoding="utf-8"))
        out = []
        for t in cfg["themes"]:
            d = palette.derive(t["seeds"])["light"]
            out.append({
                "id": t["id"], "bg": d["--bg"], "surface": d["--surface"],
                "bgLum": round(palette.luminance(d["--bg"]) * 100, 1),
                "cardLum": round(palette.luminance(d["--surface"]) * 100, 1),
                "body": round(palette.contrast(d["--text"], d["--surface"]), 2),
                "muted": round(palette.contrast(d["--text-2"], d["--surface"]), 2),
                "faint": round(palette.contrast(d["--text-3"], d["--surface"]), 2),
            })
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    cfg = json.load(open(os.path.join(ROOT, "site.config.json"), encoding="utf-8"))
    print("  %-9s %-9s%7s  %-9s%7s  %7s  %6s %6s %6s  %6s %6s"
          % ("主题", "底色", "亮度%", "卡片面", "亮度%", "卡片-底", "正文", "次要", "弱",
             "布-面", "布上正文"))
    print("  " + "-" * 90)
    bad = []
    for t in cfg["themes"]:
        d = palette.derive(t["seeds"])["light"]
        bg, s1 = d["--bg"], d["--surface"]
        bl, cl = palette.luminance(bg) * 100, palette.luminance(s1) * 100
        c1 = palette.contrast(d["--text"], s1)
        c2 = palette.contrast(d["--text-2"], s1)
        c3 = palette.contrast(d["--text-3"], s1)
        # 布面：取最亮的一本，最坏情况下的对比度和「离卡片面有多远」
        books = [d[f"--book-{i + 1}"] for i in range(BOOKS)]
        bk_lum = max(palette.luminance(b) for b in books) * 100
        bk_con = min(palette.contrast(d["--text"], b) for b in books)
        flags = []
        if bl > MAX_BG_LUM:
            flags.append("底色过亮")
        if cl > MAX_CARD_LUM:
            flags.append("卡片过亮")
        if c1 > BODY_HI:
            flags.append("正文对比过高")
        if c1 < BODY_LO:
            flags.append("正文对比不足")
        if c2 < MIN_TEXT2:
            flags.append("次要文字不足")
        if c3 < MIN_TEXT3:
            flags.append("弱文字不足")
        if bk_con < MIN_BOOK_CONTRAST:
            flags.append("布面上正文不足")
        if cl - bk_lum < MIN_BOOK_DELTA:
            flags.append("布面太浅")
        if flags:
            bad.append((t["id"], flags))
        print("  %-9s %-9s%7.1f  %-9s%7.1f  %7.1f  %6.2f %6.2f %6.2f  %6.1f %6.2f  %s"
              % (t["id"], bg, bl, s1, cl, cl - bl, c1, c2, c3,
                 cl - bk_lum, bk_con, "  ".join(flags)))
    print()
    if bad:
        print(f"  {len(bad)} 套主题有问题：")
        for tid, fl in bad:
            print(f"    {tid}: {'、'.join(fl)}")
        return 1
    print(f"  {len(cfg['themes'])} 套主题全部落在目标区间内"
          f"（底色 ≤{MAX_BG_LUM:.0f}%、卡片 ≤{MAX_CARD_LUM:.0f}%、"
          f"正文 {BODY_LO:.0f}~{BODY_HI:.0f}:1、"
          f"布面至少比卡片暗 {MIN_BOOK_DELTA:.0f}% 且正文 ≥{MIN_BOOK_CONTRAST:.0f}:1）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
