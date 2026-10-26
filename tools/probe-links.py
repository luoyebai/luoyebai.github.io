#!/usr/bin/env python3
"""外链站点标记与链接卡片探针。

这一套全是「坏了也不报错」的东西：

- 标记的 `<use href="#site-x">` 指空了（精灵没注进这一页）→ 链接旁边**空一小块**，
  页面照样打开，肉眼几乎看不出来；
- 品牌色写死 → 15 套主题里总有几套对比度不合格，蓝色系主题上尤其明显；
- 链接卡片吞掉标题、`links.js` 把标记一起清空 → 都在「看着还行」的范围里。

所以这里断言的是**量出来的几何与颜色**：标记有没有真的画出来（`getBBox`）、
颜色是不是跟着链接色走（切一次明暗再量）、有没有偷偷去第三方拉图标。

    python tools/probe-links.py
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
PORT = 4189
BASE = "http://127.0.0.1:%d" % PORT
# 三篇各有代表性：正文行内标记 / 一整段就一条链接的卡片 / links 页的图标方块
INLINE_PAGE = "/posts/cpp-toolchain/"
CARD_PAGE = "/posts/humanoid-0-to-1-toolchain/"
LINKS_PAGE = "/links/"

MARKS = r"""
(function(){
  var out = {marks: [], noMark: 0, links: 0, sprites: 0, symbols: 0, used: []};
  var prose = document.querySelector('.prose') || document.body;
  out.sprites = document.querySelectorAll('svg.site-icons').length;
  out.symbols = document.querySelectorAll('svg.site-icons symbol').length;
  [].slice.call(prose.querySelectorAll('a[href^="http"]')).forEach(function(a){
    var m = a.querySelector('.site-mark');
    if (!m) {
      out.noMark++;
      out.links++;
      return;
    }
    out.links++;
    var id = (m.querySelector('use') || {}).getAttribute
      ? m.querySelector('use').getAttribute('href') : '';
    out.used.push(id);
    var r = m.getBoundingClientRect();
    var box = null;
    try { box = m.getBBox(); } catch (e) {}
    out.marks.push({
      site: a.getAttribute('data-site') || '',
      target: a.getAttribute('target') || '',
      rel: a.getAttribute('rel') || '',
      text: (a.textContent || '').trim().slice(0, 24),
      id: id,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      bboxW: box ? Math.round(box.width * 10) / 10 : -1,
      fill: getComputedStyle(m).fill,
      colour: getComputedStyle(a).color,
      before: !!(a.firstElementChild === m),
      markRight: Math.round(r.right),
      // 文字的左边缘要**跳过标记本身**再量：Range 圈住整个 <a> 的话，
      // 第一个矩形就是那枚标记，量出来的「间距」永远是 0。
      textLeft: (function(){
        var range = document.createRange();
        var nodes = a.childNodes;
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (n === m) continue;
          if (n.nodeType === 3 && !String(n.nodeValue || '').trim()) continue;
          try { range.selectNodeContents(n); } catch (e) { continue; }
          var rects = range.getClientRects();
          if (rects.length) return Math.round(rects[0].left);
        }
        return -1; })(),
      inParagraph: !!a.closest('p')
    });
  });
  return JSON.stringify(out);})()
"""

CARDS = r"""
(function(){
  var prose = document.querySelector('.prose') || document.body;
  var out = [];
  [].slice.call(prose.querySelectorAll('.link-card')).forEach(function(a){
    var m = a.querySelector('.site-mark');
    var box = null;
    try { box = m ? m.getBBox() : null; } catch (e) {}
    var r = a.getBoundingClientRect();
    out.push({
      href: a.getAttribute('href') || '',
      site: a.getAttribute('data-site') || '',
      target: a.getAttribute('target') || '',
      title: (a.querySelector('.link-card-title') || {}).textContent || '',
      host: (a.querySelector('.link-card-host') || {}).textContent || '',
      display: getComputedStyle(a).display,
      h: Math.round(r.height),
      w: Math.round(r.width),
      bboxW: box ? Math.round(box.width * 10) / 10 : -1,
      inParagraph: !!a.closest('p'),
      plainLinks: prose.querySelectorAll('p > a[href^="http"]').length
    });
  });
  return JSON.stringify(out);})()
"""

TILES = r"""
(function(){
  var brand = 0, letter = 0, empty = 0, bad = [];
  document.querySelectorAll('.resource-icon').forEach(function(ic){
    var m = ic.querySelector('.site-mark');
    if (ic.classList.contains('is-brand')) {
      brand++;
      var box = null;
      try { box = m ? m.getBBox() : null; } catch (e) {}
      if (!box || box.width <= 1) bad.push((ic.parentElement.textContent || '').slice(0, 14));
    } else if (((ic.textContent || '').trim()).length) {
      letter++;
    } else {
      empty++;
    }
  });
  return JSON.stringify({brand: brand, letter: letter, empty: empty, bad: bad,
    strayMarks: document.querySelectorAll('.page-links .prose li > a > .site-mark').length,
    sprites: document.querySelectorAll('svg.site-icons').length});})()
"""

ORIGINS = r"""
(function(){
  var bad = [];
  performance.getEntriesByType('resource').forEach(function(e){
    try { var u = new URL(e.name);
      if (u.origin !== location.origin) bad.push(u.origin); } catch (err) {}
  });
  return JSON.stringify(bad);})()
"""


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
    os.makedirs(SHOTS, exist_ok=True)
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    lines = []

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        return cond

    port = 9376
    try:
        # ---------- 正文行内标记 ----------
        with cdp.Browser(BASE + INLINE_PAGE, port=port, window="1440,1000",
                         wait_load=2.4) as br:
            port += 1
            time.sleep(1.0)
            m = json.loads(br.evaluate(MARKS))
            marks = m["marks"]
            ok(m["sprites"] == 1, "整页只有一份图标精灵（%d）" % m["sprites"])
            # 这一页 9 条外链里只有 3 个域名在图标表里（cmake / gitlab / conan），
            # 剩下的 xmake、meson、ninja、vcpkg 等没收录 —— 正好两种路径都能验到
            if ok(len(marks) >= 3,
                  "%s：%d 条外链带站点标记（另有 %d 条普通外链）"
                  % (INLINE_PAGE, len(marks), m["noMark"])):
                small = [x for x in marks if min(x["w"], x["h"]) < 11]
                ok(not small, "标记都真的画出来了（最小 %s）"
                   % (min(min(x["w"], x["h"]) for x in marks)))
                nobox = [x for x in marks if x["bboxW"] <= 1]
                ok(not nobox, "`<use>` 都指向存在的 symbol（%s 个指空）" % len(nobox))
                bad = [x for x in marks if x["fill"] != x["colour"]]
                ok(not bad, "标记颜色继承链接色（%s 个不一致，如 %s）"
                   % (len(bad), bad[0]["fill"] + " vs " + bad[0]["colour"] if bad else "—"))
                ok(all(x["before"] for x in marks), "标记排在链接文字前面")
                ok(all(x["markRight"] <= x["textLeft"] + 1 for x in marks),
                   "标记与文字之间留了间距")
                ok(all(x["target"] == "_blank" and "noopener" in x["rel"] for x in marks),
                   "带标记的外链仍然新标签页打开")
                ids = sorted({x["id"] for x in marks})
                ok(m["symbols"] == len(ids),
                   "精灵里的图标数正好是页面用到的（%d == %d）" % (m["symbols"], len(ids)))
                ok(len({x["site"] for x in marks}) >= 3,
                   "覆盖了 %d 个不同站点" % len({x["site"] for x in marks}))
                lines.append("      例：%s"
                             % "、".join("%s(%s)" % (x["site"], x["text"][:10])
                                        for x in marks[:4]))
            ok(m["noMark"] >= 1,
               "没收录的域名不加装饰（%d 条普通外链）" % m["noMark"])

            # 明暗切换之后颜色要跟着走（写死品牌色的话这里就不一致了）
            before = json.loads(br.evaluate(MARKS))["marks"][0]
            br.evaluate("window.Theme && window.Theme.set({mode:'light'}, false)")
            time.sleep(0.6)
            after = json.loads(br.evaluate(MARKS))["marks"][0]
            ok(after["fill"] == after["colour"],
               "切到浅色后标记仍等于链接色（%s）" % after["colour"])
            ok(before["colour"] != after["colour"],
               "两种模式下链接色确实不同（%s -> %s）" % (before["colour"], after["colour"]))

            bad_origin = json.loads(br.evaluate(ORIGINS))
            ok(not bad_origin, "没有向第三方请求任何资源（%s）"
               % ("、".join(sorted(set(bad_origin))[:3]) or "0 个"))

        # ---------- 链接卡片 ----------
        with cdp.Browser(BASE + CARD_PAGE, port=port, window="1440,1000",
                         wait_load=2.4) as br:
            port += 1
            time.sleep(1.0)
            cards = json.loads(br.evaluate(CARDS))
            if ok(len(cards) >= 5, "%s：%d 张链接卡片" % (CARD_PAGE, len(cards))):
                ok(all(c["href"].startswith("http") and c["target"] == "_blank"
                       for c in cards), "卡片都是新标签页打开的外链")
                ok(all(c["bboxW"] > 1 for c in cards), "卡片图标都画出来了")
                ok(all(c["display"] == "flex" and not c["inParagraph"] for c in cards),
                   "卡片是独立的 flex 块（没有被塞进段落）")
                ok(all(c["h"] >= 56 and c["w"] >= 260 for c in cards),
                   "卡片有足够的点击面积（最小 %dx%d）"
                   % (min(c["h"] for c in cards), min(c["w"] for c in cards)))
                ok(all(c["title"] and (c["host"] or c["title"] == c["site"]) for c in cards),
                   "卡片都有标题；标题就是域名时（没有可读路径）不重复写第二行")
                ok(all(not c["title"].startswith("http") for c in cards),
                   "卡片标题不是一整条 URL（裸链接取路径末段）")
                ok(all(c["site"] in c["href"] for c in cards),
                   "域名标签与链接对得上")
                lines.append("      例：%s"
                             % "、".join("%s(%s)" % (c["host"], c["title"][:12])
                                        for c in cards[:4]))
            ok(cards and cards[0]["plainLinks"] >= 1,
               "同一页里没收录的域名仍然是普通段落链接（%d 条）"
               % (cards[0]["plainLinks"] if cards else 0))

        # ---------- links 页的图标方块 ----------
        with cdp.Browser(BASE + LINKS_PAGE, port=port, window="1440,1000",
                         wait_load=2.4) as br:
            port += 1
            time.sleep(1.2)
            t = json.loads(br.evaluate(TILES))
            ok(t["brand"] >= 8, "links 页有 %d 个方块换成了真图标" % t["brand"])
            ok(not t["bad"], "图标方块里的标记都画出来了（%s 个空的）" % len(t["bad"]))
            ok(t["letter"] >= 5, "没收录的域名仍然用两字母方块（%d 个）" % t["letter"])
            ok(t["empty"] == 0, "没有空白的方块")
            ok(t["strayMarks"] == 0,
               "links.js 没有把标记留在链接文字里（%d 个残留）" % t["strayMarks"])
            ok(t["sprites"] == 1, "links 页也只有一份精灵（%d）" % t["sprites"])
    finally:
        httpd.shutdown()

    print("\n".join(lines))
    fails = [x for x in lines if x.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d"
          % (len([x for x in lines if x.startswith(("PASS", "FAIL"))]), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
