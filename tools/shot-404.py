#!/usr/bin/env python3
"""用 CDP 起一个真实浏览器会话给 404 页截图。

shots.py 用的 `--screenshot` + `--virtual-time-budget` 会在脚本跑完之前就抓图，
对「一次性算完再画」的静态帧不可靠，所以这里走调试协议：
加载页面 -> 等一会儿（或等 HUD 稳定）-> Page.captureScreenshot。

    python tools/shot-404.py                       # 默认主题
    python tools/shot-404.py neon light            # 主题 / 明暗组合
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
OUT = os.path.join(ROOT, "_shots")
PORT = 4202
DEBUG_PORT = 9344


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main() -> int:
    jobs = sys.argv[1:] or ["dusk:dark", "paper:light"]
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    os.makedirs(OUT, exist_ok=True)

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    fails = 0
    try:
        for i, job in enumerate(jobs):
            theme, _, mode = job.partition(":")
            mode = mode or "dark"
            url = (f"http://127.0.0.1:{PORT}/404.html"
                   f"?motion=off&theme={theme}&mode={mode}&bg=off")
            out = os.path.join(OUT, f"404-{theme}-{mode}.png")
            try:
                with cdp.Browser(url, port=DEBUG_PORT + i, window="1440,900",
                                 wait_load=2.0) as br:
                    br.call("Page.enable")
                    # 静态帧是一次算完的，等 HUD 稳定即可
                    for _ in range(40):
                        txt = br.evaluate(
                            "document.getElementById('e404-stats').textContent") or ""
                        if "900" in txt:
                            break
                        time.sleep(0.15)
                    time.sleep(0.4)
                    shot = br.call("Page.captureScreenshot", {"format": "png"})
                    with open(out, "wb") as fh:
                        fh.write(base64.b64decode(shot["data"]))
                print(f"  {theme}/{mode}  {os.path.getsize(out) // 1024} KB  -> {out}")
            except Exception as exc:  # noqa: BLE001
                fails += 1
                print(f"  {theme}/{mode}  失败: {exc}")
    finally:
        httpd.shutdown()
        httpd.server_close()

    return 1 if fails else 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
