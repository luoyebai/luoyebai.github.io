#!/usr/bin/env python3
"""常用网站的品牌标记：把图标本地化，构建时内联成 SVG 精灵。

**为什么不在运行时去拉 favicon。** 站点页脚写着「无第三方依赖 · 无追踪」——
让浏览器去 Google 的 favicon 服务或者各站点的 CDN 拿图标，等于把访客「读了哪一页、
点了哪些链接」送给第三方，离线或被墙时还会看到一排空白方块。所以图标跟着仓库走：
`--fetch` 一次性下载到 `tools/site-icons.json` 并提交，**构建过程本身不联网**。

图标取自 [Simple Icons](https://simpleicons.org/)（图标本身 CC0-1.0，商标仍归各自所有者；
这里只用于指向对应站点，不做任何暗示背书）。缺某个站点就退回普通链接样式，
不是错误 —— 一个没收录的域名不该让构建失败。

    python tools/site-icons.py --fetch      # 下载缺失的图标（联网，偶尔跑一次）
    python tools/site-icons.py --list       # 看看收录了哪些站点
    python tools/site-icons.py --missing    # 扫内容，列出「正文用过但没图标」的域名
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "tools", "site-icons.json")
CDN = "https://cdn.jsdelivr.net/npm/simple-icons@13/icons/%s.svg"
LICENSE = "Simple Icons (CC0-1.0)；商标归各自所有者"

# 域名 -> 图标 slug。**按实际用到的域名写**，不是把 Simple Icons 全搬进来：
# 收录的标准是「一眼能认出来」，所以只收有辨识度的大站，长尾域名走普通链接。
SITES: dict[str, str] = {
    # 代码托管
    "github.com": "github",
    "gist.github.com": "github",
    "gitlab.com": "gitlab",
    "git-scm.com": "git",
    # 机器人与文档
    "ros.org": "ros",
    "docs.ros.org": "ros",
    "design.ros2.org": "ros",
    "wiki.ros.org": "ros",
    "docs.python.org": "python",
    "python.org": "python",
    "pythonlang.cn": "python",  # Python 中文文档镜像（包括 peps.pythonlang.cn）
    "pypi.org": "pypi",
    "docs.opencv.org": "opencv",
    "streamlit.io": "streamlit",
    # `*.readthedocs.io` 一套都用通用 RTD 标记：具体是哪个项目看链接文字就够了
    "mujoco.readthedocs.io": "readthedocs",
    "zh-google-styleguide.readthedocs.io": "readthedocs",
    "readthedocs.io": "readthedocs",
    # C++ / 构建
    "isocpp.org": "cplusplus",
    "isocpp.github.io": "cplusplus",
    "isocpp.org.cn": "cplusplus",
    "zh.cppreference.com": "cplusplus",
    "en.cppreference.com": "cplusplus",
    "cplusplus.com": "cplusplus",
    "open-std.org": "cplusplus",
    "eel.is": "cplusplus",
    "cmake.org": "cmake",
    "conan.io": "conan",
    "docs.conan.io": "conan",
    "gcc.gnu.org": "gnu",
    "gnu.org": "gnu",
    "www.gnu.org": "gnu",
    "llvm.org": "llvm",
    "clang.llvm.org": "llvm",
    # 系统
    "kernel.org": "linux",
    "docs.kernel.org": "linux",
    "archlinux.org": "archlinux",
    "wiki.archlinux.org": "archlinux",
    "archlinuxcn.org": "archlinux",
    "wiki.archlinuxcn.org": "archlinux",
    "ubuntu.com": "ubuntu",
    "debian.org": "debian",
    "qemu.org": "qemu",
    "docker.com": "docker",
    "docs.docker.com": "docker",
    # 微软系（`learn.microsoft.com` 等）在 Simple Icons 里没有：商标方要求下架了，
    # 所以这里不登记 —— 链接照常渲染，只是不带标记
    # 问答与社区
    "stackoverflow.com": "stackoverflow",
    "zhihu.com": "zhihu",
    "zhuanlan.zhihu.com": "zhihu",
    "wikipedia.org": "wikipedia",
    "zh.wikipedia.org": "wikipedia",
    # 学习与工具
    "colab.research.google.com": "googlecolab",
    "docs.astral.sh": "ruff",
    "google.com": "google",
    "www.google.com": "google",
    "bilibili.com": "bilibili",
    "www.bilibili.com": "bilibili",
    "space.bilibili.com": "bilibili",
    "youtube.com": "youtube",
    "www.youtube.com": "youtube",
    "youtu.be": "youtube",
    "nvidia.com": "nvidia",
    "developer.nvidia.com": "nvidia",
    "docs.nvidia.com": "nvidia",
    "pytorch.org": "pytorch",
    "mathworld.wolfram.com": "wolframmathematica",
    "wolfram.com": "wolframmathematica",
    "openai.com": "openai",
    "chat.openai.com": "openai",
    "chatgpt.com": "openai",
    "qt.io": "qt",
    "vim.org": "vim",
    "neovim.io": "neovim",
    "rust-lang.org": "rust",
    "arm.com": "arm",
}

# 上面登记过、但 Simple Icons 里还没有的 slug 是允许的（下载时跳过）
_cache: dict[str, list[str]] | None = None
_svg_cache: dict[str, str] = {}


def load() -> dict[str, list[str]]:
    """返回 {slug: [path d, ...]}。文件不存在时返回空表（构建照常走）。"""
    global _cache
    if _cache is None:
        if os.path.isfile(DATA):
            with open(DATA, encoding="utf-8") as fh:
                _cache = json.load(fh).get("icons", {})
        else:
            _cache = {}
    return _cache


def slug_for(host: str) -> str | None:
    """域名 -> slug。先精确匹配，再退一级（`foo.github.io` 这种子域）。"""
    host = (host or "").lower().split(":")[0]
    if host.startswith("www."):
        bare = host[4:]
    else:
        bare = host
    for cand in (host, bare):
        if cand in SITES:
            return SITES[cand]
    parts = bare.split(".")
    for i in range(1, len(parts) - 1):
        sub = ".".join(parts[i:])
        if sub in SITES:
            return SITES[sub]
    return None


def has(slug: str | None) -> bool:
    return bool(slug) and slug in load()


def paths(slug: str) -> list[str] | None:
    got = load().get(slug)
    return got or None


def symbol(slug: str) -> str:
    """`<symbol>` 定义。所有 `d` 一律去掉换行，属性只留必要字段。"""
    if slug in _svg_cache:
        return _svg_cache[slug]
    ds = paths(slug) or []
    body = "".join(f'<path d="{d}"/>' for d in ds)
    out = f'<symbol id="site-{slug}" viewBox="0 0 24 24">{body}</symbol>'
    _svg_cache[slug] = out
    return out


def mark(slug: str, cls: str = "site-mark") -> str:
    """链接前面那枚标记。用 `<use>` 指到同页的精灵上：同一个图标在一页里
    出现十次（比如满篇 GitHub 链接）也只内联一份路径数据。"""
    return (f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
            f'<use href="#site-{slug}"/></svg>')


def sprite(slugs: set[str]) -> str:
    """按本页**实际用到**的图标生成精灵，不用的不带。

    只放用到的，是因为个别图标路径极大（GNU 的牛头 14 KB、Linux 企鹅 5 KB），
    把整张表塞进每一页等于给所有页面加几十 KB。
    """
    slugs = {s for s in slugs if has(s)}
    if not slugs:
        return ""
    body = "".join(symbol(s) for s in sorted(slugs))
    return (f'<svg class="site-icons" width="0" height="0" aria-hidden="true" '
            f'focusable="false">{body}</svg>')


# ------------------------------------------------------------------ 维护命令
def fetch(force: bool = False) -> int:
    data = {"license": LICENSE, "source": CDN % "<slug>",
            "note": "由 tools/site-icons.py --fetch 生成，不要手改",
            "icons": load()}
    icons = data["icons"]
    want = sorted(set(SITES.values()))
    got, skipped, failed = 0, [], []
    for slug in want:
        if slug in icons and not force:
            skipped.append(slug)
            continue
        try:
            with urllib.request.urlopen(CDN % slug, timeout=30) as resp:
                svg = resp.read().decode("utf-8", "replace")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            failed.append("%s(%s)" % (slug, getattr(exc, "code", exc.__class__.__name__)))
            continue
        ds = re.findall(r'<path[^>]*\sd="([^"]+)"', svg)
        if not ds:
            failed.append("%s(没有 path)" % slug)
            continue
        icons[slug] = ds
        got += 1
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    print("  新下载 %d 个，已存在 %d 个，失败 %d 个 %s"
          % (got, len(skipped), len(failed), ("： " + "、".join(failed)) if failed else ""))
    print("  共 %d 个图标 -> %s（%.1f KB）"
          % (len(icons), DATA, os.path.getsize(DATA) / 1024))
    return 0


def scan_sources() -> dict[str, int]:
    """扫 content/ 里出现的外链域名，返回 {host: 次数}。"""
    from collections import Counter
    seen: Counter[str] = Counter()
    link = re.compile(r"\bhttps?://([^\s/)\"'<>，。、]+)")
    for kind in ("posts", "docs", "pages", "projects"):
        folder = os.path.join(ROOT, "content", kind)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith(".md"):
                continue
            with open(os.path.join(folder, name), encoding="utf-8") as fh:
                for host in link.findall(fh.read()):
                    seen[host.lower()] += 1
    return dict(seen)


def missing() -> int:
    seen = scan_sources()
    unk = {h: c for h, c in seen.items() if slug_for(h) is None}
    noicon = {h: c for h, c in seen.items() if slug_for(h) and not has(slug_for(h))}
    print("  域名共 %d 个，收录 %d 个"
          % (len(seen), len(seen) - len(unk)))
    if noicon:
        print("  登记了但还没下载图标：%s"
              % "、".join("%s×%d" % kv for kv in sorted(noicon.items())))
    print("  没收录的域名（按出现次数）：")
    for h, c in sorted(unk.items(), key=lambda kv: -kv[1])[:24]:
        print("    %-38s %d" % (h, c))
    return 0


def main() -> int:
    argv = sys.argv[1:]
    if "--fetch" in argv:
        return fetch(force="--force" in argv)
    if "--missing" in argv:
        return missing()
    icons = load()
    print("  已收录 %d 个图标 / 登记 %d 个域名" % (len(icons), len(SITES)))
    for host, slug in sorted(SITES.items()):
        print("    %-32s -> %-20s %s" % (host, slug, "" if slug in icons else "（缺）"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
