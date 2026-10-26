"""自测：Markdown 解析器 + 高亮。断言关键结构，并打印样例输出供人工核对。"""
import os
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mdparse import parse_front_matter, render, to_text   # noqa: E402
from highlight import highlight, normalize                # noqa: E402

fails = []


def check(name, cond, extra=""):
    if cond:
        print(f"  OK   {name}")
    else:
        fails.append(name)
        print(f"  FAIL {name}  {extra}")


print("=== front-matter ===")
meta, body = parse_front_matter("""---
title: 测试标题
date: 2026-01-02
tags: [robotics, slam]
draft: false
weight: 3
summary: "一句话摘要"
series:
  name: 从零实现
  part: 2
list:
  - a
  - b
---
# 正文
内容
""")
check("title", meta.get("title") == "测试标题", meta.get("title"))
check("tags 内联列表", meta.get("tags") == ["robotics", "slam"], meta.get("tags"))
check("draft 布尔", meta.get("draft") is False, meta.get("draft"))
check("weight 整数", meta.get("weight") == 3, meta.get("weight"))
check("summary 引号剥离", meta.get("summary") == "一句话摘要", meta.get("summary"))
check("嵌套映射", (meta.get("series") or {}).get("part") == 2, meta.get("series"))
check("块状列表", meta.get("list") == ["a", "b"], meta.get("list"))
check("正文切除", body.strip().startswith("# 正文"), repr(body[:20]))

print()
print("=== 块级 ===")
md = """
# 一级标题

段落一，含 **粗体**、*斜体*、`行内代码`、~~删除~~ 和[链接](https://example.com)。

## 二级 标题

- 项目一
- 项目二
  - 嵌套 A
  - 嵌套 B
- [x] 已完成
- [ ] 待办

1. 第一
2. 第二

> 引用第一行
> 引用第二行

```python
def f(x: int) -> int:
    # 注释
    return x * 2  # noqa
```

| 算法 | 复杂度 | 备注 |
|:-----|-------:|:----:|
| A* | O(E log V) | 图搜索 |
| RRT | O(n²) | 采样 |
| 力矩 | $|\\tau| \\le \\tau_{\\max}$ | 绝对值里有竖线 |

---

::: warn 注意
这里有 `:::` 容器。
:::

行内公式 $E = mc^2$ 与块级：

$$
J = \\sum_{i} \\|r_i\\|^2
$$

<div class="raw">原样 HTML</div>
"""
html, toc = render(md)
for name, frag in [
    ("h1", "<h1"),
    ("h2", "<h2"),
    ("粗体", "<strong>粗体</strong>"),
    ("斜体", "<em>斜体</em>"),
    ("行内代码", "<code>行内代码</code>"),
    ("删除线", "<del>删除</del>"),
    ("外链", 'target="_blank"'),
    ("无序列表", "<ul>"),
    ("任务列表", 'type="checkbox"'),
    ("有序列表", "<ol>"),
    ("引用", "<blockquote>"),
    ("代码块", 'class="code-block"'),
    ("语言标注", 'data-lang="python"'),
    ("复制按钮", "code-copy"),
    ("表格", "<table>"),
    ("表格右对齐", "text-align:right"),
    ("分隔线", "<hr>"),
    ("容器", 'callout callout-warn'),
    ("行内公式", 'class="math-inline"'),
    ("块级公式", 'class="math-block"'),
    ("原样 HTML", '<div class="raw">'),
    ("嵌套列表", "<ul><li>嵌套 A</li>"),
]:
    check(name, frag in html, frag)

check("TOC 条数", len(toc) == 1 and toc[0]["text"] == "二级 标题", toc)
check("标题锚点唯一", html.count('id="一级标题"') == 1)
# 表格里的 `$…$` 含竖线时不能被当成分隔符：切错了会多出单元格，
# 而且公式被劈成两半、页面上露出裸美元符号
check("表格单元格数正确（公式里的竖线没被当分隔符）", html.count("<td") == 9,
      html.count("<td"))
check("表格里的绝对值公式完整保留", "|\\tau| \\le \\tau_{\\max}" in html,
      "|\\tau|")
# 有序列表的起始编号要认（幻灯片分步会把一个列表拆成几段，
# 丢掉起始值每一段都从 1 开始 —— 页面上就是「1. 1. 1.」）
_ol = render("3. 第三步\n4. 第四步\n")[0]
check("有序列表从写的编号开始", 'start="3"' in _ol, _ol[:60])
check("从 1 开始的列表不加 start", 'start=' not in render("1. 甲\n2. 乙\n")[0])

print()
print("=== 高亮 ===")
h = highlight("def f(x):\n    return x  # c", "py")
check("python 关键字", 'class="tok-keyword"' in h)
check("python 注释", 'class="tok-comment"' in h)
check("转义", "&lt;" in highlight("a < b > c", "cpp") or "<" not in highlight("<x>", "cpp").replace("&lt;", ""))
check("别名归一", normalize("C++") == "cpp" and normalize("py") == "python", normalize("C++"))
check("未知语言兜底", "<script>" not in highlight("<script>alert(1)</script>", "weird"))
check("plain 也转义", "&lt;b&gt;" in highlight("<b>", ""))

print()
print("=== 可运行示例（```js run）===")
demo_md = (
    "前置段落。\n\n"
    "```js run\n"
    "const t0 = performance.now();\n"
    "let sum = 0;\n"
    "for (let i = 1; i <= 1e6; i++) sum += i;\n"
    'console.log("求和 =", sum.toLocaleString());\n'
    'demo.root.innerHTML = "<b>完成</b>";\n'
    "```\n\n"
    "中间段落。\n\n"
    "```js\n"
    'console.log("普通代码块");\n'
    "```\n\n"
    "```html run\n"
    '<button onclick="this.textContent=\'点到了\'">点我</button>\n'
    "```\n\n"
    "```python run\n"
    "print('run 只对 js/html 生效')\n"
    "```\n"
)
demo_html, _ = render(demo_md)
check("js run 渲染成 demo 面板", demo_html.count('class="demo"') == 2,
      f"demo={demo_html.count('class=\"demo\"')}")
check("普通 js 仍是 code-block", 'class="code-block"' in demo_html)
check("data-demo 标了语言", 'data-demo="js"' in demo_html and 'data-demo="html"' in demo_html)
check("非 js/html 的 run 不生效（仍是代码块）",
      demo_html.count('class="code-block"') == 2,
      f"code-block={demo_html.count('class=\"code-block\"')}")
check("demo 里有运行按钮", "data-demo-run" in demo_html and "data-demo-reset" in demo_html)
check("demo 里有结果挂载点", "data-demo-mount" in demo_html and "data-demo-status" in demo_html)
check("demo 里有源码容器", "data-demo-src" in demo_html)
check("代码默认折叠", demo_html.count("data-demo-code hidden") == 2,
      f"hidden={demo_html.count('data-demo-code hidden')}")
check("有展开/收起代码的按钮",
      demo_html.count("data-demo-toggle aria-expanded") == 2,
      f"toggle={demo_html.count('data-demo-toggle aria-expanded')}")
check("源码带语法高亮", 'class="tok-keyword"' in demo_html or 'class="tok-' in demo_html)
check("运行说明只出现一次（html run 也是）", demo_html.count("可运行示例") == 2)

# 最要紧的一条：源码里出现 </script> 不能提前闭合标签
evil_md = "```js run\n" + 'document.write("</script><img src=x onerror=alert(1)>");\n' + "```\n"
evil_html, _ = render(evil_md)
check("源码中的 </script> 被转义（防提前闭合）",
      "</script><img" not in evil_html and "\\u003c/script" in evil_html)
check("源码里的 onerror 未被当成真实标签",
      "<img src=x onerror" not in evil_html)

print()
print("=== 行内标记的边角 ===")
from mdparse import inline, balance_inline_tags, raw_html_tag  # noqa: E402

# 链接文字里的强调：doc_html 那批文档满页 `[***CS自学指南***](...)`，
# 原来是把 m.group(1) 原样塞进 <a>，星号就原样显示出来了
link_em = inline("[**提问的智慧**](https://x)")
check("链接文字里的粗体被解析",
      "<strong>提问的智慧</strong>" in link_em and "**" not in link_em, link_em)
link_tri = inline("[***CS自学指南***](https://csdiy.wiki/)")
check("链接文字里的粗斜体正确嵌套",
      "<strong><em>CS自学指南</em></strong>" in link_tri, link_tri)
check("链接文字里的裸标签也会还原",
      '<span class="ink ink-red">色</span>' in inline("[带 <red>色</red> 的链接](https://y)")
      and "\x00" not in inline("[带 <red>色</red> 的链接](https://y)"),
      inline("[带 <red>色</red> 的链接](https://y)"))
check("img 的 alt 不带标记",
      'alt="图"' in inline("![**图**](./a.png)"), inline("![**图**](./a.png)"))
check("***粗斜体*** 不产生交叉标签",
      inline("***x***").count("<strong>") == 1 and inline("***x***").count("</strong>") == 1,
      inline("***x***"))
check("不在白名单里的标签照旧转义",
      "&lt;script&gt;" in inline("<script>alert(1)</script>"),
      inline("<script>alert(1)</script>"))
check("白名单裸标签原样生效",
      inline("a<br>b").endswith("a<br>b"), inline("a<br>b"))
check("带属性的裸标签不会被当成标签（防注入）",
      inline('a <red onclick="x">b</red>').find("<span") < 0
      and "&lt;red" in inline('a <red onclick="x">b</red>'),
      inline('a <red onclick="x">b</red>'))

# 跨行的颜色标签会失衡：源文档里 `<blue>空间-内存` 开在列表项、`</blue>` 落在下一个块，
# 不修的话会生成一个孤零零的 `</span>` 开新段落
bal = balance_inline_tags("- 在<blue>空间-内存\n</blue>上所占\n正常一行")
check("跨行的颜色标签在行尾收口（补的是源标签名）",
      bal.split("\n")[0].endswith("</blue>") and "</blue>" not in bal.split("\n")[1], bal)
check("同义标签算同一种（<s> 与 </del>）",
      balance_inline_tags("<s>x</del>").strip() == "<s>x</del>",
      balance_inline_tags("<s>x</del>"))
check("没有配对的闭合被丢掉",
      balance_inline_tags("孤立的</red>闭合").strip() == "孤立的闭合",
      balance_inline_tags("孤立的</red>闭合"))
check("围栏代码里的标签不动",
      balance_inline_tags("```\n<red>x\n```").endswith("<red>x\n```"),
      balance_inline_tags("```\n<red>x\n```"))
check("行内代码里的标签不动",
      balance_inline_tags("写 `<red>` 不会变红") == "写 `<red>` 不会变红")

# 块级 HTML：白名单外的标签要走「原样输出」而不是塞个 None 进结果
# （raw_html_tag 对 <div> 返回 None，忘了兜底就会 TypeError）
check("块级 <div> 原样输出", render("<div>\n<b>粗</b>\n</div>\n")[0].startswith("<div>"),
      render("<div>\n<b>粗</b>\n</div>\n")[0])
check("块级 HTML 不会吞掉后面的普通段落",
      "<p>后面</p>" in render("<div>x</div>\n\n后面\n")[0],
      render("<div>x</div>\n\n后面\n")[0])
check("<br> 是行内标签，不触发块级吞噬",
      "<blockquote>" in render("<br><br>\n> 引用\n")[0],
      render("<br><br>\n> 引用\n")[0])
check("整行 <img> 原样输出",
      render('<img class="float-right" src="a.png">\n')[0].startswith("<img"),
      render('<img class="float-right" src="a.png">\n')[0])

# 内联插图（tools/docfigs.py 生成的多行 <figure><svg>）必须是**原样 HTML 块**。
# 一旦被当成单行标签逐行处理，SVG 的内容会整段被转义成文字，页面上就是
# 一个空方框加一大坨源码 —— 而且语法上完全"没错"，靠肉眼盯截图才发现。
_fig = ('<figure class="docfig-wrap" data-fig="x">\n'
        '<svg class="docfig" viewBox="0 0 10 10"><rect class="fg-box" x="1" y="1" '
        'width="8" height="8"/></svg>\n'
        '<figcaption>说明</figcaption>\n</figure>\n')
_fig_html = render(_fig)[0]
check("多行 <figure> 原样输出，不被转义",
      "<svg" in _fig_html and "&lt;svg" not in _fig_html
      and "fg-box" in _fig_html, _fig_html[:120])
check("<figure> 后面紧跟的正文不受影响",
      "<p>后面</p>" in render(_fig + "\n后面\n")[0],
      render(_fig + "\n后面\n")[0])
check("独立的 <hr> 不会吞掉下一行",
      "<p>下一行</p>" in render("<hr>\n下一行\n")[0],
      render("<hr>\n下一行\n")[0])

print()
print("=== 纯文本抽取 ===")
txt = to_text(md)
check("无 markdown 残留", "```" not in txt and "**" not in txt and "$$" not in txt, txt[:80])

print()
print("=== CSS 压缩 ===")
from build import minify_css  # noqa: E402

mini = minify_css('html[data-cursor="on"] :not(input) { cursor: none; }\n'
                  'a > b , c { color : red ; }')
check("后代选择器的空格没被吃掉", 'html[data-cursor="on"] :not(input)' in mini, mini)
check("子选择器压缩正确", "a>b" in mini, mini)
check("声明原样保留（冒号不再参与压缩）", "cursor: none" in mini, mini)
check("伪类没有被误伤", minify_css("a :hover{color:red}").startswith("a :hover"))

print()
if fails:
    print(f"!! {len(fails)} 项失败: {fails}")
    sys.exit(1)
print("全部通过。")

if "--dump" in sys.argv:
    print()
    print("=" * 70)
    print(html[:4000])
