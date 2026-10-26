#!/usr/bin/env python3
"""「知识图谱」页诊断 + 截图。

重点验证一件最容易出错的事：**canvas 的投影和浏览器自己算的 CSS 3D 是不是同一套**。
graph.js 用 project() 手算屏幕坐标去画地面网格和关系弧线，卡片却交给浏览器做 3D 变换；
两边只要差一点，弧线就会从卡片上飘开。这里用 window.__graph.debug() 拿到相机参数，
在 Python 里复算一遍，再和 getBoundingClientRect() 对。

    python tools/probe-graph.py              # 断言 + 截图
    python tools/probe-graph.py --no-shot
"""
import functools
import http.server
import math
import os
import socketserver
import sys
import threading
import time
import base64

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import cdp  # noqa: E402

PUBLIC = os.path.join(ROOT, "public")
SHOTS = os.path.join(ROOT, "_shots")
PORT = 4204
DEBUG_PORT = 9370


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def handle_one_request(self):
        # 关浏览器时它会直接掐断 keep-alive 连接，这是预期行为，别往 stderr 喷栈
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True


class QuietServer(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass


def project(d, x, y, z):
    """复刻 graph.js 的相机：Ry(yaw) -> Rx(pitch) -> translateZ(dist) -> 透视。
    返回的是「canvas 内坐标」，加 d['ox']/d['oy'] 才是视口坐标。"""
    cy, sy = math.cos(d["yaw"]), math.sin(d["yaw"])
    cp, sp = math.cos(d["pitch"]), math.sin(d["pitch"])
    X = x * cy + z * sy
    Z = -x * sy + z * cy
    # 书架会有一个整体竖直补偿 dy（加在旋转之后、透视之前），复算时必须带上
    Y2 = y * cp - Z * sp + d.get("dy", 0)
    Z2 = y * sp + Z * cp + d["dist"]
    k = d["f"] / (d["f"] - Z2)
    return d["cx"] + X * k, d["cy"] + Y2 * k, k, Z2



def shoot(br, path, lines=None, timeout=12.0):
    """截图，失败也不许把探针带崩。

    图形页一直在跑 rAF，无头 + 软件渲染下 `Page.captureScreenshot` 偶发**不返回**：
    它一挂就在那一行 traceback 掉，后面十几条断言全都不跑了。
    """
    for attempt in (1, 2):
        try:
            png = br.call("Page.captureScreenshot", {"format": "png"}, timeout)
        except Exception as exc:                      # noqa: BLE001
            if lines is not None:
                lines.append("      [诊断] 截图超时（第 %d 次，%s）"
                             % (attempt, type(exc).__name__))
            try:
                br._refront()
            except Exception:                         # noqa: BLE001
                pass
            time.sleep(0.4)
            continue
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(png["data"]))
        if lines is not None:
            lines.append("      截图 -> %s" % path)
        return True
    if lines is not None:
        lines.append("FAIL  截图失败：%s" % path)
    return False


def main():
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    os.makedirs(SHOTS, exist_ok=True)
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d/graph/" % PORT
    lines = []

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        return cond

    try:
        with cdp.Browser(url, port=DEBUG_PORT, window="1440,1500", wait_load=2.2) as br:
            br.call("Page.enable")
            # 舞台有 615px 高，窗口矮的话截图会被视口裁掉，先滚到中间
            br.evaluate(
                "document.getElementById('graph-stage')"
                ".scrollIntoView({block:'center',behavior:'instant'});true"
            )
            # 等 boot 跑完
            for _ in range(30):
                if br.evaluate("!!(window.__graph && window.__graph.debug().live)"):
                    break
                time.sleep(0.2)
            d = br.evaluate("window.__graph.debug()")
            ok(bool(d), "graph.js 已启动")
            if not d:
                raise SystemExit(1)

            ok(d["cards"] and len(d["cards"]) >= 10,
               "卡片数量 %d（文章 + 项目）" % len(d["cards"]))
            ok(d["links"] > 5, "关系弧线 %d 条" % d["links"])
            ok(d["labels"] >= 3, "标签浮标 %d 个" % d["labels"])
            ok(d["f"] > 0 and d["h"] > 100, "相机与舞台尺寸正常 f=%.0f %dx%d"
               % (d["f"], d["w"], d["h"]))

            # ---- 投影一致性：canvas 手算 vs 浏览器 CSS 3D ----
            # 卡片是 300x210 的矩形，斜着看时它的 AABB 中心并不等于"卡片中心的投影"，
            # 所以不能拿 getBoundingClientRect() 直接比。这里在 #world 里临时插一个
            # 0x0 的标记，逐个搬到卡片位置上量它的投影点 —— 这才是精确的同口径对比。
            snap = br.evaluate(
                "(function(){"
                "window.__graph.set({yaw:0.42,pitch:-0.06,zoom:1});"
                "var d=window.__graph.debug();"
                "var s=document.getElementById('graph-stage').getBoundingClientRect();"
                "var w=document.getElementById('graph-world');"
                "var m=document.createElement('div');"
                "m.style.cssText='position:absolute;left:0;top:0;width:0;height:0;margin:0;padding:0;';"
                "w.appendChild(m);"
                "var pts=d.cards.map(function(c){"
                "m.style.transform='translate3d('+c.x+'px,'+c.y+'px,'+c.z+'px)';"
                "var r=m.getBoundingClientRect();"
                "return [r.left,r.top];});"
                "w.removeChild(m);"
                "var els=document.querySelectorAll('.gcard');"
                "d.pts=pts; d.origin=[s.left,s.top];"
                "d.rects=Array.prototype.map.call(els,function(c){"
                "var r=c.getBoundingClientRect();"
                "return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,"
                "op:parseFloat(c.style.opacity||'1')};});"
                "return d;})()"
            )
            ox, oy = snap["ox"], snap["oy"]
            worst, worst_id, visible, outside = 0.0, "", 0, 0
            for i, c in enumerate(snap["cards"]):
                if i >= len(snap["pts"]):
                    break
                r = snap["rects"][i]
                if r["op"] <= 0.05 or r["w"] < 2:
                    continue
                visible += 1
                ex, ey, k, _z = project(snap, c["x"], c["y"], c["z"])
                ex += ox
                ey += oy
                mx, my = snap["pts"][i]
                dev = math.hypot(ex - mx, ey - my)
                if dev > worst:
                    worst, worst_id = dev, c["title"][:20]
                # 卡片矩形应该罩住这个投影点
                if not (r["l"] - 1 <= ex <= r["r"] + 1 and r["t"] - 1 <= ey <= r["b"] + 1):
                    outside += 1
            ok(visible >= 3, "有 %d 张卡片真正可见（其余被雾/朝向剔除）" % visible)
            ok(worst < 0.6, "投影与浏览器 CSS 3D 完全一致：最大偏差 %.3f px（%s）"
               % (worst, worst_id))
            ok(outside == 0, "每张卡片的包围盒都罩住了它的投影点（越界 %d）" % outside)

            # ---- 卡片不能互相叠在一起（用户报过「书重叠太多看不清」） ----
            # 同排相邻卡片是圆柱面上的两块切向面板，弧长间距必须 ≥ 卡片宽度 + 间隙；
            # 层与层的垂直间距必须 > 卡片高度。这里按投影后的外接矩形实测一遍。
            ov = br.evaluate(
                "(function(){"
                "var out=[];"
                "var els=[].slice.call(document.querySelectorAll('.gcard'));"
                "var rs=els.map(function(c){"
                "  return {r:c.getBoundingClientRect(),o:parseFloat(c.style.opacity||'1'),"
                "          t:(c.querySelector('.gcard-title')||{}).textContent||''};});"
                "for(var i=0;i<rs.length;i++){"
                "  if(rs[i].o<0.15||rs[i].r.width<8) continue;"
                "  for(var j=i+1;j<rs.length;j++){"
                "    if(rs[j].o<0.15||rs[j].r.width<8) continue;"
                "    var a=rs[i].r,b=rs[j].r;"
                "    var ox=Math.min(a.right,b.right)-Math.max(a.left,b.left);"
                "    var oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);"
                "    if(ox<=0||oy<=0) continue;"
                "    var area=ox*oy;"
                "    var small=Math.min(a.width*a.height,b.width*b.height);"
                "    if(area/small>0.02) out.push([Math.round(area/small*100),"
                "        rs[i].t.slice(0,12),rs[j].t.slice(0,12)]);"
                "  }}"
                "out.sort(function(p,q){return q[0]-p[0]});"
                "return out.slice(0,5);})()"
            )
            worst_ov = ov[0][0] if ov else 0
            ok(worst_ov <= 6, "可见卡片互不重叠（最大重叠 %d%%%s）"
               % (worst_ov, ("：" + str(ov[:3])) if ov else ""))

            # ---- 真的能用鼠标点进文章（用户报过「点击进入不了」） ----
            before = br.evaluate("location.pathname + location.search")
            spot = br.evaluate(
                "(function(){"
                "var cards=[].slice.call(document.querySelectorAll('.gcard'));"
                "var best=null,bw=0;"
                "cards.forEach(function(c){var r=c.getBoundingClientRect();"
                "  if(parseFloat(c.style.opacity||'1')>0.6 && r.width>bw &&"
                "     r.top>70 && r.bottom<window.innerHeight-30){bw=r.width;best=r;}});"
                "if(!best) return null;"
                "return {x:best.left+best.width/2,y:best.top+best.height/2};})()"
            )
            if not spot:
                ok(False, "找不到一张完全可见的卡片来做点击测试")
            else:
                hit = br.evaluate(
                    "(function(){var e=document.elementFromPoint(%f,%f);"
                    "var a=e?e.closest('a.gcard'):null;"
                    "return a?a.getAttribute('href'):null;})()" % (spot["x"], spot["y"]))
                ok(bool(hit), "卡片中心点命中的是 <a> 而不是遮罩（href=%s）" % hit)
                for t in ("mousePressed", "mouseReleased"):
                    br.call("Input.dispatchMouseEvent", {
                        "type": t, "x": spot["x"], "y": spot["y"], "button": "left",
                        "clickCount": 1,
                        "buttons": 1 if t == "mousePressed" else 0})
                    time.sleep(0.05)
                time.sleep(1.4)
                after = br.evaluate("location.pathname + location.search")
                ok(after != before, "真实鼠标点击能进入文章（%s -> %s）" % (before, after))
                if after != before:
                    br.call("Page.navigate", {"url": url})
                    time.sleep(2.2)

            # ---- 拖拽之后不应该误触发链接 ----
            d0 = br.evaluate(
                "(function(){var c=document.querySelector('.gcard');"
                "var r=c.getBoundingClientRect();"
                "return {x:r.left+r.width/2,y:r.top+r.height/2,href:c.getAttribute('href')};})()")
            u0 = br.evaluate("location.pathname")
            drag_to = br.evaluate(
                "(function(){var s=document.getElementById('graph-stage');"
                "var b=s.getBoundingClientRect();"
                "return {x:b.left+b.width*0.3,y:b.top+b.height*0.5};})()")
            br.call("Input.dispatchMouseEvent", {
                "type": "mousePressed", "x": d0["x"], "y": d0["y"],
                "button": "left", "clickCount": 1, "buttons": 1})
            for k in range(1, 6):
                br.call("Input.dispatchMouseEvent", {
                    "type": "mouseMoved",
                    "x": d0["x"] + (drag_to["x"] - d0["x"]) * k / 5.0,
                    "y": d0["y"], "button": "left", "buttons": 1})
                time.sleep(0.03)
            br.call("Input.dispatchMouseEvent", {
                "type": "mouseReleased", "x": drag_to["x"], "y": d0["y"],
                "button": "left", "clickCount": 1, "buttons": 0})
            time.sleep(1.0)
            ok(br.evaluate("location.pathname") == u0,
               "拖拽之后没有被误判成点击（还停在 %s）" % u0)

            # ---- 画布真的画了东西 ----
            lit = br.evaluate(
                "(function(){var c=document.getElementById('graph-canvas');"
                "var t=document.createElement('canvas');t.width=c.width;t.height=c.height;"
                "var x=t.getContext('2d');x.drawImage(c,0,0);"
                "var d=x.getImageData(0,0,t.width,t.height).data,n=0;"
                "for(var i=3;i<d.length;i+=4*53)if(d[i]>10)n++;return n;})()"
            )
            ok(lit > 60, "canvas 已绘制（%d 个非透明采样点）" % lit)

            # 书的本数 = 文章数 + 项目数，随内容更新而变。下面几条断言都要跟它比，
            # 不能写死：一加文章就全红，而它们真正想验证的只是「书没丢、能拖动」。
            n_books = br.evaluate("document.querySelectorAll('.gcard').length")
            ok(n_books >= 3, "书架里有 %d 本书" % n_books)

            # ---- 拖拽方向：必须是「直接抓取」（内容跟着手指走） ----
            # 用户要求过「上下左右反转一下」（原来拖右 = 内容左移，反直觉）。
            # 这里用**真实鼠标事件**分别往右、往下各拖一次，把方向钉死。
            #
            # 起点不能随便取：落在书脊上按下是「把书抽出来」，那是另一套手势，
            # 转书架不会有任何反应。原来固定在 8% 宽度处，书少的时候那里是空的，
            # 内容一多就被卡片盖住 —— 表现为「拖了半天 yaw 一直是 0」。
            # 所以从候选点里挑一个**不压在任何卡片上**的位置。
            def empty_point():
                return br.evaluate(
                    "(function(){var s=document.getElementById('graph-stage');"
                    "var b=s.getBoundingClientRect();"
                    "var cards=[].slice.call(document.querySelectorAll('.gcard'))"
                    ".map(function(c){return c.getBoundingClientRect();});"
                    "var cands=[];"
                    "for(var fx=0.05;fx<=0.95;fx+=0.05){"
                    "  for(var fy=0.08;fy<=0.92;fy+=0.06){"
                    "    var x=b.left+b.width*fx, y=b.top+b.height*fy, hit=false;"
                    "    for(var i=0;i<cards.length;i++){var r=cards[i];"
                    "      if(x>=r.left-14&&x<=r.right+14&&y>=r.top-14&&y<=r.bottom+14){hit=true;break;}}"
                    "    if(!hit) cands.push({x:x,y:y,d:Math.abs(fx-0.5)+Math.abs(fy-0.5)});"
                    "  }}"
                    "if(!cands.length) return null;"
                    "cands.sort(function(a,c){return a.d-c.d;});"
                    "return {x:cands[0].x,y:cands[0].y};})()")

            def drag_by(ddx, ddy):
                start = empty_point()
                if start is None:
                    return False
                br.call("Input.dispatchMouseEvent", {
                    "type": "mousePressed", "x": start["x"], "y": start["y"],
                    "button": "left", "clickCount": 1, "buttons": 1})
                for k in range(1, 7):
                    br.call("Input.dispatchMouseEvent", {
                        "type": "mouseMoved",
                        "x": start["x"] + ddx * k / 6.0,
                        "y": start["y"] + ddy * k / 6.0,
                        "button": "left", "buttons": 1})
                    time.sleep(0.02)
                br.call("Input.dispatchMouseEvent", {
                    "type": "mouseReleased", "x": start["x"] + ddx,
                    "y": start["y"] + ddy, "button": "left",
                    "clickCount": 1, "buttons": 0})
                time.sleep(0.55)
                return True

            br.evaluate("window.__graph.set({yaw:0,pitch:0,zoom:1})")
            time.sleep(0.2)
            ok(drag_by(160, 0), "找到一块没有书脊按得下去的空白")
            d = br.evaluate("window.__graph.debug()")
            ok(d["yaw"] > 0.2, "往右拖 -> 书架跟着往右（yaw %.3f > 0）" % d["yaw"])

            br.evaluate("window.__graph.set({yaw:0,pitch:0,zoom:1})")
            time.sleep(0.2)
            drag_by(0, 140)
            d = br.evaluate("window.__graph.debug()")
            ok(d["pitch"] < -0.15, "往下拖 -> 书架跟着往下（pitch %.3f < 0）" % d["pitch"])

            br.evaluate("window.__graph.set({yaw:0,pitch:0,zoom:1})")
            time.sleep(0.2)
            drag_by(-160, 0)
            d = br.evaluate("window.__graph.debug()")
            ok(d["yaw"] < -0.2, "往左拖 -> 书架跟着往左（yaw %.3f < 0）" % d["yaw"])

            # ---- 把书抽出来 + 松手归位（鼠标） ----
            def visible_book():
                return br.evaluate(
                    "(function(){"
                    "var best=null,bw=0;"
                    "[].slice.call(document.querySelectorAll('.gcard')).forEach(function(c){"
                    "  var r=c.getBoundingClientRect();"
                    "  if(parseFloat(c.style.opacity||'1')>0.7 && r.width>bw &&"
                    "     r.top>window.innerHeight*0.05 && r.bottom<window.innerHeight*0.95){"
                    "    bw=r.width;best={x:r.left+r.width/2,y:r.top+r.height/2};}});"
                    "return best;})()"
                )

            def pulled_title():
                return br.evaluate(
                    "(function(){var el=document.querySelector('.gcard.is-pulled');"
                    "if(!el) return null;"
                    "return (el.querySelector('.gcard-title')||{}).textContent.slice(0,12);})()"
                )

            br.evaluate("window.__graph.set({yaw:0,pitch:0,zoom:1})")
            time.sleep(0.3)
            book = visible_book()
            ok(bool(book), "找到一本完全可见的书用来做抽取测试")
            if book:
                br.call("Input.dispatchMouseEvent", {
                    "type": "mousePressed", "x": book["x"], "y": book["y"],
                    "button": "left", "clickCount": 1, "buttons": 1})
                for k in range(1, 7):
                    br.call("Input.dispatchMouseEvent", {
                        "type": "mouseMoved",
                        "x": book["x"] + 70 * k / 6.0, "y": book["y"] - 110 * k / 6.0,
                        "button": "left", "buttons": 1})
                    time.sleep(0.03)
                time.sleep(0.35)
                t = pulled_title()
                ok(bool(t), "按住拖动会把书**抽出来**（is-pulled：%s）" % t)
                # 这条是回归断言，不是锦上添花：书是 <a>，浏览器默认允许拖链接，
                # 一挪指针就会起原生拖放并甩一个 pointercancel 过来，
                # 「抽书」在第一帧就被掐死 —— 表现正好是「按下去纹丝不动」。
                held = br.evaluate("window.__graph.debug()")
                ok(held["grabbing"] is not None and held["captured"],
                   "拖住不放时抓取状态还在（grabbing=%s captured=%s dragDist=%.0f）"
                   % (held["grabbing"], held["captured"], held["dragDist"]))
                peak = held["pullMax"]
                ok(peak > 100, "抽出来的位移足够大（pullMax %.1f 世界单位）" % peak)
                now = br.evaluate(
                    "(function(){var el=document.querySelector('.gcard.is-pulled');"
                    "if(!el) return null;var r=el.getBoundingClientRect();"
                    "return Math.round(r.top);})()"
                )
                ok(now is not None and now < book["y"] - 25,
                   "抽出来的书跟着指针走（y %d -> %s）" % (round(book["y"]), now))
                br.call("Input.dispatchMouseEvent", {
                    "type": "mouseReleased", "x": book["x"] + 70, "y": book["y"] - 110,
                    "button": "left", "clickCount": 1, "buttons": 0})
                time.sleep(0.2)
                ok(pulled_title() is not None, "刚松手时还在回位过程中")
                # 回位必须是**弹簧**而不是瞬移：0.36s 时应该已经走掉大半、但还没归零，
                # 1.2s 之后才基本停住。判据用「位移还在，但比峰值小很多」。
                time.sleep(0.16)
                mid = br.evaluate("window.__graph.debug().pullMax")
                ok(peak * 0.02 < mid < peak * 0.75,
                   "回位是渐进的（峰值 %.0f -> 0.36s 时 %.1f）" % (peak, mid))
                time.sleep(2.8)
                ok(pulled_title() is None, "松手后书**弹回原位**（is-pulled 已清除）")
                n2 = br.evaluate("document.querySelectorAll('.gcard').length")
                # 书的本数就是「文章数 + 项目数」，会随内容更新而变 ——
                # 原来写死 12，加了几篇之后这条断言必然变红，而它想验证的其实只是
                # 「抽出一本再弹回去，没有把书架里的书弄丢」。所以跟页面上的总数比。
                ok(n2 == n_books, "回位后 %d 本书都还在（%d）" % (n_books, n2))
            # ---- 触屏：同一套抽取逻辑必须用手指也能走通 ----
            br.evaluate("window.__graph.set({yaw:0,pitch:0,zoom:1})")
            time.sleep(0.3)
            tb = visible_book()
            if tb:
                def touch(kind, points):
                    try:
                        br.call("Input.dispatchTouchEvent",
                                {"type": kind, "touchPoints": points}, 8.0)
                        return True
                    except Exception as exc:               # noqa: BLE001
                        lines.append("      [诊断] 触屏事件 %s 超时（%s）"
                                     % (kind, type(exc).__name__))
                        return False

                if touch("touchStart", [{"x": tb["x"], "y": tb["y"], "id": 1}]):
                    for k in range(1, 7):
                        touch("touchMove", [{"x": tb["x"] + 60 * k / 6.0,
                                             "y": tb["y"] - 90 * k / 6.0, "id": 1}])
                        time.sleep(0.03)
                    time.sleep(0.4)
                    ok(bool(pulled_title()), "触屏按住拖动同样能把书抽出来（%s）" % pulled_title())
                    touch("touchEnd", [])
                    time.sleep(2.8)
                    ok(pulled_title() is None, "触屏松手后同样归位")
                else:
                    ok(False, "触屏事件发不出去（无头环境偶发，见上面的诊断）")
            else:
                ok(False, "触屏测试找不到可见的书")

            # ---- 滚轮缩放 ----
            z0 = br.evaluate("window.__graph.debug().zoom")
            br.evaluate(
                "(function(){var s=document.getElementById('graph-stage');"
                "s.dispatchEvent(new WheelEvent('wheel',{deltaY:-240,bubbles:true,cancelable:true}));"
                "return true;})()"
            )
            time.sleep(0.4)
            z1 = br.evaluate("window.__graph.debug().zoom")
            ok(z1 > z0, "滚轮推拉镜头 zoom %.2f -> %.2f" % (z0, z1))

            # ---- 点标签聚焦 ----
            br.evaluate(
                "(function(){var b=document.querySelector('.graph-tag-chip');"
                "b.click();return true;})()"
            )
            time.sleep(0.6)
            d2 = br.evaluate("window.__graph.debug()")
            ok(bool(d2["focusTag"]), "点击标签图例进入聚焦（%s）" % d2["focusTag"])
            dim = sum(1 for c in d2["cards"] if "is-dim" in (c["cls"] or ""))
            ok(dim > 0, "非本标签的卡片被压暗（%d 张）" % dim)

            # ---- 搜索过滤 ----
            br.evaluate("document.getElementById('graph-reset').click()")
            time.sleep(0.3)
            br.evaluate(
                "(function(){var q=document.getElementById('graph-q');"
                "q.value='DDS';q.dispatchEvent(new Event('input',{bubbles:true}));return true;})()"
            )
            time.sleep(0.5)
            d3 = br.evaluate("window.__graph.debug()")
            dim3 = sum(1 for c in d3["cards"] if "is-dim" in (c["cls"] or ""))
            ok(d3["query"] == "DDS" and 0 < dim3 < len(d3["cards"]),
               "搜索 “DDS” 命中 %d / 压暗 %d" % (len(d3["cards"]) - dim3, dim3))

            # ---- 切布局 ----
            br.evaluate("document.getElementById('graph-reset').click()")
            time.sleep(0.2)
            posA = [(c["x"], c["y"], c["z"]) for c in br.evaluate("window.__graph.debug()")["cards"]]
            br.evaluate(
                "(function(){document.querySelector('#graph-layout button[data-val=nebula]').click();"
                "return true;})()"
            )
            time.sleep(0.6)
            d4 = br.evaluate("window.__graph.debug()")
            posB = [(c["x"], c["y"], c["z"]) for c in d4["cards"]]
            moved = sum(1 for a, b in zip(posA, posB)
                        if abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) > 40)
            ok(d4["layout"] == "nebula" and moved >= len(posA) - 1,
               "切到星云布局，%d/%d 张卡片换了位置" % (moved, len(posA)))
            ok(all(c["billboard"] for c in d4["cards"]), "星云布局下卡片改为始终面向镜头")

            # 截图（星云）
            shot = br.call("Page.captureScreenshot", {"format": "png"})
            p = os.path.join(SHOTS, "graph-nebula.png")
            with open(p, "wb") as fh:
                fh.write(base64.b64decode(shot["data"]))
            lines.append("      截图 -> %s" % p)

            # 回书架布局 + 固定视角再截一张
            br.evaluate(
                "(function(){document.querySelector('#graph-layout button[data-val=shelf]').click();"
                "window.__graph.set({yaw:0.4,pitch:-0.04,zoom:1});"
                "document.getElementById('graph-auto').click();"
                "return true;})()"
            )
            time.sleep(1.0)
            shot = br.call("Page.captureScreenshot", {"format": "png"})
            p2 = os.path.join(SHOTS, "graph-shelf.png")
            with open(p2, "wb") as fh:
                fh.write(base64.b64decode(shot["data"]))
            lines.append("      截图 -> %s" % p2)

            # 悬停一张「有关系」的卡片，看关联高亮与弧线
            br.evaluate(
                "(function(){var s=document.getElementById('graph-stage');"
                "var cards=[].slice.call(document.querySelectorAll('.gcard'));"
                "var best=cards[0];"
                "for(var i=0;i<cards.length;i++){"
                "  var t=(cards[i].getAttribute('data-tags')||'').split('|').filter(Boolean);"
                "  if(t.length> (best.getAttribute('data-tags')||'').split('|').length) best=cards[i];}"
                "var r=best.getBoundingClientRect();"
                "best.dispatchEvent(new PointerEvent('pointerover',{clientX:r.left+r.width/2,"
                "clientY:r.top+r.height/2,bubbles:true,pointerId:1}));return true;})()"
            )
            time.sleep(0.9)
            d5 = br.evaluate("window.__graph.debug()")
            hot = sum(1 for c in d5["cards"] if "is-hot" in (c["cls"] or ""))
            rel = sum(1 for c in d5["cards"] if "is-rel" in (c["cls"] or ""))
            ok(hot == 1, "悬停高亮生效（hot=%d）" % hot)
            ok(rel >= 1, "关联卡片被标出（rel=%d）" % rel)
            shot = br.call("Page.captureScreenshot", {"format": "png"})
            p3 = os.path.join(SHOTS, "graph-hover.png")
            with open(p3, "wb") as fh:
                fh.write(base64.b64decode(shot["data"]))
            lines.append("      截图 -> %s" % p3)

            # ---- 自定义指针 ----
            cur_mode = br.evaluate("document.documentElement.getAttribute('data-cursor')")
            ok(cur_mode not in (None, "", "off") and br.evaluate(
                "(function(){var c=document.querySelector('.cursor');"
                "return !!c && getComputedStyle(c).display !== 'none';})()"),
               "自定义指针默认开启（样式 %s）" % cur_mode)
            ok(br.evaluate("!!document.querySelector('.cursor')"), "指针元素已挂载")
    finally:
        httpd.shutdown()
        httpd.server_close()

    print("\n".join(lines))
    fails = [x for x in lines if x.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d" % (len([x for x in lines if x.startswith(("PASS", "FAIL"))]),
                                     len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
