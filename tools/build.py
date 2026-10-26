"""静态博客生成器（零第三方依赖）。

    python tools/build.py            # 构建到 public/
    python tools/build.py --clean    # 先清空输出目录
    python tools/build.py --serve    # 构建后起本地预览服务器
    python tools/build.py --drafts   # 包含草稿
    python tools/build.py --base /repo   # 部署到子路径

内容约定
--------
content/posts/*.md      front-matter: title, date, updated?, tags[], summary?, cover?,
                        featured?, draft?, slug?
content/projects/*.md   front-matter: title, tagline, date, tags[], stack[],
                        links[{label,href}], status?, cover?, featured?, order?
content/pages/*.md      任意页面，slug = 文件名
"""
from __future__ import annotations

import datetime as dt
import html
import json
import os
import posixpath
import re
import shutil
import stat
import sys
import time
import zlib
from html.parser import HTMLParser

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import palette                                    # noqa: E402
import mdparse                                    # noqa: E402
import siteicons                                  # noqa: E402
import deck as deckparse                          # noqa: E402
import docfigs                                    # noqa: E402
from tmpl import Engine                           # noqa: E402

TEMPLATES = os.path.join(ROOT, "theme", "templates")
STATIC = os.path.join(ROOT, "theme", "static")
CONTENT = os.path.join(ROOT, "content")


# ---------------------------------------------------------------- 基础工具

def load_config() -> dict:
    with open(os.path.join(ROOT, "site.config.json"), encoding="utf-8") as fh:
        cfg = json.load(fh)
    appearance = cfg.setdefault("appearance", {})
    # Older configs only offered an on/off switch; keep an explicit opt-out.
    appearance.setdefault("defaultCursor", "glow" if appearance.get("customCursor", True) else "off")
    if appearance["defaultCursor"] not in ("glow", "on", "off"):
        raise ValueError("appearance.defaultCursor 必须为 glow、on 或 off")
    return cfg


def output_directory(value: str, root: str = ROOT) -> str:
    """只允许项目内独立的输出目录，避免构建或清理覆盖源码及链接目标。"""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("build.outDir 必须是项目内的独立目录")
    root = os.path.realpath(root)
    target = os.path.abspath(os.path.join(root, value))
    resolved = os.path.realpath(target)
    try:
        inside = os.path.commonpath([root, resolved]) == root and resolved != root
    except ValueError:
        inside = False
    if not inside or os.path.normcase(target) != os.path.normcase(resolved):
        raise ValueError(f"不安全的输出目录（越界、项目根目录或目录链接）：{value}")
    parts = os.path.relpath(resolved, root).lower().split(os.sep)
    if parts[0] in {"content", "theme", "assets", "tools", "docs", ".blog-history"} or \
            any(part in {".git", ".agents", ".codex"} for part in parts):
        raise ValueError(f"输出目录不能覆盖项目源码：{value}")
    if os.path.lexists(target) and not os.path.isdir(target):
        raise ValueError(f"输出路径不是目录：{value}")
    return target


def clean_output_directory(value: str, root: str = ROOT) -> None:
    """保留输出仓库的 Git 元数据；任何残留文件都应阻止发布。"""
    target = output_directory(value, root)
    if not os.path.isdir(target):
        return
    # 不删除输出目录本身；.git 也可能是 linked worktree 使用的普通文件。
    for name in os.listdir(target):
        if name.lower() == ".git":
            continue
        path = os.path.join(target, name)
        for attempt in range(4):
            try:
                info = os.lstat(path)
                reparse = getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
                if os.path.islink(path):
                    os.unlink(path)
                elif reparse and stat.S_ISDIR(info.st_mode):
                    os.rmdir(path)  # Windows junction：仅移除入口，不遍历其目标。
                elif stat.S_ISDIR(info.st_mode):
                    shutil.rmtree(path)
                else:
                    os.remove(path)
                break
            except FileNotFoundError:
                break
            except OSError as exc:
                if attempt == 3:
                    raise OSError(f"清理输出目录失败，构建已中止：{path}（{exc}）") from exc
                time.sleep(0.4)


def parse_date(value):
    if not value:
        return None
    if isinstance(value, dt.date):
        return value
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def fmt_date(d, lang: str = "zh") -> str:
    if not d:
        return ""
    if lang.startswith("zh"):
        return f"{d.year} 年 {d.month} 月 {d.day} 日"
    return d.strftime("%b %d, %Y")


def iso_date(d) -> str:
    return d.isoformat() if d else ""


CJK = re.compile(r"[\u3000-\u9fff\uff00-\uffef]")


def reading_time(md_text: str) -> int:
    """中文按 380 字/分钟，英文按 200 词/分钟；交互示例源码不计时。"""
    # Demo source drives a visual interaction; ordinary teaching code remains
    # part of the estimate. Admin lists/previews import this same function.
    md_text = mdparse.strip_fenced_code(md_text, runnable_only=True)
    cjk = len(CJK.findall(md_text))
    words = len(re.findall(r"[A-Za-z0-9_]+", md_text))
    return max(1, round(cjk / 380 + words / 200))


def _auto_summary(plain: str, limit: int = 120) -> str:
    s = plain.strip()
    if len(s) <= limit:
        return s
    cut = s[:limit]
    for sep in ("。", "！", "？", ". ", "；", "，", ", "):
        idx = cut.rfind(sep)
        if idx > limit * 0.5:
            return cut[: idx + len(sep)].strip()
    return cut.rstrip() + "…"


_IMG_SIZE_CACHE: dict[str, tuple[int, int] | None] = {}


def image_size(rel: str) -> tuple[int, int] | None:
    """读图片的像素尺寸，用来给 <img> 补 width/height —— 没有它浏览器在图片
    到达前不知道该留多高，卡片会集体跳一下（CLS）。读不到就返回 None，
    模板里退化成只有 aspect-ratio 的占位。"""
    if not rel or rel.startswith(("http://", "https://", "/", "data:")):
        return None
    if rel in _IMG_SIZE_CACHE:
        return _IMG_SIZE_CACHE[rel]
    size = None
    path = os.path.join(ROOT, rel)
    if os.path.isfile(path):
        try:
            from PIL import Image
            with Image.open(path) as im:
                size = (im.width, im.height)
        except Exception:  # noqa: BLE001 —— 装饰性信息，读不到不算错误
            size = None
    _IMG_SIZE_CACHE[rel] = size
    return size


def with_cover_fields(item: dict) -> dict:
    """把封面相关的派生字段补齐（尺寸、焦点、alt）。

    front-matter 里可用的键：
        cover       封面图（相对仓库根的路径）
        coverPos    裁切焦点，CSS object-position 语法，如 "50% 30%"
        coverAlt    替代文本；不写就是空（当作装饰性背景图，读屏跳过）
    """
    cover = str(item.get("cover") or "")
    item["cover"] = cover
    size = image_size(cover) if cover else None
    item["cover_w"] = size[0] if size else 0
    item["cover_h"] = size[1] if size else 0
    item["cover_ratio"] = (round(size[0] / size[1], 4) if size else 0)
    pos = str(item.get("coverPos") or "").strip()
    item["cover_pos"] = pos if pos else "50% 50%"
    item["cover_alt"] = str(item.get("coverAlt") or "").strip()
    # 竖图/方图当 16:9 卡片封面时会被裁掉一大半，横图才适合「宽幅头图」的观感
    item["cover_wide"] = bool(size and size[0] / size[1] >= 1.5)
    # 小图（比如 240x240 的 gif）拉满整块头图会糊成马赛克。
    # 这类封面走「柔化底图」：高斯模糊之后当色彩底，像素块反而看不太出来。
    item["cover_hd"] = bool(size and size[0] >= 1200)
    return item


def strip_wallpaper_covers(items: list[dict], themes: list[dict]) -> None:
    """无壁纸构建只摘掉共用的主题壁纸，保留文章、项目和页面自己的封面。"""
    def path_key(value) -> str:
        return posixpath.normpath(str(value or "").strip().replace("\\", "/")).lstrip("/")

    backgrounds = {path_key(theme["bg"]) for theme in themes if theme.get("bg")}
    for item in items:
        cover = path_key(item.get("cover"))
        if cover.startswith("assets/bg/") or cover in backgrounds:
            item["cover"] = ""


def toc_tree(items: list[dict]) -> list[dict]:
    """把扁平的目录（带 level）折成树。

    `mdparse.render` 给的是一串 `{level, text, id}`，级别是 2/3/4。
    一个 h2 的「子节点」就是它之后、直到下一个同级或更高级标题之前的那些条目 ——
    用栈走一遍即可。折成树之后才能做**分层收起**：
    `.toc-item.is-collapsed > ul { display: none }` 一收就是一整节。
    """
    root: list[dict] = []
    stack: list[dict] = []
    for it in items:
        node = dict(it, children=[])
        while stack and stack[-1]["level"] >= node["level"]:
            stack.pop()
        (stack[-1]["children"] if stack else root).append(node)
        stack.append(node)
    return root


def toc_html(nodes: list[dict]) -> str:
    """把目录树渲染成嵌套 <ul>。有子节点的行前面放一个折叠按钮，叶子放占位块对齐。"""
    if not nodes:
        return ""
    out = ['<ul class="toc-list">']
    for n in nodes:
        kids = n["children"]
        cls = "toc-item toc-l%d%s" % (n["level"], " has-kids" if kids else "")
        out.append('<li class="%s">' % cls)
        out.append('<div class="toc-row">')
        if kids:
            out.append(
                '<button class="toc-node" type="button" data-toc-node aria-expanded="true"'
                ' aria-label="折叠这一节">'
                '<svg class="toc-caret-sm" viewBox="0 0 24 24" aria-hidden="true">'
                '<path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.6"'
                ' stroke-linecap="round" stroke-linejoin="round"/></svg></button>')
        else:
            out.append('<span class="toc-dot" aria-hidden="true"></span>')
        out.append('<a href="#%s">%s</a>' % (html.escape(str(n["id"]), quote=True),
                                             html.escape(str(n["text"]))))
        out.append('</div>')
        if kids:
            out.append(toc_html(kids))
        out.append('</li>')
    out.append('</ul>')
    return "".join(out)


def prefix_content_links(markup: str, base_path: str) -> str:
    """Prefix real root-relative anchors, never code examples or JSON scripts."""
    base = str(base_path or "").rstrip("/")
    if not base:
        return markup
    line_offsets, offset = [], 0
    for line in markup.splitlines(keepends=True):
        line_offsets.append(offset)
        offset += len(line)
    changes = []

    class Links(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag != "a":
                return
            href = dict(attrs).get("href") or ""
            if not href.startswith("/") or href.startswith("//") or href == base or href.startswith(base + "/"):
                return
            original = self.get_starttag_text()
            rewritten = re.sub(r'\bhref\s*=\s*([\'\"])(.*?)\1',
                               lambda match: 'href=' + match[1] + html.escape(base + href, quote=True) + match[1],
                               original, count=1, flags=re.I | re.S)
            if original != rewritten:
                line, column = self.getpos()
                start = line_offsets[line - 1] + column
                changes.append((start, len(original), rewritten))

    parser = Links(convert_charrefs=False)
    parser.feed(markup)
    parser.close()
    for start, length, replacement in reversed(changes):
        markup = markup[:start] + replacement + markup[start + length:]
    return markup


def load_collection(kind: str, cfg: dict) -> list[dict]:
    """读取 content/<kind>/*.md -> 规范化条目列表。"""
    folder = os.path.join(CONTENT, kind)
    if not os.path.isdir(folder):
        return []
    lang = cfg["site"]["lang"]
    items = []
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(folder, name)
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        meta, body = mdparse.parse_front_matter(raw)
        if meta.get("draft") and not cfg["build"].get("includeDrafts"):
            continue
        slug = str(meta.get("slug") or os.path.splitext(name)[0])
        html_body, toc = mdparse.render(body)
        html_body = mdparse.mujoco_tool_links(html_body, cfg["build"].get("basePath", ""))
        html_body = prefix_content_links(html_body, cfg["build"].get("basePath", ""))
        # 正文里用到的站点图标，一页内联一份 SVG 精灵（同页重复出现只内联一次）
        icons = siteicons.sprite(mdparse.take_icons())
        plain = mdparse.to_text(body)
        date = parse_date(meta.get("date"))
        tags = [str(t) for t in (meta.get("tags") or [])]
        item = dict(meta)
        item.update(
            slug=slug,
            url=f"/{slug}/" if kind == "pages" else f"/{kind}/{slug}/",
            html=html_body,
            toc=toc,
            site_icons=icons,
            plain=plain,
            date_obj=date,
            date=iso_date(date),
            date_text=fmt_date(date, lang),
            updated=iso_date(parse_date(meta.get("updated"))),
            updated_text=fmt_date(parse_date(meta.get("updated")), lang),
            tags=tags,
            summary=str(meta.get("summary") or "").strip() or _auto_summary(plain),
            minutes=reading_time(body),
            has_math=("$" in body),
            archived=bool(meta.get("archived")),
            source=os.path.relpath(path, ROOT).replace("\\", "/"),
        )
        with_cover_fields(item)
        items.append(item)
    items.sort(key=lambda i: (i.get("order") if isinstance(i.get("order"), int) else 999,
                              -(i["date_obj"].toordinal() if i["date_obj"] else 0)))
    return items


def load_docs(cfg: dict) -> tuple[list[dict], list[dict], list[str]]:
    """返回 (全部文档, 课程分组, 找不到的插图)。"""
    """读取 content/docs/*.md -> (全部文档, 课程分组)。

    和 posts/projects 不一样，文档没有日期（源幻灯片本来就没有），排序完全靠
    front-matter 的 order；正文是 reveal 风格的幻灯片，交给 deck 模块切页。
    """
    folder = os.path.join(CONTENT, "docs")
    collections = []
    for i, c in enumerate(cfg.get("docs", {}).get("collections", [])):
        collections.append(dict(
            c, order=int(c.get("order", i + 1)),
            docs=[], pending=list(c.get("pending", [])), refs=list(c.get("refs", [])),
            url=f"/docs/{c['id']}/", count=0))
    by_id = {c["id"]: c for c in collections}
    if not os.path.isdir(folder):
        return [], sorted(collections, key=lambda c: c["order"]), []

    items: list[dict] = []
    missing_figs: list[str] = []
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(folder, name)
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        meta, body = mdparse.parse_front_matter(raw)
        if meta.get("draft") and not cfg["build"].get("includeDrafts"):
            continue
        slug = str(meta.get("slug") or os.path.splitext(name)[0])
        # 插图先展开成内联 SVG 再切幻灯片：图是块级 HTML，
        # 必须和它所属的那一页一起被切开（见 tools/docfigs.py）。
        body, gone = docfigs.expand_figures(body)
        missing_figs.extend(f"{slug}: {m}" for m in gone)
        parsed = deckparse.parse(body)
        base = cfg["build"].get("basePath", "").rstrip("/")
        for i, s in enumerate(parsed["slides"]):
            s["index"] = i
            s["is_section"] = (s["kind"] == "h")
            # 幻灯片里的图片/代码引用写的是仓库相对路径（assets/docs/…），
            # 页面在 /docs/<slug>/ 下，相对路径会解析到 /docs/<slug>/assets/… 去。
            # 这里统一补上站点根（含 basePath），子路径部署也不会断。
            s["html"] = re.sub(r'(?<=["\'])assets/', base + "/assets/", s["html"])
            s["html"] = mdparse.mujoco_tool_links(s["html"], base)
            s["html"] = prefix_content_links(s["html"], base)
        plain = mdparse.to_text(body)
        # 文档是一页一张幻灯片渲染的（见 deck.py），精灵也是**整篇文档一份**：
        # 逐页各放一份会出现重复的 symbol id，而且每页都背上全部图标的体积。
        icons = siteicons.sprite(mdparse.take_icons())
        cid = str(meta.get("collection") or "")
        col = by_id.get(cid)
        item = dict(meta)
        item.update(
            slug=slug,
            url=f"/docs/{slug}/",
            slides=parsed["slides"],
            sections=parsed["sections"],
            slide_count=parsed["count"],
            site_icons=icons,
            plain=plain,
            words=len(re.sub(r"\s+", "", plain)),
            tags=[str(t) for t in (meta.get("tags") or [])],
            summary=str(meta.get("summary") or "").strip() or _auto_summary(plain),
            collection=cid,
            collection_title=col["title"] if col else cid,
            collection_url=col["url"] if col else "/docs/",
            order=int(meta.get("order") or 999),
            toc=[dict(idx=i, title=s["title"], section=(s["kind"] == "h"))
                 for i, s in enumerate(parsed["slides"]) if s["title"]],
            source=os.path.relpath(path, ROOT).replace("\\", "/"),
            # 正文里引用到的站内文件（图片、代码），供 _copy_referenced 兜底拷贝。
            # 从**原始 markdown** 里抓，而不是抓改写后的 html：改写会加上 basePath 前缀。
            assets=sorted(set(re.findall(r'(?:src="|href="|\]\()(assets/[^)"\s]+)', body))),
        )
        items.append(item)
        if col is not None:
            col["docs"].append(item)

    for col in collections:
        col["docs"].sort(key=lambda d: (d["order"], d["slug"]))
        for i, d in enumerate(col["docs"]):
            d["index"] = i + 1
            d["sibling_count"] = len(col["docs"])
            d["prev_doc"] = col["docs"][i - 1] if i > 0 else None
            d["next_doc"] = col["docs"][i + 1] if i + 1 < len(col["docs"]) else None
        col["count"] = len(col["docs"])
        col["slide_total"] = sum(d["slide_count"] for d in col["docs"])
        # 别人（首页/图谱/搜索）要用的轻量副本，避免把 137 张幻灯片带得到处都是
        col["brief"] = [dict(slug=d["slug"], url=d["url"], title=d["title"],
                             summary=d["summary"], slide_count=d["slide_count"],
                             order=d["order"], index=d["index"]) for d in col["docs"]]
        col["pending_count"] = len(col["pending"])
    collections.sort(key=lambda c: c["order"])
    items.sort(key=lambda d: (next((c["order"] for c in collections
                                    if c["id"] == d["collection"]), 99), d["order"]))
    for i, d in enumerate(items):
        d["global_index"] = i + 1
    return items, collections, missing_figs


def resolve_avatar(cfg: dict) -> str:
    """头像路径容错：配置里的文件不存在时，退回 assets/images/avatar.*。"""
    raw = str(cfg["site"].get("avatar") or "").strip()
    if raw and os.path.isfile(os.path.join(ROOT, raw)):
        return raw
    img_dir = os.path.join(ROOT, "assets", "images")
    if os.path.isdir(img_dir):
        for name in sorted(os.listdir(img_dir)):
            stem, ext = os.path.splitext(name)
            if stem in ("avatar", "portrait", "me") and ext.lower() in (
                    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"):
                return f"assets/images/{name}"
    return ""


def url_for(cfg: dict, path: str) -> str:
    base = cfg["build"].get("basePath", "").rstrip("/")
    if path.startswith("http"):
        return path
    return base + (path if path.startswith("/") else "/" + path)


def abs_url(cfg: dict, path: str) -> str:
    return cfg["site"]["url"].rstrip("/") + url_for(cfg, path)


def write_file(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def collect_redirects(items: list[dict], reserved: set[str]) -> dict[str, str]:
    """Validate aliases before any output is cleaned or written."""
    redirects: dict[str, str] = {}
    occupied = {route.casefold() for route in reserved}
    for item in items:
        aliases = item.get("aliases") or []
        if not isinstance(aliases, list):
            raise ValueError(f"{item['url']} 的 aliases 必须是旧路径数组")
        for alias in aliases:
            if not isinstance(alias, str) or not re.fullmatch(r"/(?:[\w-][\w.-]*/)+", alias):
                raise ValueError(f"无效旧路径：{alias!r}，请使用 /posts/old-name/ 形式")
            if any(part.endswith('.') or re.fullmatch(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", part, re.I)
                   for part in alias.strip('/').split('/')):
                raise ValueError(f"旧路径含保留的系统名称：{alias}")
            if alias == item["url"]:
                continue
            key = alias.casefold()
            segments = alias.strip('/').casefold().split('/')
            if key.startswith('/posts/page/') or 'index.html' in segments or segments[0] in {
                    '404.html', 'feed.xml', 'sitemap.xml', 'robots.txt', 'search-index.json'}:
                raise ValueError(f"旧路径不能占用构建文件或分页目录：{alias}")
            if alias.split('/')[1].casefold() in {"assets", "content", "theme", "tools"}:
                raise ValueError(f"旧路径不能占用资源目录：{alias}")
            if key in occupied or any(a.casefold() == key and dest != item["url"]
                                      for a, dest in redirects.items()):
                raise ValueError(f"旧路径与已有页面冲突：{alias}")
            redirects[alias] = item["url"]
    return redirects


def redirect_document(cfg: dict, target: str) -> str:
    destination = url_for(cfg, target)
    safe = html.escape(destination, quote=True)
    script_url = json.dumps(destination, ensure_ascii=False).replace('<', '\\u003c')
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="robots" content="noindex,follow">'
            '<title>页面已迁移</title><link rel="canonical" href="' +
            html.escape(abs_url(cfg, target), quote=True) + '">'
            '<noscript><meta http-equiv="refresh" content="0;url=' + safe + '"></noscript>'
            '<script>location.replace(' + script_url + ' + location.search + location.hash);</script>'
            '</head><body><p>页面地址已更新。<a href="' + safe + '">前往新页面</a></p></body></html>')


def minify_css(css: str) -> str:
    """极简 CSS 压缩。

    注意 `:` **不能**参与去空格：选择器里的 `a :hover`（后代）去掉空格就变成
    `a:hover`（伪类），语义直接变了。这里只压缩一定是安全的字符。
    """
    css = re.sub(r"/\*[\s\S]*?\*/", "", css)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};,>])\s*", r"\1", css)
    return css.replace(";}", "}").strip()


def minify_js(js: str) -> str:
    js = re.sub(r"^\s*//(?![^\n]*http)[^\n]*$", "", js, flags=re.M)
    js = re.sub(r"/\*[\s\S]*?\*/", "", js)
    js = re.sub(r"\n\s*\n+", "\n", js)
    return js.strip()


# ---------------------------------------------------------------- 主题 CSS

def build_themes_css(cfg: dict):
    """返回 (css, 主题元数据)。种子色在 site.config.json 的 themes[].seeds。"""
    manifest = {}
    mpath = os.path.join(ROOT, "assets", "bg", "manifest.json")
    if os.path.isfile(mpath):
        with open(mpath, encoding="utf-8") as fh:
            manifest = json.load(fh)

    metas = {}
    strip_bg = bool(cfg["build"].get("stripBackgrounds"))
    for t in cfg["themes"]:
        entry = manifest.get(t["id"]) or {}
        optimized = os.path.splitext(t["bg"])[0] + ".webp"
        background = optimized if os.path.isfile(os.path.join(ROOT, optimized)) else t["bg"]
        video_rel = ""
        if entry.get("video") and not strip_bg:
            video_rel = "bg/" + os.path.basename(entry["video"])
        metas[t["id"]] = {
            "lqip": "" if strip_bg else entry.get("lqip", ""),
            "bg": "" if strip_bg else background,
            "bg_rel": "" if strip_bg else "bg/" + os.path.basename(background),
            "video_rel": video_rel,
            "tokens": palette.derive(t["seeds"]),
            "name": t["name"],
            "nameEn": t.get("nameEn", t["id"]),
            "swatch": t.get("swatch", []),
        }

    def block(sel: str, theme: dict, mode: str) -> str:
        meta = metas[theme["id"]]
        # 剥离壁纸时不写 --bg-image，页面自然回落到纯渐变背景
        extra = {"--bg-image": "none"} if strip_bg else {"--bg-image": f'url("{meta["bg_rel"]}")'}
        body = "\n".join(f"  {k}: {v};" for k, v in {**meta["tokens"][mode], **extra}.items())
        return f"{sel} {{\n{body}\n}}"

    default_id = cfg["appearance"]["defaultTheme"]
    default_mode = cfg["appearance"]["defaultMode"]
    default_theme = next(t for t in cfg["themes"] if t["id"] == default_id)

    chunks = ["/* 由 tools/palette.py 从 site.config.json 的种子色自动推导，请勿手改 */", ""]
    chunks.append(block(":root", default_theme, default_mode))
    chunks.append("")
    for t in cfg["themes"]:
        for mode in ("dark", "light"):
            chunks.append(block(f'html[data-theme="{t["id"]}"][data-mode="{mode}"]', t, mode))
            chunks.append("")
    return "\n".join(chunks), metas


# ---------------------------------------------------------------- 构建器

def asset_version(cfg: dict) -> str:
    """Version the page bundle and all editable physics-tool code/model metadata."""
    checksum = zlib.crc32(json.dumps(cfg, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    paths = []
    for folder in ("css", "js"):
        directory = os.path.join(STATIC, folder)
        paths.extend(os.path.join(directory, name) for name in sorted(os.listdir(directory))
                     if os.path.isfile(os.path.join(directory, name)))
    tools_directory = os.path.join(ROOT, "assets", "tools", "ankle")
    for directory, dirs, names in os.walk(tools_directory):
        dirs.sort()
        paths.extend(os.path.join(directory, name) for name in sorted(names)
                     if os.path.splitext(name)[1].lower() in {".js", ".css", ".json", ".xml"})
    for path in paths:
        checksum = zlib.crc32(os.path.relpath(path, ROOT).replace("\\", "/").encode("utf-8"), checksum)
        with open(path, "rb") as asset:
            checksum = zlib.crc32(asset.read(), checksum)
    return format(checksum, "08x")


class Builder:
    def __init__(self, cfg: dict, clean: bool = False):
        self.asset_version = asset_version(cfg)
        self.cfg = cfg
        cfg["site"]["avatar"] = resolve_avatar(cfg)
        self.out = output_directory(cfg["build"]["outDir"])
        self.engine = Engine(TEMPLATES)
        self.posts = load_collection("posts", cfg)
        self.projects = load_collection("projects", cfg)
        self.pages = load_collection("pages", cfg)
        if cfg["build"].get("stripBackgrounds"):
            # 主题壁纸有时也被用作封面；上传或自定义的独立封面不受此开关影响。
            strip_wallpaper_covers(self.posts + self.projects + self.pages, cfg["themes"])
        self.docs, self.doc_collections, self.missing_figures = load_docs(cfg)
        if self.missing_figures:
            for m in self.missing_figures:
                print(f"  ! 插图找不到：{m}")

        # 归档 = 退出主列表与首页，但详情页/标签页/搜索/归档页仍在。
        self.archived_posts = [p for p in self.posts if p["archived"]]
        self.listed_posts = [p for p in self.posts if not p["archived"]]

        # 标签是站点级分类：文章与项目共用一套 slug。
        # slug 可能撞车（例如 "C++" 与 "C" 都会归一成 "c"），这里统一去重，
        # 并保证卡片链接与标签页目录用的是同一份映射。
        names = set()
        for it in self.posts + self.projects:
            names.update(it["tags"])
        self.tag_slugs: dict[str, str] = {}
        used: dict[str, str] = {}
        for name in sorted(names):
            base = mdparse.slugify(name)
            slug, n = base, 1
            while slug in used:
                n += 1
                slug = f"{base}-{n}"
            used[slug] = name
            self.tag_slugs[name] = slug
        for it in self.posts + self.projects:
            it["tag_links"] = [dict(name=t, slug=self.tag_slugs[t]) for t in it["tags"]]
            # 目录标题上要显示「N 节」，模板里不好数长度，这里先算好；
            # 同时折成树渲染成嵌套 <ul>，供「分层收起」用
            it["toc_count"] = len(it.get("toc") or [])
            it["toc_html"] = toc_html(toc_tree(it.get("toc") or []))

        self.tag_posts: dict[str, list[dict]] = {}
        self.tag_projects: dict[str, list[dict]] = {}
        for p in self.posts:
            for t in p["tags"]:
                self.tag_posts.setdefault(t, []).append(p)
        for p in self.projects:
            for t in p["tags"]:
                self.tag_projects.setdefault(t, []).append(p)
        self.all_tag_names = sorted(
            names,
            key=lambda n: (-(len(self.tag_posts.get(n, [])) + len(self.tag_projects.get(n, []))), n))
        self.tag_index = self.tag_posts  # 兼容旧引用

        reserved = {"/", "/posts/", "/projects/", "/docs/", "/tags/", "/archive/", "/graph/", "/lab/ankle/"}
        all_items = self.posts + self.projects + self.pages + self.docs
        if any(item["url"].casefold() == "/lab/ankle/" for item in all_items):
            raise ValueError("内容路径不能占用内置工具页面：/lab/ankle/")
        reserved.update(item["url"] for item in all_items)
        reserved.update(c["url"] for c in self.doc_collections)
        reserved.update(f"/tags/{slug}/" for slug in self.tag_slugs.values())
        self.redirects = collect_redirects(all_items, reserved)

        self.themes_css, self.theme_meta = build_themes_css(cfg)
        self.footer = self.footer_data()
        cfg["build"]["mathLocal"] = os.path.isfile(
            os.path.join(ROOT, "assets", "vendor", "katex", "katex.min.js"))
        # 注意：theme-meta 是给浏览器 JS 用的，路径必须是站点根路径（assets/...），
        # 不能沿用 CSS 里相对 themes.css 的写法（bg/...），否则会拼成 /bg/xxx.mp4 而 404。
        self.theme_meta_json = json.dumps(
            {tid: dict(name=m["name"], nameEn=m["nameEn"], swatch=m["swatch"],
                       bg=m["bg"],
                       video=("assets/" + m["video_rel"]) if m["video_rel"] else "")
             for tid, m in self.theme_meta.items()},
            ensure_ascii=False, separators=(",", ":"))
        self.written: list[str] = []
        if clean:
            self._clean_out()

    def _clean_out(self) -> None:
        clean_output_directory(self.out)

    # -- 上下文 -------------------------------------------------------
    def footer_data(self) -> dict:
        """页脚要用的东西，构建期算一次。

        页脚以前只有「导航 / 联系 / 站点」三列死链接，每页都一模一样，
        而且不含任何"这座站里有什么"的信息。现在给它：最新几篇、几门课、
        站点统计、字体与构建方式的出处 —— 全是构建期就知道的真数据，
        不写死、也不用前端再拉一次接口。
        """
        latest = [dict(title=p["title"], url=p["url"], date_text=p["date_text"])
                  for p in self.listed_posts[:3]]
        courses = [dict(title=c["title"], url=c["url"], count=c["count"],
                        slide_total=c["slide_total"])
                   for c in self.doc_collections if c["docs"]]
        return dict(
            latest=latest,
            courses=courses,
            stats=dict(posts=len(self.posts), projects=len(self.projects),
                       docs=len(self.docs), tags=len(self.all_tag_names),
                       slides=sum(d["slide_count"] for d in self.docs)),
            built=dt.date.today().isoformat(),
            # 必须是 dict 列表：模板的 {{#each}} 对元组取不到 {{name}}，
            # 会静默渲染成空标签（页脚右下角那三个空白胶囊就是这么来的）。
            fonts=[dict(name=n, note=d) for n, d in (
                ("Noto Serif SC", "正文 · 宋体档"),
                ("Noto Sans SC", "正文 · 黑体档"),
                ("FiraCode Nerd", "代码与数学"),
            )],
        )

    def base_ctx(self, *, title: str, description: str, url: str, nav_active: str = "",
                 body_class: str = "", extra_head: str = "", og_type: str = "website",
                 og_image: str = "", has_math: bool = False,
                 extra_scripts: list[str] | None = None,
                 extra_styles: list[str] | None = None) -> dict:
        nav_items = []
        for item in self.cfg["nav"]:
            href = item["href"]
            active = bool(nav_active) and (
                href == nav_active or (href != "/" and nav_active.startswith(href)))
            nav_items.append(dict(item, active=active))
        return dict(
            site=self.cfg["site"],
            config=self.cfg,
            themes=[dict(id=t["id"], name=t["name"], nameEn=t.get("nameEn", t["id"]),
                         swatch=t.get("swatch", []), bg=t["bg"],
                         video=self.theme_meta[t["id"]]["video_rel"])
                    for t in self.cfg["themes"]],
            appearance=self.cfg["appearance"],
            page=dict(title=title, description=description, url=url_for(self.cfg, url),
                      abs_url=abs_url(self.cfg, url), nav_active=nav_active,
                      body_class=body_class, extra_head=extra_head,
                      extra_scripts=extra_scripts or [],
                      extra_styles=extra_styles or [],
                      og_type=og_type, og_image=og_image,
                      year=dt.date.today().year),
            nav=nav_items,
            social=self.cfg["social"],
            footer=self.footer,
            build=self.cfg["build"],
            asset_version=self.asset_version,
            theme_meta_json=self.theme_meta_json,
            has_math=has_math,
            # 站点图标精灵：正文里用到品牌标记的页面自己覆盖它（见 build_* 里的
            # `site_icons=item["site_icons"]`），其余页面是空串
            site_icons="",
        )

    def tag_entries(self) -> list[dict]:
        """站点级标签清单（文章 + 项目），已按数量倒序。"""
        out = []
        for name in self.all_tag_names:
            posts = self.tag_posts.get(name, [])
            projects = self.tag_projects.get(name, [])
            out.append(dict(name=name, slug=self.tag_slugs[name],
                            count=len(posts) + len(projects),
                            post_count=len(posts), project_count=len(projects)))
        return out

    def emit(self, rel: str, text: str) -> None:
        write_file(os.path.join(self.out, rel), text)
        self.written.append(rel)

    # -- 页面 ---------------------------------------------------------
    @staticmethod
    def pick_featured(items: list[dict], count: int) -> list[dict]:
        """先取标了 `featured: true` 的，**不够就用最新的补满**。

        原来的写法是 `[p for p in items if p.featured] or items` —— `or` 只在
        「一个都没有」时才兜底。于是标了 2 个、配置要 3 个的时候，首页那一排就
        只有 2 张卡，而且**不报错、不警告**：删掉几篇精选之后就是这样悄悄塌掉的
        （首页那一行从 3 张变 2 张，看不出哪里不对）。
        """
        picks = [p for p in items if p.get("featured")]
        if len(picks) >= count:
            return picks[:count]
        chosen = {id(p) for p in picks}
        for p in items:
            if len(picks) >= count:
                break
            if id(p) not in chosen:
                picks.append(p)
                chosen.add(id(p))
        return picks

    def build_home(self) -> None:
        cfg = self.cfg
        listed = self.listed_posts
        count = cfg["home"]["featuredCount"]
        featured = self.pick_featured(listed, count)
        chosen = {p["url"] for p in featured}
        latest = sorted((p for p in listed if p["url"] not in chosen),
                        key=lambda p: p.get("updated") or p["date"], reverse=True)[: cfg["home"]["latestCount"]]
        latest = [dict(p, activity_date=p.get("updated") or p["date"],
                       activity_text=p.get("updated_text") or p["date_text"]) for p in latest]

        # Hero 统计里的 {posts} / {projects} / {tags} 占位符按实际数量替换
        counts = {"posts": len(listed), "projects": len(self.projects),
                  "tags": len(self.all_tag_names), "archived": len(self.archived_posts)}
        hero = dict(cfg["hero"])
        hero["stats"] = [
            dict(s, tip_id=f'hero-stat-tip-{i}', value=re.sub(r"\{(posts|projects|tags|archived)\}", lambda m: str(counts[m[1]]), str(s.get("value", "")))
                 if "{" in str(s.get("value", "")) else s.get("value", ""))
            for i, s in enumerate(cfg["hero"].get("stats", []))
        ]

        ctx = self.base_ctx(title="", description=cfg["site"]["description"], url="/",
                            nav_active="/", body_class="page-home",
                            extra_scripts=["orbit-field.js"], extra_styles=["discovery.css", "orbit-hero.css", "home-flow.css"])
        ctx.update(
            hero=hero, home=cfg["home"],
            posts=latest, featured=featured,
            projects=self.pick_featured(
                sorted(self.projects, key=lambda p: p.get("order", 999)), count),
            tags=self.tag_entries()[:14],
            total_posts=len(listed), total_projects=len(self.projects),
        )
        self.emit("index.html", self.engine.render("home.html", ctx))

    def _post_head(self, post: dict) -> str:
        parts = []
        if post.get("cover"):
            parts.append(f'<meta property="og:image" content="{abs_url(self.cfg, "/" + post["cover"])}">')
        author = html.escape(str(post.get("author") or self.cfg["site"]["author"]), quote=True)
        parts.append(f'<meta name="author" content="{author}">')
        return "\n  ".join(parts)

    def _sibling(self, post: dict, offset: int):
        try:
            i = self.posts.index(post)
        except ValueError:
            return None
        j = i + offset
        return self.posts[j] if 0 <= j < len(self.posts) else None

    def build_posts(self) -> None:
        per = self.cfg["build"]["postsPerPage"]
        listed = self.listed_posts
        pages = [listed[i:i + per] for i in range(0, len(listed), per)] or [[]]
        for idx, chunk in enumerate(pages, start=1):
            rel = "posts/index.html" if idx == 1 else f"posts/page/{idx}/index.html"
            url = "/posts/" if idx == 1 else f"/posts/page/{idx}/"
            ctx = self.base_ctx(
                title="文章" + ("" if idx == 1 else f" · 第 {idx} 页"),
                description="全部技术文章与工程笔记。", url=url,
                nav_active="/posts/", body_class="page-list")
            ctx.update(
                posts=chunk, page_no=idx, page_count=len(pages),
                show_pager=len(pages) > 1,
                show_empty=not chunk,
                prev_url="" if idx == 1 else ("/posts/" if idx == 2 else f"/posts/page/{idx - 1}/"),
                next_url="" if idx == len(pages) else f"/posts/page/{idx + 1}/",
                heading="文章", subheading=f"共 {len(listed)} 篇"
                + (f" · 另有 {len(self.archived_posts)} 篇已归档" if self.archived_posts else ""),
                all_tags=self.tag_entries(),
                back_href="", back_label="")
            self.emit(rel, self.engine.render("post-list.html", ctx))

        for post in self.posts:
            ctx = self.base_ctx(
                title=post["title"], description=post["summary"], url=post["url"],
                nav_active="/posts/", body_class="page-post",
                extra_head=self._post_head(post), og_type="article",
                og_image=abs_url(self.cfg, "/assets/images/favicon.svg"))
            related = [p for p in self.posts
                       if p["slug"] != post["slug"] and set(p["tags"]) & set(post["tags"])][:3]
            ctx.update(post=post, related=related, has_math=post["has_math"],
                       site_icons=post["site_icons"],
                       prev_post=self._sibling(post, -1), next_post=self._sibling(post, 1))
            self.emit(f"posts/{post['slug']}/index.html", self.engine.render("post.html", ctx))

    def build_projects(self) -> None:
        ctx = self.base_ctx(title="项目", description="开源项目与工程项目。", url="/projects/",
                            nav_active="/projects/", body_class="page-projects")
        ctx.update(projects=self.projects, heading="项目",
                   subheading=f"共 {len(self.projects)} 个")
        self.emit("projects/index.html", self.engine.render("project-list.html", ctx))
        for prj in self.projects:
            ctx = self.base_ctx(title=prj["title"], description=prj["summary"],
                                url=prj["url"], nav_active="/projects/",
                                body_class="page-project", has_math=prj["has_math"])
            ctx.update(project=prj, site_icons=prj["site_icons"])
            self.emit(f"projects/{prj['slug']}/index.html",
                      self.engine.render("project.html", ctx))

    def build_tags(self) -> None:
        entries = self.tag_entries()
        ctx = self.base_ctx(title="标签", description="按标签浏览文章与项目。", url="/tags/",
                            nav_active="/posts/", body_class="page-tags")
        ctx.update(tags=entries, heading="标签", subheading=f"{len(entries)} 个标签")
        self.emit("tags/index.html", self.engine.render("tag-list.html", ctx))

        for name in self.all_tag_names:
            slug = self.tag_slugs[name]
            posts = self.tag_posts.get(name, [])
            projects = self.tag_projects.get(name, [])
            bits = []
            if posts:
                bits.append(f"文章 {len(posts)}")
            if projects:
                bits.append(f"项目 {len(projects)}")
            ctx = self.base_ctx(
                title=f"标签：{name}",
                description=f"带有「{name}」标签的内容。",
                url=f"/tags/{slug}/", nav_active="/posts/", body_class="page-list")
            ctx.update(posts=posts, projects=projects, heading=f"#{name}",
                       subheading=" · ".join(bits) or "暂无内容",
                       page_no=1, page_count=1, show_pager=False, show_empty=False,
                       prev_url="", next_url="", all_tags=[],
                       back_href="/tags/", back_label="← 全部标签")
            self.emit(f"tags/{slug}/index.html", self.engine.render("post-list.html", ctx))

    def build_archive(self) -> None:
        """归档页：全部文章按年分组，含已归档的。"""
        years: dict[str, list[dict]] = {}
        for p in self.posts:
            year = p["date"][:4] if p["date"] else "未标日期"
            years.setdefault(year, []).append(p)
        groups = [dict(year=y, posts=years[y], count=len(years[y]))
                  for y in sorted(years, key=lambda k: (k == "未标日期", k), reverse=True)]
        ctx = self.base_ctx(
            title="归档", description="按年份浏览全部文章，包含已归档的旧文。",
            url="/archive/", nav_active="/archive/", body_class="page-archive")
        ctx.update(groups=groups, total=len(self.posts),
                   archived_count=len(self.archived_posts),
                   heading="归档", subheading=f"共 {len(self.posts)} 篇"
                   + (f"（其中 {len(self.archived_posts)} 篇已归档）" if self.archived_posts else ""))
        self.emit("archive/index.html", self.engine.render("archive.html", ctx))

    def build_pages(self) -> None:
        for page in self.pages:
            slug = page["slug"]
            rel = "about/index.html" if slug == "about" else f"{slug}/index.html"
            styles = {"links": ["links.css"], "learning": ["discovery.css"]}.get(slug, [])
            scripts = {"links": ["links.js"], "learning": ["learning.js"]}.get(slug, [])
            ctx = self.base_ctx(title=page["title"], description=page["summary"],
                                url=f"/{slug}/", nav_active=f"/{slug}/",
                                body_class="page-links" if slug == "links" else "page-single page-" + slug,
                                has_math=page["has_math"],
                                extra_styles=styles, extra_scripts=scripts)
            # Editable landing pages use root-relative links; honor subpath deployments.
            display_page = dict(page)
            base = self.cfg["build"].get("basePath", "").rstrip("/")
            if base:
                display_page["html"] = re.sub(r'((?:href|src|data-reading-url)=")/(?!/)',
                                              lambda m: m.group(1) + base + '/', page["html"])
            ctx.update(content_page=display_page, is_links=slug == "links",
                       site_icons=page["site_icons"],
                       show_avatar=(slug == "about" and bool(
                           self.cfg["site"].get("avatar"))))
            self.emit(rel, self.engine.render("page.html", ctx))

    def build_redirects(self) -> None:
        for alias, target in self.redirects.items():
            self.emit(alias.strip('/') + '/index.html', redirect_document(self.cfg, target))

    def build_docs(self) -> None:
        """「文档」区：课程总览 / 单课程目录 / 单篇幻灯片。"""
        total_slides = sum(d["slide_count"] for d in self.docs)
        stats = dict(collections=len(self.doc_collections), docs=len(self.docs),
                     slides=total_slides,
                     pending=sum(len(c["pending"]) for c in self.doc_collections))
        ctx = self.base_ctx(
            title="文档", description="幻灯片形式的技术文档与教程，可以像看课件一样翻页。",
            url="/docs/", nav_active="/docs/", body_class="page-docs",
            extra_styles=["docs.css"])
        ctx.update(collections=self.doc_collections, heading="文档",
                   subheading=f"{stats['collections']} 个系列 · {stats['docs']} 篇"
                              f" · {stats['slides']} 页",
                   docs_stats=stats,
                   links_page=self._page_by_slug("links"),
                   docs_source=self.cfg.get("docs", {}).get("source", ""))
        self.emit("docs/index.html", self.engine.render("docs-index.html", ctx))

        for col in self.doc_collections:
            ctx = self.base_ctx(
                title=col["title"], description=col["description"],
                url=col["url"], nav_active="/docs/", body_class="page-docs",
                extra_styles=["docs.css"])
            ctx.update(collection=col, heading=col["title"],
                       subheading=col.get("subtitle", ""),
                       slide_total=sum(d["slide_count"] for d in col["docs"]),
                       docs_source=self.cfg.get("docs", {}).get("source", ""))
            self.emit(f"docs/{col['id']}/index.html",
                      self.engine.render("docs-collection.html", ctx))

        for doc in self.docs:
            ctx = self.base_ctx(
                title=doc["title"], description=doc["summary"], url=doc["url"],
                nav_active="/docs/", body_class="page-doc",
                extra_styles=["docs.css"], extra_scripts=["docs.js"],
                og_image=abs_url(self.cfg, "/assets/images/favicon.svg"))
            ctx.update(doc=doc, heading=doc["title"], site_icons=doc["site_icons"],
                       collection=self._collection_of(doc))
            self.emit(f"docs/{doc['slug']}/index.html",
                      self.engine.render("doc.html", ctx))

    def _page_by_slug(self, slug: str) -> dict | None:
        for p in self.pages:
            if p["slug"] == slug:
                return p
        return None

    def _collection_of(self, doc: dict) -> dict:
        for c in self.doc_collections:
            if c["id"] == doc["collection"]:
                return c
        return dict(id="", title="文档", url="/docs/", docs=[], refs=[], pending=[])

    def build_404(self) -> None:
        ctx = self.base_ctx(title="页面不存在", description="404", url="/404.html",
                            body_class="page-404", extra_scripts=["404.js"], extra_styles=["404.css"])
        ctx['rescue_routes'] = [dict(url=url_for(self.cfg, p['url']), title=p['title'])
                                for p in self.posts + self.projects + self.docs]
        self.emit("404.html", self.engine.render("404.html", ctx))

    def graph_nodes(self) -> list[dict]:
        """3D 关系图的节点：文章 + 项目，共用一套字段。"""
        out = []
        for p in self.posts:
            out.append(dict(
                id="post:" + p["slug"], kind="post", type_label="文章",
                title=p["title"], url=url_for(self.cfg, p["url"]),
                date=p["date"], year=(p["date"][:4] if p["date"] else ""),
                date_text=p["date_text"], tags=p["tags"], summary=p["summary"],
                minutes=p["minutes"], archived=p["archived"],
                featured=bool(p.get("featured")), cover=p.get("cover", ""),
                subtitle=p.get("subtitle", ""),
            ))
        for p in self.projects:
            out.append(dict(
                id="project:" + p["slug"], kind="project", type_label="项目",
                title=p["title"], url=url_for(self.cfg, p["url"]),
                date=p["date"], year=(p["date"][:4] if p["date"] else ""),
                date_text=p["date_text"], tags=p["tags"], summary=p["summary"],
                minutes=p["minutes"], archived=False,
                featured=bool(p.get("featured")), cover=p.get("cover", ""),
                subtitle=p.get("subtitle", ""), role=p.get("role", ""),
            ))
        return out

    def build_graph(self) -> None:
        nodes = self.graph_nodes()
        for i, n in enumerate(nodes):
            n["idx"] = i
            n["tags_csv"] = "|".join(n["tags"])
            n["has_tags"] = bool(n["tags"])
            # 布面颜色 1~6。主标签先把书分进「3 色一组的色库」，书名再决定组里具体哪一本：
            # 这样同主题的书天然是**邻近色**（一眼能看出是一类），
            # 又不会整个书架只有三四种颜色（纯按标签散列时 12 本只用到 4 种）。
            # 用 zlib.crc32 而不是内置 hash()：后者带随机盐，每次构建颜色都会跳。
            tag = (n["tags"][0] if n["tags"] else n["title"]).encode("utf-8")
            n["cloth"] = 1 + (zlib.crc32(tag) % 2) * 3 + zlib.crc32(tag + n["title"].encode("utf-8")) % 3
        used: dict[str, int] = {}
        for n in nodes:
            for t in n["tags"]:
                used[t] = used.get(t, 0) + 1
        tags = [dict(name=t, slug=self.tag_slugs[t], count=c)
                for t, c in sorted(used.items(), key=lambda kv: (-kv[1], kv[0]))]

        years = sorted({n["year"] for n in nodes if n["year"]}, reverse=True)
        counts = dict(total=len(nodes), post=sum(1 for n in nodes if n["kind"] == "post"),
                      project=sum(1 for n in nodes if n["kind"] == "project"),
                      tags=len(tags), years=len(years))

        ctx = self.base_ctx(
            title="知识图谱", description="把全部文章与项目铺成一座三维书库，按标签连线看它们之间的关系。",
            url="/graph/", nav_active="/graph/", body_class="page-graph",
            extra_scripts=["graph.js"], extra_styles=["graph.css"])
        ctx.update(nodes=nodes, graph=counts, legend_tags=tags, years=years,
                   graph_initial=nodes[0] if nodes else None)
        self.emit("graph/index.html", self.engine.render("graph.html", ctx))

    @staticmethod
    def _rfc822(d) -> str:
        if not d:
            d = dt.date.today()
        return dt.datetime(d.year, d.month, d.day, 9, 0, 0).strftime(
            "%a, %d %b %Y %H:%M:%S +0800")

    def build_feeds(self) -> None:
        cfg = self.cfg
        if cfg["build"].get("enableRss"):
            self._emit_feed(cfg, cfg["site"])
        if cfg["build"].get("enableSitemap", True):
            self._emit_sitemap(cfg)

    def _emit_feed(self, cfg: dict, s: dict) -> None:
        items = []
        for p in self.listed_posts[:20]:   # 归档文章不推送
            cats = "".join(f"      <category>{html.escape(t)}</category>\n" for t in p["tags"])
            items.append(
                "    <item>\n"
                f"      <title>{html.escape(p['title'])}</title>\n"
                f"      <link>{abs_url(cfg, p['url'])}</link>\n"
                f'      <guid isPermaLink="true">{abs_url(cfg, p["url"])}</guid>\n'
                f"      <pubDate>{self._rfc822(p['date_obj'])}</pubDate>\n"
                f"      <description>{html.escape(p['summary'])}</description>\n"
                + cats + "    </item>")
        feed = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
            "  <channel>\n"
            f"    <title>{html.escape(s['title'])} · {html.escape(s['tagline'])}</title>\n"
            f"    <link>{s['url']}</link>\n"
            f"    <description>{html.escape(s['description'])}</description>\n"
            f"    <language>{s['lang']}</language>\n"
            f"    <lastBuildDate>{self._rfc822(dt.date.today())}</lastBuildDate>\n"
            f'    <atom:link href="{abs_url(cfg, "/feed.xml")}" rel="self" type="application/rss+xml"/>\n'
            + "\n".join(items) + "\n  </channel>\n</rss>\n")
        self.emit("feed.xml", feed)

    def _emit_sitemap(self, cfg: dict) -> None:
        urls = ["/", "/posts/", "/projects/", "/docs/", "/tags/", "/archive/", "/graph/", "/about/", "/lab/ankle/"]
        urls += [p["url"] for p in self.posts] + [p["url"] for p in self.projects]
        urls += [c["url"] for c in self.doc_collections] + [d["url"] for d in self.docs]
        urls += [p["url"] for p in self.pages]
        urls += [f"/tags/{self.tag_slugs[t]}/" for t in self.all_tag_names]
        seen, entries = set(), []
        today = dt.date.today().isoformat()
        for u in urls:
            if u in seen:
                continue
            seen.add(u)
            entries.append(f"  <url>\n    <loc>{abs_url(cfg, u)}</loc>\n"
                           f"    <lastmod>{today}</lastmod>\n  </url>")
        self.emit("sitemap.xml",
                  '<?xml version="1.0" encoding="UTF-8"?>\n'
                  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                  + "\n".join(entries) + "\n</urlset>\n")
        self.emit("robots.txt",
                  f"User-agent: *\nAllow: /\nSitemap: {abs_url(cfg, '/sitemap.xml')}\n")

    def build_search(self) -> None:
        index = []
        for p in self.posts:
            index.append(dict(t="post", title=p["title"], url=url_for(self.cfg, p["url"]),
                              tags=p["tags"], summary=p["summary"],
                              text=p["plain"], date=p["date_text"]))
        for p in self.projects:
            index.append(dict(t="project", title=p["title"], url=url_for(self.cfg, p["url"]),
                              tags=p["tags"], summary=p["summary"],
                              text=p["plain"], date=p["date_text"]))
        for d in self.docs:
            index.append(dict(t="doc", title=d["title"], url=url_for(self.cfg, d["url"]),
                              tags=d["tags"] + [d["collection_title"]], summary=d["summary"],
                              text=d["plain"], date=""))
        self.emit("search-index.json",
                  json.dumps(index, ensure_ascii=False, separators=(",", ":")))

    # -- 静态资源 -----------------------------------------------------
    def build_tools(self) -> None:
        ctx = self.base_ctx(title="并联踝 MuJoCo 实验", description="两个电机、两条闭环支链与被动脚底关节的真实 MuJoCo 仿真。",
                            url="/lab/ankle/", nav_active="/lab/")
        self.emit("lab/ankle/index.html", self.engine.render("ankle.html", ctx))

    def copy_static(self) -> None:
        assets = os.path.join(self.out, "assets")
        os.makedirs(assets, exist_ok=True)

        self.emit("assets/themes.css", minify_css(self.themes_css))

        parts = []
        for name in ("base.css", "components.css", "loading.css", "demo.css",
                     "effects.css", "performance.css", "reading.css", "reading-tools.css", "print.css"):
            path = os.path.join(STATIC, "css", name)
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as fh:
                    parts.append(f"/* ===== {name} ===== */\n" + fh.read())
        self.emit("assets/site.css", minify_css("\n".join(parts)))

        js_parts = []
        for name in ("theme.js", "effects.js", "cursor.js", "search.js",
                     "loading.js", "site.js", "demo.js", "math.js", "mujoco-embed.js"):
            path = os.path.join(STATIC, "js", name)
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as fh:
                    js_parts.append(f"/* ===== {name} ===== */\n" + fh.read())
        self.emit("assets/site.js", minify_js("\n".join(js_parts)))

        # 只给单个页面用的资源（404 的轨迹规划、首页运动轨道、图谱的 3D 书库），
        # 不塞进全站 bundle
        for name in ("404.js", "graph.js", "orbit-field.js", "docs.js", "links.js",
                     "reading.js", "learning.js"):
            path = os.path.join(STATIC, "js", name)
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as fh:
                    self.emit(f"assets/{name}", minify_js(fh.read()))
        for name in ("graph.css", "docs.css", "links.css", "404.css", "discovery.css", "orbit-hero.css", "home-flow.css"):
            path = os.path.join(STATIC, "css", name)
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as fh:
                    self.emit(f"assets/{name}", minify_css(fh.read()))

        vendor = os.path.join(ROOT, "assets", "vendor")
        if os.path.isdir(vendor):
            shutil.copytree(vendor, os.path.join(assets, "vendor"), dirs_exist_ok=True)
            for r, _d, fs in os.walk(vendor):
                for f in fs:
                    self.written.append("assets/" + os.path.relpath(
                        os.path.join(r, f), assets).replace("\\", "/"))

        img_dir = os.path.join(ROOT, "assets", "images")
        if os.path.isdir(img_dir):
            dst_dir = os.path.join(assets, "images")
            os.makedirs(dst_dir, exist_ok=True)
            for f in os.listdir(img_dir):
                shutil.copy2(os.path.join(img_dir, f), os.path.join(dst_dir, f))
                self.written.append(f"assets/images/{f}")

        # 后台上传的图片、以及用户自己放进去的素材目录，整目录拷过去
        for key in ("uploads", "wallpapers", "files", "docs", "tools"):
            src = os.path.join(ROOT, "assets", key)
            if os.path.isdir(src):
                shutil.copytree(src, os.path.join(assets, key), dirs_exist_ok=True)
                for r, _d, fs in os.walk(src):
                    for f in fs:
                        self.written.append("assets/" + os.path.relpath(
                            os.path.join(r, f), assets).replace("\\", "/"))

        for t in self.cfg["themes"]:
            if self.cfg["build"].get("stripBackgrounds"):
                break                       # 剥离壁纸时不拷图片/视频
            files = list(dict.fromkeys([t["bg"], self.theme_meta[t["id"]]["bg"]]))
            vid = self.theme_meta[t["id"]]["video_rel"]
            if vid:
                files.append(os.path.join("assets", "bg", os.path.basename(vid)))
            for rel in files:
                src = os.path.join(ROOT, rel)
                if not os.path.isfile(src):
                    continue
                dst = os.path.join(assets, "bg", os.path.basename(src))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                self.written.append(f"assets/bg/{os.path.basename(src)}")

        self._copy_referenced()

    def _copy_referenced(self) -> None:
        """安全网：内容或配置里引用到的 assets/* 文件若还没进产物，补拷一份。

        后台上传的封面/头像会落在 assets/uploads/ 或 assets/images/，
        这里保证「引用了就一定存在」，避免前台出现死链。

        正文里插图也要走这条路：`assets/` 下只有 uploads / wallpapers / files / docs
        是整目录拷贝的，其它子目录（比如迁移进来的 `assets/feishu/`）没人管。
        一开始只扫了封面与文档资源，结果文章正文里的图全部 404 —— 而且
        **构建不报错**，只有跑 check-site 才看得出来。
        """
        rels = set()
        avatar = str(self.cfg["site"].get("avatar") or "")
        if avatar:
            rels.add(avatar)
        for it in self.posts + self.projects + self.pages:
            cover = str(it.get("cover") or "")
            if cover:
                rels.add(cover)
            # 正文渲染后的 HTML：src / href / poster 都算
            for rel in re.findall(r'(?:src|href|poster)="(/assets/[^"]+)"', it.get("html") or ""):
                rels.add(rel)
        for d in self.docs:
            for rel in d.get("assets", []):
                rels.add(rel)
        for col in self.doc_collections:
            for ref in col.get("refs", []):
                if ref.get("img"):
                    rels.add(ref["img"])
        for rel in sorted(rels):
            if not rel or rel.startswith(("http://", "https://", "data:")):
                continue
            rel = rel.lstrip("/")            # 正文里写的是站点根路径，落盘要去掉前导斜杠
            src = os.path.join(ROOT, rel)
            dst = os.path.join(self.out, rel)
            if os.path.isfile(src) and not os.path.isfile(dst):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)
                self.written.append(rel.replace("\\", "/"))

    def build(self) -> dict:
        os.makedirs(self.out, exist_ok=True)
        self.build_home()
        self.build_posts()
        self.build_projects()
        self.build_docs()
        self.build_tags()
        self.build_archive()
        self.build_pages()
        self.build_tools()
        self.build_graph()
        self.build_404()
        self.build_redirects()
        self.build_feeds()
        if self.cfg["build"]["enableSearch"]:
            self.build_search()
        self.copy_static()
        # GitHub Pages 默认会把分支当 Jekyll 站点处理（会忽略 _ 开头的路径、
        # 还可能因为不认识的文件报错）。放一个空的 .nojekyll 让它按纯静态文件发。
        self.emit(".nojekyll", "")
        return dict(posts=len(self.posts), projects=len(self.projects),
                    pages=len(self.pages), tags=len(self.all_tag_names),
                    files=len(self.written), out=self.out)


def main() -> int:
    argv = sys.argv[1:]
    cfg = load_config()
    if "--out" in argv:
        cfg["build"]["outDir"] = argv[argv.index("--out") + 1]
    if "--base" in argv:
        cfg["build"]["basePath"] = argv[argv.index("--base") + 1]
    if "--drafts" in argv:
        cfg["build"]["includeDrafts"] = True
    if "--no-bg" in argv:
        # 剥离壁纸：壁纸是 Wallpaper Engine 创意工坊的二次创作内容，
        # 公开部署前用这个开关构建，页面会回落到纯渐变背景。
        cfg["build"]["stripBackgrounds"] = True

    stats = Builder(cfg, clean="--clean" in argv).build()
    print(f"  文章 {stats['posts']}  项目 {stats['projects']}  页面 {stats['pages']}  "
          f"标签 {stats['tags']}  输出文件 {stats['files']}")
    print(f"  产物目录: {stats['out']}")

    if "--serve" in argv:
        import http.server
        import socketserver
        i = argv.index("--serve")
        port = int(argv[i + 1]) if len(argv) > i + 1 and argv[i + 1].isdigit() else 4173
        os.chdir(stats["out"])

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass

        socketserver.TCPServer.allow_reuse_address = True
        with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
            print(f"  预览: http://127.0.0.1:{port}/   (Ctrl+C 结束)")
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
