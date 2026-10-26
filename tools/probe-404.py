#!/usr/bin/env python3
"""404 页诊断：信标小游戏能不能玩，以及**插图有没有跟着主题走**。

这一页以前是「RRT 轨迹规划」，后来换成了「点亮 3 枚信标」的星际救援页。
探针是跟着旧版写的（找 `#e404-stats`），换页之后一跑就抛 null 异常 ——
那种红是「测试过期」，不是「功能坏了」，最容易把人带偏，所以这里按现版重写。

另外专门加了一条**颜色必须来自主题变量**：这一页原来把机器人写死成
淡蓝 + 薄荷 + 蜜桃，是全站唯一无视主题的元素，亮色下还糊成一团。
断言方式不看 CSS 源码，而是真的切主题/切明暗，看那些颜色有没有变。

    python tools/probe-404.py
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import time

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import cdp  # noqa: E402

PUBLIC = os.path.join(ROOT, "public")
SHOTS = os.path.join(ROOT, "_shots")
PORT = 4186
BASE = "http://127.0.0.1:%d" % PORT


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


STATE = r"""
(function(){
  var b = document.querySelectorAll('[data-beacon]');
  var found = 0;
  b.forEach(function(x){ if (x.classList.contains('is-found')) found++; });
  var mission = document.getElementById('lost-mission');
  var status = document.getElementById('lost-status');
  var scene = document.getElementById('lost');
  var root = document.documentElement;
  var home = document.querySelector('.lost-actions .btn.primary');
  return JSON.stringify({
    beacons: b.length,
    found: found,
    status: status ? status.textContent : '',
    missionShown: mission ? !mission.hidden : false,
    rescued: !!scene && scene.classList.contains('is-rescued'),
    routes: document.querySelectorAll('#lost-routes a').length,
    homeHref: home ? home.getAttribute('href') : '',
    path: location.pathname,
    theme: root.getAttribute('data-theme'),
    mode: root.getAttribute('data-mode'),
    accent: getComputedStyle(root).getPropertyValue('--accent').trim(),
    accent2: getComputedStyle(root).getPropertyValue('--accent-2').trim()
  });
})()
"""

# 机器人 + 环 + 信标 + 水印的实际颜色。这些以前全是写死的十六进制值。
COLORS = r"""
(function(){
  /* 一律画到 1×1 画布上读回来：现代颜色写法（oklch / color-mix / 空格分隔）
     都能归一成 r,g,b，不用手写字符串解析。 */
  var norm = function(c){
    var cv = document.createElement('canvas'); cv.width = cv.height = 1;
    var x = cv.getContext('2d');
    x.fillStyle = '#000'; x.fillStyle = c; x.fillRect(0, 0, 1, 1);
    var d = x.getImageData(0, 0, 1, 1).data;
    return d[0] + ',' + d[1] + ',' + d[2];
  };
  var get = function(sel, prop){
    var el = document.querySelector(sel);
    var v = el ? getComputedStyle(el).getPropertyValue(prop) : '';
    return v ? norm(v) : '';
  };
  var root = getComputedStyle(document.documentElement);
  return JSON.stringify({
    dust:   get('.lost-dust', 'fill'),
    link:   get('.lost-connections path', 'stroke'),
    core:   get('.lost-core', 'stroke'),
    map:    get('.lost-map', 'color'),
    halo:   get('.lost-halo-core', 'stop-color'),
    beacon: get('.lost-beacon', 'color'),
    num:    get('.lost-number', 'stroke'),
    accent:  norm(root.getPropertyValue('--accent')),
    accent2: norm(root.getPropertyValue('--accent-2')),
    theme: document.documentElement.getAttribute('data-theme'),
    mode: document.documentElement.getAttribute('data-mode')});
})()
"""


def main():
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    os.makedirs(SHOTS, exist_ok=True)
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    lines, bad = [], []

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        if not cond:
            bad.append(msg)
        return cond

    try:
        with cdp.Browser(BASE + "/404.html", port=9340, window="1440,1000",
                         wait_load=2.4) as br:
            time.sleep(1.2)
            br.call("Page.enable")
            REC = ("window.__errs=[];"
                   "window.addEventListener('error',function(e){window.__errs.push(''+e.message)});"
                   "window.addEventListener('unhandledrejection',function(e){"
                   "window.__errs.push('rejection: '+e.reason)});")
            br.call("Page.addScriptToEvaluateOnNewDocument", {"source": REC})
            br.call("Page.navigate", {"url": BASE + "/404.html"})
            time.sleep(2.4)

            st = json.loads(br.evaluate(STATE))
            ok(st["beacons"] == 3, "页面上有 3 枚信标（%d）" % st["beacons"])
            ok(st["missionShown"], "「小小救援任务」区块是展开的")
            ok(st["routes"] >= 3, "备用降落点有 %d 个" % st["routes"])
            ok(st["homeHref"] in ("/", ""), "「返回地球」指向首页（%r）" % st["homeHref"])

            # 点亮一枚：状态文案、进度、beacon 自身的状态都要跟着变
            before = st["status"]
            br.evaluate("document.querySelector('[data-beacon]').click()")
            time.sleep(0.6)
            st2 = json.loads(br.evaluate(STATE))
            ok(st2["found"] == 1, "点一下点亮 1 枚（%d）" % st2["found"])
            ok(st2["status"] != before, "状态文案跟着变（%r -> %r）"
               % (before[:16], st2["status"][:16]))

            # 三枚都点亮 -> 先进入 rescued，再**随机降落到一个站内页面**
            # （集满之后 700ms 就会跳走，所以这里得掐着时间看状态）
            br.evaluate("""
            (function(){
              document.querySelectorAll('[data-beacon]').forEach(function(b){
                if (!b.classList.contains('is-found')) b.click();
              });
            })()""")
            time.sleep(0.25)
            st3 = json.loads(br.evaluate(STATE))
            ok(st3["found"] == 3, "三枚都能点亮（%d）" % st3["found"])
            # is-rescued 挂在 <section id="lost"> 上，不是 .lost-space（CSS 里两种都能写）
            ok(st3["rescued"], "集满之后进入「已救援」状态")
            time.sleep(1.4)
            st4 = json.loads(br.evaluate(STATE))
            ok(st4["path"] != "/404.html",
               "救援完成后真的跳走了（现在在 %s）" % st4["path"])
            # 跳走之后原来的元素就没了，后面的断言要回到 404 页重来
            br.call("Page.navigate", {"url": BASE + "/404.html"})
            time.sleep(2.0)

            # ---- 颜色必须来自主题：切主题/切明暗，颜色要跟着动 ----
            base_c = json.loads(br.evaluate(COLORS))
            ok(base_c["map"] not in ("", "none"), "星图有底色（%s）" % base_c["map"])
            changed = {}
            for theme, mode in (("neon", "dark"), ("sakura", "dark"), ("dusk", "light")):
                br.evaluate("document.documentElement.setAttribute('data-theme','%s');"
                            "document.documentElement.setAttribute('data-mode','%s');"
                            % (theme, mode))
                time.sleep(0.5)
                c = json.loads(br.evaluate(COLORS))
                for k in base_c:
                    if c[k] != base_c[k]:
                        changed[k] = changed.get(k, 0) + 1
            # 每一处都应当随主题变（至少变过一次）
            for k in ("dust", "link", "core", "map", "halo", "beacon", "num",
                      "accent", "accent2"):
                ok(changed.get(k, 0) >= 1,
                   "%s 会跟着主题变（3 组里有 %d 组变了）" % (k, changed.get(k, 0)))
            # 断言「跟主题一致」而不是只断言「变了」：切到 neon 后连线用 accent、
            # 星尘与核心用 accent-2。两边都已经被 canvas 归一过，可以直接比。
            br.evaluate("document.documentElement.setAttribute('data-theme','neon');"
                        "document.documentElement.setAttribute('data-mode','dark');")
            time.sleep(0.5)
            c = json.loads(br.evaluate(COLORS))
            st4 = json.loads(br.evaluate(STATE))
            ok(c["link"] == c["accent"],
               "连线用的是当前主题的 --accent（%s vs %s）" % (c["link"], c["accent"]))
            ok(c["dust"] == c["accent2"] and c["core"] == c["accent2"],
               "星尘与核心用的是 --accent-2（%s / %s vs %s）"
               % (c["dust"], c["core"], c["accent2"]))
            ok(c["beacon"] == c["accent"],
               "信标色就是当前主题的 --accent（%s vs %s）" % (c["beacon"], c["accent"]))

            br.evaluate("document.documentElement.setAttribute('data-theme','dusk');"
                        "document.documentElement.setAttribute('data-mode','dark');")
            time.sleep(0.4)

            # ---- 无障碍 / 降级 ----
            # 星图 SVG 里不该有**颜色字面量**（`fill="#fff"` / `stroke="rgb(...)"`）。
            # `fill="url(#lost-halo)"` 是引用渐变，合法 —— 别把它也算进去
            ok(br.evaluate(r"""
            (function(){
              var bad = [];
              document.querySelectorAll('.lost-map *').forEach(function(el){
                ['fill','stroke','stop-color'].forEach(function(k){
                  var v = el.getAttribute(k) || '';
                  if (/^#|^rgba?\(|^hsla?\(/.test(v.trim())) bad.push(k + '=' + v);
                });
              });
              return bad.length === 0;
            })()"""),
               "星图 SVG 里没有写死的颜色（颜色全交给 CSS）")
            ok(br.evaluate("!!document.querySelector('.lost h1') && "
                           "!!document.querySelector('.lost-shortcuts a')"),
               "标题与继续浏览的入口都在（不依赖 JS 也读得到）")
            br.evaluate("document.documentElement.setAttribute('data-motion','off')")
            time.sleep(0.4)
            ok(br.evaluate(
                "[].every.call(document.querySelectorAll('.lost-core, .lost-beacon, "
                ".lost-halo-core'), function(el){"
                "return getComputedStyle(el).animationName === 'none';})"),
                "关掉动效后星图里没有元素还在动")
            ok(br.evaluate(
                "[].every.call(document.querySelectorAll('.lost-map *'), function(el){"
                "return getComputedStyle(el).animationName === 'none';})"),
                "关掉动效后 SVG 里也没有动画")
            br.evaluate("document.documentElement.setAttribute('data-motion','on')")

            errs = br.evaluate("(window.__errs||[]).join(' | ')")
            ok(not errs, "没有 JS 报错%s" % (("（%s）" % errs[:120]) if errs else ""))

            for name in ("404-dark.png",):
                png = br.call("Page.captureScreenshot", {"format": "png"})
                import base64
                with open(os.path.join(SHOTS, name), "wb") as fh:
                    fh.write(base64.b64decode(png["data"]))
            lines.append("      截图 -> %s" % os.path.join(SHOTS, "404-dark.png"))
    finally:
        httpd.shutdown()

    print("\n".join(lines))
    print("\n  %d 项断言，失败 %d"
          % (len([x for x in lines if x.startswith(("PASS", "FAIL"))]), len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
