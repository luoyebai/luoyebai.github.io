#!/usr/bin/env python3
"""首页粒子星系诊断：有没有画出来、动不动、跟不跟主题、reduced-motion 走不走静态，
以及**单帧绘制到底花多少毫秒**。

性能那条是靠 galaxy.js 暴露的 window.__galaxy.bench() 直接量的：
在无头环境里用 requestAnimationFrame 的间隔判断性能是没用的
（无头 Chrome 把所有页面的 rAF 都压到 ~16 fps，连静态页也是 62 ms/帧）。

叙事那一段（morph.js）额外守两条规矩：

  1. **拼字的位置就是真标题那行字的矩形**。第一版按"滚了多少像素"算进度，成字时
     标题还在视口 93% 处，为了让字看得见就把成字位置夹到屏幕中部 —— 屏幕上于是
     同时出现两处同义内容，交接还要跳一下。现在进度按标题在视口里的位置算，
     而且这里会同时量**粒子层真正画出来的墨迹**（画布像素的包围盒），
     确认它落在标题那一行上。
  2. **卡片轮廓是每张卡自己的窗口**：轮廓亮着（live > 0.05）的时候，那张卡一定
     还没显形（opacity < 0.98）—— 同一个东西不能同时出现两份；反过来，
     卡片完整进视口之后就该看得见，不能"该在却不在"。

> 每一段量之前都会 `Page.bringToFront` 并确认真的是 visible：页面一旦进后台，
> rAF 停摆、**CSS 过渡冻在半路**、`--rv` 这些滚动驱动的值也不再更新，
> 量到的会是"上一次的真实值"。这个坑在 README 里记过。

    python tools/probe-galaxy.py
    python tools/probe-galaxy.py --shot        # 顺便存一张首页截图
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
PORT = 4240

LIT = (
    "(function(){var c=document.getElementById('hero-galaxy');"
    "if(!c||!c.width)return -1;var t=document.createElement('canvas');"
    "t.width=200;t.height=130;var x=t.getContext('2d');x.drawImage(c,0,0,200,130);"
    "var d=x.getImageData(0,0,200,130).data,n=0;"
    "for(var i=3;i<d.length;i+=4*7)if(d[i]>10)n++;return n;})()"
)

CARDS = ("'.direction-card, .lab-invitation, .post-card, .project-card'")

# 独立量一次"标题那行字"的矩形，外加**粒子层画布上真正有墨迹的范围**。
# 两者都换算成 CSS 像素，好跟 __morph.info() 的 tgt 直接比。
INSPECT = r"""
(function(){
  var h2=document.querySelector('[data-morph="head"] h2');
  var rg=document.createRange(); rg.selectNodeContents(h2);
  var rects=rg.getClientRects(), r=rects[0];
  var cv=document.getElementById('morph-canvas');
  var dpr=cv.width/window.innerWidth;
  var d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  var top=1e9,bot=-1e9,left=1e9,right=-1e9,ink=0;
  for(var y=0;y<cv.height;y+=2){
    for(var x=0;x<cv.width;x+=2){
      if(d[(y*cv.width+x)*4+3]>10){
        ink++;
        if(y<top)top=y; if(y>bot)bot=y; if(x<left)left=x; if(x>right)right=x;
      }
    }
  }
  return JSON.stringify({
    text:[r.left,r.top,r.width,r.height],
    bbox: ink?[left/dpr,top/dpr,right/dpr,bot/dpr]:null,
    ink:ink, vh:window.innerHeight});
})()
"""

OPACITY = (r"""
(function(){return JSON.stringify([].slice.call(document.querySelectorAll(
  """ + CARDS + r""")).map(function(el){
    return Math.round(parseFloat(getComputedStyle(el).opacity)*100)/100;}));})()
""")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True


class QuietServer(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


def main():
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/index.html" % PORT
    lines = []

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        return cond

    try:
        with cdp.Browser(base, port=9560, window="1440,900", wait_load=2.4) as br:
            br.call("Page.enable")
            time.sleep(1.2)
            info = br.evaluate("window.__galaxy && window.__galaxy.info()")
            ok(bool(info), "galaxy.js 已启动")
            ok(info and info["parts"] > 200, "粒子数 %s" % (info or {}).get("parts"))
            ok(info and info["bw"] < info["w"], "离屏缓冲是半分辨率（%sx%s -> %sx%s）"
               % (info["bw"], info["bh"], info["w"], info["h"]))

            lit0 = br.evaluate(LIT)
            ok(lit0 > 200, "画布已画出星系（%d 个非透明采样点）" % lit0)

            # 动起来：转两帧之后画面应该变了
            h0 = br.evaluate("(function(){var c=document.getElementById('hero-galaxy');"
                             "return c.toDataURL().length;})()")
            time.sleep(1.2)
            h1 = br.evaluate("(function(){var c=document.getElementById('hero-galaxy');"
                             "return c.toDataURL().length;})()")
            ok(h0 != h1, "星系在自转（画面指纹 %d -> %d）" % (h0, h1))

            # 单帧成本
            for n in (0, 900, 1400):
                br.evaluate("window.__galaxy.setParts(%d)" % n)
                time.sleep(0.25)
                ms = br.evaluate("Math.round(window.__galaxy.bench(40)*100)/100")
                lines.append("      %5d 颗 -> %6.2f ms/帧" % (n, ms))
                if n == 1400:
                    ok(ms < 9.0, "满配粒子单帧 %.2f ms（软件渲染下也应 < 9ms）" % ms)
            br.evaluate("window.__galaxy.setParts(1400)")

            # 主题跟随：换主题后颜色要变
            a = br.evaluate("(function(){var c=document.getElementById('hero-galaxy');"
                            "return c.toDataURL().slice(-2000);})()")
            br.evaluate("document.documentElement.setAttribute('data-theme','neon')")
            time.sleep(0.6)
            b = br.evaluate("(function(){var c=document.getElementById('hero-galaxy');"
                            "return c.toDataURL().slice(-2000);})()")
            ok(a != b, "换主题后星系配色跟着变")
            br.evaluate("document.documentElement.setAttribute('data-theme','dusk')")
            time.sleep(0.4)

            # 关掉动效 -> 静态帧
            br.evaluate("document.documentElement.setAttribute('data-motion','off')")
            time.sleep(0.8)
            s0 = br.evaluate("(function(){var c=document.getElementById('hero-galaxy');"
                             "return c.toDataURL().length;})()")
            time.sleep(1.0)
            s1 = br.evaluate("(function(){var c=document.getElementById('hero-galaxy');"
                             "return c.toDataURL().length;})()")
            lit1 = br.evaluate(LIT)
            ok(s0 == s1, "motion=off 时不再重绘（静态帧）")
            ok(lit1 > 200, "静态帧仍然画出了星系（%d）" % lit1)
            br.evaluate("document.documentElement.setAttribute('data-motion','on')")
            time.sleep(0.4)

            # ---- 鼠标联动：**两层都要跟手，而且每颗粒子都要有反应** ----
            # 读者的反馈是「不是所有的粒子都会和鼠标产生交互」：原来外层力场之外
            # 直接 return（只有指针附近那一圈动），而且叙事层完全没有指针联动
            # （往下滚一点之后，同一团星尘就有一半不理鼠标）。
            # 量的是**所有亮像素到重心的平均距离**：盘面一直在自转，最大半径那个
            # 指标被一两颗边缘粒子带着抖（±2%），平均半径稳得多，整体收缩一眼可见。
            INK = """
            (function(){
              var c=document.getElementById('hero-galaxy');
              var t=document.createElement('canvas'); t.width=240; t.height=160;
              var x=t.getContext('2d'); x.drawImage(c,0,0,240,160);
              var d=x.getImageData(0,0,240,160).data, n=0, cx=0, cy=0;
              for(var y=0;y<160;y++) for(var i=0;i<240;i++){
                if(d[(y*240+i)*4+3]>12){ n++; cx+=i; cy+=y; } }
              if(!n) return JSON.stringify(null);
              cx/=n; cy/=n;
              var sum=0, r2=0;
              for(var y2=0;y2<160;y2++) for(var i2=0;i2<240;i2++){
                if(d[(y2*240+i2)*4+3]>12){
                  var dd=(i2-cx)*(i2-cx)+(y2-cy)*(y2-cy);
                  sum+=Math.sqrt(dd); if(dd>r2) r2=dd; } }
              return JSON.stringify({n:n, cx:Math.round(cx*10)/10, cy:Math.round(cy*10)/10,
                                     rmean:Math.round(sum/n*100)/100,
                                     rmax:Math.round(Math.sqrt(r2)*10)/10});
            })()
            """
            br.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 1180, "y": 300})
            time.sleep(0.7)
            par = json.loads(br.evaluate(
                "JSON.stringify({gx:window.__galaxy.info().px, gy:window.__galaxy.info().py,"
                " mx:window.__morph.info().gpx, my:window.__morph.info().gpy})"))
            ok(abs(par["gx"]) > 0.05 and abs(par["mx"] - par["gx"]) < 0.02,
               "指针视差同时作用在两层星尘上（hero %.2f / 叙事层 %.2f）"
               % (par["gx"], par["mx"] or 0))

            # 用**真按住的左键**驱动聚拢，而不是点按钮：按住期间 strength 一直是 1，
            # 采样时机就稳了（点按钮那一下是"按下即松"，采样点一偏力度就不同，
            # 盘面又一直在自转，平均半径会抖到 ±0.1）。
            centre = json.loads(br.evaluate(
                "(function(){var m=window.__morph.info();var cv=document.getElementById('hero-galaxy');"
                "var r=cv.getBoundingClientRect();"
                "return JSON.stringify({x:Math.round(r.left+r.width*0.76),"
                "y:Math.round(r.top+r.height*0.48)});})()"))
            base_ink = json.loads(br.evaluate(INK))
            br.call("Input.dispatchMouseEvent", {
                "type": "mousePressed", "x": centre["x"], "y": centre["y"],
                "button": "left", "clickCount": 1, "buttons": 1})
            time.sleep(0.5)                  # age/0.12 之后 strength 就是 1
            pulled = json.loads(br.evaluate(INK))
            mid_inter = br.evaluate("window.__morph.info().inter")
            br.call("Input.dispatchMouseEvent", {
                "type": "mouseReleased", "x": centre["x"], "y": centre["y"],
                "button": "left", "clickCount": 1, "buttons": 0})
            time.sleep(1.4)                  # 等它自然衰减掉
            if base_ink and pulled:
                ok(pulled["rmean"] < base_ink["rmean"] * 0.995,
                   "聚拢时**外圈也在动**：亮像素到重心的平均距离 %.2f -> %.2f"
                   % (base_ink["rmean"], pulled["rmean"]))
            else:
                ok(False, "取不到星系的墨迹包络（画布没画？）")
            ok(bool(mid_inter) and mid_inter.get("mode") == "attract",
               "叙事层也收到了同一个手动交互（%s）" % (mid_inter or {}).get("mode"))
            if "--shot" in sys.argv:
                os.makedirs(SHOTS, exist_ok=True)
                shot = br.call("Page.captureScreenshot", {"format": "png"})
                p = os.path.join(SHOTS, "galaxy-home.png")
                with open(p, "wb") as fh:
                    fh.write(base64.b64decode(shot["data"]))
                lines.append("      截图 -> %s" % p)

        # ---------- 滚动联动：往下滚 = 扎进星系 + 首屏让位 ----------
        # 这条链路跨了三个文件（galaxy.js 写 `--hero-scroll`、effects.css 用它做位移与
        # 淡出、effects.js 负责逐排浮现），只测其中一个都会漏：所以这里量的是
        # 「滚了以后，星系的滚动进度、标题的位移、画布的透明度、已浮现的元素数」。
        with cdp.Browser(base, port=9562, window="1440,900", wait_load=2.6) as br:
            br.call("Page.enable")
            time.sleep(2.0)
            def state():
                return json.loads(br.evaluate(r"""
                (function(){
                  var hero=document.querySelector('.hero');
                  var inner=document.querySelector('.hero-inner');
                  var cv=document.querySelector('.hero-galaxy');
                  return JSON.stringify({
                    scroll:window.__galaxy?window.__galaxy.info().scroll:null,
                    css:parseFloat(getComputedStyle(hero).getPropertyValue('--hero-scroll'))||0,
                    innerY:Math.round(new DOMMatrixReadOnly(getComputedStyle(inner).transform).m42),
                    innerOp:parseFloat(getComputedStyle(inner).opacity),
                    cvOp:parseFloat(getComputedStyle(cv).opacity),
                    lit:document.querySelectorAll('.reveal.is-in').length,
                    all:document.querySelectorAll('.reveal').length});})()
                """))

            top = state()
            ok(top["scroll"] == 0 and abs(top["innerY"]) < 2,
               "未滚动时星系不动、标题在原位（scroll=%s）" % top["scroll"])
            ok(0 < top["lit"] < top["all"],
               "首屏只浮现了一部分（%d/%d），其余的等滚到跟前"
               % (top["lit"], top["all"]))

            br.evaluate("document.documentElement.style.scrollBehavior='auto';"
                        "window.scrollTo(0, Math.round(document.querySelector('.hero')"
                        ".offsetHeight * 0.75))")
            time.sleep(1.4)
            mid = state()
            ok(mid["scroll"] > 0.4, "滚动进度跟着走（scroll=%.3f）" % (mid["scroll"] or -1))
            ok(abs(mid["css"] - mid["scroll"]) < 0.08,
               "写进 --hero-scroll 的值与星系内部进度一致（%.3f vs %.3f）"
               % (mid["css"], mid["scroll"]))
            ok(mid["innerY"] < -10 and mid["innerOp"] < 0.7,
               "标题上移并淡出（y=%d，opacity=%.2f）" % (mid["innerY"], mid["innerOp"]))
            ok(mid["cvOp"] < top["cvOp"], "星系跟着淡出（%.2f -> %.2f）"
               % (top["cvOp"], mid["cvOp"]))
            ok(mid["lit"] > top["lit"],
               "往下滚之后又有内容浮现（%d -> %d）" % (top["lit"], mid["lit"]))

        # ---------- 滚动叙事：散开 → 聚成标题 → 落成卡片 ----------
        # 进度由**标题那行字在视口里的位置**决定：0 = 它刚贴到视口底边，
        # 1 = 它升到视口 20% 处。所以这里不去猜滚动像素，而是按进度反算该滚到哪。
        with cdp.Browser(base, port=9563, window="1440,900", wait_load=2.8) as br:
            br.call("Page.enable")
            time.sleep(2.4)
            br._refront()
            br.evaluate("window.__err=null;"
                        "window.addEventListener('error',function(e){window.__err=String(e.message);});"
                        "document.documentElement.style.scrollBehavior='auto'")
            info = br.evaluate("window.__morph && window.__morph.info()")
            if ok(bool(info), "morph.js 已启动"):
                ok(info["n"] >= 400, "叙事粒子数 %s" % info["n"])
                ok(info["pts"] >= 400, "标题采样出 %s 个点" % info["pts"])
                ok(info["galaxy"] == 1 and not info["live"] and info["idle"],
                   "未滚动时停在星系阶段、粒子层不画也不空转（%s/%s）"
                   % (info["galaxy"], info["live"]))
                ok(bool(info["headTop"]) and info["headTop"] > 600,
                   "进度基准取到标题那行字的文档坐标（%s）" % info["headTop"])

            head_top = br.evaluate("window.__morph.info().headTop")
            vh = br.evaluate("window.innerHeight")

            # 交接一致性：叙事层的星系参考系必须**就是** hero 画布那套
            # （同一个实时矩形、同一组 0.76/0.48/0.35/0.66），否则交接的那一小段
            # 里两层画的不是同一团盘面，看上去就是两团星系叠在一起。
            centres = json.loads(br.evaluate("""
            (function(){var cv=document.getElementById('hero-galaxy');
             var r=cv.getBoundingClientRect();
             var g=window.__morph.info().g;
             return JSON.stringify([Math.round(r.left+r.width*0.76),
                                    Math.round(r.top+r.height*0.48), g[0], g[1]]);})()
            """))
            ok(abs(centres[0] - centres[2]) <= 2 and abs(centres[1] - centres[3]) <= 2,
               "叙事层的星系中心就是 hero 画布的中心（Δ%d,%d）"
               % (abs(centres[0] - centres[2]), abs(centres[1] - centres[3])))

            def to_p(p, pixels=False):
                """滚到叙事进度 p：标题行顶边 = vh*(1 - 0.8p)"""
                y = max(0, round(head_top - vh * (1 - 0.8 * p)))
                br.evaluate("window.scrollTo(0, %d)" % y)
                time.sleep(1.0)
                br._refront()
                time.sleep(0.3)
                out = [br.evaluate("window.__morph.info()")]
                if pixels:
                    out.append(json.loads(br.evaluate(INSPECT)))
                return out if pixels else out[0]

            def to_y(y):
                br.evaluate("window.scrollTo(0, %d)" % y)
                time.sleep(0.8)
                br._refront()
                return br.evaluate("window.__morph.info()")

            # 1) 散开：盘面失去结构（星系权重仍是 1，但抖动明显、拖尾拉长）
            st = to_p(0.30)
            ok(st["galaxy"] == 1 and st["text"] == 0,
               "散开中途：还没开始拼字、星系权重仍是 1（%s+%s）" % (st["galaxy"], st["text"]))
            ok(st["turb"] > 0.05, "散开的抖动是活的（%s）" % st["turb"])
            ok(st["live"] and not st["idle"], "这一段粒子层在画（live=%s）" % st["live"])

            # 2) 拼字中途：两段权重同时在手（渐变，不是硬切）
            #    位置在 0.50 就飞到位了，所以中途取样要早一点（0.42 附近）。
            st = to_p(0.42)
            ok(0.05 < st["text"] < 0.95 and abs(st["galaxy"] + st["text"] - 1) < 1e-6,
               "拼字中途：星系/文字权重都在手且归一（%s+%s）" % (st["galaxy"], st["text"]))

            # 3) 成字：位置、字号必须**就是**标题那行字，墨迹也落在那一行上
            st, m = to_p(0.66, pixels=True)
            ok(st["text"] > 0.95, "成字阶段：文字权重 %s" % st["text"])
            ok(st["turb"] < 0.02, "成字时散开的抖动已经收干净（%s）" % st["turb"])
            dx = abs(st["tgt"][0] - m["text"][0])
            dy = abs(st["tgt"][1] - m["text"][1])
            ok(dx <= 2 and dy <= 2,
               "拼字矩形与标题文字矩形重合（Δx=%.1f Δy=%.1f）" % (dx, dy))
            ok(abs(st["tgt"][2] - m["text"][2]) <= 2 and abs(st["tgt"][3] - m["text"][3]) <= 2,
               "拼字字号就是标题字号（%sx%s vs %sx%s）"
               % (st["tgt"][2], st["tgt"][3], round(m["text"][2]), round(m["text"][3])))
            ok(0.0 < st["head"] < 1.0, "此刻真标题正在原位接手（rv=%s）" % st["head"])
            if m["bbox"]:
                ink_cy = (m["bbox"][1] + m["bbox"][3]) / 2
                txt_cy = m["text"][1] + m["text"][3] / 2
                ok(abs(ink_cy - txt_cy) < 45,
                   "粒子真正画出来的墨迹中心就在标题那一行（Δ=%.0fpx）" % abs(ink_cy - txt_cy))
                ink_w = m["bbox"][2] - m["bbox"][0]
                ink_h = m["bbox"][3] - m["bbox"][1]
                ok(ink_w <= m["text"][2] * 1.35 and ink_h <= m["text"][3] * 1.6,
                   "墨迹范围就是那行字本身，外面没有一圈星尘（%.0fx%.0f vs %.0fx%.0f）"
                   % (ink_w, ink_h, m["text"][2], m["text"][3]))
            else:
                ok(False, "粒子层没有画出任何墨迹（成字阶段应该是满的）")
            # 现在是**所有**粒子都落笔、不再留光晕（读者点名不要那圈环绕），
            # 字腔靠颗粒变小来保，不靠减少粒子数。
            ok(st["words"] == st["n"],
               "所有粒子都落到笔画上（%s/%s，没有残留的光晕）"
               % (st["words"], st["n"]))

            # 4) 交接完成：真标题完全接手、拼字的粒子退场 —— 标题那一行上不许再有墨迹
            #    （卡片轮廓此时可能已经在下面的卡片上，所以只查"标题这一行"）
            st, m = to_p(0.95, pixels=True)
            ok(st["head"] == 1, "真标题已经完全接手（rv=%s）" % st["head"])
            ok(st["fade"] < 0.05, "拼字的粒子已经让位（fade=%s）" % st["fade"])
            if m["bbox"]:
                overlap = not (m["bbox"][3] < m["text"][1] - 6 or m["bbox"][1] > m["text"][1] + m["text"][3] + 6)
                ok(not overlap,
                   "交接之后标题那一行上没有粒子墨迹（墨迹 y %.0f~%.0f，标题 y %.0f~%.0f）"
                   % (m["bbox"][1], m["bbox"][3], m["text"][1], m["text"][1] + m["text"][3]))
            else:
                ok(True, "交接之后粒子层干净（墨迹 0）")

            # 5) 卡片尘埃：轮廓亮着的时候卡片一定还没显形；卡片完整进视口就该可见
            bad_overlap, peak, seen_ids = [], 0, set()
            y = max(0, round(head_top - vh * 0.2))
            for step in range(14):
                st = to_y(y + step * round(vh * 0.45))
                op = json.loads(br.evaluate(OPACITY))
                for i, c in enumerate(st["cards"]):
                    if c["live"] > 0.05 and op[i] > 0.98:
                        bad_overlap.append((i, c["live"], op[i]))
                    if c["live"] > 0.2:
                        peak += 1
                        seen_ids.add(i)
            ok(not bad_overlap,
               "轮廓亮着的卡片都没有同时显形（%s）" % (bad_overlap[:3] or "无"))
            ok(len(seen_ids) >= 2,
               "至少有 2 张卡走完「轮廓先亮、卡片再显形」的交接（%s 张）" % len(seen_ids))

            # 6) 全部滚完：内容都在、粒子层真的停机（不是"摘掉 is-live 继续空转"）
            to_y(10 ** 6)
            time.sleep(1.2)
            end = br.evaluate("window.__morph.info()")
            tail = json.loads(br.evaluate(OPACITY))
            ok(min(tail) >= 0.99,
               "叙事走完之后十块内容都已经完全可见（不透明度 %s）" % tail)
            ok(end["cardLive"] == 0 and end["idle"] and not end["running"],
               "收尾之后粒子层停机（cardLive=%s idle=%s running=%s）"
               % (end["cardLive"], end["idle"], end["running"]))
            ok(not br.evaluate(
                "document.getElementById('morph-canvas').classList.contains('is-live')"),
               "收尾之后画布不再占屏（没有 is-live）")
            ok(not br.evaluate("window.__err"), "整个过程没有 JS 报错")
            # 单帧成本要在**最重的那一段**量：收尾之后粒子全被跳过，量出来是 0.07ms，
            # 那个数字什么都说明不了。
            br.evaluate("window.__morph.setProgress(0.62)")
            time.sleep(0.3)
            ms = br.evaluate("Math.round(window.__morph.bench(20)*100)/100")
            lines.append("      成字段粒子单帧 %s ms" % ms)
            ok(ms < 3.0, "成字段粒子单帧 %.2f ms" % ms)
            br.evaluate("window.__morph.setProgress(1)")

            # 7) 回到页首：同样要停机（第一版这里每帧白跑一次 rAF）
            to_y(0)
            time.sleep(1.0)
            home = br.evaluate("window.__morph.info()")
            ok(home["idle"] and not home["running"] and home["head"] == 0,
               "回到页首也停机（idle=%s running=%s rv=%s）"
               % (home["idle"], home["running"], home["head"]))

        # reduced-motion 媒体查询（不是 URL 参数）
        with cdp.Browser(base, port=9561, window="1440,900", wait_load=1.6) as br:
            br.call("Emulation.setEmulatedMedia", {
                "features": [{"name": "prefers-reduced-motion", "value": "reduce"}]})
            br.call("Page.navigate", {"url": base})
            time.sleep(2.4)
            lit = br.evaluate(LIT)
            a = br.evaluate("(function(){return document.getElementById('hero-galaxy')"
                            ".toDataURL().length;})()")
            time.sleep(0.9)
            b = br.evaluate("(function(){return document.getElementById('hero-galaxy')"
                            ".toDataURL().length;})()")
            ok(lit > 200, "prefers-reduced-motion 下仍画出静态星系（%d）" % lit)
            ok(a == b, "prefers-reduced-motion 下不跑动画")
    finally:
        httpd.shutdown()
        httpd.server_close()

    print("\n".join(lines))
    fails = [x for x in lines if x.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d"
          % (len([x for x in lines if x.startswith(("PASS", "FAIL"))]), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
