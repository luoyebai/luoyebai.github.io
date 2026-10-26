#!/usr/bin/env python3
"""公式渲染探针：确认文章里的 `$…$` / `$$…$$` 真的被 KaTeX 排出来了。

为什么值得单独测：公式**渲染失败不会报错**。KaTeX 没加载、或者定界符没被解析出来，
页面照常显示，只是把 `\\begin{bmatrix}` 这类源码原样摆在正文里 ——
而读者看到的是一屏乱码，构建和链接检查全都不会响。

这批从飞书迁过来的文档尤其容易踩：源文件的公式是**单个 `$` 跨好几行**的，
正则 `\\$([^$\\n]+?)\\$` 一条都匹配不上（见 tools/import-feishu.py 的 normalize_math）。

    python tools/probe-math.py
"""
import base64
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
SHOTS = os.path.join(ROOT, "_shots")
PORT = 4190
BASE = "http://127.0.0.1:%d" % PORT

# 每篇都应当至少出现这些数量的公式（0 表示只该「没有残留」，不要求有公式）
PAGES = [
    ("/posts/quadruped-mpc-kinematics/", 10),
    ("/posts/parallel-ankle-kinematics/", 20),
    ("/posts/cpp-python-code-style/", 1),
    ("/posts/cpp-toolchain/", 0),          # 没有公式，但代码里有 ${...} 生成器表达式
    ("/posts/humanoid-0-to-1-toolchain/", 0),
    ("/posts/small-humanoid-consensus/", 0),
    ("/posts/sam3-foundationpose-6d-pose/", 0),
    ("/posts/dds-qos-tuning/", 0),
]

CHECK = r"""
(function(){
  var p = document.querySelector('.prose');
  if (!p) return JSON.stringify({err:'没有 .prose'});
  /* 代码块里也会出现成对的 `$`（CMake 的 `${...}` 生成器表达式、
     shell 的 `$VAR`），先把 pre/code 摘掉再找残留，否则全是假阳性 */
  var clone = p.cloneNode(true);
  [].slice.call(clone.querySelectorAll('pre, code')).forEach(function(e){ e.remove(); });
  var txt = clone.innerText || '';
  return JSON.stringify({
    katex:  document.querySelectorAll('.prose .katex').length,
    blocks: document.querySelectorAll('.prose .math-block').length,
    inline: document.querySelectorAll('.prose .math-inline').length,
    /* 没渲染出来的公式会以 $…$ 或裸的 $$ 留在纯文本里 */
    rawDollar:    (txt.match(/\$[^\n$]{1,120}\$/g) || []).length,
    doubleDollar: (txt.match(/\$\$/g) || []).length,
    tex: [].slice.call(document.querySelectorAll('.prose .katex'))
           .filter(function(e){ return !e.querySelector('.katex-html'); }).length,
    chars: txt.length
  });
})()
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True


class QuietServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


def main() -> int:
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    os.makedirs(SHOTS, exist_ok=True)
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    lines, port, shot_done = [], 9800, False

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        return cond

    try:
        for path, want in PAGES:
            with cdp.Browser(BASE + path, port=port, window="1440,1000",
                             wait_load=2.8) as br:
                port += 1
                # 公式常常在页面下半部分，懒加载的 KaTeX 要滚到才会排
                br.evaluate("window.scrollTo(0,document.body.scrollHeight)")
                time.sleep(1.6)
                m = json.loads(br.evaluate(CHECK))
                if m.get("err"):
                    ok(False, "%s：%s" % (path, m["err"]))
                    continue
                ok(m["rawDollar"] == 0 and m["doubleDollar"] == 0,
                   "%s：没有漏出来的 $ 源码（%d / %d）"
                   % (path, m["rawDollar"], m["doubleDollar"]))
                ok(m["katex"] >= want,
                   "%s：渲染出 %d 个公式（期望 ≥ %d）" % (path, m["katex"], want))
                ok(m["blocks"] + m["inline"] == m["katex"] or m["katex"] == 0,
                   "%s：块级 %d + 行内 %d 与 katex 节点数一致（%d）"
                   % (path, m["blocks"], m["inline"], m["katex"]))
                # `.katex` 只有 `katex-mathml` 而没有 `katex-html` 时，
                # 说明 KaTeX 加载了但没跑完，页面上是空白的
                ok(m["tex"] == 0, "%s：没有停在半渲染状态的公式（%d）" % (path, m["tex"]))

                # ---- 复制 LaTeX ----
                # 不去读系统剪贴板（headless 下要权限、还不一定给），
                # 而是把 navigator.clipboard.writeText 换掉，看它到底收到了什么。
                # 顺便验证 KaTeX **没有把按钮吃掉** —— 它是 render(tex, el)，
                # 会替换元素内容，按钮一旦放进 .math-inline 里就会消失。
                cp = json.loads(br.evaluate("""
                (function(){
                  window.__copied = [];
                  try {
                    Object.defineProperty(navigator, 'clipboard', {
                      configurable: true,
                      value: { writeText: function(t){
                        window.__copied.push(t); return Promise.resolve(); } }
                    });
                  } catch (e) { return JSON.stringify({stub: false, err: '' + e}); }
                  var fig = document.querySelector('.math-figure > .math-copy');
                  var wrap = document.querySelector('.math-wrap > .math-copy');
                  if (fig) fig.click();
                  if (wrap) wrap.click();
                  return JSON.stringify({
                    stub: true,
                    figures: document.querySelectorAll('.math-figure').length,
                    wraps: document.querySelectorAll('.math-wrap').length,
                    btnInFig: !!fig, btnInWrap: !!wrap,
                    // 按钮有没有被 KaTeX 渲染冲掉
                    survived: document.querySelectorAll(
                      '.math-block > .math-copy, .math-inline > .math-copy').length,
                    tex: fig ? (fig.closest('.math-figure')
                                .querySelector('.math-block').getAttribute('data-tex') || '') : '',
                    copied: window.__copied,
                    done: document.querySelectorAll('.math-copy.is-done').length
                  });})()"""))
                if cp.get("stub") and (cp["figures"] or cp["wraps"]):
                    # 页面上有什么就测什么：cpp-python-code-style 只有 1 个行内公式、
                    # 没有块级，硬要求两个按钮都在会假红
                    ok(cp["btnInFig"] == (cp["figures"] > 0),
                       "%s：有块级公式就有块级复制按钮（%d 个）" % (path, cp["figures"]))
                    ok(cp["btnInWrap"] == (cp["wraps"] > 0),
                       "%s：有行内公式就有行内复制按钮（%d 个）" % (path, cp["wraps"]))
                    ok(cp["survived"] == 0,
                       "%s：复制按钮不在 KaTeX 会覆盖的元素里（被吃掉 %d 个）"
                       % (path, cp["survived"]))
                    want_n = (1 if cp["figures"] else 0) + (1 if cp["wraps"] else 0)
                    got = cp["copied"]
                    ok(len(got) == want_n,
                       "%s：点到的按钮都触发了复制（%d / %d）" % (path, len(got), want_n))
                    if cp["figures"] and got:
                        ok(got[0].startswith("$$") and got[0].rstrip().endswith("$$"),
                           "%s：块级公式复制成 $$…$$（%s）"
                           % (path, got[0].replace("\n", " ")[:34]))
                        ok(cp["tex"] and cp["tex"] in got[0],
                           "%s：复制的内容就是公式本体" % path)
                    if cp["wraps"] and got:
                        inline = got[-1]
                        ok(inline.startswith("$") and not inline.startswith("$$")
                           and inline.rstrip().endswith("$"),
                           "%s：行内公式复制成 $…$（%s）" % (path, inline[:34]))
                    # 「已复制」是写在 writeText().then() 里的，要等一个微任务才落地 ——
                    # 同一个 evaluate 里同步读会读不到（踩过）
                    time.sleep(0.4)
                    ok(br.evaluate(
                        "document.querySelectorAll('.math-copy.is-done').length") >= 1,
                       "%s：按钮给了「已复制」的反馈" % path)
                if not shot_done and m["katex"] > 20:
                    shot_done = True
                    # 坐标是**文档坐标**（scrollY + rect.top），不加 captureBeyondViewport
                    # 的话 CDP 按视口坐标解释，页面已经滚到底了，截出来是一张纯背景
                    png = br.call("Page.captureScreenshot", {
                        "format": "png", "captureBeyondViewport": True,
                        "clip": {"x": 0, "y": float(br.evaluate(
                            "document.querySelector('.prose .math-block')"
                            ".getBoundingClientRect().top+window.scrollY-40")),
                            "width": 1440, "height": 700, "scale": 1.3}})
                    out = os.path.join(SHOTS, "math-render.png")
                    with open(out, "wb") as fh:
                        fh.write(base64.b64decode(png["data"]))
                    lines.append("      截图 -> %s" % out)
    finally:
        httpd.shutdown()

    print("\n".join(lines))
    fails = [x for x in lines if x.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d"
          % (len([x for x in lines if x.startswith(("PASS", "FAIL"))]), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
