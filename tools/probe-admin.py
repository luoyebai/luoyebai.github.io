"""后台计算样式探针：报告指定选择器的实际 background/color/border。

    python tools/probe-admin.py --open site
    python tools/probe-admin.py --open themes --sel "[data-theme-id=alpine]"

用于排查「样式没生效」这类问题：直接读浏览器算出来的值，而不是猜 CSS。

实现要点：探针页必须与后台**同源**，否则 iframe 的 contentDocument 读不到。
所以临时代码写进 theme/admin/ 下，通过后台自己的 /admin/ 路径访问，用完即删。
"""
import os
import re
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN_DIR = os.path.join(ROOT, "theme", "admin")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
ADMIN_PORT = 4200

DEFAULT_SELECTORS = [
    "[data-site=title]", "[data-site=description]", "[data-stat=value]",
    "[data-social=label]", ".side-head input", ".btn.primary", ".btn",
    ".doc.is-on", ".modal-panel", ".theme-menu", ".theme-card",
]

PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>admin-probe</title>
<style>html,body{margin:0;background:#111}
iframe{width:1560px;height:1040px;border:0}</style></head><body>
<iframe id="f" src="__URL__"></iframe><pre id="out">running…</pre>
<script>
var SELECTORS = __SELS__;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
document.getElementById('f').addEventListener('load', function () {
  setTimeout(function () {
    try {
      var fr = document.getElementById('f');
      var d = fr.contentDocument, w = fr.contentWindow;
      if (!d) { document.getElementById('out').textContent = '拿不到 contentDocument'; return; }
      var L = [];
      var html = w.getComputedStyle(d.documentElement);
      L.push('html data-admin-theme = ' + d.documentElement.getAttribute('data-admin-theme'));
      L.push('html color-scheme      = ' + (html.colorScheme || '(未设置)'));
      L.push('body background-color  = ' + w.getComputedStyle(d.body).backgroundColor);
      L.push('CSS 变量 --surface     = ' + html.getPropertyValue('--surface').trim());
      L.push('CSS 变量 --bg-2        = ' + html.getPropertyValue('--bg-2').trim());
      L.push('');
      L.push(pad('选择器', 40) + '  ' + pad('背景', 22) + pad('文字', 22) + '边框');
      L.push(new Array(112).join('-'));
      SELECTORS.forEach(function (sel) {
        var el;
        try { el = d.querySelector(sel); } catch (e) { L.push(sel + '  [选择器非法]'); return; }
        if (!el) { L.push(pad(sel, 40) + '  (页面上不存在)'); return; }
        var cs = w.getComputedStyle(el);
        L.push(pad(sel, 40) + '  ' + pad(cs.backgroundColor, 22) + pad(cs.color, 22) + cs.borderTopColor);
      });
      document.getElementById('out').textContent = L.join('\n');
    } catch (err) {
      document.getElementById('out').textContent = '探测异常: ' + err.message;
    }
  }, 1600);
});
</script></body></html>
"""


def main() -> int:
    argv = sys.argv[1:]
    open_what = "site"
    if "--open" in argv:
        open_what = argv[argv.index("--open") + 1]
    theme = "midnight"
    if "--atheme" in argv:
        theme = argv[argv.index("--atheme") + 1]
    sels = [argv[i + 1] for i, a in enumerate(argv) if a == "--sel"] or DEFAULT_SELECTORS

    inner = f"/?open={open_what}&atheme={theme}"
    page = (PAGE.replace("__URL__", inner)
                .replace("__SELS__", "[" + ",".join('"' + s.replace('"', '\\"') + '"' for s in sels) + "]"))
    path = os.path.join(ADMIN_DIR, "_probe.html")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(page)
    try:
        r = subprocess.run([
            EDGE, "--headless", "--disable-gpu", "--no-first-run",
            "--user-data-dir=" + os.path.join(os.environ.get("TEMP", "."), "edge-adminprobe"),
            "--window-size=1560,1100", "--virtual-time-budget=12000", "--dump-dom",
            f"http://127.0.0.1:{ADMIN_PORT}/admin/_probe.html",
        ], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=240)
    finally:
        if os.path.exists(path):
            os.remove(path)

    m = re.search(r'<pre id="out">(.*?)</pre>', r.stdout or "", re.S)
    if not m:
        print("未取到报告：")
        print((r.stdout or "")[:1000])
        return 1
    print(f"URL: http://127.0.0.1:{ADMIN_PORT}{inner}")
    print(m.group(1).replace("&lt;", "<").replace("&gt;", ">")
          .replace("&amp;", "&").replace("&quot;", '"'))
    return 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    os._exit(code)

