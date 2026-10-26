#!/usr/bin/env python3
"""文档里的插图：用**内联 SVG** 现画，不走图片文件。

为什么不用 png/svg 文件：
  · 站内有两套明暗配色。`<img>` 里的 SVG 拿不到 CSS 变量，一张图不可能
    在 #0b1020 和 #efebe4 两种底上都好看；内联之后笔画直接用 var(--text-3)、
    var(--accent)，跟着主题走。
  · 磁盘上不放二进制，改一个数字就能重画；分辨率也无所谓，投影/放大都不糊。
  · mdparse 允许整块原始 HTML 透出，所以 deck 里直接放 `<figure>` 就行。

用法：在 `content/docs/*.md` 里写一行 `<!--fig:名字-->`，
构建时由 build.load_docs 展开（见 tools/build.py 的 expand_figures）。

    python tools/docfigs.py --list           # 有哪些图
    python tools/docfigs.py memory-layout    # 单张图输出 SVG（浏览器里打开看）
    python tools/docfigs.py --check          # 校验素材内容里引用的图都存在
"""
from __future__ import annotations

import hashlib
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- SVG 小工具

class Fig:
    """一个固定的画布 + 几个画方框/箭头/文字的方法。

    坐标是画布坐标（viewBox），字号也是画布单位 —— SVG 会等比缩放，
    所以在幻灯片里永远和周围的字一个比例。
    """

    def __init__(self, name: str, w: int, h: int, caption: str):
        self.name = name
        self.w, self.h = w, h
        self.caption = caption
        # 每张图一个独立前缀：同一页上放好几张图时，marker/filter 的 id 不能撞
        self.uid = "f" + hashlib.sha1(name.encode("utf-8")).hexdigest()[:7]
        self.parts: list[str] = []

    # -- 图元 ---------------------------------------------------------
    def rect(self, x, y, w, h, label="", kind="", sub="", rx=9, fs=15, mono=False):
        cls = "fg-box" + ((" is-" + kind) if kind else "")
        self.parts.append(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" '
                          f'height="{h}" rx="{rx}"/>')
        if label:
            cx = x + w / 2
            if sub:
                self.text(cx, y + h / 2 - 8, label, fs=fs, mono=mono)
                self.text(cx, y + h / 2 + 13, sub, cls="fg-s", fs=fs - 3)
            else:
                self.text(cx, y + h / 2, label, fs=fs, mono=mono)

    def text(self, x, y, s, cls="fg-t", fs=None, anchor="middle", mono=False):
        # SVG 的 <text> 里没有 Markdown。写进去的 `**` 会原样显示成两个星号，
        # 而且会被 check-site 的「未解析 Markdown 标记」检查抓出来。
        s = str(s).replace("**", "").replace("`", "")
        style = f' font-size="{fs}"' if fs else ""
        family = ' font-family="var(--font-mono)"' if mono else ""
        self.parts.append(f'<text class="{cls}" x="{x}" y="{y}" '
                          f'text-anchor="{anchor}"{style}{family}>{_esc(s)}</text>')

    def line(self, x1, y1, x2, y2, kind="", dash=False):
        cls = "fg-line" + ((" is-" + kind) if kind else "")
        d = ' stroke-dasharray="5 5"' if dash else ""
        self.parts.append(f'<line class="{cls}" x1="{x1}" y1="{y1}" '
                          f'x2="{x2}" y2="{y2}"{d}/>')

    def path(self, d, kind="", dash=False, fill="none"):
        cls = "fg-line" + ((" is-" + kind) if kind else "")
        da = ' stroke-dasharray="5 5"' if dash else ""
        self.parts.append(f'<path class="{cls}" d="{d}" fill="{fill}"{da}/>')

    def arrow(self, x1, y1, x2, y2, label="", kind="", dash=False,
              lx=None, ly=None, bend=0):
        """带箭头的连线。bend 不为 0 时走一条二次贝塞尔弧（画反馈回路用）。"""
        da = ' stroke-dasharray="5 5"' if dash else ""
        cls = "fg-line" + ((" is-" + kind) if kind else "")
        if bend:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            nx, ny = -(y2 - y1), (x2 - x1)
            ln = (nx * nx + ny * ny) ** 0.5 or 1
            cx, cy = mx + nx / ln * bend, my + ny / ln * bend
            d = f"M {x1} {y1} Q {cx} {cy} {x2} {y2}"
        else:
            d = f"M {x1} {y1} L {x2} {y2}"
        self.parts.append(f'<path class="{cls}" d="{d}" fill="none" '
                          f'marker-end="url(#{self.uid}-a)"{da}/>')
        if label:
            self.text(lx if lx is not None else (x1 + x2) / 2,
                      ly if ly is not None else (y1 + y2) / 2 - 7,
                      label, cls="fg-s", fs=12)

    def chip(self, x, y, w, h, label, kind=""):
        cls = "fg-chip" + ((" is-" + kind) if kind else "")
        self.parts.append(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" '
                          f'height="{h}" rx="{h / 2}"/>')
        self.text(x + w / 2, y + h / 2, label, cls="fg-chip-t", fs=12)

    def note(self, x, y, s, fs=12):
        self.text(x, y, s, cls="fg-note", fs=fs, anchor="start")

    # -- 输出 ---------------------------------------------------------
    def render(self, inner_only: bool = False) -> str:
        body = "\n  ".join(self.parts)
        svg = (
            f'<svg class="docfig" viewBox="0 0 {self.w} {self.h}" '
            f'xmlns="http://www.w3.org/2000/svg" role="img" '
            f'aria-label="{_esc(self.caption)}">\n'
            f'  <defs><marker id="{self.uid}-a" viewBox="0 0 10 10" refX="9" refY="5" '
            f'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
            f'<path d="M 0 0 L 10 5 L 0 10 z" class="fg-head"/></marker></defs>\n'
            f'  {body}\n</svg>'
        )
        if inner_only:
            return svg
        return (f'<figure class="docfig-wrap" data-fig="{self.name}">\n{svg}\n'
                f'<figcaption>{_esc(self.caption)}</figcaption>\n</figure>')


def _esc(s: str) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


# ================================================================= 插图
# 每张图一个函数，返回 Fig。内容与教程正文一一对应。

def fig_memory_layout() -> Fig:
    """进程的虚拟地址空间：栈往下长、堆往上长。"""
    f = Fig("memory-layout", 760, 560,
            "常见进程地址空间示意；具体布局与增长方向依赖平台，不是 C 语言保证")
    x, w = 210, 320
    rows = [
        ("内核空间", "0xFFFF…", "", 46, "fg-muted"),
        ("栈 stack", "函数局部变量、返回地址 · 往下增长", "↓", 74, ""),
        ("", "", "", 34, "gap"),
        ("共享库 / mmap", "libc、动态链接进来的代码", "", 46, ""),
        ("", "", "", 30, "gap"),
        ("堆 heap", "malloc / new 拿到的内存 · 往上增长", "↑", 74, ""),
        ("BSS", "未初始化的全局/静态变量", "", 46, ""),
        ("数据段 data", "已初始化的全局/静态变量", "", 46, ""),
        ("代码段 text", "机器指令 · 只读、可执行", "", 46, "accent"),
        ("", "", "", 22, "gap"),
        ("0x0000…", "", "", 22, "fg-muted"),
    ]
    y = 26
    for label, sub, arrow, h, kind in rows:
        if kind == "gap":
            y += h
            continue
        if kind == "fg-muted":
            f.text(x + w / 2, y + h / 2, label, cls="fg-s", fs=13)
            f.line(x, y + h - 6, x + w, y + h - 6, dash=True)
            y += h
            continue
        f.rect(x, y, w, h, label, kind=kind)
        if sub:
            f.text(x + w / 2, y + h - 15, sub, cls="fg-s", fs=12)
        if arrow:
            f.text(x + w + 26, y + h / 2, arrow, cls="fg-t", fs=20)
        y += h
    # 左右两侧的“往哪边长”提示
    f.arrow(x - 34, 96, x - 34, 176, bend=0)
    f.text(x - 46, 136, "栈向下", cls="fg-s", fs=12, anchor="end")
    f.arrow(x - 34, 380, x - 34, 330)
    f.text(x - 46, 356, "堆向上", cls="fg-s", fs=12, anchor="end")
    f.note(80, 548, "平台示意：动态分配也可使用 mmap；实际布局不由 C 语言统一规定。")
    return f


def fig_pointer_array() -> Fig:
    """数组名、指针、地址三者关系。"""
    f = Fig("pointer-array", 780, 330,
            "数组在多数表达式中转换为首元素指针；sizeof 和取地址等语境例外")
    # 内存格子
    cell_w, y = 84, 120
    x0 = 250
    for i in range(4):
        f.rect(x0 + i * cell_w, y, cell_w, 64, f"x[{i}]", kind="accent" if i == 0 else "")
        f.text(x0 + i * cell_w + cell_w / 2, y + 46, f"{114 + i * 400}", cls="fg-s", fs=12)
        f.text(x0 + i * cell_w + cell_w / 2, y + 82, f"0x7ffd{0x10 + i * 4:03x}",
               cls="fg-note", fs=11)
    f.text(x0 + 2 * cell_w, y - 34, "int x[4]：4 个元素；此图假设 sizeof(int) = 4",
           cls="fg-s", fs=12)
    f.text(x0 - 18, y + 32, "x →", cls="fg-t", fs=15, anchor="end")

    # 指针变量
    f.rect(60, 220, 190, 64, "int *p", kind="accent2")
    f.text(155, 268, "p 自己也有地址", cls="fg-s", fs=11)
    f.arrow(155, 220, x0 + 10, 118, label="p 里存的值 = x 的地址")
    f.text(60, 200, "指针是一个变量", cls="fg-s", fs=12, anchor="start")
    f.note(60, 312, "x 不是指针：它没有另存地址的格子，它就是那块内存本身。")
    return f


def fig_shell_loop() -> Fig:
    """shell 的 REPL 循环与 fork/exec/wait。"""
    f = Fig("shell-loop", 800, 400,
            "shell 的主循环：读一行 → 分词 → fork → 子进程 exec → 父进程 wait")
    f.rect(40, 40, 150, 62, "提示符", "accent")
    f.rect(230, 40, 150, 62, "读一行", "")
    f.rect(420, 40, 170, 62, "分词 / 展开", "")
    f.rect(630, 40, 130, 62, "内建命令？", "accent2")
    f.arrow(190, 71, 228, 71)
    f.arrow(380, 71, 418, 71)
    f.arrow(590, 71, 628, 71)
    f.text(695, 130, "是 → 直接执行（cd / export）", cls="fg-s", fs=12)
    f.arrow(695, 102, 695, 150)
    f.path("M 695 150 Q 760 190 700 220", kind="accent2")
    f.text(760, 196, "回到提示符", cls="fg-s", fs=11, anchor="end")

    f.text(300, 130, "否 ↓", cls="fg-s", fs=12)
    f.rect(230, 160, 170, 62, "fork()", "accent")
    f.rect(450, 160, 170, 62, "execvp()", "")
    f.rect(230, 260, 170, 62, "wait()", "")
    f.arrow(400, 191, 448, 191)
    f.arrow(535, 222, 535, 260)
    f.arrow(450, 291, 402, 291)
    f.text(596, 250, "子进程被换成新程序，", cls="fg-s", fs=12, anchor="start")
    f.text(596, 268, "进程号不变、内存全换", cls="fg-s", fs=12, anchor="start")
    f.arrow(315, 260, 315, 104)
    f.text(150, 186, "父进程", cls="fg-s", fs=12, anchor="start")
    f.text(560, 186, "子进程", cls="fg-s", fs=12, anchor="start")
    f.note(40, 360, "内建命令为什么必须自己实现：cd 改的是当前进程的工作目录，"
                    "子进程里改了，父进程看不见。")
    return f


def fig_pipe_fd() -> Fig:
    """管道与文件描述符。"""
    f = Fig("pipe-fd", 800, 300,
            "管道是一条内核缓冲区，两端各是一个文件描述符；dup2 把它接到 0/1 上")
    f.rect(40, 120, 150, 70, "进程 A", "accent")
    f.rect(610, 120, 150, 70, "进程 B", "accent")
    f.text(400, 66, "内核里的管道缓冲区", cls="fg-s", fs=13)
    f.rect(250, 82, 300, 42, "", "accent2", rx=21)
    f.arrow(190, 140, 248, 116)
    f.text(216, 158, "写端 fd 4", cls="fg-s", fs=11)
    f.arrow(552, 116, 608, 140)
    f.text(586, 158, "读端 fd 3", cls="fg-s", fs=11)
    f.rect(250, 190, 300, 60, "pipe(fd) → fd[0] 读 / fd[1] 写", "", rx=9)
    f.arrow(400, 190, 400, 128)
    f.text(40, 250, "A 里：dup2(fd[1], 1)  → A 的 stdout 变成管道写端", cls="fg-s",
           fs=12, anchor="start")
    f.text(40, 274, "B 里：dup2(fd[0], 0)  → B 的 stdin  变成管道读端", cls="fg-s",
           fs=12, anchor="start")
    return f


def fig_build_flow() -> Fig:
    """从 .c 到可执行文件。"""
    # 6 个方框 + 5 段箭头要塞进 820 宽：方框 112、步进 133，
    # 30 + 6*112 + 5*21 = 807，右边还剩 13 的余量。
    # 原来按 118 / 142 排，最后一个方框画到 858、标签中心在 799 —— 都被 viewBox
    # 切掉了（`probe-figs.py` 量出来图形溢出 37.5、文字溢出 9）。
    f = Fig("build-flow", 820, 250,
            "四步：预处理 → 编译 → 汇编 → 链接；每一步都是一次独立的程序调用")
    steps = [
        ("foo.c", "", "源文件", "fg-muted"),
        ("预处理", "cpp", "展开宏与 #include", ""),
        ("编译", "cc1", "C → 汇编", ""),
        ("汇编", "as", "汇编 → 目标文件", ""),
        ("链接", "ld", "合并目标文件与库", "accent"),
        ("a.out", "", "可执行文件", "accent2"),
    ]
    BOX_W, STEP = 112, 133
    x = 30
    for i, (name, tool, sub, kind) in enumerate(steps):
        f.rect(x, 70, BOX_W, 76, name, kind=kind, sub=(tool if tool else sub))
        if not tool:
            f.text(x + BOX_W // 2, 170, sub, cls="fg-s", fs=11)
        else:
            f.text(x + BOX_W // 2, 170, tool, cls="fg-note", fs=11)
        if i < len(steps) - 1:
            f.arrow(x + BOX_W, 108, x + STEP, 108)
        x += STEP
    f.note(30, 216, "平时说的「编译」其实只是第 2 步；gcc 是个驱动器，四步它都替你调。")
    return f


def fig_cmake_flow() -> Fig:
    """CMake / Make / 编译器的分工。"""
    f = Fig("cmake-flow", 800, 330,
            "CMake 读 CMakeLists.txt 生成构建文件，Make/Ninja 读构建文件调编译器")
    f.rect(40, 60, 180, 74, "CMakeLists.txt", "", sub="你写的")
    f.rect(300, 60, 200, 74, "CMake", "accent", sub="生成器")
    f.rect(580, 60, 180, 74, "Makefile / build.ninja", "", sub="生成物")
    f.rect(300, 190, 200, 74, "make / ninja", "accent2", sub="调度器")
    f.rect(580, 190, 180, 74, "编译器 / 链接器", "", sub="真正干活")
    f.arrow(220, 97, 298, 97)
    f.arrow(500, 97, 578, 97)
    f.arrow(670, 134, 670, 160)
    f.path("M 670 160 L 400 160 L 400 188", kind="accent2")
    f.arrow(500, 227, 578, 227)
    f.note(40, 300, "只写 Makefile 也能活，但换平台/换编译器时 CMake 帮你把差异吃掉。")
    return f


def fig_ros_graph() -> Fig:
    """ROS 2 的计算图。"""
    f = Fig("ros-graph", 820, 400,
            "ROS 2 的计算图：节点之间靠话题（多对多）、服务（一问一答）、动作（长任务）连接")
    f.rect(40, 60, 170, 70, "摄像头节点", "accent")
    f.rect(40, 190, 170, 70, "激光雷达节点", "accent")
    f.rect(320, 120, 180, 76, "/image_raw", "accent2", rx=38, sub="话题 · 多对多")
    f.rect(620, 60, 170, 70, "感知节点", "")
    f.rect(620, 190, 170, 70, "建图节点", "")
    f.arrow(210, 95, 318, 140)
    f.arrow(210, 225, 318, 176)
    f.arrow(500, 140, 618, 95)
    f.arrow(500, 176, 618, 225)
    f.rect(320, 270, 180, 70, "/reset_map", "accent2", rx=38, sub="服务 · 一问一答")
    f.arrow(795, 270, 700, 300, bend=30)
    f.text(640, 330, "控制器请求", cls="fg-s", fs=11)
    return f


def fig_ros_qos() -> Fig:
    """QoS 匹配。"""
    f = Fig("ros-qos", 800, 340,
            "QoS 不匹配时连接根本建立不起来：RELIABLE 的订阅者接不上 BEST_EFFORT 的发布者")
    f.rect(50, 60, 250, 130, "", "accent")
    f.text(175, 92, "发布者", cls="fg-t", fs=15)
    f.text(175, 120, "best_effort · depth 10", cls="fg-s", fs=12)
    f.text(175, 146, "volatile · 保留最近 10 条", cls="fg-s", fs=12)
    f.text(175, 172, "deadline 10 ms", cls="fg-s", fs=12)

    f.rect(500, 60, 250, 130, "", "accent2")
    f.text(625, 92, "订阅者", cls="fg-t", fs=15)
    f.text(625, 120, "reliable · volatile", cls="fg-s", fs=12)
    f.text(625, 146, "keep_last 1", cls="fg-s", fs=12)
    f.text(625, 172, "deadline 10 ms", cls="fg-s", fs=12)

    f.line(300, 125, 500, 125, dash=True)
    f.text(400, 112, "✗ 不兼容", cls="fg-t", fs=14)
    f.text(400, 150, "可靠性要求未满足", cls="fg-s", fs=11)

    f.rect(50, 230, 250, 80, "发布方需满足订阅方要求", "accent2", rx=9)
    f.text(560, 250, "反向组合：reliable → best_effort 兼容", cls="fg-s", fs=12, anchor="middle")
    f.text(560, 274, "depth 控制缓存，不是端点兼容条件", cls="fg-s", fs=12, anchor="middle")
    f.text(560, 298, "不兼容可通过 QoS 事件检测", cls="fg-s", fs=12, anchor="middle")
    return f


def fig_ros_tf() -> Fig:
    """tf2 的坐标树。"""
    f = Fig("ros-tf", 800, 340,
            "tf2 维护一棵坐标树：任何两个坐标系之间的变换都可以沿树算出来，且不能有环")
    f.rect(330, 40, 140, 60, "map", "accent")
    f.rect(330, 140, 140, 60, "odom", "")
    f.rect(330, 240, 140, 60, "base_link", "accent2")
    f.rect(120, 240, 150, 60, "laser_frame", "")
    f.rect(540, 240, 150, 60, "camera_link", "")
    f.arrow(400, 100, 400, 138)
    f.arrow(400, 200, 400, 238)
    f.arrow(330, 270, 272, 270)
    f.arrow(470, 270, 538, 270)
    f.text(214, 232, "静态变换", cls="fg-s", fs=11)
    f.text(504, 232, "静态变换", cls="fg-s", fs=11)
    f.text(414, 122, "定位 / AMCL", cls="fg-s", fs=11, anchor="start")
    f.text(414, 222, "里程计", cls="fg-s", fs=11, anchor="start")
    f.note(40, 322, "要 base_link ← camera_link 的变换？沿树一路乘过去就行，"
                    "不用关心中间经过谁。")
    return f


def fig_sim_loop() -> Fig:
    """仿真步进循环。"""
    f = Fig("sim-loop", 800, 320,
            "仿真循环：物理步进 → 推进仿真时钟 → 发布传感器数据 → 执行器指令回灌")
    steps = [
        (60, 70, "读指令", "订阅 cmd_vel", "accent2"),
        (250, 70, "物理步进", "dt = 1 ms", "accent"),
        (440, 70, "推进时钟", "仿真时间 +dt", ""),
        (630, 70, "发传感器", "相机 / IMU / 里程计", ""),
    ]
    for x, y, name, sub, kind in steps:
        f.rect(x, y, 150, 84, name, kind=kind, sub=sub)
    f.arrow(210, 112, 248, 112)
    f.arrow(400, 112, 438, 112)
    f.arrow(590, 112, 628, 112)
    f.path("M 705 154 L 705 230 L 135 230 L 135 156", kind="accent")
    f.arrow(135, 230, 135, 158)
    f.text(420, 254, "回灌到下一步；固定步长便于复现，数值稳定性仍需验证",
           cls="fg-s", fs=12)
    f.note(60, 296, "真实时间是墙上的钟；仿真时间是仿真器自己数的。"
                    "两者不一致，控制器就必须按仿真时间工作。")
    return f


def fig_urdf_tree() -> Fig:
    """URDF 的 link / joint 树。"""
    f = Fig("urdf-tree", 800, 340,
            "URDF 是一棵树：link 是刚体，joint 连接父子 link 并给出类型与轴")
    f.rect(320, 40, 160, 56, "base_link", "accent")
    f.rect(120, 150, 150, 56, "wheel_left", "")
    f.rect(320, 150, 160, 56, "torso_link", "")
    f.rect(540, 150, 150, 56, "wheel_right", "")
    f.rect(320, 260, 160, 56, "head_link", "accent2")
    f.arrow(360, 96, 220, 148)
    f.arrow(400, 96, 400, 148)
    f.arrow(440, 96, 580, 148)
    f.arrow(400, 206, 400, 258)
    f.text(258, 116, "continuous", cls="fg-s", fs=11)
    f.text(412, 126, "fixed", cls="fg-s", fs=11, anchor="start")
    f.text(548, 116, "continuous", cls="fg-s", fs=11)
    f.text(412, 240, "revolute", cls="fg-s", fs=11, anchor="start")
    f.note(120, 330, "每个 joint 描述三件事：父子是谁、绕哪根轴、限位多少。")
    return f


def fig_image_pixels() -> Fig:
    """图像在计算机里是三维数组。"""
    f = Fig("image-pixels", 800, 320,
            "一张彩色图 = 高 × 宽 × 通道的三维数组；OpenCV 里通道顺序是 BGR")
    f.rect(60, 60, 200, 190, "", "accent", rx=6)
    for i in range(5):
        f.line(60, 60 + (i + 1) * 190 / 6, 260, 60 + (i + 1) * 190 / 6, dash=True)
        f.line(60 + (i + 1) * 200 / 6, 60, 60 + (i + 1) * 200 / 6, 250, dash=True)
    f.text(160, 278, "img[y, x]", cls="fg-s", fs=12)
    f.text(160, 44, "一个像素", cls="fg-s", fs=12)

    f.arrow(262, 155, 330, 155, label="取一个像素")

    f.rect(340, 92, 60, 120, "B", "accent2")
    f.rect(408, 92, 60, 120, "G", "accent2")
    f.rect(476, 92, 60, 120, "R", "accent2")
    f.text(438, 240, "img[y, x, :]", cls="fg-s", fs=12)
    f.text(438, 74, "0~255", cls="fg-note", fs=11)

    f.rect(580, 92, 180, 120, "shape = (H, W, C)", "", rx=9)
    f.text(670, 132, "灰度通常为 (H, W)", cls="fg-s", fs=12)
    f.text(670, 158, "彩色图 C = 3", cls="fg-s", fs=12)
    f.text(670, 184, "带 alpha 是 4", cls="fg-s", fs=12)
    f.note(60, 306, "坑：OpenCV 读进来是 BGR，matplotlib / PIL 是 RGB。"
                    "直接互传会得到一张红蓝互换的图。")
    return f


def fig_conv_kernel() -> Fig:
    """卷积核在图像上滑动。"""
    f = Fig("conv-kernel", 780, 330,
            "卷积：一个 3×3 的核在图上滑动，每个位置做加权求和，结果写进输出图的对应像素")
    def grid(x0, y0, n, cell, hi=None, label=""):
        for r in range(n):
            for c in range(n):
                on = hi and hi[0] <= r < hi[0] + hi[2] and hi[1] <= c < hi[1] + hi[3]
                f.parts.append(
                    f'<rect class="fg-cell{" is-hi" if on else ""}" x="{x0 + c * cell}" '
                    f'y="{y0 + r * cell}" width="{cell}" height="{cell}"/>')
        f.parts.append(f'<rect class="fg-grid" x="{x0}" y="{y0}" width="{n * cell}" '
                       f'height="{n * cell}"/>')
        if label:
            f.text(x0 + n * cell / 2, y0 + n * cell + 22, label, cls="fg-s", fs=12)
    grid(50, 60, 6, 30, hi=(1, 2, 3, 3), label="输入 H×W")
    grid(320, 90, 3, 30, label="3×3 卷积核")
    f.arrow(280, 150, 318, 150)
    f.text(299, 138, "滑动", cls="fg-s", fs=11)
    grid(520, 60, 4, 30, hi=(0, 0, 1, 1), label="输出 (H-2)×(W-2)")
    f.arrow(440, 150, 518, 150)
    f.note(50, 300, "示意步幅 1、无填充的 3×3 滤波；filter2D 默认保留尺寸，并计算相关运算。")
    return f


def fig_face_pipeline() -> Fig:
    """人脸识别流水线。"""
    f = Fig("face-pipeline", 840, 300,
            "人脸识别分四步：检测框 → 对齐 → 提特征 → 比对；每一步的失败都会一路传下去")
    steps = [
        ("检测", "找到人脸框", "Haar / DNN", "accent"),
        ("对齐", "按关键点摆正", "5 点仿射", ""),
        ("提特征", "变成 128/512 维向量", "FaceNet 类", "accent2"),
        ("比对", "算余弦距离", "阈值判定", "accent"),
    ]
    x = 30
    for name, sub, tool, kind in steps:
        f.rect(x, 70, 180, 96, name, kind=kind)
        f.text(x + 90, 108, sub, cls="fg-s", fs=12)
        f.text(x + 90, 132, tool, cls="fg-note", fs=11)
        if x < 640:
            f.arrow(x + 180, 118, x + 208, 118)
        x += 208
    f.note(30, 216, "检测和识别是两件事：检测回答「脸在哪」，识别回答「这是谁」。")
    f.text(30, 250, "对齐方式、输入尺寸和归一化必须遵循模型约定；每一步都应单独验证。",
           cls="fg-s", fs=12, anchor="start")
    return f


def fig_py_object() -> Fig:
    """Python 的名字与对象。"""
    f = Fig("py-object", 780, 300,
            "Python 的变量是「名字」，赋值是把名字绑到对象上；同一个对象可以有多个名字")
    f.rect(50, 60, 130, 56, "a", "accent")
    f.rect(50, 170, 130, 56, "b", "accent")
    f.rect(330, 110, 200, 70, "list 对象", "accent2", sub="[1, 2, 3]")
    f.rect(600, 110, 150, 70, "id() 不变", "", rx=9)
    f.arrow(180, 88, 328, 128)
    f.arrow(180, 198, 328, 162)
    f.arrow(530, 145, 598, 145)
    f.text(255, 96, "a = [1, 2, 3]", cls="fg-s", fs=12)
    f.text(255, 214, "b = a", cls="fg-s", fs=12)
    f.note(50, 262, "修改共享列表会被双方观察到；重新绑定 b 不改变 a。list(a) 是浅复制。")
    return f


def fig_cpp_raii() -> Fig:
    """RAII 的生命周期。"""
    f = Fig("cpp-raii", 800, 300,
            "RAII：资源跟随对象生命周期；正常退出作用域和异常展开会调用已构造对象的析构函数")
    f.line(70, 240, 740, 240, kind="muted")
    f.text(70, 264, "时间 →", cls="fg-s", fs=12, anchor="start")
    f.rect(140, 70, 240, 110, "构造函数", "accent", sub="拿到资源 · 打开文件")
    f.rect(400, 70, 240, 110, "析构函数", "accent2", sub="释放资源 · 关掉文件")
    f.arrow(380, 125, 398, 125)
    f.line(140, 196, 140, 240, dash=True)
    f.line(640, 196, 640, 240, dash=True)
    f.text(390, 210, "作用域", cls="fg-s", fs=12)
    f.path("M 260 60 Q 390 20 520 60", kind="accent2", dash=True)
    f.text(390, 40, "中途抛异常？析构照样会被调用", cls="fg-s", fs=12)
    f.note(70, 288, "C 里要记得在每个 return 分支 fclose；C++ 里这个「记得」被交给了类型系统。")
    return f


def fig_domain_random() -> Fig:
    """sim2real 与域随机化。"""
    f = Fig("domain-random", 820, 320,
            "域随机化覆盖测量得到的不确定范围，有助于鲁棒性，但不保证真机性能")
    f.rect(40, 90, 170, 120, "仿真", "accent", sub="可随机化")
    f.rect(610, 90, 170, 120, "真机", "accent2", sub="测量与验证")
    params = ["摩擦系数", "电机延迟", "质量 / 惯量", "传感器噪声", "地形高度"]
    y = 96
    for p in params:
        f.text(400, y, p, cls="fg-s", fs=12)
        y += 24
    for i, p in enumerate(params):
        yy = 100 + i * 24
        f.line(212, yy, 610, yy, dash=True)
    f.line(212, 160, 608, 160, kind="accent")
    f.arrow(212, 40, 608, 40, label="把真实系统可能的样子整片盖住", kind="accent")
    f.text(210, 236, "随机化区间", cls="fg-s", fs=12, anchor="start")
    f.text(610, 236, "必须落在区间内", cls="fg-s", fs=12, anchor="end")
    f.note(40, 290, "随机化不是越宽越好：太宽会让策略变得保守、动作发软；"
                    "太窄又会在真机上出分布。")
    return f


FIGURES = {
    "memory-layout": fig_memory_layout,
    "pointer-array": fig_pointer_array,
    "shell-loop": fig_shell_loop,
    "pipe-fd": fig_pipe_fd,
    "build-flow": fig_build_flow,
    "cmake-flow": fig_cmake_flow,
    "ros-graph": fig_ros_graph,
    "ros-qos": fig_ros_qos,
    "ros-tf": fig_ros_tf,
    "sim-loop": fig_sim_loop,
    "urdf-tree": fig_urdf_tree,
    "image-pixels": fig_image_pixels,
    "conv-kernel": fig_conv_kernel,
    "face-pipeline": fig_face_pipeline,
    "py-object": fig_py_object,
    "cpp-raii": fig_cpp_raii,
    "domain-random": fig_domain_random,
}

# 名字里允许出现任何非空白字符（不只是 [a-z0-9-]）：写错一个中文名时也要能
# 被 --check 和构建报出来，而不是静静变成一个看不见的 HTML 注释（踩过）。
FIG_RE = re.compile(r"<!--\s*fig:([^>\s]+)\s*-->")


def figure(name: str) -> str:
    """返回一张图的 HTML。名字不存在时返回空串（调用处决定怎么报错）。"""
    fn = FIGURES.get(name)
    return fn().render() if fn else ""


def expand_figures(body: str) -> tuple[str, list[str]]:
    """把正文里的 <!--fig:名字--> 换成内联 SVG。返回 (新正文, 找不到的名字)。

    每张图后面补一个空行：mdparse 的块级 HTML 规则会一直吞到空行，
    不补的话它会把后面正文一起当成 HTML 原文吐出去。
    """
    missing: list[str] = []

    def sub(m):
        name = m.group(1)
        html = figure(name)
        if not html:
            missing.append(name)
            return ""
        return html + "\n"

    return FIG_RE.sub(sub, body), missing


def main() -> int:
    args = sys.argv[1:]
    if not args or "--list" in args:
        print("可用插图：")
        for k, fn in FIGURES.items():
            desc = (fn.__doc__ or "").strip().splitlines()
            print(f"  {k:18s} {desc[0] if desc else ''}")
        return 0
    if "--check" in args:
        bad = []
        docs = os.path.join(ROOT, "content", "docs")
        used = set()
        for name in sorted(os.listdir(docs)):
            if not name.endswith(".md"):
                continue
            raw = open(os.path.join(docs, name), encoding="utf-8").read()
            for m in FIG_RE.finditer(raw):
                used.add(m.group(1))
                if m.group(1) not in FIGURES:
                    bad.append(f"{name}: 没有这张图 -> {m.group(1)}")
        unused = sorted(set(FIGURES) - used)
        print(f"  正文引用了 {len(used)} 张图")
        if unused:
            print(f"  画了但没用上：{'、'.join(unused)}")
        for b in bad:
            print("  !! " + b)
        return 1 if bad else 0
    # 单张图输出，方便在浏览器里单独看
    for name in args:
        html = figure(name)
        if not html:
            print(f"没有这张图：{name}")
            return 1
        print(html)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
