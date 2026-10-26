"""新建文章 / 项目骨架。

    python tools/new.py post "从零实现 Pure Pursuit"
    python tools/new.py project "mpc-controller"
    python tools/new.py page "now"

生成的文件已带好 front-matter，直接写正文即可。
"""
import datetime as dt
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

POST_TMPL = """---
title: {title}
slug: {slug}
date: {date}
tags: []
summary: 一句话说清这篇要解决什么问题。
# cover: assets/bg/neon.jpg
# featured: true
# updated: {date}
# draft: true
---

先用一段话交代背景：读者在什么场景下会遇到这个问题。

## 问题

把问题定义清楚，最好给出数学形式：

$$
\\min_{{x}} \\ f(x) \\quad \\text{{s.t.}} \\quad g(x) \\le 0
$$

## 做法

```python
def solve(x0):
    # 最小可运行示例
    return x0
```

::: tip 提示
这里放一个实践建议。
:::

## 结果

| 指标 | 改前 | 改后 |
|---|---:|---:|
| 耗时 | - | - |

## 小结

- 要点一
- 要点二
"""

PROJECT_TMPL = """---
title: {title}
slug: {slug}
tagline: 一句话说明这个项目做什么
date: {date}
tags: []
stack: []
status: 开发中
links:
  - {{ label: GitHub, href: "https://github.com/" }}
# cover: assets/bg/void.jpg
# featured: true
# order: 5
---

## 解决什么问题

## 主要特性

- 特性一
- 特性二

## 快速开始

```bash
git clone <repo>
```

## 基准

| 指标 | 数值 |
|---|---:|
| - | - |
"""

PAGE_TMPL = """---
title: {title}
slug: {slug}
summary: 页面描述。
---

正文……
"""

KINDS = {
    "post": ("posts", POST_TMPL),
    "project": ("projects", PROJECT_TMPL),
    "page": ("pages", PAGE_TMPL),
}


def slugify(text: str) -> str:
    """中文标题转 slug：保留中文，去掉标点与空白。"""
    s = text.strip().lower()
    s = re.sub(r"[^\w\u4e00-\u9fff\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    return re.sub(r"-{2,}", "-", s).strip("-") or "untitled"


def main() -> int:
    if len(sys.argv) < 3 or sys.argv[1] not in KINDS:
        print(__doc__)
        return 1
    kind, title = sys.argv[1], sys.argv[2]
    slug = sys.argv[3] if len(sys.argv) > 3 else slugify(title)
    folder, tmpl = KINDS[kind]
    today = dt.date.today().isoformat()
    # 标题里的引号在 YAML 中需要处理
    safe_title = title.replace('"', "'")
    body = tmpl.format(title=f'"{safe_title}"' if any(c in title for c in ":#[]{}") else title,
                       slug=slug, date=today)
    dest = os.path.join(ROOT, "content", folder, f"{slug}.md")
    if os.path.exists(dest):
        print(f"!! 已存在: {dest}")
        return 1
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    print(f"  已创建 {os.path.relpath(dest, ROOT)}")
    print(f"  预览: python tools/build.py --serve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
