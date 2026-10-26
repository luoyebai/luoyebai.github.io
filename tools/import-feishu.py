#!/usr/bin/env python3
"""把飞书导出的技术文档迁成博客文章。

飞书的 Markdown 导出不是给人直接读的：全文标点都被反斜杠转义（`C\\+\\+`、`\\.h`、
`图片 5\\.png`），图片是 `图片和附件/xxx%20yyy.png` 这样的裸相对路径，
视频写成普通链接，标题层级从 `#` 重新开始，还夹着飞书内部 wiki 链接、
同事真名、公司名与产品代号。

这个脚本做四件事：

1. **去转义**。只对代码块与 `$…$` 之外的行处理，否则 LaTeX 里的 `\\`、`\\{` 会被吃掉。
2. **搬资源**。图片转 WebP 收进 `assets/feishu/<slug>/`，视频转 720p/30fps 静音 mp4 并抽海报帧；
   正文里的引用一并改写。
3. **脱敏**。公司名、产品代号前缀、同事真名、飞书 wiki 域名，以及指向已丢弃压缩包的失效链接。
4. **写 front-matter**，输出到 `content/posts/<slug>.md`。

    python tools/import-feishu.py                 # 全部
    python tools/import-feishu.py ankle           # 只跑某一篇
    python tools/import-feishu.py --dry           # 只打印统计，不写文件
"""
from __future__ import annotations

import html
import io
import os
import re
import shutil
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_staging", "feishu-docs")
POSTS = os.path.join(ROOT, "content", "posts")
ASSETS = os.path.join(ROOT, "assets", "feishu")

IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
VID_EXT = {".mp4", ".mkv", ".mov", ".webm"}

# ---------------------------------------------------------------------------
# 文档表。date 是**推断值**：飞书导出不带日期，取文档内媒体文件名里最新的那天，
# 没有线索的就落在它取代的那篇占位文章的日期上（保住时间线不塌）。
# ---------------------------------------------------------------------------
DOCS = [
    dict(
        key="ankle",
        src="脚踝并联结构算法相关/脚踝并联结构算法相关.md",
        slug="parallel-ankle-kinematics",
        title="脚踝并联机构：正逆运动学与静力学解算",
        date="2025-07-20",
        tags=["运动控制", "运动学", "人形"],
        summary="URDF 描述不了并联结构，电机角度和脚底欧拉角之间的映射只能自己解。"
                "记录两条路：采数据做符号回归拟合，以及从几何关系推出雅可比矩阵后迭代逼近，"
                "最后用虚功原理把末端力矩换算成电机力矩。",
        cover="assets/feishu/parallel-ankle-kinematics/fig-03.webp",
        drop_links=["并联结构函数拟合.zip", "parallel-c语言版本.zip"],
        note="原文档里的两个代码压缩包未随导出保留，相关小节改成文字说明。",
        pick_videos={"拟合结果.mp4": ("符号回归拟合出的函数与评估结果", 60)},
    ),
    dict(
        key="mpc",
        src="机器狗MPC-WBC控制资料/机器狗MPC-WBC控制资料.md",
        slug="quadruped-mpc-kinematics",
        title="四足运控：MPC 代价函数推导与腿部正逆运动学",
        date="2026-03-08",
        tags=["四足", "运动控制", "MPC", "运动学"],
        summary="把 MPC 从状态转移方程推到有限时域 QP 的代价函数，并解释为什么直接对输入加权"
                "会留下稳态误差、改用输入增量就能修掉；后半篇从单腿三个关节的变换矩阵推出足端"
                "正运动学，再从足端位置反解关节角。",
        cover="assets/feishu/quadruped-mpc-kinematics/fig-07.webp",
        drop_links=["宇树机器狗课程.pdf"],
        note="原文档引用的《宇树机器狗课程》PDF 是付费课程资料，不随本文转载；"
             "「WBC 控制简介」与「MPC-WBC 控制原理」两节在原文档里是空壳，这里补上了正文。",
        fixups=[
            # 源文档把两个标题粘在了一起
            (re.compile(r"^#{2,4} 原理概述WBC 控制简介$", re.M), "## 原理概述"),
            (re.compile(r"^## END$", re.M), ""),
            (re.compile(r"^### 参考来源$", re.M), "### 参考来源与约定"),
        ],
    ),
    dict(
        key="cpptools",
        src="CPP开发工具/CPP开发工具.md",
        slug="cpp-toolchain",
        title="C++ 工程工具链：构建、调试、依赖与代码质量",
        date="2025-09-08",
        tags=["工具", "C++", "系统工程"],
        summary="把一套能长期维护的 C++ 工程该配的东西过一遍：构建系统怎么选、"
                "调试与分析工具各自回答什么问题、依赖怎么管，以及 clang-tidy 与 clang-format "
                "两份可以直接拿去用的配置。",
        cover="",
        drop_links=["simple-project.zip"],
        note="原文档大半是只有标题的空壳（gdb / rr / sanitizers / vcpkg / Conan …），"
             "这里补齐了正文；示例工程压缩包未随导出保留。",
        fill_stubs=True,
    ),
    dict(
        key="vision",
        src="视觉 SAM3 & Foundationpose方案/视觉 SAM3 & Foundationpose方案.md",
        slug="sam3-foundationpose-6d-pose",
        title="用 SAM3 与 FoundationPose 做工件 6D 姿态估计",
        date="2025-12-26",
        tags=["机器视觉", "机械臂", "ROS2"],
        summary="免训练的 6D 姿态估计路线：SAM3 负责按语义把工件分出来，FoundationPose 只在给 "
                "CAD 数模和少量参考图的前提下估计并跟踪位姿。记录显存与耗时实测、"
                "姿态注册的旋转网格参数怎么调，以及精度不够时几条可落地的改进方向。",
        cover="assets/feishu/sam3-foundationpose-6d-pose/fig-01.webp",
        drop_links=["FoundationPoseROS2.zip", "FoundationPoseROS2 1.zip", "README.md"],
        note="原文档的代码压缩包与模型权重不随本文转载；公司内网地址已替换为通用描述。",
        fixups=[
            # 压缩包和 README 都被丢掉了，这两节原本只剩一个孤零零的文件名。
            # 与其留个空标题，不如把「去哪儿拿」写清楚。
            (re.compile(r"^## 相关代码\s*\n\s*\n- SAM3模型[^\n]*\n", re.M),
             "## 代码与模型\n\n"
             "原方案的两份代码压缩包与 SAM3 权重（约 3 GB）都不随本文转载。"
             "要复现的话，姿态估计直接用 NVlabs 的 "
             "[FoundationPose](https://github.com/NVlabs/FoundationPose) 官方实现，"
             "分割用 [Ultralytics SAM 3](https://docs.ultralytics.com/zh/models/sam-3)，"
             "两者之间只需要把 mask 递过去 —— 这也是这套方案省事的地方，"
             "不必为每个新工件重新训练或微调。\n"),
            (re.compile(r"^## 环境搭建\s*\n+---", re.M),
             "## 环境搭建\n\n"
             "按 FoundationPose 仓库的 README 建环境：CUDA + PyTorch + nvdiffrast，"
             "外加 RealSense 的 ROS 2 驱动。这套依赖里最费时间的是 nvdiffrast 与 "
             "PyTorch / CUDA 的版本对齐，建议直接用仓库自带的镜像起，别在裸机上从零配。\n\n---"),
        ],
        pick_videos={
            "2025-12-18 09-18-12.mp4": ("SAM2 + FoundationPose 的分割与跟踪效果", 46),
            "2025-12-18 16-31-04.mp4": ("SAM3 + FoundationPose 的分割与跟踪效果", 47),
            "2025-12-25 10-00-03.mp4": ("inplane_step 取不同值时的注册效果对比", 40),
            "g2_sam3fp.mkv": ("机械臂本体相机上的分割结果", 40),
        },
    ),
    dict(
        key="style",
        src="JoysonRobot C++_Python 代码规范/JoysonRobot C++_Python 代码规范.md",
        slug="cpp-python-code-style",
        title="C++ / Python 代码规范",
        date="2025-10-12",
        tags=["C++", "Python", "系统工程"],
        summary="一份可以贴进项目仓库的代码规范：头文件自给自足与 include 顺序、命名空间与"
                "静态变量、类的隐式转换与继承、函数签名怎么设计、命名约定，"
                "以及平台相关代码不能假设什么。核心是「正确性优先，必要时才为优化让路」。",
        cover="assets/feishu/cpp-python-code-style/fig-02.webp",
        drop_links=["joysonrobot_template.zip", ".clang-tidy", "clang-format-template",
                    ".cmake-format.yaml"],
        note="骨架来自 Google C++ Style Guide 与 C++ 核心准则，正文按团队实践重写过；"
             "本章标题去掉了公司前缀，模板压缩包未随导出保留。",
    ),
    dict(
        key="humanoid-a",
        src="基于小机器人工具链的人形机器人总结/基于小机器人工具链的人形机器人总结.md",
        slug="humanoid-0-to-1-toolchain",
        title="小型人形机器人 0→1：从 URDF 到真机部署的工具链",
        date="2026-02-14",
        tags=["人形", "工具链", "DDS", "仿真"],
        summary="把一台小型人形机器人从结构图纸做到能跑策略，中间要过的每一道工具："
                "URDF 导出后怎么查零件与关节、用 IDL + Fast DDS 设计通讯 SDK、"
                "怎么在 MuJoCo 里提前验证算法所需的硬件频率与鲁棒性、"
                "真机后台的分层架构，以及仿真到真机不改代码的部署方式。",
        cover="assets/feishu/humanoid-0-to-1-toolchain/fig-13.webp",
        drop_links=["joysonrobot_sdk2_user.zip"],
        note="SDK 源码不随本文转载，后台架构一节只保留目录结构与设计意图；"
             "飞书内网链接已移除。",
        pick_videos={
            "2025-11-20 18-20-55.mp4": ("仿真里跑部署代码：完全异步的控制回路", 26),
            "飞书20251126-173710.mp4": ("同一份 SDK 通讯，仿真直接切真机", 45),
        },
        split_at="## 其他小型人形机器人结构、硬件及软件算法方案",
        # 尾巴上的「可复用代码和实现（TODO）」整节只有一个指向已丢弃压缩包的链接，
        # 留着就是一条空章节；切掉之后下半篇最浅的标题正好是 `###`，抬成 `##` 就齐了
        tail_cut="## 可复用代码和实现（TODO）",
    ),
    dict(
        key="humanoid-b",
        src="基于小机器人工具链的人形机器人总结/基于小机器人工具链的人形机器人总结.md",
        slug="small-humanoid-consensus",
        title="小型人形机器人的结构、硬件与算法共识",
        date="2026-02-20",
        tags=["人形", "强化学习", "系统工程"],
        summary="把市面上四款小型人形机器人（G1 / PM01 / T1 / X2）的公开规格摆在一起看："
                "关节数与运动空间、算力与传感器配置、电池与电机选型，"
                "以及它们在 SDK 通讯、状态机和行走算法上不约而同的选择。",
        cover="assets/feishu/small-humanoid-consensus/fig-08.webp",
        drop_links=[],
        note="规格数据来自各厂商公开资料与实测，判断性结论都标注了「推测」。",
    ),
]

# ---------------------------------------------------------------------------
# 文本脱敏。顺序有意义：先长后短，避免 `JoysonRobot` 被 `Joyson` 先吃掉半截。
#
# 这些正则**一个 `\b` 都不用**，而且是故意的：`\b` 要求两侧「一个是词字符、一个不是」，
# 而 Python 的 `\w` 把汉字也算词字符 —— 于是 `JSRLOG日志系统` 里的 `G` 和 `日`
# 之间根本不存在词边界，`\bJSRLOG\b` 一条都匹配不上，公司代号就原样漏了出去。
# 改成前后加 `(?<![A-Za-z0-9])` / `(?![A-Za-z0-9])`，只管住 ASCII 标识符的边界。
# ---------------------------------------------------------------------------
def _ident(pat: str) -> re.Pattern:
    """整词匹配一个 ASCII 标识符。前後都不用 `\\b`，见上面的注释。"""
    return re.compile(r"(?<![A-Za-z0-9_])" + pat + r"(?![A-Za-z0-9_])")


def _prefix(pat: str) -> re.Pattern:
    """只卡**前边界**的匹配，给 `jsr_` / `JSR_` 这种前缀用。

    前缀后面跟的往往还是标识符字符（`JSR_INFO`、`jsr_lr_daemon_lowctrl`），
    套 `_ident` 的话尾部的负向断言会把自己否掉，一条都替换不掉。
    """
    return re.compile(r"(?<![A-Za-z0-9_])" + pat)


# `jsr-logger` / `jsr_logger` / `jsrlog` 统一成 `robot-logger` / `robot_logger` / `robotlog`
JSR_LOG = (re.compile(r"jsr([-_]?)log(ger)?"), r"robot\1log\2")
# 前缀族：`jsr_lr_daemon_lowctrl`、`JSR_INFO`、`jsr_dcu.hpp` 全靠这两条
JSR_PREFIX = [(_prefix(r"jsr_"), "robot_"), (_prefix(r"JSR_"), "ROBOT_")]

SCRUB = [
    # 飞书内部 wiki：整条链接连文字一起去掉（文字是「详见 xxx」这种指路话，留着没意义）
    (re.compile(r"\[[^\]]*\]\(https://ewov2igmcma\.feishu\.cn/wiki/[^)]*\)"), ""),
    (re.compile(r"https://ewov2igmcma\.feishu\.cn/\S*"), ""),
    # 飞书文档之间的相互指路，迁出来就断了
    (re.compile(r"详细解算：\[脚踝并联结构算法相关\][^\s]*"), "详细解算见《脚踝并联机构》一文。"),
    (re.compile(r"具体技术细节可联系@\S+咨询。"), ""),
    # `@\S+` 会把收尾的 `~~` 一起吃掉，留下一个没闭合的删除线（页面上一串波浪号）
    (re.compile(r"相关方式咨询\s*->\s*@[^\s~]+"), "相关方式已确认"),
    # 公司 / 产品代号
    (re.compile(r"joysonrobot_sdk2_user", re.I), "little_robot_sdk_user"),
    (re.compile(r"joysonrobot", re.I), "little_robot"),
    (re.compile(r"JoysonRobot\s+"), ""),
    (re.compile(r"/opt/joysonrobot"), "/opt/little_robot"),
    (re.compile(r"JSRLOG"), "ROBOTLOG"),
    JSR_LOG,
    *JSR_PREFIX,
    (_ident(r"jsr"), "robot"),
    (_ident(r"JSR"), "ROBOT"),
    (re.compile(r"jr::little_robot"), "robot::little_robot"),
    (re.compile(r'"/var/log/jsr/"'), '"/var/log/robot/"'),
    (re.compile(r"公司NAS"), "内部模型仓库"),
    (re.compile(r"公司"), "内部"),
    # 飞书把标题的英文用 `*（…）*` 挂在中文后面，而 `*` 紧贴汉字时
    # `(?<![\*\w])\*` 的环视会失败，星号就原样显示在标题里
    (re.compile(r"\s*\*（[^*）]*）\*"), ""),
    # 飞书导出的外链长这样：`[https://…]()` —— 文字是 URL、href 是空的，
    # 页面上就是一个点了没反应的链接。脱掉方括号让它退回普通文字，
    # 解析器会把裸 URL 自动变成外链。
    (re.compile(r"\[(https?://[^\]\s]+)\]\(\s*\)"), r"\1"),
    # `*# logging.info(...)*`：飞书把 Python 注释当成斜体包了一层星号
    (re.compile(r"^\s*\*#(.*?)\*\s*$", re.M), r"#\1"),
    # 空链接（飞书标题锚点导出的残留）
    (re.compile(r"\[\s*\]\([^)]*\)"), ""),
]

# 飞书把标点转义了；只对这些字符去反斜杠（`\n`、`\t`、`\\` 这类真要保留）
ESCAPABLE = set("+-.()[]{}&*_~|:!<>=#`$%@'\"/,;?^")

# 代码块里的脱敏。**不能去转义** —— 代码里的反斜杠是语法；但标识符该改还是要改，
# 否则正文说「robotlog」而代码里写着「jsrlog」，改了一半比不改更难看。
CODE_SCRUB = [
    (re.compile(r"joysonrobot", re.I), "little_robot"),
    JSR_LOG,
    *JSR_PREFIX,
    (_ident(r"jsr"), "robot"),
    (_ident(r"JSR"), "ROBOT"),
    (re.compile(r"jsr::"), "robot::"),
    (re.compile(r"\bjr::"), "robot::"),
    (re.compile(r"/var/log/jsr/"), "/var/log/robot/"),
    # 代码块里飞书也会把 Python 注释包成斜体，星号得脱掉
    (re.compile(r"^(\s*)\*#(.*?)\*\s*$", re.M), r"\1#\2"),
]


def unescape(seg: str) -> str:
    out, i, n = [], 0, len(seg)
    while i < n:
        c = seg[i]
        if c == "\\" and i + 1 < n and seg[i + 1] in ESCAPABLE:
            out.append(seg[i + 1])
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def protected_regions(text: str) -> list[tuple[int, int]]:
    """整篇里**不许动**的字符区间：代码围栏 + 数学公式。

    必须整篇扫描，不能按行判断。飞书导出的公式常常是单美元跨好几行的：

        $T_{01} = \\begin{bmatrix}
        …
        \\end{bmatrix}$，通过 3\\.1\\.1 小节…

    按行匹配的话，`\\end{bmatrix}$` 之后的散文会被误判成「还在这行的公式里」，
    于是 `3\\.1\\.1` 的反斜杠留了下来（页面上直接显示 `3\\.1\\.1`）。
    """
    spans: list[tuple[int, int]] = []
    lines = text.split("\n")

    # 1) 代码围栏：按行算，整行连同围栏一起保护
    fence, off, fstart = None, 0, 0
    for line in lines:
        m = re.match(r"^(\s*)(`{3,}|~{3,})", line)
        if m:
            if fence is None:
                fence, fstart = m.group(2)[0] * len(m.group(2)), off
            elif m.group(2)[0] * len(m.group(2)) >= fence:
                spans.append((fstart, off + len(line)))
                fence = None
        off += len(line) + 1
    if fence is not None:
        spans.append((fstart, len(text)))

    # 2) 数学
    spans.extend((s, e) for s, e, _inner, _display in math_spans(text))

    spans.sort()
    merged: list[tuple[int, int]] = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def math_spans(text: str) -> list[tuple[int, int, str, bool]]:
    """找出所有数学公式，返回 [(起, 止, 内容, 是不是 $$…$$)]。

    单字符扫描而不是正则：飞书导出的公式经常**跨行**，而且是单个 `$`：

        $T_{01} = \\begin{bmatrix}
        \\cos\\phi & … \\\\
        \\end{bmatrix}$

    正则 `\\$([^$\\n]+?)\\$` 因为排除了换行，一条都匹配不上 ——
    页面上就会直接显示 `\\begin{bmatrix}` 这种源码。跨行和行内两种情况必须分开判：
    先在**本行内**找收尾，找不到才当成跨行公式一路吃下去，
    否则 `…为$n$维…$\\theta$…` 这种一行里两个行内公式会被并成一个。
    """
    spans: list[tuple[int, int, str, bool]] = []
    i, n = 0, len(text)
    while i < n:
        if text[i] != "$" or (i and text[i - 1] == "\\"):
            i += 1
            continue
        display = text.startswith("$$", i)
        open_len = 2 if display else 1
        j = i + open_len
        close = -1
        if not display:
            eol = text.find("\n", j)
            eol = n if eol < 0 else eol
            k = j
            while k < eol:
                if text[k] == "\\":
                    k += 2
                    continue
                if text[k] == "$":
                    close = k
                    break
                k += 1
        if close < 0:
            k = j
            while k < n:
                if text[k] == "\\":
                    k += 2
                    continue
                if display and text.startswith("$$", k):
                    close = k
                    break
                if not display and text[k] == "$":
                    close = k
                    break
                k += 1
        if close < 0:
            i = j
            continue
        spans.append((i, close + open_len, text[j:close], display))
        i = close + open_len
    return spans


# 出现这些就说明是「块级」公式，不该塞回句子中间
DISPLAY_HINT = re.compile(r"\\begin\{|\\end\{|\\tag\{|\\underbrace|\\overbrace|\\\\")


def normalize_math(text: str) -> str:
    """把飞书那套「跨行单美元」公式改写成解析器认的形式。

    三种情况：

    1. `$$…$$` —— 已经是块级，摊成独立行；
    2. **跨行或明显是矩阵/多行的 `$…$`** —— 升成 `$$…$$` 并顶格。
       顶格是必须的：留在列表项的缩进里，解析器会把它当列表续行，
       整段公式就变成了 `<li>` 里的一串纯文本；
    3. 其余行内公式 —— 只把定界符**内侧的空白**去掉。
       `$\\theta_0 $` 这种收尾带空格的写法，解析器的 `(?<!\\s)\\$`
       匹配不上，同样会原样显示。
    """
    spans = math_spans(text)
    if not spans:
        return text
    out, last = [], 0
    for s, e, inner, display in spans:
        out.append(text[last:s])
        body = inner.strip()
        # 判断「是不是块级」要看 **strip 之后**的内容：`$n\n$` 里那个换行只是
        # 飞书折行留下的，公式本体就是一个 `n`，升成块级会在句子中间插一个独立公式。
        want_block = (display or "\n" in body
                      or len(body) > 60 or bool(DISPLAY_HINT.search(body)))
        if want_block:
            out.append("\n\n$$\n%s\n$$\n\n" % body)
        else:
            out.append("$%s$" % body)
        last = e
    out.append(text[last:])
    text = "".join(out)
    # 公式被提到独立成块之后，原本跟在它后面的逗号/句号会落在新段落的开头
    text = re.sub(r"(\n\$\$\n)\s*[，。,]\s*", r"\1", text)
    return text


def scrub(text: str) -> str:
    """脱敏 + 去转义，但要绕开代码块与公式。

    代码块只跑 `CODE_SCRUB`（改标识符，不去转义）；
    公式整段原样保留 —— 里面的 `\\{`、`\\,`、`\\&` 全是 LaTeX 语法，
    去一次转义整个公式就废了。
    """
    regions = protected_regions(text)
    out, last = [], 0
    for s, e in regions:
        out.append(scrub_prose(text[last:s]))
        seg = text[s:e]
        for rx, rep in CODE_SCRUB:
            seg = rx.sub(rep, seg)
        out.append(seg)
        last = e
    out.append(scrub_prose(text[last:]))
    return "".join(out)


def scrub_prose(seg: str) -> str:
    seg = unescape(seg)
    for rx, rep in SCRUB:
        seg = rx.sub(rep, seg)
    return seg


# ---------------------------------------------------------------------------
# 资源
# ---------------------------------------------------------------------------
def human_size(n: int) -> str:
    return "%.0f KB" % (n / 1024) if n < 1048576 else "%.1f MB" % (n / 1048576)


class Media:
    """一次迁移里的资源账本：原相对路径 -> 产物 URL，并记录省下多少体积。"""

    def __init__(self, slug: str, doc_dir: str, dry: bool = False):
        self.slug = slug
        # 正文里的 `图片和附件/x.png` 是**相对文档所在目录**的，不是相对导出根目录 ——
        # 一开始漏了这层 join，结果每个引用都找不到文件，静默地一个资源都没搬
        self.doc_dir = doc_dir
        self.dir = os.path.join(ASSETS, slug)
        self.url = "/assets/feishu/" + slug
        self.dry = dry
        self.map: dict[str, str] = {}
        self.img_n = 0
        self.vid_n = 0
        self.before = 0
        self.after = 0
        self.videos: list[tuple[str, str, str]] = []   # (url, poster_url, caption)

    def _next(self, kind: str) -> str:
        if kind == "img":
            self.img_n += 1
            return "fig-%02d" % self.img_n
        self.vid_n += 1
        return "video-%02d" % self.vid_n

    def rel(self, raw: str) -> str:
        from urllib.parse import unquote
        return os.path.join(self.doc_dir, unquote(raw.replace("\\", "/")).lstrip("/"))

    def image(self, raw: str, caption: str = "") -> str | None:
        if raw in self.map:
            return self.map[raw]
        src = self.rel(raw)
        if not os.path.isfile(src):
            return None
        ext = os.path.splitext(src)[1].lower()
        name = self._next("img") + ".webp"
        dst = os.path.join(self.dir, name)
        self.map[raw] = "%s/%s" % (self.url, name)
        self.before += os.path.getsize(src)
        if self.dry:
            self.after += os.path.getsize(src) // 3
            return self.map[raw]
        os.makedirs(self.dir, exist_ok=True)
        if ext == ".gif":
            # 动图别动它：转 WebP 会丢掉循环信息，得不偿失
            name = self._next("img") + ".gif"
            dst = os.path.join(self.dir, name)
            self.map[raw] = "%s/%s" % (self.url, name)
            shutil.copy2(src, dst)
        else:
            to_webp(src, dst)
        self.after += os.path.getsize(dst)
        return self.map[raw]

    def video(self, raw: str, caption: str, limit: float) -> str | None:
        if raw in self.map:
            return self.map[raw]
        src = self.rel(raw)
        if not os.path.isfile(src):
            return None
        base = self._next("vid")
        name, poster = base + ".mp4", base + ".jpg"
        self.map[raw] = "%s/%s" % (self.url, name)
        self.before += os.path.getsize(src)
        if self.dry:
            self.after += 2 * 1024 * 1024
        else:
            os.makedirs(self.dir, exist_ok=True)
            to_web_video(src, os.path.join(self.dir, name),
                         os.path.join(self.dir, poster), limit)
            self.after += os.path.getsize(os.path.join(self.dir, name))
            self.after += os.path.getsize(os.path.join(self.dir, poster))
        self.videos.append((self.map[raw], "%s/%s" % (self.url, poster), caption))
        return self.map[raw]


def _ffmpeg() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def to_webp(src: str, dst: str) -> None:
    """截图转 WebP：无损和有损各试一次，取小的那个。

    这批附件几乎全是界面截图，大片纯色 + 小字。无损常常反而更小，
    但有损在照片类截图上又明显更省，所以不预设，直接量。
    """
    from PIL import Image
    im = Image.open(src)
    im.load()
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    if im.width > 1600:
        h = round(im.height * 1600 / im.width)
        im = im.resize((1600, h), Image.LANCZOS)

    best = None
    for kwargs in ({"lossless": True, "method": 6}, {"quality": 82, "method": 6}):
        buf = io.BytesIO()
        im.save(buf, "WEBP", **kwargs)
        if best is None or buf.tell() < len(best):
            best = buf.getvalue()
    with open(dst, "wb") as fh:
        fh.write(best)


def to_web_video(src: str, dst: str, poster: str, limit: float) -> None:
    """720p/30fps、静音、faststart。屏幕录制的内容 CRF 30 足够清楚。"""
    ff = _ffmpeg()
    scale = "scale='min(1280,iw)':-2:flags=lanczos"
    subprocess.run(
        [ff, "-y", "-hide_banner", "-loglevel", "error", "-t", "%.2f" % limit, "-i", src,
         "-vf", scale + ",fps=30", "-c:v", "libx264", "-preset", "slow", "-crf", "30",
         "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", dst],
        check=True)
    subprocess.run(
        [ff, "-y", "-hide_banner", "-loglevel", "error", "-ss", "1", "-i", src,
         "-frames:v", "1", "-vf", scale, "-q:v", "4", poster],
        check=True)


# ---------------------------------------------------------------------------
# 正文
# ---------------------------------------------------------------------------
LINK_OR_IMG = re.compile(r"(!?)\[([^\]]*)\]\(([^)\s]+?)(?:\s+\"([^\"]*)\")?\)")


def rewrite_media(text: str, media: Media, doc: dict, stats: dict) -> str:
    picks = doc.get("pick_videos") or {}
    drop = [k.lower() for k in (doc.get("drop_links") or [])]

    def one(m: re.Match) -> str:
        from urllib.parse import unquote
        label, target = m.group(2), m.group(3)
        # 先解码再判类型：飞书把空格写成 `%20`，不解码的话
        # `2025-12-18%2009-18-12.mp4` 匹配不上 pick_videos 里的键，
        # 挑好的视频会被当成「没被选中」全部丢掉（表现是正文里视频凭空消失）
        name = unquote(target).split("?")[0]
        base = os.path.basename(name)
        ext = os.path.splitext(base)[1].lower()

        # 指向已丢弃的压缩包、不转载的付费 PDF、公司模板：整条链接拿掉，
        # 由 doc.note 统一交代，好过留一堆 404
        if any(k in base.lower() for k in drop):
            stats["dropped"] += 1
            return ""
        if ext == ".zip":
            stats["dropped"] += 1
            return ""

        if ext in VID_EXT:
            if picks and base not in picks:
                stats["video_skipped"] += 1
                return ""
            caption, limit = picks.get(base, (label or "演示", 45.0))
            url = media.video(name, caption, limit)
            if not url:
                return ""
            stats["video"] += 1
            return "![%s](%s)" % (caption.replace("]", " "), url)
        if ext in IMG_EXT:
            url = media.image(name, label)
            if not url:
                return ""
            stats["image"] += 1
            return "![%s](%s)" % (label.replace("]", " "), url)
        if not target.startswith(("http://", "https://", "mailto:", "#", "/")):
            # 其它相对路径（代码包、模板…）迁不出来
            stats["dropped"] += 1
            return label or ""
        return m.group(0)

    return LINK_OR_IMG.sub(one, text)


def fix_fences(text: str) -> str:
    """飞书把语言名写成 `Bash`/`Plain Text`/`C++`，还有把目录树标成 bash 的。"""
    out, fence = [], None
    for line in text.split("\n"):
        m = re.match(r"^(\s*)(`{3,}|~{3,})\s*([\w+#. -]*?)\s*$", line)
        if m:
            if fence is None:
                lang = m.group(3).lower().strip()
                lang = {"plain text": "text", "c++": "cpp", "cxx": "cpp", "idl": "text",
                        "cmake": "cmake", "yaml": "yaml", "bash": "bash"}.get(lang, lang)
                fence = (m.group(2), lang)
                out.append("%s%s%s" % (m.group(1), m.group(2), lang))
                continue
            fence = None
            out.append(line)
            continue
        if fence and fence[1] == "bash" and re.search(r"[├└]──|^│", line):
            # 目录树被标成了 bash
            out[-1] = out[-1].replace("```bash", "```text")
            fence = (fence[0], "text")
        out.append(line)
    # 收尾没闭合的围栏
    return "\n".join(out)


def tidy(text: str) -> str:
    """飞书的空引用块、行尾空格、连续空行。

    **只删空引用行，不动别处**：`> 结论\\n> \\n> \\n\\n#### 下一节` 这种写法里，
    把「引用行后面的空行」也一起吃掉，引用就和后面的标题粘在一起了
    （解析器能扛住，但读源码的人会以为标题也在引用里）。
    """
    lines, out = text.split("\n"), []
    for line in lines:
        if re.fullmatch(r">\s*", line):
            continue
        # 公式被提成独立块之后，原本「只装着一个公式」的列表项就空了，
        # 留下一个光秃秃的 `-`（渲染出来是一个空圆点）
        if re.fullmatch(r"[ \t]*[-*+][ \t]*", line):
            continue
        out.append(line.rstrip())
    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # `\s` 包含换行：`^\s*---\s*$` 会把 `---` 前后的空行一起吃进匹配里，
    # 换成光秃秃的 `---`，分隔线就和上一段、下一个标题粘在一起了。只允许行内空白。
    text = re.sub(r"^[ \t]*---[ \t]*$", "---", text, flags=re.M)
    return text.strip() + "\n"


def drop_first_heading(text: str) -> str:
    return re.sub(r"^# [^\n]*\n+", "", text, count=1)


def fence_mask(text: str) -> list[bool]:
    """逐行标注：这一行是不是在代码围栏里。"""
    flags, fence = [], None
    for line in text.split("\n"):
        m = re.match(r"^(\s*)(`{3,}|~{3,})", line)
        if m:
            if fence is None:
                fence = m.group(2)[0] * len(m.group(2))
                flags.append(True)
                continue
            if m.group(2)[0] * len(m.group(2)) >= fence:
                fence = None
                flags.append(True)
                continue
        flags.append(fence is not None)
    return flags


def map_lines(text: str, fn) -> str:
    """只对**代码块之外**的行跑 fn。

    列表转换与标题降级都是按行正则做的，跑进代码块里就会出事：
    C 语言的多行注释 ` * foo` 会被认成列表项，Python 的 `# 注释` 会长出一个标题。
    """
    return "\n".join(line if in_fence else fn(line)
                     for line, in_fence in zip(text.split("\n"), fence_mask(text)))


def normalize_headings(text: str) -> str:
    """把「文档里最浅的那级标题」统一抬成 `h2`。

    飞书导出没有统一的标题深度：有的文档把小节写成 `#`（文档标题也是 `#`，
    去掉标题后最浅就剩 `#`），有的写成 `##`。固定「降一级」会让后一种从 `###` 起步，
    整篇缩进一格；固定不动又会让前一种每篇都是 h1。
    所以按实际最浅一级对齐，这样每篇文章的目录结构都从 `##` 开始。
    """
    lines = text.split("\n")
    mask = fence_mask(text)
    levels = [len(m.group(1)) for line, keep in zip(lines, mask)
              if not keep and (m := re.match(r"^(#{1,6}) ", line))]
    if not levels:
        return text
    delta = 2 - min(levels)

    out = []
    for line, keep in zip(lines, mask):
        m = re.match(r"^(#{1,6}) ", line)
        if keep or not m:
            out.append(line)
            continue
        lvl = max(2, min(6, len(m.group(1)) + delta))
        out.append("#" * lvl + line[len(m.group(1)):])
    return "\n".join(out)


def convert_checklists(line: str) -> str:
    return re.sub(r"^(\s*)\* (\[[ xX]\])", r"\1- \2", line)


def bullets_dash(line: str) -> str:
    return re.sub(r"^(\s*)\* ", r"\1- ", line)


def line_transforms(line: str) -> str:
    return bullets_dash(convert_checklists(line))


def body_hash(md: str) -> str:
    """正文（去掉 front-matter）的指纹，用来识别「迁移之后被人手动改过」。"""
    import hashlib
    m = re.match(r"^---\n.*?\n---\n", md, re.S)
    body = md[m.end():] if m else md
    return hashlib.sha1(body.strip().encode("utf-8")).hexdigest()[:12]


def stored_hash(md: str) -> str:
    m = re.search(r"^source_hash:\s*(\S+)\s*$", md, re.M)
    return m.group(1) if m else ""


def build_doc(doc: dict, dry: bool = False) -> dict:
    path = os.path.join(SRC, doc["src"])
    raw = open(path, encoding="utf-8").read()
    body = drop_first_heading(raw.lstrip("\n"))

    # 有的源文档其实是两篇（工具链 + 产品横评），按标记切开各成一篇
    cut = doc.get("split_at")
    if cut and cut in body:
        body = body[:body.index(cut)]

    media = Media(doc["slug"], os.path.dirname(path), dry)
    stats = dict(image=0, video=0, video_skipped=0, dropped=0)

    text = rewrite_media(normalize_math(scrub(body)), media, doc, stats)
    text = map_lines(fix_fences(text), line_transforms)
    text = normalize_headings(text)
    for rx, rep in doc.get("fixups") or []:
        text = rx.sub(rep, text)
    text = tidy(text)
    if doc.get("note"):
        text = "::: note 迁移说明\n%s\n:::\n\n" % doc["note"] + text

    fm = ["---", "title: %s" % doc["title"], "slug: %s" % doc["slug"],
          "date: %s" % doc["date"], "tags: [%s]" % ", ".join(doc["tags"]),
          "summary: %s" % doc["summary"]]
    if doc.get("cover"):
        fm.append("cover: %s" % doc["cover"])
    if doc.get("extra_attrs"):
        fm.append(doc["extra_attrs"])
    return _assemble(fm, text, media, stats, doc["slug"], doc["title"])


def _assemble(fm: list[str], text: str, media: Media, stats: dict,
              slug: str, title: str) -> dict:
    """拼出最终文件，并把**正文指纹写进 front-matter**。

    为什么要留这个指纹：迁移是一次性的，迁完正文就是在仓库里手写的
    （补空章节、改措辞、加插图）。指纹用来在下次重跑时认出「这篇被手动改过」，
    从而拒绝覆盖 —— 见 main() 里的判断。少这一道，一条
    `Remove-Item + import-feishu.py --force` 就能把几小时的手写内容无声抹掉。
    """
    body = "\n".join(fm) + "\n---\n\n" + text
    fm.append("source_hash: %s" % body_hash(body))
    fm.append("---")
    md = "\n".join(fm) + "\n\n" + text
    return dict(md=md, media=media, stats=stats, slug=slug, title=title)

def build_split_tail(doc: dict, tail: dict, dry: bool = False) -> dict:
    """humanoid-b：拿 humanoid-a 源文档的后半段，独立成篇。"""
    path = os.path.join(SRC, doc["src"])
    raw = open(path, encoding="utf-8").read()
    cut = doc["split_at"]
    body = raw[raw.index(cut):]
    tail_cut = doc.get("tail_cut")
    if tail_cut and tail_cut in body:
        body = body[:body.index(tail_cut)]
    body = re.sub(r"^## [^\n]*\n+", "", body, count=1)

    media = Media(tail["slug"], os.path.dirname(path), dry)
    stats = dict(image=0, video=0, video_skipped=0, dropped=0)
    text = rewrite_media(normalize_math(scrub(body)), media, tail, stats)
    text = normalize_headings(map_lines(fix_fences(text), line_transforms))
    text = tidy(text)
    if tail.get("note"):
        text = "::: note 迁移说明\n%s\n:::\n\n" % tail["note"] + text

    fm = ["---", "title: %s" % tail["title"], "slug: %s" % tail["slug"],
          "date: %s" % tail["date"], "tags: [%s]" % ", ".join(tail["tags"]),
          "summary: %s" % tail["summary"]]
    if tail.get("cover"):
        fm.append("cover: %s" % tail["cover"])
    return _assemble(fm, text, media, stats, tail["slug"], tail["title"])


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    dry = "--dry" in sys.argv
    force = "--force" in sys.argv
    # 真的要拿迁移结果盖掉手写内容时用的最后一道闸
    replace_edits = "--replace-edits" in sys.argv
    skipped = 0
    guarded = 0
    for d in DOCS:
        if args and d["key"] not in args:
            continue
        if d.get("split_at"):
            r = build_doc(d, dry)
            t = next(x for x in DOCS if x["key"] == "humanoid-b")
            r2 = build_split_tail(d, t, dry)
            results = [r, r2]
        elif d["key"].endswith("-b"):
            continue
        else:
            results = [build_doc(d, dry)]
        for r in results:
            if not r:
                continue
            m: Media = r["media"]
            print("%-28s 图 %2d  视频 %d（跳过 %d）  丢弃链接 %2d  %s -> %s" % (
                r["slug"], r["stats"]["image"], r["stats"]["video"],
                r["stats"]["video_skipped"], r["stats"]["dropped"],
                human_size(m.before), human_size(m.after)))
            if dry:
                continue
            os.makedirs(POSTS, exist_ok=True)
            dst = os.path.join(POSTS, r["slug"] + ".md")
            if os.path.exists(dst):
                old = open(dst, encoding="utf-8").read()
                marked = stored_hash(old)
                edited = (not marked) or body_hash(old) != marked
                if edited and not replace_edits:
                    # 默认不覆盖；--force 也拦 —— 手写内容（补的空章节、改过的措辞、
                    # 加的插图）盖掉就找不回来了，必须由人明确说要丢
                    guarded += 1
                    print("      **拒绝覆盖**：这篇迁移之后被手改过（或不是本脚本生成的）。"
                          "\n         确实要丢掉这些改动：--force --replace-edits")
                    continue
                if not force:
                    skipped += 1
                    print("      跳过（已存在，加 --force 才覆盖）")
                    continue
            with open(dst, "w", encoding="utf-8") as fh:
                fh.write(r["md"])
    if skipped:
        print("\n  有 %d 篇已存在未覆盖。要重迁：python tools/import-feishu.py --force" % skipped)
    if guarded:
        print("  有 %d 篇因为被手改过而拒绝覆盖（--force --replace-edits 可强制）" % guarded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
