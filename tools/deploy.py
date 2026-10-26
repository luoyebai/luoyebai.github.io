"""一键部署到 GitHub Pages：构建 → 提交 → 推送。

    python tools/deploy.py                    # 构建并发布
    python tools/deploy.py --base /my-blog    # 项目站点（站点在子路径）
    python tools/deploy.py --no-bg            # 构建不含壁纸的版本
    python tools/deploy.py --dry-run          # 只构建并提交，不推送
    python tools/deploy.py --message "更新文章"

仓库地址与分支取自 site.config.json 的 deploy 段：

    "deploy": {
      "remote": "https://github.com/<用户名>/<仓库名>.git",
      "branch": "gh-pages"
    }

首次使用还需要在 GitHub 上做两件事（只做一次）：
  1. 建好仓库
  2. 仓库 Settings → Pages → Source 选「Deploy from a branch」，
     Branch 选 gh-pages、目录选 / (root)，保存

之后每次发文章只要跑这个脚本。
"""
import argparse
import json
import os
import subprocess
import sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG = os.path.join(ROOT, "site.config.json")

from build import output_directory  # noqa: E402


def run(cmd, cwd=None, check=True):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = (r.stdout or "").strip()
    err = (r.stderr or "").strip()
    if check and r.returncode != 0:
        raise SystemExit(f"!! 命令失败：{' '.join(cmd)}\n{err or out}")
    return r.returncode, out, err


def prepare_repository(pub: str, remote: str, branch: str) -> None:
    """构建前确认发布仓库及分支，避免把产物提交到错误的分支。"""
    if not isinstance(remote, str) or not remote.strip() or remote.startswith("-"):
        raise SystemExit("!! deploy.remote 必须是有效的仓库地址")
    if not isinstance(branch, str) or not branch or branch.startswith("-"):
        raise SystemExit("!! deploy.branch 必须是有效的分支名")
    run(["git", "check-ref-format", "--branch", branch])
    os.makedirs(pub, exist_ok=True)
    if not os.path.lexists(os.path.join(pub, ".git")):
        print("→ 初始化输出目录的 Git 仓库…")
        run(["git", "init", "-b", branch], cwd=pub)
    _, top, _ = run(["git", "rev-parse", "--show-toplevel"], cwd=pub)
    if os.path.normcase(os.path.realpath(top)) != os.path.normcase(os.path.realpath(pub)):
        raise SystemExit("!! 输出目录不是独立的发布仓库，已中止")
    code, current, _ = run(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], cwd=pub, check=False)
    if code or current != branch:
        raise SystemExit(f"!! 发布仓库当前分支为 {current or 'detached HEAD'}，配置为 {branch}。"
                         "请先确认并切换到配置的发布分支，再重新发布。")
    _, conflicts, _ = run(["git", "ls-files", "--unmerged"], cwd=pub)
    if conflicts:
        raise SystemExit("!! 发布仓库存在未解决的合并冲突，已中止")
    _, remotes, _ = run(["git", "remote"], cwd=pub)
    if "origin" in remotes.splitlines():
        run(["git", "remote", "set-url", "origin", remote], cwd=pub)
    else:
        run(["git", "remote", "add", "origin", remote], cwd=pub)
    _, push_urls, _ = run(["git", "remote", "get-url", "--push", "--all", "origin"], cwd=pub)
    if push_urls.splitlines() != [remote]:
        raise SystemExit("!! origin 的实际推送地址与 deploy.remote 不一致，已中止。"
                         "请检查仓库的 pushurl 或 Git URL 重写设置。")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="构建、自检、提交并普通推送博客产物")
    parser.add_argument("--dry-run", action="store_true", help="只构建并提交，不推送")
    parser.add_argument("--message", default="deploy", help="提交说明")
    parser.add_argument("--base", help="站点部署子路径")
    parser.add_argument("--no-bg", action="store_true")
    parser.add_argument("--drafts", action="store_true")
    args = parser.parse_args(argv)

    with open(CONFIG, encoding="utf-8") as fh:
        cfg = json.load(fh)
    deploy = cfg.get("deploy") or {}
    remote = deploy.get("remote", "")
    branch = deploy.get("branch", "gh-pages")
    if not remote:
        print("!! site.config.json 里没有 deploy.remote，先填上仓库地址")
        return 1

    try:
        pub = output_directory(cfg["build"]["outDir"], ROOT)
    except ValueError as exc:
        print(f"!! {exc}")
        return 1
    prepare_repository(pub, remote, branch)

    # 1) 构建；清理只删除旧产物，保留 .git 历史和仓库配置。
    build_cmd = [sys.executable, os.path.join(HERE, "build.py"), "--clean"]
    for flag, enabled in (("--no-bg", args.no_bg), ("--drafts", args.drafts)):
        if enabled:
            build_cmd.append(flag)
    if args.base is not None:
        build_cmd += ["--base", args.base]
    print("→ 构建…")
    code, out, err = run(build_cmd, cwd=ROOT)
    print("  " + (out.splitlines()[-2].strip() if len(out.splitlines()) >= 2 else out))

    # 2) 自检（挡掉线上的白屏/死链）
    print("→ 发布前自检…")
    check_cmd = [sys.executable, os.path.join(HERE, "check-site.py"),
                 "--dir", pub]
    if args.base is not None:
        check_cmd += ["--base", args.base]
    code, out, err = run(check_cmd, cwd=ROOT, check=False)
    if code != 0:
        print(out or err)
        print("!! 自检没通过，已中止。先修好再发布。")
        return 1
    print("  " + (out.strip().splitlines()[-1] if out.strip() else "通过"))

    # 3) 提交
    # 让 git 别对生成物做换行转换，避免每次都是「全部文件被改动」的噪音
    run(["git", "config", "core.autocrlf", "false"], cwd=pub, check=False)
    run(["git", "config", "core.safecrlf", "false"], cwd=pub, check=False)

    run(["git", "add", "-A"], cwd=pub)
    _, status, _ = run(["git", "status", "--porcelain"], cwd=pub)
    if not status:
        print("→ 产物没有变化，跳过提交")
    else:
        changed = len(status.splitlines())
        name = cfg["site"].get("author") or "blog"
        email = cfg["site"].get("email") or "blog@example.com"
        run(["git", "-c", f"user.name={name}", "-c", f"user.email={email}",
             "commit", "-m", args.message], cwd=pub)
        print(f"→ 已提交 {changed} 个文件的改动")

    if args.dry_run:
        print("→ --dry-run：不推送。要发布就去 public/ 里 git push")
        return 0

    # 4) 推送
    print(f"→ 推送到 {remote} 的 {branch} 分支…")
    code, out, err = run(["git", "push", "-u", "origin", f"HEAD:refs/heads/{branch}"], cwd=pub, check=False)
    if code != 0:
        low = (err + out).lower()
        if "publickey" in low or "permission denied" in low:
            print("!! 认证失败，请检查当前远端地址对应的 SSH 密钥或 Git 凭据。")
        elif "non-fast-forward" in low or "fetch first" in low:
            print("!! 远端包含本地没有的提交，普通推送已被拒绝。"
                  "请先在发布仓库中获取并核对远端历史；脚本不会强制覆盖远端。")
        else:
            print(err or out)
        return 1
    if out:
        print("  " + out.splitlines()[-1])
    print()
    site = cfg["site"].get("url", "").rstrip("/")
    print(f"✓ 产物已推送，等待 GitHub Pages 完成部署：{site}/")
    print(f"  （首次还需在仓库 Settings → Pages 里把 Source 设成 {branch} 分支）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
