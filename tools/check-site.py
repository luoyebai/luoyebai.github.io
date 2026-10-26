"""发布前检查：内部链接、静态资源、RSS / sitemap / 搜索索引。

    python tools/check-site.py                # 检查 public/
    python tools/check-site.py --base /repo   # 检查子路径构建
    python tools/check-site.py --dir out      # 检查其它输出目录

退出码：0 = 全部通过，1 = 有问题。
"""
from __future__ import annotations

import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlsplit

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ATTR = re.compile(r'\b(?:href|src)\s*=\s*"([^"]*)"', re.I)
SKIP_SCHEME = ("http://", "https://", "mailto:", "tel:", "data:", "javascript:", "//", "#")


def main() -> int:
    argv = sys.argv[1:]
    out_dir = os.path.join(ROOT, "public")
    if "--dir" in argv:
        out_dir = os.path.join(ROOT, argv[argv.index("--dir") + 1])
    base = ""
    if "--base" in argv:
        base = argv[argv.index("--base") + 1].rstrip("/")

    if not os.path.isdir(out_dir):
        print(f"!! 输出目录不存在: {out_dir}")
        return 1

    pages, problems, checked = [], [], 0
    assets_on_disk = set()

    for dirpath, _dirs, files in os.walk(out_dir):
        for name in files:
            rel = os.path.relpath(os.path.join(dirpath, name), out_dir).replace("\\", "/")
            assets_on_disk.add(rel)
            if name.endswith(".html"):
                pages.append(rel)

    def exists(target: str) -> bool:
        t = target.lstrip("/")
        if t in assets_on_disk:
            return True
        if t.endswith("/") or t == "":
            return (t + "index.html") in assets_on_disk
        # 目录式 URL：/posts/x -> /posts/x/index.html
        if (t + "/index.html") in assets_on_disk:
            return True
        return False

    # 内部链接与资源
    for page in sorted(pages):
        text = open(os.path.join(out_dir, page), encoding="utf-8").read()
        page_dir = os.path.dirname(page)

        def resolve(raw: str) -> str | None:
            raw = raw.strip()
            if not raw or raw.startswith(SKIP_SCHEME):
                return None
            parts = urlsplit(raw)
            path = unquote(parts.path)
            if base:
                if not path.startswith(base + "/") and path != base:
                    return None if path.startswith("/") else path
                path = path[len(base):] or "/"
            if path.startswith("/"):
                return path
            joined = os.path.normpath(os.path.join(page_dir, path)).replace("\\", "/")
            return "/" + joined

        for raw in ATTR.findall(text):
            if not raw.strip():
                # 空 href/src 说明模板变量没解析出来（例如 front-matter 结构写错）
                problems.append(f"{page}: 存在空链接/空资源属性")
                continue
            target = resolve(raw)
            if target is None:
                continue
            checked += 1
            if not exists(target):
                problems.append(f"{page}: 链接/资源缺失 -> {raw}")

    # 站点图标精灵：正文里用了 `<use href="#site-x">` 的页面，必须同时带上那份精灵。
    # 漏了不会报任何错 —— 页面上只是链接旁边**空着一小块**，肉眼很难注意到，
    # 而这正是「加一页忘配一次」最容易出的错（精灵是按页生成、由模板注进去的）。
    sprite_pages, sprite_missing, sprite_extra = 0, [], []
    for page in sorted(pages):
        text = open(os.path.join(out_dir, page), encoding="utf-8").read()
        used = set(re.findall(r'<use href="#(site-[\w-]+)"', text))
        if not used:
            continue
        sprite_pages += 1
        defined = set(re.findall(r'<symbol id="(site-[\w-]+)"', text))
        for iid in sorted(used - defined):
            sprite_missing.append(f"{page}: 用了 {iid} 但没有对应的 symbol")
        sprite_extra.extend(f"{page}: 精灵里多了没用的 {i}"
                            for i in sorted(defined - used))
    problems.extend(sprite_missing)
    problems.extend(sprite_extra)

    # XML（是否要求 feed 取决于配置里的 enableRss）
    cfg_path = os.path.join(ROOT, "site.config.json")
    enable_rss, enable_sitemap = True, True
    if os.path.isfile(cfg_path):
        with open(cfg_path, encoding="utf-8") as fh:
            bcfg = json.load(fh).get("build", {})
        enable_rss = bool(bcfg.get("enableRss", True))
        enable_sitemap = bool(bcfg.get("enableSitemap", True))

    xml_ok = []
    required = []
    if enable_rss:
        required.append("feed.xml")
    if enable_sitemap:
        required.append("sitemap.xml")
    for name in required:
        path = os.path.join(out_dir, name)
        if not os.path.isfile(path):
            problems.append(f"缺少 {name}")
            continue
        try:
            tree = ET.parse(path)
            root = tree.getroot()
            count = len(list(root)) if name == "sitemap.xml" else len(root.findall("./channel/item"))
            xml_ok.append((name, root.tag.split("}")[-1], count))
        except ET.ParseError as exc:
            problems.append(f"{name} XML 解析失败: {exc}")

    # 关掉 RSS 时不应残留 feed.xml
    if not enable_rss and os.path.isfile(os.path.join(out_dir, "feed.xml")):
        problems.append("已关闭 RSS，但输出里仍有 feed.xml（可能是旧产物，需要 --clean）")

    # JSON
    json_ok = []
    for name in ("search-index.json", "assets/themes.css"):
        if not name.endswith(".json"):
            continue
        path = os.path.join(out_dir, name)
        if not os.path.isfile(path):
            problems.append(f"缺少 {name}")
            continue
        try:
            data = json.load(open(path, encoding="utf-8"))
            json_ok.append((name, len(data) if isinstance(data, list) else 1))
        except json.JSONDecodeError as exc:
            problems.append(f"{name} JSON 解析失败: {exc}")

    # CSS 里引用的背景图
    css_path = os.path.join(out_dir, "assets", "themes.css")
    if os.path.isfile(css_path):
        css = open(css_path, encoding="utf-8").read()
        for m in re.finditer(r'url\("([^"]+)"\)', css):
            ref = m.group(1)
            if ref.startswith("data:"):
                continue
            resolved = os.path.normpath(os.path.join("assets", ref)).replace("\\", "/")
            checked += 1
            if resolved not in assets_on_disk:
                problems.append(f"assets/themes.css: 背景图缺失 -> {ref}")

    # 未解析的 Markdown 标记漏到页面上。
    # 这一类 bug 特别隐蔽：页面能开、链接也在，只是文字里明晃晃挂着 `**` 或 `](`。
    # 已经踩过两次 —— 链接文字里的强调没被解析（`[**标题**](url)`）、
    # `<br>` 被当成块级 HTML 把后面那行 `> 引用` 整行吞掉。
    # 排除代码块与行内 <code>：那里的星号是真的代码（`x**2`）。
    md_leaks = []
    for dirpath, _dirs, files in os.walk(out_dir):
        if ".git" in dirpath:
            continue
        for name in files:
            if not name.endswith(".html"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), out_dir).replace("\\", "/")
            raw = open(os.path.join(dirpath, name), encoding="utf-8", errors="replace").read()
            body = re.sub(r"<div class=\"code-block\".*?</div></div>", "", raw, flags=re.S)
            body = re.sub(r"<div class=\"demo.*?</div></div></div>", "", body, flags=re.S)
            body = re.sub(r"<code[^>]*>.*?</code>", "", body, flags=re.S)
            body = re.sub(r"<(script|style)\b.*?</\1>", "", body, flags=re.S)
            # HTML 注释不渲染。源文档里本来就留了一些注释掉的图片（`<!-- ![](...) -->`），
            # 那是作者的原样，不算漏解析。
            body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
            for pat, label in ((r"\*\*", "**"), (r"\]\(", "]("), (r"^\s*#{2,}\s", "行首 ##")):
                flags = re.M if label.startswith("行首") else 0
                if re.search(pat, body, flags):
                    md_leaks.append(f"{rel}: 疑似未解析的 Markdown 标记 {label}")
    problems.extend(md_leaks[:8])
    if len(md_leaks) > 8:
        problems.append(f"… 另有 {len(md_leaks) - 8} 处未解析的 Markdown 标记")

    # 打包字体的字形覆盖：新写的字如果不在子集里，会静默回退到本机字体，
    # 不同设备上排版就不一致了。这里提前把漏掉的字抓出来。
    # 注意跳过注释里的字 —— 那些永远不会被渲染（见 make-webfont.strip_non_text）。
    font_report = None
    font_dir = os.path.join(out_dir, "assets", "vendor", "fonts")
    serif = os.path.join(font_dir, "NotoSerifSC-VF.woff")
    if os.path.isfile(serif):
        try:
            import importlib.util
            from fontTools.ttLib import TTFont
            # 文件名带连字符，不能直接 import，按路径加载
            spec = importlib.util.spec_from_file_location(
                "make_webfont", os.path.join(ROOT, "tools", "make-webfont.py"))
            mw = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mw)
            cmap = set()
            f = TTFont(serif, lazy=True)
            for table in f["cmap"].tables:
                cmap.update(table.cmap.keys())
            f.close()
            # 源字体里根本没有的字符不算「漏字」：emoji（🪟🐧🤔）、希腊字母之类
            # Noto Serif SC 一个都没有，它们的正确归宿就是回退到系统 emoji 字体。
            # 不排掉的话这个检查会被一批永远修不掉的 emoji 顶成常红。
            providable = set(cmap)
            for _out, sources, *_rest in mw.FACES:
                src = mw.find(sources)
                if not src:
                    continue
                try:
                    sf = TTFont(src, lazy=True, fontNumber=0)
                    for table in sf["cmap"].tables:
                        providable.update(table.cmap.keys())
                    sf.close()
                except Exception:  # noqa: BLE001 —— 源字体读不了就退化成只比子集
                    pass
            missing = {}
            for dirpath, _dirs, files in os.walk(out_dir):
                if ".git" in dirpath:
                    continue
                for name in files:
                    if os.path.splitext(name)[1] not in (".html", ".js", ".json", ".xml", ".txt"):
                        continue
                    rel = os.path.relpath(os.path.join(dirpath, name), out_dir).replace("\\", "/")
                    try:
                        raw = open(os.path.join(dirpath, name), encoding="utf-8").read()
                    except (OSError, UnicodeDecodeError):
                        continue
                    for ch in mw.strip_non_text(name, raw):
                        cp = ord(ch)
                        if cp < 0x20 or cp in cmap or ch in missing or cp not in providable:
                            continue
                        missing[ch] = rel
            font_report = (len(cmap), missing)
            if missing:
                sample = "、".join(list(missing)[:12])
                problems.append(
                    f"打包字体缺 {len(missing)} 个字形（如 {sample}）；"
                    f"重跑 python tools/make-webfont.py")
        except ImportError:
            # fontTools 不在时跳过；但**其它**异常必须炸出来，
            # 否则这个检查会因为一次改名而静默失效（踩过一次）
            font_report = None
        except Exception as exc:  # noqa: BLE001
            problems.append(f"字体覆盖检查执行失败: {type(exc).__name__}: {exc}")

    # 报告
    print(f"输出目录   : {os.path.relpath(out_dir, ROOT)}" + (f"   base={base}" if base else ""))
    print(f"HTML 页面  : {len(pages)}")
    print(f"资源引用   : 检查 {checked} 条")
    for name, tag, count in xml_ok:
        print(f"XML        : {name}  <{tag}>  条目 {count}")
    for name, count in json_ok:
        print(f"JSON       : {name}  条目 {count}")
    if font_report:
        print(f"字体子集   : NotoSerifSC-VF.woff 覆盖 {font_report[0]} 个码位，"
              f"产物缺字 {len(font_report[1])} 个")
    print(f"站点图标   : {sprite_pages} 个页面带内联精灵")
    print()
    if problems:
        print(f"发现问题 {len(problems)} 处：")
        for p in problems[:40]:
            print(f"  !! {p}")
        if len(problems) > 40:
            print(f"  … 另有 {len(problems) - 40} 处")
        return 1
    parts = ["内部链接", "静态资源"]
    if enable_rss:
        parts.append("RSS")
    if enable_sitemap:
        parts.append("sitemap")
    parts.append("搜索索引")
    print("检查通过：" + "、".join(parts) + "均正常。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
