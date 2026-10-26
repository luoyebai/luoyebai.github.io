#!/usr/bin/env python3
"""发布前把该跑的都跑一遍 —— **一条一条来**。

探针各自在固定端口起本地服务，并发跑会互相串页（表现是莫名其妙的断言失败，
甚至读到别的探针的页面）；另外 `msedge` 残留会拖垮后面的 CDP 连接。
所以这个脚本按顺序跑，Python 步骤前清理浏览器，末尾给一张汇总表。
首页运动轨道使用 Node 确定性测试，不启动或清理浏览器。

    python tools/check-all.py                 # 全套
    python tools/check-all.py --list          # 看看有哪些步骤
    python tools/check-all.py --only build,site,reading
    python tools/check-all.py --with-font     # 顺带重跑字体子集（内容加了新汉字时用）
    python tools/check-all.py --skip-heavy    # 跳过最慢的几个（背景视频解码、演示）

失败**不中断**：后面的步骤照跑，最后一次性告诉你哪几步红了 ——
否则修一个跑一次，一轮下来要多花十几分钟。
"""
import os
import subprocess
import sys
import time

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable

# (键, 说明, 命令, 是否算"重"）
STEPS = [
    ("selftest", "解析器与高亮自测", ["selftest.py"], False),
    ("palette", "主题对比度", ["check-palette.py"], False),
    ("light", "亮色体检", ["check-light.py"], False),
    ("bgres", "背景素材分辨率", ["check-bg-res.py"], False),
    ("build", "构建站点", ["build.py", "--clean"], False),
    ("site", "站点完整性（链接 / 资源 / 字体字形 / 图标精灵）", ["check-site.py"], False),
    ("page", "卡片点击 / 标签 / 视频解码", ["probe-page.py"], False),
    ("fusion", "首屏与正文融合（场 / 导轨 / 余温 / 分层）", ["probe-fusion.py"], False),
    ("reading", "阅读交互：目录 / 折叠 / 灯箱 / 演示", ["probe-reading.py"], False),
    ("media", "并排图几何", ["probe-media.py"], False),
    ("links", "外链站点标记与链接卡片", ["probe-links.py"], False),
    ("footer", "页脚贴底与对比度", ["probe-footer.py"], False),
    ("math", "公式渲染", ["probe-math.py"], False),
    ("figs", "文档插图几何", ["probe-figs.py"], False),
    ("docs", "文档区：翻页 / 目录 / 插图 / 代码入口", ["probe-docs.py"], False),
    ("cover", "封面：对比度 / 裁切焦点 / 完整显示", ["probe-cover.py"], False),
    ("loading", "等待加载：骨架屏 / 启动遮罩 / 降级", ["probe-loading.py"], False),
    ("page404", "404 信标小游戏", ["probe-404.py"], False),
    ("orbit", "首页运动轨道（Node）", ["test-orbit-field.js"], False),
    ("admin", "后台 API（需要先起 tools/admin.py）", ["test-admin.py"], False),
    ("adminui", "后台 UI 真点一遍（需要先起 tools/admin.py）", ["probe-admin-ui.py"], False),
    ("bgplay", "14 段背景视频真解码", ["check-bg-play.py"], True),
    ("demo", "文章里的可运行示例", ["probe-demo.py"], True),
]


def kill_browsers():
    """探针之间清一次浏览器：残留的 msedge 会把下一次 CDP 连接拖死。"""
    if os.name != "nt":
        return
    subprocess.run(["taskkill", "/F", "/IM", "msedge.exe"],
                   capture_output=True, check=False)


def main() -> int:
    args = sys.argv[1:]
    if "--list" in args:
        for key, label, _, heavy in STEPS:
            print("  %-9s %s%s" % (key, label, "（重）" if heavy else ""))
        return 0

    only = None
    if "--only" in args:
        only = set(args[args.index("--only") + 1].split(","))
    skip_heavy = "--skip-heavy" in args
    steps = [(k, l, c) for k, l, c, heavy in STEPS
             if (not only or k in only) and not (skip_heavy and heavy)]

    if "--with-font" in args and (not only or "build" in only):
        i = [k for k, _, _ in steps].index("build")
        steps.insert(i, ("webfont", "重新子集化中文字体", ["make-webfont.py"]))

    results = []
    t0 = time.time()
    for key, label, cmd in steps:
        print("─" * 66)
        print("▶ %s  ·  %s" % (key, label))
        sys.stdout.flush()
        is_node = cmd[0].endswith(".js")
        if not is_node:
            kill_browsers()
        started = time.time()
        command = ["node" if is_node else PY, os.path.join(ROOT, "tools", cmd[0])] + cmd[1:]
        try:
            proc = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace")
        except OSError as exc:
            proc = subprocess.CompletedProcess(command, 1, "", str(exc))
        out = ((proc.stdout or "") + (proc.stderr or "")).strip()
        tail = [ln for ln in out.splitlines() if ln.strip()][-4:]
        for ln in tail:
            print("   " + ln)
        ok = proc.returncode == 0
        results.append((key, label, ok, time.time() - started))
        print("%s %s（%.1fs）" % ("✔" if ok else "✘", label, time.time() - started))
        sys.stdout.flush()

    print("═" * 66)
    bad = [r for r in results if not r[2]]
    for key, label, ok, secs in results:
        print("  %s %-9s %-46s %5.1fs" % ("✔" if ok else "✘", key, label, secs))
    print("\n  %d 步，失败 %d，共 %.1f 秒" % (len(results), len(bad), time.time() - t0))
    if bad:
        print("  失败：%s" % ", ".join(r[0] for r in bad))
    return 1 if bad else 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
