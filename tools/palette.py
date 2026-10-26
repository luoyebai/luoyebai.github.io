"""从主题种子色推导完整的 CSS 变量集（亮色 + 暗色），并校验对比度。

设计原则
--------
* 面板色相跟随种子的 tintHue，但饱和度压得很低，避免整页发脏。
* 强调色在暗色模式提亮、亮色模式压深，保证作为文字/按钮都够对比度。
* 背景图之上的面板必须足够不透明，否则文字会被图片细节干扰。
"""
from __future__ import annotations

import colorsys
import re

# ---------------------------------------------------------------- 颜色工具


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb) -> str:
    return "#%02x%02x%02x" % tuple(int(round(clamp(c / 255.0) * 255)) for c in rgb[:3])


def rgb_to_hls(rgb) -> tuple[float, float, float]:
    r, g, b = (c / 255.0 for c in rgb[:3])
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360.0, l, s


def hls_to_rgb(h: float, l: float, s: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, clamp(l), clamp(s))
    return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))


def adjust(color, *, h=None, l=None, s=None) -> str:
    """按 HLS 调整颜色分量（None 表示保持），返回 #rrggbb。"""
    hh, ll, ss = rgb_to_hls(hex_to_rgb(color) if isinstance(color, str) else color)
    return rgb_to_hex(hls_to_rgb(hh if h is None else h,
                                 ll if l is None else l,
                                 ss if s is None else s))


def hls(h: float, l: float, s: float) -> str:
    return rgb_to_hex(hls_to_rgb(h, l, s))


def mix(a, b, t: float):
    ra = hex_to_rgb(a) if isinstance(a, str) else a
    rb = hex_to_rgb(b) if isinstance(b, str) else b
    return tuple(ra[i] + (rb[i] - ra[i]) * t for i in range(3))


def rgb_triplet(color) -> str:
    """把颜色转成 "r, g, b" 形式，配合 rgba(var(--x), var(--alpha)) 使用。

    这样拆开的好处：主题只管**颜色**，透明度由外观面板的滑块用
    --glass-alpha 单独控制 —— 改透明度不需要重新推导整套配色。
    """
    r, g, b = hex_to_rgb(color) if isinstance(color, str) else color
    return f"{r:.0f}, {g:.0f}, {b:.0f}"


def _clamp_light(color: str, *, lo: float = None, hi: float = None) -> str:
    """把颜色按 HLS 亮度夹到区间内（色相、饱和度不动）。

    用来给亮色底色封顶：主题种子里那些接近纯白的 lightBg
    （paper #fbfcfc 亮度 97.2%、sketch #fbfbf9 96.3%）在屏幕上是眩光，
    必须统一压下来，否则「浅色刺眼」这件事会随着主题不同时好时坏。
    """
    h, l, s = rgb_to_hls(hex_to_rgb(color))
    if hi is not None:
        l = min(l, hi)
    if lo is not None:
        l = max(l, lo)
    return rgb_to_hex(hls_to_rgb(h, l, s))


def rgba(color, alpha: float) -> str:
    r, g, b = hex_to_rgb(color) if isinstance(color, str) else color
    return f"rgba({r:.0f}, {g:.0f}, {b:.0f}, {alpha:.3f})"


def _lin(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(color) -> float:
    r, g, b = hex_to_rgb(color) if isinstance(color, str) else color
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# 在保持色相的前提下，把前景色推到与背景达到目标对比度
def ensure_contrast(fg: str, bg: str, target: float, *, darken: bool) -> str:
    best = fg
    for step in range(0, 101):
        l = (step / 100.0)
        cand = adjust(fg, l=(1 - l) if darken else l)
        if contrast(cand, bg) >= target:
            best = cand
            break
        best = cand
    return best


def pick_text(bg: str, target: float, *, prefer_dark: bool, hue: float, sat: float) -> str:
    """选一个与 bg 达到 target 对比度的文本色，色相/饱和度可控。"""
    for i in range(0, 101):
        l = 0.04 + (i / 100.0) * 0.92
        cand = hls(hue, l, sat)
        if contrast(cand, bg) >= target:
            if prefer_dark:
                continue
            return cand
    return hls(hue, 0.97 if not prefer_dark else 0.06, sat)


# ---------------------------------------------------------------- 主题推导

SYNTAX_SLOTS = [
    ("keyword", 0.00, 0.82, 0.66),    # (名字, 相对 accent 色相偏移, 饱和度, 亮度基准)
    ("string", +42, 0.62, 0.62),
    ("number", -38, 0.68, 0.66),
    ("builtin", +150, 0.50, 0.68),
    ("function", +18, 0.66, 0.70),
    ("type", -18, 0.46, 0.74),
    ("variable", +78, 0.58, 0.66),
    ("macro", -70, 0.62, 0.68),
    ("preproc", +108, 0.50, 0.62),
    ("decorator", -108, 0.56, 0.70),
    ("tag", -18, 0.58, 0.68),
    ("attr", +30, 0.48, 0.70),
    ("key", +60, 0.52, 0.70),
]


def derive(seed: dict) -> dict:
    """返回 {'dark': {token: value}, 'light': {...}}"""
    accent = seed["accent"]
    accent2 = seed.get("accent2") or adjust(accent, h=rgb_to_hls(hex_to_rgb(accent))[0] + 40)
    tint = float(seed.get("tintHue", rgb_to_hls(hex_to_rgb(accent))[0]))
    sat_scale = float(seed.get("saturation", 1.0))
    dark_bg = seed.get("darkBg", "#0b0d14")
    light_bg = seed.get("lightBg", "#f7f7f5")

    out = {}

    # ---------------- 暗色 ----------------
    d_bg = dark_bg
    d_bg_soft = hls(tint, 0.085, 0.13 * sat_scale)
    d_s1 = hls(tint, 0.115, 0.15 * sat_scale)
    d_s2 = hls(tint, 0.155, 0.17 * sat_scale)
    d_s3 = hls(tint, 0.200, 0.19 * sat_scale)
    d_accent = ensure_contrast(accent, d_s1, 4.5, darken=False)
    d_accent2 = ensure_contrast(accent2, d_s1, 3.5, darken=False)
    d_text = hls(tint, 0.955, 0.05 * sat_scale)
    d_text2 = hls(tint, 0.760, 0.07 * sat_scale)
    d_text3 = hls(tint, 0.585, 0.08 * sat_scale)
    out["dark"] = {
        "--bg": d_bg,
        "--bg-soft": d_bg_soft,
        "--surface": d_s1,
        "--surface-2": d_s2,
        "--surface-3": d_s3,
        # 玻璃填充拆成「颜色 + 透明度」两段：颜色归主题，透明度归外观面板的滑块。
        # custom property 是延迟替换的，所以下面的 --glass-alpha 一变，
        # --surface-glass 会自动跟着变，不需要重算配色。
        "--surface-rgb": rgb_triplet(d_s1),
        "--glass-alpha": "0.720",
        "--surface-glass": "rgba(var(--surface-rgb), var(--glass-alpha))",
        "--surface-glass-strong": "rgba(var(--surface-rgb), calc(var(--glass-alpha) + 0.18))",
        "--text": d_text,
        "--text-2": d_text2,
        "--text-3": d_text3,
        "--accent": d_accent,
        "--accent-2": d_accent2,
        "--accent-soft": rgba(d_accent, 0.16),
        "--accent-softer": rgba(d_accent, 0.09),
        "--accent-contrast": hls(tint, 0.06, 0.30),
        "--border": rgba(d_text, 0.10),
        "--border-2": rgba(d_text, 0.18),
        "--ring": rgba(d_accent, 0.55),
        "--shadow-1": f"0 1px 2px {rgba(d_bg, 0.5)}",
        "--shadow-2": f"0 18px 40px -18px {rgba(d_bg, 0.85)}",
        # 玻璃材质：边缘镜面高光 + 内侧折射光晕。
        # iOS Liquid Glass 读起来像玻璃而不是磨砂塑料，靠的就是这种**有方向性**的高光：
        # 顶边最亮、两侧次之、底边最弱。模糊本身给不出这个信号。
        "--glass-spec-top": "rgba(255, 255, 255, 0.26)",
        "--glass-spec-side": "rgba(255, 255, 255, 0.11)",
        "--glass-spec-bottom": "rgba(255, 255, 255, 0.06)",
        "--glass-rim": rgba(d_text, 0.14),
        # 注意：--glass-blur / --glass-saturate 不在这里定义。
        # 它们是「玻璃质感」档位驱动的（见 effects.css），而档位规则的选择器是
        # html[data-glass="…"]（1 个属性），比这里 html[data-theme][data-mode]
        # （2 个属性）的优先级低 —— 放这里会把档位覆盖掉，四档就没反应了。
        "--glow-1": rgba(d_accent, 0.45),
        "--glow-2": rgba(d_accent2, 0.38),
        "--grad-1": f"linear-gradient(120deg, {d_accent} 0%, {d_accent2} 100%)",
        "--grad-2": f"linear-gradient(135deg, {rgba(d_accent, 0.22)} 0%, {rgba(d_accent2, 0.14)} 55%, transparent 100%)",
        "--grad-3": f"radial-gradient(60% 60% at 30% 20%, {rgba(d_accent, 0.30)} 0%, transparent 70%)",
        "--code-bg": rgba(hls(tint, 0.045, 0.14 * sat_scale), 0.92),
        "--scrim": d_bg,
        # 书口/书顶的纸色：比布面亮，但比正文暗，翻书的时候才像纸
        "--paper": hls(tint, 0.700, 0.11 * sat_scale),
        "--paper-2": hls(tint, 0.520, 0.13 * sat_scale),
        # 「文档」里那套幻灯片用的行内强调色。原站是 CSS 里的 `red { color: red }` 裸标签，
        # 但纯红/纯蓝在两套模式下总有一套读不清（纯蓝压深底只有 2:1）。
        # 保留「红就是红、蓝就是蓝」的语义，亮度交给 ensure_contrast 兜底。
        "--ink-red": ensure_contrast(hls(2, 0.640, 0.62), d_s1, 4.5, darken=False),
        "--ink-blue": ensure_contrast(hls(214, 0.660, 0.60), d_s1, 4.5, darken=False),
        "--ink-green": ensure_contrast(hls(146, 0.620, 0.56), d_s1, 4.5, darken=False),
        "--ink-amber": ensure_contrast(hls(38, 0.700, 0.58), d_s1, 4.5, darken=False),
    }
    out["dark"].update(_books(d_accent, d_text, dark=True, sat_scale=sat_scale))
    out["dark"].update(_syntax(d_accent, dark=True))

    # ---------------- 亮色 ----------------
    # 亮色最容易犯的错是「纯白底 + 纯黑字」：原来的 --surface 是 0.995（就是 #fefefe），
    # 正文对比度 15~16:1。数值上「更清楚」，实际是眩光 ——
    # 笔画在亮底上会晕开（衬线体尤其明显），盯久了反而发花。
    # 这里按三个可量化的目标重排：
    #   底色   WCAG 亮度 ≈ 82~86%
    #   卡片面 WCAG 亮度 ≈ 88~91%，且比底色亮一档（保持「玻璃浮在纸上」的关系）
    #   正文对比度压到 10~12:1，次要文字 ≥5.5:1，弱文字 ≥4.5:1
    # 注意 HLS 的 L 和 WCAG 的相对亮度不是一回事，下面的数字是 HLS 口径。
    l_bg = _clamp_light(light_bg, hi=0.915)
    lb = rgb_to_hls(hex_to_rgb(l_bg))[1]
    l_card = min(0.950, lb + 0.038)                 # 卡片：比页面底亮一档
    l_bg_soft = hls(tint, min(0.930, lb + 0.018), 0.10 * sat_scale)
    l_s1 = hls(tint, l_card, 0.030 * sat_scale)
    l_s2 = hls(tint, max(0.850, l_card - 0.030), 0.07 * sat_scale)
    l_s3 = hls(tint, max(0.800, l_card - 0.062), 0.10 * sat_scale)
    l_accent = ensure_contrast(accent, l_s1, 4.5, darken=True)
    l_accent2 = ensure_contrast(accent2, l_s1, 3.5, darken=True)
    # 文字用 ensure_contrast 兜底而不是写死亮度：它会从白色往下找**第一个**达标的亮度，
    # 也就是「刚好够、不会过分黑」。这样无论主题的 tintHue / saturation 怎么变，
    # 对比度都锁在目标值上（手调全局亮度时，paper / moonlit / lumen 总是差一点）。
    l_text = ensure_contrast(hls(tint, 0.195, 0.22 * sat_scale), l_s1, 10.5, darken=True)
    l_text2 = ensure_contrast(hls(tint, 0.360, 0.16 * sat_scale), l_s1, 5.6, darken=True)
    l_text3 = ensure_contrast(hls(tint, 0.415, 0.12 * sat_scale), l_s1, 4.6, darken=True)
    out["light"] = {
        "--bg": l_bg,
        "--bg-soft": l_bg_soft,
        "--surface": l_s1,
        "--surface-2": l_s2,
        "--surface-3": l_s3,
        # 亮色下玻璃本身更实一些，所以默认不透明度略高
        "--surface-rgb": rgb_triplet(l_s1),
        "--glass-alpha": "0.760",
        "--surface-glass": "rgba(var(--surface-rgb), var(--glass-alpha))",
        "--surface-glass-strong": "rgba(var(--surface-rgb), calc(var(--glass-alpha) + 0.18))",
        "--text": l_text,
        "--text-2": l_text2,
        "--text-3": l_text3,
        "--accent": l_accent,
        "--accent-2": l_accent2,
        "--accent-soft": rgba(l_accent, 0.14),
        "--accent-softer": rgba(l_accent, 0.07),
        "--accent-contrast": "#ffffff",
        "--border": rgba(l_text, 0.12),
        "--border-2": rgba(l_text, 0.20),
        "--ring": rgba(l_accent, 0.45),
        "--shadow-1": f"0 1px 2px {rgba(l_text, 0.08)}",
        "--shadow-2": f"0 18px 40px -20px {rgba(l_text, 0.28)}",
        # 亮色下顶边高光要接近纯白才看得出来，底边则用一点点暗色表示厚度
        "--glass-spec-top": "rgba(255, 255, 255, 0.95)",
        "--glass-spec-side": "rgba(255, 255, 255, 0.60)",
        "--glass-spec-bottom": rgba(l_text, 0.05),
        "--glass-rim": rgba(l_text, 0.10),
        "--glow-1": rgba(l_accent, 0.28),
        "--glow-2": rgba(l_accent2, 0.24),
        "--grad-1": f"linear-gradient(120deg, {l_accent} 0%, {l_accent2} 100%)",
        "--grad-2": f"linear-gradient(135deg, {rgba(l_accent, 0.16)} 0%, {rgba(l_accent2, 0.10)} 55%, transparent 100%)",
        "--grad-3": f"radial-gradient(60% 60% at 30% 20%, {rgba(l_accent, 0.20)} 0%, transparent 70%)",
        "--code-bg": rgba(hls(tint, 0.905, 0.30 * sat_scale), 0.9),
        # 壁纸之上那层纱的颜色。亮色下纱**不能**用 --bg：
        # 亮底色的亮度跟亮壁纸差不多（#efebe4 是 239，亮壁纸 246），
        # 拿它当纱等于没压 —— 纱越厚画面反而越亮。
        # 所以要往文字色偏一点点，做成一层浅灰纱，才真的能把壁纸压下去。
        "--scrim": rgb_to_hex(mix(l_s1, l_text, 0.22)),
        # 亮色下纸色要**比布面亮**才分得出「纸」与「布」
        "--paper": hls(tint, 0.930, 0.10 * sat_scale),
        "--paper-2": hls(tint, 0.800, 0.12 * sat_scale),
        "--ink-red": ensure_contrast(hls(2, 0.400, 0.52), l_s1, 4.5, darken=True),
        "--ink-blue": ensure_contrast(hls(214, 0.430, 0.50), l_s1, 4.5, darken=True),
        "--ink-green": ensure_contrast(hls(146, 0.400, 0.46), l_s1, 4.5, darken=True),
        "--ink-amber": ensure_contrast(hls(38, 0.470, 0.48), l_s1, 4.5, darken=True),
    }
    out["light"].update(_books(l_accent, l_text, dark=False, sat_scale=sat_scale))
    out["light"].update(_syntax(l_accent, dark=False))
    return out


# 「知识图谱」书架上每本书的布面颜色，共 6 种。
#
# 为什么由 palette 推导而不是在 CSS 里写死色相：主题换了整座书库要跟着换调子，
# 写死就脱节了。但也不能让书各走各的色相 —— 那样是彩虹货架，不像藏书楼。
# 所以：以主题强调色的色相为起点，向两侧铺开成**一条窄色带**，
# 再配一组固定的相对色相偏移（0 / ±58 / ±132 / 180 度），
# 保证任意主题下 6 本都分得开，又都还在这套配色的家族里。
#
# 亮度区间是硬约束，不是审美选择：
#   暗色布面必须够深，浅色正文压在 9:1 以上；
#   亮色布面必须够浅，深色正文压在 7:1 以上。
# tools/check-light.py 会把这两条当断言跑。
_BOOK_HUE = (0, 58, -58, 132, -132, 180)
# 布面亮度不是一个审美数字，是被**正文对比度**反解出来的，而且两个方向是反的：
#   暗色主题：正文浅、布面深 —— 布面越**亮**对比度越低，所以有一道上限；
#   亮色主题：正文深、布面浅 —— 布面越**暗**对比度越低，所以有一道下限。
# 先按目标对比度解出那道边界，再让 6 本从边界往「安全的一侧」铺开。
# 这样换主题、调正文色都不会让书上的字失守。
_BOOK_CONTRAST = {"dark": 10.5, "light": 7.5}
# 相对边界亮度的系数：暗色往下压，亮色往上抬
_BOOK_SPREAD = {
    "dark": (1.00, 0.72, 0.86, 0.55, 0.94, 0.78),
    "light": (1.00, 1.16, 1.07, 1.20, 1.00, 1.13),
}


def _hls_l_for_lum(h: float, s: float, target: float) -> float:
    """二分找 HLS 的 L，使颜色的 WCAG 相对亮度正好落在 target 上。"""
    lo, hi = 0.01, 0.99
    for _ in range(30):
        mid = (lo + hi) / 2
        if luminance(hls(h, mid, s)) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _books(accent: str, text: str, *, dark: bool, sat_scale: float) -> dict:
    h0 = rgb_to_hls(hex_to_rgb(accent))[0]
    mode = "dark" if dark else "light"
    ratio, fg = _BOOK_CONTRAST[mode], luminance(text)
    if dark:
        # 背景比正文暗：contrast = (fg+.05)/(bg+.05)，解出亮度上限
        edge = clamp((fg + 0.05) / ratio - 0.05, 0.004, 0.30)
        sat = (0.16, 0.20, 0.18, 0.15, 0.17, 0.12)
    else:
        # 背景比正文亮：contrast = (bg+.05)/(fg+.05)，解出亮度下限
        edge = clamp(ratio * (fg + 0.05) - 0.05, 0.30, 0.74)
        # 亮色下布面不能太浅：一开始用 L≈0.86 的粉彩色，书跟页面底几乎糊在一起，
        # 整排看过去像一排白卡片。现在亮度由上面的 edge 定，这里只管饱和度。
        sat = (0.30, 0.36, 0.32, 0.28, 0.34, 0.24)
    out = {}
    for i, off in enumerate(_BOOK_HUE):
        h = (h0 + off) % 360
        s = max(0.05, sat[i] * sat_scale)
        target = clamp(edge * _BOOK_SPREAD[mode][i], 0.006, 0.78)
        out[f"--book-{i + 1}"] = hls(h, _hls_l_for_lum(h, s, target), s)
    return out


def _syntax(accent: str, *, dark: bool) -> dict:
    base_h = rgb_to_hls(hex_to_rgb(accent))[0]
    base_l = 0.68 if dark else 0.42
    out = {}
    for name, dh, s, dl in SYNTAX_SLOTS:
        l = clamp(base_l + (dl - 0.66) * 0.9, 0.28 if not dark else 0.42, 0.9)
        out[f"--tok-{name}"] = hls(base_h + dh, l, clamp(s))
    out["--tok-comment"] = hls(base_h, (0.42 if dark else 0.52), 0.14)
    out["--tok-operator"] = hls(base_h, (0.60 if dark else 0.40), 0.22)
    out["--tok-punct"] = hls(base_h, (0.52 if dark else 0.46), 0.12)
    out["--tok-plain"] = "inherit"
    return out


# ---------------------------------------------------------------- 校验

KEY_PAIRS = [
    ("正文 / 卡片面", "--text", "--surface", 7.0),
    ("正文 / 次面", "--text", "--surface-2", 7.0),
    ("次级 / 卡片面", "--text-2", "--surface", 4.5),
    ("三级 / 卡片面", "--text-3", "--surface", 3.0),
    ("强调 / 卡片面", "--accent", "--surface", 4.5),
    ("强调上的字", "--accent-contrast", "--accent", 4.5),
]


def report(theme_id: str, tokens: dict, mode: str) -> list[str]:
    lines, warn = [], []
    for label, fg, bg, need in KEY_PAIRS:
        f, b = tokens.get(fg), tokens.get(bg)
        if not f or not b or f.startswith("rgba") or b.startswith("rgba"):
            continue
        # 面板本身半透明时，用底色近似合成
        ratio = contrast(f, b)
        flag = "OK " if ratio >= need else "低!"
        if ratio < need:
            warn.append(f"{theme_id}/{mode} {label} = {ratio:.2f} (需 {need})")
        lines.append(f"  {flag} {theme_id:<7} {mode:<5} {label:<14} {ratio:5.2f}")
    return lines + ([f"  !! {w}" for w in warn] if warn else [])


def css_block(selector: str, tokens: dict, indent: str = "  ") -> str:
    body = "\n".join(f"{indent}{k}: {v};" for k, v in tokens.items())
    return f"{selector} {{\n{body}\n}}"


HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


# --------------------------------------------------------------------------
# 从图片推导主题种子色（后台「主题管理」与 make-bg.py 共用）
# --------------------------------------------------------------------------
def suggest_seeds(im) -> dict:
    """给一张 PIL 图片，推荐一组可用的主题种子色。

    取色策略：按「彩度^1.4 × 明度 × 像素占比」找画面里最鲜明的两个**不同色相**
    作强调色，再取占比最高的暗色作深色底、整体提亮去饱和作浅色底。
    """
    import colorsys

    import numpy as np

    small = im.convert("RGB").resize((160, 90))
    q = small.quantize(colors=12, method=1).convert("RGB")   # 1 = MEDIANCUT
    arr = np.asarray(q).reshape(-1, 3).astype(float)
    uniq, counts = np.unique(arr.astype(int), axis=0, return_counts=True)
    order = np.argsort(-counts)

    def hsv(c):
        return colorsys.rgb_to_hsv(c[0] / 255, c[1] / 255, c[2] / 255)

    vivid = []
    for i in order:
        c = uniq[i]
        h, sat, v = hsv(c)
        if sat > 0.20 and 0.30 < v < 0.95:
            vivid.append((sat ** 1.4 * v * counts[i], c))
    vivid.sort(key=lambda t: -t[0])

    accents = []
    for _score, c in vivid:
        if all(min(abs(hsv(c)[0] - hsv(a)[0]), 1 - abs(hsv(c)[0] - hsv(a)[0])) > 0.07
               for a in accents):
            accents.append(c)
        if len(accents) >= 2:
            break
    fallbacks = ([122, 162, 255], [255, 157, 92])
    while len(accents) < 2:
        accents.append(np.array(fallbacks[len(accents)]))

    dark = None
    for i in order:
        c = uniq[i]
        if hsv(c)[2] < 0.30:
            dark = c
            break
    if dark is None:
        dark = np.asarray(small).reshape(-1, 3).mean(axis=0) * 0.24
    mean = np.asarray(small).reshape(-1, 3).mean(axis=0)
    light = mean * 0.20 + np.array([239, 237, 233]) * 0.80

    return {
        "accent": rgb_to_hex(accents[0]),
        "accent2": rgb_to_hex(accents[1]),
        "darkBg": rgb_to_hex(dark),
        "lightBg": rgb_to_hex(light),
        "tintHue": int(hsv(accents[0])[0] * 360),
    }
