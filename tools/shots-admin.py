"""后台界面截图（需要先运行 tools/admin.py）。

    python tools/shots-admin.py [--port 4200]
"""
import os
import shutil
import subprocess
import sys
import tempfile

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_shots")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

DOC = "/?open=post:dds-qos-tuning"
SHOTS = [
    ("admin-edit", DOC, "1600,1000"),
    ("admin-empty", "/", "1600,900"),
    ("admin-violet", DOC + "&atheme=violet", "1600,1000"),
    ("admin-ocean", DOC + "&atheme=ocean", "1600,1000"),
    ("admin-forest", DOC + "&atheme=forest", "1600,1000"),
    ("admin-rose", DOC + "&atheme=rose", "1600,1000"),
    ("admin-paper", DOC + "&atheme=paper", "1600,1000"),
    ("admin-site", "/?open=site&atheme=midnight", "1600,1100"),
    ("admin-site-paper", "/?open=site&atheme=paper", "1600,1100"),
    ("admin-themes", "/?open=themes&atheme=midnight", "1600,1200"),
    ("admin-themes-paper", "/?open=themes&atheme=paper", "1600,1200"),
]


def main() -> int:
    argv = sys.argv[1:]
    port = int(argv[argv.index("--port") + 1]) if "--port" in argv else 4200
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    os.makedirs(OUT, exist_ok=True)

    for name, path, size in SHOTS:
        if only and name not in only:
            continue
        out = os.path.join(OUT, name + ".png")
        if os.path.exists(out):
            os.remove(out)
        # 每张截图都用全新 profile：复用 profile 会让 Edge 缓存旧 JS，
        # 拍到「功能没生效」的假象（同一 profile 里第二次启动尤其容易命中）。
        profile = tempfile.mkdtemp(prefix="edge-shot-")
        try:
            cmd = [EDGE, "--headless", "--disable-gpu", "--hide-scrollbars",
                   "--no-first-run", "--no-default-browser-check",
                   f"--user-data-dir={profile}", f"--window-size={size}",
                   "--virtual-time-budget=9000", f"--screenshot={out}",
                   f"http://127.0.0.1:{port}{path}"]
            subprocess.run(cmd, capture_output=True, timeout=120)
        finally:
            shutil.rmtree(profile, ignore_errors=True)
        if os.path.exists(out):
            print(f"  {name:<18} {os.path.getsize(out)//1024:>6} KB")
        else:
            print(f"  {name:<18} 失败")

    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    raise SystemExit(main())
