#!/usr/bin/env python3
"""「文档」区（幻灯片阅读器）探针。

这一块是自己手写的翻页器 + 一套从别的仓库搬过来的 Markdown，
最容易出问题的地方都不是「能不能打开」，而是：
  · 逐页模式到底有没有只显示一页（CSS 选择器写错就会默默全显示）
  · 键盘翻页有没有真的换页、页码/进度/章节名有没有跟着走
  · 通读模式是不是真的把 137 页都放出来（打印和 Ctrl+F 靠它）
  · 源文档那套裸标签 <red>/<blue> 有没有被解析成颜色（不是当纯文本吐出来）
  · 幻灯片里引用的图片、代码有没有真的拷进产物（换页时才懒加载，静态检查容易漏）

    python tools/probe-docs.py
"""
import base64
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
PORT = 4197
SHOTS = os.path.join(ROOT, "_shots")
DOC = "/docs/pointers/"
INDEX = "/docs/"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True


class QuietServer(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


STATE = "JSON.stringify(window.__deck.state())"
# 打开页面立刻挂错误收集：翻页逻辑全是事件驱动的，语法错误只在按键那一下才炸
WATCH = ("window.__errs=[];"
         "window.addEventListener('error',function(e){window.__errs.push(String(e.message));});"
         "window.addEventListener('unhandledrejection',"
         "function(e){window.__errs.push('rejection:'+e.reason);});true")
ERRS = ("(function(){var e=window.__errs||[];"
        "return e.length? e.slice(0,3).join(' | ') : '';})()")


def navigate(br, url, wait=1.2):
    br.call("Page.navigate", {"url": url})
    time.sleep(wait)


def main():
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    if not os.path.isdir(os.path.join(PUBLIC, "docs")):
        print("!! 产物里没有 docs/，先构建")
        return 1
    os.makedirs(SHOTS, exist_ok=True)
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    lines = []

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        return cond

    def state(br):
        return json.loads(br.evaluate(STATE))

    try:
        with cdp.Browser("http://127.0.0.1:%d%s" % (PORT, DOC), port=9352,
                         window="1440,1100", wait_load=2.2) as br:
            time.sleep(1.2)
            br.evaluate(WATCH)
            has = br.evaluate("!!window.__deck")
            ok(has, "幻灯片阅读器已挂载")
            if not has:
                print("\n".join(lines + ["FAIL  没有 window.__deck，后面的断言没法跑"]))
                return 1

            s = state(br)
            # 每篇 8~12 页（重排之后的分页就是这个量级）——门槛只用来防"一页都没读到"
            ok(8 <= s["total"] <= 40, "读到 %d 页幻灯片" % s["total"])
            ok(s["mode"] == "paged", "默认是逐页模式（%s）" % s["mode"])
            ok(s["visible"] == 1, "逐页模式下只显示 1 页（实际 %d）" % s["visible"])
            ok(s["current"] == 0, "从第 1 页开始")
            ok(s["section"], "识别出所属章节（%s）" % s["section"])

            # ---- 键盘翻页 ----
            # 页面里插了 `--` 展示步骤（`stepCount`），一次 → 可能只走一步而不是翻页，
            # 所以这里量的是"按下去有反应"，再按到真的翻页为止。
            def press(key, vk):
                br.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": key,
                                                   "code": key, "windowsVirtualKeyCode": vk})
                br.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": key,
                                                   "code": key, "windowsVirtualKeyCode": vk})
                time.sleep(0.3)
                return state(br)

            before = state(br)
            s2 = press("ArrowRight", 39)
            ok((s2["current"], s2["step"]) != (before["current"], before["step"]),
               "按 → 有反应（页 %s→%s，步 %s→%s）"
               % (before["current"], s2["current"], before["step"], s2["step"]))
            for _ in range(12):
                if state(br)["current"] >= 1:
                    break
                press("ArrowRight", 39)
            s2 = state(br)
            ok(s2["current"] == 1, "一路按 → 能翻到第 2 页（%d）" % s2["current"])
            ok(s2["visible"] == 1, "翻页后仍然只显示 1 页")
            no = br.evaluate("document.querySelector('[data-deck-no]').textContent")
            ok(no.strip().startswith("2"), "页码跟着更新（%s）" % no)
            prog = float((s2["progress"] or "0%").rstrip("%"))
            ok(prog > 0, "进度条有宽度（%.2f%%）" % prog)

            br.evaluate("window.__deck.go(window.__deck.state().total - 1)")
            time.sleep(0.25)
            s3 = state(br)
            ok(s3["current"] == s3["total"] - 1, "能跳到最后一页")
            for _ in range(12):                  # 最后一页也可能有展示步骤，先走完
                if br.evaluate("document.querySelector('.deck-nav [data-deck-next]').disabled"):
                    break
                press("ArrowRight", 39)
            disabled = br.evaluate("document.querySelector('.deck-nav [data-deck-next]').disabled")
            ok(bool(disabled), "最后一页时「下一页」按钮置灰")

            press("ArrowLeft", 37)
            ok(state(br) is not None, "按 ← 不报错")

            br.evaluate("window.__deck.go(0)")
            time.sleep(0.15)
            br.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "End",
                                               "code": "End", "windowsVirtualKeyCode": 35})
            br.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "End",
                                               "code": "End", "windowsVirtualKeyCode": 35})
            time.sleep(0.25)
            ok(state(br)["current"] == state(br)["total"] - 1, "End 跳到最后一页")
            br.evaluate("window.__deck.go(0)")
            time.sleep(0.15)

            # ---- 两侧翻页热区不能盖住正文里的链接 ----
            # 热区是绝对定位盖在幻灯片上的，宽度给大了就会把左边的链接整片挡住，
            # 而且**看起来一切正常**（链接在那儿、样式也对，就是点不动）。
            # 逐页翻一遍，对每一页里的链接取中心点做命中测试。
            covered = br.evaluate(
                "(function(){var bad=[];"
                "var slides=[].slice.call(document.querySelectorAll('.slide'));"
                "for(var i=0;i<slides.length;i++){"
                "  window.__deck.go(i);"
                "  var links=slides[i].querySelectorAll('a[href]');"
                "  for(var j=0;j<links.length;j++){"
                "    var r=links[j].getBoundingClientRect();"
                "    if(r.width<2||r.height<2||r.bottom<0||r.top>window.innerHeight) continue;"
                "    var inset=Math.min(6, r.width*0.25);"
                "    var xs=[r.left+inset, r.left+r.width/2, r.right-inset];"
                "    for(var k=0;k<xs.length;k++){"
                "      var el=document.elementFromPoint(xs[k], r.top+r.height/2);"
                "      if(!el) continue;"
                "      var hit=(el===links[j])||links[j].contains(el)||el.contains(links[j]);"
                "      if(!hit){bad.push(i+':'+(links[j].textContent||'').slice(0,10)"
                "        +' @'+k+' -> '+(el.className||el.tagName));break;}"
                "    }"
                "  }"
                "}"
                "window.__deck.go(6);"
                "return bad.slice(0,4);})()")
            ok(not covered, "两侧翻页热区没有挡住正文链接（%d 处被挡 %s）"
               % (len(covered or []), covered or ""))

            # ---- 目录抽屉 ----
            br.evaluate("window.__deck.outline(true)")
            time.sleep(0.2)
            opened = br.evaluate("!document.getElementById('deck-outline').hidden")
            items = br.evaluate("document.querySelectorAll('[data-deck-goto]').length")
            ok(opened and items >= 5, "目录抽屉能打开，列出 %d 条" % items)
            br.evaluate("(function(){document.querySelectorAll('[data-deck-goto]')[6].click();})()")
            time.sleep(0.3)
            s4 = state(br)
            ok(s4["current"] == 6, "点目录跳转到第 7 页（%d）" % s4["current"])
            ok(not br.evaluate("!document.getElementById('deck-outline').hidden"),
               "跳转后目录自动收起")

            # ---- 通读模式 ----
            br.evaluate("window.__deck.mode('scroll')")
            time.sleep(0.3)
            s5 = state(br)
            ok(s5["mode"] == "scroll" and s5["visible"] == s5["total"],
               "通读模式放出全部 %d 页（可见 %d）" % (s5["total"], s5["visible"]))
            br.evaluate("window.__deck.mode('paged')")
            time.sleep(0.25)
            ok(state(br)["visible"] == 1, "切回逐页模式又只剩 1 页")

            # ---- 全屏 ----
            br.evaluate("window.__deck.full()")
            time.sleep(0.4)
            ok(state(br)["full"], "全屏演示可以进入")
            br.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape",
                                               "code": "Escape", "windowsVirtualKeyCode": 27})
            br.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape",
                                               "code": "Escape", "windowsVirtualKeyCode": 27})
            time.sleep(0.4)
            ok(not state(br)["full"], "Esc 退出全屏")

            # ---- 内容真的渲染出来了 ----
            # 单页字数不定（章节页只有标题），所以量**整篇**有没有正文，
            # 再看有没有至少一页是正文页。
            text_total = br.evaluate(
                "[].reduce.call(document.querySelectorAll('.slide'), function(n,s){"
                "return n + ((s.innerText||'').trim().length);}, 0)")
            ok((text_total or 0) > 800, "整篇幻灯片有正文（%s 字）" % text_total)
            br.evaluate("window.__deck.go(4)")
            time.sleep(0.45)
            body = br.evaluate(
                "(function(){var s=document.querySelector('.slide.is-current');"
                "return s? s.innerText.trim().length : -1;})()")
            ok(body is not None and body >= 0, "当前页读得到内容（%d 字）" % (body or 0))

            h2 = br.evaluate(
                "(function(){var h=document.querySelector('.slide.is-current h2');"
                "if(!h) return null;var c=getComputedStyle(h);"
                "return {bw:c.borderBottomWidth, size:c.fontSize};})()")
            ok(bool(h2) and h2["bw"] not in ("0px", ""),
               "幻灯片标题带下划线（border-bottom %s）" % (h2 or {}).get("bw"))

            # ---- 裸标签（<red>/<blue>）不许以纯文本漏出来 ----
            # 现在只有少数几篇还在用这套标记，所以这里守的是"漏没漏"，
            # 解析器本身由 selftest.py 那几条覆盖。
            leak = br.evaluate(
                "(function(){var t=(document.querySelector('.deck')||{}).innerText||'';"
                "return /<(red|blue|green|amber)>/.test(t);})()")
            ok(not leak, "裸标签没有以纯文本漏到页面上")

            # ---- 图片与代码都进了产物 ----
            # 图片是 loading="lazy" 的：通读模式下整篇一万多像素高，不滚到跟前
            # 浏览器根本不会去取。这里把 loading 改成 eager 强制全部下载 ——
            # 要验的是「URL 指得对不对」，不是「懒加载灵不灵」（前者才是会写错的）。
            br.evaluate("window.__deck.mode('scroll')")
            time.sleep(0.5)
            imgs = br.evaluate(
                "(function(){var a=[].slice.call(document.querySelectorAll('.slide img'));"
                "a.forEach(function(i){i.loading='eager';});"
                "return new Promise(function(res){var t0=Date.now();"
                "(function tick(){"
                "var bad=a.filter(function(i){return !i.complete||i.naturalWidth===0;});"
                "if(!bad.length||Date.now()-t0>8000){"
                "res({total:a.length,ok:a.length-bad.length,"
                "bad:bad.slice(0,3).map(function(i){return i.getAttribute('src');})});return;}"
                "setTimeout(tick,150);})();});})()")
            # 插图现在是**内联 SVG**（docfigs 现画的），不是图片文件；
            # 位图和 SVG 一起数，才代表"这一页有图"。
            figs = br.evaluate(
                "(function(){return {img:document.querySelectorAll('.slide img').length,"
                "svg:document.querySelectorAll('.slide svg').length};})()")
            ok(figs["img"] + figs["svg"] >= 1,
               "幻灯片里有插图（位图 %d / 内联 SVG %d）" % (figs["img"], figs["svg"]))
            if imgs["total"]:
                ok(imgs["ok"] == imgs["total"],
                   "全部图片加载成功（失败 %d 张 %s）" % (imgs["total"] - imgs["ok"], imgs["bad"]))

            # 代码文件入口：只有少数几篇带，换到带的那一篇再量
            navigate(br, "http://127.0.0.1:%d/docs/camera-handeye-calibration/" % PORT, 1.8)
            br.evaluate(WATCH)
            codes = br.evaluate(
                "(function(){var a=[].slice.call(document.querySelectorAll('.slide a[href*=\"assets/docs/\"]'));"
                "return {total:a.length, sample:a.length?a[0].getAttribute('href'):''};})()")
            ok(codes["total"] >= 1, "复制进来的代码文件有 %d 个入口（%s）"
               % (codes["total"], codes["sample"]))
            ok("assets/docs/" in (codes["sample"] or ""),
               "代码链接指向站内 assets/docs/（%s）" % codes["sample"])

            # ---- 截图 ----
            br.evaluate("window.__deck.go(1);window.__deck.mode('paged')")
            time.sleep(0.6)
            shot = br.call("Page.captureScreenshot", {"format": "png"})
            p = os.path.join(SHOTS, "doc-slide.png")
            with open(p, "wb") as fh:
                fh.write(base64.b64decode(shot["data"]))
            lines.append("      截图 -> %s" % p)

            errs = br.evaluate(ERRS)
            ok(errs == "", "整个翻页流程没有 JS 报错" + (("：" + errs) if errs else ""))

            # ---- 列表页 / 目录页 ----
            navigate(br, "http://127.0.0.1:%d%s" % (PORT, INDEX), 1.4)
            br.evaluate(WATCH)
            n = br.evaluate("document.querySelectorAll('.ds-item').length")
            ok(n >= 16, "文档首页列出 %d 篇" % n)
            cols = br.evaluate("document.querySelectorAll('.ds-collection').length")
            ok(cols == 4, "分成 %d 个系列" % cols)
            # `待更新` 只在文档 front-matter 里写了 `pending` 时才出现（现在一篇都没写），
            # 所以这里只断言"要么没有这一块，要么它渲染得出来"，不再要求固定条数。
            stats = br.evaluate("document.querySelectorAll('.docs-stats span').length")
            ok(stats >= 3, "文档首页的统计行渲染出来了（%d 段）" % stats)
            # Logo 是 loading="lazy" 的，页面长了之后不滚到跟前就不会加载。
            # 这里改成 eager 强制下载 —— 要验的是 URL 指得对不对，不是懒加载灵不灵。
            refs = br.evaluate(
                "(function(){var a=[].slice.call(document.querySelectorAll('.ds-ref img'));"
                "a.forEach(function(i){i.loading='eager';});"
                "return new Promise(function(res){var t0=Date.now();"
                "(function tick(){"
                "var bad=a.filter(function(i){return !i.complete||i.naturalWidth===0;});"
                "if(!bad.length||Date.now()-t0>5000){"
                "res({total:a.length,ok:a.length-bad.length,"
                "bad:bad.map(function(i){return i.getAttribute('src');}).slice(0,3)});return;}"
                "setTimeout(tick,150);})();});})()")
            ok(refs["total"] >= 8 and refs["ok"] == refs["total"],
               "相关站点 Logo 全部加载（%d/%d %s）"
               % (refs["ok"], refs["total"], refs["bad"]))
            # 样式的确加载了：ref 图标必须被 docs.css 限制成 18px，
            # 漏加载时它会按原图尺寸铺出来（这个 bug 真发生过）
            size = br.evaluate(
                "(function(){var i=document.querySelector('.ds-ref img');"
                "return i? Math.round(i.getBoundingClientRect().width) : -1;})()")
            ok(size == 18, "docs.css 已加载（ref 图标宽 %dpx）" % size)

            errs = br.evaluate(ERRS)
            ok(errs == "", "列表页没有 JS 报错" + (("：" + errs) if errs else ""))

            shot = br.call("Page.captureScreenshot", {"format": "png"})
            p = os.path.join(SHOTS, "docs-index.png")
            with open(p, "wb") as fh:
                fh.write(base64.b64decode(shot["data"]))
            lines.append("      截图 -> %s" % p)

            navigate(br, "http://127.0.0.1:%d/docs/windows-to-linux/" % PORT, 1.3)
            shot = br.call("Page.captureScreenshot", {"format": "png"})
            p = os.path.join(SHOTS, "docs-collection.png")
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
