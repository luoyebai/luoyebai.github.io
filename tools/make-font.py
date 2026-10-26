"""把本机字体子集化并打包成站点可用的 Web 字体。

    python tools/make-font.py            # 默认打包 Fira Code Nerd Font（代码/数学用）

为什么要子集化：FiraCode Nerd Font 原始 TTF 有 2.5 MB / 12415 个字形，
其中绝大多数是 Nerd Font 的图标字形（PUA 区），博客代码块根本用不到。
只保留拉丁字母、标点、数学符号、箭头、制表符等常用区段后体积会小一个数量级。

注意：宋体 / 黑体是微软授权字体，**不能随站点分发**，所以只以本地字体名引用，
不在这里打包。这里只处理开源（SIL OFL）的 Fira Code。
"""
import os
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "vendor", "fonts")
USER_FONTS = os.path.expanduser(r"~\AppData\Local\Microsoft\Windows\Fonts")
SYS_FONTS = r"C:\Windows\Fonts"

# 代码/数学常用区段（不含 Nerd Font 图标 PUA）
CORE_RANGES = ",".join([
    "U+0020-007E",   # 基本拉丁
    "U+00A0-00FF",   # 拉丁-1 补充
    "U+0100-017F",   # 拉丁扩展 A
    "U+0180-024F",   # 拉丁扩展 B
    "U+02B0-02FF",   # 修饰字母
    "U+0300-036F",   # 组合附加符号
    "U+0370-03FF",   # 希腊字母（数学常用）
    "U+2000-206F",   # 常用标点
    "U+2070-209F",   # 上下标
    "U+20A0-20CF",   # 货币符号
    "U+2100-214F",   # 字母式符号
    "U+2150-218F",   # 数字形式
    "U+2190-21FF",   # 箭头
    "U+2200-22FF",   # 数学运算符
    "U+2300-23FF",   # 杂项技术符号
    "U+2400-243F",   # 控制图形
    "U+2500-257F",   # 制表符（tree/log 输出常用）
    "U+2580-259F",   # 方块元素
    "U+25A0-25FF",   # 几何图形
    "U+2600-26FF",   # 杂项符号
    "U+2700-27BF",   # 装饰符号
    "U+FB00-FB06",   # 连字
])

# Nerd Font 图标里最常用的一小段（Powerline / 常见提示符分隔符）
ICON_RANGES = "U+E0A0-E0D7,U+E200-E2A9,U+F400-F4A9"

FACES = [
    # (输出名, 源文件名候选, 字重, 样式)
    ("FiraCodeNerd-Regular", ["FiraCodeNerdFont-Regular.ttf"], 400, "normal"),
    ("FiraCodeNerd-Bold", ["FiraCodeNerdFont-Bold.ttf"], 700, "normal"),
]


def find(names):
    for base in (USER_FONTS, SYS_FONTS):
        for n in names:
            p = os.path.join(base, n)
            if os.path.isfile(p):
                return p
    return ""


def build(src: str, dst: str, ranges: str) -> int:
    from fontTools import subset
    from fontTools.ttLib import TTFont

    args = [
        src,
        f"--unicodes={ranges}",
        "--layout-features=*",       # 保留 calt 等连字特性，Fira Code 的箭头连字靠它
        "--name-IDs=*",
        "--glyph-names",
        "--notdef-outline",
        "--recommended-glyphs",
        "--desubroutinize",
        f"--output-file={dst}",
        "--flavor=woff",
    ]
    subset.main(args)
    # 把内部字体名改掉，避免和本机安装的同名字体互相遮蔽
    f = TTFont(dst)
    for rec in f["name"].names:
        if rec.nameID in (1, 3, 4, 6, 16):
            try:
                cur = rec.toUnicode()
            except Exception:
                continue
            rec.string = cur.replace("FiraCode Nerd Font", "FiraCode Nerd").replace(
                "FiraCodeNF", "FiraCodeNerdWeb")
    f.save(dst)
    f.close()
    return os.path.getsize(dst)


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    only_core = "--icons" not in sys.argv
    ranges = CORE_RANGES if only_core else CORE_RANGES + "," + ICON_RANGES
    tag = "不含图标" if only_core else "含常用图标"
    print(f"  子集范围：{tag}")

    total = 0
    for out_name, candidates, _weight, _style in FACES:
        src = find(candidates)
        if not src:
            print(f"  {out_name}: 找不到源文件 {candidates}")
            continue
        dst = os.path.join(OUT_DIR, out_name + ".woff")
        size = build(src, dst, ranges)
        total += size
        print(f"  {out_name}.woff   {os.path.getsize(src) // 1024} KB -> {size // 1024} KB")
    print(f"\n  合计 {total // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
