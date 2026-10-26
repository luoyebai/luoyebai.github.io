#!/usr/bin/env python3
"""视频有效性校验：让**浏览器**真的把 14 段背景片解码一遍。

ffprobe 只证明容器写对了，证明不了 Chrome 认得。这里用 CDP 起一个真实会话，
逐个 load() 每段 mp4，检查 videoWidth/videoHeight、时长、error 码，并把画面
drawImage 到 canvas 上数非透明像素 —— 能画出东西才算真的解码成功。

    python tools/check-bg-play.py
    python tools/check-bg-play.py --min-w 2560
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
PORT = 4212
DEBUG_PORT = 9390
WANT = (2560, 1440)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


# 在页面里：一次加载一段，等 loadeddata，再把首帧画到 canvas 上数像素
LOAD_ONE = """
(function (url) {
  return new Promise(function (resolve) {
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    var done = false;
    function measure(extra) {
      if (done) return; done = true;
      var lit = -1;
      try {
        var c = document.createElement('canvas');
        c.width = 320; c.height = 180;
        var x = c.getContext('2d');
        x.drawImage(v, 0, 0, 320, 180);
        var d = x.getImageData(0, 0, 320, 180).data;
        /* 用亮度标准差判断"这一帧有没有内容"：
           数"和某个像素不同的点数"对线稿类画面会误判（sketch 全白底黑线，只有 22%），
           纯色帧的标准差则精确地是 0。 */
        var n = 0, s = 0, s2 = 0;
        for (var i = 0; i < d.length; i += 4 * 7) {
          var lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          n++; s += lum; s2 += lum * lum;
        }
        lit = n ? Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n))) : -1;
      } catch (e) { lit = -2; }
      var out = {
        w: v.videoWidth, h: v.videoHeight,
        dur: isNaN(v.duration) ? 0 : v.duration,
        err: v.error ? v.error.code : 0,
        ready: v.readyState, lit: lit === -1 ? -1 : Math.round(lit * 10) / 10,
        at: v.currentTime
      };
      for (var k in extra) out[k] = extra[k];
      v.removeAttribute('src'); v.load();
      resolve(out);
    }
    v.addEventListener('loadeddata', function () {
      /* 首帧可能正好是一段纯色淡入（paper / sketch 就是这样），
         所以要跳到片子中段再量，否则量的是"这一帧平不平"而不是"能不能解码"。 */
      if (v.duration && isFinite(v.duration)) {
        v.addEventListener('seeked', function () { measure({}); });
        v.currentTime = v.duration * 0.4;
      } else {
        measure({});
      }
    });
    v.addEventListener('error', function () { measure({}); });
    setTimeout(function () { measure({ timeout: true }); }, 15000);
    v.src = url;
    v.load();
  });
})
"""


def main() -> int:
    with open(os.path.join(ROOT, "assets", "bg", "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    themes = [t for t in manifest if manifest[t].get("video")]

    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT),
                                   functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    fails = []
    rows = []
    try:
        with cdp.Browser("http://127.0.0.1:%d/404.html" % PORT, port=DEBUG_PORT,
                         window="900,600", wait_load=1.2) as br:
            for tid in sorted(themes):
                url = "/" + manifest[tid]["video"]
                r = br.evaluate("%s(%s)" % (LOAD_ONE, json.dumps(url)))
                ok = (r and r.get("w") == WANT[0] and r.get("h") == WANT[1]
                      and not r.get("err") and (r.get("lit") or 0) > 4
                      and not r.get("timeout"))
                kb = manifest[tid].get("video_kb", 0)
                rows.append((tid, r, ok, kb))
                if not ok:
                    fails.append(tid)
                flag = "" if ok else "   ← 有问题"
                print(f"  {tid:<8} {r.get('w')}x{r.get('h')}  {r.get('dur', 0):5.2f}s  "
                      f"readyState={r.get('ready')}  err={r.get('err')}  "
                      f"首帧亮度σ={r.get('lit')}  {kb:>5} KB{flag}")
    finally:
        httpd.shutdown()
        httpd.server_close()

    total = sum(r[3] for r in rows)
    print()
    print(f"  {len(rows)} 段；浏览器全部解码成功 {len(rows) - len(fails)} 段，"
          f"视频合计 {total / 1024:.1f} MB")
    if fails:
        print(f"  !! 失败：{fails}")
        return 1
    return 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
