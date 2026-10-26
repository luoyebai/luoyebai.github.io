#!/usr/bin/env python3
"""首屏与正文「融为一体」的回归探针。

这一整套效果有个共同点：**坏了页面也照常打开**。参考站那种「内容像长在场里」的
感觉，全靠一堆很轻的层叠在一起 ——

- 正文卡片背后那层「场」（同一组曲线、放大的相机）；它一旦不画，页面只是变安静；
- 导轨上的彗星、站台、引线、行刻度；少一条线，读者只会觉得「哪里空」；
- 描边跑完之后留下的 20% 余温；丢了就是「描边长出来又凭空消失」；
- 章节抬头的分层（caption → 标题 → 描述）；退回整块淡入也看不出来，只是节奏变木；
- 标签那一把的错峰扫入；整块淡入同样「能用」。

所以这里不靠「截图看看」，而是**量**：画布上真的有墨、墨铺在哪些区带、
`::before` 的透明度和笔宽到底是几档、抬头的三层是不是依次到位、标签的延迟是不是递增、
鼠标过去之后画布有没有变。首屏在屏幕里的时候还必须**一处都不画** ——
那是用户自己设计的开场，不能被这套东西污染。

    python tools/probe-fusion.py
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
PORT = 4187
BASE = "http://127.0.0.1:%d/" % PORT

# 滚到某个位置，然后把这套效果需要的东西一次量完：
# 画布墨量（总量 + 四个横向区带）、卡片描边的档位、抬头三层的不透明度、
# 标签的 --d 与不透明度、两块「只可能由画布画出来」的区域有没有墨。
SNAP = r"""
(function (target) {
  window.scrollTo(0, Math.round(target));
  return new Promise(function (resolve) {
    /* 滚动之后要等**两件事**：一是两帧（让 effects.js 把 --rv 写进 DOM），
       二是 IntersectionObserver 的回调 —— 它比 rAF 晚一拍，`flowVisible` 变了
       才轮到 orbit-field.js 重新起帧。只等两帧会读到「刚清空、还没画」的画布
       （墨迹 0），那是探针的时序问题，不是页面的问题。 */
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      setTimeout(function () {
      var c = document.getElementById('flow-field');
      var out = {y: Math.round(window.pageYOffset), vh: window.innerHeight, vw: window.innerWidth,
                 hasField: !!c, running: null, visible: null, lean: null,
                 size: null, exit: null, ink: 0, quarters: [0, 0, 0, 0], hash: 0,
                 cards: [], head: null, pills: null, regions: {}};
      if (window.__orbitField) {
        var info = window.__orbitField.info();
        out.running = info.running; out.visible = info.flow.visible;
        out.lean = info.flow.lean; out.size = info.flow.size; out.exit = info.exit;
      }
      if (!c) { resolve(JSON.stringify(out)); return; }
      var ctx = c.getContext('2d'), w = c.width, h = c.height, d = ctx.getImageData(0, 0, w, h).data;
      for (var y = 0; y < h; y++) {
        var q = Math.min(3, Math.floor(y / h * 4));
        for (var x = 0; x < w; x++) {
          if (d[(y * w + x) * 4 + 3] <= 6) continue;
          out.ink++; out.quarters[q]++; out.hash = (out.hash * 31 + y * w + x) | 0;
        }
      }
      /* 卡片描边：跑线时 2px / 落定 1px，不透明度 1 → .2 */
      [].slice.call(document.querySelectorAll('.home-flow .card, .home-flow .direction-card, .home-flow .lab-invitation')).slice(0, 8).forEach(function (el) {
        var s = getComputedStyle(el, '::before');
        out.cards.push({rv: Number(el.style.getPropertyValue('--rv')), op: parseFloat(s.opacity),
                        size: s.backgroundSize, cls: el.className.split(' ')[0]});
      });
      /* 章节抬头三层 */
      var head = document.querySelector('.home-flow .section-head.reveal');
      if (head) {
        function op(e) { return e ? parseFloat(getComputedStyle(e).opacity) : -1; }
        out.head = {rv: Number(head.style.getPropertyValue('--rv')),
                    cap: op(head.querySelector('.flow-caption')), h2: op(head.querySelector('h2')),
                    p: op(head.querySelector('p:not(.flow-caption)')), more: op(head.querySelector('.more'))};
      }
      /* 标签：--d 递增、入场时先到先亮 */
      var pills = [].slice.call(document.querySelectorAll('.home-flow .tag-cloud .tag-pill'));
      if (pills.length) {
        var cloud = document.querySelector('.home-flow .tag-cloud');
        out.pills = {n: pills.length, rv: Number(cloud.style.getPropertyValue('--rv')),
                     d0: parseFloat(pills[0].style.getPropertyValue('--d')) || 0,
                     dN: parseFloat(pills[pills.length - 1].style.getPropertyValue('--d')) || 0,
                     op0: parseFloat(getComputedStyle(pills[0]).opacity),
                     opN: parseFloat(getComputedStyle(pills[pills.length - 1]).opacity)};
      }
      /* 两块「只能由画布画出来」的区域：站台引线、入口站到导轨之间那段缺口 */
      function inkIn(x, y, ww, hh) {
        x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
        ww = Math.min(w - x, Math.round(ww)); hh = Math.min(h - y, Math.round(hh));
        if (ww <= 0 || hh <= 0) return -1;
        var box = ctx.getImageData(x, y, ww, hh).data, n = 0;
        for (var i = 3; i < box.length; i += 4) if (box[i] > 6) n++;
        return n;
      }
      var dpr = w / window.innerWidth;
      var chapter = document.querySelector('.home-flow [data-scroll-chapter]');
      var cap = chapter && chapter.querySelector('.flow-caption');
      var bridge = document.querySelector('.page-home .flow-bridge a');
      if (chapter && cap) {
        var cr = chapter.getBoundingClientRect(), pr = cap.getBoundingClientRect();
        var railX = cr.left + 24, capY = pr.top + pr.height / 2;
        out.regions.leader = inkIn((railX + 3) * dpr, (capY - 3) * dpr, 24 * dpr, 7 * dpr);
        if (bridge) {
          var br = bridge.getBoundingClientRect();
          var gapTop = br.top + br.height / 2 + 9, gapBottom = cr.top + 33;
          if (gapBottom > gapTop) {
            out.regions.gap = inkIn((railX - 2) * dpr, gapTop * dpr, 5 * dpr, (gapBottom - gapTop) * dpr);
          }
        }
      }
      resolve(JSON.stringify(out));
      }, 150);
    }); });
  });
})('%s')
"""

HASH_ONLY = r"""
(function () {
  var c = document.getElementById('flow-field'), x = c.getContext('2d');
  var d = x.getImageData(0, 0, c.width, c.height).data, h = 0;
  for (var i = 0; i < d.length; i += 64) { if (d[i + 3] > 6) h = (h * 33 + i + d[i + 3]) | 0; }
  var info = window.__orbitField ? window.__orbitField.info() : null;
  return JSON.stringify({hash: h, lean: info ? info.flow.lean : null, y: Math.round(window.pageYOffset)});
})()
"""


# 让某个元素正好处在给定的 --rv 上：把 effects.js 的公式反解成 scrollY。
# 首页正文：rv = (y + .98vh - top) / (.52vh) - lag（lag 在桌面最多 .17）。
# 探针里不去扫一堆滚动位置猜，直接算 —— 少一堆魔法数字，也不会因为
# 窗口高度变了（无头窗口的 innerHeight 不等于 --window-size 里那个数）而错位。
YFOR = r"""
(function (sel, want) {
  var el = document.querySelector(sel);
  if (!el) return '-1';
  var top = 0, node = el;
  while (node) { top += node.offsetTop; node = node.offsetParent; }
  var vh = window.innerHeight;
  var target = top + want * .52 * vh - .98 * vh;
  var max = document.documentElement.scrollHeight - vh;
  return String(Math.max(0, Math.min(max, Math.round(target))));
})('%s', %s)
"""

# 把某个元素摆在视口高度的某个比例处（交界那个「入口站」不是 .reveal，
# 没有 --rv 可反解，只能按位置摆）
YCENTER = r"""
(function (sel, frac) {
  var el = document.querySelector(sel);
  if (!el) return '-1';
  var top = 0, node = el;
  while (node) { top += node.offsetTop; node = node.offsetParent; }
  var vh = window.innerHeight;
  var max = document.documentElement.scrollHeight - vh;
  return String(Math.max(0, Math.min(max, Math.round(top + el.offsetHeight / 2 - vh * frac))));
})('%s', %s)
"""


def thickness(size):
    """从 `backgroundSize` 里取出第一条边的笔宽（px）。"""
    first = (size or "").split(",")[0].strip()
    for token in first.split():
        if token.endswith("px"):
            return float(token[:-2])
    return -1.0


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


def main() -> int:
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    lines = []

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        return cond

    def snap(br, y):
        return json.loads(br.evaluate(SNAP % y))

    port = 9381
    try:
        # ---------- 桌面：首屏 / 交界 / 正文 ----------
        with cdp.Browser(BASE, port=port, window="1416,808", wait_load=2.0) as br:
            port += 1
            br.evaluate("document.documentElement.style.scrollBehavior='auto'; 1")
            time.sleep(0.4)

            top = snap(br, 0)
            vh = top["vh"]
            ok(top["hasField"] and top["running"] is not None, "正文那层场的引擎起来了")
            ok(top["ink"] == 0, "首屏在屏幕里时场一处都不画（墨迹 %d）" % top["ink"])
            ok(top["visible"] is False, "首屏时场没有进入「可见」状态（%s）" % top["visible"])

            body = snap(br, int(vh * 2.0))
            ok(body["visible"] is True, "滚到正文后场进入可见状态")
            ok(body["ink"] > 500, "正文里场真的在画（墨迹 %d）" % body["ink"])
            spread = len([q for q in body["quarters"] if q > 40])
            ok(spread >= 3, "墨铺在 %d/4 个区带上（不是缩在角落里）" % spread)

            # 首屏的「让位」：顶上必须是中立位（第一眼不能改），滚下去之后
            # 雕塑要真的转、缩、往入口站那边挪 —— 三个量一起看
            ex = top["exit"] or {}
            ok(ex.get("leave") == 0 and ex.get("turn") == 0 and ex.get("scale") == 1
               and ex.get("dx") == 0 and ex.get("dy") == 0,
               "首屏在屏幕里时雕塑的相机是中立位（%s）" % (ex,))
            leaving = snap(br, int(vh * 0.5))["exit"] or {}
            ok(leaving.get("leave", 0) > .5 and leaving.get("turn", 0) < -.2
               and leaving.get("scale", 1) < .98 and leaving.get("dx", 0) < -5,
               "往下滚之后雕塑侧过身让位（leave=%.2f, turn=%.2f, scale=%.2f, dx=%.1f）"
               % (leaving.get("leave", 0), leaving.get("turn", 0),
                  leaving.get("scale", 1), leaving.get("dx", 0)))

            # 描边三档：落定 → 1px / 20%；跑线中 → 2px / 接近满亮。
            # 位置不用猜：按 effects.js 那条公式（rv = (y + .98vh - top) / .52vh）
            # 反解出「让某张卡片的 rv 正好等于 0.58」的 scrollY。
            mid = snap(br, int(br.evaluate(YFOR % ('.home-flow .card', '0.58'))))
            settled = [c for c in mid["cards"] if c["rv"] >= 1]
            if ok(bool(settled), "滚到正文时有卡片已经落定（%d 张）" % len(settled)):
                rim = settled[0]
                ok(abs(rim["op"] - 0.2) < 0.02 and abs(thickness(rim["size"]) - 1) < 0.01,
                   "落定后的卡片留 20%% 余温、笔宽 1px（op=%.2f, w=%.1fpx）"
                   % (rim["op"], thickness(rim["size"])))
            moving = [c for c in mid["cards"] if 0.3 <= c["rv"] <= 0.85]
            if ok(bool(moving), "半路上能量到正在跑描边的卡片（%d 张）" % len(moving)):
                m = moving[0]
                ok(m["op"] > 0.8 and abs(thickness(m["size"]) - 2) < 0.01,
                   "跑线中的卡片是 2px、接近满亮（op=%.2f, w=%.1fpx）" % (m["op"], thickness(m["size"])))

            # 抬头分层：描述那一层从 rv=.46 才起步，所以把位置定在 .66 附近读，
            # 否则会读到「标题已到、描述还没起」这种完全合法但断言会红的中间态
            heady = snap(br, int(br.evaluate(YFOR % ('.home-flow .section-head.reveal', '0.66'))))
            if ok(heady["head"] is not None and heady["head"]["rv"] > 0,
                  "找到抬头正在进场的滚动位置（rv≈%s）"
                  % (None if not heady["head"] else round(heady["head"]["rv"], 2))):
                h = heady["head"]
                ok(h["cap"] > h["h2"] > h["p"] > 0,
                   "抬头依次落位：caption %.2f > 标题 %.2f > 描述 %.2f" % (h["cap"], h["h2"], h["p"]))

            # 站台引线 / 入口缺口：这两块只可能由画布画出来（DOM 里没有对应元素）
            header = snap(br, int(vh * 0.85))
            ok(header["regions"].get("leader", -1) > 0,
               "站台到章节抬头之间那条引线画出来了（%d px）" % header["regions"].get("leader", -1))
            ok(header["regions"].get("gap", -1) > 0,
               "入口站到导轨顶端那段缺口补上了（%d px）" % header["regions"].get("gap", -1))

            # 交界处的场在动：同一个滚动位置，1 秒后画布必须变
            seam = int(br.evaluate(YCENTER % ('.page-home .flow-bridge a', '0.5')))
            br.evaluate(SNAP % seam)
            first = json.loads(br.evaluate(HASH_ONLY))
            time.sleep(1.1)
            second = json.loads(br.evaluate(HASH_ONLY))
            ok(first["y"] == second["y"], "两次采样停在同一滚动位置（%d）" % first["y"])
            ok(first["hash"] != second["hash"],
               "交界的信号在自己走（哈希 %d → %d）" % (first["hash"], second["hash"]))

            # 鼠标进入正文：场跟着偏
            br.evaluate(SNAP % int(vh * 1.6))
            br.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 1330, "y": 90,
                                                 "button": "none", "clickCount": 0})
            time.sleep(0.6)
            lean = json.loads(br.evaluate(HASH_ONLY))
            ok(bool(lean["lean"]) and abs(lean["lean"][0]) > 0.2,
               "鼠标在正文里时场跟着偏（lean=%s）" % (lean["lean"],))

            # 标签：--d 递增，先到的亮
            tagy = snap(br, int(br.evaluate(YFOR % ('.home-flow .tag-cloud', '0.45'))))
            if ok(tagy["pills"] is not None and tagy["pills"]["rv"] > 0,
                  "找到标签正在扫入的滚动位置（rv≈%s）"
                  % (None if not tagy["pills"] else round(tagy["pills"]["rv"], 2))):
                p = tagy["pills"]
                ok(p["dN"] > p["d0"], "标签的延迟按序号递增（%.2f → %.2f）" % (p["d0"], p["dN"]))
                ok(p["op0"] > p["opN"], "扫入时排头先亮（%.2f > %.2f）" % (p["op0"], p["opN"]))

        # ---------- 关闭动效：整套「场」必须消失 ----------
        with cdp.Browser(BASE + "?motion=off", port=port, window="1416,808", wait_load=2.0) as br:
            port += 1
            br.evaluate("document.documentElement.style.scrollBehavior='auto'; 1")
            off = snap(br, int(br.evaluate("window.innerHeight * 1.6")))
            ok(off["ink"] == 0, "关闭动效后画布不画（墨迹 %d）" % off["ink"])
            ok(off["running"] is False, "关闭动效后没有动画帧在跑（%s）" % off["running"])
            op = br.evaluate("getComputedStyle(document.getElementById('flow-field')).opacity")
            ok(float(op) == 0, "关闭动效后那层画布是透明的（opacity=%s）" % op)

        # ---------- 窄屏：导轨那套信号不画，但背景的场还在 ----------
        with cdp.Browser(BASE, port=port, window="492,780", wait_load=2.0) as br:
            port += 1
            br.call("Emulation.setDeviceMetricsOverride",
                    {"width": 492, "height": 780, "deviceScaleFactor": 2, "mobile": True})
            br.evaluate("document.documentElement.style.scrollBehavior='auto'; 1")
            phone = snap(br, int(br.evaluate("window.innerHeight * 2.0")))
            ok(bool(phone["size"]) and phone["size"][0] <= 700,
               "窄屏画布按视口宽建立（%s）" % (phone["size"],))
            ok(phone["ink"] > 300, "窄屏下背景那层场还在（墨迹 %d）" % phone["ink"])
            ok(phone["running"] is True, "窄屏下动画帧在跑（%s）" % phone["running"])
    finally:
        httpd.shutdown()

    print("\n".join(lines))
    fails = [x for x in lines if x.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d"
          % (len([x for x in lines if x.startswith(("PASS", "FAIL"))]), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
