#!/usr/bin/env python3
"""在线封面源的离线测试。

跑起来**不联网**：HTTP 那一层用假的 fetcher 注进去，只测解析、筛选、落盘和路径安全。
联网的冒烟测试要显式加 `--live`（图源网站挂了不该让本地测试变红）。

    python tools/test-covers.py          # 离线
    python tools/test-covers.py --live   # 顺带打一次真网络
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import covers  # noqa: E402

LINES = []


def ok(cond, msg):
    LINES.append(("PASS  " if cond else "FAIL  ") + msg)
    return cond


WALLHAVEN_JSON = json.dumps({
    "meta": {"current_page": 2, "last_page": 72, "per_page": 24, "total": 1707},
    "data": [
        {"id": "1qog91", "dimension_x": 3840, "dimension_y": 2160,
         "path": "https://w.wallhaven.cc/full/1q/wallhaven-1qog91.png",
         "thumbs": {"large": "https://th.wallhaven.cc/lg/1q/1qog91.jpg"},
         "url": "https://wallhaven.cc/w/1qog91", "colors": ["#000000"]},
        {"id": "jel1jq", "dimension_x": 3840, "dimension_y": 2160,
         "path": "https://w.wallhaven.cc/full/je/wallhaven-jel1jq.jpg",
         "thumbs": {"large": "https://th.wallhaven.cc/lg/je/jel1jq.jpg"},
         "url": "https://wallhaven.cc/w/jel1jq", "colors": []},
    ],
}).encode()

FOURK_LIST = b"""
<div class="wallpapers__item"><a title="Mountain Landscape Wallpaper"
  href="/nature/mountain-landscape-26973.html">
  <img itemprop="thumbnail" src="/images/walls/thumbs/26973.png"></a></div>
<div class="wallpapers__item"><a title="Braided river Wallpaper"
  href="/nature/braided-river-26974.html">
  <img itemprop="thumbnail" src="/images/walls/thumbs/26974.jpg"></a></div>
"""

FOURK_DETAIL = b"""
<meta property="og:image" content="https://4kwallpapers.com/images/walls/thumbs_2t/26973.png" />
<a href="/images/wallpapers/mountain-landscape-3840x2160-26973.png">4K</a>
<a href="/images/wallpapers/mountain-landscape-2560x1440-26973.png">2K</a>
<a href="/images/wallpapers/mountain-landscape-1920x1080-26973.png">HD</a>
"""


SEEN_URLS = []


def fake_fetcher(url, accept):
    SEEN_URLS.append(url)
    # 注意顺序：详情页也在 /nature/ 下面，先判 .html，否则会被列表页规则截胡
    if url.endswith(".html"):
        return FOURK_DETAIL
    if "wallhaven.cc/api/v1/search" in url:
        return WALLHAVEN_JSON
    if "4kwallpapers.com/nature/" in url:
        return FOURK_LIST
    if url.endswith(".png") or url.endswith(".jpg"):
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (2600, 1463), (40, 90, 160)).save(buf, "PNG")
        return buf.getvalue()
    raise AssertionError("假 fetcher 不认识这个地址：%s" % url)


def main():
    live = "--live" in sys.argv
    tmp = tempfile.mkdtemp(prefix="covers-test-")

    # ---------- wallhaven ----------
    SEEN_URLS.clear()
    r = covers.search("wallhaven", "robot", page=2, fetcher=fake_fetcher)
    ok(len(r["items"]) == 2, "wallhaven 解析出 %d 条" % len(r["items"]))
    ok(r["pages"] == 72 and r["total"] == 1707, "分页信息透传（%s/%s）" % (r["page"], r["pages"]))
    q = SEEN_URLS[0]
    ok("purity=100" in q and "categories=111" in q and "ratios=16x9" in q,
       "查询带上了 SFW 与 16:9 过滤")
    ok("page=2" in q, "翻页参数透传（page=2）")
    it = r["items"][0]
    ok(it["w"] == 3840 and it["h"] == 2160, "带尺寸 %dx%d" % (it["w"], it["h"]))
    ok(it["thumb"].startswith("https://th.wallhaven.cc/"), "缩略图来自 th.wallhaven.cc")

    out = covers.fetch("wallhaven", it, tmp, tmp, fetcher=fake_fetcher)
    saved = os.path.join(tmp, out["path"])
    ok(os.path.isfile(saved), "wallhaven 落盘成功（%s）" % os.path.basename(out["path"]))
    from PIL import Image
    im = Image.open(saved)
    ok(im.format == "WEBP", "存成了 WebP（%s）" % im.format)
    ok(im.width <= covers.COVER_MAX_W,
       "超过 %d 宽的会缩到 %d（实际 %d）" % (covers.COVER_MAX_W, covers.COVER_MAX_W, im.width))
    ok(abs(im.width / im.height - 2600 / 1463) < 0.02, "缩放保持了宽高比")

    # 同一张图再下一次：应当命中同一个文件名，不堆垃圾
    out2 = covers.fetch("wallhaven", it, tmp, tmp, fetcher=fake_fetcher)
    ok(out2["path"] == out["path"], "同内容重复下载落到同一个文件（带指纹）")
    ok(len([f for f in os.listdir(tmp) if f.endswith(".webp")]) == 1,
       "目录里只有一份 WebP")

    # ---------- 4kwallpapers ----------
    r4 = covers.search("4kwallpapers", "nature", fetcher=fake_fetcher)
    ok(len(r4["items"]) == 2, "4kwallpapers 解析出 %d 条" % len(r4["items"]))
    ok(r4["items"][0]["title"] == "Mountain Landscape Wallpaper",
       "标题解析正确（%s）" % r4["items"][0]["title"])
    ok(r4["items"][0]["page_url"].endswith("/nature/mountain-landscape-26973.html"),
       "详情页地址拼对了")
    ok(all(not i["thumb"] for i in r4["items"]),
       "4kwallpapers 不给缩略图（robots 禁了 /thumbs_2t/）")
    ok("robots" in (r4.get("note") or ""), "接口里说明了为什么没有缩略图")

    # 查询参数会被当分类 slug：脏输入要兜住，不能拼出任意路径
    r4bad = covers.search("4kwallpapers", "../../etc/passwd", fetcher=fake_fetcher)
    ok(len(r4bad["items"]) == 2, "非法分类回落到 nature（没有拼出穿越路径）")

    url4 = covers._4k_resolve(r4["items"][0], fetcher=fake_fetcher)
    ok("2560x1440-26973" in url4, "详情页里挑了 ≤2560 的最大那张（%s）" % url4.rsplit("/", 1)[-1])
    ok("/thumbs" not in url4, "取的不是被 robots 禁掉的缩略图目录")

    out4 = covers.fetch("4kwallpapers", r4["items"][0], tmp, tmp, fetcher=fake_fetcher)
    ok(os.path.isfile(os.path.join(tmp, out4["path"])), "4kwallpapers 落盘成功")
    ok(not os.path.isabs(out4["path"]) and ".." not in out4["path"],
       "返回的是安全的仓库相对路径（%s）" % out4["path"])
    ok(out4["source"].endswith("-2560x1440-26973.png"),
       "下载的是详情页里挑出来的那张（%s）" % out4["source"].rsplit("/", 1)[-1])

    # ---------- 报错路径 ----------
    for bad in ("nope", "", "  "):
        try:
            covers.search(bad, "x", fetcher=fake_fetcher)
            ok(False, "不支持的图源应当报错（%r）" % bad)
        except ValueError:
            ok(True, "不支持的图源报错（%r）" % bad)
    try:
        covers.fetch("wallhaven", {}, tmp, tmp, fetcher=fake_fetcher)
        ok(False, "缺少原图地址时应当报错")
    except ValueError:
        ok(True, "缺少原图地址时报错，而不是写个空文件")
    try:
        covers.fetch("4kwallpapers", {"id": "1"}, tmp, tmp, fetcher=fake_fetcher)
        ok(False, "缺少详情页地址时应当报错")
    except ValueError:
        ok(True, "缺少详情页地址时报错")

    # ---------- 联网冒烟（可选）----------
    if live:
        try:
            rl = covers.search("wallhaven", "robot")
            ok(len(rl["items"]) > 0, "联网：wallhaven 搜到 %d 张" % len(rl["items"]))
        except Exception as exc:                        # noqa: BLE001
            ok(False, "联网：wallhaven 失败 %s" % str(exc)[:70])
        try:
            rl4 = covers.search("4kwallpapers", "nature")
            ok(len(rl4["items"]) > 0, "联网：4kwallpapers 列到 %d 张" % len(rl4["items"]))
        except Exception as exc:                        # noqa: BLE001
            ok(False, "联网：4kwallpapers 失败 %s" % str(exc)[:70])
    else:
        LINES.append("      （跳过联网冒烟；加 --live 才跑）")

    shutil.rmtree(tmp, ignore_errors=True)
    print("\n".join(LINES))
    fails = [x for x in LINES if x.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d"
          % (len([x for x in LINES if x.startswith(("PASS", "FAIL"))]), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
