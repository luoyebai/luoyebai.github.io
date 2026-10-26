"""验证「可运行示例」是真的能跑，而不只是渲染出了按钮。

    python tools/probe-demo.py
    python tools/probe-demo.py "http://127.0.0.1:4201/posts/runnable-demos/index.html"

做法：用 CDP 打开文章页，逐个点「运行」，然后轮询每个面板的状态、
输出行数、沙箱 iframe 高度，并断言：
  - 状态变成「运行完成」（不是报错）
  - console 输出确实被回传上来
  - 有 DOM/canvas 输出的例子，iframe 高度大于 0
最后再点一次「重置」，确认能回到初始状态。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser, setup_stdout      # noqa: E402

setup_stdout()

URL = sys.argv[1] if len(sys.argv) > 1 else \
    "http://127.0.0.1:4201/posts/runnable-demos/index.html"

READ_STATE = """
JSON.stringify(Array.prototype.map.call(
  document.querySelectorAll('.demo[data-demo]'), function (d) {
    var f = d.querySelector('.demo-frame');
    return {
      lang: d.getAttribute('data-demo'),
      status: (d.querySelector('[data-demo-status]') || {}).textContent || '',
      lines: d.querySelectorAll('.demo-line').length,
      first: (d.querySelector('.demo-line') || {}).textContent || '',
      err: d.classList.contains('is-error'),
      running: d.classList.contains('is-running'),
      blocked: d.classList.contains('is-blocked'),
      frameH: f ? (parseInt(f.style.height, 10) || 0) : -1,
      hasFrame: !!f
    };
  }))
"""

fails = []


def check(name, cond, extra=""):
    print(("  OK   " if cond else "  FAIL ") + name + ("" if cond else f"   {extra}"))
    if not cond:
        fails.append(name)


def main() -> int:
    print(f"  页面: {URL}")
    shots = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_shots")
    os.makedirs(shots, exist_ok=True)

    def snap(b, name):
        try:
            b.call("Page.enable")
            r = b.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
            import base64
            with open(os.path.join(shots, name + ".png"), "wb") as fh:
                fh.write(base64.b64decode(r["data"]))
            return True
        except Exception as exc:
            print(f"  （截图 {name} 失败: {exc}）")
            return False

    with Browser(URL, port=9335, window="1440,1200") as b:
        b.call("Runtime.enable")

        n = b.evaluate("document.querySelectorAll('.demo[data-demo]').length")
        check("页面上有可运行面板", (n or 0) > 0, f"共 {n} 个")
        if not n:
            return 1

        before = b.evaluate(
            "document.querySelectorAll('.demo-frame').length")
        check("未点击时不创建沙箱 iframe（不自动执行）", before == 0, f"iframe={before}")
        snap(b, "demo-before")

        # 逐个点开
        b.evaluate("document.querySelectorAll('[data-demo-run]').forEach(function (x) { x.click(); });")

        deadline = time.time() + 30
        last = []
        while time.time() < deadline:
            time.sleep(0.6)
            last = b.evaluate(READ_STATE) or []
            last = __import__("json").loads(last) if isinstance(last, str) else last
            if last and all((not d["running"]) for d in last):
                break
        # 沙箱是按 400ms 间隔上报高度的，跑完后再等一会儿让高度稳定，
        # 否则会读到「刚跑完、高度还没上报」的中间态。
        time.sleep(1.6)
        settled = b.evaluate(READ_STATE) or []
        last = __import__("json").loads(settled) if isinstance(settled, str) else settled

        # 逐个滚进视口再读一遍：**屏幕外的跨源 iframe 会被限制定时器**，而沙箱
        # 就是靠定时器上报高度的，最后几个面板会停在"撑开前"的 28px。
        # 真实读者也是先看到面板再点运行，所以这里滚一遍不算放水。
        for idx in range(len(last)):
            b.evaluate("(function(){var d=document.querySelectorAll('.demo[data-demo]')[%d];"
                       "if(d) d.scrollIntoView({block:'center'});})()" % idx)
            time.sleep(0.45)
        time.sleep(1.5)
        settled = b.evaluate(READ_STATE) or []
        last = __import__("json").loads(settled) if isinstance(settled, str) else settled

        print()
        print(f"  {'#':<3}{'语言':<6}{'状态':<26}{'输出行':>6}{'沙箱高':>8}  首行输出")
        print("  " + "-" * 96)
        for i, d in enumerate(last, 1):
            st = d["status"][:24] or "(空)"
            print(f"  {i:<3}{d['lang']:<6}{st:<26}{d['lines']:>6}{d['frameH']:>8}  {d['first'][:40]}")
        print()

        check("全部面板都创建了沙箱 iframe",
              all(d["hasFrame"] for d in last), [d["hasFrame"] for d in last])
        snap(b, "demo-after")
        check("全部面板都跑完了（状态不是运行中）",
              all(not d["running"] for d in last), [d["status"] for d in last])
        check("没有面板报错",
              all(not d["err"] for d in last),
              [f"{i}:{d['status']}" for i, d in enumerate(last, 1) if d["err"]])
        check("状态显示为「运行完成」",
              all("完成" in d["status"] for d in last), [d["status"] for d in last])
        # 不是每个示例都会 `console.log`：后面几个是 `demo.root.innerHTML = …`，
        # 输出直接进 DOM（画布也画在沙箱里）。所以判"有没有输出"要看两样。
        check("每个面板都有输出（console 或 DOM/canvas）",
              all(d["lines"] > 0 or d["frameH"] > 40 for d in last),
              [(d["lines"], d["frameH"]) for d in last])
        check("有 DOM/canvas 输出的例子撑开了沙箱高度",
              any(d["frameH"] > 40 for d in last), [d["frameH"] for d in last])
        check("没有面板触发死循环提示",
              all(not d["blocked"] for d in last), [d["blocked"] for d in last])

        # 回归：曾经因为「沙箱报 documentElement.scrollHeight、父页面又 +2」
        # 形成正反馈，页面每 400ms 长 2px，被无限撑长。这里盯着它必须稳定下来。
        hs = []
        for _ in range(9):
            time.sleep(0.55)
            hs.append(b.evaluate("document.scrollingElement.scrollHeight"))
        tail = hs[-4:]
        check("运行后页面高度稳定（不会持续被撑长）",
              max(tail) - min(tail) <= 4, f"高度采样: {hs}")

        # 代码默认折叠，且能展开
        collapsed = b.evaluate(
            "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[data-demo-code]'),"
            "function (c) { return c.hidden; }))")
        cd = __import__("json").loads(collapsed) if collapsed else []
        check("源码默认折叠", all(cd), cd)
        b.evaluate("document.querySelector('[data-demo-toggle]').click();")
        time.sleep(0.3)
        expanded = b.evaluate(
            "document.querySelector('[data-demo-code]').hidden === false")
        label = b.evaluate(
            "(document.querySelector('[data-demo-toggle-label]') || {}).textContent")
        check("点「查看代码」能展开", expanded is True, expanded)
        check("展开后按钮文案变成「收起代码」", label == "收起代码", label)
        b.evaluate("document.querySelector('[data-demo-toggle]').click();")
        time.sleep(0.3)
        check("再点一次能收回",
              b.evaluate("document.querySelector('[data-demo-code]').hidden") is True)

        # 沙箱隔离：iframe 必须带 sandbox 且不含 allow-same-origin
        sandbox = b.evaluate(
            "JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.demo-frame'),"
            "function (f) { return f.getAttribute('sandbox'); }))")
        sb = __import__("json").loads(sandbox) if sandbox else []
        check("沙箱属性为 allow-scripts",
              all(s == "allow-scripts" for s in sb), sb)
        check("沙箱没有给 allow-same-origin（否则能读到站点数据）",
              all("allow-same-origin" not in (s or "") for s in sb), sb)

        # 从沙箱内部看：确认拿不到父页面
        probe = b.evaluate("""
        (function () {
          var f = document.querySelector('.demo-frame');
          if (!f) return 'no-frame';
          try {
            var d = f.contentDocument;
            return d ? 'LEAK: 能读到沙箱文档' : 'isolated: contentDocument 为 null';
          } catch (e) {
            return 'isolated: ' + e.name;
          }
        })()
        """)
        check("父页面读不到沙箱内容（跨源隔离生效）",
              isinstance(probe, str) and probe.startswith("isolated"), probe)

        # 重置
        b.evaluate("document.querySelectorAll('[data-demo-reset]').forEach(function (x) { x.click(); });")
        time.sleep(0.6)
        after = b.evaluate("""
        JSON.stringify({
          frames: document.querySelectorAll('.demo-frame').length,
          lines: document.querySelectorAll('.demo-line').length,
          stages: Array.prototype.filter.call(document.querySelectorAll('[data-demo-stage]'),
                   function (s) { return s.hidden; }).length
        })
        """)
        import json
        a = json.loads(after)
        check("重置后沙箱被移除", a["frames"] == 0, a)
        check("重置后输出被清空", a["lines"] == 0, a)
        check("重置后结果区收起", a["stages"] == len(last), a)

    print()
    if fails:
        print(f"!! {len(fails)} 项失败: {fails}")
        return 1
    print("可运行示例全部通过。")
    return 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    os._exit(code)
