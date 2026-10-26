"""零依赖 Markdown 解析器（工程博客够用的子集）+ front-matter 解析。

支持：标题(含自动锚点/TOC)、段落、围栏代码(带语言高亮)、有序/无序/任务列表(可嵌套)、
引用(可嵌套)、GFM 表格(含对齐)、分隔线、行内代码、粗斜体/删除线、链接/图片/自动链接、
行内与块级数学公式($..$ / $$..$$)、原样 HTML 块、脚注式提示框(容器语法 :::)。

刻意不支持：参考式链接、脚注、内嵌 HTML 的完整清理（作者可信）。
"""
from __future__ import annotations

import html
import json
import os
import re
from html.parser import HTMLParser

from highlight import highlight
import siteicons as site_icons

CONTAINERS = {
    "note": ("note", "提示"),
    "tip": ("tip", "技巧"),
    "warn": ("warn", "注意"),
    "danger": ("danger", "警告"),
    "math": ("math", "推导"),
}

# ---------------------------------------------------------------- front-matter

def _scalar(raw: str):
    v = raw.strip()
    if v == "":
        return None
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    # 流式列表 [a, b]
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [_scalar(p) for p in _split_inline_list(inner)]
    # 流式映射 { k: v, k: v }
    if v.startswith("{") and v.endswith("}"):
        inner = v[1:-1].strip()
        out = {}
        if inner:
            for part in _split_inline_list(inner):
                k, sep, val = part.partition(":")
                if not sep:
                    continue
                out[k.strip()] = _scalar(val)
        return out
    low = v.lower()
    if low in ("true", "yes", "on"):
        return True
    if low in ("false", "no", "off"):
        return False
    if low in ("null", "~"):
        return None
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    return v


def _split_inline_list(s: str) -> list[str]:
    out, buf, quote = [], [], ""
    for ch in s:
        if quote:
            if ch == quote:
                quote = ""
            buf.append(ch)
        elif ch in "\"'":
            quote = ch
            buf.append(ch)
        elif ch == ",":
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf))
    return out


def parse_front_matter(text: str) -> tuple[dict, str]:
    """返回 (meta, 正文)。没有 front-matter 时 meta 为空 dict。"""
    if not text.startswith("---"):
        return {}, text
    lines = text.splitlines()
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() in ("---", "..."):
            end = i
            break
    if end is None:
        return {}, text

    meta: dict = {}
    i = 1
    while i < end:
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, _, rest = line.partition(":")
        key = key.strip()
        value = rest.strip()
        if value:
            meta[key] = _scalar(value)
            i += 1
            continue

        # 空值 -> 块状列表 / 嵌套映射
        block = []
        j = i + 1
        while j < end:
            nxt = lines[j]
            if not nxt.strip():
                j += 1
                continue
            indent = len(nxt) - len(nxt.lstrip())
            if indent == 0:
                break
            block.append(nxt)
            j += 1
        if block and all(b.lstrip().startswith("- ") for b in block):
            meta[key] = [_scalar(b.lstrip()[2:]) for b in block]
        elif block:
            nested = {}
            for b in block:
                if ":" in b:
                    k2, _, v2 = b.strip().partition(":")
                    nested[k2.strip()] = _scalar(v2)
            meta[key] = nested
        else:
            meta[key] = None
        i = j

    return meta, "\n".join(lines[end + 1:])


# ---------------------------------------------------------------- 序列化

# 写入时的字段顺序（未列出的字段追加在后面）
KEY_ORDER = [
    "title", "slug", "tagline", "subtitle", "date", "updated", "tags",
    "summary", "cover", "featured", "draft", "archived", "order",
    "status", "stack", "links", "author",
]


def _needs_quotes(s: str) -> bool:
    if s.strip() != s or s == "":
        return True
    if s.lower() in ("true", "false", "yes", "no", "on", "off", "null", "~"):
        return True
    if any(c in s for c in ':#[]{},"\''):
        return True
    try:
        float(s)
        return True
    except ValueError:
        return False


def _emit_scalar(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if _needs_quotes(s):
        return '"' + s.replace('"', "'") + '"'
    return s


def dump_front_matter(meta: dict) -> str:
    """把 front-matter 字典写回 YAML（与 parse_front_matter 对称）。"""
    keys = [k for k in KEY_ORDER if k in meta]
    keys += [k for k in meta if k not in KEY_ORDER]

    lines = ["---"]
    for key in keys:
        value = meta[key]
        if value is None or value == "" or value == []:
            continue
        if isinstance(value, list):
            simple = all(isinstance(v, (str, int, float, bool)) for v in value)
            if simple and all(not _needs_quotes(str(v)) for v in value):
                lines.append(f"{key}: [{', '.join(_emit_scalar(v) for v in value)}]")
            else:
                lines.append(f"{key}:")
                for v in value:
                    if isinstance(v, dict):
                        parts = ", ".join(f"{k}: {_emit_scalar(val)}"
                                          for k, val in v.items()
                                          if val is not None and val != "")
                        lines.append(f"  - {{ {parts} }}")
                    else:
                        lines.append(f"  - {_emit_scalar(v)}")
        elif isinstance(value, dict):
            lines.append(f"{key}:")
            for k, v in value.items():
                if v is None or v == "":
                    continue
                lines.append(f"  {k}: {_emit_scalar(v)}")
        else:
            lines.append(f"{key}: {_emit_scalar(value)}")
    lines.append("---")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- 工具

def slugify(text: str) -> str:
    s = re.sub(r"<[^>]+>", "", text)
    s = s.strip().lower()
    s = re.sub(r"[^\w\u4e00-\u9fff\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "section"


INLINE_CODE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)", re.S)
MATH_BLOCK = re.compile(r"\$\$(.+?)\$\$", re.S)
MATH_INLINE = re.compile(r"(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$")
IMG = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)")
LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)")
AUTOLINK = re.compile(r"(?<![\"'=])(https?://[^\s<>\)\]\"']+)")
BOLD = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", re.S)
BOLD_ITALIC = re.compile(r"\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*", re.S)
ITALIC = re.compile(r"(?<![\*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\*)")
STRIKE = re.compile(r"~~(?=\S)(.+?)(?<=\S)~~", re.S)
BR = re.compile(r" {2,}\n")


def _esc(s: str) -> str:
    return html.escape(s, quote=False)


# ---------------------------------------------------------------- 外链的站点标记
# 用到的图标 slug 攒在这里，由调用方 `take_icons()` 取走（一页一次，内联成 SVG 精灵）。
_USED_ICONS: set[str] = set()


def take_icons() -> set[str]:
    """取走本次渲染用到的站点图标（取走即清空）。"""
    got = set(_USED_ICONS)
    _USED_ICONS.clear()
    return got


def _host_of(url: str) -> str:
    """从 URL 里取域名（小写、去掉 www 由 siteicons 处理）。"""
    m = re.match(r"https?://([^/?#]+)", url or "")
    return (m.group(1) if m else "").lower()


def _ext_link(href: str, inner: str, title: str = "") -> str:
    """外链的 `<a>`。**域名在图标表里就带一枚品牌标记。**

    做这个是因为正文里满篇都是 `[C++ 核心准则](https://isocpp.github.io/...)` 这种
    裸标题，扫一眼分不出「点进去是哪一类东西」；带上标记之后 GitHub、ROS、Python
    这些常去的站点一眼就认出来。没收录的域名**什么都不变**（不是加个通用小图标），
    否则满页会多出一堆没信息量的装饰。

    `href` 传入时可能已经转义过（自动链接那一路），所以这里不再 escape。
    """
    attrs = f' href="{href}"'
    if title:
        attrs += f' title="{html.escape(title, quote=True)}"'
    if href.startswith("http"):
        attrs += ' target="_blank" rel="noopener"'
        host = _host_of(href)
        slug = site_icons.slug_for(host)
        if site_icons.has(slug):
            _USED_ICONS.add(slug)
            attrs += (' class="site-link" data-site="%s"' % html.escape(host, quote=True))
            inner = site_icons.mark(slug) + inner
    return f"<a{attrs}>{inner}</a>"


# 整段只有一条链接：`[文字](url)` 或 光秃秃一个 URL（含 `<url>` 写法）
LINK_ONLY = re.compile(r'^\[([^\]]*)\]\((https?://[^)\s]+)(?:\s+"([^"]*)")?\)$')
BARE_ONLY = re.compile(r"^<?(https?://[^\s<>]+)>?$")
KEEP_EXT = {".html", ".htm", ".pdf", ".ipynb"}


def _bare_card_title(url: str) -> tuple[str, str]:
    """裸 URL 当卡片时的（标题, 副标题）。

    标题取路径末段（`…/unitree_mujoco` -> `unitree_mujoco`，比整条 URL 好读），
    末段是纯数字之类没有可读性的东西时退回域名 —— 知乎那种 `/p/702587845`
    拿数字当标题只会更糊涂，这时候**路径挪到副标题**上去，信息一样不丢。
    """
    path = re.sub(r"[?#].*$", "", re.sub(r"^https?://[^/]+", "", url)).strip("/")
    segs = [s for s in path.split("/") if s]
    tail = segs[-1] if segs else ""
    if tail:
        stem, ext = os.path.splitext(tail)
        if ext.lower() in KEEP_EXT:
            tail = stem
        if len(tail) >= 3 and re.search(r"[A-Za-z\u4e00-\u9fff]", tail):
            return _esc(tail), _esc(_host_of(url))
    return _esc(_host_of(url)), ("/" + _esc(path) if path else "")


def render_link_card(url: str) -> str | None:
    """把「整段就一条外链」渲染成卡片。**只对收录了标记的站点生效。**

    为什么限定「整段就这一条链接」：正文里顺手提到的链接正在句子中间，变成卡片会把
    句子切断；而一行只有一条链接，在文章里本来就是「参考资料 / 相关链接」的写法
    （迁移过来的那批文档里有几十处），那里正需要一个显眼、点得中、看得清是哪个站的块。
    """
    host = _host_of(url)
    slug = site_icons.slug_for(host)
    if not site_icons.has(slug):
        return None
    _USED_ICONS.add(slug)
    esc = html.escape(url, quote=True)
    return (
        f'<a class="link-card" href="{esc}" target="_blank" rel="noopener" title="{esc}"'
        f' data-site="{html.escape(host, quote=True)}">'
        f'<span class="link-card-icon">{site_icons.mark(slug, "site-mark is-lg")}</span>'
        f'<span class="link-card-text">'
        f'<span class="link-card-title">{{TITLE}}</span>'
        f'<span class="link-card-host">{{SUB}}</span></span>'
        '<svg class="link-card-go" viewBox="0 0 24 24" aria-hidden="true">'
        '<path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round"/></svg></a>'
    )


def _link_card(text: str) -> str:
    """段落文字 -> 卡片 HTML（不是「整段一条链接」就返回空串）。"""
    m = LINK_ONLY.match(text)
    if m:
        url, title_html = m.group(2), _emphasis(_esc(m.group(1)))
        sub = _esc(_host_of(url))
    else:
        m = BARE_ONLY.match(text)
        if not m:
            return ""
        url = m.group(1)
        title_html, sub = _bare_card_title(url)
        title_html = title_html or _esc(_host_of(url))
    card = render_link_card(url)
    if card is None:
        return ""
    return card.replace("{TITLE}", title_html).replace("{SUB}", sub)


def _strip_marks(s: str) -> str:
    """去掉行内标记符，只留文字。给 <img alt> 这种属性用。"""
    s = INLINE_CODE.sub(lambda m: m.group(2), s)
    s = re.sub(r"\*\*\*(.+?)\*\*\*", r"\1", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", s)
    s = re.sub(r"~~(.+?)~~", r"\1", s)
    return re.sub(r"<[^>]+>", "", s)


# 允许原样透出的行内标签 -> 输出。键是源标签名，值是替换后的标签名（None = 原样）。
# 只放行一张**固定白名单**：内容虽然是作者自己写的，但解析器一旦无差别放行原始 HTML，
# 以后任何一次「把别人的 md 拷进来」都会变成注入点。
INLINE_TAGS = {
    "br": "br", "hr": "hr", "wbr": "wbr",
    "b": "strong", "strong": "strong",
    "i": "em", "em": "em",
    "u": "u", "s": "del", "del": "del", "strike": "del",
    "mark": "mark", "kbd": "kbd", "sub": "sub", "sup": "sup", "small": "small",
    "code": "code", "span": "span", "center": "span",
    # 源文档（doc_html）用裸标签当颜色用，CSS 里就是 `red{color:red}`。
    # 这里映射到本站在两套模式下都过对比度的强调色。
    "red": "span", "blue": "span", "green": "span", "amber": "span", "yellow": "span",
}
# 颜色标签 -> class
INK_TAGS = {"red": "ink-red", "blue": "ink-blue", "green": "ink-green",
            "amber": "ink-amber", "yellow": "ink-amber"}
VOID_TAGS = {"br", "hr", "wbr"}
# 只认「可选斜杠 + 标签名 + 可选空属性」，属性一律不接受
RAW_TAG = re.compile(r"</?([a-zA-Z][\w-]*)\s*/?>")
# 尖括号自动链接：<https://…> / <mailto:…>。标准 Markdown 语法，
# 源文档里有一处就是这么写的，不放行的话尖括号会被转义成可见的 &lt;&gt;。
ANGLE_LINK = re.compile(r"<((?:https?://|mailto:)[^<>\s]+)>")


def raw_html_tag(m: re.Match) -> str | None:
    """把白名单里的裸标签转成安全的 HTML；不在白名单里返回 None。"""
    name = m.group(1).lower()
    if name not in INLINE_TAGS:
        return None
    closing = m.group(0).startswith("</")
    out = INLINE_TAGS[name]
    if out in VOID_TAGS:
        return f"<{out}>" if not closing else ""
    cls = INK_TAGS.get(name)
    attr = f' class="ink {cls}"' if (cls and not closing) else ""
    return f"</{out}>" if closing else f"<{out}{attr}>"


def _emphasis(s: str) -> str:
    """把强调标记换成标签。调用方负责先做转义 ——
    反过来做的话，刚生成的 <strong> 会被自己转义掉。"""
    s = BOLD_ITALIC.sub(r"<strong><em>\1</em></strong>", s)
    s = BOLD.sub(r"<strong>\1</strong>", s)
    s = ITALIC.sub(r"<em>\1</em>", s)
    s = STRIKE.sub(r"<del>\1</del>", s)
    return s


# 需要按行做配对修复的裸标签。源文档（doc_html）经常把它们跨行、甚至跨块地配对，
# 比如 `<blue>空间-内存\n</blue>上所占…` —— 列表项在这里被解析器切成两个块，
# 于是生成 `</span>` 孤零零开了一个新段落，HTML 直接失衡。
# 值用**输出后的**标签名，`<s>`/`<strike>` 和 `<del>` 要算作同一个标签。
PAIR_NAMES = {
    "red": "span", "blue": "span", "green": "span", "amber": "span", "yellow": "span",
    "span": "span", "center": "span",
    "del": "del", "s": "del", "strike": "del",
    "strong": "strong", "b": "strong",
    "em": "em", "i": "em",
    "u": "u", "mark": "mark", "kbd": "kbd",
    "sub": "sub", "sup": "sup", "small": "small", "code": "code",
}
_PAIR_ALT = "|".join(sorted(PAIR_NAMES, key=len, reverse=True))
PAIR_OPEN = re.compile(r"<(" + _PAIR_ALT + r")>", re.I)
PAIR_CLOSE = re.compile(r"</(" + _PAIR_ALT + r")>", re.I)


def balance_inline_tags(md: str) -> str:
    """把跨行的裸标签规范化：**行尾补闭合**，行首多余的闭合丢掉。

    刻意按行而不是按段处理：段落会被列表/引用切碎，跨块的标签对本来就没法还原，
    在行尾收口是唯一能保证 HTML 始终平衡的做法。围栏代码与行内代码里的标签不动。
    """
    out: list[str] = []
    fence: str | None = None
    for line in md.split("\n"):
        fm = re.match(r"\s*(`{3,}|~{3,})", line)
        if fm:
            fence = None if fence else fm.group(1)[0]
            out.append(line)
            continue
        if fence:
            out.append(line)
            continue
        # 行内代码段（反引号包起来的部分）不参与配对；下标为偶数的片段才是正文
        parts = line.split("`")
        # 栈里存 (源标签名, 归一化后的标签名)：配对按归一化名比（`<s>` 与 `<del>` 算同一种），
        # 但**补出来的闭合要用源标签名** —— 写成 `</span>` 的话，
        # 和同一行里那个 `<blue>` 对不上（inline() 才会把 <blue> 映射成 <span>）。
        stack: list[tuple[str, str]] = []
        for idx in range(0, len(parts), 2):
            seg = parts[idx]
            res: list[str] = []
            pos = 0
            while True:
                mo, mc = PAIR_OPEN.search(seg, pos), PAIR_CLOSE.search(seg, pos)
                if not mo and not mc:
                    res.append(seg[pos:])
                    break
                if mc and (not mo or mc.start() < mo.start()):
                    name = PAIR_NAMES.get(mc.group(1).lower(), "")
                    # 没有配对的闭合：整段丢掉（源文档里真的有这种漏写的）
                    if stack and stack[-1][1] == name:
                        stack.pop()
                        res.append(seg[pos:mc.end()])
                    else:
                        res.append(seg[pos:mc.start()])
                    pos = mc.end()
                else:
                    src = mo.group(1).lower()
                    stack.append((src, PAIR_NAMES.get(src, "")))
                    res.append(seg[pos:mo.end()])
                    pos = mo.end()
            parts[idx] = "".join(res)
        line = "`".join(parts)
        while stack:
            src, name = stack.pop()
            if name:
                line += "</" + src + ">"
        out.append(line)
    return "\n".join(out)


def inline(text: str) -> str:
    """行内标记 -> HTML。"""
    slots: list[str] = []

    def stash(html_frag: str) -> str:
        slots.append(html_frag)
        return f"\x00{len(slots) - 1}\x00"

    # 1) 行内代码（内部不再解析）
    def code_sub(m):
        body = m.group(2)
        return stash(f"<code>{_esc(body)}</code>")

    text = INLINE_CODE.sub(code_sub, text)

    # 1.5) 尖括号自动链接
    text = ANGLE_LINK.sub(lambda m: stash(
        f'<a href="{html.escape(m.group(1), quote=True)}" target="_blank" rel="noopener">'
        f'{_esc(m.group(1))}</a>'), text)

    # 2) 数学。
    #    外面必须再套一层：KaTeX 是 `katex.render(tex, el)` —— 它会**替换掉 el 的内容**，
    #    复制按钮要是直接放进 .math-inline / .math-block 里，渲染完就没了。
    text = MATH_INLINE.sub(lambda m: stash(
        '<span class="math-wrap">'
        f'<span class="math-inline" data-tex="{html.escape(m.group(1), quote=True)}">'
        f'{_esc(m.group(1))}</span>'
        + MATH_COPY_BTN
        + '</span>'), text)

    # 3) 白名单裸标签（<red>、<br>…）。放在行内代码**之后**：
    #    代码里的 `<stdio.h>` 属于代码内容，不该被当成标签处理。
    text = RAW_TAG.sub(lambda m: stash(t) if (t := raw_html_tag(m)) is not None else m.group(0),
                       text)

    # 4) 图片 / 链接。
    #    链接文字要**递归解析**：`[**重点**](url)` 是合法 Markdown，
    #    之前的写法直接把 m.group(1) 原样塞进 <a>，星号就原样显示出来了
    #    （迁进来的那批文档满页都是 `[***CS自学指南***](...)`，一眼就看出来了）。
    #    alt 文字反过来要**去掉**标记：那是属性，塞 HTML 进去没有意义。
    text = IMG.sub(lambda m: stash(
        f'<img src="{html.escape(m.group(2), quote=True)}" '
        f'alt="{html.escape(_strip_marks(m.group(1)), quote=True)}"'
        + (f' title="{html.escape(m.group(3), quote=True)}"' if m.group(3) else "")
        + ' loading="lazy" decoding="async">'), text)
    text = LINK.sub(lambda m: stash(
        _ext_link(html.escape(m.group(2), quote=True),
                  _emphasis(_esc(m.group(1))),
                  m.group(3) or "")), text)

    text = _esc(text)

    # 4) 自动链接（转义后仍是明文 URL）。
    #    href 这里**不要再转义一遍**：这一段是在 _esc 之后跑的，`&` 已经是 `&amp;`，
    #    再 escape 一次会变成 `&amp;amp;`，链接里带查询参数的就会打开错页面。
    text = AUTOLINK.sub(lambda m: stash(_ext_link(m.group(1), m.group(1))), text)

    # 5) 强调。`***x***` 必须先吃掉：先跑 BOLD 会得到 `<strong>*x</strong>*`，
    #    再跑 ITALIC 就把它变成 `<strong><em>x</strong></em>` —— 交叉标签，
    #    浏览器会自己猜着修，结果完全看心情。
    text = _emphasis(text)
    text = BR.sub("<br>\n", text)

    # 6) 还原占位。
    #    要**反复跑到没有占位符为止**：链接/图片是把整段 HTML 塞进槽里的，
    #    而链接文字里可能还嵌着别的槽（`[带 <red>色</red> 的链接](url)`），
    #    只跑一遍的话，槽里面的占位符永远留在输出里（会看到裸的 \x000\x00）。
    def restore(m):
        return slots[int(m.group(1))]

    for _ in range(6):
        resolved = re.sub(r"\x00(\d+)\x00", restore, text)
        if resolved == text:
            break
        text = resolved
    return text


# ---------------------------------------------------------------- 块级

FENCE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)\s*(.*)$")

# 公式复制按钮。复制的是**站点自己的 Markdown 写法**（行内带 `$…$`、块级带 `$$…$$`），
# 粘回文章、粘进 Notion 或 LaTeX 文档都能直接用。
MATH_COPY_BTN = (
    '<button class="math-copy" type="button" data-math-copy'
    ' aria-label="复制 LaTeX 公式" title="复制 LaTeX">'
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    '<rect x="9" y="9" width="11" height="11" rx="2.5"/>'
    '<path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>'
    '<span data-copy-label>复制 LaTeX</span></button>'
)


def render_math_block(tex: str) -> str:
    """块级公式：外面套一层 .math-figure 来放复制按钮（见上面的原因）。"""
    esc = html.escape(tex, quote=True)
    return ('<div class="math-figure">' + MATH_COPY_BTN +
            f'<div class="math-block" data-tex="{esc}">$${_esc(tex)}$$</div></div>')


# 可以在前台运行的代码块语言：```js run / ```html run
RUNNABLE_LANGS = {
    "js": "js", "javascript": "js", "mjs": "js",
    "html": "html", "htm": "html",
}
RUNNABLE_LABEL = {"js": "JavaScript", "html": "HTML"}


def _json_for_script(value: str) -> str:
    """把源码塞进 <script type="application/json"> 里。

    必须把 `<` 转义成 \\u003c：否则代码里一旦出现 `</script>` 就会提前闭合标签，
    轻则渲染错乱，重则变成可注入点。
    """
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c")


def render_mujoco(scene: str) -> str:
    """Author-selected built-in physics tool; engine loads only on demand."""
    if scene != "ankle":
        return '<p class="callout">未知 MuJoCo 场景；目前支持 <code>ankle</code>。</p>'
    return (
        '<section class="mujoco-embed" data-mujoco-tool="ankle" aria-label="并联踝 MuJoCo 实验">'
        '<div class="mujoco-embed-intro"><span class="mujoco-tag">MUJOCO · 闭环机构</span>'
        '<h3>转动电机，观察脚踝如何响应</h3>'
        '<p>两个电机推动摇臂与连杆，脚底姿态由物理引擎求解。'
        '对比电机输入、实际角度、脚底姿态与闭环误差。</p>'
        '<div class="mujoco-embed-actions"><button type="button" data-mujoco-load>加载并联踝实验</button>'
        '<a href="/lab/ankle/" data-mujoco-link target="_blank" rel="noopener">独立打开 ↗</a></div>'
        '<p class="mujoco-embed-note">按需加载约 11 MB 仿真引擎，模型另行加载；未运行时不占用仿真资源。</p></div>'
        '<div data-mujoco-mount hidden></div>'
        '<button class="mujoco-unload" type="button" data-mujoco-unload hidden>关闭实验并释放资源</button>'
        '<noscript><p>交互实验需要 JavaScript；正文推导仍可阅读。</p></noscript></section>'
    )


def mujoco_tool_links(rendered: str, site_base: str = "") -> str:
    """Resolve trusted tool links after rendering, including nested deck/callout blocks.

    Build uses its deployment prefix; admin uses the separate public-site origin.
    Ordinary links and user-authored text are deliberately left alone.
    """
    destination = html.escape(str(site_base).rstrip("/") + "/lab/ankle/", quote=True)
    return re.sub(r'<a href="[^"]*" data-mujoco-link\b',
                  lambda _match: '<a href="' + destination + '" data-mujoco-link', rendered)


def render_demo(code: str, lang: str) -> str:
    """渲染「可运行示例」面板。

    结构：源码（带高亮，可复制）+ 运行/重置按钮 + 结果区 + 内嵌源码。
    源码放在 <script type="application/json"> 里，由 demo.js 读出来丢进沙箱 iframe 执行；
    这里不做任何执行，也不信任源码内容。
    """
    label = RUNNABLE_LABEL.get(lang, lang)
    src = _json_for_script(code)
    return (
        f'<div class="demo" data-demo="{html.escape(lang, quote=True)}">'
        '<div class="demo-head">'
        f'<span class="demo-badge">可运行示例</span>'
        f'<span class="demo-lang">{_esc(label)}</span>'
        '<div class="demo-actions">'
        '<button class="demo-toggle" type="button" data-demo-toggle aria-expanded="false">'
        '<span data-demo-toggle-label>查看代码</span>'
        '<svg class="demo-caret" viewBox="0 0 24 24" aria-hidden="true">'
        '<path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
        '<button class="code-copy" type="button" data-copy aria-label="复制代码">'
        '<span data-copy-label>复制</span></button>'
        '<button class="demo-run" type="button" data-demo-run>'
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>'
        '<span data-demo-run-label>运行</span></button>'
        '<button class="demo-reset" type="button" data-demo-reset hidden>重置</button>'
        '</div></div>'
        f'<pre class="code-pre" data-demo-code hidden><code class="language-'
        f'{html.escape(lang, quote=True)}">{highlight(code, lang)}</code></pre>'
        '<div class="demo-stage" data-demo-stage hidden>'
        '<div class="demo-frame-wrap" data-demo-mount></div>'
        '<div class="demo-log" data-demo-log hidden></div>'
        '<p class="demo-status" data-demo-status></p>'
        '</div>'
        '<noscript><p class="demo-noscript">这段示例需要 JavaScript 才能运行。</p></noscript>'
        f'<script type="application/json" data-demo-src>{src}</script>'
        '</div>'
    )
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
HR = re.compile(r"^\s{0,3}([-*_])(?:\s*\1){2,}\s*$")
UL = re.compile(r"^(\s*)([-*+])\s+(.*)$")
OL = re.compile(r"^(\s*)(\d{1,9})[.)]\s+(.*)$")
QUOTE = re.compile(r"^\s{0,3}>\s?(.*)$")
TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
CONTAINER_OPEN = re.compile(r"^\s*:::\s*(\w+)\s*(.*)$")
# 独占一行、指向视频的图片语法。语言里没有「视频」这个概念，但
# `![说明](x.mp4)` 是最自然的写法 —— 作者不用记新的标记。
VIDEO_LINE = re.compile(
    r'^\s*!\[([^\]]*)\]\(([^)\s]+\.(?:mp4|webm|ogv|mov))(?:\s+"([^"]*)")?\)\s*$', re.I)
VIDEO_EXT = (".mp4", ".webm", ".ogv", ".mov")
# 行内图片引用（和 inline() 里那个 IMG 同形），用来切「整行都是图片」的并排图
MEDIA_ITEM = re.compile(r'!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)')
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".bmp", ".ico")
# `::: gallery 3 图注` —— 列数写死、图多到要换行的图组。
# `media` 是英文别名，`图组` 是随手写中文时最容易想起的那个词。
GALLERY_KINDS = {"gallery", "media", "图组"}
# 整行原始 HTML：`<img …>`、`<hr>`、`</center>`、`<!-- … -->` 之类
RAW_BLOCK = re.compile(r"^\s*(?:</?[a-zA-Z][\w-]*(?:\s[^<>]*)?/?>|<!--.*-->)\s*$")
# 会「吞噬后续行」的块级 HTML 开标签。这些标签一出现，就应当交给块级处理，
# 而不是被上面的 RAW_BLOCK 当成单行标签吐出去 —— 后者会把
# `<figure>` / `<svg>` 的内容整段转义成文字（内联插图踩过这个坑）。
# `hr` 刻意不在列表里：它是空元素，吞后续行只会吃掉正文。
HTML_BLOCK_OPEN = re.compile(
    r"^\s*<(/?)(div|section|figure|table|aside|details|summary"
    r"|iframe|video|ul|ol|li|h[1-6]|pre|blockquote|svg)\b", re.I)


def render_video(src: str, alt: str, title: str = "") -> str:
    """独占一行的视频引用渲染成 `<figure>`。

    海报帧按「同名 .jpg」约定取（`video-01.mp4` -> `video-01.jpg`），由迁移脚本抽首帧；
    缺了也不致命，只是要先黑一下等 metadata。

    `muted` + `loop` 是刻意的：这批素材全是屏幕录制、本来就没音轨，
    不静音的话浏览器会直接拒绝自动播放，点了也没反应；循环则是因为演示只有几秒，
    看完就停住还得手动重播太别扭。真正播不播由外面的脚本决定（点击才播）。
    """
    src_e = html.escape(src, quote=True)
    cap = alt.strip()
    poster = html.escape(os.path.splitext(src)[0] + ".jpg", quote=True)
    label = html.escape(title or cap or "演示视频", quote=True)
    return (
        '<figure class="docvideo media-shim">'
        f'<video src="{src_e}" poster="{poster}" preload="metadata" '
        f'muted loop playsinline controls aria-label="{label}"></video>'
        '<button class="docvideo-play" type="button" aria-label="播放视频">'
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        '<path d="M8 5.6v12.8L19 12z"/></svg>'
        '<span>播放</span></button>'
        + (f"<figcaption>{inline(cap)}</figcaption>" if cap else "")
        + "</figure>")


def _media_caption(alt: str, title: str) -> str:
    """并排图的图注：先看 alt，alt 是「图片.png」这种文件名时退回 title。

    迁进来的那批文档里 alt 全是 `图片.png` / `image.png`（飞书导出的默认值），
    直接拿来当图注等于每张图下面挂一行文件名。和前台点开看原图时的判断保持一致。
    """
    for cand in (alt, title):
        c = (cand or "").strip()
        if c and not re.search(r"\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$", c, re.I):
            return c
    return ""


def parse_media_line(line: str) -> list[tuple[str, str, str, bool]] | None:
    """整行都是图片/视频引用时返回 `[(src, alt, title, is_video)]`，否则 None。

    「整行都是」是硬条件，不是顺手加的：只有这样才能用**一行写几张就并排几张**
    这种零学习成本的写法，而 `![图](a.png) 说明文字` 这种图夹字的混排行仍然老老实实
    走普通段落。要是不做这个限制，正文里任何位置出现一张小图都会被拉成网格。
    """
    found: list[tuple[str, ...]] = []
    rest = MEDIA_ITEM.sub(lambda m: found.append(m.groups()) or "", line)
    if not found or rest.strip():
        return None
    return [(src, alt or "", title or "", src.lower().endswith(VIDEO_EXT))
            for alt, src, title in found]


def render_media_grid(items: list[tuple[str, str, str, bool]],
                      cols: int = 0, caption: str = "") -> str:
    """把若干图片/视频并排渲染。

    每格等宽，图片按自己的宽高比铺满列宽（不裁切），图注用 `margin-top:auto` 顶到
    格子底部 —— 这样一行里横图竖图混着放，图注仍然对齐在一条线上。
    """
    n = cols if cols > 0 else len(items)
    cells: list[str] = []
    for src, alt, title, is_video in items:
        if is_video:
            # 视频本身就产出 <figure>，直接当格子用：figure 套 figure 不是合法结构
            cells.append(render_video(src, alt, title))
            continue
        img = (f'<img src="{html.escape(src, quote=True)}" '
               f'alt="{html.escape(_strip_marks(alt), quote=True)}"'
               + (f' title="{html.escape(title, quote=True)}"' if title else "")
               + ' loading="lazy" decoding="async">')
        cap = _media_caption(alt, title)
        cells.append('<figure class="media-cell">'
                     f'<div class="media-shot">{img}</div>'
                     + (f"<figcaption>{inline(cap)}</figcaption>" if cap else "")
                     + "</figure>")
    # `--cols` 是给样式的，`data-cols` 是给窄屏媒体查询的（CSS 里没法用 min() 兜 var 的数值）
    row = (f'<div class="media-row" data-cols="{n}" style="--cols:{n}">'
           + "".join(cells) + "</div>")
    if caption:
        return ('<figure class="media-group">' + row
                + f"<figcaption>{inline(caption)}</figcaption></figure>")
    return row


def _render_gallery(body: list[str], head: str, opener: str) -> str:
    """`::: gallery 3 图注` 的正文 → 一个网格。

    正文只接受「整行是图片」的行，其它非空行**直接报错**：图组里混进正文时悄悄丢掉
    几行，页面上只是少几张图 —— 谁也不知道原本该有几张，这种错最难查。
    列数不写（`::: gallery`）就取「一行最多写了几张」，作者按想要的行宽断行即可。
    """
    cols, caption = 0, head
    parts = head.split(None, 1)
    if parts and parts[0].isdigit():
        cols = int(parts[0])
        caption = parts[1].strip() if len(parts) > 1 else ""
    items: list[tuple[str, str, str, bool]] = []
    per_line: list[int] = []
    for raw in body:
        if not raw.strip():
            continue
        got = parse_media_line(raw)
        if got is None:
            raise ValueError(f"{opener.strip()} 图组里只能放图片，这一行不是图片：{raw.strip()!r}")
        items.extend(got)
        per_line.append(len(got))
    if not items:
        return ""
    return render_media_grid(items, cols if cols > 0 else max(per_line), caption)


def _map_source_block(markup: str, start: int, end: int, *, raw: bool = False) -> str:
    """给已有顶层元素标记源码范围，不增加影响布局的包装元素。

    原生 HTML 保留字节内容，只在开标签上插入属性；注释、属性里的尖括号以及
    script/style 的内容由 HTMLParser 识别，不能用查找第一个 ``<`` 来猜位置。
    """
    class Blocks(HTMLParser):
        VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
                "link", "meta", "param", "source", "track", "wbr"}

        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.stack = []
            self.blocks = []
            self.offsets = [0]
            for match in re.finditer("\n", markup):
                self.offsets.append(match.end())

        def opening(self, tag, closed=False):
            row, col = self.getpos()
            if not self.stack:
                line = min(end, start + row - 1) if raw else start
                self.blocks.append([self.offsets[row - 1] + col + 1 + len(tag), line,
                                    line if closed or tag in self.VOID else end])
            if not closed and tag not in self.VOID:
                self.stack.append(tag)

        def handle_starttag(self, tag, attrs):
            self.opening(tag)

        def handle_startendtag(self, tag, attrs):
            self.opening(tag, True)

        def handle_endtag(self, tag):
            if tag in self.stack:
                index = len(self.stack) - 1 - self.stack[::-1].index(tag)
                del self.stack[index:]
                if raw and not self.stack:
                    self.blocks[-1][2] = min(end, start + self.getpos()[0] - 1)

    parser = Blocks()
    parser.feed(markup)
    parser.close()
    for offset, first, last in reversed(parser.blocks):
        attrs = f' data-source-line="{first}" data-source-end="{last}"'
        markup = markup[:offset] + attrs + markup[offset:]
    return markup


def render(md: str, *, heading_ids: bool = True,
           source_map: bool = False) -> tuple[str, list[dict]]:
    """返回 (html, toc)。toc 为 [{level,text,id}]。

    source_map 仅供编辑器：顶层块带 data-source-line/data-source-end，均为
    传入正文的 1-based 行号、闭区间。默认关闭，不改变公开站点的 HTML。
    """
    lines = md.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    toc: list[dict] = []
    used_ids: dict[str, int] = {}

    def unique_id(text: str) -> str:
        base = slugify(text)
        if base in used_ids:
            used_ids[base] += 1
            return f"{base}-{used_ids[base]}"
        used_ids[base] = 0
        return base

    out: list[str] = []
    i = 0
    n = len(lines)

    def emit(markup: str, first: int, last: int, *, raw: bool = False) -> None:
        out.append(_map_source_block(markup, first + 1, min(n, last), raw=raw)
                   if source_map else markup)

    def flush_paragraph(buf: list[str]) -> None:
        if not buf:
            return
        text = "\n".join(buf).strip()
        # 整段就一条外链 -> 卡片（只有收录了标记的站点才转，见 _link_card）
        card = _link_card(text)
        emit(card or ("<p>" + inline(text) + "</p>"), para_start, para_start + len(buf))
        buf.clear()

    para: list[str] = []
    para_start = 0

    while i < n:
        line = lines[i]
        block_start = i

        # 空行
        if not line.strip():
            flush_paragraph(para)
            i += 1
            continue

        # 围栏代码
        m = FENCE.match(line)
        if m:
            flush_paragraph(para)
            indent, fence, lang, _rest = m.groups()
            body: list[str] = []
            i += 1
            close = re.compile(r"^\s*" + re.escape(fence[0]) + "{" + str(len(fence)) + r",}\s*$")
            while i < n and not close.match(lines[i]):
                body.append(lines[i])
                i += 1
            i += 1  # 跳过闭合行
            code = "\n".join(body)
            lang_name = (lang or "").strip()
            flags = {f.lower() for f in (_rest or "").split()}

            if lang_name.lower() == "mujoco":
                emit(render_mujoco((_rest or code).strip()), block_start, i)
                continue

            # ```js run —— 可运行示例：渲染成带「运行」按钮的沙箱面板
            if "run" in flags and lang_name.lower() in RUNNABLE_LANGS:
                emit(render_demo(code, lang_name.lower()), block_start, i)
                continue

            label = lang_name or "text"
            n_lines = len(body)
            # 折叠：短片段（≤7 行）给个折叠按钮纯属噪音 —— 七行代码在正文宽度下
            # 也就一屏多一点，按钮比代码本身还占地方；超过 24 行的默认先收起来，
            # 免得一篇长文被两屏代码撑开。具体收不收由 site.js 按这个属性决定。
            #
            # 行数**每个代码块都写**（`data-lines`），不只是可折叠的那些：site.js 要用它
            # 判断收不收，探针要用它断言「8 行起才有按钮」这条边界。只在可折叠的块上写，
            # 短块的属性就缺省成 0，边界被改到 3 也不会有探针响。
            foldable = n_lines > 7
            lines_attr = ' data-lines="%d"' % n_lines
            fold_btn = (
                '<button class="code-fold" type="button" data-fold aria-expanded="true">'
                '<span data-fold-label>收起</span>'
                '<svg class="code-caret" viewBox="0 0 24 24" aria-hidden="true">'
                '<path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" '
                'stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
            ) if foldable else ""
            emit(
                '<div class="code-block" data-lang="' + html.escape(label, quote=True) + '"'
                + lines_attr + ">"
                '<div class="code-head"><span class="code-lang">' + _esc(label) + "</span>"
                '<div class="code-tools">' + fold_btn
                + '<button class="code-copy" type="button" data-copy aria-label="复制代码">'
                '<span data-copy-label>复制</span></button></div></div>'
                f'<pre class="code-pre"><code class="language-{html.escape(label, quote=True)}">'
                f"{highlight(code, lang_name)}</code></pre>"
                '<button class="code-more" type="button" data-fold aria-label="展开全部代码" hidden>'
                '<span data-fold-more>展开全部</span></button></div>', block_start, i
            )
            continue

        # 公式块
        if line.strip().startswith("$$"):
            flush_paragraph(para)
            body = [line.strip()[2:]]
            if body[0].endswith("$$") and len(body[0]) > 2:
                body = [body[0][:-2]]
                i += 1
            else:
                i += 1
                while i < n and "$$" not in lines[i]:
                    body.append(lines[i])
                    i += 1
                if i < n:
                    tail = lines[i]
                    body.append(tail[:tail.index("$$")])
                    i += 1
            tex = "\n".join(body).strip()
            emit(render_math_block(tex), block_start, i)
            continue

        # 标题
        m = HEADING.match(line)
        if m:
            flush_paragraph(para)
            level = len(m.group(1))
            text = m.group(2).strip()
            hid = unique_id(text) if heading_ids else ""
            attr = f' id="{hid}"' if hid else ""
            anchor = (f'<a class="heading-anchor" href="#{hid}" aria-label="锚点">#</a>'
                      if hid else "")
            emit(f"<h{level}{attr}>{inline(text)}{anchor}</h{level}>", block_start, i + 1)
            if level in (2, 3, 4):
                toc.append(dict(level=level, text=re.sub(r"<[^>]+>", "", text), id=hid))
            i += 1
            continue

        # 分隔线
        if HR.match(line):
            flush_paragraph(para)
            emit("<hr>", block_start, i + 1)
            i += 1
            continue

        # 整行原始 HTML（作者可信，且来源是白名单外的完整标签，比如
        # `<img class="float-right" src="…">`）。只认「整行就是一个标签」这一种形态：
        # 行内混排的原始 HTML 一律走 inline() 的白名单，不会漏出去。
        # 会吞后续行的块级开标签（`<figure>` `<svg>` `<div>`…）**不在这里处理**，
        # 放给下面的块级分支 —— 否则内联插图的内容会被逐行当成普通文字转义掉。
        if RAW_BLOCK.match(line) and not HTML_BLOCK_OPEN.match(line):
            flush_paragraph(para)
            bare = RAW_TAG.fullmatch(line.strip())
            # 光秃秃的单个标签仍然走白名单：`</blue>` 必须变成 `</span>`，
            # 原样吐出去的话会关不掉 inline() 生成的 <span>。
            # 白名单外的（`<div>`、`<hr>`…）raw_html_tag 返回 None，此时原样输出。
            fixed = raw_html_tag(bare) if bare else None
            emit(fixed if fixed is not None else line.strip(), block_start, i + 1, raw=True)
            i += 1
            continue

        # 并排图：整行都是图片时并排渲染。**2 张起**，单张仍然走普通段落 ——
        # 单图也套一层网格的话，那圈为对齐准备的外边距会把正文的间距顶开。
        media = parse_media_line(line)
        if media is not None and len(media) >= 2:
            flush_paragraph(para)
            emit(render_media_grid(media), block_start, i + 1)
            i += 1
            continue

        # 容器 ::: note 标题
        m = CONTAINER_OPEN.match(line)
        if m:
            flush_paragraph(para)
            kind, title = m.group(1).lower(), m.group(2).strip()
            body: list[str] = []
            i += 1
            depth = 1
            while i < n:
                if CONTAINER_OPEN.match(lines[i]):
                    depth += 1
                if lines[i].strip() == ":::":
                    depth -= 1
                    if depth == 0:
                        i += 1
                        break
                body.append(lines[i])
                i += 1
            if kind in GALLERY_KINDS:
                emit(_render_gallery(body, title, line), block_start, i)
                continue
            inner_html, _ = render("\n".join(body), heading_ids=False)
            cls, default_title = CONTAINERS.get(kind, ("note", "提示"))
            t = title or default_title
            emit(
                f'<aside class="callout callout-{cls}">'
                f'<div class="callout-title">{_esc(t)}</div>'
                f'<div class="callout-body">{inner_html}</div></aside>', block_start, i
            )
            continue

        # 引用
        if QUOTE.match(line):
            flush_paragraph(para)
            body = []
            while i < n and (QUOTE.match(lines[i]) or (body and lines[i].strip())):
                qm = QUOTE.match(lines[i])
                body.append(qm.group(1) if qm else lines[i])
                i += 1
                if i < n and not QUOTE.match(lines[i]) and not lines[i].strip():
                    break
            inner_html, _ = render("\n".join(body), heading_ids=False)
            emit(f"<blockquote>{inner_html}</blockquote>", block_start, i)
            continue

        # 表格
        if "|" in line and i + 1 < n and TABLE_SEP.match(lines[i + 1]):
            flush_paragraph(para)
            header = _split_row(line)
            aligns = []
            for cell in _split_row(lines[i + 1]):
                c = cell.strip()
                if c.startswith(":") and c.endswith(":"):
                    aligns.append("center")
                elif c.endswith(":"):
                    aligns.append("right")
                elif c.startswith(":"):
                    aligns.append("left")
                else:
                    aligns.append("")
            i += 2
            rows = []
            while i < n and "|" in lines[i] and lines[i].strip():
                rows.append(_split_row(lines[i]))
                i += 1
            emit('<div class="table-wrap" tabindex="0" role="region" aria-label="表格，可横向滚动"><table>', block_start, i)
            out.append("<thead><tr>" + "".join(
                f'<th{f" style=\"text-align:{aligns[j]}\"" if j < len(aligns) and aligns[j] else ""}>'
                f"{inline(h.strip())}</th>" for j, h in enumerate(header)) + "</tr></thead>")
            out.append("<tbody>")
            for r in rows:
                out.append("<tr>" + "".join(
                    f'<td{f" style=\"text-align:{aligns[j]}\"" if j < len(aligns) and aligns[j] else ""}>'
                    f"{inline(c.strip())}</td>" for j, c in enumerate(r)) + "</tr>")
            out.append("</tbody></table></div>")
            continue

        # 列表
        if UL.match(line) or OL.match(line):
            flush_paragraph(para)
            items, i = _parse_list(lines, i)
            emit(_render_list(items), block_start, i)
            continue

        # 独立成行的视频：`![说明](xxx.mp4)`。
        # 必须在行内解析之前拦下来 —— 行内那套只会吐出一个 `<img src="x.mp4">`，
        # 浏览器把它当坏图片显示成一个破图图标。海报帧按同名 `.jpg` 约定取，
        # 由迁移脚本抽首帧生成；没有也能播，只是先黑一下。
        mv = VIDEO_LINE.match(line)
        if mv:
            flush_paragraph(para)
            emit(render_video(mv.group(2), mv.group(1), mv.group(3) or ""), block_start, i + 1)
            i += 1
            continue

        # 原样 HTML 块。**只列真正的块级标签**：
        # 这里会把后续所有非空行一起吞掉，所以 `br` / `img` / `hr` 这种行内元素
        # 绝不能放进来 —— 迁进来的文档里有 `<br><br>` 后面紧跟 `> 引用` 的写法，
        # 一旦 `br` 触发块级吞噬，那一行引用会被当成 HTML 原文吐出去
        # （表现是页面上真的显示一个「>」和一对星号）。
        # 单行的 `<img …>` / `<hr>` / `<br>` 由 RAW_BLOCK 兜住（见下）。
        if HTML_BLOCK_OPEN.match(line):
            flush_paragraph(para)
            body = [line]
            i += 1
            while i < n and lines[i].strip():
                body.append(lines[i])
                i += 1
            emit("\n".join(body), block_start, i, raw=True)
            continue

        if not para:
            para_start = i
        para.append(line)
        i += 1

    flush_paragraph(para)
    return "\n".join(out), toc


def _split_row(line: str) -> list[str]:
    """按 `|` 切表格行。

    **`$…$` 里的 `|` 不算分隔符。** 绝对值、范数这类公式天生带竖线
    （`$|\\tau_j| \\le \\tau_j^{\\max}$`），照切就废了：一个格子拿到 `$`、
    另一个拿到剩下的公式，页面上就是一对裸美元符号 —— 而且只有盯着渲染结果
    才看得出来（构建、链接检查、字体检查全都不响）。
    """
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    parts, buf, esc, in_math = [], [], False, False
    for ch in s:
        if esc:
            buf.append(ch)
            esc = False
        elif ch == "\\":
            esc = True
            buf.append(ch)
        elif ch == "$":
            in_math = not in_math
            buf.append(ch)
        elif ch == "|" and not in_math:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    return parts


def _parse_list(lines: list[str], i: int) -> tuple[list, int]:
    """返回 (items, next_i)。item = {ordered, checked, text, children}"""
    n = len(lines)
    base_indent = None
    items: list[dict] = []

    while i < n:
        line = lines[i]
        if not line.strip():
            # 空行后若下一个非空行仍是「同类型」列表项，继续；换类型则视为新列表
            j = i + 1
            while j < n and not lines[j].strip():
                j += 1
            if j < n:
                nxt = lines[j]
                nm = UL.match(nxt) or OL.match(nxt)
                same_type = nm is not None and bool(OL.match(nxt)) == items[0]["ordered"]
                if same_type and (len(nxt) - len(nxt.lstrip())) >= (base_indent or 0):
                    i = j
                    continue
            break

        mu, mo = UL.match(line), OL.match(line)
        m = mu or mo
        if not m:
            # 可能是子列表的续行缩进
            indent = len(line) - len(line.lstrip())
            if items and indent > (base_indent or 0):
                sub, i = _parse_list(lines, i)
                items[-1]["children"].extend(sub)
                continue
            break

        indent = len(m.group(1))
        if base_indent is None:
            base_indent = indent
        elif indent < base_indent:
            break
        elif items and indent > base_indent:
            # 更深缩进的列表 -> 作为上一项的子树
            sub, i = _parse_list(lines, i)
            items[-1]["children"].extend(sub)
            continue
        elif items and bool(mo) != items[0]["ordered"]:
            # 同层级但换了标记类型 -> 新列表开始
            break

        text = m.group(3)
        checked = None
        cm = re.match(r"^\[([ xX])\]\s+(.*)$", text)
        if cm:
            checked = cm.group(1).lower() == "x"
            text = cm.group(2)

        items.append(dict(ordered=bool(mo), checked=checked, text=text, children=[],
                          # 记住写下来的序号：CommonMark 规定有序列表的**第一个编号**
                          # 就是起始值，`3.` 开头要渲染成 `<ol start="3">`。
                          # 幻灯片里的分步会把一个列表拆成好几段（每步之间隔着 `--`），
                          # 丢掉起始值的话每一段都从 1 开始 —— 页面上就是「1. 1. 1.」。
                          start=int(m.group(2)) if mo else None))
        i += 1

        # 收集该条目的续行 / 子列表
        cont: list[str] = []
        while i < n:
            nxt = lines[i]
            if not nxt.strip():
                break
            if UL.match(nxt) or OL.match(nxt):
                ni = len(nxt) - len(nxt.lstrip())
                if ni > base_indent:
                    sub, i = _parse_list(lines, i)
                    items[-1]["children"].extend(sub)
                    continue
                break
            ni = len(nxt) - len(nxt.lstrip())
            if ni > base_indent:
                cont.append(nxt.strip())
                i += 1
                continue
            break
        if cont:
            items[-1]["text"] += "\n" + "\n".join(cont)

    return items, i


def _render_list(items: list[dict]) -> str:
    if not items:
        return ""
    ordered = items[0]["ordered"]
    tag = "ol" if ordered else "ul"
    has_task = any(it["checked"] is not None for it in items)
    cls = ' class="task-list"' if has_task else ""
    # 起始编号不是 1 时要显式写出来（`<ol start="3">`），否则浏览器一律从 1 数起
    start = items[0].get("start") if ordered else None
    start_attr = f' start="{start}"' if start and start != 1 else ""
    parts = [f"<{tag}{cls}{start_attr}>"]
    for it in items:
        body = inline(it["text"])
        attrs = ""
        if it["checked"] is not None:
            mark = "checked" if it["checked"] else ""
            body = (f'<input type="checkbox" disabled {mark}> ' + body)
            attrs = ' class="task-item"'
        parts.append(f"<li{attrs}>{body}")
        if it["children"]:
            parts.append(_render_list(it["children"]))
        parts.append("</li>")
    parts.append(f"</{tag}>")
    return "".join(parts)


def strip_fenced_code(md: str, *, runnable_only: bool = False) -> str:
    """Remove real fenced blocks without pairing shorter example fences.

    Reading estimates exclude runnable demos only; summaries exclude all fenced
    code. Fence languages, flags and closing markers follow render(), including
    its recursively rendered quotes/callouts. Unclosed fences end at the current
    container's end, so a quoted draft cannot swallow the following article.
    This helper does not render HTML or touch the page icon/source-map state.
    """
    lines = md.replace("\r\n", "\n").split("\n")

    def spans(part: list[str]):
        i, n = 0, len(part)
        while i < n:
            line = part[i]
            fence_match = FENCE.match(line)
            if fence_match:
                first = i
                _indent, fence, language, rest = fence_match.groups()
                flags = {flag.lower() for flag in rest.split()}
                runnable = (language.lower() in RUNNABLE_LANGS and "run" in flags) or language.lower() == "mujoco"
                close = re.compile(r"^\s*" + re.escape(fence[0]) + "{" + str(len(fence)) + r",}\s*$")
                i += 1
                while i < n and not close.match(part[i]):
                    i += 1
                if i < n:
                    i += 1
                if not runnable_only or runnable:
                    yield first, i
                continue

            # A fence-looking line inside display math is still formula text.
            if line.strip().startswith("$$"):
                inline_math = line.strip()[2:]
                i += 1
                if not (inline_math.endswith("$$") and len(inline_math) > 2):
                    while i < n and "$$" not in part[i]:
                        i += 1
                    if i < n:
                        i += 1
                continue

            container = CONTAINER_OPEN.match(line)
            if container:
                body, depth = [], 1
                i += 1
                body_start = i
                while i < n:
                    if CONTAINER_OPEN.match(part[i]):
                        depth += 1
                    if part[i].strip() == ":::":
                        depth -= 1
                        if depth == 0:
                            i += 1
                            break
                    body.append(part[i])
                    i += 1
                if container.group(1).lower() not in GALLERY_KINDS:
                    for first, last in spans(body):
                        yield body_start + first, body_start + last
                continue

            if QUOTE.match(line):
                body, body_start = [], i
                while i < n and (QUOTE.match(part[i]) or (body and part[i].strip())):
                    quote = QUOTE.match(part[i])
                    body.append(quote.group(1) if quote else part[i])
                    i += 1
                    if i < n and not QUOTE.match(part[i]) and not part[i].strip():
                        break
                for first, last in spans(body):
                    yield body_start + first, body_start + last
                continue

            if "|" in line and i + 1 < n and TABLE_SEP.match(part[i + 1]):
                i += 2
                while i < n and "|" in part[i] and part[i].strip():
                    i += 1
                continue

            if UL.match(line) or OL.match(line):
                # List continuation text is parsed inline, not recursively as
                # block Markdown. An indented `js run` example is not a demo.
                _items, i = _parse_list(part, i)
                continue

            # Raw HTML is not interpreted as Markdown until the next blank line.
            if HTML_BLOCK_OPEN.match(line):
                i += 1
                while i < n and part[i].strip():
                    i += 1
                continue
            i += 1

    filtered = list(lines)
    for first, last in spans(lines):
        filtered[first:last] = [""] * (last - first)
    return "\n".join(filtered)


def to_text(md: str, limit: int = 0) -> str:
    """粗略抽取纯文本（用于摘要 / 搜索索引）。"""
    t = strip_fenced_code(md)
    t = re.sub(r"\$\$[\s\S]*?\$\$", " ", t)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[*_`>#~|-]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:limit] if limit else t
