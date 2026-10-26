#!/usr/bin/env python3
"""把 github.com/luoyebai/doc_html 的幻灯片文档迁进本站。

    python tools/import-doc-html.py --src "C:/path/to/doc_html"
    python tools/import-doc-html.py --src ... --dry-run     # 只报告，不写文件

做四件事：
  1. 把每个 main.md / ch1.md 的 JSON 头（author / departments）摘掉，
     换成本站的 front-matter（title / collection / order / tags / summary）。
  2. 正文里的相对链接就地解析：能落地的图片和代码拷进 assets/docs/<slug>/，
     指向别的幻灯片 dist/index.html 的链接改成本站对应的路由，
     剩下实在找不到的目标退化成 GitHub 上的源码目录链接 —— 不留死链。
  3. 「🏠 返回目录」角标指向的是旧站，直接删掉（页面自己带面包屑）。
  4. summary 从「概述」那页自动摘，不手写。

# 源文档 front-matter 里的 `作者：谭嘉淳` 是真实姓名，本站不提真名，一律丢弃；
# 署名统一用站点配置里的网名。

另外顺手把 README 里的「一些网站」整理成 content/pages/links.md。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import mdparse  # noqa: E402

REPO = "https://github.com/luoyebai/doc_html"
SRC_ROOT = ""
CONTENT_DOCS = os.path.join(ROOT, "content", "docs")
ASSET_DOCS = os.path.join(ROOT, "assets", "docs")

IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp"}
HOME_LINK = re.compile(r"\[\s*(?:🏠|🏠️|首页|返回目录)\s*\]\([^)]*\)")
# 图片先处理，链接用 (?<!!) 排掉图片语法，否则 ![](x) 会被当成链接再改一次
MD_IMG = re.compile(r"(!\[[^\]]*\]\()([^)\s]+)([^)]*\))")
HTML_IMG = re.compile(r"<img\b[^>]*?/?>")
HTML_SRC = re.compile(r'\bsrc="([^"]+)"')
MD_LINK = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]+)([^)]*)\)")
# `[文字](<https://…(带括号)>)。URL 里有未转义的圆括号，普通链接语法会被提前截断，
# 源文档用尖括号包起来绕开；这里把括号百分号编码掉，变成合法链接。
ANGLE_URL = re.compile(r"\]\(<([^>]+)>\)")
SCHEME = ("http://", "https://", "mailto:", "data:", "#", "/")
BARE_DOMAIN = re.compile(r"^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:/|$)")

# 迁移清单。src 相对 clone 根目录，slug 是本站路由用的 ASCII 名。
DOCS = [
    # ---- 视觉组教程 / 从 Windows 到 Linux ----
    dict(src="视觉组教程/从Windows到Linux/初识linux/main.md",
         slug="linux-intro", title="初识 Linux",
         collection="windows-to-linux", order=1,
         tags=["Linux", "命令行", "视觉组教程"],
         # 概述页最后一句是那句著名的 Linus 语录，放在个人站点的摘要里不合适
         summary="为什么用 Linux、Linux 到底是什么、怎么把它装起来跑通，以及命令行里最常用的那几条。"),
    dict(src="视觉组教程/从Windows到Linux/Linux上的C/main.md",
         slug="linux-c", title="尝试在 Linux 上编写 C 程序",
         collection="windows-to-linux", order=2,
         tags=["C", "Linux", "gcc", "视觉组教程"]),
    dict(src="视觉组教程/从Windows到Linux/从指针来理解程序的执行/main.md",
         slug="pointers", title="从指针来理解程序的执行",
         collection="windows-to-linux", order=3,
         tags=["C", "指针", "内存", "视觉组教程"]),
    dict(src="视觉组教程/从Windows到Linux/编程语言的使用/main.md",
         slug="shell-and-languages", title="编程语言的使用",
         collection="windows-to-linux", order=4,
         tags=["Shell", "C++", "Python", "视觉组教程"]),
    dict(src="视觉组教程/从Windows到Linux/工程的构建与维护/main.md",
         slug="build-and-maintain", title="工程的构建与维护",
         collection="windows-to-linux", order=5,
         tags=["构建", "CMake", "Makefile", "视觉组教程"]),
    # ---- 从编程开始的学习 ----
    dict(src="从编程开始的学习/简单又轻松的编程/编程概述/main.md",
         slug="what-is-programming", title="编程概述",
         collection="learning", order=1,
         tags=["编程入门", "图灵机", "从编程开始的学习"]),
    dict(src="从编程开始的学习/OS/构建mini_linux/main.md",
         slug="mini-linux", title="从源码构建 mini Linux",
         collection="learning", order=2,
         tags=["Linux", "内核", "BusyBox", "QEMU", "从编程开始的学习"]),
    dict(src="从编程开始的学习/关于学习编程的思考/属性及其原因/main.md",
         slug="attributes-and-reasons", title="属性及其原因",
         collection="learning", order=3,
         tags=["学习方法", "从编程开始的学习"]),
    dict(src="从编程开始的学习/关于学习编程的思考/像侦探一样地/main.md",
         slug="be-a-detective", title="像侦探一样地",
         collection="learning", order=4,
         tags=["学习方法", "从编程开始的学习"],
         summary="真实的侦探和虚构的侦探差在哪：都是先有线索、再有假设，最后才轮到结论 —— 读代码其实是一回事。"),
]

# 两个课程首页用的链接 Logo（源仓库各自的 img/ 目录里都有副本）
BRAND = [
    ("视觉组教程/img/opencv-logo.png", "opencv.png"),
    ("视觉组教程/img/ros-logo.jpg", "ros.jpg"),
    ("视觉组教程/img/cpp-logo.png", "cpp.png"),
    ("从编程开始的学习/img/cs-self-learning.jpg", "cs-self-learning.jpg"),
    ("从编程开始的学习/img/github-log.jpg", "github.jpg"),
    ("从编程开始的学习/img/awesome-logo.svg", "awesome.svg"),
]

# 源文档里指向别的幻灯片的链接 -> 本站路由
DECK_REDIRECT = {
    "初识linux": "/docs/linux-intro/",
    "linux上的c": "/docs/linux-c/",
    "从指针来理解程序的执行": "/docs/pointers/",
    "编程语言的使用": "/docs/shell-and-languages/",
    "工程的构建与维护": "/docs/build-and-maintain/",
    "编程概述": "/docs/what-is-programming/",
    "构建mini_linux": "/docs/mini-linux/",
    "属性及其原因": "/docs/attributes-and-reasons/",
    "像侦探一样地": "/docs/be-a-detective/",
    "从python入手": "/docs/#collection-learning",
    "mini_sh": "/docs/#collection-learning",
}


def _is_image(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in IMG_EXT


class Migrator:
    def __init__(self, src_root: str, dry: bool, force: bool = False):
        self.src_root = src_root
        self.dry = dry
        self.force = force
        self.copied: list[str] = []
        self.unresolved: list[tuple[str, str]] = []
        self.summaries: dict[str, str] = {}
        self.saved = 0          # 无损转 WebP 省下来的字节

    # -- 素材 ---------------------------------------------------------
    def _emit_asset(self, src: str, dst_rel: str, convert: bool = True) -> str:
        """把素材写进 assets/docs/。图片尽力无损转成 WebP。

        为什么值得转：源文档里的插图都是 500~760px 的 PNG 截图，
        26 张就占了 3.6 MB。**无损** WebP 像素完全一致、平均省一半 ——
        对「样式尽量保留」来说这是唯一不妥协的优化。
        转完反而更大的（无损 WebP 存 JPEG 源很常见）就保留原格式。

        `convert=False` 给课程 Logo 用：它们的文件名写在 `site.config.json` 里，
        改了扩展名配置就对不上了（这个坑当场踩了一次）。
        动图（gif）也一律不碰：PIL 存动图 WebP 会丢帧。
        """
        ext = os.path.splitext(src)[1].lower()
        raw = open(src, "rb").read()
        if convert and ext in (".png", ".jpg", ".jpeg", ".bmp", ".webp") and not self.dry:
            try:
                from PIL import Image
                with Image.open(src) as im:
                    buf = io.BytesIO()
                    im.save(buf, "WEBP", lossless=True, quality=100, method=4)
                data = buf.getvalue()
                if len(data) < len(raw):
                    dst_rel = os.path.splitext(dst_rel)[0] + ".webp"
                    self.saved += len(raw) - len(data)
                    raw = data
            except Exception:  # noqa: BLE001 —— 转不了就用原文件，不算错误
                pass
        if not self.dry:
            target = os.path.join(ROOT, dst_rel)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as fh:
                fh.write(raw)
        self.copied.append(dst_rel)
        return dst_rel

    # -- 路径解析 -----------------------------------------------------
    def _candidates(self, src_dir: str, url: str):
        """相对链接可能写错层级（源文档里有一半的 ../code/ 实际在 ./code/），
        所以按「原样 -> 同级 code/ -> 同级 img/」依次试。"""
        name = os.path.basename(url)
        yield os.path.normpath(os.path.join(src_dir, url))
        if name:
            yield os.path.normpath(os.path.join(src_dir, "code", name))
            yield os.path.normpath(os.path.join(src_dir, "img", name))
            # 构建 mini Linux 那篇把 conf/ 和 bin/ 写成了 ../mini_linux/xxx
            for sub in ("conf", "bin"):
                yield os.path.normpath(os.path.join(src_dir, "mini_linux", sub, name))

    def asset(self, url: str, src_dir: str, slug: str):
        """返回 (新 URL, 源文件绝对路径, 目标相对路径)。都没命中就返回 (None, None, None)。"""
        for cand in self._candidates(src_dir, url):
            if os.path.isfile(cand):
                kind = "img" if _is_image(cand) else "code"
                rel = f"assets/docs/{slug}/{kind}/{os.path.basename(cand)}"
                return rel, cand, rel
        return None, None, None

    def intern_link(self, url: str, src_dir: str, slug: str, frag: str) -> str:
        """把一个相对目标改写成站内 URL；落不了地就退回源码仓库。"""
        for cand in self._candidates(src_dir, url):
            if os.path.isfile(cand):
                dst = f"assets/docs/{slug}/{'img' if _is_image(cand) else 'code'}/{os.path.basename(cand)}"
                return self._emit_asset(cand, dst) + frag
        # 指向另一份幻灯片的 dist/index.html -> 本站路由
        parts = [p for p in url.split("/") if p and p != ".."]
        for key, route in DECK_REDIRECT.items():
            if any(key == p.lower() or key in p.lower() for p in parts):
                return route
        self.unresolved.append((slug, url))
        repo_path = os.path.relpath(os.path.join(src_dir, url), self.src_root).replace("\\", "/")
        return f"{REPO}/tree/HEAD/{repo_path.rsplit('/', 1)[0]}"

    # -- 正文改写 -----------------------------------------------------
    def rewrite(self, body: str, src_dir: str, slug: str) -> str:
        body = HOME_LINK.sub("", body)
        body = ANGLE_URL.sub(
            lambda m: "](" + m.group(1).replace("(", "%28").replace(")", "%29") + ")", body)

        def img_sub(m):
            url = m.group(2)
            if url.startswith(SCHEME):
                return m.group(0)
            new, meta = self._img(url, src_dir, slug)
            return f"{m.group(1)}{new}{m.group(3)}" if new else m.group(0)

        def html_img_sub(m):
            tag = m.group(0)
            sm = HTML_SRC.search(tag)
            if not sm:
                return tag
            url = sm.group(1)
            if url.startswith(SCHEME):
                return tag
            new, meta = self._img(url, src_dir, slug)
            if not new:
                return tag
            tag = tag.replace(url, new)
            if "loading=" in tag:
                return tag
            # 顺手补上懒加载（幻灯片里图不少），注意别把自闭合的 `/>` 弄丢
            head = tag.rstrip()
            head = head[:-2] if head.endswith("/>") else head[:-1]
            return head.rstrip() + ' loading="lazy" decoding="async">'

        body = MD_IMG.sub(img_sub, body)
        body = HTML_IMG.sub(html_img_sub, body)

        def link_sub(m):
            text, url, tail = m.group(1), m.group(2), m.group(3)
            if url.startswith(SCHEME):
                return m.group(0)
            if BARE_DOMAIN.match(url):              # www.gnu.org/... 这种漏了协议头
                return f"[{text}](https://{url}{tail})"
            base, _, frag = url.partition("#")
            if not base:
                return m.group(0)
            new = self.intern_link(base, src_dir, slug, ("#" + frag) if frag else "")
            return f"[{text}]({new}{tail})"

        body = MD_LINK.sub(link_sub, body)
        return body

    def _img(self, url: str, src_dir: str, slug: str):
        """图片：找到源文件、转 WebP、写进产物，返回站内路径。"""
        for cand in self._candidates(src_dir, url.split("#")[0]):
            if os.path.isfile(cand):
                dst = f"assets/docs/{slug}/img/{os.path.basename(cand)}"
                return self._emit_asset(cand, dst), None
        self.unresolved.append((slug, url))
        return None, None

    # -- 入口 ---------------------------------------------------------
    def run(self) -> int:
        os.makedirs(CONTENT_DOCS, exist_ok=True)
        self._brand()
        written = 0
        kept = 0
        for doc in DOCS:
            src_path = os.path.join(self.src_root, doc["src"])
            if not os.path.isfile(src_path):
                print(f"  ! 源文件不存在：{doc['src']}")
                continue
            with open(src_path, encoding="utf-8") as fh:
                raw = fh.read()
            body = raw
            if "+++++" in raw:
                body = raw.split("+++++", 1)[1]
            body = self.rewrite(body, os.path.dirname(src_path), doc["slug"])
            body = body.strip("\n") + "\n"

            self_title = doc["title"]
            # 概述页给不出摘要的（或给得不合适的），在清单里手工写死
            summary = doc.get("summary") or self._summary(body, self_title)
            self.summaries[doc["slug"]] = summary
            meta = dict(
                title=doc["title"], slug=doc["slug"], collection=doc["collection"],
                order=doc["order"], tags=doc["tags"], summary=summary,
                origin=f"{REPO}/blob/HEAD/{doc['src']}",
            )
            text = mdparse.dump_front_matter(meta) + "\n" + body
            out = os.path.join(CONTENT_DOCS, doc["slug"] + ".md")
            # 迁完之后这些文件是**手改过的**（补了插图、改了措辞）。
            # 默认不覆盖，否则「重跑一次迁移」会把所有后续编辑悄悄抹掉。
            if os.path.isfile(out) and not self.force:
                kept += 1
                print(f"  跳过（已存在，加 --force 才覆盖）：content/docs/{doc['slug']}.md")
                continue
            if not self.dry:
                with open(out, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(text)
            written += 1
            print(f"  {'(dry) ' if self.dry else ''}{doc['src']}\n"
                  f"        -> content/docs/{doc['slug']}.md  「{doc['title']}」")

        self._report(written, kept)
        self._links_page()
        return 0

    def _brand(self) -> None:
        """两个课程首页用的链接 Logo。"""
        for src_rel, name in BRAND:
            src = os.path.join(self.src_root, src_rel)
            if not os.path.isfile(src):
                print(f"  ! 缺少 Logo：{src_rel}")
                continue
            self._emit_asset(src, f"assets/docs/brand/{name}", convert=False)

    def _links_page(self) -> None:
        """README 的「一些网站」-> content/pages/links.md（页面系统会渲染到 /links/）。"""
        src = os.path.join(self.src_root, "README.md")
        if not os.path.isfile(src):
            print("  ! 找不到 README.md，跳过链接页")
            return
        with open(src, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        start = next((i for i, l in enumerate(lines) if l.strip() == "## 一些网站"), None)
        if start is None:
            print("  ! README 里没有「一些网站」，跳过链接页")
            return
        body: list[str] = []
        for line in lines[start + 1:]:
            if line.startswith("## ") or line.strip() == "-----":
                break
            if line.startswith("### "):
                body.append("## " + line[4:].strip().replace("*", ""))
            else:
                body.append(line)
        # 分组之间压掉多余空行
        text = re.sub(r"\n{3,}", "\n\n", "\n".join(body)).strip()
        meta = dict(
            title="一些网站", slug="links",
            summary="平时真正会点开的那些：技术指南、C++ / GNU/Linux 参考、常用工具和一点点趣味链接。",
            order=90,
        )
        out = os.path.join(ROOT, "content", "pages", "links.md")
        if not self.dry:
            with open(out, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(mdparse.dump_front_matter(meta) + "\n" + text + "\n")
        print(f"  {'(dry) ' if self.dry else ''}README.md -> content/pages/links.md")

    @staticmethod
    def _plain_line(s: str) -> str:
        """把一行 markdown 抹成纯文本。注意不能直接用 mdparse.to_text ——
        它会把换行也压成空格，整块变成一行，逐行过滤就没法做了。"""
        s = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", s)
        s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
        s = re.sub(r"<[^>]+>", " ", s)
        s = re.sub(r"^\s*#+\s*", "", s)
        s = re.sub(r"^\s*[-*+>]+\s*", "", s)
        s = re.sub(r"[*_`~]+", "", s)
        return re.sub(r"\s+", " ", s).strip()

    def _summary(self, body: str, self_title: str = "") -> str:
        """摘「概述」那页做摘要 —— 源文档本来就是这么写的，不另外编。"""
        blocks = re.split(r"^\s*(?:-{3,}|\+{4,})\s*$", body, flags=re.M)
        want = re.sub(r"[\s\-_]", "", self_title).lower()
        for blk in blocks:
            if "概述" not in blk:
                continue
            keep = []
            for line in blk.replace("\r", "").split("\n"):
                p = self._plain_line(line)
                if not p or p.startswith("概述"):                # 「概述（Overview）」小标题
                    continue
                if re.sub(r"[\s\-_]", "", p).lower() == want:    # 正文里重复了一遍标题
                    continue
                keep.append(p)
            keep = keep[:4]          # 只留前几条，概述页后面常有跑题的金句
            # 源文档给链接尾巴统一缀了「(点击查看)」，摘要里读起来全是噪音
            plain = re.sub(r"[（(]\s*点击查看\s*[）)]", "", " ".join(keep))
            plain = re.sub(r"[（(](?:Overview|Why|What|How|Like)[）)]", "", plain, flags=re.I)
            plain = re.sub(r"\s{2,}", " ", plain).strip(" ·-")
            if len(plain) > 20:
                return plain[:118] + ("…" if len(plain) > 118 else "")
        return ""

    def _report(self, written: int, kept: int = 0) -> None:
        print()
        print(f"  文档 {written} 篇"
              + (f"（另有 {kept} 篇已存在、保持原样）" if kept else "")
              + f"，素材 {len(set(self.copied))} 个"
              + (f"，无损转 WebP 省下 {self.saved / 1048576:.1f} MB" if self.saved else ""))
        if self.unresolved:
            print(f"  无法解析的相对目标 {len(self.unresolved)} 处"
                  f"（已退化成源码仓库目录链接）：")
            for slug, url in self.unresolved[:20]:
                print(f"    {slug:24s} {url}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(os.environ.get("TEMP", ""), "doc_html"),
                    help="doc_html 的 clone 路径")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="覆盖 content/docs/ 里已存在的文件（默认跳过，保护手工编辑）")
    args = ap.parse_args()
    global SRC_ROOT
    SRC_ROOT = os.path.abspath(args.src)
    if not os.path.isdir(SRC_ROOT):
        print(f"找不到源仓库：{SRC_ROOT}\n先执行 git clone --depth 1 {REPO}.git")
        return 2
    print(f"源仓库：{SRC_ROOT}")
    return Migrator(SRC_ROOT, args.dry_run, args.force).run()


if __name__ == "__main__":
    raise SystemExit(main())
