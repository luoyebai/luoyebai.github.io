"""页面诊断：卡片点击命中（含 3D 倾斜生效时）+ 图片加载 + 视频背景播放状态。

    python tools/probe-page.py                       # 首页
    python tools/probe-page.py "/index.html?bgmode=video"
    python tools/probe-page.py /projects/index.html

原理：把目标页放进同源 iframe，派发 pointermove 触发卡片 3D 倾斜，
读取 .card-tilt 的实际 transform 确认倾斜生效，再用 elementFromPoint
在卡片边缘复测命中，验证「倾斜时点击依然不会落空」。
"""
import functools
import http.server
import os
import re
import socketserver
import subprocess
import sys
import threading

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 4194


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


PROBE = r"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>probe</title>
<style>html,body{margin:0;background:#111;color:#ddd;font:13px/1.6 monospace}
iframe{width:1200px;height:2600px;border:0;position:absolute;left:-9999px;top:0}
pre{padding:14px;white-space:pre-wrap}</style></head><body>
<iframe id="f" src="__PAGE__"></iframe><pre id="out">running…</pre>
<script>
(function () {
  var NS = ['EMPTY', 'IDLE', 'LOADING', 'NO_SOURCE'];
  var RS = ['NOTHING', 'METADATA', 'CURRENT_DATA', 'FUTURE_DATA', 'ENOUGH_DATA'];

  function run() {
    var f = document.getElementById('f');
    var doc = f.contentDocument, win = f.contentWindow;
    var L = [];

    // 关掉 .card-tilt 的过渡：离屏 iframe 里动画不一定被推进，
    // 关掉后读到的就是变量作用后的最终变换，验证才确定。
    var st = doc.createElement('style');
    st.textContent = '.card-tilt{transition:none !important}';
    doc.head.appendChild(st);

    // 边缘 8 点：最能暴露旋转造成的命中漂移
    function pts(link) {
      var r = link.getBoundingClientRect();
      return [
        ['中心', r.left + r.width / 2, r.top + r.height / 2],
        ['左上', r.left + 10, r.top + 10],
        ['右上', r.right - 10, r.top + 10],
        ['左下', r.left + 10, r.bottom - 10],
        ['右下', r.right - 10, r.bottom - 10],
        ['封面上中', r.left + r.width / 2, r.top + r.height * 0.2],
        ['封面左中', r.left + 8, r.top + r.height * 0.2],
        ['封面右中', r.right - 8, r.top + r.height * 0.2],
      ];
    }
    // 命中判定：落在整卡链接上算对；落在卡内标签链接上也算对（那是刻意的独立链接）。
    // 真正算错的是「什么都没命中」或「命中了别的卡片」。
    function goodHit(card, link, hit) {
      if (!hit) return false;
      if (hit === link || link.contains(hit)) return true;
      var tag = hit.closest ? hit.closest('.card-tags a') : null;
      return !!(tag && card.contains(tag));
    }
    function countMiss(card, link) {
      var miss = 0, n = 0;
      pts(link).forEach(function (p) {
        if (p[1] < 0 || p[2] < 0 || p[1] > win.innerWidth || p[2] > win.innerHeight) return;
        n++;
        if (!goodHit(card, link, doc.elementFromPoint(p[1], p[2]))) miss++;
      });
      return { miss: miss, n: n };
    }

    var cards = [];
    Array.prototype.forEach.call(doc.querySelectorAll('.card'), function (c) {
      if (c.querySelector('.card-link')) cards.push(c);
    });

    // ---------- 静止状态 ----------
    var sMiss = 0, sN = 0, sizeBad = 0;
    cards.forEach(function (c) {
      var link = c.querySelector('.card-link');
      var cr = c.getBoundingClientRect(), lr = link.getBoundingClientRect();
      if (Math.abs(cr.height - lr.height) > 1) sizeBad++;
      var r = countMiss(c, link);
      sMiss += r.miss; sN += r.n;
    });
    L.push('卡片命中[静止]: ' + cards.length + ' 张卡片，视口内 ' + sN +
           ' 点，未命中 ' + sMiss + (sMiss ? '  [!! 有问题]' : '  [全部命中]'));
    L.push('链接铺满: 高度不一致 ' + sizeBad + ' 张' +
           (sizeBad ? '  [!! 链接没撑满卡片]' : '  [全部等高]'));
    L.push('pointer:fine = ' + win.matchMedia('(pointer: fine)').matches +
           '   prefers-reduced-motion = ' + win.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // ---------- 嵌套 <a> 检查（<a> 里套 <a> 是非法 HTML，会让内层链接失效）----------
    var nested = 0;
    Array.prototype.forEach.call(doc.querySelectorAll('a'), function (a) {
      if (a.querySelector('a')) nested++;
    });
    L.push('嵌套 <a>: ' + nested + ' 处' + (nested ? '  [!! 非法，内层链接会点不动]' : '  [无]'));

    // ---------- 标签点击命中检查 ----------
    var tagLinks = doc.querySelectorAll('.card-tags a.pill');
    var tagOk = 0, tagBad = [];
    Array.prototype.forEach.call(tagLinks, function (a) {
      var r = a.getBoundingClientRect();
      if (r.top < 0 || r.bottom > win.innerHeight || r.width < 4) return;   // 视口外跳过
      var hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && (hit === a || a.contains(hit))) tagOk++;
      else tagBad.push(a.getAttribute('href') + ' -> 实际命中 ' + (hit ? hit.tagName + '.' + (hit.getAttribute('class') || '') : 'null'));
    });
    L.push('标签点击: 视口内标签 ' + (tagOk + tagBad.length) + ' 个，命中标签本身 ' + tagOk +
           (tagBad.length ? '  [!! 有 ' + tagBad.length + ' 个被卡片链接吃掉]' : '  [全部正确]'));
    tagBad.slice(0, 5).forEach(function (s) { L.push('   ' + s); });

    // ---------- 归档行（结构不同：.archive-hit 覆盖层 + .archive-row 视觉层）----------
    var rows = doc.querySelectorAll('.archive-item');
    if (rows.length) {
      var rTotal = 0, rMiss = 0, rTagOk = 0, rTagBad = 0, detail = '';
      Array.prototype.forEach.call(rows, function (li) {
        var hit = li.querySelector('.archive-hit');
        var row = li.querySelector('.archive-row');
        if (!hit || !row) { if (!detail) detail = '缺少 .archive-hit 或 .archive-row'; return; }
        var rr = row.getBoundingClientRect();
        var y = rr.top + rr.height / 2;
        if (y < 0 || y > win.innerHeight) return;
        rTotal++;
        var h = doc.elementFromPoint(rr.left + 26, y);
        if (!(h === hit || (h && hit.contains(h)))) {
          rMiss++;
          if (!detail) detail = '行左侧命中 ' + (h ? h.tagName + '.' + (h.getAttribute('class') || '') : 'null');
        }
      });
      Array.prototype.forEach.call(doc.querySelectorAll('.archive-item .tags a'), function (a) {
        var r = a.getBoundingClientRect();
        if (r.top < 0 || r.bottom > win.innerHeight || r.width < 4) return;
        var h = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (h && (h === a || a.contains(h))) rTagOk++;
        else rTagBad++;
      });
      L.push('归档行命中: 视口内 ' + rTotal + ' 行，未命中 ' + rMiss +
             (rMiss ? '  [!! ' + detail + ']' : '  [全部命中]'));
      L.push('归档标签点击: 视口内 ' + (rTagOk + rTagBad) + ' 个，命中标签本身 ' + rTagOk +
             (rTagBad ? '  [!! 有 ' + rTagBad + ' 个被行链接吃掉]' : '  [全部正确]'));
    }

    // ---------- 逐张：派发 pointermove 触发倾斜，再复测 ----------
    var i = 0, hMiss = 0, hN = 0, tilted = 0;
    function step() {
      if (i >= cards.length) return finish();
      var card = cards[i++];
      var link = card.querySelector('.card-link');
      var lr = link.getBoundingClientRect();
      // 点在卡片右下角附近 -> 产生最大的 rotateX/rotateY
      var cx = lr.right - 14, cy = lr.bottom - 14;
      if (cy > win.innerHeight) { step(); return; }
      try {
        card.dispatchEvent(new win.PointerEvent('pointermove', {
          clientX: cx, clientY: cy, bubbles: true, pointerType: 'mouse'
        }));
      } catch (e) { L.push('  派发 pointermove 失败: ' + e.message); }
      setTimeout(function () {
        var tilt = card.querySelector('.card-tilt');
        var tf = tilt ? win.getComputedStyle(tilt).transform : 'none';
        if (tf && tf !== 'none') tilted++;
        var r = countMiss(card, link);
        hMiss += r.miss; hN += r.n;
        if (i === 1) {
          L.push('倾斜示例 transform = ' + (tf || 'none'));
          if (tilt) {
            L.push('倾斜示例 CSS 变量 --rx=' + tilt.style.getPropertyValue('--rx') +
                   ' --ry=' + tilt.style.getPropertyValue('--ry') +
                   '   （矩阵里应有非 1 的旋转项才算真生效）');
          }
        }
        step();
      }, 460);   // 要长于 .card-tilt 的 .34s 过渡，确保测的是倾斜到位的状态
    }
    function finish() {
      L.push('卡片命中[倾斜中]: 视口内 ' + hN + ' 点，未命中 ' + hMiss +
             (hMiss ? '  [!! 倾斜时点不中]' : '  [全部命中]') +
             '   产生变形的卡片 ' + tilted + '/' + cards.length);
      reportBody();
    }

    function reportBody() {
      // ---- 图片 ----
      var imgs = doc.querySelectorAll('img'), broken = [], loaded = 0;
      Array.prototype.forEach.call(imgs, function (im) {
        if (im.naturalWidth > 0) loaded++;
        else if (im.complete) broken.push(im.getAttribute('src'));
      });
      L.push('图片: 共 ' + imgs.length + ' 张，已解码 ' + loaded + ' 张，失败 ' + broken.length + ' 张');
      broken.slice(0, 6).forEach(function (s) { L.push('   失败: ' + s); });

      // ---- 字体 ----
    var codeEl = doc.querySelector('pre code, .prose code, code, pre');
    L.push('字体 body = ' + win.getComputedStyle(doc.body).fontFamily.slice(0, 78));
    if (codeEl) L.push('     code = ' + win.getComputedStyle(codeEl).fontFamily.slice(0, 78));
    if (doc.fonts) {
      var faces = [];
      doc.fonts.forEach(function (f) { faces.push(f.family + ' ' + f.weight + ' [' + f.status + ']'); });
      L.push('     @font-face = ' + (faces.join('  ') || '(无)'));
      L.push('     FiraCode Nerd 可用 = ' + doc.fonts.check('16px "FiraCode Nerd"') +
             '   （本机完整版 = ' + doc.fonts.check('16px "FiraCode Nerd Font"') + '）');
    }

    // ---- 字体（只报「请求了什么」，不判断「最终用了什么」）----
    // 想做后者请用 tools/probe-font.py：它走 CDP 的 CSS.getPlatformFontsForNode，
    // 是唯一可靠的口子。这里曾经用 canvas 像素比对来猜，但同一字体只要位置差 1px
    // 就会让几乎所有像素「不同」，会误报「都不像」，已经撤掉。
    var codeEl2 = doc.querySelector('pre code, code, pre');
    L.push('字体 body = ' + win.getComputedStyle(doc.body).fontFamily.slice(0, 78));
    if (codeEl2) L.push('     code = ' + win.getComputedStyle(codeEl2).fontFamily.slice(0, 78));
    if (doc.fonts) {
      var faces = [];
      doc.fonts.forEach(function (f) { faces.push(f.family + ' ' + f.weight + '[' + f.status + ']'); });
      L.push('     @font-face = ' + (faces.join('  ') || '(无)'));
    }
    L.push('     （实际生效的字体请跑 tools/probe-font.py）');

    // ---- 视频 ----
      var v = doc.querySelector('.bg-video');
      if (!v) {
        L.push('视频: 页面上没有 <video class="bg-video">');
      } else {
        L.push('视频: attr src=' + (v.getAttribute('src') || '(未设置)') +
               '  networkState=' + v.networkState + '(' + (NS[v.networkState] || '?') + ')' +
               '  readyState=' + v.readyState + '(' + (RS[v.readyState] || '?') + ')');
        L.push('      ' + v.videoWidth + 'x' + v.videoHeight +
               (v.videoWidth > 0 ? ' [已解码出画面]' : ' [没有画面]') +
               '  paused=' + v.paused + '  duration=' +
               (isFinite(v.duration) ? v.duration.toFixed(2) : v.duration) +
               '  error=' + (v.error ? v.error.code : '无') +
               '  opacity=' + win.getComputedStyle(v).opacity);
      }
      // ---- 前端脚本/面板状态 ----
    L.push('window.Theme = ' + (typeof win.Theme) +
           '   外观面板 #settings.hidden = ' +
           (doc.getElementById('settings') ? doc.getElementById('settings').hidden : '(无此元素)'));
    var html = doc.documentElement;
      L.push('html bgmode=' + html.getAttribute('data-bgmode') + ' bg=' + html.getAttribute('data-bg') +
             ' motion=' + html.getAttribute('data-motion') + ' theme=' + html.getAttribute('data-theme'));
      document.getElementById('out').textContent = L.join('\n');
    }

    step();
  }
  document.getElementById('f').addEventListener('load', function () { setTimeout(run, 2000); });
})();
</script></body></html>
"""


def main() -> int:
    page = sys.argv[1] if len(sys.argv) > 1 else "/index.html"
    diag = os.path.join(PUBLIC, "_probe.html")
    with open(diag, "w", encoding="utf-8") as fh:
        fh.write(PROBE.replace("__PAGE__", page))

    handler = functools.partial(Quiet, directory=PUBLIC)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    try:
        r = subprocess.run([
            EDGE, "--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
            "--autoplay-policy=no-user-gesture-required",
            "--user-data-dir=" + os.path.join(os.environ.get("TEMP", "."), "edge-probe"),
            "--window-size=1200,2600", "--virtual-time-budget=16000", "--dump-dom",
            f"http://127.0.0.1:{PORT}/_probe.html",
        ], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    finally:
        srv.shutdown()
        srv.server_close()
        if os.path.exists(diag):
            os.remove(diag)

    m = re.search(r'<pre id="out">(.*?)</pre>', r.stdout or "", re.S)
    if not m:
        print("未取到报告，DOM 片段：")
        print((r.stdout or "")[:1200])
        return 1
    print(f"页面: {page}")
    print(m.group(1).replace("&lt;", "<").replace("&gt;", ">")
          .replace("&amp;", "&").replace("&quot;", '"'))
    return 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    os._exit(code)
