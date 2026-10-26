"""极简模板引擎。

语法：
  {{ path }}              转义插值
  {{{ path }}}            原样插值
  {{#if path}}…{{/if}}    真值判断（支持 {{#if a}}…{{#else}}…{{/if}}）
  {{#unless path}}…{{/unless}}
  {{#each path}}…{{/each}}  列表循环；元素为标量用 {{.}}，为映射用 {{field}} / {{a.b}}
  {{> partial.html}}      包含另一个模板（继承当前上下文）
  {{! 注释 }}

路径解析：在当前上下文里按 a.b.c 逐层取；取不到时回退到根上下文（便于在 each 里访问 site）。
"""
from __future__ import annotations

import html
import os
import re

TOKEN = re.compile(
    r"\{\{\{\s*([^\}]+?)\s*\}\}\}"     # 1 raw
    r"|\{\{\s*([#/>!]?)\s*([^\}]*?)\s*\}\}"  # 2 sigil, 3 expr
)

MISSING = object()


class TemplateError(RuntimeError):
    pass


def _lookup(path: str, ctx, root):
    path = path.strip()
    if path in (".", "this"):
        # each 循环里 ctx["."] 是当前元素；顶层没有该键时退回 ctx 本身
        if isinstance(ctx, dict) and "." in ctx:
            return ctx["."]
        return ctx
    cur = ctx
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, (list, tuple)) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            cur = MISSING
            break
    if cur is not MISSING:
        return cur
    # 回退到根上下文
    if ctx is not root:
        cur = root
        for part in path.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return MISSING
    return cur


def _truthy(v) -> bool:
    if v is MISSING or v is None or v is False:
        return False
    if isinstance(v, (str, list, tuple, dict)):
        return len(v) > 0
    if isinstance(v, (int, float)):
        return v != 0
    return True


class Engine:
    def __init__(self, root: str):
        self.root = root
        self.cache: dict[str, object] = {}

    def _load(self, name: str):
        if name in self.cache:
            return self.cache[name]
        path = os.path.join(self.root, name)
        if not os.path.isfile(path):
            raise TemplateError(f"模板不存在: {name}")
        with open(path, encoding="utf-8") as fh:
            nodes = self._parse(fh.read(), name)
        self.cache[name] = nodes
        return nodes

    # -- 解析：把模板切成节点流 ----------------------------------------
    def _parse(self, text: str, name: str):
        nodes, pos = [], 0
        stack = [nodes]

        def handle(sigil: str, expr: str):
            cur = stack[-1]
            if sigil in ("#",):
                kind, _, rest = expr.partition(" ")
                node = {"kind": kind, "expr": rest.strip(), "body": [], "alt": []}
                cur.append(node)
                stack.append(node["body"])
            elif sigil == "/":
                if len(stack) == 1:
                    raise TemplateError(f"{name}: 多余的 {{{{/{expr}}}}}")
                want = expr.strip()
                if want == "else":
                    raise TemplateError(f"{name}: else 位置错误")
                node = None
                for n in reversed(stack[-2]):
                    if n.get("kind") in ("if", "unless", "each") and n.get("kind") == want:
                        node = n
                        break
                if node is None:
                    raise TemplateError(f"{name}: {{{{/{want}}}}} 没有匹配的块")
                stack.pop()
            elif sigil == ">":
                cur.append({"kind": "include", "expr": expr.strip(), "body": [], "alt": []})
            elif sigil == "!":
                pass
            else:
                cur.append({"kind": "var", "expr": expr})

        for m in TOKEN.finditer(text):
            if m.start() > pos:
                stack[-1].append({"kind": "text", "text": text[pos:m.start()]})
            pos = m.end()
            raw, sigil, expr = m.group(1), m.group(2) or "", m.group(3) or ""

            if raw is not None:
                stack[-1].append({"kind": "raw", "expr": raw})
                continue
            # 注意：{{else}} 没有 sigil，关键字落在 expr 组里
            if sigil == "" and expr.strip() == "else":
                if len(stack) == 1:
                    raise TemplateError(f"{name}: else 出现在顶层")
                stack.pop()
                # 找到同级最近的分支节点
                parent = stack[-1]
                node = None
                for n in reversed(parent):
                    if n.get("kind") in ("if", "unless", "each") and not n["alt"]:
                        node = n
                        break
                if node is None:
                    raise TemplateError(f"{name}: else 没有对应的 if/unless")
                stack.append(node["alt"])
                continue
            handle(sigil, expr)

        if pos < len(text):
            stack[-1].append({"kind": "text", "text": text[pos:]})
        if len(stack) != 1:
            raise TemplateError(f"{name}: 有未闭合的块 ({len(stack) - 1})")
        return nodes

    # -- 渲染 -----------------------------------------------------------
    def _render_nodes(self, nodes, ctx, root, out: list[str]):
        for node in nodes:
            k = node["kind"]
            if k == "text":
                out.append(node["text"])
            elif k in ("var", "raw"):
                v = _lookup(node["expr"], ctx, root)
                if v is MISSING or v is None:
                    continue
                s = v if isinstance(v, str) else str(v)
                out.append(s if k == "raw" else html.escape(s, quote=True))
            elif k == "if":
                branch = node["body"] if _truthy(_lookup(node["expr"], ctx, root)) else node["alt"]
                self._render_nodes(branch, ctx, root, out)
            elif k == "unless":
                branch = node["alt"] if _truthy(_lookup(node["expr"], ctx, root)) else node["body"]
                self._render_nodes(branch, ctx, root, out)
            elif k == "each":
                items = _lookup(node["expr"], ctx, root)
                if not _truthy(items):
                    self._render_nodes(node["alt"], ctx, root, out)
                    continue
                if isinstance(items, dict):
                    items = [{"key": kk, "value": vv} for kk, vv in items.items()]
                for idx, item in enumerate(items):
                    child = dict(ctx) if isinstance(ctx, dict) else {}
                    if isinstance(item, dict):
                        child.update(item)
                    child["."] = item
                    child["@index"] = idx
                    child["@first"] = idx == 0
                    child["@last"] = idx == len(items) - 1
                    self._render_nodes(node["body"], child, root, out)
            elif k == "include":
                self._render_nodes(self._load(node["expr"]), ctx, root, out)

    def render(self, name: str, context: dict) -> str:
        out: list[str] = []
        self._render_nodes(self._load(name), context, context, out)
        return "".join(out)

    def render_string(self, text: str, context: dict) -> str:
        nodes = self._parse(text, "<string>")
        out: list[str] = []
        self._render_nodes(nodes, context, context, out)
        return "".join(out)
