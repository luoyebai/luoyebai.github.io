"""权威字体检查：用 Chrome DevTools Protocol 问浏览器「这段文字实际用了哪个字体」。

    python tools/probe-font.py [URL]
    python tools/probe-font.py "http://127.0.0.1:4201/posts/dds-qos-tuning/index.html"

为什么需要它：font-family 列表里写了某个字体，不代表浏览器真的用它——
Chrome 对中日韩文字有「按脚本回退」的机制，列表里排在后面的中文字体可能永远轮不到。
CSS 层的 getComputedStyle 只能看到「请求了什么」，看不到「最终用了什么」。
CSS.getPlatformFontsForNode 是唯一能拿到真实结果的口子。

实现：手工实现最小 WebSocket 客户端（标准库没有），走 CDP 的 DOM + CSS 域。
"""
import base64
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
DEBUG_PORT = 9333

TARGETS = [
    ("正文段落", "p"),
    ("一级标题", "h1"),
    ("二级标题", ".prose h2"),
    ("行内代码", ".prose code"),
    ("代码块", ".prose pre"),
    ("导航", ".nav a"),
]


# ----------------------------------------------------------------- 最小 WS 客户端
class WS:
    def __init__(self, url: str):
        # ws://127.0.0.1:9333/devtools/page/XXXX
        rest = url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=20)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        if b"101" not in buf.split(b"\r\n")[0]:
            raise RuntimeError(f"WebSocket 握手失败: {buf[:120]!r}")
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
        self.mid = 0

    def _recv_exact(self, n: int) -> bytes:
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
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)
        return self.mid

    def recv(self) -> dict:
        while True:
            b0, b1 = self._recv_exact(2)
            opcode = b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._recv_exact(8))[0]
            data = self._recv_exact(length)
            if opcode == 0x8:
                raise RuntimeError("服务端关闭了连接")
            if opcode == 0x9:                      # ping -> pong
                continue
            if opcode in (0x1, 0x2):
                try:
                    return json.loads(data.decode("utf-8"))
                except Exception:
                    continue

    def call(self, method: str, params=None, timeout=20) -> dict:
        mid = self.send(method, params)
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self.recv()
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(msg["error"].get("message"))
                return msg.get("result", {})
        raise TimeoutError(method)


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4201/"
    # 每次全新 profile：复用 profile 时 Edge 会恢复上次的标签页，
    # /json 里就会出现多个 target，可能连到上一个页面上导致结果张冠李戴。
    import shutil
    import tempfile
    profile = tempfile.mkdtemp(prefix="edge-fontprobe-")
    proc = subprocess.Popen([
        EDGE, "--headless", "--disable-gpu", "--no-first-run",
        f"--remote-debugging-port={DEBUG_PORT}", f"--user-data-dir={profile}",
        "--window-size=1280,900", url,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ws = None
    try:
        target = None
        want = url.split("#")[0]
        for _ in range(40):
            time.sleep(0.4)
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{DEBUG_PORT}/json", timeout=3) as r:
                    pages = json.loads(r.read().decode())
                # 优先精确匹配请求的 URL，避免连到别的标签页
                cands = [p for p in pages
                         if p.get("type") == "page" and p.get("webSocketDebuggerUrl")]
                exact = [p for p in cands if p.get("url", "").split("#")[0] == want]
                target = (exact or cands or [None])[0]
                if target:
                    break
            except Exception:
                continue
        if not target:
            print("  连不上浏览器调试端口")
            return 1
        print(f"  已连接目标: {target.get('url')}")

        ws = WS(target["webSocketDebuggerUrl"])
        ws.call("DOM.enable")
        ws.call("CSS.enable")
        time.sleep(1.2)                       # 等字体加载完
        doc = ws.call("DOM.getDocument", {"depth": 1})

        print(f"  页面: {url}")
        print()
        print(f"  {'位置':<10}{'字号':>6}  {'实际使用的字体'}")
        print("  " + "-" * 74)
        for label, sel in TARGETS:
            try:
                node = ws.call("DOM.querySelector", {"nodeId": doc["root"]["nodeId"], "selector": sel})
            except Exception:
                continue
            nid = node.get("nodeId")
            if not nid:
                continue
            try:
                info = ws.call("CSS.getPlatformFontsForNode", {"nodeId": nid})
            except Exception as exc:
                print(f"  {label:<10} 查询失败: {exc}")
                continue
            fonts = info.get("fonts") or []
            if not fonts:
                print(f"  {label:<10}(无文本)")
                continue
            parts = [f"{f['familyName']}({f.get('glyphCount', '?')}字)" for f in fonts]
            # 取该节点的字号
            try:
                box = ws.call("CSS.getComputedStyleForNode", {"nodeId": nid})
                size = next((p["value"] for p in box.get("computedStyle", [])
                             if p["name"] == "font-size"), "?")
            except Exception:
                size = "?"
            print(f"  {label:<10}{size:>6}  {'  +  '.join(parts)}")
        return 0
    finally:
        if ws:
            try:
                ws.sock.close()
            except Exception:
                pass
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    os._exit(code)
