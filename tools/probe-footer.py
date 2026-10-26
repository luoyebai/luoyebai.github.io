#!/usr/bin/env python3
"""页脚探针：内容够不够、短页面会不会贴在视口底部、链接通不通、字压得住吗。

页脚有两个很容易"看起来没事"的毛病：

1. **短页面不贴底**。内容不够长时，页脚会停在中下位置，下面露出一大片空背景。
   这靠 `body { display:flex; flex-direction:column }` + `main { flex:1 }` 解决，
   而验证它的唯一办法是**把视口撑得比内容还高**再看页脚底部在哪。
2. **模板静默渲染出空标签**。`{{#each}}` 遇到元组（而不是 dict）时取不到
   `{{name}}`，会渲染成三个空白胶囊 —— 页面不报错、布局也不塌，只有盯截图才看得见。

    python tools/probe-footer.py
"""
import base64
import functools
import http.server
import io
import json
import os
import socketserver
import sys
import threading
import time
import urllib.request

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import cdp  # noqa: E402

PUBLIC = os.path.join(ROOT, "public")
PORT = 4188
SHOTS = os.path.join(ROOT, "_shots")
BASE = "http://127.0.0.1:%d" % PORT

# 各种版式都要有页脚：首页、列表、正文、文档（自带阅读器）、图谱（全屏舞台）、404
PAGES = [
    ("/", "首页"),
    ("/posts/", "文章列表"),
    ("/posts/dds-qos-tuning/", "文章页"),
    ("/docs/", "文档总览"),
    ("/docs/ros-tools/", "文档（幻灯片）"),
    ("/graph/", "图谱"),
    ("/404.html", "404"),
]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True


class QuietServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    return 0.2126 * _lin(rgb[0]) + 0.7152 * _lin(rgb[1]) + 0.0722 * _lin(rgb[2])


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def parse_rgb(s):
    return tuple(int(x) for x in s.replace("rgba(", "").replace("rgb(", "")
                 .replace(")", "").split(",")[:3])


def median_color(png_bytes, rect):
    from PIL import Image
    im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    x, y = max(0, int(rect["x"])), max(0, int(rect["y"]))
    w = min(im.width - x, max(1, int(rect["w"])))
    h = min(im.height - y, max(1, int(rect["h"])))
    px = list(im.crop((x, y, x + w, y + h)).getdata())
    px.sort(key=luminance)
    return px[len(px) // 2]


FOOT = """
(function(){var f=document.querySelector('.footer');
 if(!f) return null; var r=f.getBoundingClientRect();
 return {innerH:window.innerHeight, docH:document.documentElement.scrollHeight,
   top:r.top+window.scrollY, bottom:r.bottom+window.scrollY, h:r.height,
   gapBelow:Math.round(document.documentElement.scrollHeight-(r.bottom+window.scrollY)),
   cols:document.querySelectorAll('.footer-col').length,
   links:document.querySelectorAll('.footer-link').length,
   navs:document.querySelectorAll('.footer-nav a').length,
   chips:document.querySelectorAll('.footer-chip').length,
   stats:document.querySelectorAll('.footer-stats div').length,
   metas:document.querySelectorAll('.footer-meta-item').length,
   latest:[].slice.call(document.querySelectorAll('.footer-link')).map(function(a){
     return a.getAttribute('href');}),
   colophon:document.querySelector('.footer-colophon').textContent.replace(/\\s+/g,' ').trim(),
   emptyMeta:[].slice.call(document.querySelectorAll('.footer-meta-item')).filter(function(e){
     return e.textContent.trim().length<5;}).length,
   topLink:!!document.querySelector('.footer a[href$="/"], .footer-more')};})()
"""


def main():
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    os.makedirs(SHOTS, exist_ok=True)
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    lines = []

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        return cond

    try:
        # ---------- 1) 每种版式都有页脚，内容不空 ----------
        port = 9480
        for path, label in PAGES:
            with cdp.Browser(BASE + path, port=port, window="1440,1000", wait_load=2.2) as br:
                port += 1
                time.sleep(1.0)
                m = json.loads(br.evaluate("JSON.stringify(%s)" % FOOT) or "null")
                if not ok(m is not None, "%s：有页脚" % label):
                    continue
                ok(m["cols"] == 3 and m["links"] >= 3 and m["navs"] >= 8,
                   "%s：三组链接齐全（列 %d / 条目 %d / 导航 %d）"
                   % (label, m["cols"], m["links"], m["navs"]))
                ok(m["chips"] >= 3 and m["stats"] == 4 and m["metas"] >= 4,
                   "%s：社交 %d、统计 %d、字体/站点 %d" % (label, m["chips"], m["stats"], m["metas"]))
                ok(m["emptyMeta"] == 0,
                   "%s：没有渲染成空白的胶囊（空 %d 个）" % (label, m["emptyMeta"]))
                ok(m["gapBelow"] == 0, "%s：页脚下面没有留空（%d px）" % (label, m["gapBelow"]))
                ok(len(m["colophon"]) > 10 and "©" in m["colophon"],
                   "%s：底栏有版权与构建信息" % label)

        # ---------- 1b) 页脚不能把页面的脚本带崩 ----------
        # 页脚是纯静态标记，但它被拼进每一个页面；少一个闭合标签就可能让
        # 后面的脚本解析失败——那种错误只会出现在控制台，不会出现在 HTML 里。
        # 注入录制器必须在导航**之前**，且必须先 Page.enable，
        # 否则 Edge 会静默丢掉 addScriptToEvaluateOnNewDocument。
        REC = ("window.__errs=[];"
               "window.addEventListener('error',function(e){window.__errs.push(String(e.message))});"
               "window.addEventListener('unhandledrejection',function(e){"
               "window.__errs.push('rejection: '+e.reason)});")
        for path, label in PAGES:
            br = cdp.Browser("about:blank", port=port, window="1440,1000", wait_load=0.6)
            port += 1
            try:
                br.call("Page.enable")
                br.call("Page.addScriptToEvaluateOnNewDocument", {"source": REC})
                br.call("Page.navigate", {"url": BASE + path})
                time.sleep(2.4)
                ok(br.evaluate("!!window.__errs") is True, "%s：错误录制器确实注入了" % label)
                errs = br.evaluate("window.__errs.join(' | ')")
                ok(not errs, "%s：无 JS 报错%s" % (label, ("（%s）" % errs[:160]) if errs else ""))
            finally:
                br.close()

        # ---------- 2) 短页面必须贴住视口底部 ----------
        # 把视口撑到 2400px，随便哪个页面都比它短 —— 这正是「页脚停在中下位置」的场景。
        with cdp.Browser(BASE + "/tags/git/", port=port, window="1440,2400", wait_load=2.2) as br:
            port += 1
            time.sleep(1.2)
            m = json.loads(br.evaluate("JSON.stringify(%s)" % FOOT))
            ok(m["docH"] == m["innerH"],
               "内容比视口短时，文档高度被撑满（%d vs %d）" % (m["docH"], m["innerH"]))
            ok(abs(m["bottom"] - m["innerH"]) <= 1,
               "页脚底边正好落在视口下沿（%.0f vs %d）" % (m["bottom"], m["innerH"]))
            main_h = br.evaluate("Math.round(document.getElementById('main').getBoundingClientRect().height)")
            ok(main_h > 600, "main 被拉伸填满了中间那段（%d px）" % main_h)

        # ---------- 3) 页脚里的链接都能打开 ----------
        with cdp.Browser(BASE + "/", port=port, window="1440,1000", wait_load=2.2) as br:
            port += 1
            time.sleep(1.0)
            hrefs = json.loads(br.evaluate(
                "JSON.stringify([].slice.call(document.querySelectorAll('.footer a[href]'))"
                ".map(function(a){return a.getAttribute('href');}))"))
        bad = []
        for h in sorted(set(hrefs)):
            if h.startswith(("mailto:", "tel:", "http")):
                continue
            try:
                r = urllib.request.urlopen(BASE + h, timeout=15)
                if r.status != 200:
                    bad.append("%s -> %d" % (h, r.status))
            except Exception as e:                       # noqa: BLE001
                bad.append("%s -> %s" % (h, e))
        ok(len(hrefs) >= 15, "页脚共 %d 个链接" % len(hrefs))
        ok(not bad, "页脚链接全部可访问" + ("（坏的：%s）" % bad[:3] if bad else ""))

        # ---------- 4) 字压在页脚底色上读得清吗（两种模式各测一次） ----------
        with cdp.Browser(BASE + "/tags/git/", port=port, window="1440,1000", wait_load=2.2) as br:
            port += 1
            time.sleep(1.2)
            for mode in ("dark", "light"):
                br.evaluate("document.documentElement.setAttribute('data-mode','%s')" % mode)
                time.sleep(0.7)
                box = json.loads(br.evaluate(
                    "(function(){var r=document.querySelector('.footer-col').getBoundingClientRect();"
                    "return JSON.stringify({top:r.top+window.scrollY,h:r.height,left:r.left,w:r.width});})()"))
                color = br.evaluate(
                    "getComputedStyle(document.querySelector('.footer-link .t')).color")
                shot = br.call("Page.captureScreenshot", {
                    "format": "png", "captureBeyondViewport": True,
                    "clip": {"x": box["left"], "y": box["top"],
                             "width": box["w"], "height": box["h"], "scale": 1}})
                bg = median_color(base64.b64decode(shot["data"]),
                                  {"x": 2, "y": 2, "w": box["w"] - 4, "h": box["h"] - 4})
                ct = contrast(parse_rgb(color), bg)
                ok(ct >= 4.5, "%s：页脚链接对比度 %.2f:1（底色 rgb%s）" % (mode, ct, bg))

            shot = br.call("Page.captureScreenshot", {
                "format": "png", "captureBeyondViewport": True,
                "clip": {"x": 0, "y": float(br.evaluate(
                    "document.querySelector('.footer').getBoundingClientRect().top+window.scrollY")),
                    "width": 1440, "height": 440, "scale": 1.4}})
            p = os.path.join(SHOTS, "footer-light.png")
            with open(p, "wb") as fh:
                fh.write(base64.b64decode(shot["data"]))
            lines.append("      截图 -> %s" % p)
    finally:
        httpd.shutdown()

    print("\n".join(lines))
    fails = [l for l in lines if l.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d" % (len([l for l in lines if l.startswith(("PASS", "FAIL"))]),
                                     len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
