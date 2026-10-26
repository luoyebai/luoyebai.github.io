#!/usr/bin/env python3
"""并排图探针：一行 n 张图（以及 `::: gallery n`）到底有没有对齐。

并排图的坏法都很安静：图片按 `object-fit: cover` 一裁，示意图两边就少一块，
可它看起来「还是张图」；列宽不等、图注各回各家，页面照样能打开，
只是那种「怎么有点歪」的感觉没人说得清。所以这里全部按**量出来的几何**断言：

- 列宽相等、格子顶边对齐、图注底边对齐（图注贴底靠的是 `margin-top: auto`）；
- 渲染宽高比 == 原图宽高比（差一点点就说明被拉伸或裁切了）；
- 窄屏 3 列以上降到 2 列，并且两种宽度下都不长横向滚动条。

    python tools/probe-media.py
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
SHOTS = os.path.join(ROOT, "_shots")
PORT = 4195
BASE = "http://127.0.0.1:%d" % PORT
# 这一篇里两种写法都有：四张机器人照片并成一行（带图注）、
# 一个 `::: gallery 2` 的图组（四张状态机图）、以及若干张单图
PAGE = "/posts/small-humanoid-consensus/"


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


ROWS = r"""
(function(){
  var prose = document.querySelector('.prose');
  if (!prose) return JSON.stringify({none: '没有正文'});
  var pr = prose.getBoundingClientRect();
  var out = [];
  [].slice.call(prose.querySelectorAll('.media-row')).forEach(function(row){
    var r = row.getBoundingClientRect();
    var cells = [].slice.call(row.children).map(function(cell){
      var img = cell.querySelector('img');
      var cap = cell.querySelector('figcaption');
      var ir = img ? img.getBoundingClientRect() : null;
      var cr = cap ? cap.getBoundingClientRect() : null;
      var fr = cell.getBoundingClientRect();
      return {
        w: ir ? Math.round(ir.width * 10) / 10 : 0,
        h: ir ? Math.round(ir.height * 10) / 10 : 0,
        top: ir ? Math.round(ir.top) : null,
        bottom: ir ? Math.round(ir.bottom) : null,
        cy: ir ? Math.round(ir.top + ir.height / 2) : null,
        left: ir ? Math.round(ir.left) : null,
        right: ir ? Math.round(ir.right) : null,
        nw: img ? img.naturalWidth : 0,
        nh: img ? img.naturalHeight : 0,
        zoomable: img ? img.classList.contains('is-zoomable') : false,
        lazy: img ? img.getAttribute('loading') : null,
        caption: cap ? (cap.textContent || '').trim() : null,
        capBottom: cr ? Math.round(cr.bottom) : null,
        capTop: cr ? Math.round(cr.top) : null,
        cellTop: Math.round(fr.top),
        cellBottom: Math.round(fr.bottom)
      };
    });
    out.push({
      cols: row.getAttribute('data-cols'),
      varCols: (row.getAttribute('style') || '').replace(/\s/g, ''),
      width: Math.round(r.width),
      gridCols: getComputedStyle(row).gridTemplateColumns.split(' ').length,
      inParagraph: !!row.closest('p'),
      groupCaption: (function(){
        var g = row.closest('.media-group');
        var c = g ? g.querySelector(':scope > figcaption') : null;
        return c ? (c.textContent || '').trim() : null; })(),
      cells: cells
    });
  });
  return JSON.stringify({
    rows: out,
    prose: {left: Math.round(pr.left), right: Math.round(pr.right), width: Math.round(pr.width)},
    plainImgs: prose.querySelectorAll('p > img').length,
    allImgs: prose.querySelectorAll('img').length,
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth
  });})()
"""

# 页面开了 `html { scroll-behavior: smooth }`，脚本滚动会被它接管、量到的位置还在半路，
# 所以先把 scrollBehavior 设回 auto 再用 window.scrollTo 定位。
SCROLL_TO = """
(function(){document.documentElement.style.scrollBehavior='auto';
 var t=document.querySelector('%s');
 window.scrollTo(0, t.getBoundingClientRect().top + window.pageYOffset - 130);})()
"""

# 图注对齐必须用**带不同长度图注**的格子才测得出来，而正文里的示例恰好一条长一条短。# 直接往真实页面里插一份再量：CSS 级联是真的，量完就删掉。
INJECT = r"""
(function(){
  var prose = document.querySelector('.prose');
  var host = document.createElement('div');
  host.id = 'media-probe';
  host.innerHTML =
    '<div class="media-row" data-cols="3" style="--cols:3">' +
    '<figure class="media-cell"><div class="media-shot">' +
      '<img src="/assets/bg/neon.jpg" alt="一"></div>' +
      '<figcaption>这条图注很短</figcaption></figure>' +
    '<figure class="media-cell"><div class="media-shot">' +
      '<img src="/assets/bg/neon.jpg" alt="二"></div>' +
      '<figcaption>这条图注故意写得长一些，长到要折成两行才放得下，' +
      '用来验证图注是不是都贴在格子底部</figcaption></figure>' +
    '<figure class="media-cell"><div class="media-shot">' +
      '<img src="/assets/bg/neon.jpg" alt="三"></div>' +
      '<figcaption>中等长度的一条图注</figcaption></figure>' +
    '</div>';
  prose.appendChild(host);
  var row = host.querySelector('.media-row');
  var caps = [].slice.call(row.querySelectorAll('figcaption')).map(function(c){
    var r = c.getBoundingClientRect();
    return Math.round(r.bottom); });
  var cells = [].slice.call(row.children).map(function(c){
    var r = c.getBoundingClientRect();
    return {top: Math.round(r.top), bottom: Math.round(r.bottom)}; });
  var imgs = [].slice.call(row.querySelectorAll('img')).map(function(i){
    return Math.round(i.getBoundingClientRect().width * 10) / 10; });
  host.remove();
  return JSON.stringify({caps: caps, cells: cells, imgs: imgs});})()
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
        with cdp.Browser(BASE + PAGE, port=9356, window="1440,1100", wait_load=2.6) as br:
            br.call("Page.enable")
            time.sleep(1.0)

            data = json.loads(br.evaluate(ROWS))
            rows = data["rows"]
            ok(len(rows) == 2, "页面里有 %d 处并排图" % len(rows))

            wide = [r for r in rows if r["cols"] == "4"]
            group = [r for r in rows if r["cols"] == "2" and r["groupCaption"]]

            # ---------- 一行 4 张（带图注） ----------
            if ok(bool(wide), "有一行是 4 张并排"):
                r = wide[0]
                ok(r["gridCols"] == 4, "CSS 真的排成了 4 列（grid-template-columns 有 %d 列）"
                   % r["gridCols"])
                ok(r["varCols"].startswith("--cols:4"), "列数写进了 --cols（%s）" % r["varCols"])
                ok(not r["inParagraph"], "并排图没有套在 <p> 里")
                widths = [c["w"] for c in r["cells"]]
                ok(max(widths) - min(widths) <= 1.0,
                   "四格等宽（%s）" % ("/".join("%.1f" % w for w in widths)))
                ct = [c["cellTop"] for c in r["cells"]]
                ok(max(ct) - min(ct) <= 1,
                   "四格顶边对齐（%s）" % "/".join(str(t) for t in ct))
                # 图片在格子里竖直居中：这是「一行里横图竖图混着放」时最像对齐的一种排法
                # （顶边对齐会让竖图把整行撑高，底边对齐又得先裁图）。图注贴底另算。
                cy = [c["cy"] for c in r["cells"]]
                ok(max(cy) - min(cy) <= 1,
                   "四张图竖直居中对齐（中心 %s）" % "/".join(str(v) for v in cy))
                caps = [c["caption"] for c in r["cells"]]
                ok(all(caps), "四张图都有图注（%s）" % "、".join(caps))
                ok(all(".png" not in (c or "") for c in caps),
                   "图注不是文件名（alt 是「图片.png」时不出图注）")
                cb = [c["capBottom"] for c in r["cells"]]
                ok(max(cb) - min(cb) <= 1,
                   "图注底边对齐（%s）—— 横图竖图混排时也在一条线上"
                   % "/".join(str(b) for b in cb))
                # 拉伸/裁切都会让渲染宽高比偏离原图
                worst = 0.0
                for c in r["cells"]:
                    if c["nw"] and c["nh"] and c["h"]:
                        worst = max(worst, abs(c["w"] / c["h"] - c["nw"] / c["nh"]))
                ok(worst <= 0.03,
                   "图片保持原宽高比、没有被拉伸裁切（最大偏差 %.4f）" % worst)
                ok(all(c["left"] >= data["prose"]["left"] - 1
                       and c["right"] <= data["prose"]["right"] + 1 for c in r["cells"]),
                   "四张图都在正文栏内（栏宽 %dpx）" % data["prose"]["width"])
                ok(all(c["zoomable"] for c in r["cells"]),
                   "并排图里的图仍然可以点开看原图")
                ok(all(c["lazy"] == "lazy" for c in r["cells"]), "并排图也是懒加载")

            # ---------- ::: gallery 2（无图注 → 竖直居中对齐） ----------
            if ok(bool(group), "有一个 `::: gallery 2` 图组"):
                r = group[0]
                ok(len(r["cells"]) == 4, "图组收了 4 张图")
                ok(r["gridCols"] == 2, "图组排成 2 列（%d）" % r["gridCols"])
                ok("状态机" in (r["groupCaption"] or ""),
                   "图组有整体说明（%s）" % r["groupCaption"])
                tops = sorted({c["top"] for c in r["cells"]})
                ok(len(tops) == 2, "4 张图折成 2 行（top 取值 %s）" % tops)
                first = [c for c in r["cells"] if c["top"] == tops[0]]
                ok(len(first) == 2, "第一行正好 2 张")
                # 没有图注的格子，图片在竖直方向居中：同一行的两张图中心线要重合
                cy = [c["cy"] for c in first]
                ok(max(cy) - min(cy) <= 1,
                   "同一行的图竖直居中对齐（中心 %s）" % "/".join(str(v) for v in cy))
                widths = [c["w"] for c in r["cells"]]
                ok(max(widths) - min(widths) <= 1.0,
                   "图组四格等宽（%s）" % "/".join("%.1f" % w for w in widths))
                # 顺手留一张图组的截图：等到哪天图注跑偏了，这里能直接看出来
                br.evaluate(SCROLL_TO % ".media-group")
                time.sleep(0.6)
                png = br.call("Page.captureScreenshot", {"format": "png"})
                with open(os.path.join(SHOTS, "media-group.png"), "wb") as fh:
                    fh.write(base64.b64decode(png["data"]))
                lines.append("      截图 -> %s" % os.path.join(SHOTS, "media-group.png"))

            # ---------- 单张图仍然是普通段落 ----------
            ok(data["plainImgs"] >= 3,
               "单张图仍然渲染成普通段落里的图（%d 张）" % data["plainImgs"])
            ok(data["allImgs"] >= data["plainImgs"] + 8,
               "并排图没有把单图吞掉（正文共 %d 张图）" % data["allImgs"])

            # ---------- 图注贴底（插一份长短不一的进来量） ----------
            inj = json.loads(br.evaluate(INJECT))
            ok(inj["caps"] and max(inj["caps"]) - min(inj["caps"]) <= 1,
               "图注长短不一时都贴在格子底部（底边 %s）" % "/".join(str(v) for v in inj["caps"]))
            ok(inj["cells"] and max(c["bottom"] for c in inj["cells"])
               - min(c["bottom"] for c in inj["cells"]) <= 1,
               "同一行格子等高（底边 %s）" % "/".join(str(c["bottom"]) for c in inj["cells"]))
            ok(inj["imgs"] and max(inj["imgs"]) - min(inj["imgs"]) <= 1.0,
               "插进来的那行也是等宽（%s）" % "/".join("%.1f" % w for w in inj["imgs"]))

            # ---------- 点开看原图 ----------
            br.evaluate(SCROLL_TO % ".media-row")
            time.sleep(0.5)
            br.evaluate("document.querySelector('.media-row img').click()")
            time.sleep(0.5)
            lb = json.loads(br.evaluate(
                "(function(){var b=document.querySelector('.lightbox');"
                "if(!b)return JSON.stringify({none:true});"
                "var on=[].filter.call(b.querySelectorAll('.lightbox-stage img'),"
                "function(i){return i.classList.contains('is-in');})[0];"
                "return JSON.stringify({open:b.classList.contains('is-open'),"
                "src:on?on.getAttribute('src'):''});})()"))
            ok(lb.get("open") and "fig-01" in (lb.get("src") or ""),
               "点并排图能看原图（%s）" % (lb.get("src") or "")[-28:])
            br.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape",
                                               "code": "Escape", "windowsVirtualKeyCode": 27})
            br.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape",
                                               "code": "Escape", "windowsVirtualKeyCode": 27})
            time.sleep(0.4)

            ok(data["docW"] <= data["winW"] + 2,
               "宽屏没有横向滚动条（%d <= %d）" % (data["docW"], data["winW"]))
            png = br.call("Page.captureScreenshot", {"format": "png"})
            with open(os.path.join(SHOTS, "media-row.png"), "wb") as fh:
                fh.write(base64.b64decode(png["data"]))
            lines.append("      截图 -> %s" % os.path.join(SHOTS, "media-row.png"))

            # ---------- 窄屏：3 列以上降到 2 列 ----------
            br.call("Emulation.setDeviceMetricsOverride",
                    {"width": 420, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            time.sleep(1.0)
            data2 = json.loads(br.evaluate(ROWS))
            rows2 = data2["rows"]
            wide2 = [r for r in rows2 if r["cols"] == "4"]
            ok(bool(wide2) and wide2[0]["gridCols"] == 2,
               "420px 宽时 4 列那行降到 2 列（%s）"
               % (wide2[0]["gridCols"] if wide2 else "没找到"))
            if wide2:
                w2 = [c["w"] for c in wide2[0]["cells"]]
                ok(max(w2) - min(w2) <= 1.0,
                   "窄屏下同一行仍然等宽（%s）" % "/".join("%.1f" % v for v in w2))
                ok(all(c["right"] <= data2["prose"]["right"] + 1 for c in wide2[0]["cells"]),
                   "窄屏下没有顶出正文栏")
            group2 = [r for r in rows2 if r["cols"] == "2" and r["groupCaption"]]
            ok(bool(group2) and group2[0]["gridCols"] == 2,
               "2 列的图组在窄屏保持 2 列（不再往下掉）")
            ok(data2["docW"] <= data2["winW"] + 2,
               "窄屏也没有横向滚动条（%d <= %d）" % (data2["docW"], data2["winW"]))
            png = br.call("Page.captureScreenshot", {"format": "png"})
            with open(os.path.join(SHOTS, "media-row-narrow.png"), "wb") as fh:
                fh.write(base64.b64decode(png["data"]))
            lines.append("      截图 -> %s" % os.path.join(SHOTS, "media-row-narrow.png"))
    finally:
        httpd.shutdown()

    print("\n".join(lines))
    fails = [x for x in lines if x.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d"
          % (len([x for x in lines if x.startswith(("PASS", "FAIL"))]), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
