"""后台 API 端到端测试：增 / 改 / 重命名 / 删 / 上传 / 构建。"""
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:4200"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS = os.path.join(ROOT, "content", "posts")
fails = []


def call(path, data=None):
    # Normal CRUD requests include the revision observed by the editor.
    # Stale-version and concurrent-write scenarios live in test-admin-saving.py.
    if isinstance(data, dict) and "revision" not in data:
        data = dict(data)
        if path == "/api/site":
            data["revision"] = call("/api/state").get("configRevision")
        elif path in ("/api/save", "/api/delete"):
            slug = data.get("originalSlug") if path == "/api/save" else data.get("slug")
            if slug:
                query = urllib.parse.urlencode({"kind": data.get("kind", "post"), "slug": slug})
                data["revision"] = call("/api/doc?" + query).get("revision")
    url = BASE + path
    body = None
    headers = {}
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers,
                                 method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return json.loads(exc.read().decode("utf-8"))


def check(name, cond, extra=""):
    print(("  OK   " if cond else "  FAIL ") + name + ("" if cond else f"   {extra}"))
    if not cond:
        fails.append(name)


print("=== 1. 新建（含中文、标签、外链、公式） ===")
front = {
    "title": "后台实测：DDS 零拷贝验证",
    "slug": "admin-crud-test",
    "date": "2026-05-01",
    "tags": ["测试", "中间件"],
    "summary": "用来自动验证后台增删改的临时文章。",
    "cover": "assets/bg/neon.jpg",
    "featured": False,
    "draft": True,
    "archived": False,
    "links": [{"label": "GitHub", "href": "https://github.com/"}],
}
body = "## 小标题\n\n正文一段，含行内公式 $E = mc^2$。\n\n::: tip 提示\n容器也能用。\n:::\n"
r = call("/api/save", {"kind": "post", "originalSlug": "", "front": front, "body": body})
check("保存返回 ok", r.get("ok") is True, r)
path = os.path.join(POSTS, "admin-crud-test.md")
check("文件已写入", os.path.isfile(path))

raw = open(path, encoding="utf-8").read()
check("UTF-8 无乱码（标题正确）", "后台实测：DDS 零拷贝验证" in raw, raw[:80])
check("标签为流式列表", "tags: [测试, 中间件]" in raw, [l for l in raw.splitlines() if "tags" in l])
check("外链为流式映射", 'href: "https://github.com/"' in raw)
check("布尔写成小写", "draft: true" in raw and "featured: false" in raw)
check("正文含公式", "$E = mc^2$" in raw)

print("=== 2. 回读 ===")
d = call("/api/doc?kind=post&slug=admin-crud-test")
check("title 一致", d["front"]["title"] == front["title"], d["front"].get("title"))
check("tags 一致", d["front"]["tags"] == front["tags"], d["front"].get("tags"))
check("draft 一致", d["front"]["draft"] is True)
check("links 一致", d["front"]["links"] == front["links"], d["front"].get("links"))
check("正文一致", "::: tip 提示" in d["body"])

print("=== 3. 修改（改标题 + 转正式 + 换封面） ===")
d["front"]["title"] = "后台实测：已改名"
d["front"]["draft"] = False
d["front"]["archived"] = True
d["front"]["cover"] = "assets/bg/sakura.jpg"
r = call("/api/save", {"kind": "post", "originalSlug": "admin-crud-test",
                       "front": d["front"], "body": d["body"]})
check("原地保存 ok", r.get("ok") is True and r.get("renamed") is False, r)
raw = open(path, encoding="utf-8").read()
check("标题已更新", "后台实测：已改名" in raw)
check("状态已更新", "archived: true" in raw and "draft: false" in raw)

print("=== 4. 重命名 slug ===")
d["front"]["slug"] = "admin-crud-renamed"
r = call("/api/save", {"kind": "post", "originalSlug": "admin-crud-test",
                       "front": d["front"], "body": d["body"]})
check("renamed 标记", r.get("renamed") is True, r)
check("旧文件已删除", not os.path.isfile(path))
new_path = os.path.join(POSTS, "admin-crud-renamed.md")
check("新文件已创建", os.path.isfile(new_path))

print("=== 5. 归档状态生效于构建 ===")
r = call("/api/build", {})
check("构建成功", r.get("ok") is True, r)
idx = open(os.path.join(ROOT, "public", "index.html"), encoding="utf-8").read()
arch = open(os.path.join(ROOT, "public", "archive", "index.html"), encoding="utf-8").read()
check("归档文不出现在首页", "admin-crud-renamed" not in idx)
check("归档文出现在归档页", "admin-crud-renamed" in arch)

print("=== 6. 上传图片 ===")
# 1x1 PNG
png = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
r = call("/api/upload", {"filename": "probe.png", "data": base64.b64encode(png).decode(),
                         "target": "image"})
check("上传 ok", r.get("ok") is True, r)
up = os.path.join(ROOT, r.get("path", ""))
check("上传文件落盘", os.path.isfile(up))
if os.path.isfile(up):
    os.remove(up)

print("=== 6.5 文档（幻灯片） ===")
# 文档和文章走的是同一套 CRUD，但有三处不一样，都要钉住：
#   1) front-matter 多了 collection / order，且**不写 date**
#   2) 预览必须按幻灯片切，不能整篇当一篇文章渲染
#   3) collection 必须是 site.config.json 里声明过的课程，否则拒绝保存
docs_state = call("/api/state")
cols = [c["id"] for c in (docs_state.get("docCollections") or [])]
check("state 里有课程列表", len(cols) >= 2, cols)
check("state 里有插图清单", len(docs_state.get("figures") or []) >= 10,
      len(docs_state.get("figures") or []))
check("state 统计含文档", (docs_state.get("stats") or {}).get("doc", 0) > 0,
      docs_state.get("stats"))

doc_body = ("# 后台实测文档\n\n----\n\n## 概述\n\n+ 第一页\n\n---\n\n"
            "# 第二节\n\n----\n\n## 第二页\n\n<!--fig:" + (cols and "ros-graph" or "ros-graph") + "-->\n")
r = call("/api/preview", {"kind": "doc", "body": doc_body})
check("文档预览按页返回", r.get("ok") and r.get("deck") is True, list(r.keys()))
check("切出 4 页", r.get("count") == 4, r.get("count"))
check("插图被展开成内联 SVG",
      "<svg" in (r.get("slides") or [{}])[3].get("html", "")
      and "&lt;svg" not in (r["slides"][3]["html"]), None)
check("没有找不到的插图", not r.get("missingFigures"), r.get("missingFigures"))
r2 = call("/api/preview", {"kind": "doc", "body": "# x\n\n<!--fig:不存在的图-->\n"})
check("拼错的插图名会被报出来", r2.get("missingFigures") == ["不存在的图"], r2.get("missingFigures"))

r = call("/api/save", {
    "kind": "doc", "originalSlug": "",
    "front": {"title": "后台实测文档", "slug": "admin-doc-test",
              "collection": cols[0], "order": 42, "tags": ["测试"], "draft": False},
    "body": doc_body,
})
check("保存文档 ok", r.get("ok") is True, r)
doc_path = os.path.join(ROOT, "content", "docs", "admin-doc-test.md")
check("文档落盘", os.path.isfile(doc_path))
if os.path.isfile(doc_path):
    raw = open(doc_path, encoding="utf-8").read()
    check("写入了 collection", "collection: " + cols[0] in raw, raw[:200])
    check("写入了 order", "order: 42" in raw)
    check("文档不写 date", "date:" not in raw.split("---")[1], raw.split("---")[1])
d = call("/api/doc?kind=doc&slug=admin-doc-test")
check("读回 collection", d["front"].get("collection") == cols[0], d["front"])
check("插图标记原样保存（不被展开）", "<!--fig:" in d["body"], d["body"][-60:])

r = call("/api/save", {
    "kind": "doc", "originalSlug": "admin-doc-test",
    "front": {"title": "后台实测文档", "slug": "admin-doc-test",
              "collection": "并不存在的课程", "order": 1},
    "body": doc_body,
})
check("非法 collection 被拒", r.get("ok") is False and "collection" in str(r.get("error", "")), r)

r = call("/api/build", {})
check("文档参与构建", r.get("ok") is True, r)
built = os.path.join(ROOT, "public", "docs", "admin-doc-test", "index.html")
check("文档页已生成", os.path.isfile(built))
if os.path.isfile(built):
    html = open(built, encoding="utf-8").read()
    check("文档页切成 4 张幻灯片", html.count('class="slide') >= 4, html.count('class="slide'))
    check("文档页里有内联 SVG 插图", "<svg" in html)
check("文档进搜索索引",
      "admin-doc-test" in open(os.path.join(ROOT, "public", "search-index.json"),
                               encoding="utf-8").read())
call("/api/delete", {"kind": "doc", "slug": "admin-doc-test"})
check("文档已删除", not os.path.isfile(doc_path))
call("/api/build", {})

print("=== 7. 非法输入防护 ===")
r = call("/api/save", {"kind": "post", "originalSlug": "", "front": {"slug": "../../evil"},
                       "body": "x"})
evil = os.path.abspath(os.path.join(ROOT, "..", "..", "evil.md"))
check("路径逃逸被拦（slug 被清洗）",
      r.get("ok") is True and not os.path.exists(evil) and
      os.path.isfile(os.path.join(POSTS, "evil.md")), r)
if os.path.isfile(os.path.join(POSTS, "evil.md")):
    os.remove(os.path.join(POSTS, "evil.md"))
r = call("/api/upload", {"filename": "x.exe", "data": base64.b64encode(b"MZ").decode()})
check("可执行文件被拒", r.get("ok") is False, r)
r = call("/api/doc?kind=post&slug=../../site.config")
check("文档路径逃逸被拦", r.get("ok") is False, r)

print("=== 8. 删除 ===")
r = call("/api/delete", {"kind": "post", "slug": "admin-crud-renamed"})
check("删除 ok", r.get("ok") is True, r)
check("文件已移除", not os.path.isfile(new_path))

print("=== 9. 上传的图片要能进产物（回归测试） ===")
shutil_src = os.path.join(ROOT, "assets", "bg", "dusk.jpg")
if os.path.isfile(shutil_src):
    raw = open(shutil_src, "rb").read()
    r = call("/api/upload", {
        "filename": "测试封面 cover.jpg",
        "data": "data:image/jpeg;base64," + base64.b64encode(raw).decode(),
        "target": "image",
    })
    check("上传真实尺寸图片", r.get("ok") is True, r)
    up_path = r.get("path", "")
    check("中文文件名保留", "测试封面" in up_path or "cover" in up_path, up_path)
    check("上传文件落盘", os.path.isfile(os.path.join(ROOT, up_path)))

    # 用它当封面建一篇文章，再构建
    r = call("/api/save", {
        "kind": "post", "originalSlug": "",
        "front": {"title": "封面回归测试", "slug": "cover-regression",
                  "date": "2026-06-01", "tags": ["测试"], "cover": up_path,
                  "draft": False},
        "body": "测试用。\n",
    })
    check("建立带封面的文章", r.get("ok") is True, r)

    r = call("/api/build", {})
    check("构建成功", r.get("ok") is True, r)

    built = os.path.join(ROOT, "public", up_path)
    check("产物里存在该封面", os.path.isfile(built), up_path)

    # 顺便验证引用它的页面确实指向一个存在的文件
    page = os.path.join(ROOT, "public", "posts", "cover-regression", "index.html")
    if os.path.isfile(page):
        html = open(page, encoding="utf-8").read()
        check("页面里引用了封面", up_path in html, up_path)
    else:
        check("文章页已生成", False, page)

    call("/api/delete", {"kind": "post", "slug": "cover-regression"})
    if os.path.isfile(os.path.join(ROOT, up_path)):
        os.remove(os.path.join(ROOT, up_path))
    call("/api/build", {})
    check("清理完成", not os.path.isfile(os.path.join(ROOT, up_path)))
else:
    check("找不到测试用图", False, shutil_src)

print("=== 10. 上传边界情况 ===")
PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGA"
           "hKmMIQAAAABJRU5ErkJggg==")   # 1x1 PNG

r = call("/api/upload", {"filename": "IMG_1234.HEIC", "data": PNG_B64, "target": "image"})
check("HEIC 被拒且提示转格式", r.get("ok") is False and "HEIC" in str(r.get("error", "")), r)

r = call("/api/upload", {"filename": "封面 图 (1).jpg", "data": PNG_B64, "target": "image"})
check("中文名带空格括号可上传", r.get("ok") is True, r)
p1 = os.path.join(ROOT, r.get("path", ""))
check("文件名保留中文", "封面" in r.get("path", ""), r.get("path"))
check("无多余连续分隔符", "--" not in os.path.basename(r.get("path", "")), r.get("path"))

r = call("/api/upload", {"filename": "icon.svg", "data": PNG_B64, "target": "image"})
check("svg 可上传", r.get("ok") is True, r)
p2 = os.path.join(ROOT, r.get("path", ""))

r = call("/api/upload", {"filename": "same.jpg", "data": PNG_B64, "target": "image"})
r2 = call("/api/upload", {"filename": "same.jpg", "data": PNG_B64, "target": "image"})
check("重名自动加序号不覆盖",
      r.get("path") != r2.get("path") and os.path.isfile(os.path.join(ROOT, r2.get("path", ""))),
      (r.get("path"), r2.get("path")))
p3 = os.path.join(ROOT, r.get("path", ""))
p4 = os.path.join(ROOT, r2.get("path", ""))

for p in (p1, p2, p3, p4):
    if os.path.isfile(p):
        os.remove(p)
check("边界测试文件已清理",
      all(not os.path.isfile(p) for p in (p1, p2, p3, p4)))

print("=== 11. 主题管理 ===")
state = call("/api/state")
themes0 = state.get("themes") or []
check("state 返回主题列表", len(themes0) > 0, f"{len(themes0)} 套")
check("每套主题字段完整",
      all({"id", "name", "bg", "seeds"} <= set(t) for t in themes0),
      [t.get("id") for t in themes0])

r = call("/api/theme-suggest", {"bg": themes0[0].get("bg", "")})
check("按图取色返回完整种子色",
      r.get("ok") is True and {"accent", "accent2", "darkBg", "lightBg", "tintHue"} <= set(r.get("seeds") or {}),
      r)
r = call("/api/theme-suggest", {"bg": "../../site.config.json"})
check("取色拒绝路径逃逸", r.get("ok") is False, r)
r = call("/api/theme-suggest", {"bg": "assets/bg/不存在的图.jpg"})
check("取色拒绝不存在的图", r.get("ok") is False, r)

# 原样写回：既验证写入链路，又不改动真实数据
r = call("/api/site", {"themes": themes0})
check("原样保存主题列表", r.get("ok") is True, r)
after = (call("/api/state").get("themes") or [])
check("主题数量不变", len(after) == len(themes0), f"{len(themes0)} -> {len(after)}")
check("主题顺序与 id 不变",
      [t["id"] for t in after] == [t["id"] for t in themes0],
      [t["id"] for t in after])
check("种子色原样保留",
      all(a["seeds"] == b["seeds"] for a, b in zip(after, themes0)),
      [(a["id"], a["seeds"], b["seeds"]) for a, b in zip(after, themes0) if a["seeds"] != b["seeds"]])
check("swatch 由种子色推导",
      all(t["swatch"] == [t["seeds"]["accent"], t["seeds"]["accent2"], t["seeds"]["darkBg"]]
          for t in after), [t["id"] for t in after][:3])

r = call("/api/site", {"themes": []})
check("拒绝空主题列表", r.get("ok") is False, r)
r = call("/api/site", {"themes": "不是数组"})
check("拒绝非数组", r.get("ok") is False, r)

# 非法颜色要被兜底，且不能把列表写坏
probe = json.loads(json.dumps(themes0))
probe[0]["seeds"]["accent"] = "红色"
probe[0]["seeds"]["accent2"] = "#abc"
probe[0]["seeds"]["tintHue"] = "abc"
r = call("/api/site", {"themes": probe})
back = (call("/api/state").get("themes") or [])
check("非法颜色被兜底成合法值",
      back[0]["seeds"]["accent"].startswith("#") and len(back[0]["seeds"]["accent"]) == 7 and
      back[0]["seeds"]["accent2"] == "#aabbcc" and isinstance(back[0]["seeds"]["tintHue"], int),
      back[0]["seeds"])
r = call("/api/site", {"themes": themes0})
check("恢复原主题列表", r.get("ok") is True)
check("配置备份已生成", os.path.isfile(os.path.join(ROOT, "site.config.json.bak")))

print()
if fails:
    print(f"!! {len(fails)} 项失败: {fails}")
    sys.exit(1)
print("后台 API 全部通过。")
