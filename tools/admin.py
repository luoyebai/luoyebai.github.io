"""本地写作后台（Python 标准库，无第三方依赖）。

    python tools/admin.py                  # 默认 http://127.0.0.1:4200
    python tools/admin.py --port 4300
    python tools/admin.py --no-build       # 禁用一键构建按钮

只监听回环地址，不上传任何数据。写入范围被限制在 content/ 与 assets/ 之内。
"""
from __future__ import annotations

import base64
import datetime as dt
import difflib
import functools
import hashlib
import hmac
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import mdparse                                    # noqa: E402
import siteicons                                  # noqa: E402
import deck as deckparse                          # noqa: E402
import docfigs                                    # noqa: E402
import covers                                     # noqa: E402
import content_history                            # noqa: E402
from build import Builder, load_config, reading_time, parse_date, fmt_date  # noqa: E402

ADMIN_UI = os.path.join(ROOT, "theme", "admin")
PUBLIC_DIR = os.path.join(ROOT, "public")
CONFIG_PATH = os.path.join(ROOT, "site.config.json")
ASSETS = os.path.join(ROOT, "assets")
UPLOADS = os.path.join(ASSETS, "uploads")
PREVIEW_RUNTIME = {"site.js", "demo.js", "math.js", "learning.js", "mujoco-embed.js"}

KINDS = {"post": "posts", "project": "projects", "page": "pages", "doc": "docs"}
KIND_LABEL = {"post": "文章", "project": "项目", "page": "页面", "doc": "文档"}
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"}
MAX_UPLOAD = 12 * 1024 * 1024          # 单张图 12MB

_build_lock = threading.Lock()
_write_lock = threading.RLock()
_preview_lock = threading.Lock()
_last_build: dict = {"at": "", "ok": None, "output": ""}
_site_port: int = 0          # 站点预览端口，由 main() 设置


# ---------------------------------------------------------------- 工具

def now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def preview_metadata(req: dict, kind: str) -> dict:
    """Share the blog's presentation assets without rebuilding or saving a draft."""
    cfg = load_config()
    appearance = cfg.get("appearance", {})

    def asset_url(name: str, *, runtime: bool = False) -> str:
        path = os.path.join(ROOT, "theme", "static", "js", name) if runtime else os.path.join(PUBLIC_DIR, "assets", name)
        try:
            version = str(os.stat(path).st_mtime_ns)
        except OSError:
            version = "0"
        return "/preview-assets/" + ("runtime/" if runtime else "") + name + "?v=" + version

    styles = [asset_url("themes.css"), asset_url("site.css")]
    if kind == "doc":
        styles.append(asset_url("docs.css"))
    math_enabled = cfg.get("build", {}).get("enableMath", True)
    katex_local = os.path.isfile(os.path.join(PUBLIC_DIR, "assets", "vendor", "katex", "katex.min.js"))
    katex_base = ("/preview-assets/vendor/katex/" if katex_local else
                  cfg.get("build", {}).get("mathCdn", "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/"))
    front = req.get("front") if isinstance(req.get("front"), dict) else {}
    preview_body_class = ""
    if kind == "page" and front.get("slug") in ("learning", "links"):
        page_slug = front["slug"]
        styles.append(asset_url("discovery.css" if page_slug == "learning" else "links.css"))
        preview_body_class = "page-single page-" + page_slug
    # Only rendering metadata is echoed; no slug/path from the draft is opened.
    front = {key: front[key] for key in ("title", "summary", "date", "updated", "tags", "cover", "archived") if key in front}
    base_path = str(cfg.get("build", {}).get("basePath") or "").strip("/")
    site_origin = (f"http://127.0.0.1:{_site_port}" if _site_port else
                   str(cfg.get("site", {}).get("url") or "").rstrip("/"))
    site_base = site_origin + ("/" + base_path if base_path else "") + "/"
    return dict(
        previewAssets=dict(styles=styles,
                           scripts=[asset_url(name, runtime=True) for name in
                                    (["site.js", "demo.js", "math.js", "mujoco-embed.js"] +
                                     (["learning.js"] if preview_body_class == "page-single page-learning" else []))],
                           mathStyle=katex_base + "katex.min.css" if math_enabled else "",
                           mathScripts=[katex_base + "katex.min.js"] if math_enabled else [],
                           katexBase=katex_base, assetBase="/", siteBase=site_base),
        previewTheme=dict(theme=appearance.get("defaultTheme", "dusk"),
                          mode=appearance.get("defaultMode", "dark"),
                          font=appearance.get("defaultFont", "serif"),
                          width="normal", bg="off", motion="off", cursor="off"),
        front=front,
        previewBodyClass=preview_body_class,
    )


def serialized_write(fn):
    """Keep each revision check and write indivisible across admin requests."""
    @functools.wraps(fn)
    def wrapped(*args, **kwargs):
        with _write_lock:
            return fn(*args, **kwargs)
    return wrapped


def file_revision(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def read_versioned_text(path: str) -> tuple[str, str]:
    with open(path, "rb") as fh:
        raw = fh.read()
    return raw.decode("utf-8"), hashlib.sha256(raw).hexdigest()


def atomic_write(path: str, text: str):
    """Unique temp files avoid collisions; a failed write leaves the original intact."""
    fd, tmp = tempfile.mkstemp(prefix=".admin-", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def exclusive_write(path: str, text: str):
    """Publish a complete restore without replacing any existing filename."""
    fd, tmp = tempfile.mkstemp(prefix=".restore-", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        # The same-directory link is atomic and fails if an external editor
        # created the target while the completed temporary file was written.
        os.link(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def clean_color(value, fallback: str) -> str:
    v = str(value or "").strip()
    if HEX_COLOR_RE.match(v):
        return v.lower()
    if re.match(r"^#[0-9a-fA-F]{3}$", v):          # #abc -> #aabbcc
        return "#" + "".join(c * 2 for c in v[1:]).lower()
    return fallback


def clean_themes(raw) -> list[dict]:
    """校验并规范化后台提交的主题列表。返回空列表表示不合法。"""
    if not isinstance(raw, list) or not raw:
        return []
    out, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        tid = re.sub(r"[^a-z0-9-]", "-", str(item.get("id") or "").strip().lower())
        tid = re.sub(r"-{2,}", "-", tid).strip("-")[:32]
        if not tid or tid in seen:
            continue
        seeds = item.get("seeds") if isinstance(item.get("seeds"), dict) else {}
        try:
            hue = int(seeds.get("tintHue", 220))
        except (TypeError, ValueError):
            hue = 220
        out.append({
            "id": tid,
            "name": (str(item.get("name") or tid).strip() or tid)[:24],
            "nameEn": (str(item.get("nameEn") or tid).strip() or tid)[:24],
            "bg": str(item.get("bg") or "").strip(),
            "swatch": [],
            "seeds": {
                "accent": clean_color(seeds.get("accent"), "#7aa2ff"),
                "accent2": clean_color(seeds.get("accent2"), "#ff9d5c"),
                "darkBg": clean_color(seeds.get("darkBg"), "#0a0f1e"),
                "lightBg": clean_color(seeds.get("lightBg"), "#f6f4f0"),
                "tintHue": hue % 360,
            },
        })
        seen.add(tid)
    return out


def content_dir(kind: str) -> str:
    return os.path.join(ROOT, "content", KINDS[kind])


def doc_path(kind: str, slug: str) -> str:
    """只在 content/<kind>/ 内解析，拒绝任何路径逃逸。"""
    safe = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff._-]", "-", slug).strip("-.") or "untitled"
    path = os.path.abspath(os.path.join(content_dir(kind), safe + ".md"))
    if not path.startswith(os.path.abspath(content_dir(kind)) + os.sep):
        raise ValueError("slug 非法")
    return path


def content_route(kind: str, slug: str) -> str:
    return "/" + ("" if kind == "page" else KINDS[kind] + "/") + slug + "/"


def retained_aliases(front: dict, old_front: dict, kind: str, slug: str, original="") -> list[str]:
    """Keep successive renames, including after restoring an older version."""
    values = []
    for source in (old_front.get("aliases"), front.get("aliases")):
        if isinstance(source, list):
            values.extend(source)
    if original and original != slug:
        values.append(content_route(kind, original))
    current = content_route(kind, slug)
    return list(dict.fromkeys(value for value in values
        if isinstance(value, str) and value.startswith("/") and not value.startswith("//")
        and not any(part in (".", "..") for part in value.split("/"))
        and not any(char in value for char in ("?", "#", "\\", "\n", "\r")) and value != current))


def alias_conflict(kind: str, slug: str, aliases: list[str], old: str | None) -> str:
    """Catch URL collisions before saving a rename that would fail the build."""
    wanted = {route.casefold() for route in [content_route(kind, slug)] + aliases}
    for other_kind in KINDS:
        folder = content_dir(other_kind)
        if not os.path.isdir(folder):
            continue
        for name in os.listdir(folder):
            path = os.path.join(folder, name)
            if not name.endswith(".md") or (old and os.path.normcase(path) == os.path.normcase(old)):
                continue
            with open(path, encoding="utf-8") as stream:
                front, _ = mdparse.parse_front_matter(stream.read())
            other_slug = front.get("slug") or os.path.splitext(name)[0]
            routes = [content_route(other_kind, other_slug)]
            if isinstance(front.get("aliases"), list):
                routes.extend(value for value in front["aliases"] if isinstance(value, str))
            collision = next((route for route in routes if route.casefold() in wanted), "")
            if collision:
                return collision
    return ""


def read_json(path: str, default=None):
    if not os.path.isfile(path):
        return default
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def list_docs(kind: str) -> list[dict]:
    folder = content_dir(kind)
    out = []
    if not os.path.isdir(folder):
        return out
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(folder, name)
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        meta, body = mdparse.parse_front_matter(raw)
        d = parse_date(meta.get("date"))
        item = dict(
            slug=meta.get("slug") or os.path.splitext(name)[0],
            file=name,
            title=str(meta.get("title") or "(无标题)"),
            date=str(meta.get("date") or ""),
            date_text=fmt_date(d, "zh"),
            updated=str(meta.get("updated") or ""),
            tags=[str(t) for t in (meta.get("tags") or [])],
            summary=str(meta.get("summary") or ""),
            cover=str(meta.get("cover") or ""),
            draft=bool(meta.get("draft")),
            archived=bool(meta.get("archived")),
            featured=bool(meta.get("featured")),
            order=meta.get("order"),
            mtime=os.path.getmtime(path),
            minutes=reading_time(body),
        )
        if kind == "doc":
            # 文档是幻灯片：列表里要显示「属于哪门课 / 第几篇 / 多少页」，
            # 页数得真的切一遍才知道（分隔线数量 ≠ 页数，空页会被丢掉）。
            item["collection"] = str(meta.get("collection") or "")
            item["slides"] = deckparse.parse(body)["count"]
            item["figures"] = docfigs.FIG_RE.findall(body)
        out.append(item)
    if kind == "doc":
        # 文档没有日期，排序完全靠 order
        out.sort(key=lambda x: (str(x.get("collection") or ""),
                                x["order"] if isinstance(x["order"], int) else 999))
    else:
        out.sort(key=lambda x: (x["date"] or "", x["mtime"]), reverse=True)
    return out


def list_images() -> list[dict]:
    out = []
    for base, label in ((os.path.join(ASSETS, "bg"), "主题背景"),
                        (UPLOADS, "已上传"),
                        (os.path.join(ASSETS, "images"), "站点图片")):
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            if os.path.splitext(name)[1].lower() not in IMG_EXT:
                continue
            rel = os.path.relpath(os.path.join(base, name), ROOT).replace("\\", "/")
            out.append(dict(path=rel, name=name, group=label))
    return out


def collect_tags() -> list[str]:
    tags = set()
    for kind in ("post", "project", "doc"):
        for d in list_docs(kind):
            tags.update(d["tags"])
    return sorted(tags)


def doc_collections() -> list[dict]:
    """课程分组（写在 site.config.json 的 docs.collections 里）。"""
    cfg = load_config()
    out = []
    for i, c in enumerate((cfg.get("docs") or {}).get("collections", [])):
        out.append(dict(id=c.get("id", ""), title=c.get("title", c.get("id", "")),
                        order=int(c.get("order", i + 1))))
    out.sort(key=lambda c: c["order"])
    return out


NEW_TEMPLATES = {
    "post": """---
title: {title}
slug: {slug}
date: {date}
tags: []
summary: 一句话说清这篇要解决什么问题。
---

先用一段话交代背景。

## 问题

## 做法

```python
def solve(x):
    return x
```

## 结果

## 小结

- 要点一
""",
    "project": """---
title: {title}
slug: {slug}
tagline: 一句话说明这个项目做什么
date: {date}
tags: []
stack: []
status: 开发中
links:
  - {{ label: GitHub, href: "https://github.com/" }}
---

## 解决什么问题

## 主要特性

- 特性一

## 快速开始

```bash
git clone <repo>
```
""",
    "page": """---
title: {title}
slug: {slug}
summary: 页面描述。
---

正文……
""",
    # 文档是**幻灯片**：源文档那套分隔线（`---` 新开一节、`----` 同一节的下一页、
    # `++++` 也能当分页）才是分页依据，标题不换页。
    # 骨架里把「两节 + 每节两页」铺好，照着改比对着空白文件想快得多。
    "doc": """---
title: {title}
slug: {slug}
collection: {collection}
order: 99
tags: []
summary: 一句话说清这篇文档讲什么。
---

# {title}

----

## 概述

+ **Q1.** 第一个问题？
+ **Q2.** 第二个问题？
+ **Q3.** 第三个问题？

---

# **Q1.** 第一个问题？

----

## 先给结论

- 这一页只讲一件事。
- 想插图就插一行 `<!--fig:ros-graph-->`（后台工具栏里有插图清单）。

> 引用用来放「注意事项」或者一句总结。

----

## 再展开

```text
代码块、表格、<red>强调色</red> 都能用，
和写文章的 Markdown 子集一样。
```

---

# 小结

1. 一句话总结第一条。
2. 一句话总结第二条。

----

## 下一步

- 打算把这个话题继续往哪写。
""",
}


# ---------------------------------------------------------------- 登录鉴权
#
# 默认语义不变：**不给密码，就只听回环地址，来了就当主人**。
# 一旦要走公网，密码是硬门槛 —— 这个后台能改文章、往 assets/ 传文件、还能
# `subprocess` 跑构建，没有任何内建权限概念；把没密码的它挂到公网，
# 等于把「写权限」交给全网的扫描器（首页没有登录页也照样会被扫到）。
#
#   本机：   python tools/admin.py
#   公网：   ADMIN_PASSWORD='...' python tools/admin.py --host 0.0.0.0 --port 4200
#            （前面必须再套一层 HTTPS 反向代理，见 README「在公网上用后台」）
#
# 会话 = 一个 HMAC 签名串，`_auth_secret` 每次启动随机：重启即全部失效，
# 改密码也会让旧 cookie 立刻作废。cookie 带 HttpOnly + SameSite=Strict；
# 反向代理传 `X-Forwarded-Proto: https` 时再加 Secure。
# 登录失败按来源 IP 限速（10 分钟 5 次），挡住最基本的撞库。

_auth_password = ""
_auth_public_url = ""
_auth_secret = os.urandom(32)
_login_fails: dict = {}
LOGIN_WINDOW = 600.0
LOGIN_LIMIT = 5
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

LOGIN_HTML = """<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>写作后台 · 登录</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0b1020;
         color:#e4edf5; font:15px/1.6 -apple-system,"Segoe UI","Noto Sans SC",sans-serif }
  form { width:min(360px,88vw); padding:28px; border:1px solid rgba(244,243,243,.14);
         border-radius:16px; background:rgba(255,255,255,.04) }
  h1 { margin:0 0 4px; font-size:1.05rem }
  .sub { margin:0 0 20px; color:#8291a5; font-size:.8rem }
  label { display:block; margin-bottom:8px; color:#8291a5; font-size:.78rem }
  input { width:100%; padding:11px 13px; border-radius:10px; border:1px solid rgba(244,243,243,.18);
          background:rgba(11,16,32,.6); color:inherit; font:inherit }
  button { margin-top:16px; width:100%; padding:11px; border:0; border-radius:10px; cursor:pointer;
           background:#e65c00; color:#fff; font:inherit; font-weight:600 }
  .err { margin:0 0 14px; color:#ff8f6b; font-size:.82rem }
</style></head>
<body>
<form method="post" action="/login">
  <h1>写作后台</h1>
  <p class="sub">洛叶白 · 洛叶白博客</p>
  {{error}}
  <label for="pw">密码</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
  <button type="submit">进入</button>
</form>
</body></html>
"""


# ---------------------------------------------------------------- 请求处理

class Handler(BaseHTTPRequestHandler):
    server_version = "dsh-blog-admin"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    # -- 响应helper --------------------------------------------------
    def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", (extra or {}).get("Cache-Control", "no-store"))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            if k == "Cache-Control":
                continue
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json_out(self, value, status: int = 200):
        self._send(status, json.dumps(value, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def fail(self, message: str, status: int = 400):
        self.json_out({"ok": False, "error": message}, status)

    def read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_UPLOAD * 2:
            raise ValueError(
                f"请求体过大（{length // 1048576} MB，上限 {MAX_UPLOAD * 2 // 1048576} MB）；"
                "图片请压到 12MB 以内再上传")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"请求体不是合法 JSON：{exc}") from exc

    # -- 登录鉴权 ----------------------------------------------------
    def _cookie(self, name: str) -> str:
        for part in (self.headers.get("Cookie") or "").split(";"):
            key, _, value = part.strip().partition("=")
            if key == name:
                return value
        return ""

    def _session_token(self) -> str:
        # 密码进 HMAC 的输入：改了密码，旧 cookie 立刻对不上
        return hmac.new(_auth_secret, ("admin:" + _auth_password).encode("utf-8"),
                        hashlib.sha256).hexdigest()

    def _session_cookie(self, clear: bool = False) -> str:
        parts = ["admin_session=" + ("" if clear else self._session_token()),
                 "Path=/", "HttpOnly", "SameSite=Strict",
                 "Max-Age=0" if clear else "Max-Age=604800"]
        if (self.headers.get("X-Forwarded-Proto") or "").lower() == "https":
            parts.append("Secure")
        return "; ".join(parts)

    def _authed(self) -> bool:
        if not _auth_password:
            return True
        return hmac.compare_digest(self._cookie("admin_session"), self._session_token())

    def _client_ip(self) -> str:
        # 反代后面的真实来源；没有反代时 XFF 可伪造，但这里只用来限速
        fwd = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        return fwd or self.client_address[0]

    def _throttled(self) -> bool:
        now = time.time()
        hits = [t for t in _login_fails.get(self._client_ip(), []) if now - t < LOGIN_WINDOW]
        if hits:
            _login_fails[self._client_ip()] = hits
        else:
            _login_fails.pop(self._client_ip(), None)
        return len(hits) >= LOGIN_LIMIT

    def _login_page(self, error: str = "", status: int = 200) -> None:
        body = LOGIN_HTML.replace("{{error}}", error).encode("utf-8")
        self._send(status, body, "text/html; charset=utf-8")

    def _gate(self, path: str) -> bool:
        """返回 True 表示放行；否则已经把响应写完了。"""
        if not self._authed():
            if path.startswith("/api/"):
                self.fail("需要登录", 401)
            else:
                self._send(302, b"", "text/plain; charset=utf-8", {"Location": "/login"})
            return False
        # 已登录的写请求再核一次来源：cookie 已是 SameSite=Strict，
        # 这里再挡一遍「别的站点往这个后台提交表单」。
        if self.command == "POST":
            origin = self.headers.get("Origin") or ""
            if origin and urlsplit(origin).netloc != (self.headers.get("Host") or ""):
                self.fail("跨站请求被拒绝", 403)
                return False
        return True

    def handle_login(self) -> None:
        if self._throttled():
            self._login_page('<p class="err">试太多次了，等十分钟再来。</p>', 429)
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        ctype = (self.headers.get("Content-Type") or "").lower()
        given = ""
        if "application/json" in ctype:
            try:
                given = str(json.loads(raw.decode("utf-8")).get("password") or "")
            except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                given = ""
        else:
            # 登录页是普通表单提交，不走 JS
            given = (parse_qs(raw.decode("utf-8", "replace")).get("password") or [""])[0]
        if given and hmac.compare_digest(given, _auth_password):
            _login_fails.pop(self._client_ip(), None)
            self._send(302, b"", "text/plain; charset=utf-8",
                       {"Location": "/", "Set-Cookie": self._session_cookie()})
            return
        _login_fails.setdefault(self._client_ip(), []).append(time.time())
        self._login_page('<p class="err">密码不对。</p>', 401)

    def handle_logout(self) -> None:
        self._send(302, b"", "text/plain; charset=utf-8",
                   {"Location": "/login", "Set-Cookie": self._session_cookie(clear=True)})

    # -- 路由 --------------------------------------------------------
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if _auth_password and path == "/login":
            return self._login_page()
        if _auth_password and path == "/logout":
            return self.handle_logout()
        if not self._gate(path):
            return
        try:
            self.route_get()
        except Exception as exc:                       # noqa: BLE001
            traceback.print_exc()
            self.fail(f"{type(exc).__name__}: {exc}", 500)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        path = unquote(urlsplit(self.path).path)
        if _auth_password and path == "/login":
            return self.handle_login()
        if _auth_password and path == "/logout":
            return self.handle_logout()
        if not self._gate(path):
            return
        try:
            self.route_post()
        except ValueError as exc:
            # 请求体过大 / JSON 非法，属于客户端问题
            self.fail(str(exc), 413)
        except Exception as exc:                       # noqa: BLE001
            traceback.print_exc()
            self.fail(f"{type(exc).__name__}: {exc}", 500)

    def route_get(self):
        url = urlsplit(self.path)
        path, query = unquote(url.path), parse_qs(url.query)

        if path in ("/", "/index.html"):
            return self.serve_file(os.path.join(ADMIN_UI, "index.html"))
        if path.startswith("/admin/"):
            target = os.path.realpath(os.path.join(ADMIN_UI, path[len("/admin/"):]))
            if not target.startswith(os.path.realpath(ADMIN_UI) + os.sep):
                return self.fail("路径非法", 403)
            return self.serve_file(target)
        if path.startswith("/preview-assets/"):
            return self.serve_preview_asset(path)
        if path.startswith("/assets/"):
            return self.serve_asset(path)
        if path == "/api/state":
            return self.json_out(self.api_state())
        if path == "/api/doc":
            return self.api_doc(query)
        if path == "/api/history":
            return self.api_history(query)
        if path == "/api/history/version":
            return self.api_history_version(query)
        if path == "/api/trash":
            return self.api_trash(query)
        if path == "/api/build-log":
            return self.json_out(_last_build)
        if path == "/api/online/search":
            return self.api_online_search(query)
        if path == "/api/online/proxy":
            return self.api_online_proxy(query)
        self.fail("未找到", 404)

    def route_post(self):
        url = urlsplit(self.path)
        path = unquote(url.path)
        body = self.read_body()
        if path == "/api/save":
            return self.api_save(body)
        if path == "/api/delete":
            return self.api_delete(body)
        if path == "/api/history/restore":
            return self.api_history_restore(body)
        if path == "/api/trash/restore":
            return self.api_trash_restore(body)
        if path == "/api/preview":
            return self.api_preview(body)
        if path == "/api/upload":
            return self.api_upload(body)
        if path == "/api/site":
            return self.api_site(body)
        if path == "/api/theme-suggest":
            return self.api_theme_suggest(body)
        if path == "/api/online/fetch":
            return self.api_online_fetch(body)
        if path == "/api/online/preview":
            return self.api_online_preview(body)
        if path == "/api/build":
            return self.api_build()
        if path == "/api/deploy":
            return self.api_deploy()
        self.fail("未找到", 404)

    # -- 静态文件 ----------------------------------------------------
    def serve_file(self, path: str, ctype: str | None = None):
        if not os.path.isfile(path):
            return self.fail("文件不存在", 404)
        with open(path, "rb") as fh:
            data = fh.read()
        self._send(200, data, ctype or guess_type(path))

    def serve_asset(self, path: str):
        rel = path[len("/assets/"):]
        target = os.path.abspath(os.path.join(ASSETS, rel))
        if not target.startswith(os.path.abspath(ASSETS) + os.sep):
            return self.fail("路径非法", 403)
        self.serve_file(target)

    def serve_preview_asset(self, path: str):
        """Only published assets and explicitly allowed enhancement scripts are exposed.

        The editor preview has an opaque sandbox origin; CORS is needed for its
        webfonts. API and admin resources deliberately do not get this header.
        """
        rel = path[len("/preview-assets/"):]
        if rel.startswith("runtime/"):
            name = rel[len("runtime/"):]
            if name not in PREVIEW_RUNTIME:
                return self.fail("预览脚本不存在", 404)
            root = os.path.realpath(os.path.join(ROOT, "theme", "static", "js"))
            target = os.path.join(root, name)
        else:
            root = os.path.realpath(os.path.join(PUBLIC_DIR, "assets"))
            target = os.path.realpath(os.path.join(root, rel))
            try:
                inside = os.path.normcase(os.path.commonpath([root, target])) == os.path.normcase(root)
            except ValueError:
                inside = False
            if not inside:
                return self.fail("路径非法", 403)
        if not os.path.isfile(target):
            return self.fail("预览资源不存在，请先构建站点", 404)
        with open(target, "rb") as fh:
            data = fh.read()
        if target.lower().endswith(".css"):
            # Relative font URLs already resolve within /preview-assets/. Theme
            # wallpapers use absolute /assets URLs; keep those in the same tree.
            data = re.sub(rb'(url\(\s*[\'\"]?)/assets/', rb'\1/preview-assets/', data)
        self._send(200, data, guess_type(target), {
            "Access-Control-Allow-Origin": "*", "Cache-Control": "private, max-age=300"})

    # -- API ---------------------------------------------------------
    @serialized_write
    def api_state(self) -> dict:
        raw, revision = read_versioned_text(CONFIG_PATH)
        cfg = json.loads(raw)
        docs = {k: list_docs(k) for k in KINDS}
        return dict(
            ok=True,
            configRevision=revision,
            site=cfg.get("site", {}),
            hero=cfg.get("hero", {}),
            nav=cfg.get("nav", []),
            social=cfg.get("social", []),
            appearance=cfg.get("appearance", {}),
            themes=cfg.get("themes", []),
            docs=docs,
            images=list_images(),
            tags=collect_tags(),
            stats={k: len(v) for k, v in docs.items()},
            labels=KIND_LABEL,
            templates=NEW_TEMPLATES,
            docCollections=doc_collections(),
            figures=[dict(name=k, caption=(fn.__doc__ or "").strip().splitlines()[0]
                          if fn.__doc__ else "")
                     for k, fn in docfigs.FIGURES.items()],
            sitePort=_site_port,
            siteOrigin=_auth_public_url,
            last_build=_last_build,
            root=ROOT,
        )

    @serialized_write
    def api_doc(self, query):
        kind = (query.get("kind") or ["post"])[0]
        slug = (query.get("slug") or [""])[0]
        if kind not in KINDS:
            return self.fail("kind 非法")
        path = doc_path(kind, slug)
        if not os.path.isfile(path):
            return self.fail("文档不存在", 404)
        raw, revision = read_versioned_text(path)
        front, body = mdparse.parse_front_matter(raw)
        self.json_out(dict(ok=True, kind=kind, slug=front.get("slug") or slug,
                           revision=revision,
                           front=front, body=body.lstrip("\n")))

    def require_revision(self, req: dict, path: str, label: str) -> bool:
        if not req.get("revision"):
            self.fail("缺少文件版本，请刷新后台后重新打开" + label, 428)
            return False
        if req["revision"] != file_revision(path):
            self.fail(label + "已被其他窗口或编辑器修改；当前输入仍保留，请先复制改动，再重新载入比较。", 409)
            return False
        return True

    @serialized_write
    def api_save(self, req: dict):
        kind = req.get("kind")
        if kind not in KINDS:
            return self.fail("kind 非法")
        front = dict(req.get("front") or {})
        body = str(req.get("body") or "")
        original = req.get("originalSlug") or ""

        slug = str(front.get("slug") or "").strip() or mdparse.slugify(str(front.get("title") or ""))
        if not slug:
            return self.fail("缺少 slug，且无法从标题生成")
        target = doc_path(kind, slug)
        slug = os.path.splitext(os.path.basename(target))[0]
        front["slug"] = slug
        old = doc_path(kind, original) if original else None
        same_target = bool(old and os.path.normcase(old) == os.path.normcase(target))
        if old:
            if not os.path.isfile(old):
                return self.fail("原文件已被删除或重命名；当前输入仍保留，请刷新列表后核对。", 409)
            if not self.require_revision(req, old, "这篇内容"):
                return
        if os.path.exists(target) and not same_target:
            return self.fail("这个 URL 别名已被占用，请换一个 slug；已有内容未被覆盖。", 409)
        old_text = read_versioned_text(old)[0] if old else ""
        old_front = mdparse.parse_front_matter(old_text)[0] if old else {}
        aliases = retained_aliases(front, old_front, kind, slug, original)
        conflict = alias_conflict(kind, slug, aliases, old)
        if conflict:
            return self.fail("链接 " + conflict + " 已被其他内容或它的旧链接占用，请换一个 URL 别名。", 409)
        if aliases:
            front["aliases"] = aliases
        else:
            front.pop("aliases", None)
        # 文档没有日期（源幻灯片本来就没有），别硬塞一个今天进去 ——
        # 塞了之后文档列表会按日期排，顺序全乱。
        if not front.get("date") and kind != "doc":
            front["date"] = dt.date.today().isoformat()
        if kind == "doc":
            ids = [c["id"] for c in doc_collections()]
            if front.get("collection") not in ids:
                return self.fail("collection 必须是已声明的课程之一：" + "、".join(ids))

        # 归一化
        for key in ("draft", "archived", "featured"):
            front[key] = bool(front.get(key))
        tags = front.get("tags")
        if isinstance(tags, str):
            front["tags"] = [t.strip() for t in re.split(r"[,，]", tags) if t.strip()]
        elif tags:
            front["tags"] = [str(t).strip() for t in tags if str(t).strip()]
        if isinstance(front.get("stack"), str):
            front["stack"] = [t.strip() for t in re.split(r"[,，]", front["stack"]) if t.strip()]
        if front.get("order") in ("", None):
            front.pop("order", None)
        else:
            try:
                front["order"] = int(front["order"])
            except (TypeError, ValueError):
                front.pop("order", None)

        text = mdparse.dump_front_matter(front) + "\n" + body.rstrip() + "\n"
        os.makedirs(os.path.dirname(target), exist_ok=True)
        history = content_history.Store(ROOT)
        group = history.group(kind, original or slug, create=True)
        if old:
            history.capture(kind, original, old_text, "保存前", group)
        history.capture(kind, slug, text, "保存", group)
        atomic_write(target, text)

        renamed = False
        if old and not same_target:
            if os.path.isfile(old):
                os.remove(old)
                renamed = True
        history.bind(kind, slug, group, original)

        self.json_out(dict(ok=True, slug=slug, renamed=renamed,
                           revision=hashlib.sha256(text.encode("utf-8")).hexdigest(), front=front,
                           path=os.path.relpath(target, ROOT).replace("\\", "/"),
                           aliases=aliases, aliasMessage="旧链接将在下次构建后自动跳转到新地址" if renamed else ""))

    @serialized_write
    def api_delete(self, req: dict):
        kind, slug = req.get("kind"), req.get("slug")
        if kind not in KINDS or not slug:
            return self.fail("参数不完整")
        path = doc_path(kind, slug)
        if not os.path.isfile(path):
            return self.fail("文档不存在", 404)
        if not self.require_revision(req, path, "这篇内容"):
            return
        raw, _ = read_versioned_text(path)
        front, _ = mdparse.parse_front_matter(raw)
        history = content_history.Store(ROOT)
        item = history.trash(kind, slug, raw, str(front.get("title") or slug))
        os.remove(path)
        history.unbind(kind, slug)
        self.json_out(dict(ok=True, trashId=item["id"], deleted=os.path.relpath(path, ROOT).replace("\\", "/")))

    @serialized_write
    def api_history(self, query):
        kind, slug = (query.get("kind") or [""])[0], (query.get("slug") or [""])[0]
        if kind not in KINDS or not slug:
            return self.fail("参数不完整")
        items, total = content_history.Store(ROOT).versions(kind, slug, (query.get("offset") or [0])[0])
        self.json_out(dict(ok=True, items=items, total=total))

    @serialized_write
    def api_history_version(self, query):
        kind, slug = (query.get("kind") or [""])[0], (query.get("slug") or [""])[0]
        if kind not in KINDS or not slug:
            return self.fail("参数不完整")
        history = content_history.Store(ROOT)
        group = history.group(kind, slug)
        if not group:
            return self.fail("暂无历史版本", 404)
        try:
            meta, raw = history.read(group, (query.get("id") or [""])[0])
        except (FileNotFoundError, ValueError) as exc:
            return self.fail(str(exc), 404)
        path = doc_path(kind, slug)
        current = read_versioned_text(path)[0] if os.path.isfile(path) else ""
        diff = "\n".join(difflib.unified_diff(current.splitlines(), raw.splitlines(),
                         fromfile="当前已保存版本", tofile="选中的历史版本", lineterm=""))
        self.json_out(dict(ok=True, item=meta, text=raw, diff=diff or "与当前已保存版本相同"))

    @serialized_write
    def api_history_restore(self, req):
        kind, slug = req.get("kind"), req.get("slug")
        if kind not in KINDS or not slug:
            return self.fail("参数不完整")
        path = doc_path(kind, slug)
        if not os.path.isfile(path):
            return self.fail("原内容已被删除或重命名", 409)
        if not self.require_revision(req, path, "这篇内容"):
            return
        history = content_history.Store(ROOT)
        group = history.group(kind, slug)
        if not group:
            return self.fail("暂无历史版本", 404)
        try:
            _, raw = history.read(group, req.get("id"))
        except (FileNotFoundError, ValueError) as exc:
            return self.fail(str(exc), 404)
        front, body = mdparse.parse_front_matter(raw)
        # A restore replaces content, not the current published URL. api_save
        # retains aliases and snapshots the current disk version before writing.
        front["slug"] = slug
        return self.api_save(dict(kind=kind, originalSlug=slug, revision=req["revision"], front=front, body=body.lstrip("\n")))

    @serialized_write
    def api_trash(self, query):
        items, total = content_history.Store(ROOT).trash_list((query.get("offset") or [0])[0])
        self.json_out(dict(ok=True, items=items, total=total))

    @serialized_write
    def api_trash_restore(self, req):
        history = content_history.Store(ROOT)
        try:
            item = history.trash_item(req.get("id"))
            _, raw = history.read(item["group"], item["version"])
        except (FileNotFoundError, ValueError) as exc:
            return self.fail(str(exc), 404)
        path = doc_path(item["kind"], item["slug"])
        if os.path.exists(path):
            return self.fail("同名内容已经存在，未覆盖任何文件。请先检查同名内容；这份记录仍保留在回收站。", 409)
        front, _ = mdparse.parse_front_matter(raw)
        aliases = retained_aliases(front, {}, item["kind"], item["slug"])
        conflict = alias_conflict(item["kind"], item["slug"], aliases, None)
        if conflict:
            return self.fail("链接 " + conflict + " 已被其他内容或旧链接占用；未恢复的记录仍在回收站。", 409)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # Exclusive creation also protects against an external editor creating
        # this filename between the existence check and the actual write.
        try:
            exclusive_write(path, raw)
        except FileExistsError:
            return self.fail("同名内容已经存在，未覆盖任何文件。", 409)
        history.bind(item["kind"], item["slug"], item["group"])
        history.restored(item)
        self.json_out(dict(ok=True, kind=item["kind"], slug=item["slug"]))

    def api_preview(self, req: dict):
        # mdparse collects page icons in a module-level set. Keep a preview and
        # its sprite together when several rapid editor requests overlap.
        with _preview_lock:
            mdparse.take_icons()
            try:
                return self._render_preview(req)
            finally:
                mdparse.take_icons()

    def _render_preview(self, req: dict):
        body = str(req.get("body") or "")
        kind = str(req.get("kind") or "post")
        if kind not in KINDS:
            return self.fail("kind 非法")
        metadata = preview_metadata(req, kind)
        tool_site_base = metadata.get("previewAssets", {}).get("siteBase", "")
        # 文档的预览必须**按幻灯片切**，不能整篇当一篇文章渲染 ——
        # 否则分隔线会变成一条条 <hr>，作者完全看不出成品长什么样。
        if kind == "doc":
            parsed = deckparse.parse(body, source_map=True, expand_figures=True)
            missing = parsed.get("missingFigures", [])
            for slide in parsed["slides"]:
                slide["blockIndex"] = slide["block_index"]
                slide["html"] = mdparse.mujoco_tool_links(slide["html"], tool_site_base)
            plain = mdparse.to_text(body)
            return self.json_out(dict(
                ok=True, deck=True,
                slides=parsed["slides"], sections=parsed["sections"],
                count=parsed["count"],
                sprite=siteicons.sprite(mdparse.take_icons()),
                missingFigures=missing,
                toc=[dict(idx=i, title=s["title"]) for i, s in enumerate(parsed["slides"])
                     if s["title"]],
                minutes=reading_time(body), chars=len(plain), **metadata))
        html_body, toc = mdparse.render(body, source_map=True)
        html_body = mdparse.mujoco_tool_links(html_body, tool_site_base)
        # 预览是独立注入到预览框里的片段，页面模板那套「整页一份图标精灵」不生效，
        # 所以这里自己把精灵拼在片段前面 —— 否则外链旁边的品牌标记是空的。
        sprite = siteicons.sprite(mdparse.take_icons())
        plain = mdparse.to_text(body)
        self.json_out(dict(ok=True, html=(sprite + html_body) if sprite else html_body,
                           toc=toc,
                           minutes=reading_time(body),
                           chars=len(plain),
                           words=len(re.findall(r"[A-Za-z0-9_]+", body)), **metadata))

    def api_upload(self, req: dict):
        name = str(req.get("filename") or "upload")
        data = str(req.get("data") or "")
        target = str(req.get("target") or "image")
        ext = os.path.splitext(name)[1].lower()
        if ext not in IMG_EXT:
            shown = ext or "(无扩展名)"
            extra = "；HEIC/HEIF 请先转成 jpg 再上传" if ext in (".heic", ".heif") else ""
            return self.fail(
                f"不支持的图片格式：{shown}。支持 "
                + " / ".join(sorted(e.lstrip('.') for e in IMG_EXT)) + extra)
        try:
            blob = base64.b64decode(data.split(",")[-1], validate=True)
        except Exception:                              # noqa: BLE001
            return self.fail("图片数据解析失败")
        if len(blob) > MAX_UPLOAD:
            return self.fail("图片超过 12MB")

        if target == "avatar":
            dest_dir = os.path.join(ASSETS, "images")
            stem = "avatar"
        else:
            dest_dir = UPLOADS
            # 保留中文与常规字符，压掉连续的分隔符
            stem = re.sub(r"[^\w.-]", "-", os.path.splitext(name)[0], flags=re.UNICODE)
            stem = re.sub(r"-{2,}", "-", stem).strip("-._")[:48] or "image"
        os.makedirs(dest_dir, exist_ok=True)

        # 同名时加序号，避免覆盖
        candidate, n = stem + ext, 1
        while os.path.exists(os.path.join(dest_dir, candidate)) and target != "avatar":
            n += 1
            candidate = f"{stem}-{n}{ext}"
        if target == "avatar":
            for old in os.listdir(dest_dir):
                if old.startswith("avatar.") and old != candidate:
                    os.remove(os.path.join(dest_dir, old))

        path = os.path.join(dest_dir, candidate)
        with open(path, "wb") as fh:
            fh.write(blob)
        rel = os.path.relpath(path, ROOT).replace("\\", "/")
        self.json_out(dict(ok=True, path=rel, bytes=len(blob)))

    # -- 在线封面 ------------------------------------------------------
    def api_online_search(self, query: dict):
        """搜在线封面。走 admin 服务代取，浏览器侧不用管跨域。"""
        provider = (query.get("provider") or ["wallhaven"])[0]
        q = (query.get("q") or [""])[0]
        mode = (query.get("mode") or ["search"])[0]
        try:
            page = int((query.get("page") or ["1"])[0])
        except ValueError:
            page = 1
        try:
            result = covers.search(provider, q, page=page, mode=mode)
        except Exception as exc:                        # noqa: BLE001
            return self.fail("取图源失败：%s" % exc, 502)
        result["provider"] = provider
        result["mode"] = mode
        result["cats"] = [dict(slug=s, label=n) for s, n in covers.WALLPAPER_CATS]
        self.json_out(result)

    def api_online_preview(self, req: dict):
        """只解析出预览地址，**不下载**。

        4kwallpapers 没有可用的缩略图（robots 禁了 thumbs 目录），
        所以它的预览地址得先打开详情页解析出来 —— 这一步很轻，
        等用户点「使用这张」再真正下载。
        """
        provider = str(req.get("provider") or "")
        item = req.get("item") or {}
        try:
            url = covers.resolve_preview(provider, item)
        except Exception as exc:                        # noqa: BLE001
            return self.fail("解析预览地址失败：%s" % exc, 502)
        if not url:
            return self.fail("这个条目没有可用的预览地址")
        # 一律走本地代理，别让浏览器直连图源：
        # 4kwallpapers 带 `Referer: http://127.0.0.1:4200` 去请求会一直挂着不返回
        # （既不是 403 也不是超时，就是不来）；wallhaven 的 CDN 在无头浏览器里
        # 同样会停在 0×0。走代理就是同源请求，用后台的 UA 取，稳。
        url = "/api/online/proxy?url=" + urllib.parse.quote(url, safe="")
        self.json_out(dict(ok=True, url=url))

    def api_online_proxy(self, query: dict):
        """把远端图片取回来转给浏览器。**只允许已知图源的域名**。

        后台是本机工具，但也不该顺手做成一个开放代理：
        任何 URL 都能过的话，页面里一个链接就能拿它去探内网。
        """
        raw = (query.get("url") or [""])[0]
        host = urllib.parse.urlsplit(raw).hostname or ""
        allowed = ("4kwallpapers.com", "wallhaven.cc", "th.wallhaven.cc",
                   "w.wallhaven.cc")
        if not any(host == h or host.endswith("." + h) for h in allowed):
            return self.fail("只代理已知图源的地址（%s）" % (host or "空"), 403)
        try:
            req = urllib.request.Request(raw, headers={
                "User-Agent": covers.UA, "Accept": "image/*,*/*;q=0.8"})
            with urllib.request.urlopen(req, timeout=covers.TIMEOUT) as r:
                body = r.read(covers.MAX_BYTES + 1)
                ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
        except Exception as exc:                        # noqa: BLE001
            return self.fail("取预览图失败：%s" % exc, 502)
        if len(body) > covers.MAX_BYTES:
            return self.fail("预览图太大", 502)
        # 对方时不时不回 Content-Type（4kwallpapers 就是，回了个 binary/data）。
        # 浏览器拿到非 image/* 的类型会拒绝渲染，所以按扩展名兜一下底。
        if not ctype.startswith("image/"):
            ext = os.path.splitext(urllib.parse.urlsplit(raw).path)[1].lower()
            ctype = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                     ".webp": "image/webp", ".gif": "image/gif",
                     ".avif": "image/avif"}.get(ext, "image/jpeg")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # 允许浏览器短时间缓存：同一张图来回点几次不用每次都回源
        self.send_header("Cache-Control", "private, max-age=600")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def api_online_fetch(self, req: dict):
        """下载选中的那张，转成 WebP 落进 assets/uploads/。"""
        provider = str(req.get("provider") or "")
        item = req.get("item") or {}
        if not isinstance(item, dict) or not item:
            return self.fail("缺少要下载的图片信息")
        try:
            out = covers.fetch(provider, item, UPLOADS, ROOT)
        except Exception as exc:                        # noqa: BLE001
            return self.fail("下载失败：%s" % exc, 502)
        size = os.path.getsize(os.path.join(ROOT, out["path"]))
        self.json_out(dict(ok=True, path=out["path"], source=out["source"],
                           bytes=size, provider=out["provider"]))

    @serialized_write
    def api_site(self, req: dict):
        if not self.require_revision(req, CONFIG_PATH, "站点设置"):
            return
        with open(CONFIG_PATH, encoding="utf-8") as fh:
            cfg = json.load(fh)
        if "appearance" in req:
            appearance = req["appearance"]
            if not isinstance(appearance, dict):
                return self.fail("外观设置必须为对象")
            if "defaultCursor" in appearance and appearance["defaultCursor"] not in ("glow", "on", "off"):
                return self.fail("默认鼠标指针必须为微光、圆环或系统指针")
        for key in ("site", "hero", "nav", "social", "appearance"):
            if key in req and isinstance(req[key], (dict, list)):
                cfg[key] = req[key]

        if "themes" in req:
            themes = clean_themes(req["themes"])
            if not themes:
                return self.fail("主题列表不合法：至少要保留一套完整主题")
            for t in themes:
                # swatch 是色块预览，始终由种子色推导，避免和实际配色脱节
                t["swatch"] = [t["seeds"]["accent"], t["seeds"]["accent2"], t["seeds"]["darkBg"]]
            cfg["themes"] = themes
            ids = {t["id"] for t in themes}
            appearance = cfg.setdefault("appearance", {})
            if appearance.get("defaultTheme") not in ids:
                appearance["defaultTheme"] = themes[0]["id"]
        # 覆盖前先留一份备份：手滑或校验漏掉时还能捞回来
        if os.path.isfile(CONFIG_PATH):
            try:
                shutil.copy2(CONFIG_PATH, CONFIG_PATH + ".bak")
            except OSError:
                pass
        text = json.dumps(cfg, ensure_ascii=False, indent=2) + "\n"
        atomic_write(CONFIG_PATH, text)
        self.json_out(dict(ok=True, revision=hashlib.sha256(text.encode("utf-8")).hexdigest()))

    def api_theme_suggest(self, req: dict):
        """按一张背景图推荐种子色，供「新增主题」时起步。"""
        rel = str(req.get("bg") or "").strip().replace("\\", "/")
        if not rel or rel.startswith("/") or ".." in rel:
            return self.fail("背景图路径不合法")
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path) or os.path.splitext(path)[1].lower() not in IMG_EXT:
            return self.fail("找不到这张图片")
        try:
            from PIL import Image
            sys.path.insert(0, HERE)
            import palette
            with Image.open(path) as im:
                seeds = palette.suggest_seeds(im)
            self.json_out(dict(ok=True, seeds=seeds, bg=rel))
        except Exception as exc:                        # noqa: BLE001
            traceback.print_exc()
            self.fail(f"取色失败：{type(exc).__name__}: {exc}", 500)

    def api_build(self):
        """用子进程跑构建。

        不能在本进程里直接调 Builder：admin 启动时就把 build/palette/mdparse
        导入内存了，之后改动这些模块不会生效，会导致「后台构建结果和命令行不一致」。
        走子进程每次都是最新代码，失败也不会把后台带崩。
        """
        global _last_build
        if not _build_lock.acquire(blocking=False):
            return self.json_out(dict(ok=False, error="已有构建在进行中"), 409)
        try:
            proc = subprocess.run(
                [sys.executable, os.path.join(HERE, "build.py"), "--clean"],
                cwd=ROOT, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=900)
            out = (proc.stdout or "").strip()
            err = (proc.stderr or "").strip()
            if err:
                out = (out + "\n" + err).strip()
            ok = proc.returncode == 0
            _last_build = dict(at=now(), ok=ok, output=out)
            self.json_out(dict(_last_build), 200 if ok else 500)
        except Exception as exc:                        # noqa: BLE001
            _last_build = dict(at=now(), ok=False, output=f"{type(exc).__name__}: {exc}")
            self.json_out(dict(_last_build), 500)
        finally:
            _build_lock.release()


    def api_deploy(self):
        """一键发布：子进程跑 `deploy.py`（构建 → 自检 → 提交 → 推送）。

        跟构建一样**必须走子进程**：admin 启动时就把 build 模块导入内存了，
        而且发布要整个重写 `public/`，在本进程里做迟早跟命令行不一致。
        锁跟构建共用 —— 两个都会把 `public/` 搅一遍，不能并发。
        失败时把输出的最后两行当 error 回给界面：git 的报错都在那一行里。
        """
        global _last_build
        req = self.read_body()
        message = str(req.get("message") or "").strip() or "deploy"
        if not _build_lock.acquire(blocking=False):
            return self.json_out(dict(ok=False, error="已有构建或发布在进行中"), 409)
        try:
            cmd = [sys.executable, os.path.join(HERE, "deploy.py"),
                   "--message", message]
            if req.get("dry_run"):
                cmd.append("--dry-run")
            proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=1800)
            out = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
            ok = proc.returncode == 0
            tail = " / ".join(out.splitlines()[-2:]) if out else ""
            _last_build = dict(at=now(), ok=ok, output=out)
            self.json_out(dict(_last_build, error=None if ok else (tail or "发布失败")),
                          200 if ok else 500)
        except Exception as exc:                        # noqa: BLE001
            _last_build = dict(at=now(), ok=False, output=f"{type(exc).__name__}: {exc}")
            self.json_out(dict(_last_build, error=f"{type(exc).__name__}: {exc}"), 500)
        finally:
            _build_lock.release()


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    """浏览器关标签页/取消请求时会直接断开连接，默认实现会打印一大段
    ConnectionResetError 堆栈。那是噪音不是故障，这里静音掉。"""

    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def guess_type(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    return {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
        ".gif": "image/gif", ".avif": "image/avif",
        ".mp4": "video/mp4",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ttf": "font/ttf",
    }.get(ext, "application/octet-stream")


class SiteHandler(http.server.SimpleHTTPRequestHandler):
    """站点预览：直接服务构建产物 public/。

    站点用的是根绝对路径（/assets/...），所以必须挂在独立的根路径上才正确，
    不能用子路径代理。404 时回落到 public/404.html。
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, *a):
        pass

    def site_relative_path(self, path: str) -> str:
        """Preview deployment prefixes without moving or duplicating public files."""
        base = str(load_config().get("build", {}).get("basePath") or "").strip("/")
        prefix = "/" + base if base else ""
        if prefix and (path == prefix or path.startswith(prefix + "/")):
            return path[len(prefix):] or "/"
        return path

    def translate_path(self, path):
        parts = urllib.parse.urlsplit(path)
        return super().translate_path(self.site_relative_path(parts.path))

    def end_headers(self):
        # The editor's sandboxed srcdoc (and nested tool frame) has an opaque
        # origin. Permit only these public, read-only assets to load via CORS;
        # do not weaken the editor sandbox or grant access to admin APIs.
        served = self.translate_path(urllib.parse.urlsplit(self.path).path)
        path = "/" + os.path.relpath(served, PUBLIC_DIR).replace("\\", "/")
        if path.startswith(("/assets/tools/ankle/", "/assets/vendor/mujoco/", "/assets/vendor/three/")):
            self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        page = os.path.join(PUBLIC_DIR, "404.html")
        if code == 404 and os.path.isfile(page):
            body = open(page, "rb").read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)


def start_site_server(port: int):
    """在另一个端口起站点预览，返回 (server, 实际端口)。"""
    for i in range(20):
        try:
            srv = QuietThreadingHTTPServer(("127.0.0.1", port + i), SiteHandler)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            return srv, port + i
        except OSError:
            continue
    return None, 0


def main() -> int:
    global _auth_password, _auth_public_url
    argv = sys.argv[1:]
    port = 4200
    if "--port" in argv:
        port = int(argv[argv.index("--port") + 1])
    host = os.environ.get("ADMIN_HOST") or "127.0.0.1"
    if "--host" in argv:
        host = argv[argv.index("--host") + 1]
    _auth_password = os.environ.get("ADMIN_PASSWORD") or ""
    if "--password" in argv:
        _auth_password = argv[argv.index("--password") + 1]
    _auth_public_url = (os.environ.get("ADMIN_PUBLIC_URL") or "").rstrip("/")
    if "--public-url" in argv:
        _auth_public_url = argv[argv.index("--public-url") + 1].rstrip("/")

    # 没密码就只能待在回环地址上：这不是提示，是拒绝启动。
    if host not in LOOPBACK_HOSTS and not _auth_password:
        print("!! 绑定到非回环地址必须设密码，已中止。")
        print("   ADMIN_PASSWORD='换成长密码' python tools/admin.py --host 0.0.0.0")
        print("   公网还必须再套一层 HTTPS 反向代理（见 README「在公网上用后台」）")
        return 2
    if _auth_password and len(_auth_password) < 8:
        print("!! 密码太短（至少 8 位）。公网上的后台会被自动扫描。")
        return 2

    os.makedirs(UPLOADS, exist_ok=True)

    for i in range(20):
        try:
            httpd = QuietThreadingHTTPServer((host, port + i), Handler)
            port = port + i
            break
        except OSError:
            continue
    else:
        print("!! 找不到可用端口")
        return 1

    # 站点预览挂在另一个端口上：站点用根绝对路径，必须独占根路径才正确
    global _site_port
    site_srv, site_port = (None, 0)
    if os.path.isdir(PUBLIC_DIR):
        site_srv, site_port = start_site_server(port + 1)
        _site_port = site_port

    base = _auth_public_url or f"http://{host}:{port}"
    print(f"  写作后台: {base}/")
    print("  登录: " + ("已启用密码" if _auth_password else "免登录（只监听回环地址）"))
    if _auth_password and not _auth_public_url:
        print("  公网请用 HTTPS 反向代理转发到这个端口，并设 --public-url https://你的域名")
    if site_port:
        print(f"  站点预览: http://127.0.0.1:{site_port}/")
    else:
        print("  站点预览: 未构建（先点后台里的「构建站点」）")
    print(f"  内容目录: {os.path.join(ROOT, 'content')}")
    print("  Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止")
    finally:
        if site_srv is not None:
            site_srv.shutdown()
            site_srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
