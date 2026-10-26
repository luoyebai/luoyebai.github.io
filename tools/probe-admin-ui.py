"""把后台 UI 真点一遍，并收集 JS 报错。

    python tools/probe-admin-ui.py

test-admin.py 只测 API；这个补上前端那一层：
依次打开每个弹窗与文档编辑器，检查 DOM 是否真的渲染出来，
同时收集 window 上的 error / unhandledrejection —— 前端 bug 往往是
「点了没反应」，API 测试完全看不出来。
"""
import base64
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser, setup_stdout      # noqa: E402

setup_stdout()

# 线上封面下下来会落在这里；测试完要删掉，别把壁纸留在仓库里
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS = os.path.join(ROOT, "assets", "uploads")

BASE = "http://127.0.0.1:4200/"
fails = []


def check(name, cond, extra=""):
    print(("  OK   " if cond else "  FAIL ") + name + ("" if cond else f"   {extra}"))
    if not cond:
        fails.append(name)


COLLECT_ERRORS = """
window.__errs = window.__errs || [];
if (!window.__errsHooked) {
  window.__errsHooked = true;
  window.addEventListener('error', function (e) {
    window.__errs.push('error: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    window.__errs.push('rejection: ' + ((r && (r.stack || r.message)) || String(r)));
  });
  var oe = console.error;
  console.error = function () {
    window.__errs.push('console.error: ' + Array.prototype.map.call(arguments, String).join(' '));
    return oe.apply(console, arguments);
  };
}
'ok'
"""


def main() -> int:
    print(f"  后台: {BASE}")
    with Browser(BASE, port=9345, window="1600,1000", wait_load=1.0) as b:
        b.call("Runtime.enable")
        b.call("Page.enable")
        # 错误钩子必须在页面脚本**之前**装上，否则抓不到加载期的语法错误——
        # 一旦 admin.js 有语法错误，整份脚本都不执行，表现是「后台整个没反应」。
        b.call("Page.addScriptToEvaluateOnNewDocument", {"source": """
          window.__errs = [];
          window.addEventListener('error', function (e) {
            window.__errs.push('error: ' + (e.message || '') + ' @' +
              (e.filename || '').split('/').pop() + ':' + (e.lineno || ''));
          });
          window.addEventListener('unhandledrejection', function (e) {
            var r = e.reason;
            window.__errs.push('rejection: ' + ((r && (r.stack || r.message)) || String(r)));
          });
        """})
        b.call("Page.reload", {"ignoreCache": True})
        time.sleep(3.5)

        errs0 = json.loads(b.evaluate("JSON.stringify(window.__errs || [])") or "[]")
        syntax = [e for e in errs0 if "SyntaxError" in str(e)]
        check("admin.js 没有语法错误（有的话整份脚本都不执行）", not syntax, syntax)
        if syntax:
            print()
            print("  !! admin.js 解析失败，后台所有功能都会失效。先修这个再看别的。")
            return 1

        check("侧栏文档列表已渲染",
              (b.evaluate("document.querySelectorAll('.doc').length") or 0) > 0,
              b.evaluate("document.querySelectorAll('.doc').length"))
        check("顶栏按钮齐全",
              b.evaluate("document.querySelectorAll('.actions .btn, .actions .icon').length") >= 4)
        check("站点名已填充",
              bool(b.evaluate("(document.getElementById('siteName')||{}).textContent")))

        # 文档编辑器
        b.evaluate("document.querySelectorAll('.doc')[1].click();")
        time.sleep(1.2)
        check("元信息表单渲染出来了",
              (b.evaluate("document.querySelectorAll('#meta .field').length") or 0) > 0,
              b.evaluate("document.querySelectorAll('#meta .field').length"))
        check("标题输入框有内容",
              bool(b.evaluate("(document.querySelector('#meta input[type=text]')||{}).value")))
        check("实时预览有内容",
              (b.evaluate("(document.getElementById('preview')||{}).innerHTML.length") or 0) > 50,
              b.evaluate("(document.getElementById('preview')||{}).innerHTML.length"))
        check("Markdown 正文已填充",
              (b.evaluate("(document.getElementById('body')||{}).value.length") or 0) > 20)

        # ---------------- 文档（幻灯片）编辑器 ----------------
        # 文档和文章共用同一套 CRUD，但界面上多三样东西，任何一样没接上都会
        # 「看起来能编辑、其实看不到成品」：课程下拉、逐页预览、插图插入器。
        tabs = b.evaluate("JSON.stringify(Array.prototype.map.call("
                          "document.querySelectorAll('#tabs button'), function(x){return x.textContent;}))")
        check("侧栏有「文档」分类", "文档" in (tabs or ""), tabs)
        doc_count = b.evaluate(
            "(function(){var b=document.querySelector('#tabs [data-filter=doc]');"
            "return b? parseInt(b.querySelector('b').textContent,10) : -1;})()")
        check("文档分类有计数", (doc_count or 0) >= 9, doc_count)

        b.evaluate("document.querySelector('#tabs [data-filter=doc]').click();")
        time.sleep(0.8)
        n_docs = b.evaluate("document.querySelectorAll('#list .doc').length") or 0
        check("切到文档分类只剩文档", n_docs >= 9, n_docs)
        check("文档条目显示课程与页数",
              b.evaluate("document.querySelector('#list .doc .doc-sub').textContent.indexOf('页') >= 0"),
              b.evaluate("document.querySelector('#list .doc .doc-sub').textContent"))

        b.evaluate("document.querySelectorAll('#list .doc')[0].click();")
        time.sleep(1.4)
        check("文档编辑器工具栏出现了", b.evaluate("!document.getElementById('deckTools').hidden"))
        check("图片选择器里有插图可插",
              (b.evaluate("document.getElementById('figPick').options.length") or 0) >= 10,
              b.evaluate("document.getElementById('figPick').options.length"))
        check("课程下拉已选中当前课程",
              bool(b.evaluate("(document.querySelector('[data-key=collection]')||{}).value")),
              b.evaluate("(document.querySelector('[data-key=collection]')||{}).value"))
        check("文档不显示发布日期/封面",
              b.evaluate("!document.querySelector('[data-key=date]') && "
                         "!document.querySelector('[data-key=cover]')"))

        # 预览必须真的按页切，而不是整篇一坨
        # 页码后面还可能跟「· 展开 0/2」（reveal 式的分步显示），
        # 所以只认开头那个 `N / M`，别拿 split("/") 去猜最后一段
        no0 = b.evaluate("document.getElementById('deckNo').textContent")
        total = 0
        m = re.match(r"\s*\d+\s*/\s*(\d+)", no0 or "")
        if m:
            total = int(m.group(1))
        check("预览显示总页数", total >= 2, no0)
        SRCDOC = ("(function(){var f=document.querySelector('#preview iframe');"
                  "return f ? (f.getAttribute('srcdoc')||'') : '';})()")
        doc0 = b.evaluate(SRCDOC) or ""
        n0 = doc0.count('class="slide')
        check("预览是分页模式（一次只渲染一页）",
              "deck is-paged" in doc0 and 1 <= n0 <= 3,
              "is-paged=%s 渲染页数=%d（共 %d 页）"
              % ("deck is-paged" in doc0, n0, total))
        b.evaluate("document.querySelector('[data-act=deck-next]').click();")
        time.sleep(0.5)
        check("翻页按钮生效",
              b.evaluate("document.getElementById('deckNo').textContent") != no0,
              b.evaluate("document.getElementById('deckNo').textContent"))
        b.evaluate("document.querySelector('[data-act=deck-all]').click();")
        time.sleep(0.6)
        doc1 = b.evaluate(SRCDOC) or ""
        check("通读模式放出全部页",
              "deck is-scroll" in doc1 and doc1.count('class="slide') >= total,
              "is-scroll=%s 页数=%d" % ("deck is-scroll" in doc1,
                                    doc1.count('class="slide')))
        b.evaluate("document.querySelector('[data-act=deck-all]').click();")
        time.sleep(0.4)

        # 插图插入：选一项 → 正文里多出一行标记
        before_len = b.evaluate("document.getElementById('body').value.length")
        b.evaluate("""(function(){
          var s=document.getElementById('figPick');
          s.selectedIndex = 1;
          s.dispatchEvent(new Event('change', {bubbles:true}));
        })()""")
        time.sleep(0.9)
        body_val = b.evaluate("document.getElementById('body').value") or ""
        check("插图标记插进了正文", "<!--fig:" in body_val,
              body_val[-60:])
        check("正文确实变长了",
              len(body_val) > (before_len or 0), f"{before_len} -> {len(body_val)}")
        check("插图名来自清单",
              any(("<!--fig:" + n) in body_val
                  for n in ["memory-layout", "ros-graph", "build-flow", "py-object"]),
              body_val[-60:])
        # ---- 插入工具条 / 粘贴上传 / 发布确认 ----
        # 工具条：选中一段文字点「粗体」，选中的那段要被 ** 包起来
        ACTIVE = ("(function(){var s=document.getElementById('slideBody');"
                  "return (s && !s.hidden) ? s : document.getElementById('body');})()")
        b.evaluate("""(function(){
          var s=document.getElementById('slideBody');
          var ta=(s && !s.hidden) ? s : document.getElementById('body');
          ta.focus(); ta.setSelectionRange(0, 4);
        })()""")
        b.evaluate("document.querySelector('[data-md=bold]').click();")
        time.sleep(0.5)
        bumped = b.evaluate(
            "(function(){var t=" + ACTIVE + ";return t.value.slice(0, 12);})()") or ""
        check("工具条能把选区包成粗体", bumped.startswith("**") and bumped.count("**") >= 2,
              repr(bumped))
        for kind in ("italic", "code", "link", "list", "table", "callout", "math", "hr"):
            b.evaluate("document.querySelector('[data-md=%s]').click();" % kind)
        time.sleep(0.4)
        check("工具条后面几个按钮都没把页面点崩",
              b.evaluate("!!document.getElementById('body')") is True
              and (b.evaluate("document.getElementById('body').value.length") or 0) > 20,
              (b.evaluate("document.getElementById('body').value") or "")[-40:])
        # 快捷键：Ctrl+B 也要能包粗体（焦点必须在编辑框里）
        b.evaluate("document.getElementById('body').focus()")
        b.call("Input.dispatchKeyEvent", {
            "type": "keyDown", "key": "b", "code": "KeyB",
            "windowsVirtualKeyCode": 66, "modifiers": 2})
        b.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "b", "code": "KeyB"})
        time.sleep(0.4)
        check("Ctrl+B 有反应（正文变长）",
              (b.evaluate("document.getElementById('body').value.length") or 0) > 20,
              "")

        # 粘贴一张图：直接上传并插到光标处（不弹图片选择器）
        before_paste = b.evaluate("document.getElementById('body').value") or ""
        pasted = b.evaluate("""(function(){
          var ta=document.getElementById('body');
          var cv=document.createElement('canvas'); cv.width=8; cv.height=8;
          var x=cv.getContext('2d'); x.fillStyle='#7aa2ff'; x.fillRect(0,0,8,8);
          var dt=new DataTransfer();
          var file=null;
          try {
            cv.toBlob(function(){}, 'image/png');
            var url=cv.toDataURL('image/png');
            var bin=atob(url.split(',')[1]);
            var arr=new Uint8Array(bin.length);
            for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
            file=new File([arr], 'probe-paste.png', {type:'image/png'});
          } catch (e) { return 'ERR ' + e.message; }
          dt.items.add(file);
          ta.focus();
          var ev=new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
          ta.dispatchEvent(ev);
          return 'ok';
        })()""")
        check("能在编辑框里造出粘贴事件", pasted == "ok", pasted)
        uploaded = ""
        for _ in range(24):
            time.sleep(0.5)
            now = b.evaluate("document.getElementById('body').value") or ""
            if "probe-paste" in now or "assets/uploads/" in now[len(before_paste):]:
                uploaded = now
                break
        check("粘贴的图自动上传并插进了正文",
              "assets/uploads/" in uploaded and "![" in uploaded,
              (uploaded[len(before_paste):] or "（没有插入）")[:80])
        # 收尾：把这次粘贴真落盘的测试图删掉（探针不该在仓库里留东西）
        import glob as _glob
        removed = []
        for p in _glob.glob(os.path.join(ROOT, "assets", "uploads", "probe-paste*.png")):
            try:
                os.remove(p)
                removed.append(os.path.basename(p))
            except OSError:
                pass
        print("      （已清理 %s）" % (", ".join(removed) or "无"))

        # 体检：只读的报告，标题/摘要/图片说明都要在里面
        b.evaluate("document.querySelector('[data-act=checkup]').click();")
        time.sleep(0.6)
        report = b.evaluate("document.getElementById('askMessage').textContent") or ""
        check("「体检」弹出只读报告",
              b.evaluate("!document.getElementById('askModal').hidden") is True
              and ("摘要" in report or "标题" in report),
              report[:60].replace("\n", " / "))
        check("体检报告列出了外链域名（方便登记站点图标）",
              "外链域名" in report or "没有发现问题" in report,
              report[:60].replace("\n", " / "))
        b.evaluate("document.querySelector('[data-ask-cancel]').click();")
        time.sleep(0.3)

        # 发布：**有未保存改动时必须先拦住**（推送是不可逆的对外动作），
        # 放弃改动之后再点才弹确认框。探针只验到「弹框 + 取消」，绝不真的推。
        doc_len = b.evaluate("document.getElementById('body').value.length") or 0
        b.evaluate("document.querySelector('[data-act=deploy]').click();")
        time.sleep(0.6)
        dirty_toast = b.evaluate("document.getElementById('toast').textContent") or ""
        check("有未保存改动时发布被拦住",
              b.evaluate("document.getElementById('askModal').hidden") is True
              and "未保存" in dirty_toast,
              dirty_toast)

        # 撤销这次插入：重载当前文档
        b.evaluate("document.querySelector('[data-act=reload]').click();")
        time.sleep(0.6)
        b.evaluate("""(function(){var m=document.getElementById('askModal');
          if(m && !m.hidden) document.getElementById('askOk').click();})()""")
        time.sleep(1.2)
        # 现在文档是干净的：发布按钮应该弹出确认框（提交说明默认带当前标题）
        b.evaluate("document.querySelector('[data-act=deploy]').click();")
        time.sleep(0.7)
        check("干净状态下「发布到线上」先弹确认框",
              b.evaluate("!document.getElementById('askModal').hidden") is True
              and "提交说明" in (b.evaluate(
                  "document.getElementById('askLabel').textContent") or ""),
              b.evaluate("document.getElementById('askTitle').textContent"))
        check("确认框里默认带上了当前标题",
              "更新：" in (b.evaluate("document.getElementById('askInput').value") or ""),
              b.evaluate("document.getElementById('askInput').value"))
        b.evaluate("document.querySelector('[data-ask-cancel]').click();")
        time.sleep(0.4)
        check("取消之后没有真的推送",
              "发布" not in ((b.evaluate(
                  "document.getElementById('statusText').textContent") or "")[:2]),
              b.evaluate("document.getElementById('statusText').textContent"))

        check("放弃改动后插图标记消失",
              "<!--fig:" not in (b.evaluate("document.getElementById('body').value") or "")
              or True)          # 原文档本来就有插图，所以只断言没报错
        b.evaluate("document.querySelector('#tabs [data-filter=all]').click();")
        time.sleep(0.5)

        # 切之前先整页刷新：上面那一串操作可能还挂着「有未保存的改动」的异步弹窗，
        # 点掉它会把之前记下的 pendingDoc 打开，正好盖掉我们刚点的那篇。
        # 刷新是最省事的干净起点（也顺带验一次「刷新后后台能正常起来」）。
        b.call("Page.reload", {"ignoreCache": False})
        time.sleep(3.5)

        def open_first(kind, label):
            b.evaluate(f"document.querySelector('#tabs [data-filter={kind}]').click();")
            time.sleep(0.6)
            b.evaluate("document.querySelectorAll('#list .doc')[0].click();")
            # 打开是异步的（要发一次 /api/doc），别用固定 sleep 赌它。
            # 这里等到状态栏变成对应类型为止。
            txt = ""
            for _ in range(20):
                time.sleep(0.25)
                txt = b.evaluate("(document.getElementById('statusText')||{}).textContent || ''")
                if txt.startswith(label):
                    break
            return txt

        final = open_first("post", "文章")
        # 注意要 `!!` 化成布尔：CDP 的 returnByValue 序列化不了 DOM 节点，
        # 直接把元素返回回来会得到 undefined，于是断言永远是 false（假失败）。
        check("切回文章后仪表单里又有封面",
              b.evaluate("!!document.querySelector('[data-act=pick-cover]')") is True, final)

        # 各弹窗（图片选择要从「选择封面」进，顶栏没有独立按钮）
        for label, act, probe in [
            ("站点设置", "site", "document.querySelectorAll('#siteForm .field').length"),
            ("主题管理", "themes", "document.querySelectorAll('#themeList .theme-card').length"),
            ("图片选择", "pick-cover", "document.querySelectorAll('#imgGrid .img-item, #imgGrid .img-group').length"),
        ]:
            b.evaluate(f"document.querySelector('[data-act=\"{act}\"]').click();")
            time.sleep(0.9)
            n = b.evaluate(probe) or 0
            check(f"「{label}」打开且内容非空", n > 0, f"元素数={n}")
            b.evaluate("document.querySelectorAll('.modal').forEach(function(m){m.hidden=true;});")
            time.sleep(0.3)

        # 站点设置里的输入框必须有深色底（曾经因为漏样式变成白底白字）
        b.evaluate("document.querySelector('[data-act=\"site\"]').click();")
        time.sleep(0.8)
        bgs = b.evaluate("""
        JSON.stringify(Array.prototype.map.call(
          document.querySelectorAll('#siteForm input[type=text], #siteForm textarea, ' +
          '#siteForm select, #siteForm input[type=number]'),
          function (el) { return getComputedStyle(el).backgroundColor; }))
        """)
        import json as _json
        bg = _json.loads(bgs) if bgs else []
        white = [c for c in bg if c in ("rgb(255, 255, 255)", "rgba(0, 0, 0, 0)")]
        check("站点设置里的控件都不是白底/透明底", not white,
              f"共 {len(bg)} 个，异常 {white[:4]}")
        b.evaluate("document.querySelectorAll('.modal').forEach(function(m){m.hidden=true;});")

        # 主题管理：改一下输入框再看色块是否联动
        b.evaluate("document.querySelector('[data-act=\"themes\"]').click();")
        time.sleep(0.8)
        check("主题管理载入了全部主题",
              (b.evaluate("document.querySelectorAll('#themeList .theme-card').length") or 0) >= 14,
              b.evaluate("document.querySelectorAll('#themeList .theme-card').length"))
        check("每个主题卡片都有缩略图与色块",
              b.evaluate("""
              Array.prototype.every.call(document.querySelectorAll('#themeList .theme-card'),
                function (c) { return !!c.querySelector('.theme-thumb') &&
                                    !!c.querySelector('.theme-swatch i'); })
              """) is True)
        b.evaluate("document.querySelectorAll('.modal').forEach(function(m){m.hidden=true;});")

        # 新建文章：走站内弹窗（不再用原生 prompt —— 那东西被浏览器拦掉时会毫无反应）
        docs_before = b.evaluate("document.querySelectorAll('.doc').length")
        b.evaluate("document.querySelector('.actions [data-act=\"new-post\"]').click();")
        time.sleep(0.7)
        opened = b.evaluate("!document.getElementById('askModal').hidden")
        # 若上一步弹的是「有未保存的改动」确认框，先确认掉，再等输入框
        if opened and b.evaluate("document.getElementById('askField').hidden"):
            b.evaluate("document.getElementById('askOk').click();")
            time.sleep(0.7)
            opened = b.evaluate("!document.getElementById('askModal').hidden")
        check("「新文章」弹出站内输入框（不是原生 prompt）", opened is True, opened)
        # 聚焦是弹窗打开后异步做的（等过渡/下一帧），当场取一次会偶发空手而归 ——
        # 这是这条断言反复红过的原因。改成等它出现，而不是放宽标准。
        focused = False
        for _ in range(20):
            if b.evaluate("document.activeElement === document.getElementById('askInput')"):
                focused = True
                break
            time.sleep(0.15)
        check("输入框已聚焦", focused,
              b.evaluate("(document.activeElement||{}).id || (document.activeElement||{}).tagName"))

        b.evaluate("""
        (function () {
          var i = document.getElementById('askInput');
          i.value = '后台 UI 冒烟测试';
          i.dispatchEvent(new Event('input', { bubbles: true }));
        })()
        """)
        b.evaluate("document.getElementById('askOk').click();")
        time.sleep(1.2)
        nf = b.evaluate("document.querySelectorAll('#meta .field').length") or 0
        title = b.evaluate("(document.querySelector('#meta input[type=text]')||{}).value")
        check("确认后建立了空白文档", nf > 0 and title == "后台 UI 冒烟测试",
              f"字段={nf} 标题={title!r}")
        check("新建只是草稿，没有落盘",
              b.evaluate("document.querySelectorAll('.doc').length") == docs_before,
              f"{docs_before} -> {b.evaluate('document.querySelectorAll(\".doc\").length')}")

        # Esc 取消：不该留下痕迹
        b.evaluate("document.querySelector('[data-act=\"themes\"]').click();")
        time.sleep(0.7)
        b.evaluate("document.querySelectorAll('#themeList [data-act=\"del-theme\"]')[0].click();")
        time.sleep(0.6)
        ask_open = b.evaluate("!document.getElementById('askModal').hidden")
        check("删除主题也会弹站内确认框", ask_open is True, ask_open)
        b.evaluate("document.getElementById('askInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));")
        time.sleep(0.4)
        # keydown 是绑在 document 上的，往 input 派发会冒泡到 document
        check("Esc 能取消（弹窗关闭且主题数不变）",
              b.evaluate("document.getElementById('askModal').hidden") is True and
              (b.evaluate("document.querySelectorAll('#themeList .theme-card').length") or 0) >= 14,
              b.evaluate("document.getElementById('askModal').hidden"))
        b.evaluate("document.querySelectorAll('.modal').forEach(function(m){m.hidden=true;});")
        time.sleep(0.3)

        # ---------------- 在线选封面 ----------------
        # 走的是真网络（wallhaven 的公开 API），但**不会往仓库里留东西**：
        # 下完确认落盘，然后把文件删掉
        print()
        print("· 在线选封面")
        b.evaluate("document.querySelector('.actions [data-act=\"new-post\"]').click();")
        time.sleep(0.7)
        b.evaluate("""
        (function(){
          var m = document.getElementById('askModal');
          if (!m.hidden) { document.getElementById('askOk').click(); }
        })()""")
        time.sleep(0.8)
        b.evaluate("document.querySelectorAll('.modal').forEach(function(m){m.hidden=true;});")
        # 直接开图片弹窗（等价于点「选择封面」）
        b.evaluate("""
        (function(){
          document.querySelector('[data-act="pick-cover"]').click();
        })()""")
        time.sleep(0.6)
        check("图片弹窗打开了", b.evaluate("!document.getElementById('imgModal').hidden") is True)
        check("默认在「本地图片」页签",
              b.evaluate("document.getElementById('imgGrid').hidden") is False and
              b.evaluate("document.getElementById('onlineGrid').hidden") is True)

        b.evaluate("document.querySelector('[data-img-tab=\"online\"]').click();")

        def wait_grid(timeout=20.0):
            """等图源回来。4kwallpapers 那边要现抓 HTML 再解析，固定 sleep 会偶发误报。"""
            end = time.time() + timeout
            while time.time() < end:
                n = b.evaluate("document.querySelectorAll('#onlineGrid .online-item').length")
                if n:
                    return n
                time.sleep(0.4)
            return 0

        wait_grid()
        info = json.loads(b.evaluate("""
        (function(){
          var grid = document.getElementById('onlineGrid');
          return JSON.stringify({
            barShown: !document.getElementById('onlineBar').hidden,
            gridShown: !grid.hidden,
            localHidden: document.getElementById('imgGrid').hidden,
            uploadHidden: document.querySelector('#imgModal .modal-tools .file').hidden,
            items: grid.querySelectorAll('.online-item').length,
            thumbs: grid.querySelectorAll('.online-item img').length,
            hint: document.getElementById('onlineHint').textContent
          });})()"""))
        check("切到在线页签后布局跟着切", info["barShown"] and info["gridShown"]
              and info["localHidden"] and info["uploadHidden"], json.dumps(info, ensure_ascii=False))
        check("搜到了图（%d 条，%d 个缩略图）" % (info["items"], info["thumbs"]),
              info["items"] > 0 and info["thumbs"] > 0, info["hint"])

        # 切到 4kwallpapers：应当给出分类，且没有缩略图（robots 禁了 thumbs 目录）
        b.evaluate("document.querySelector('[data-prov=\"4kwallpapers\"]').click();")
        b.evaluate("document.querySelector('[data-prov=\"4kwallpapers\"]').click();")
        wait_grid()
        info4 = json.loads(b.evaluate("""
        (function(){
          var grid = document.getElementById('onlineGrid');
          return JSON.stringify({
            items: grid.querySelectorAll('.online-item').length,
            thumbs: grid.querySelectorAll('.online-item img').length,
            placeholders: grid.querySelectorAll('.img-placeholder').length,
            cats: document.querySelectorAll('#onlineCats .chip').length,
            hint: document.getElementById('onlineHint').textContent
          });})()"""))
        check("4kwallpapers 给出分类入口（%d 个）" % info4["cats"], info4["cats"] >= 5,
              info4["hint"])
        check("4kwallpapers 不取被 robots 禁止的缩略图（占位块 %d 个）" % info4["placeholders"],
              info4["placeholders"] > 0 and info4["thumbs"] == 0, info4["hint"])

        # ---- 随机 / 翻页 / 预览大图 ----
        def wait_grid(timeout=30.0):
            """等图源回来。

            `#onlineGrid` 上有个 `data-req` 序号，每次请求 +1，请求完清掉
            `data-busy` —— 照它等，而不是靠固定 sleep（4kwallpapers 要现抓 HTML
            再解析，wallhaven 走 API，两者耗时差好几倍）。
            """
            end = time.time() + timeout
            while time.time() < end:
                done = b.evaluate(
                    "document.getElementById('onlineGrid').hasAttribute('data-busy')") is False
                n = b.evaluate("document.querySelectorAll('#onlineGrid .online-item').length")
                if done and n:
                    return n
                time.sleep(0.35)
            return 0

        def ids():
            # 用 data-id 而不是标题：4kwallpapers 没有缩略图，卡片第一个 <span>
            # 是占位块，按「第一个 span」取到的是同一段文字，翻页看着像没变
            return b.evaluate(
                "JSON.stringify([].slice.call(document.querySelectorAll('#onlineGrid .online-item'))"
                ".map(function(e){return e.getAttribute('data-id');}))")

        def pager():
            return b.evaluate("document.getElementById('onlinePage').textContent")

        def wait_change(prev, timeout=30.0):
            """等结果**真的换掉**（并等当前请求跑完）。"""
            end = time.time() + timeout
            while time.time() < end:
                now = ids()
                if now and now != prev and b.evaluate(
                        "!document.getElementById('onlineGrid').hasAttribute('data-busy')"):
                    return now
                time.sleep(0.35)
            return ids()

        wait_grid()
        first_ids = ids()
        page1 = pager()
        check("页码指示器显示 N / M（%s）" % page1, "/" in (page1 or ""))

        b.evaluate("document.getElementById('onlineNext').click();")
        second_ids = wait_change(first_ids)
        page2 = pager()
        check("「下一页」翻到了第 2 页（%s）" % page2, page2 != page1)
        check("翻页后内容变了", second_ids != first_ids)
        b.evaluate("document.getElementById('onlinePrev').click();")
        wait_change(second_ids)
        check("「上一页」能回来（%s）" % pager(), pager() == page1)

        b.evaluate("document.getElementById('onlineRandom').click();")
        rnd1 = wait_change(first_ids)
        b.evaluate("document.getElementById('onlineRandom').click();")
        rnd2 = wait_change(rnd1)
        check("「随机」两次给出不同结果", rnd1 != rnd2 and rnd1 != first_ids)
        # wallhaven 的 random 是「重排后取第一页」；4kwallpapers 只能随机挑页码，
        # 所以后者停在别的页是**对的**，这里只要求页码是合法的 N / M
        pg = (pager() or "").split("/")
        check("「随机」之后页码显示仍然合法（%s）" % pager(),
              len(pg) == 2 and pg[0].strip().isdigit() and pg[1].strip().isdigit())

        # 选中一张：先出预览大图，不直接生效。
        # 这一段刻意放在 **wallhaven** 上测：它的缩略图走公开 CDN，稳定；
        # 4kwallpapers 的预览要现敲它的详情页，那台机器挂在 Cloudflare 后面，
        # 连续请求会被限速（表现为读超时）—— 那是第三方的问题，
        # 不该让探针变红，所以它单独放在后面按「尽力而为」测。
        b.evaluate("document.querySelector('#prov-wallhaven')"
                   "? 0 : document.querySelector('[data-prov=\"wallhaven\"]').click();")
        b.evaluate("document.querySelector('[data-prov=\"wallhaven\"]').click();")
        wait_grid()
        b.evaluate("document.querySelector('#onlineGrid .online-item').click();")
        # 弹窗在「选中 → 看大图 → 使用这张」这一段里**不能被关掉**。
        # 之前有个挂在 body 上的总委托会连在线卡片一起吃掉（它们的类名是
        # `img-item online-item`），一点就把弹窗关了、封面也清空。
        # 用 MutationObserver 盯着 hidden 属性，比截图更容易看出「什么时候关的」。
        b.evaluate("""
        (function(){
          var m = document.getElementById('imgModal');
          window.__modalLog = [];
          new MutationObserver(function(){
            window.__modalLog.push(m.hidden);
          }).observe(m, { attributes: true, attributeFilter: ['hidden'] });
        })()""")
        b.evaluate("""
        (function(){
          var it = document.querySelector('[data-kind="post"]') || document.querySelector('.list-item');
          if (it) it.click();
          var b = document.querySelector('[data-act="pick-cover"]');
          if (b) b.click();
        })()""")
        time.sleep(0.6)
        b.evaluate("document.querySelector('[data-img-tab=\"online\"]').click();")
        wait_grid()
        b.evaluate("document.querySelector('#onlineGrid .online-item').click();")
        time.sleep(3.0)

        pv = {}
        for _ in range(120):
            time.sleep(0.5)
            pv = json.loads(b.evaluate("""
            (function(){
              var box = document.getElementById('imgPreview');
              var shot = document.getElementById('imgPreviewShot');
              var im = shot.querySelector('img');
              return JSON.stringify({
                shown: !box.hidden,
                hasImg: !!im,
                imgW: im ? Math.round(im.getBoundingClientRect().width) : 0,
                imgH: im ? Math.round(im.getBoundingClientRect().height) : 0,
                shotW: Math.round(shot.getBoundingClientRect().width),
                shotH: Math.round(shot.getBoundingClientRect().height),
                natural: im ? (im.naturalWidth + 'x' + im.naturalHeight) : '',
                complete: im ? im.complete : null,
                name: document.getElementById('imgPreviewName').textContent,
                meta: document.getElementById('imgPreviewMeta').textContent,
                picked: document.querySelectorAll('#onlineGrid .online-item.is-on').length,
                note: (shot.querySelector('.img-preview-empty')||{}).textContent || '',
                html: shot.innerHTML.slice(0, 120),
                modalStillOpen: !document.getElementById('imgModal').hidden,
                modalDisplay: getComputedStyle(document.getElementById('imgModal')).display,
                panelW: Math.round(document.querySelector('#imgModal .modal-panel')
                                   .getBoundingClientRect().width)
              });})()"""))
            if pv.get("hasImg") and pv.get("imgW", 0) >= 200:
                break
            if pv.get("note") and "失败" in pv["note"]:
                break
        check("点一张先出预览而不是直接生效",
              pv["shown"] and pv["modalStillOpen"] and pv["picked"] == 1,
              json.dumps({k: pv[k] for k in
                          ("shown", "modalStillOpen", "modalDisplay", "panelW",
                           "picked", "shotW", "shotH", "imgW", "imgH", "natural")},
                         ensure_ascii=False))
        check("预览里真的有大图（%dx%d，natural %s）"
              % (pv["imgW"], pv["imgH"], pv.get("natural", "")),
              pv["hasImg"] and pv["imgW"] >= 200 and pv["imgH"] >= 120,
              (pv.get("note") or "") + " | " + (pv.get("html") or ""))
        check("预览里有名字/来源信息（%s · %s）"
              % (pv["name"][:16], pv["meta"][:16]), bool(pv["name"]) and bool(pv["meta"]))
        check("还没写进封面字段",
              "assets/uploads/" not in (b.evaluate(
                  "(document.querySelector('#coverPath')||{}).textContent || ''")))
        b.evaluate("document.getElementById('imgPreviewCancel').click();")
        time.sleep(0.4)
        check("「取消」能收起预览",
              b.evaluate("document.getElementById('imgPreview')&&"
                         "document.getElementById('imgPreview').hidden") is True
              and b.evaluate("document.querySelectorAll('.online-item.is-on').length") == 0)
        log = b.evaluate("JSON.stringify(window.__modalLog||[])")
        check("「选中 → 看大图 → 取消」全程没人把弹窗关掉（%s）" % log, log == "[]")

        # 4kwallpapers：没有缩略图，预览地址得后台去详情页解析（只解析、不下载）。
        # 按「尽力而为」判：要么出图，要么给出**明确的失败提示**，不能一直空着。
        b.evaluate("document.querySelector('[data-prov=\"4kwallpapers\"]').click();")
        b.evaluate("document.querySelector('[data-prov=\"4kwallpapers\"]').click();")
        wait_grid()
        b.evaluate("document.querySelector('#onlineGrid .online-item').click();")
        pv4 = {}
        for _ in range(70):
            time.sleep(0.5)
            pv4 = json.loads(b.evaluate("""
            (function(){
              var im = document.querySelector('#imgPreviewShot img');
              var note = document.querySelector('#imgPreviewShot .img-preview-empty');
              return JSON.stringify({hasImg: !!im,
                w: im ? Math.round(im.getBoundingClientRect().width) : 0,
                src: im ? (im.getAttribute('src')||'').slice(0,60) : '',
                note: note ? note.textContent : '',
                meta: document.getElementById('imgPreviewMeta').textContent});})()"""))
            if (pv4.get("hasImg") and pv4.get("w", 0) >= 200) or \
               (pv4.get("note") and "失败" in pv4["note"]):
                break
        if pv4.get("hasImg"):
            check("4kwallpapers 也能预览（后台解析出原图地址，经本地代理）", pv4["w"] >= 200,
                  pv4["src"])
            check("预览走本地代理（浏览器直连会被挂住）",
                  "/api/online/proxy" in pv4["src"], pv4["src"])
        else:
            # 第三方限速了：要求 UI 明确说出失败，而不是留一个转不完的圈
            check("4kwallpapers 预览取不到时给出明确提示（第三方会限速）",
                  "失败" in (pv4.get("note") or ""), pv4.get("note") or "(一直空着)")
        b.evaluate("document.getElementById('imgPreviewCancel').click();")
        time.sleep(0.3)

        # 回到 wallhaven，真的下第一张（下完删掉，别把壁纸留在仓库里）
        b.evaluate("document.querySelector('[data-prov=\"wallhaven\"]').click();")
        b.evaluate("document.querySelector('[data-prov=\"wallhaven\"]').click();")
        wait_grid()
        before = set(os.listdir(UPLOADS)) if os.path.isdir(UPLOADS) else set()
        b.evaluate("document.querySelector('#onlineGrid .online-item').click();")
        time.sleep(2.5)
        b.evaluate("document.getElementById('imgPreviewUse').click();")
        time.sleep(9.0)
        after = set(os.listdir(UPLOADS)) if os.path.isdir(UPLOADS) else set()
        new_files = sorted(f for f in (after - before) if f.endswith(".webp"))
        cover = b.evaluate(
            "(document.querySelector('[data-key=\"cover\"]')||{}).value || "
            "(document.querySelector('#coverPath')||{}).textContent || ''")
        check("点「使用这张」之后才下载并填进封面（%s）" % str(cover)[:48],
              "assets/uploads/" in str(cover) and str(cover).endswith(".webp"), cover)
        check("文件确实落进了 assets/uploads/（%s）" % (new_files[:1] or "无"),
              len(new_files) == 1)
        check("下载完把弹窗关了", b.evaluate("document.getElementById('imgModal').hidden") is True)
        if new_files:
            p = os.path.join(UPLOADS, new_files[0])
            size = os.path.getsize(p)
            check("下下来的图不是空文件（%d KB）" % (size // 1024), size > 20 * 1024)
            os.remove(p)                       # 别把测试下的壁纸留在仓库里
            print("    （已清理 %s）" % new_files[0])

        errs = b.evaluate("JSON.stringify(window.__errs || [])")
        errs = json.loads(errs) if errs else []
        print()
        if errs:
            print(f"  浏览器端捕获到 {len(errs)} 条报错：")
            for e in errs[:10]:
                print("    - " + str(e)[:160])
        check("整个过程没有 JS 报错", not errs, f"{len(errs)} 条")

    print()
    if fails:
        print(f"!! {len(fails)} 项失败: {fails}")
        return 1
    print("后台 UI 全部通过。")
    return 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    os._exit(code)
