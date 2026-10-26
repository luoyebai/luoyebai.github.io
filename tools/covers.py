#!/usr/bin/env python3
"""在线封面源：从壁纸站搜索、下载、转成站点能用的封面图。

后台的「在线选封面」靠这个模块。两个源，接口一样：

- **wallhaven**：有正经的 JSON API，`purity=100` 只出 SFW，能带分页、尺寸、
  直达原图链接，缩略图在 `th.wallhaven.cc`（robots.txt 是 `Disallow:` 空值 = 全站允许）。
- **4kwallpapers**：只能解析 HTML。它的 `robots.txt` **明确 Disallow 了 `/search/`、
  `/thumbs/`、`/thumbs_2t/`** —— 所以这里只走允许的分类页（`/nature/`、`/cars/` …）
  取标题与详情页链接，缩略图一律不碰；选中之后才去取那张
  `/images/wallpapers/<slug>-<W>x<H>-<id>.<ext>`（不在 Disallow 列表里）。
  代价是那边没有缩略图预览，得下完才能看 —— 这是刻意换来的合规，不是偷懒。

两条都**不占用仓库体积**：下载后按需缩到封面够用的宽度再存成 WebP。

    from covers import search, fetch
    search("wallhaven", "robot", page=1)          # -> {items, page, pages, total}
    fetch("wallhaven", item, UPLOADS)              # -> assets/uploads/xxx.webp
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 25
# 封面最宽用到 1240px（.phero 的 max-width），留一倍余量给高分屏
COVER_MAX_W = 2000
MAX_BYTES = 24 * 1024 * 1024

# 4kwallpapers 允许浏览的分类（robots 只禁了 /search/ 与两个 thumbs 目录）
WALLPAPER_CATS = [
    ("nature", "自然"), ("abstract", "抽象"), ("cars", "汽车"), ("anime", "动画"),
    ("fantasy", "奇幻"), ("space", "太空"), ("technology", "科技"), ("sports", "运动"),
    ("games", "游戏"), ("movies", "影视"), ("flowers", "花卉"), ("city", "城市"),
    ("minimalism", "极简"), ("black-dark", "暗色"),
]


def _get(url: str, accept: str = "text/html", fetcher=None) -> bytes:
    """取一个 URL。fetcher 只在测试里注入（免得测试依赖外网）。"""
    if fetcher is not None:
        return fetcher(url, accept)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", "Accept": accept})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("文件超过 %d MB，换一张" % (MAX_BYTES // 1048576))
    return data


# ---------------------------------------------------------------------------
# wallhaven
# ---------------------------------------------------------------------------
def _wallhaven_search(query: str, page: int, sorting: str = "relevance",
                      fetcher=None) -> dict:
    params = {
        "q": query or "", "page": max(1, int(page)), "purity": "100",   # 只 SFW
        "categories": "111", "ratios": "16x9", "sorting": sorting,
    }
    url = "https://wallhaven.cc/api/v1/search?" + urllib.parse.urlencode(params)
    raw = _get(url, "application/json", fetcher)
    data = json.loads(raw.decode("utf-8", "replace"))
    meta = data.get("meta") or {}
    items = []
    for w in data.get("data") or []:
        items.append(dict(
            provider="wallhaven",
            id=str(w.get("id") or ""),
            title=(w.get("id") or "").upper(),
            thumb=(w.get("thumbs") or {}).get("large") or (w.get("thumbs") or {}).get("small"),
            # 预览要用**原图**（`path`）。`thumbs.original` 名字听着像大图，
            # 实际可能只有 300×169 —— 拿它当「预览大图」名不副实。
            # 走的是本地代理，多下几 MB 换一个真的能看清的预览，值。
            preview=w.get("path") or (w.get("thumbs") or {}).get("original") or "",
            full=w.get("path"),
            page_url=w.get("url") or "",
            w=int(w.get("dimension_x") or 0),
            h=int(w.get("dimension_y") or 0),
            colours=w.get("colors") or [],
        ))
    return dict(items=items, page=int(meta.get("current_page") or page),
                pages=int(meta.get("last_page") or 1),
                total=int(meta.get("total") or len(items)),
                sorting=sorting)


# ---------------------------------------------------------------------------
# 4kwallpapers（只走允许的分类页）
# ---------------------------------------------------------------------------
CARD_RE = re.compile(
    r'<a[^>]+title="([^"]{0,90})"[^>]+href="(/[a-z0-9\-/]+-\d+\.html)"')
FULL_RE = re.compile(
    r'/images/wallpapers/[a-z0-9\-]+-(\d{3,5})x(\d{3,5})-(\d+)\.(jpe?g|png|webp)', re.I)


def _4k_search(query: str, page: int, fetcher=None) -> dict:
    """query 当分类 slug 用（robots 不允许 /search/）。

    分页走 `?page=N`（`/nature/?page=2` 是允许的，被禁的只有 `/search/` 与
    两个 thumbs 目录）。总页数从页面里的 `?page=86` 这类链接里取最大值。
    """
    slug = (query or "nature").strip().strip("/").lower()
    if not re.fullmatch(r"[a-z0-9\-]+", slug):
        slug = "nature"
    page = max(1, int(page))
    url = "https://4kwallpapers.com/%s/" % slug
    if page > 1:
        url += "?page=%d" % page
    html = _get(url, "text/html", fetcher).decode("utf-8", "replace")
    seen, items = set(), []
    for title, href in CARD_RE.findall(html):
        if href in seen:
            continue
        seen.add(href)
        pid = re.search(r"-(\d+)\.html$", href)
        items.append(dict(
            provider="4kwallpapers", id=pid.group(1) if pid else href,
            title=title.strip(), thumb="", preview="", full="",
            page_url="https://4kwallpapers.com" + href, w=0, h=0, colours=[],
        ))
    pages = [int(p) for p in re.findall(r"\?page=(\d+)", html)] or [1]
    last = max(pages)
    return dict(items=items[:60], page=page, pages=last, total=len(items),
                paginated=last > 1,
                note="4kwallpapers 的 robots.txt 禁了 /search/ 与缩略图目录，"
                     "所以只列允许浏览的分类页、也没有缩略图；"
                     "点一张会由后台取回原图再预览。")


_PREVIEW_CACHE: dict[str, str] = {}


def resolve_preview(provider: str, item: dict, fetcher=None) -> str:
    """给出一张能直接放进 <img> 的预览地址。

    wallhaven 的缩略图是公开的 CDN 地址，浏览器直接取；
    4kwallpapers 没有可用的缩略图（被 robots 禁了），得先打开详情页
    把它挑中的那张原图地址解析出来 —— 只是**解析**，不下载。

    解析结果会缓存：同一张图来回点几次不用反复去敲对方的详情页
    （4kwallpapers 挂在 Cloudflare 后面，连敲太勤会被限速，
    表现为读超时 —— 这不是我们这边的 bug，但能少敲就少敲）。
    """
    if provider == "wallhaven":
        return item.get("preview") or item.get("thumb") or item.get("full") or ""
    if provider == "4kwallpapers":
        if not item.get("page_url"):
            raise ValueError("缺少 4kwallpapers 的详情页地址")
        key = item["page_url"]
        if key in _PREVIEW_CACHE:
            return _PREVIEW_CACHE[key]
        # 预览走小档（~1600），下载才用大档
        url = _4k_resolve(dict(item), fetcher, max_w=1680)
        if len(_PREVIEW_CACHE) > 200:
            _PREVIEW_CACHE.clear()
        _PREVIEW_CACHE[key] = url
        return url
    raise ValueError("不支持的图源：%s" % provider)


def search(provider: str, query: str = "", page: int = 1, mode: str = "search",
           fetcher=None) -> dict:
    """mode="random" 时给一批随机结果。

    - wallhaven 自带 `sorting=random`，每次请求就是重新打乱，一次调用搞定；
    - 4kwallpapers 只能在页码上做文章：先拿第 1 页问出总页数，再随机挑一页取。
      多一次请求，但比「永远只出前 24 张」有用得多。
    """
    if mode == "random":
        if provider == "wallhaven":
            return _wallhaven_search(query, 1, "random", fetcher)
        if provider == "4kwallpapers":
            import random
            first = _4k_search(query, 1, fetcher)
            last = max(1, int(first.get("pages") or 1))
            pick = random.randint(1, last)
            if pick == 1:
                first["rolled"] = pick
                return first
            got = _4k_search(query, pick, fetcher)
            got["rolled"] = pick
            return got
        raise ValueError("不支持的图源：%s" % provider)

    if provider == "wallhaven":
        return _wallhaven_search(query, page, "relevance", fetcher)
    if provider == "4kwallpapers":
        return _4k_search(query, page, fetcher)
    raise ValueError("不支持的图源：%s" % provider)


def _4k_resolve(item: dict, fetcher=None, max_w: int = 2560) -> str:
    """打开详情页，挑一张分辨率合适的原图。

    预览和下载要的尺寸不一样：下载要够封面用（封面本身只用 1240px，留一倍给高分屏，
    所以 ≤2560），而**预览只用于在弹窗里看构图**，取太大纯属浪费带宽和时间
    —— 2560 的那档常常是 1~3 MB，等它加载完预览框一直空着。
    """
    html = _get(item["page_url"], "text/html", fetcher).decode("utf-8", "replace")
    cands = []
    for w, h, _pid, ext in FULL_RE.findall(html):
        w, h = int(w), int(h)
        if 1200 <= w <= max_w:
            cands.append((w, h, ext))
    if not cands:
        for w, h, _pid, ext in FULL_RE.findall(html):
            cands.append((int(w), int(h), ext))
    if not cands:
        raise ValueError("这个页面里没找到可下载的原图")
    cands.sort(key=lambda c: (-c[0], c[1]))
    w, h, ext = cands[0]
    m = re.search(r"-(\d+)\.html$", item["page_url"])
    pid = m.group(1) if m else item["id"]
    stem = re.sub(r"-\d+\.html$", "", item["page_url"].rsplit("/", 1)[-1])
    return "https://4kwallpapers.com/images/wallpapers/%s-%dx%d-%s.%s" % (stem, w, h, pid, ext)


def _4k_fetch(item: dict, fetcher=None) -> tuple[bytes, str]:
    item = dict(item)
    if not item.get("page_url"):
        raise ValueError("缺少 4kwallpapers 的详情页地址")
    url = _4k_resolve(item, fetcher)
    return _get(url, "image/*", fetcher), url


def fetch(provider: str, item: dict, out_dir: str, root: str, fetcher=None) -> dict:
    """把选中的那张图下载下来，转成封面用的 WebP，返回站点相对路径。

    `fetcher` 一并透到下载那一步 —— 否则测试里搜得动、下载却真的去打网络
    （第一次写这个测试就是这么挂的：跑到一半 SSL 握手超时）。
    """
    if provider == "wallhaven":
        url = item.get("full")
        if not url:
            raise ValueError("缺少原图地址")
        raw = _get(url, "image/*", fetcher)
    elif provider == "4kwallpapers":
        raw, url = _4k_fetch(item, fetcher)
    else:
        raise ValueError("不支持的图源：%s" % provider)

    path = _save_webp(raw, out_dir, root, item)
    return dict(path=path, source=url, provider=provider)


def _save_webp(raw: bytes, out_dir: str, root: str, item: dict) -> str:
    from PIL import Image
    im = Image.open(io.BytesIO(raw))
    im.load()
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    if im.width > COVER_MAX_W:
        im = im.resize((COVER_MAX_W, round(im.height * COVER_MAX_W / im.width)),
                       Image.LANCZOS)
    os.makedirs(out_dir, exist_ok=True)
    # 文件名带内容指纹：同一张图重复下载不会堆出好几份
    digest = hashlib.sha1(raw).hexdigest()[:10]
    stem = re.sub(r"[^a-z0-9]+", "-", (item.get("title") or "").lower()).strip("-")[:38]
    pid = re.sub(r"[^A-Za-z0-9]+", "", str(item.get("id") or ""))[:16]
    name = "%s-%s-%s.webp" % (stem or "cover", pid or "x", digest)
    dst = os.path.join(out_dir, name)
    im.save(dst, "WEBP", quality=88, method=6)
    return os.path.relpath(dst, root).replace("\\", "/")


if __name__ == "__main__":                              # 手动试一下
    prov = sys.argv[1] if len(sys.argv) > 1 else "wallhaven"
    q = sys.argv[2] if len(sys.argv) > 2 else "robot"
    r = search(prov, q)
    print("源=%s 查询=%s 共 %s 张，本页 %d 张" % (prov, q, r.get("total"), len(r["items"])))
    for it in r["items"][:6]:
        print("   %-14s %-46s %sx%s" % (it["id"], it["title"][:44], it["w"], it["h"]))
