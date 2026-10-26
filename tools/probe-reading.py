#!/usr/bin/env python3
"""阅读交互探针：目录折叠、代码块折叠、图片放大与看原图。
这三样都是「做对了没人夸、做坏了很烦」的东西，而且**坏起来都是静默的**：
目录折叠忘了记状态 → 每次刷新都弹回展开；代码块折叠用 `overflow: hidden`
裁纵向 → 顺带把横向滚动也废掉（长行再也拖不动）；图片放大图省事用
`width: 120%` → 把后面的段落顶下去、还长出横向滚动条。
    python tools/probe-reading.py
"""
import functools
import http.server
import json
import base64
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
PORT = 4191
BASE = "http://127.0.0.1:%d" % PORT
# 这一篇既有目录、又有长代码块（>24 行）和短代码块，还有图
PAGE = "/posts/quadruped-mpc-kinematics/"


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


TOC = """
(function(){var t=document.querySelector('[data-toc]');if(!t)return null;
 var b=t.querySelector('[data-toc-toggle]');var ul=t.querySelector('ul');
 return JSON.stringify({folded:t.classList.contains('is-folded'),
   expanded:b?b.getAttribute('aria-expanded'):null,
   listShown:ul?getComputedStyle(ul).display!=='none':null,
   current:(t.querySelector('[data-toc-current]')||{}).textContent||'',
   links:t.querySelectorAll('ul a').length,
   count:(t.querySelector('.toc-count')||{}).textContent||'',
   nodes:t.querySelectorAll('[data-toc-node]').length,
   items:t.querySelectorAll('.toc-item').length,
   depth:(function(){var d=0;t.querySelectorAll('.toc-list').forEach(function(u){
     var n=0,p=u.parentElement;while(p&&p!==t){if(p.classList&&p.classList.contains('toc-list'))n++;p=p.parentElement;}
     if(n>d)d=n;});return d;})()});})()
"""

# 分层收起：找一个带子节点的分支，收起前后数「可见的目录链接」
TOC_TREE = """
(function(){
  var host = arguments[0] === 'mobile' ? document.querySelector('.mobile-toc') : document.querySelector('[data-toc]');
  if (!host) return JSON.stringify({none: true});
  var vis = function(){ var n=0;
    host.querySelectorAll('.toc-list a').forEach(function(a){
      if (a.offsetParent !== null) n++; });
    return n; };
  var li = host.querySelector('.toc-item.has-kids');
  if (!li) return JSON.stringify({none: true});
  var btn = li.querySelector(':scope > .toc-row > [data-toc-node]');
  return JSON.stringify({
    hasKids: true,
    collapsed: li.classList.contains('is-collapsed'),
    expanded: btn ? btn.getAttribute('aria-expanded') : null,
    childUlShown: (function(){var u=li.querySelector(':scope > .toc-list');
      return u ? getComputedStyle(u).display !== 'none' : null;})(),
    visibleLinks: vis(),
    totalLinks: host.querySelectorAll('.toc-list a').length,
    branchTitle: (li.querySelector(':scope > .toc-row > a')||{}).textContent || ''
  });
})(%s)
"""

CODE = """
(function(){var out=[];document.querySelectorAll('.code-block').forEach(function(b){
 var n=parseInt(b.getAttribute('data-lines')||'0',10);
 var pre=b.querySelector('.code-pre');
 var more=b.querySelector('.code-more');
 var fold=b.querySelector('.code-fold');
 out.push({n:n, folded:b.classList.contains('is-folded'),
   moreHidden:more?more.hidden:null, moreText:more?(more.textContent||'').trim():'',
   hasFold:!!fold, foldLabel:fold?(fold.textContent||'').trim():'',
   preH:Math.round(pre.getBoundingClientRect().height),
   codeH:pre.style.getPropertyValue('--code-h')||'',
   trans:getComputedStyle(pre).transitionProperty||'',
   scrollX:pre.scrollWidth>pre.clientWidth+2});});
 return JSON.stringify(out);})()
"""

# 折叠门槛的另一半：**7 行不该有按钮**。原来只在首页那篇上断言过，而那篇
# 恰好一个短块都没有 —— 断言空跑也是绿的。挑一篇 7 行和 8 行都有的文章来量。
SHORT_PAGE = "/posts/cpp-python-code-style/"

IMG = """
(function(){var i=document.querySelector('.prose img');if(!i)return null;
 return JSON.stringify({src:(i.getAttribute('src')||'').slice(-38),
   zoomable:i.classList.contains('is-zoomable'),
   cursor:getComputedStyle(i).cursor,
   transform:getComputedStyle(i).transform,
   offsetW:i.offsetWidth,
   natW:i.naturalWidth,
   inLink:!!i.closest('a'),
   box:(function(){var r=i.getBoundingClientRect();
     return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),
             w:Math.round(r.width),h:Math.round(r.height)};})()});})()
"""

LB = """
(function(){var b=document.querySelector('.lightbox');if(!b)return JSON.stringify({none:true});
 var st=b.querySelector('.lightbox-stage');
 var imgs=st?[].slice.call(st.querySelectorAll('img')):[];
 var shown=imgs.filter(function(i){return i.classList.contains('is-in');});
 var on=shown[0]||imgs[0];
 var fg=b.querySelector('figcaption');
 return JSON.stringify({open:b.classList.contains('is-open'),
   display:getComputedStyle(b).display,
   src:on?on.getAttribute('src'):null,
   layers:imgs.length, visible:shown.length,
   cap:fg?fg.textContent||'':'',
   capHidden:fg?fg.hidden:null,
   htmlLocked:document.documentElement.classList.contains('has-lightbox')});})()
"""

READY = """
(function(){
 return JSON.stringify({
   state: document.readyState,
   js: !!window.__lightbox});})()
"""


def wait_ready(br, timeout=25.0):
    """等页面真的可用，再开始量几何。
    **不能只 sleep 一个固定时长。** 这个探针中途会 `Page.navigate` 重载一次页面，
    重载之后样式和脚本都要重新拉一遍；机器一忙，固定 sleep 就不够了 ——
    表现是 `window.__lightbox`（图片模块末尾挂的）还没出现，后面每一条依赖站点 JS
    的断言跟着一起红，而页面本身好好的。
    注意这里**不等图片**：正文图是 `loading="lazy"`，页面刚打开时首图还在几屏之外，
    浏览器根本不会去请求它，等它等于必然超时。图片由用到它的那一段自己滚进视口再等。
    """
    deadline = time.time() + timeout
    last = {}
    while time.time() < deadline:
        last = json.loads(br.evaluate(READY))
        if last["state"] == "complete" and last["js"]:
            return True, last
        time.sleep(0.3)
    return False, last


def shoot(br, path, label, lines=None, timeout=12.0):
    """截图，失败也不许把探针带崩。

    `Page.captureScreenshot` 在这种长会话里偶发**卡住不返回**（页面里有一直在跑的
    rAF / 沙箱 iframe 时更容易碰到）：它一挂，整个探针就在这一行 traceback 掉，
    后面几十条断言全都不跑了 —— 比"这张截图没存下来"严重得多。
    所以这里自己控超时，失败先 `bringToFront` 再来一次，还不行就记一条 FAIL 继续走。
    """
    for attempt in (1, 2):
        try:
            png = br.call("Page.captureScreenshot", {"format": "png"}, timeout)
        except Exception as exc:                      # noqa: BLE001
            if lines is not None:
                lines.append("      [诊断] 截图超时（第 %d 次，%s）可见性=%s"
                             % (attempt, type(exc).__name__,
                                br.evaluate("document.visibilityState")))
            br._refront()
            time.sleep(0.4)
            continue
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(png["data"]))
        if lines is not None:
            lines.append("      截图 -> %s" % path)
        return True
    if lines is not None:
        lines.append("FAIL  截图失败：%s" % label)
    return False


def main():
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    os.makedirs(SHOTS, exist_ok=True)
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    lines = []

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        return cond

    try:
        with cdp.Browser(BASE + PAGE, port=9360, window="1440,1100", wait_load=2.0) as br:
            wait_ready(br)
            # 帧计数器：动画时钟一旦停了（过渡会冻在半路），这里的数字就不再涨
            br.evaluate("window.__raf=0;(function l(){window.__raf++;"
                        "requestAnimationFrame(l);})();")

            # ---------- 目录折叠 ----------
            t = json.loads(br.evaluate(TOC) or "null")
            if ok(t is not None, "页面有目录侧栏"):
                ok(t["links"] >= 5, "目录里有 %d 条" % t["links"])
                ok("节" in t["count"], "目录标题带条目数（%s）" % t["count"])
                ok(t["expanded"] == "true" and t["listShown"], "默认展开")
                br.evaluate("document.querySelector('[data-toc-toggle]').click()")
                time.sleep(0.35)
                t2 = json.loads(br.evaluate(TOC))
                ok(t2["folded"] and t2["expanded"] == "false" and not t2["listShown"],
                   "点标题能收起（列表 display=%s）" % t2["listShown"])
                ok(len(t2["current"]) > 1,
                   "收起后标题上还看得到当前小节（%r）" % t2["current"][:26])
                ok(br.evaluate(
                    "(function(){try{return localStorage.getItem('luoyebai.toc.folded');}"
                    "catch(e){return 'ERR';}})()") == "1",
                   "收起状态写进了 localStorage")

                # 刷新后要还是收起的
                br.call("Page.navigate", {"url": BASE + PAGE})
                wait_ready(br)
                t3 = json.loads(br.evaluate(TOC))
                ok(t3["folded"], "刷新后仍然保持收起（不是每次都弹回展开）")
                br.evaluate("document.querySelector('[data-toc-toggle]').click()")
                time.sleep(0.3)
                t4 = json.loads(br.evaluate(TOC))
                ok(not t4["folded"] and t4["listShown"], "再点一次能展开")
                ok(br.evaluate(
                    "(function(){try{return localStorage.getItem('luoyebai.toc.folded');}"
                    "catch(e){return 'ERR';}})()") == "0",
                   "展开状态也记住了")

                # ---------- 目录分层收起 ----------
                ok(t4["nodes"] >= 5, "目录里有 %d 个可折叠的分支" % t4["nodes"])
                ok(t4["depth"] >= 1, "目录是嵌套结构（层级深度 %d）" % t4["depth"])
                tr = json.loads(br.evaluate(TOC_TREE % "'side'"))
                if ok(tr.get("hasKids"), "找到带子节点的分支（%r）" % tr.get("branchTitle", "")[:16]):
                    ok(not tr["collapsed"] and tr["expanded"] == "true" and tr["childUlShown"],
                       "默认展开")
                    n_before = tr["visibleLinks"]
                    br.evaluate(
                        "(function(){var li=document.querySelector('[data-toc] .toc-item.has-kids');"
                        "li.querySelector(':scope > .toc-row > [data-toc-node]').click();})()")
                    time.sleep(0.35)
                    tr2 = json.loads(br.evaluate(TOC_TREE % "'side'"))
                    ok(tr2["collapsed"] and tr2["expanded"] == "false"
                       and not tr2["childUlShown"],
                       "点小箭头能收起这一节（子列表 display=%s）" % tr2["childUlShown"])
                    ok(tr2["visibleLinks"] < n_before,
                       "收起后可见条目变少（%d -> %d）" % (n_before, tr2["visibleLinks"]))
                    ok(tr2["totalLinks"] == tr["totalLinks"],
                       "只是藏起来，条目并没有被删掉（%d）" % tr2["totalLinks"])
                    # 只影响这一支：其它分支仍然展开
                    other = br.evaluate(
                        "(function(){var all=document.querySelectorAll('[data-toc] "
                        ".toc-item.has-kids');var n=0;for(var i=1;i<all.length;i++){"
                        "if(!all[i].classList.contains('is-collapsed'))n++;}return n;})()")
                    ok(other >= 1, "其它分支不受影响（还有 %d 支是展开的）" % other)
                    # 收起「你正在读的那一节」时，箭头要立刻亮起来 ——
                    # 否则读者会以为这一节的内容不见了。
                    # 先把某个**子小节**滚进视野，让滚动高亮落到分支内部，
                    # 然后收起它的父分支：看它跟不跟滚动监听算出来的 is-active。
                    # 早先的写法是手动点 is-active，但滚动监听随后会把高亮
                    # 重新打回当前小节，querySelector 拿到的就不是目标了。
                    # 用 window.scrollTo 直接定位，不用 scrollIntoView：
                    # 站点开了 `html { scroll-behavior: smooth }`，
                    # scrollIntoView 会起一段动画，脚本里的 evaluate 会一直等到它跑完
                    # （实测能卡到 CDP 超时）。
                    br.evaluate("""
                    (function(){
                      var a = document.querySelector('[data-toc] .toc-item.has-kids > .toc-list a');
                      if (!a || !a.hash) return;
                      var t = document.getElementById(decodeURIComponent(a.hash.slice(1)));
                      if (!t) return;
                      var y = t.getBoundingClientRect().top + window.scrollY - 90;
                      document.documentElement.style.scrollBehavior = 'auto';
                      window.scrollTo(0, Math.max(0, y));
                    })()""")
                    time.sleep(1.0)
                    lit = json.loads(br.evaluate("""
                    (function(){
                      var toc = document.querySelector('[data-toc]');
                      var a = toc.querySelector('a.is-active');
                      if (!a) return JSON.stringify({none: '没有 is-active'});
                      // 当前小节自己那一层，或者它的某个上级 —— 两者都要看。
                      // 多数时候当前小节就是个带子节点的 h2，收起的正是它自己。
                      var li = a.closest('.toc-item');
                      var owner = null, n = li;
                      while (n) {
                        if (n.classList.contains('has-kids')) { owner = n; break; }
                        n = n.parentElement ? n.parentElement.closest('.toc-item') : null;
                      }
                      if (!owner) return JSON.stringify({none: '当前小节不在任何分支里：'
                        + (a.textContent||'').slice(0,10)});
                      var btn = owner.querySelector(':scope > .toc-row > .toc-node');
                      if (!btn) return JSON.stringify({none: '分支没有折叠按钮'});
                      if (!owner.classList.contains('is-collapsed')) btn.click();
                      return JSON.stringify({
                        title: (owner.querySelector(':scope > .toc-row > a')||{}).textContent || '',
                        active: (a.textContent || '').slice(0, 12),
                        lit: btn.classList.contains('is-active-branch')});
                    })()"""))
                    if lit.get("none"):
                        # 「没测到」也算失败：跳过 = 这条断言其实没跑，
                        # 让它悄悄变绿比红更糟
                        ok(False, "收起正在读的那一节时箭头亮起（没测到：%s）" % lit["none"])
                    else:
                        ok(lit["lit"], "收起正在读的那一节（%r 里的 %r）时箭头亮起"
                           % (lit.get("title", "")[:12], lit.get("active", "")))
                    br.evaluate(
                        "(function(){var li=document.querySelector('[data-toc] .toc-item.has-kids');"
                        "li.querySelector(':scope > .toc-row > [data-toc-node]').click();})()")
                    time.sleep(0.3)
                    tr3 = json.loads(br.evaluate(TOC_TREE % "'side'"))
                    ok(not tr3["collapsed"] and tr3["visibleLinks"] == n_before,
                       "再点一次能展开回去（%d）" % tr3["visibleLinks"])

                # 移动端那份是同一份 HTML，各自独立折叠
                tm = json.loads(br.evaluate(TOC_TREE % "'mobile'"))
                ok(tm.get("hasKids"), "移动端目录也是嵌套的")

            # ---------- 代码块折叠 ----------
            br.evaluate("window.scrollTo(0, document.body.scrollHeight*0.4)")
            time.sleep(0.6)
            cs = json.loads(br.evaluate(CODE))
            long_blocks = [c for c in cs if c["n"] > 24]
            ok(len(cs) >= 1, "页面有 %d 个代码块" % len(cs))
            # 门槛两边都要断言，而且要看**真实行数**（`data-lines`）：
            # 只看「长的有按钮」的话，门槛从 7 改成 3 也没人拦得住。
            ok(all(c["hasFold"] for c in cs if c["n"] > 7),
               "所有超过 7 行的代码块都有折叠按钮")
            ok(all(not c["hasFold"] for c in cs if c["n"] <= 7),
               "7 行及以下一律不给折叠按钮（本页 %d 个短块）"
               % len([c for c in cs if c["n"] <= 7]))
            if long_blocks:
                b0 = long_blocks[0]
                ok(b0["folded"], "长代码块（%d 行）默认先收起" % b0["n"])
                ok(b0["moreHidden"] is False and "展开全部" in b0["moreText"],
                   "收起时显示「%s」" % b0["moreText"])
                ok(not b0["scrollX"] or br.evaluate(
                    "(function(){var p=null;document.querySelectorAll('.code-block.is-folded .code-pre')"
                    ".forEach(function(q){if(!p&&q.scrollWidth>q.clientWidth+2)p=q;});"
                    "if(!p)return true;"
                    "return getComputedStyle(p).overflowX==='auto';})()"),
                   "收起时横向滚动条还在（不是用 overflow:hidden 裁的）")
                h_folded = b0["preH"]
                br.evaluate(
                    "(function(){var b=document.querySelectorAll('.code-block[data-lines]');"
                    "for(var i=0;i<b.length;i++){if(parseInt(b[i].getAttribute('data-lines'),10)>24)"
                    "{b[i].querySelector('[data-fold]').click();return;}}})()")
                time.sleep(0.35)
                cs2 = json.loads(br.evaluate(CODE))
                b1 = [c for c in cs2 if c["n"] == b0["n"]][0]
                ok(not b1["folded"], "点折叠按钮能展开")
                ok(b1["preH"] > h_folded + 40,
                   "展开后代码区真的变高了（%d -> %d）" % (h_folded, b1["preH"]))
                ok("收起" in b1["foldLabel"], "展开后按钮文案变成「收起」（%s）" % b1["foldLabel"])
                # 折叠要有动画：`max-height` 必须可插值 —— 靠 site.js 量出来的
                # `--code-h`，光写 `auto -> 16.5em` 是过渡不起来的（会硬切）
                ok(b1["codeH"].endswith("px") and int(b1["codeH"][:-2] or 0) > 100,
                   "展开态的高度是量出来的（--code-h=%s）" % b1["codeH"])
                ok("max-height" in (b1["trans"] or ""),
                   "折叠/展开是过渡出来的（transition-property=%s）" % b1["trans"])

            # ---------- 图片放大 ----------
            # 先把图滚进视口再量坐标：正文里的第一张图往往在几千像素之外，
            # 拿它的初始坐标去 dispatchMouseEvent 等于在页面空白处晃鼠标，
            # `:hover` 根本不会命中（这一条一开始就是这么误报的）
            br.evaluate("window.scrollTo(0, document.body.scrollHeight*0.35)")
            time.sleep(0.6)
            br.evaluate(
                "(function(){var i=document.querySelector('.prose img');"
                "if(i)i.scrollIntoView({block:'center'});})()")
            # 正文图是 `loading="lazy"`：**没滚到跟前就不会去请求**（截图上量到
            # `naturalWidth=0`、`currentSrc` 空、连一条资源记录都没有）。所以滚进来
            # 之后必须等它真的解码完再量 —— 否则下面量到的是一张 2px 宽的破图，
            # 连带「悬停放大 / 自定义指针」四条断言一起红，而页面是好的。
            for _ in range(30):
                if br.evaluate(
                        "(function(){var i=document.querySelector('.prose img');"
                        "return !!(i && i.naturalWidth > 0);})()"):
                    loaded = True
                    break
                time.sleep(0.4)
            ok(loaded, "首图解码完成（懒加载：滚到跟前才会请求）")
            time.sleep(0.3)
            im = json.loads(br.evaluate(IMG) or "null")
            # 把「连到了哪一页 / 第一张图是谁」打出来：这一组断言全是量几何的，
            # 一旦连错页（比如同端口有残留的 Edge 还在跑），红出来的样子和
            # 真的排版坏了长得一模一样，没有这两行就得靠猜。
            lines.append("      页面 %s ｜ 第一张图 %s（原图 %dpx，量到 %dpx）"
                         % (br.evaluate("location.pathname"),
                            (im or {}).get("src", "—"),
                            (im or {}).get("natW", 0),
                            (im or {}).get("offsetW", 0)))
            if ok(im is not None, "页面有正文图片"):
                ok(im["zoomable"] and im["cursor"] == "zoom-in",
                   "图片标了放大（cursor=%s）" % im["cursor"])
                before = im["offsetW"]
                in_view = (0 < im["box"]["y"] < 1000)
                ok(in_view, "图片已经滚进视口（中心 y=%d）" % im["box"]["y"])
                br.call("Input.dispatchMouseEvent", {
                    "type": "mouseMoved", "x": im["box"]["x"], "y": im["box"]["y"]})
                time.sleep(0.7)
                tr = br.evaluate(
                    "(function(){var i=document.querySelector('.prose img');"
                    "return getComputedStyle(i).transform;})()")
                ok(tr not in (None, "none") and tr.startswith("matrix"),
                   "悬停真的放大了（transform=%s）" % (tr or "none")[:38])
                # 站点默认开着**自定义指针**（`cursor: none`），所以上面那条 CSS
                # 其实看不见 —— 真正让读者知道「这里能点」的是自定义指针切到
                # zoom 状态、并在指针上画出放大镜。
                # 这个断言必须放在**鼠标已经动过之后**：`has-custom-cursor` 是
                # 第一次 pointermove 时才挂上去的，之前查必然是 false。
                ok(br.evaluate("document.documentElement.classList.contains('has-custom-cursor')"),
                   "自定义指针是启用的（所以要看它的状态，而不是 CSS cursor）")
                # 指针状态要**分样式验**：站点默认是「微光」（保留系统指针、不叠加
                # 符号），圆环样式才在指针上画放大镜。这段断言原来只按圆环写，
                # 默认值改成 glow 之后就一直红 —— 红的不是功能，是断言过时了。
                CUR = """
                (function(){
                  var c = document.querySelector('.cursor');
                  if (!c) return JSON.stringify({none: true});
                  var ic = c.querySelector('.cursor-icon');
                  var lb = c.querySelector('.cursor-label');
                  var rg = c.querySelector('.cursor-ring');
                  return JSON.stringify({
                    state: c.getAttribute('data-state'),
                    mode: document.documentElement.getAttribute('data-cursor'),
                    label: (lb||{}).textContent || '',
                    labelDisplay: lb ? getComputedStyle(lb).display : null,
                    iconW: ic ? Math.round(ic.getBoundingClientRect().width) : 0,
                    iconDisplay: ic ? getComputedStyle(ic).display : null,
                    iconOpacity: ic ? +getComputedStyle(ic).opacity : 0,
                    ringW: rg ? Math.round(rg.getBoundingClientRect().width) : 0
                  });})()
                """
                glow = json.loads(br.evaluate(CUR))
                ok(glow.get("state") == "zoom",
                   "悬停图片时自定义指针切到 zoom 状态（%s）" % glow.get("state"))
                ok(glow.get("iconDisplay") == "none" and glow.get("labelDisplay") == "none",
                   "微光样式不叠加放大镜和文字（系统自带的放大镜仍然可见）")
                br.evaluate("document.documentElement.setAttribute('data-cursor','on')")
                time.sleep(0.5)
                ring = json.loads(br.evaluate(CUR))
                ok(ring.get("iconW", 0) >= 10 and ring.get("iconOpacity", 0) > 0.5,
                   "圆环样式下指针上真的画出了放大镜（%dpx, opacity %.2f）"
                   % (ring.get("iconW", 0), ring.get("iconOpacity", 0)))
                ok("看原图" in (ring.get("label") or ""),
                   "指针旁边有「%s」提示" % ring.get("label"))
                ok(ring.get("ringW", 0) >= 20,
                   "圆环样式的圆环正常大小（%dpx）" % ring.get("ringW", 0))
                br.evaluate("document.documentElement.setAttribute('data-cursor','glow')")
                time.sleep(0.3)

                # 排版尺寸与视觉尺寸必须**趁鼠标还在图上**量：
                # 下面一移开，`:hover` 就没了、`getBoundingClientRect` 又变回原样
                lay = json.loads(br.evaluate(
                    "(function(){var i=document.querySelector('.prose img');"
                    "var r=i.getBoundingClientRect();"
                    "return JSON.stringify({visual:Math.round(r.width),"
                    "layout:i.offsetWidth,"
                    "docW:document.documentElement.scrollWidth,"
                    "winW:window.innerWidth});})()"))
                ok(lay["docW"] <= lay["winW"] + 2,
                   "放大没有把页面顶出横向滚动条（%d <= %d）" % (lay["docW"], lay["winW"]))
                # 放大必须是**纯视觉**的 scale：`getBoundingClientRect` 会算上 transform，
                # 所以要看 offsetWidth（不受 transform 影响的排版宽度）。
                # 用 width:120% 之类去放大，这里就会变，而且会把后面的段落顶下去。
                ok(lay["layout"] == before,
                   "放大不参与排版（offsetWidth %d -> %d）" % (before, lay["layout"]))
                ok(lay["visual"] > before, "视觉上确实变宽了（%d -> %d）" % (before, lay["visual"]))

                # 离开图片要切回去，别把放大镜留在页面上
                br.call("Input.dispatchMouseEvent", {
                    "type": "mouseMoved", "x": 12, "y": 12})
                time.sleep(0.5)
                ok(br.evaluate(
                    "(function(){var c=document.querySelector('.cursor');"
                    "return c ? c.getAttribute('data-state') : '';})()") != "zoom",
                   "移开图片后指针切回普通状态")

                # ---------- 点开看原图 ----------
                ok(not json.loads(br.evaluate(LB)).get("open", False), "默认没有遮罩层")
                br.evaluate("document.querySelector('.prose img').click()")
                time.sleep(0.5)
                lb = json.loads(br.evaluate(LB))
                ok(lb.get("open") and lb.get("display") == "flex", "点图片打开了遮罩层")
                # img.src 会被浏览器解析成绝对地址，比路径尾巴就行
                src = lb.get("src") or ""
                ok("/assets/" in src and src.endswith((".webp", ".png", ".jpg", ".jpeg", ".gif")),
                   "遮罩层用的是同一张图（…%s）" % src[-42:])
                ok(lb.get("htmlLocked"), "打开时锁住了页面滚动")
                # 两层叠着轮流淡入：换图时旧图还撑着画面，不会闪一下空白
                ok(lb.get("layers") == 2 and lb.get("visible") == 1,
                   "大图是两层叠放、只有一层可见（%s 层 / %s 可见）"
                   % (lb.get("layers"), lb.get("visible")))
                total = br.evaluate("window.__lightbox ? window.__lightbox.total : 0")
                if total and total >= 2:
                    first = lb.get("src") or ""
                    br.evaluate("window.__lightbox.next()")
                    time.sleep(0.06)
                    mid = json.loads(br.evaluate(LB))
                    ok(mid.get("visible", 0) >= 1,
                       "换图过程中画面始终有图（可见层 %s）" % mid.get("visible"))
                    time.sleep(0.9)
                    nxt = json.loads(br.evaluate(LB))
                    ok((nxt.get("src") or "") != first and nxt.get("visible") == 1,
                       "下一张真的换过去了（…%s -> …%s）"
                       % (first[-24:], (nxt.get("src") or "")[-24:]))
                    br.evaluate("window.__lightbox.prev()")
                    time.sleep(0.9)
                shoot(br, os.path.join(SHOTS, "lightbox.png"), "灯箱", lines)
                br.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Escape",
                                                   "code": "Escape", "windowsVirtualKeyCode": 27})
                br.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Escape",
                                                   "code": "Escape", "windowsVirtualKeyCode": 27})
                time.sleep(0.4)
                ok(not json.loads(br.evaluate(LB))["open"], "Esc 能关掉")
                ok(not json.loads(br.evaluate(LB))["htmlLocked"], "关闭后恢复页面滚动")

                # 点背景也能关
                br.evaluate("document.querySelector('.prose img').click()")
                time.sleep(0.4)
                br.call("Input.dispatchMouseEvent", {
                    "type": "mousePressed", "x": 8, "y": 8,
                    "button": "left", "clickCount": 1, "buttons": 1})
                br.call("Input.dispatchMouseEvent", {
                    "type": "mouseReleased", "x": 8, "y": 8,
                    "button": "left", "clickCount": 1, "buttons": 0})
                time.sleep(0.4)
                ok(not json.loads(br.evaluate(LB))["open"], "点背景能关掉")

            # ---------- MPC 可交互演示 ----------
            ok(br.evaluate("document.querySelectorAll('.demo[data-demo=\"js\"]').length") == 1,
               "MPC 演示面板只有一个（每个 ```js run 都是独立沙箱，拆两块变量就断了）")
            # **先把面板滚进视口再点运行**：沙箱上报高度靠 setInterval，
            # 而 Chrome 会限制「不在视口里的跨源 iframe」的定时器 —— 面板在屏幕外
            # 点运行，第一次量到的是撑开前的高度，之后就一直是那个数。
            # 真实读者也是先看到面板再点，所以这里必须滚过去（跟上面量图片坐标同一个道理）。
            # 另外**页面自己也可能在后台**（前面截图/长会话之后 visibilityState 会变 hidden，
            # 定时器同样被压慢）—— 先把页面顶到前面来，再操作。
            br._refront()
            br.evaluate("""
            (function(){document.documentElement.style.scrollBehavior='auto';
             var d=document.querySelector('.demo');
             window.scrollTo(0, d.getBoundingClientRect().top + window.pageYOffset - 120);})()""")
            time.sleep(0.6)
            lines.append("      [诊断] 点击前可见性=%s rAF=%s"
                         % (br.evaluate("document.visibilityState"),
                            br.evaluate("window.__raf")))
            # 沙箱结果区是靠 CSS 过渡长起来的（`demo.css` 的 `transition: height .18s`），
            # 而无头浏览器里**动画时钟可能被冻住**（截图会让渲染进程进后台，见 cdp.py），
            # 那样量到的是过渡停在半路的 28px。这里要断的是「沙箱报了高度、父页面把它
            # 应用上去了」这个**布局**事实，不是过渡动画本身，所以量之前先把过渡关掉。
            br.evaluate(
                "(function(){var s=document.createElement('style');"
                "s.textContent='*{transition:none !important}';"
                "document.head.appendChild(s);})()")
            br.evaluate("document.querySelector('.demo [data-demo-run]').click()")
            time.sleep(2.4)
            log = br.evaluate(
                "(function(){var d=document.querySelector('.demo');"
                "return [].slice.call(d.querySelectorAll('.demo-line'))"
                ".map(function(l){return l.textContent;}).join('\\n');})()")
            status = br.evaluate(
                "(function(){var s=document.querySelector('.demo .demo-status');"
                "return s?s.textContent:'';})()")
            ok("运行完成" in (status or ""), "演示跑完了（%s）" % status)
            ok("自检" in (log or "") and "✓" in (log or ""),
               "预测矩阵自检通过（沙箱内把解析解代回 X=Mx+CU 比过一遍）")
            ok("✗" not in (log or ""), "自检没有报失败")
            ok("Uncaught" not in (log or "") and "Error" not in (log or ""),
               "沙箱里没有未捕获的异常")
            # 高度是沙箱自己报上来的（它每 400ms 量一次 `#demo-root`），可能比 run()
            # 晚一拍；headless 下这个定时器还可能被浏览器压慢（页面进后台就更容易），
            # 所以循环里每次都先把页面顶回前台，再量，给足 20 秒。
            h_iframe = 0
            for _ in range(50):
                br._refront()
                h_iframe = br.evaluate(
                    "Math.round(document.querySelector('.demo iframe')"
                    ".getBoundingClientRect().height)") or 0
                if h_iframe > 300:
                    break
                time.sleep(0.4)
            ok(h_iframe > 300, "演示 iframe 撑起来了（%d px）%s" % (
                h_iframe,
                "" if h_iframe > 300 else br.evaluate(
                    "(function(){var all=document.querySelectorAll('.demo iframe');"
                    "var out=[];for(var i=0;i<all.length;i++){out.push(all[i].style.height+'/'"
                    "+getComputedStyle(all[i]).height);}"
                    "return '［iframe '+all.length+' 个: '+out.join(' , ')+' 可见='"
                    "+document.visibilityState+' rAF='+(window.__raf||0)+'］';})()")))
            shoot(br, os.path.join(SHOTS, "mpc-demo.png"), "MPC 演示", lines)

        # ---------- 折叠门槛：换一篇 7 行和 8 行都有的文章再量一遍 ----------
        # 上一条断言在 MPC 那篇上是空跑的（那篇一个短块都没有），所以拿
        # cpp-python-code-style 来验边界：7 行的块一个按钮都没有，8 行的都有。
        with cdp.Browser(BASE + SHORT_PAGE, port=9361, window="1440,1100",
                         wait_load=2.6) as br:
            time.sleep(1.0)
            cs = json.loads(br.evaluate(CODE))
            n7 = [c for c in cs if c["n"] == 7]
            n8 = [c for c in cs if c["n"] == 8]
            if ok(bool(n7), "%s：页面上有 %d 个 7 行代码块（不然这条断言等于没跑）"
                   % (SHORT_PAGE, len(n7))):
                ok(all(not c["hasFold"] for c in n7), "7 行的代码块没有折叠按钮")
                ok(all(c["moreHidden"] for c in n7), "7 行的代码块也没有「展开全部」")
            if ok(bool(n8), "%s：页面上有 %d 个 8 行代码块" % (SHORT_PAGE, len(n8))):
                ok(all(c["hasFold"] for c in n8), "8 行的代码块有折叠按钮")
            ok(all(c["hasFold"] for c in cs if c["n"] >= 8)
               and all(not c["hasFold"] for c in cs if c["n"] <= 7),
               "整页的边界都落在「8 行起才有按钮」（%d 个块，%d~%d 行）"
               % (len(cs), min(c["n"] for c in cs), max(c["n"] for c in cs)))
    finally:
        httpd.shutdown()

    print("\n".join(lines))
    fails = [x for x in lines if x.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d"
          % (len([x for x in lines if x.startswith(("PASS", "FAIL"))]), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
