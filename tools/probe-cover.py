#!/usr/bin/env python3
"""封面探针：文章/项目页的头图，以及列表页的卡片封面。

封面这块最容易「看着还行，其实不可读」：
标题压在图上，只要遮罩层不够重，换个封面就糊了 —— 而这种问题肉眼盯截图
看不出来（我这台机器上好看的图，访客那张不一定）。所以这里量**对比度**：
把文字临时藏起来截一张图，取标题所在那一块的背景平均色，
再和标题实际的颜色算 WCAG 对比度。

    python tools/probe-cover.py
"""
import base64
import functools
import http.server
import io
import json
import os
import socketserver
import sys
import threading
import time

for _s in (sys.stdout, sys.stderr):
    if _s.reconfigure:
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import cdp  # noqa: E402

PUBLIC = os.path.join(ROOT, "public")
PORT = 4198
WIDE = "/posts/dds-qos-tuning/"          # 2560x1440 的宽封面
SQUARE = "/posts/runnable-demos/"        # 240x240 的方图封面
LIST = "/posts/"

MIN_CONTRAST = 4.5


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


def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def parse_rgb(s):
    nums = [int(x) for x in s.replace("rgba(", "").replace("rgb(", "")
            .replace(")", "").split(",")[:3]]
    return tuple(nums)


def settle(br, frames=2):
    """等浏览器真的把这一帧画完再截图。

    固定 sleep 在机器忙的时候会截到**上一帧**，两张图一模一样，
    「换 object-position 有没有换裁切」就会假失败（批量跑探针时真出现过一次）。
    """
    br.evaluate("new Promise(function(r){var n=%d;(function t(){"
                "if(n--<=0){r(1);return;}requestAnimationFrame(t);})();})" % frames)
    time.sleep(0.12)


def band_diff(png_a, png_b, rect):
    """两张截图在同一个矩形里的**逐像素**平均差。

    比"平均颜色差多少"灵敏得多：换 object-position 只是把画面挪了一段，
    整块的平均色几乎不变（差 2~9），但逐像素一比就看得出来。
    完全没接上的话这个值恒等于 0。
    """
    from PIL import Image
    ia = Image.open(io.BytesIO(png_a)).convert("RGB")
    ib = Image.open(io.BytesIO(png_b)).convert("RGB")
    x = max(0, int(rect["x"]))
    y = max(0, int(rect["y"]))
    w = min(min(ia.width, ib.width) - x, max(1, int(rect["w"])))
    h = min(min(ia.height, ib.height) - y, max(1, int(rect["h"])))
    if w <= 0 or h <= 0:
        return None
    step = max(1, int((w * h / 20000) ** 0.5))       # 采样，别把整块像素都拉出来
    pa = ia.crop((x, y, x + w, y + h)).load()
    pb = ib.crop((x, y, x + w, y + h)).load()
    total = 0
    n = 0
    for yy in range(0, h, step):
        for xx in range(0, w, step):
            a = pa[xx, yy]
            b = pb[xx, yy]
            total += abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
            n += 1
    return (total / n) if n else None


def mean_color(png_bytes, rect):
    """截一张图，取某个矩形里的平均颜色（先把文字藏起来再截，见调用处）。"""
    from PIL import Image
    im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    x = max(0, int(rect["x"]))
    y = max(0, int(rect["y"]))
    w = min(im.width - x, max(1, int(rect["w"])))
    h = min(im.height - y, max(1, int(rect["h"])))
    if w <= 0 or h <= 0:
        return None
    crop = im.crop((x, y, x + w, y + h))
    # 取中位数比平均值稳：遮罩边缘、图片高光不会把结果带偏
    px = list(crop.getdata())
    px.sort(key=luminance)
    return px[len(px) // 2]


def main():
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    lines = []

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        return cond

    def hero_metrics(br):
        return json.loads(br.evaluate(
            "(function(){"
            "var h=document.querySelector('.phero');"
            "if(!h) return JSON.stringify({none:true});"
            "var t=h.querySelector('.phero-title');"
            "var img=h.querySelector('.phero-media img');"
            "var sc=h.querySelector('.phero-scrim');"
            "var cr=h.querySelector('.crumbs');"
            "var cs=getComputedStyle(h);"
            "var r=h.getBoundingClientRect(), tr=t.getBoundingClientRect();"
            "var ir=img?img.getBoundingClientRect():null;"
            "return JSON.stringify({"
            " cls:h.className,"
            " hero:{x:r.left,y:r.top,w:r.width,h:r.height},"
            " title:{x:tr.left,y:tr.top,w:tr.width,h:tr.height},"
            " titleColor:getComputedStyle(t).color,"
            " ledeColor:(function(){var l=h.querySelector('.phero-lede');"
            "   return l?getComputedStyle(l).color:'';})()"
            " ,crumbsColor:cr?getComputedStyle(cr).color:'',"
            " titleInside:(tr.top>=r.top-1&&tr.bottom<=r.bottom+1&&tr.left>=r.left-1),"
            " hasImg:!!img, imgLoaded:img?img.naturalWidth>0:false,"
            " objectFit:img?getComputedStyle(img).objectFit:'',"
            " objectPos:img?getComputedStyle(img).objectPosition:'',"
            " imgFilter:img?getComputedStyle(img).filter:'',"
            " imgW:img?img.getAttribute('width'):'', imgH:img?img.getAttribute('height'):'',"
            " imgFill:img?Math.round(ir.width/r.width*100):0,"
            " scrim:sc?getComputedStyle(sc).backgroundImage.slice(0,24):'',"
            " radius:cs.borderTopLeftRadius,"
            " minH:Math.round(r.height)"
            "});})()"))

    try:
        # ---------------- 头图：文字压在图上，且真的读得清 ----------------
        for path, label in ((WIDE, "宽封面"), (SQUARE, "方图封面")):
            with cdp.Browser("http://127.0.0.1:%d%s" % (PORT, path), port=9354,
                             window="1440,1100", wait_load=2.4) as br:
                time.sleep(1.3)
                for mode in ("dark", "light"):
                    br.evaluate("document.documentElement.setAttribute('data-mode','%s')" % mode)
                    time.sleep(0.6)
                    m = hero_metrics(br)
                    if m.get("none"):
                        ok(False, "%s（%s）：头图不存在" % (label, mode))
                        continue
                    tag = "%s · %s" % (label, mode)
                    ok("phero" in m["cls"] and "has-media" in m["cls"],
                       "%s：头图带封面（%s）" % (tag, m["cls"].strip()))
                    ok(m["hasImg"] and m["imgLoaded"], "%s：封面图已加载" % tag)
                    ok(m["objectFit"] == "cover", "%s：object-fit=cover" % tag)
                    ok(bool(m["objectPos"]), "%s：模板下发了 object-position（%s）"
                       % (tag, m["objectPos"]))
                    ok(bool(m["imgW"]) and bool(m["imgH"]),
                       "%s：带 width/height 占位（%sx%s）" % (tag, m["imgW"], m["imgH"]))
                    ok(m["imgFill"] >= 95, "%s：封面铺满整块头图（%d%%）" % (tag, m["imgFill"]))
                    ok(m["titleInside"], "%s：标题在头图内部（不是又掉回图下面）" % tag)
                    ok("gradient" in m["scrim"], "%s：有遮罩层" % tag)
                    ok(m["minH"] >= 280, "%s：头图够高（%dpx）" % (tag, m["minH"]))

                    # 真正的可读性：把文字藏起来，量它背后那块背景的实际颜色
                    bg = None
                    hid = br.evaluate(
                        "(function(){var i=document.querySelector('.phero-inner');"
                        "i.style.visibility='hidden';"
                        "var t=document.querySelector('.phero').getBoundingClientRect();"
                        "var r=document.querySelector('.phero-title').getBoundingClientRect();"
                        "var s=document.getElementById('graph-stage');"
                        "return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height});})()")
                    time.sleep(0.25)
                    settle(br)
                    shot = br.call("Page.captureScreenshot", {"format": "png"})
                    rect = json.loads(hid)
                    bg = mean_color(base64.b64decode(shot["data"]), rect)
                    br.evaluate("document.querySelector('.phero-inner').style.visibility=''")
                    if bg:
                        ct = contrast(parse_rgb(m["titleColor"]), bg)
                        ok(ct >= MIN_CONTRAST,
                           "%s：标题压在图上的对比度 %.2f:1（≥%.1f）  底色 rgb%s"
                           % (tag, ct, MIN_CONTRAST, bg))
                    else:
                        ok(False, "%s：取不到标题背后的背景色" % tag)

                    # 裁切焦点是不是真的接上了：换个 object-position，
                    # 渲染出来的像素必须变。只断言「属性有值」是测不出接线断没断的。
                    # 取样范围取**整块头图**而不是文字那一条：亮色模式下文字区被
                    # 94% 的纱压得很平，两张图几乎一模一样，会把这项测成假失败。
                    #
                    # 低分辨率封面（.is-soft）**跳过**这项：那条路径本来就把整张图
                    # blur(30px) 掉了，位置信息被模糊抹平，换焦点画面几乎不变 ——
                    # 这是设计如此，不是 bug。改成断言「确实走了模糊路径」。
                    if "is-soft" in m["cls"]:
                        ok("blur(" in m["imgFilter"],
                           "%s：低分辨率封面走模糊底图（filter=%s）"
                           % (tag, m["imgFilter"][:28]))
                    else:
                        band = json.loads(br.evaluate(
                            "(function(){var r=document.querySelector('.phero').getBoundingClientRect();"
                            "var h=document.querySelector('.phero-inner');h.style.visibility='hidden';"
                            "return JSON.stringify({x:r.left+4,y:r.top+4,w:r.width-8,h:r.height-8});})()"))
                        shots = []
                        raw = []
                        for pos in ("0% 0%", "100% 100%"):
                            br.evaluate(
                                "(function(){var i=document.querySelector('.phero-media img');"
                                "i.style.objectPosition='%s';})()" % pos)
                            settle(br)
                            s = br.call("Page.captureScreenshot", {"format": "png"})
                            raw.append(base64.b64decode(s["data"]))
                            shots.append(mean_color(raw[-1], band))
                        br.evaluate(
                            "(function(){var i=document.querySelector('.phero-media img');"
                            "i.style.objectPosition='%s';"
                            "document.querySelector('.phero-inner').style.visibility='';})()"
                            % m["objectPos"])
                        # 判据用**逐像素**差：整块平均色只差几个数（画面只是挪了一段），
                        # 逐像素一比就是几十上百；而接线断了的话它恒等于 0。
                        diff = band_diff(raw[0], raw[1], band)
                        ok(diff is not None and diff > 2.0,
                           "%s：改 object-position 真的会换裁切（逐像素差 %.2f，平均色 %s -> %s）"
                           % (tag, diff or 0, shots[0], shots[1]))

                    if path == WIDE:
                        # 截图留档（这时文字还是显示的）
                        br.evaluate(
                            "document.querySelector('.phero-inner').style.visibility='';")
                        time.sleep(0.3)
                        s = br.call("Page.captureScreenshot", {"format": "png"})
                        sp = os.path.join(ROOT, "_shots", "cover-hero-%s.png" % mode)
                        with open(sp, "wb") as fh:
                            fh.write(base64.b64decode(s["data"]))
                        lines.append("      截图 -> %s" % sp)

                # 没有封面时的兜底：把封面摘掉，看版面还在不在
                fb = json.loads(br.evaluate(
                    "(function(){var h=document.querySelector('.phero');"
                    "var img=h.querySelector('.phero-media');"
                    "if(img) img.remove();"
                    "h.classList.remove('has-media'); h.classList.add('is-plain');"
                    "var t=h.querySelector('.phero-title');"
                    "var cs=getComputedStyle(h);"
                    "return JSON.stringify({bg:cs.backgroundImage,"
                    "title:!!t, h:Math.round(h.getBoundingClientRect().height)});})()"))
                ok(fb["title"] and fb["h"] >= 280 and "gradient" in fb["bg"],
                   "%s：没有封面时退化成主题色头图（高 %dpx）" % (label, fb["h"]))
                shot = br.call("Page.captureScreenshot", {"format": "png"})
                p = os.path.join(ROOT, "_shots", "cover-%s.png" % (
                    "wide" if path == WIDE else "square"))
                with open(p, "wb") as fh:
                    fh.write(base64.b64decode(shot["data"]))
                lines.append("      截图 -> %s（无封面兜底）" % p)

        # ---------------- 卡片封面 ----------------
        with cdp.Browser("http://127.0.0.1:%d%s" % (PORT, LIST), port=9355,
                         window="1440,1200", wait_load=2.2) as br:
            time.sleep(1.3)
            cards = json.loads(br.evaluate(
                "(function(){"
                "var a=[].slice.call(document.querySelectorAll('.card-cover'));"
                "return JSON.stringify(a.map(function(c){"
                "var i=c.querySelector('img');"
                "return {fit:c.classList.contains('is-fit'),"
                " blur:!!c.querySelector('.card-cover-blur'),"
                " objectFit:getComputedStyle(i).objectFit,"
                " lazy:i.getAttribute('loading'),"
                " w:i.getAttribute('width'), h:i.getAttribute('height'),"
                " pos:i.style.objectPosition};}));})()"))
            ok(len(cards) >= 5, "列表页有 %d 张卡片封面" % len(cards))
            fit = [c for c in cards if c["fit"]]
            wide = [c for c in cards if not c["fit"]]
            # 首页现在挂的全是 16:9 的封面，「完整显示」那一路一张都不会出现 ——
            # 与其要求「必须存在方图」（内容一变就假红），不如断言**分类和图片比例一致**：
            # 比例 ≥1.5 走铺满裁切，否则走完整显示 + 模糊填充。
            def ratio(c):
                try:
                    return float(c["w"]) / float(c["h"])
                except (TypeError, ValueError, ZeroDivisionError):
                    return None

            mism = [c for c in cards
                    if ratio(c) is not None and bool(c["fit"]) != (ratio(c) < 1.5)]
            ok(not mism,
               "封面走哪种显示跟图片比例一致（不符 %d 张；宽 %d / 完整 %d）"
               % (len(mism), len(wide), len(fit)))
            ok(len(wide) >= 3, "宽封面走「铺满裁切」（%d 张）" % len(wide))
            ok(all(c["blur"] for c in fit), "完整显示的封面背后有模糊填充")
            ok(all(c["objectFit"] == "contain" for c in fit), "完整显示用的是 object-fit:contain")
            ok(all(c["objectFit"] == "cover" for c in wide), "宽封面用的是 object-fit:cover")
            ok(all(c["lazy"] == "lazy" for c in cards), "卡片封面都是懒加载")
            ok(all(c["w"] and c["h"] for c in cards),
               "卡片封面都带 width/height（避免图片到达时整屏跳动）")
            ok(all(c["pos"] for c in cards), "卡片封面都带 object-position")
    finally:
        httpd.shutdown()

    print("\n".join(lines))
    fails = [l for l in lines if l.startswith("FAIL")]
    print("\n  %d 项断言，失败 %d" % (len([l for l in lines if l.startswith(("PASS", "FAIL"))]),
                                     len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
