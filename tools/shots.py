"""本地起服务并用 Edge 无头截图，用于视觉核对。仅开发时使用。

    python tools/shots.py [--only name,name]
"""
import functools
import http.server
import os
import socketserver
import subprocess
import sys
import threading

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
OUT = os.path.join(ROOT, "_shots")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 4188

SHOTS = [
    ("home-dark",   "/index.html",                        "1440,1600"),
    ("fontserif",    "/index.html?font=serif&motion=off", "1440,1200"),
    ("fontmono",     "/index.html?font=mono&motion=off",  "1440,1200"),
    ("postserif",    "/posts/dds-qos-tuning/index.html?font=serif&motion=off", "1440,1600"),
    ("home-video",  "/index.html?bgmode=video",           "1440,1600"),
    ("panel",        "/index.html?panel=1&motion=off",  "1440,1500"),
    ("panel-full",   "/index.html?panel=1&motion=off",  "1440,2600"),
    ("home-full",   "/index.html?motion=off",             "1440,3400"),
    ("home-light",  "/index.html?mode=light",             "1440,1600"),
    ("home-sakura", "/index.html?theme=sakura",           "1440,1600"),
    ("home-neon",   "/index.html?theme=neon",             "1440,1600"),
    ("home-mono",   "/index.html?theme=mono",             "1440,1600"),
    ("home-paper",  "/index.html?theme=paper&mode=light", "1440,1600"),
    ("home-cyber",  "/index.html?theme=cyber",            "1440,1600"),
    ("home-void",   "/index.html?theme=void",             "1440,1600"),
    ("home-alpine", "/index.html?theme=alpine&motion=off", "1440,1200"),
    ("home-moonlit", "/index.html?theme=moonlit&motion=off", "1440,1200"),
    ("home-comet", "/index.html?theme=comet&motion=off", "1440,1200"),
    ("home-lantern", "/index.html?theme=lantern&motion=off", "1440,1200"),
    ("home-sketch", "/index.html?theme=sketch&motion=off", "1440,1200"),
    ("home-manga", "/index.html?theme=manga&motion=off", "1440,1200"),
    ("home-lumen", "/index.html?theme=lumen&motion=off", "1440,1200"),
    ("post",        "/posts/dds-qos-tuning/index.html?motion=off",       "1440,2000"),
    ("post-2",      "/posts/quadruped-mpc-kinematics/index.html?motion=off", "1440,2000"),
    ("post-light",  "/posts/humanoid-0-to-1-toolchain/index.html?mode=light&motion=off", "1440,2000"),
    ("post-media",  "/posts/small-humanoid-consensus/index.html?motion=off", "1440,1500"),
    ("post-arch",   "/posts/legacy-gait-tuning/index.html?motion=off",   "1440,1500"),
    ("projects",    "/projects/index.html?motion=off",    "1440,1500"),
    ("tags",        "/tags/index.html?motion=off",        "1440,1200"),
    ("tag-detail",  "/tags/四足/index.html?motion=off",    "1440,1300"),
    ("archive",     "/archive/index.html?motion=off",     "1440,1300"),
    ("about",       "/about/index.html?motion=off",       "1440,1800"),
    ("notfound",    "/404.html?motion=off",               "1440,900"),
    ("notfound-live", "/404.html",                        "1440,900"),
    ("notfound-light", "/404.html?motion=off&mode=light",  "1440,900"),
    ("notfound-neon", "/404.html?motion=off&theme=neon",   "1440,900"),
    ("footer",      "/about/index.html?motion=off",       "1440,3400"),
]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main() -> int:
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    os.makedirs(OUT, exist_ok=True)

    handler = functools.partial(Quiet, directory=PUBLIC)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    print(f"  服务 http://127.0.0.1:{PORT}/")

    profile = os.path.join(os.environ.get("TEMP", "."), "edge-shots")
    failures = []
    try:
        for name, path, size in SHOTS:
            if only and name not in only:
                continue
            out = os.path.join(OUT, name + ".png")
            if os.path.exists(out):
                os.remove(out)
            cmd = [EDGE, "--headless", "--disable-gpu", "--hide-scrollbars",
                   "--no-first-run", "--no-default-browser-check",
                   f"--user-data-dir={profile}", f"--window-size={size}",
                   "--virtual-time-budget=6000", f"--screenshot={out}",
                   f"http://127.0.0.1:{PORT}{path}"]
            subprocess.run(cmd, capture_output=True, timeout=120)
            if os.path.exists(out):
                print(f"  {name:<13} {os.path.getsize(out)//1024:>6} KB")
            else:
                failures.append(name)
                print(f"  {name:<13} 失败")
    finally:
        httpd.shutdown()
        httpd.server_close()

    return 1 if failures else 0


if __name__ == "__main__":
    code = main()
    # 显式退出：避免残留的服务器 socket / 子进程句柄让进程挂着，
    # 进而占住 public/ 目录导致后续 --clean 失败。
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
