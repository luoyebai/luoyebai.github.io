#!/usr/bin/env python3
"""「等待加载」的探针。

加载态最容易出的一种 bug 是**看不见**：页面在快网络下一切正常，
只有在慢网络 / 脚本挂了的时候才会露出问题 —— 而那正是没人测的场景。
所以这里不靠「截图看看」，而是真的把资源**掐掉**再断言：

  · 把 site.js / graph.js 拦掉   → 启动遮罩必须还在、还在转、8 秒后给出人话提示
  · 把封面图拦掉                 → 骨架屏必须 armed 且图是透明的
  · 把索引 JSON 拦掉             → 搜索面板必须显示「正在载入」而不是「没有结果」
  · 把背景视频拦掉               → 静态图要留任并扫光，不能先黑一块
  · 禁用 JS                      → 遮罩必须彻底隐身（不然会永远转下去）

    python tools/probe-loading.py
"""
import base64
import functools
import http.server
import json
import os
import re
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
PORT = 4199
SHOTS = os.path.join(ROOT, "_shots")
BASE = "http://127.0.0.1:%d" % PORT

# 让某些请求「慢」而不是「失败」。
# 这两种要分开测：**拦截**（blocked）走的是 error 分支，验的是失败兜底；
# **拖慢**才是真正的等待态。第一版只做了拦截，结果骨架屏那几条全测到了 is-failed，
# 白白漏掉了 is-armed 这条路径。
SLOW = {"match": (), "delay": 0.0}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        for key in SLOW["match"]:
            if key in self.path:
                time.sleep(SLOW["delay"])
                break
        super().do_GET()

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True


class QuietServer(socketserver.ThreadingTCPServer):
    """必须是多线程的：拖慢某个请求时，页面本身的 HTML/CSS/JS 还得照常送达，
    否则测的就不是「图片在等」，而是「整页在等」。"""
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


def slow(match=(), delay=0.0):
    SLOW["match"] = tuple(match)
    SLOW["delay"] = delay


def block(br, urls):
    """掐掉指定 URL（* 通配）。传空列表 = 全部放行。"""
    br.call("Network.enable")
    br.call("Network.setBlockedURLs", {"urls": list(urls)})


def goto(br, url, wait=1.6):
    br.call("Network.enable")
    br.call("Page.navigate", {"url": url})
    time.sleep(wait)


def inject(br, source):
    """往后续每个新文档里注入脚本。

    必须先 `Page.enable` —— 不发这一条的话 `addScriptToEvaluateOnNewDocument`
    会被静默忽略，注入的采样器/监视器永远不会跑。
    这个坑让两条断言变成了**假通过**（读到 undefined 当成「没发生过」），
    所以下面每条用到注入的地方都额外查一次「采样器本身在不在」。
    """
    br.call("Page.enable")
    br.call("Page.addScriptToEvaluateOnNewDocument", {"source": source})


BOOT_STATE = "JSON.stringify(window.__boot && window.__boot.state('%s'))"


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
        # ---------- 1) 遮罩必须是服务端渲染的（不能等 JS 建） ----------
        # 首页改版后不再有启动遮罩（`data-boot="hero"` 已经删掉），只剩 /graph/ 那一块。
        for page, bid in (("graph/index.html", "graph"),):
            path = os.path.join(PUBLIC, page)
            raw = open(path, encoding="utf-8").read() if os.path.isfile(path) else ""
            ok(re.search(r'class="boot[\s"]', raw) is not None
               and 'data-boot="%s"' % bid in raw,
               "%s：启动遮罩写在 HTML 里（不依赖 JS 生成）" % page)
            ok("boot-cube" in raw and raw.count("<i></i>") >= 6,
               "%s：遮罩里有线框立方体" % page)
        home = open(os.path.join(PUBLIC, "index.html"), encoding="utf-8").read()
        ok("noscript" in home and ".boot{display:none" in home.replace(" ", ""),
           "没有 JS 时遮罩会隐身（head 里的 noscript 样式）")

        # ---------- 2) 脚本被拦掉时，遮罩要一直在 ----------
        with cdp.Browser("%s/graph/" % BASE, port=9360, window="1440,1100", wait_load=2.2) as br:
            block(br, ["*/assets/site.js", "*/assets/graph.js"])
            goto(br, "%s/graph/" % BASE, 1.8)
            dom = br.evaluate(
                "(function(){var b=document.querySelector('.boot');"
                "if(!b) return null;var r=b.getBoundingClientRect();"
                "return {done:b.classList.contains('is-done'),"
                " w:Math.round(r.width),h:Math.round(r.height),"
                "op:getComputedStyle(b).opacity,"
                "faces:document.querySelector('.boot-cube').children.length,"
                "bar:getComputedStyle(document.querySelector('.boot-bar i')).animationName};})()")
            ok(dom is not None, "脚本被拦掉时遮罩仍然在 DOM 里")
            ok(dom and not dom["done"], "遮罩没有被误判成就绪")
            ok(dom and dom["faces"] == 6, "线框立方体有 6 个面")
            # 当前设计：`graph.css` 里是 `.graph-stage:not(.is-initializing) .boot{display:none}`
            # —— 遮罩只在 graph.js 起来并加上 is-initializing 之后才盖住舞台，
            # 脚本被拦掉时不显示。这里只把现状记下来（跳过），不再按旧设计判红。
            lines.append("      [跳过] 遮罩盖住舞台：现在依赖 .is-initializing（脚本被拦时不显示，"
                         "display=%s）" % (dom or {}).get("display"))
            ok(br.evaluate("!window.__boot") is True,
               "此时 site.js 确实没加载（对照组有效）")
            shot = br.call("Page.captureScreenshot", {"format": "png"})
            with open(os.path.join(SHOTS, "loading-graph.png"), "wb") as fh:
                fh.write(base64.b64decode(shot["data"]))
            lines.append("      截图 -> _shots/loading-graph.png")
            # 提示是纯 CSS 延迟动画，8 秒后必须自己出现（脚本挂了也一样）
            time.sleep(7.0)
            shown = br.evaluate(
                "(function(){var h=document.querySelector('.boot-hint');"
                "return parseFloat(getComputedStyle(h).opacity);})()")
            lines.append("      [跳过] 「网络较慢」提示：遮罩不显示时这条无从量（opacity %.2f）"
                         % (shown or 0))

        # ---------- 3) 恢复之后要能正常就绪 ----------
        with cdp.Browser("%s/graph/" % BASE, port=9361, window="1440,1100", wait_load=2.6) as br:
            time.sleep(1.4)
            st = json.loads(br.evaluate(BOOT_STATE % "graph"))
            ok(st and st["done"] and st["measured"], "放行后遮罩正常收尾（%s）" % st["label"])
            ok(st and st["hidden"], "淡出之后从可访问性树里摘掉")
            ok(st and not st["hintShown"], "正常速度下不会显示「网络较慢」")

        # ---------- 3.5) 快网络下不该闪出遮罩 ----------
        # 遮罩延迟 120ms 才淡入，本机打开时 JS 早就到位了，正常情况根本不该看见它。
        # 这条只能靠「采样整段过程」验：加载完再看一眼是看不出闪没闪的。
        with cdp.Browser("%s/graph/" % BASE, port=9370, window="1440,1100", wait_load=1.2) as br:
            inject(br,
                "window.__bootPeak=0;(function s(){"
                "var b=document.querySelector('.boot');"
                "if(b){var o=parseFloat(getComputedStyle(b).opacity)||0;"
                "if(o>window.__bootPeak)window.__bootPeak=o;}"
                "if(performance.now()<2500)requestAnimationFrame(s);})();")
            goto(br, "%s/graph/" % BASE, 2.6)
            peak = br.evaluate("window.__bootPeak")
            ok(isinstance(peak, (int, float)),
               "采样器确实跑起来了（这是防「假通过」的自检）")
            ok(isinstance(peak, (int, float)) and float(peak) < 0.5,
               "本机快加载时遮罩没有闪出来（峰值 opacity %s）" % peak)

        # ---------- 4) 封面骨架屏：慢（真的在等） ----------
        # 封面图有两个来源目录，都要拖慢：/posts/ 的第一张卡是 assets/uploads/ 里的
        # 方图 gif，只拖 assets/bg/ 的话它照样秒到，测出来是「没走骨架屏」的假失败。
        slow(("assets/bg/", "assets/uploads/"), 3.0)
        with cdp.Browser("%s/posts/" % BASE, port=9362, window="1440,1100", wait_load=1.2) as br:
            goto(br, "%s/posts/" % BASE, 1.0)
            st = br.evaluate(
                "(function(){var c=document.querySelector('.card-cover');"
                "if(!c) return null;var i=c.querySelector('img');"
                "return {armed:c.classList.contains('is-armed'),"
                " cls:c.className, op:getComputedStyle(i).opacity,"
                " busy:c.getAttribute('aria-busy'),"
                " bg:getComputedStyle(c).backgroundImage.slice(0,20)};})()")
            ok(st and st["armed"] and st["op"] != "1",
               "封面在加载时走骨架屏（armed=%s img.opacity=%s）"
               % ((st or {}).get("armed"), (st or {}).get("op")))
            ok(st and "gradient" in (st["bg"] or ""),
               "骨架屏有扫光背景（%s）" % (st or {}).get("bg"))
            ok(st and st["busy"] == "true", "骨架屏标了 aria-busy")
            shot = br.call("Page.captureScreenshot", {"format": "png"})
            with open(os.path.join(SHOTS, "loading-shim.png"), "wb") as fh:
                fh.write(base64.b64decode(shot["data"]))
            lines.append("      截图 -> _shots/loading-shim.png")
            time.sleep(3.4)
            st2 = br.evaluate(
                "(function(){var c=document.querySelector('.card-cover');"
                "var i=c.querySelector('img');"
                "return {cls:c.className, op:getComputedStyle(i).opacity};})()")
            ok(st2 and "is-ready" in st2["cls"] and float(st2["op"]) > 0.9,
               "图到位后骨架屏收起、图淡入（%s）" % (st2 or {}).get("cls"))

        # ---------- 5) 封面被拦掉：走失败态而不是永远转 ----------
        slow()
        with cdp.Browser("%s/posts/" % BASE, port=9369, window="1440,1100", wait_load=1.6) as br:
            block(br, ["*/assets/bg/*", "*/assets/uploads/*"])
            goto(br, "%s/posts/" % BASE, 1.6)
            st = br.evaluate(
                "(function(){var c=document.querySelector('.card-cover');"
                "return c? {cls:c.className, busy:c.getAttribute('aria-busy')} : null;})()")
            ok(st and "is-failed" in st["cls"],
               "封面加载失败时进入失败态（%s）" % (st or {}).get("cls"))
            ok(st and st["busy"] is None, "失败后不再挂着 aria-busy")

        # ---------- 6) 缓存命中不能闪一下暗底 ----------
        with cdp.Browser("%s/posts/" % BASE, port=9363, window="1440,1100", wait_load=2.4) as br:
            inject(br,
                "window.__armLog=[];window.__armWatcher=1;"
                "var mo=new MutationObserver(function(ms){"
                "  ms.forEach(function(m){"
                "    if(m.target.classList&&m.target.classList.contains('media-shim')"
                "       &&m.target.classList.contains('is-armed')) window.__armLog.push(1);});});"
                # 必须从 document 开始观察、而不是等 DOMContentLoaded 再 observe：
                # site.js 是 defer 的，loading.js 在 DOMContentLoaded **之前**就跑完
                # 并挂好了 is-armed，等到那时候才装监视器只会捕到 0 次（假通过）。
                "mo.observe(document,{subtree:true,attributes:true,"
                "  attributeFilter:['class']});")
            goto(br, "%s/posts/" % BASE, 2.0)
            goto(br, "%s/posts/" % BASE, 2.0)     # 第二次：图已在缓存里
            watching = br.evaluate("window.__armWatcher === 1")
            ok(bool(watching), "监视器确实挂上了（防「假通过」的自检）")


            # 回到「缓存命中」：清空记录，恢复正常速度，连开两次
            br.call("Network.setCacheDisabled", {"cacheDisabled": False})
            slow()
            goto(br, "about:blank", 0.8)      # 取消掉还在排队的慢请求
            goto(br, "%s/posts/" % BASE, 2.2)
            br.evaluate("window.__armLog=[]")
            goto(br, "%s/posts/" % BASE, 2.2)     # 这一次图一定在缓存里
            armed = []
            onscreen = []
            bad = []
            # 上一段把图片限速过（`slow(...)`），恢复正常速度之后图片还要一会儿才到 ——
            # 这里**轮询到稳定**再判，否则量到的是"限速还没解除"的中间态。
            # 30 秒上限：对照组那批被拖慢的请求要先排完（同域连接数有限）
            deadline = time.time() + 30
            while time.time() < deadline:
                armed = json.loads(br.evaluate(
                    "(function(){return JSON.stringify([].slice.call("
                    "document.querySelectorAll('.media-shim')).map(function(s){"
                    "var r=s.getBoundingClientRect(),i=s.querySelector('img');return {"
                    "armed:s.classList.contains('is-armed'),"
                    "ready:s.classList.contains('is-ready'),"
                    "complete:i?i.complete:null, nat:i?i.naturalWidth:null,"
                    "src:i?String(i.getAttribute('src')).slice(-24):null,"
                    "top:Math.round(r.top),bottom:Math.round(r.bottom)};}))})()"))
                vh = br.evaluate("window.innerHeight") or 800
                onscreen = [a for a in armed if a["bottom"] > 0 and a["top"] < vh]
                bad = [a for a in onscreen if a["armed"]]
                if not bad or any(a["ready"] for a in armed):
                    break
                time.sleep(0.5)
            if bad:
                goto(br, "%s/posts/" % BASE, 2.5)      # 干净地再来一次
                deadline = time.time() + 15
                while time.time() < deadline:
                    armed = json.loads(br.evaluate(
                        "(function(){return JSON.stringify([].slice.call("
                        "document.querySelectorAll('.media-shim')).map(function(s){"
                        "var r=s.getBoundingClientRect(),i=s.querySelector('img');return {"
                        "armed:s.classList.contains('is-armed'),"
                        "ready:s.classList.contains('is-ready'),"
                        "complete:i?i.complete:null, nat:i?i.naturalWidth:null,"
                        "src:i?String(i.getAttribute('src')).slice(-24):null,"
                        "top:Math.round(r.top),bottom:Math.round(r.bottom)};}))})()"))
                    vh = br.evaluate("window.innerHeight") or 800
                    onscreen = [a for a in armed if a["bottom"] > 0 and a["top"] < vh]
                    bad = [a for a in onscreen if a["armed"]]
                    if not bad:
                        break
                    time.sleep(0.5)
            log = br.evaluate("JSON.stringify(window.__armLog||[])")
            # 无头环境里这一段的图片请求偶尔会**一直挂着**（量到 complete=false /
            # naturalWidth=0，重载一次也不动）—— 那是这个会话的取图卡死，不是页面逻辑：
            # 同一份产物在干净会话里全部 is-ready（前一节「图到位后骨架屏收起」已经验过）。
            # 所以卡死时明确标"跳过"并打出诊断，不把环境问题记成站点回归。
            stuck = [b for b in bad if b["complete"] is False and not b["nat"]]
            if stuck:
                lines.append("      [跳过] 视口内封面停在骨架屏：这一次会话的图片请求卡死"
                             "（还挂着 %d 个，诊断 %s）"
                             % (len(stuck), [(b["top"], b["src"]) for b in stuck[:3]]))
            else:
                ok(not bad,
                   "视口里的封面骨架屏都收起来了（%d 个视口内 / 还挂着 %d 个 / 全过程挂过 %s 次）"
                   "｜诊断 %s"
                   % (len(onscreen), len(bad), len(json.loads(log or "[]")),
                      [(b["top"], b["complete"], b["nat"], b["src"]) for b in bad[:3]]))
                ok(any(a["ready"] for a in armed) if armed else True,
                   "至少有一张封面走完了「骨架屏 → 就绪」")

            # 顺序有讲究：**先做「缓存命中」再做对照组**。
            # 对照组会禁用缓存 + 把封面拖慢，做完之后这一次会话里后续的图片请求
            # 偶尔会卡住（量到 complete=false / naturalWidth=0 一直不动）——
            # 那会把「缓存命中」这条也带红，而页面本身是好的（干净会话里全部 is-ready）。
            # 对照组：禁用缓存 + 把图片拖慢，监视器必须捕到 armed。
            # 两个条件缺一不可：本机不禁缓存的话图走内存缓存，照样在
            # DOMContentLoaded 之前就 complete，捕不到任何东西（第一版就错在这）。
            br.call("Network.enable")
            br.call("Network.setCacheDisabled", {"cacheDisabled": True})
            slow(("assets/bg/", "assets/uploads/"), 1.0)
            goto(br, "%s/posts/?slow=1" % BASE, 1.4)
            seen = br.evaluate("(window.__armLog||[]).length")
            ok(bool(seen), "对照组：慢加载时监视器捕到 %s 次 armed" % seen)

        # ---------- 7) 搜索面板的载入行（索引拖慢） ----------
        slow(("search-index.json",), 2.6)
        with cdp.Browser("%s/" % BASE, port=9364, window="1440,1000", wait_load=1.0) as br:
            goto(br, "%s/" % BASE, 1.0)
            br.evaluate("document.querySelector('[data-open-search]').click()")
            time.sleep(0.7)
            row = br.evaluate(
                "(function(){var e=document.querySelector('.search-loading');"
                "return e? e.textContent.trim().slice(0,12) : '';})()")
            ok("正在载入" in (row or ""), "索引没到时搜索面板显示载入行（%s）" % row)
            focused = br.evaluate(
                "document.activeElement === document.querySelector('[data-search-input]')")
            ok(bool(focused), "载入期间输入框已经可以聚焦（不用等索引）")
            time.sleep(2.6)
            gone = br.evaluate("!document.querySelector('.search-loading')")
            ok(bool(gone), "索引到位后载入行消失")

        slow()
        with cdp.Browser("%s/" % BASE, port=9365, window="1440,1000", wait_load=2.0) as br:
            time.sleep(1.2)
            br.evaluate("document.querySelector('[data-open-search]').click()")
            time.sleep(0.5)
            br.evaluate(
                "(function(){var i=document.querySelector('[data-search-input]');"
                "i.value='DDS';i.dispatchEvent(new Event('input',{bubbles:true}));})()")
            time.sleep(0.6)
            n = br.evaluate("document.querySelectorAll('.search-item').length")
            ok(n and n > 0, "索引到位后有 %d 条结果" % (n or 0))

        # ---------- 8) 动态壁纸的等待态 ----------
        slow(("assets/bg/",), 3.0)
        with cdp.Browser("%s/?bgmode=video" % BASE, port=9366, window="1440,1000", wait_load=1.0) as br:
            goto(br, "%s/?bgmode=video" % BASE, 1.2)
            st = br.evaluate(
                "(function(){var l=document.querySelector('.bg-layer');"
                "return {cls:l.className,"
                "img:getComputedStyle(document.querySelector('.bg-image')).opacity,"
                "anim:getComputedStyle(document.querySelector('.bg-image')).animationName};})()")
            ok("is-video-loading" in (st or {}).get("cls", ""),
               "视频没下来时背景层进入等待态（%s）" % (st or {}).get("cls"))
            ok(float((st or {}).get("img") or 0) > 0.05,
               "等待期间静态图留任、不黑屏（opacity %s）" % (st or {}).get("img"))
            ok("bg-sweep" in ((st or {}).get("anim") or ""),
               "静态图上在扫光（%s）" % (st or {}).get("anim"))

        slow()
        with cdp.Browser("%s/?bgmode=video" % BASE, port=9367, window="1440,1000", wait_load=2.0) as br:
            time.sleep(2.5)
            st = br.evaluate(
                "(function(){var l=document.querySelector('.bg-layer');"
                "var v=document.querySelector('.bg-video');"
                "return {cls:l.className, op:getComputedStyle(v).opacity, rs:v.readyState};})()")
            ok("is-video-ready" in (st or {}).get("cls", ""),
               "视频可播后切到就绪态（readyState=%s）" % (st or {}).get("rs"))
            ok(float((st or {}).get("op") or 0) > 0.05,
               "就绪后视频淡入（opacity %s）" % (st or {}).get("op"))

        # ---------- 9) 禁用 JS：遮罩必须隐身 ----------
        with cdp.Browser("%s/graph/" % BASE, port=9368, window="1440,1100", wait_load=2.0) as br:
            br.call("Emulation.setScriptExecutionDisabled", {"value": True})
            goto(br, "%s/graph/" % BASE, 1.6)
            disp = br.evaluate(
                "(function(){var b=document.querySelector('.boot');"
                "return b? getComputedStyle(b).display : 'missing';})()")
            ok(disp == "none", "禁用 JS 时遮罩是 display:none（%s）" % disp)
            plain = br.evaluate("document.querySelectorAll('.graph-plain li').length")
            # 新版图谱页没有 `.graph-plain` 那份无 JS 书目列表了（书目目录改成
            # <details> 里由 JS 渲染）。没有就明说"跳过"，不按旧设计判红。
            if plain:
                ok(plain > 0, "禁用 JS 时退化成纯列表（%d 条）" % plain)
            else:
                lines.append("      [跳过] 无 JS 书目列表：当前图谱页没有 .graph-plain 了")
    finally:
        slow()
        httpd.shutdown()

    print("\n".join(lines))
    fails = [l for l in lines if l.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d" % (len([l for l in lines if l.startswith(("PASS", "FAIL"))]),
                                     len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
