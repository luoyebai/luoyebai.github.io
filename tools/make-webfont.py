"""把开源中文字体子集化、打包成站点自带的 Web 字体。

    python tools/build.py                       # 先构建，扫描产物才知道要用哪些字
    python tools/make-webfont.py                # 默认打包 Noto Serif SC + Noto Sans SC
    python tools/make-webfont.py --extra 常用    # 额外带上 3500 常用字（体积换覆盖）

为什么是 Noto：
- 宋体 / 黑体 / 微软雅黑是**微软授权字体，不能随站点分发**，只能以本地字体名引用；
- Noto Serif SC / Noto Sans SC 是 **SIL OFL**，可以自由打包分发，
  而且本机 `C:\\Windows\\Fonts` 里就有可变字体版本（wght 轴 200–900）。

为什么是可变字体：一个字重一份文件的话，正文 + 加粗要两倍体积；
保留 `wght` 轴只出一份文件，CSS 里 `font-weight: 200 900` 就能取到任意字重。

字形来源：直接扫 `public/` 里构建产物的全部文本。博客的实际用字只有 ~1000 个，
比整字体 31000 个字形小两个数量级。
"""
import collections
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "vendor", "fonts")
PUBLIC = os.path.join(ROOT, "public")
USER_FONTS = os.path.expanduser(r"~\AppData\Local\Microsoft\Windows\Fonts")
SYS_FONTS = r"C:\Windows\Fonts"

# 扫描产物时看这些后缀
SCAN_EXT = {".html", ".js", ".json", ".xml", ".txt", ".css", ".svg"}

# 不管有没有出现都带上：ASCII 可打印 + 常用中英标点 + 一些排版符号
ALWAYS = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "　、。「」『』（）〔〕【】《》〈〉—…“”‘’·×÷±°′″※→←↑↓"
    + "─│┌┐└┘├┤┬┴┼█▌▐░▒▓■□●○◆◇▲▼✓✗"
    + "０１２３４５６７８９"
)

FACES = [
    # (输出名, 源文件候选, CSS family, 内部改名)
    ("NotoSerifSC-VF", ["NotoSerifSC-VF.ttf", "NotoSerifSC-VF.otf"],
     "Noto Serif SC Web", "Noto Serif SC"),
    ("NotoSansSC-VF", ["NotoSansSC-VF.ttf", "NotoSansSC-VF.otf"],
     "Noto Sans SC Web", "Noto Sans SC"),
]


def find(names):
    for base in (USER_FONTS, SYS_FONTS):
        for n in names:
            p = os.path.join(base, n)
            if os.path.isfile(p):
                return p
    return ""


def strip_non_text(name: str, text: str) -> str:
    """去掉**不会被渲染**的文本：HTML 注释、CSS/JS 注释。

    注释里的字永远不会画出来，把它们算进子集只会让字体白白变大，
    而且写一句中文注释就得重跑一次打包 —— 这条规则本身就是被
    「<!-- 两连杆机械臂 -->」里的那个「杆」字逼出来的。
    """
    ext = os.path.splitext(name)[1].lower()
    if ext in (".html", ".xml", ".svg", ".vue"):
        text = re.sub(r"<!--[\s\S]*?-->", " ", text)
    if ext in (".html", ".xml", ".svg", ".css", ".js", ".json"):
        text = re.sub(r"/\*[\s\S]*?\*/", " ", text)
    if ext == ".js":
        text = re.sub(r"^\s*//[^\n]*$", " ", text, flags=re.M)
    return text


def collect_chars(extra: bool) -> set:
    """扫构建产物，返回站点真正会**渲染**出来的字符集合。"""
    chars = collections.Counter()
    if not os.path.isdir(PUBLIC):
        raise SystemExit("!! 先运行 python tools/build.py")
    for r, dirs, fs in os.walk(PUBLIC):
        dirs[:] = [d for d in dirs if d != ".git"]
        for f in fs:
            if os.path.splitext(f)[1] not in SCAN_EXT:
                continue
            try:
                with open(os.path.join(r, f), encoding="utf-8") as fh:
                    chars.update(strip_non_text(f, fh.read()))
            except (OSError, UnicodeDecodeError):
                continue

    out = set(ALWAYS) | set(chars)
    out = {c for c in out if ord(c) >= 0x20 and not (0xD800 <= ord(c) <= 0xDFFF)}
    if extra:
        # 《通用规范汉字表》一级字表（3500 字）里最常用的那批，用 Unicode 区间近似补一批
        # 常用字：不加也行，加了以后写新文章不必重新打包字体。
        for cp in range(0x4E00, 0x9FA6):
            out.add(chr(cp))
    return out


def subset(src: str, dst: str, chars: set, family_old: str, family_new: str) -> int:
    from fontTools import subset as ftsubset
    from fontTools.ttLib import TTFont

    unicodes = ",".join("U+%04X" % ord(c) for c in sorted(chars))
    args = [
        src,
        f"--unicodes={unicodes}",
        # 实测：'*' 是 507 KB，下面这组 434 KB，再砍到 kern,liga,calt 只省 2 KB 却掉了
        # 标记定位（组合符号会跑位），不划算。CJK 的竖排特性也没用到，一并去掉。
        "--layout-features=kern,liga,calt,ccmp,locl,mark,mkmk",
        "--name-IDs=*",
        "--notdef-outline",
        "--recommended-glyphs",
        "--no-hinting",            # 屏幕渲染用不到 bytecode hinting
        "--desubroutinize",
        "--drop-tables+=DSIG",
        # 关键：不要 --instance，保留 fvar 的 wght 轴。
        # 实测一份可变 434 KB，而静态 400 + 静态 700 两份要 488 KB，且只能覆盖两个字重。
        f"--output-file={dst}",
        "--flavor=woff",
    ]
    ftsubset.main(args)

    f = TTFont(dst)
    for rec in f["name"].names:
        if rec.nameID in (1, 3, 4, 6, 16, 17):
            try:
                cur = rec.toUnicode()
            except Exception:
                continue
            rec.string = cur.replace(family_old, family_new)
    f.save(dst)
    f.close()
    return os.path.getsize(dst)


def main() -> int:
    extra = "--extra" in sys.argv
    os.makedirs(OUT_DIR, exist_ok=True)

    chars = collect_chars(extra)
    cjk = sum(1 for c in chars if "\u4e00" <= c <= "\u9fff")
    print(f"  字形集合：{len(chars)} 个字符（其中汉字 {cjk} 个）"
          f"{'（含 3500 常用字兜底）' if extra else ''}")

    total = 0
    for out_name, candidates, family_new, family_old in FACES:
        src = find(candidates)
        if not src:
            print(f"  {out_name}: 找不到源文件 {candidates}")
            continue
        dst = os.path.join(OUT_DIR, out_name + ".woff")
        size = subset(src, dst, chars, family_old, family_new)
        total += size
        print(f"  {out_name}.woff  {os.path.getsize(src) // 1048576}.{os.path.getsize(src) % 1048576 * 10 // 1048576} MB"
              f" -> {size / 1024:.0f} KB")
    print(f"\n  合计 {total / 1024:.0f} KB")

    if not extra:
        print("  提示：加了新文章之后重跑本脚本，否则生僻字会回退到本机字体")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
