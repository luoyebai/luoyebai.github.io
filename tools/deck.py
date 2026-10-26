"""把 reveal.js 风格的幻灯片 Markdown 切成「一张一张」的幻灯片。

来源是 github.com/luoyebai/doc_html —— 那一整套文档原本是 reveal.js 的幻灯片，
正文里靠分隔线分页：

    ---     横向翻页（新的一「节」）
    ----    纵向翻页（同一节里的下一张）
    ++++    少数几篇用它当分页（`+++++` 只在文件头分隔 JSON 元信息，正文里没有）

注意一个容易踩的点：**标题不换页**。原站一张幻灯片里可以连着好几个 `#` / `##`
（jyy 那套模板就这么用），真正分页的只有上面那三种分隔线。所以这里切分的依据只有
分隔线，标题只用来给这张幻灯片起个名字（导航和目录要用）。

空幻灯片直接丢掉：源文档里有不少 `----\n\n----` 这种占位（「待更新」），
保留下来会变成一堆空白页。
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

import mdparse

DASH_SEP = re.compile(r"^\s*(?:(?P<dash>-{3,})|(?P<plus>\+{4,}))\s*$")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
MD_LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]+)\)")
# 首页图标那种「返回目录」的角标，迁进来之后指向的是旧站，直接摘掉
HOME_LINK = re.compile(r"\[\s*(?:🏠|🏠️|首页|返回)\s*\]\([^)]*\)")


def _sep_kind(line: str) -> str | None:
    m = DASH_SEP.match(line)
    if not m:
        return None
    if m.group("plus"):                 # ++++ / +++++
        return "h"
    return "v" if len(m.group("dash")) >= 4 else "h"


def _clean_heading(text: str) -> str:
    text = HOME_LINK.sub("", text)
    text = MD_LINK.sub(lambda m: m.group(1), text)
    text = re.sub(r"<[^>]+>", "", text)
    # 强调符号在标题里到处都是（`## Q1.** 为何编程？***`），统一抹掉
    text = re.sub(r"[*`_~]", "", text)
    return text.strip(" ·—-")


def _remap_source_lines(markup: str, source_lines: list[int]) -> str:
    """只映射 HTML 属性，避免误改代码示例里同名属性的字面文本。"""
    class Positions(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.edits = []
            self.offsets = [0] + [match.end() for match in re.finditer('\n', markup)]

        def handle_starttag(self, tag, attrs):
            original = self.get_starttag_text()
            mapped = re.sub(r'(\bdata-source-(?:line|end)=")([0-9]+)(")',
                            lambda m: m.group(1) + str(source_lines[min(
                                len(source_lines) - 1, int(m.group(2)) - 1)]) + m.group(3), original)
            if original != mapped:
                row, col = self.getpos()
                self.edits.append((self.offsets[row - 1] + col, len(original), mapped))

        handle_startendtag = handle_starttag

    parser = Positions()
    parser.feed(markup)
    parser.close()
    for offset, size, replacement in reversed(parser.edits):
        markup = markup[:offset] + replacement + markup[offset + size:]
    return markup


def parse(body: str, *, source_map: bool = False, expand_figures: bool = False) -> dict:
    """返回 {slides, sections, count}。

    slide = {kind, html, plain, title, level, blank}
      kind  'h' = 由 --- 开的头（新一节），'v' = 由 ---- 开的头（同节的下一页）
    section = {title, index, count}   —— 每节的标题取该节第一张的标题

    编辑预览可传 source_map=True，slide 附原始正文的 source_line/source_end
    （1-based 闭区间）和 block_index（0-based，包含被跳过的空页）。
    expand_figures=True 在分片后展开图示，并把新增 HTML 行映射回原始标记行。
    公开构建仍沿用默认参数，输出不受预览元数据影响。
    """
    raw: list[dict] = []
    cur = {"kind": "h", "lines": [], "source_line": 1}
    fence = None
    for line_number, line in enumerate(body.replace("\r\n", "\n").split("\n"), 1):
        marker = re.match(r'^\s*(`{3,}|~{3,})', line)
        inside = fence is not None
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
        kind = None if inside or marker else _sep_kind(line)
        if kind:
            raw.append(cur)
            cur = {"kind": kind, "lines": [], "source_line": line_number + 1}
        else:
            cur["lines"].append(line)
    raw.append(cur)

    slides: list[dict] = []
    missing_figures: list[str] = []
    if expand_figures:
        import docfigs
    for block_index, item in enumerate(raw):
        text = mdparse.balance_inline_tags("\n".join(item["lines"]).strip("\n"))
        # strip("\n") 只去掉全空行；保留缩进空白的行为须与公开构建一致。
        leading = 0
        for original_line in item["lines"]:
            if original_line != "":
                break
            leading += 1
        chunks = [{"lines": [], "numbers": []}]
        fence = None
        for offset, line in enumerate(text.split('\n')):
            marker = re.match(r'^\s*(`{3,}|~{3,})', line)
            inside = fence is not None
            if marker:
                token = marker.group(1)
                if fence is None:
                    fence = token
                elif token[0] == fence[0] and len(token) >= len(fence):
                    fence = None
            if not inside and not marker and line.strip() == '--':
                chunks.append({"lines": [], "numbers": []})
            else:
                chunks[-1]["lines"].append(line)
                chunks[-1]["numbers"].append(item["source_line"] + leading + offset)
        rendered = []
        expanded_texts = []
        for index, chunk in enumerate(chunks):
            render_lines, source_lines = [], []
            for line, number in zip(chunk["lines"], chunk["numbers"]):
                if expand_figures:
                    expanded, missing = docfigs.expand_figures(line)
                    missing_figures.extend(missing)
                else:
                    expanded = line
                added = expanded.split('\n')
                render_lines.extend(added)
                source_lines.extend([number] * len(added))
            render_text = '\n'.join(render_lines)
            expanded_texts.append(render_text)
            part, _toc = mdparse.render(render_text, heading_ids=False, source_map=source_map)
            if source_map and source_lines:
                part = _remap_source_lines(part, source_lines)
            if index and part.strip():
                attrs = (f' data-source-line="{source_lines[0]}"'
                         f' data-source-end="{source_lines[-1]}"') if source_map and source_lines else ''
                part = '<div class="deck-fragment"' + attrs + '>' + part + '</div>'
            rendered.append(part)
        html = '\n'.join(rendered)
        plain = mdparse.to_text('\n--\n'.join(expanded_texts) if expand_figures else text)
        has_media = ("<img" in html) or ("<video" in html)
        # Plain-text extraction intentionally omits source code. A code-only
        # slide (including an interactive demo) still has visible content.
        has_code = 'class="code-block"' in html or 'class="demo"' in html or 'data-mujoco-tool="ankle"' in html
        if not plain.strip() and not has_media and not has_code:
            continue                        # 空页（源文档的「待更新」占位）
        title, level = "", 0
        for line in item["lines"]:
            m = HEADING.match(line)
            if m and _clean_heading(m.group(2)):
                title = _clean_heading(m.group(2))
                level = len(m.group(1))
                break
        slide = dict(kind=item["kind"], html=html, plain=plain,
                     title=title, level=level, blank=False)
        if source_map:
            slide.update(source_line=item["source_line"],
                         source_end=item["source_line"] + max(0, len(item["lines"]) - 1),
                         block_index=block_index)
        slides.append(slide)

    sections: list[dict] = []
    for i, s in enumerate(slides):
        if s["kind"] == "h" or not sections:
            sections.append(dict(title=s["title"] or f"第 {len(sections) + 1} 节",
                                 first=i, count=1, slides=[i]))
        else:
            sections[-1]["count"] += 1
            sections[-1]["slides"].append(i)
    # 一节一条目录项太长时，用「第 n 页」兜底
    for k, sec in enumerate(sections, start=1):
        if not sec["title"]:
            sec["title"] = f"第 {k} 节"
    result = dict(slides=slides, sections=sections, count=len(slides))
    if expand_figures:
        result["missingFigures"] = list(dict.fromkeys(missing_figures))
    return result
