"""打印全部主题的对比度校验与关键 token。"""
import json
import os
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import palette  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "site.config.json"), encoding="utf-8") as fh:
    cfg = json.load(fh)

bad = 0
for t in cfg["themes"]:
    d = palette.derive(t["seeds"])
    for mode in ("dark", "light"):
        for line in palette.report(t["id"], d[mode], mode):
            print(line)
            if "!!" in line:
                bad += 1
    print()

print(f"对比度问题数: {bad}")

if "--tokens" in sys.argv:
    print()
    for t in cfg["themes"][:1]:
        d = palette.derive(t["seeds"])
        for mode in ("dark", "light"):
            print(f"--- {t['id']} / {mode} ---")
            for k, v in d[mode].items():
                if k.startswith(("--bg", "--surface", "--text", "--accent", "--grad", "--tok")):
                    print(f"  {k:<20} {v}")
            print()
sys.exit(1 if bad else 0)
