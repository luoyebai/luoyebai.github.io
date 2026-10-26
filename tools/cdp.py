"""最小 Chrome DevTools Protocol 客户端（标准库实现，无需第三方依赖）。

为什么需要它：有些问题只有问浏览器才知道答案——
字体到底用了哪个、点击之后 JS 有没有真的执行、某个元素最终是什么状态。
getComputedStyle 之类只能看到「请求了什么」，看不到「结果是什么」。

    from cdp import Browser
    with Browser("http://127.0.0.1:4201/") as b:
        b.call("Runtime.enable")
        print(b.evaluate("document.title"))

实现要点：手工做 WebSocket 握手与帧编解码（Python 标准库没有 WS 客户端）。
"""
from __future__ import annotations

import base64
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


class WS:
    """极简 WebSocket 客户端：只支持客户端发起的文本帧。"""

    def __init__(self, url: str, timeout: float = 20.0):
        rest = url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((
            f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        if b"101" not in buf.split(b"\r\n")[0]:
            raise RuntimeError(f"WebSocket 握手失败: {buf[:120]!r}")
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
        self.mid = 0

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("连接已关闭")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, method: str, params=None) -> int:
        self.mid += 1
        payload = json.dumps({"id": self.mid, "method": method, "params": params or {}}).encode()
        header = bytearray([0x81])
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        self.sock.sendall(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        return self.mid

    def recv(self) -> dict:
        while True:
            b0, b1 = self._read(2)
            opcode = b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read(8))[0]
            data = self._read(length)
            if opcode == 0x8:
                raise RuntimeError("服务端关闭了连接")
            if opcode in (0x1, 0x2):
                try:
                    return json.loads(data.decode("utf-8"))
                except Exception:
                    continue
            # 0x9 ping / 0xA pong / 其他控制帧：忽略

    def call(self, method: str, params=None, timeout: float = 20.0,
             accept_dialogs: bool = True) -> dict:
        mid = self.send(method, params)
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self.recv()
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(msg["error"].get("message"))
                return msg.get("result", {})
            # 原生 alert/confirm/beforeunload 会**阻塞渲染进程**，
            # 此时任何 evaluate 都等不到响应、只能超时。收到对话框事件立刻关掉它。
            if accept_dialogs and msg.get("method") == "Page.javascriptDialogOpening":
                try:
                    self.send("Page.handleJavaScriptDialog", {"accept": True})
                except Exception:
                    pass
        raise TimeoutError(f"{method}（若页面弹了原生对话框，见 cdp.py 的 accept_dialogs）")


class Browser:
    """起一个 headless Edge 并连上它的调试端口。

    每次都用全新 profile：复用 profile 时 Edge 会恢复上次的标签页，
    /json 里出现多个 target，容易连错页面导致结果张冠李戴。
    """

    def __init__(self, url: str, port: int = 9333, window: str = "1280,900",
                 wait_load: float = 1.5, extra_args=None):
        import shutil
        import tempfile
        self._shutil = shutil
        self.profile = tempfile.mkdtemp(prefix="edge-cdp-")
        args = [EDGE, "--headless", "--disable-gpu", "--no-first-run",
                f"--remote-debugging-port={port}", f"--user-data-dir={self.profile}",
                f"--window-size={window}"]
        # 关掉「窗口被挡住就降级」这套省电策略。无头窗口在 Windows 上会被
        # `CalculateNativeWinOcclusion` 判成被遮挡，于是渲染进程进入后台状态：
        # **定时器被压到 1/分钟、CSS 过渡直接冻住**。表现出来是五花八门的假故障 ——
        # 「演示 iframe 只有 28px」（height 0→520 的过渡停在半路）、
        # 「骨架屏没出现」（那是定时器驱动的）、「聚焦断言偶发失败」，
        # 而页面本身完全正常。探针要量的是页面行为，不是浏览器的省电策略。
        args += ["--disable-background-timer-throttling",
                 "--disable-backgrounding-occluded-windows",
                 "--disable-renderer-backgrounding",
                 "--disable-features=CalculateNativeWinOcclusion"]
        args += list(extra_args or [])
        args.append(url)
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.port = port

        target = None
        want = url.split("#")[0]
        for _ in range(50):
            time.sleep(0.4)
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=3) as r:
                    pages = json.loads(r.read().decode())
                cands = [p for p in pages if p.get("type") == "page" and p.get("webSocketDebuggerUrl")]
                exact = [p for p in cands if p.get("url", "").split("#")[0] == want]
                target = (exact or cands or [None])[0]
                if target:
                    break
            except Exception:
                continue
        if not target:
            self.close()
            raise RuntimeError("连不上浏览器调试端口")
        self.target_url = target.get("url")
        self.ws = WS(target["webSocketDebuggerUrl"])
        time.sleep(wait_load)

    def call(self, method: str, params=None, timeout: float = 30.0) -> dict:
        result = self.ws.call(method, params, timeout)
        if method == "Page.captureScreenshot":
            self._refront(timeout)
        return result

    def _refront(self, timeout: float = 30.0) -> None:
        """截图之后把页面拉回前台。

        **截图会让渲染进程进后台**：`document.visibilityState` 变成 `hidden`，
        于是 `requestAnimationFrame` 停摆（动画时钟不走）、CSS 过渡冻在半路、
        定时器被压慢。页面上一切「靠时间推进」的东西从此都不再动，
        后面那些断言就会以假故障的形式红出来，而页面本身完全正常：

        - 「演示 iframe 撑起来了（28 px）」——height 0→520 的过渡停在 26%；
        - 「骨架屏 / 启动遮罩没出现」「聚焦偶发失败」——定时器驱动的那些。

        `captureBeyondViewport` 是必现的，普通截图也遇到过（`probe-reading.py`
        里那张遮罩层截图就是），所以这里不区分参数，截完统一补一次。
        上一次真实的红为此查了半天，最后是靠量 `visibilityState` 才定位到的。
        """
        try:
            # 先看一眼：页面本来就可见时**什么都不做** —— 这条路径每次截图都会走，
            # 多花的每一个 evaluate 都可能改变后面那些跟时序有关的断言。
            if self.evaluate("document.visibilityState", timeout=10.0) != "hidden":
                return
            for _ in range(6):
                self.ws.call("Page.bringToFront", None, timeout)
                time.sleep(0.2)
                if self.evaluate("document.visibilityState", timeout=10.0) != "hidden":
                    return
        except Exception:  # noqa: BLE001 —— 拉不回来也不该让截图本身失败
            pass

    def evaluate(self, expression: str, timeout: float = 30.0):
        """执行 JS 并取回值。表达式需是单表达式，用 returnByValue 返回。"""
        r = self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
        }, timeout=timeout)
        if r.get("exceptionDetails"):
            desc = r["exceptionDetails"].get("exception", {}).get("description")
            raise RuntimeError(desc or json.dumps(r["exceptionDetails"], ensure_ascii=False)[:300])
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.sock.close()
        except Exception:
            pass
        try:
            self.proc.terminate()
            self.proc.wait(timeout=10)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        self._shutil.rmtree(self.profile, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def setup_stdout():
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")
