#!/usr/bin/env python3
"""插图与正文图诊断：SVG 有没有画出 viewBox 之外、图片有没有被裁掉。

「图表错位或者显示不全」这类问题肉眼要一张张翻才看得出来，但浏览器知道答案：

- **SVG 溢出 viewBox**：图上所有图元合起来的外接框（`getBBox()`）超出 `viewBox`，
  超出多少就会被裁掉多少 —— 表现为文字被切一半、箭头指到框外没了。
- **文字压线**：`<text>` 的框越过了 viewBox 边界。
- **图片被裁**：`object-fit: cover` 用在示意图上就会切掉两边；示意图应当完整显示。

    python tools/probe-figs.py
"""
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
PORT = 4193
BASE = "http://127.0.0.1:%d" % PORT

# 有插图的文档 + 有正文图的文章
PAGES = [
    "/docs/pointers/", "/docs/build-and-maintain/", "/docs/ros-sim/",
    "/docs/face-recognition/", "/docs/shell-and-languages/", "/docs/linux-c/",
    "/docs/mini-sh/", "/docs/c-to-cpp/", "/docs/python-first/",
    "/docs/ros-tools/", "/docs/ros-intro/",
    "/posts/quadruped-mpc-kinematics/", "/posts/parallel-ankle-kinematics/",
    "/posts/sam3-foundationpose-6d-pose/", "/posts/humanoid-0-to-1-toolchain/",
]

CHECK = r"""
(function(){
  var out = {svgs: [], imgs: [], nSvg: 0, nImg: 0};
  var prose = document.querySelector('.prose') || document.body;

  [].slice.call(prose.querySelectorAll('svg')).forEach(function(s){
    var vb = s.getAttribute('viewBox');
    if (!vb) return;
    // 只查「插图」。KaTeX 画拉伸括号会生成带 viewBox 的 svg，视频播放按钮、
    // 代码块折叠箭头、导航图标也都有 svg，它们溢出或变小都正常 ——
    // 一锅端会把真问题淹掉（第一版就是这么误报 20 条的）
    if (s.closest('.katex, .docvideo, .demo, .code-block')) return;
    var inFig = !!s.closest('figure, .docfig');
    if (!inFig && s.getBoundingClientRect().width < 180) return;
    out.nSvg++;
    var p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length !== 4 || p.some(isNaN)) return;
    var box;
    try { box = s.getBBox(); } catch (e) { return; }
    var R = 0.5;                       // 容差：抗锯齿与描边本身的半个像素
    var over = {
      l: Math.max(0, p[0] - (box.x - R)),
      t: Math.max(0, p[1] - (box.y - R)),
      r: Math.max(0, (box.x + box.width) - (p[0] + p[2]) - R),
      b: Math.max(0, (box.y + box.height) - (p[1] + p[3]) - R)
    };
    var worst = Math.max(over.l, over.t, over.r, over.b);
    // 文字单独看：图元溢出常常是无害的装饰，文字溢出来就是真的看不清了
    var tw = 0, tname = '';
    [].slice.call(s.querySelectorAll('text, tspan')).forEach(function(t){
      var tb; try { tb = t.getBBox(); } catch (e) { return; }
      var o = Math.max(p[0] - tb.x, p[1] - tb.y,
                       (tb.x + tb.width) - (p[0] + p[2]),
                       (tb.y + tb.height) - (p[1] + p[3]));
      if (o > tw) { tw = o; tname = (t.textContent || '').trim().slice(0, 24); }
    });
    var r = s.getBoundingClientRect();
    var wrap = s.closest('[data-fig]');
    out.svgs.push({vb: vb, worst: +worst.toFixed(1), textOver: +tw.toFixed(1),
                   text: tname, w: Math.round(r.width), h: Math.round(r.height),
                   fig: wrap ? wrap.getAttribute('data-fig') : '',
                   id: (s.getAttribute('class') || '') + (inFig ? '@fig' : '') });
  });

  [].slice.call(prose.querySelectorAll('img')).forEach(function(im){
    out.nImg++;
    var cs = getComputedStyle(im);
    var r = im.getBoundingClientRect();
    out.imgs.push({fit: cs.objectFit, nw: im.naturalWidth, nh: im.naturalHeight,
                   w: Math.round(r.width), h: Math.round(r.height),
                   src: (im.getAttribute('src') || '').slice(-42)});
  });
  return JSON.stringify(out);
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


def main():
    if not os.path.isdir(PUBLIC):
        print("!! 先运行 python tools/build.py")
        return 1
    os.makedirs(SHOTS, exist_ok=True)
    httpd = QuietServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=PUBLIC))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    lines, bad, port = [], [], 9400
    total_svg = total_img = 0

    def ok(cond, msg):
        lines.append(("PASS  " if cond else "FAIL  ") + msg)
        if not cond:
            bad.append(msg)
        return cond

    # 把 17 张插图全塞进一个临时页面：只靠「用到插图的文档」是覆盖不全的，
    # 有些图可能这一版没被任何文档引用，正好是漏网的那张。
    # 页面写完放在 public/ 下（探针的服务器只服务这个目录），跑完删掉。
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "docfigs", os.path.join(ROOT, "tools", "docfigs.py"))
    docfigs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(docfigs)
    names = sorted(docfigs.FIGURES)
    tmp_page = os.path.join(PUBLIC, "_figcheck.html")
    # 全部包在**同一个** .prose 里：CHECK 里用的是 querySelector('.prose')，
    # 一图一个 div 的话它只看得到第一张（第一版就是这样，17 张只查到 1 张还报了绿）
    body = "".join(docfigs.FIGURES[n]().render() for n in names)
    with open(tmp_page, "w", encoding="utf-8") as fh:
        fh.write('<!DOCTYPE html><html><head><meta charset="utf-8">'
                 '<link rel="stylesheet" href="/assets/site.css"></head>'
                 '<body style="margin:0;padding:20px">'
                 '<div class="prose docfig-all">' + body + "</div></body></html>")

    all_pages = list(PAGES)
    try:
        for path in all_pages + ["/_figcheck.html"]:
            window = "1280,1200" if path != "/_figcheck.html" else "1280,4000"
            with cdp.Browser(BASE + path, port=port, window=window,
                             wait_load=2.4) as br:
                port += 1
                time.sleep(0.9)
                # 幻灯片只渲染当前页，得逐页走一遍才看得到全部插图
                total_pages = br.evaluate(
                    "(window.__deck && window.__deck.state) ? "
                    "window.__deck.state().total : 0") or 0
                seen = {}
                for page in range(max(1, total_pages)):
                    if total_pages:
                        br.evaluate("window.__deck && window.__deck.go(%d)" % page)
                        time.sleep(0.18)
                    m = json.loads(br.evaluate(CHECK))
                    for s in m["svgs"]:
                        # 同一张插图会在多页幻灯片里重复出现，按「插图名 + viewBox + 最长文字」
                        # 归并，取最差的那次测量。键统一用元组：
                        # 混进一个字符串键的话，下面按 tuple 过滤会把它们全丢掉（踩过）
                        key = ("svg", s["fig"], s["vb"], s["text"])
                        if key not in seen or s["worst"] > seen[key]["worst"]:
                            seen[key] = s
                    for im in m["imgs"]:
                        seen[("img", im["src"])] = im
                svgs = [v for k, v in seen.items() if isinstance(k, tuple) and k[0] == "svg"]
                imgs = [v for k, v in seen.items() if isinstance(k, tuple) and k[0] == "img"]
                total_svg += len(svgs)
                total_img += len(imgs)

                over_svg = [s for s in svgs if s["worst"] > 1.5]
                over_txt = [s for s in svgs if s["textOver"] > 1.5]
                # 只对**画出来了**的图判「塌成一条线」：幻灯片里非当前页的图
                # 是 display:none，量出来天然是 0×0，那不是 bug
                zero = [s for s in svgs if 0 < s["w"] and (s["w"] < 80 or s["h"] < 50)]
                cropped = [i for i in imgs if i["fit"] == "cover"]
                tiny = [i for i in imgs
                        if i["nw"] and i["w"] > 0 and i["w"] > i["nw"] * 1.25]

                if svgs:
                    ok(not over_svg,                       "%s：%d 张 SVG 都没画出 viewBox%s"
                       % (path, len(svgs),
                          ("（超出：" + str([(s["id"], s["worst"]) for s in over_svg[:3]]) + "）")
                          if over_svg else ""))
                    ok(not over_txt,
                       "%s：SVG 里的文字都在框内%s"
                       % (path, ("（溢出：" + str([(s["text"], s["textOver"])
                                                  for s in over_txt[:3]]) + "）")
                          if over_txt else ""))
                    ok(not zero, "%s：没有塌成一条线的 SVG%s"
                       % (path, ("（" + str([(s["id"], s["w"], s["h"]) for s in zero[:3]]) + "）")
                          if zero else ""))
                if imgs:
                    ok(not cropped,
                       "%s：%d 张正文图都是完整显示（没有 object-fit:cover 裁边）%s"
                       % (path, len(imgs),
                          ("（被裁：" + str([i["src"] for i in cropped[:3]]) + "）")
                          if cropped else ""))
                    ok(not tiny, "%s：没有把小图硬拉大（会糊）%s"
                       % (path, ("（" + str([(i["src"], i["nw"], i["w"]) for i in tiny[:3]]) + "）")
                          if tiny else ""))
        print("      临时页覆盖了 %d 张内置插图：%s" % (len(names), "、".join(names)))
    finally:
        httpd.shutdown()
        try:
            os.remove(tmp_page)          # 别把探针的临时页留进部署产物
        except OSError:
            pass

    lines.append("      共检查 %d 张 SVG、%d 张正文图" % (total_svg, total_img))
    print("\n".join(lines))
    print("\n  %d 项断言，失败 %d"
          % (len([x for x in lines if x.startswith(("PASS", "FAIL"))]), len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
