#!/usr/bin/env python3
"""首页滚动叙事的"视觉接触表"：按叙事进度逐张截图，用来肉眼复核。

探针（`probe-galaxy.py`）管的是**数值**：位置对不齐、权重归一、有没有空档。
它管不了"看上去对不对" —— 粒子是不是糊成一条、交接是不是跳、卡片轮廓是不是
压在已经显形的卡片上。这个脚本按 `__morph` 的进度一格一格截图，
存到 `_shots/narrative/`，看完就删。

    python tools/shots-narrative.py            # 默认 1440x900
    python tools/shots-narrative.py 390x844    # 手机视口
"""
import base64
import functools
import http.server
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
OUT = os.path.join(ROOT, "_shots", "narrative")
PORT = 4242

# 进度 → 文件名。0 = 还没开始；0.3 散开；0.52 拼字中途；0.66 成字 + 接手；
# 0.95 交接完成；1.0 之后是卡片段落，按滚动位置另取。
STOPS = [(0.0, "01-hero"), (0.30, "02-scatter"), (0.52, "03-forming"),
         (0.66, "04-text"), (0.80, "05-handover"), (1.0, "06-settled")]
EXTRA = [1.35, 1.75, 2.3, 3.0, 3.9]        # 屏数：卡片逐块浮现那一段


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


class QuietServer(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


def main() -> int:
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    window = "1440,900"
    for a in sys.argv[1:]:
        if "x" in a and a.replace("x", "").isdigit():
            window = a
    os.makedirs(OUT, exist_ok=True)
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/index.html" % PORT
    made = []
    try:
        with cdp.Browser(base, port=9572, window=window, wait_load=2.8) as br:
            br.call("Page.enable")
            time.sleep(2.6)
            br._refront()
            br.evaluate("document.documentElement.style.scrollBehavior='auto'")
            head_top = br.evaluate("window.__morph && window.__morph.info().headTop")
            vh = br.evaluate("window.innerHeight")
            if not head_top:
                print("!! __morph 没起来，先修首页叙事")
                return 1

            def shot(name):
                br._refront()
                time.sleep(0.25)
                data = br.call("Page.captureScreenshot", {"format": "png"})
                path = os.path.join(OUT, name + ".png")
                with open(path, "wb") as fh:
                    fh.write(base64.b64decode(data["data"]))
                made.append(path)
                info = br.evaluate("window.__morph.info()")
                print("  %-14s p=%-6s rv=%-6s cardLive=%s -> %s"
                      % (name, info["p"], info["head"], info["cardLive"],
                         os.path.basename(path)))

            for p, name in STOPS:
                y = max(0, round(head_top - vh * (1 - 0.8 * p)))
                br.evaluate("window.scrollTo(0, %d)" % y)
                time.sleep(1.0)
                shot(name)

            for frac in EXTRA:
                br.evaluate("window.scrollTo(0, Math.round(window.innerHeight*%.2f))" % frac)
                time.sleep(0.9)
                shot("07-cards-%.2f" % frac)
    finally:
        httpd.shutdown()
        httpd.server_close()
    print("\n  %d 张 -> %s" % (len(made), OUT))
    return 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
