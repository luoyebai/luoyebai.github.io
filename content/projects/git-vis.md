---
title: git-vis
slug: git-vis
tagline: 一个给 git 做可视化的工具
date: 2026-09-15
tags: [工具, git, 可视化]
cover: assets/bg/sketch.jpg
featured: true
draft: false
archived: false
order: 1
status: 开发中
links:
  - { label: GitHub, href: "https://github.com/luoyebai/git-vis" }
updated: 2026-09-24
summary: 在本地浏览 Git 历史、回放分支演进，并在执行命令前预览文件与引用变化。
---

GitVis 把仓库历史、分支关系和工作区改动放在同一个本地界面中。它适合回答三个问题：改动从哪里来，分支如何合并，下一条 Git 命令会改变什么。

## 历史与工作区

- 历史图支持横向、纵向布局，以及搜索、缩放和提交差异查看；分支按名称中的斜杠分组。
- 回放按照提交关系重建历史。界面区分 reflog 记录与推测命令，不能把回放理解为原作者真实操作的录像。
- 工作区可以查看未暂存、已暂存改动，编辑文本、暂存文件并提交；合并冲突提供三方视图。
- Git 命令先预览文件和引用变化，再明确确认执行。支持范围包含 status、log、diff、branch、switch、add、restore --staged、commit、merge、fetch、pull 和普通 push。

## 快速开始

需要 Node.js 22.12 或更新版本、Git 2.34 或更新版本，以及 npm。以下命令来自项目 README：

```bash
git clone https://github.com/luoyebai/git-vis.git
cd git-vis
npm ci
npm run build
npm start
```

启动后访问 `http://127.0.0.1:3210`，输入仓库的绝对路径。项目也提供 `scripts/setup.sh`、`scripts/start.sh` 和对应的 PowerShell 脚本。普通仓库与 linked worktree 均在支持范围内。

想先体验历史图和冲突场景，可以运行 `npm run demo`。它建立独立的临时演示仓库，包含分支、合并、标签、未提交改动和本地远端。

## 预览如何连接到执行

预览在独立临时 Git 副本中进行，不直接修改原仓库的引用、索引与工作区。预览令牌有效期为五分钟，并绑定命令与仓库状态；状态改变后需要重新预览，令牌只能使用一次。

同一个 Git 公共目录内的操作进入队列，但这不能阻止其他终端或编辑器同时修改仓库。因此执行前仍需要检查仓库状态，而不能只依赖界面里的旧预览。

## 实现与边界

前端使用 React 与 Vite，Node 服务提供 API，共享类型使用 TypeScript。生产模式由一个本地 Node 服务提供页面、接口和事件流；远端认证沿用系统 SSH agent 或 Git credential helper。

这里的命令框不是任意 shell：管道、重定向和全局 Git 参数不在支持范围内。rebase、cherry-pick、stash、强制推送、hard reset 与 clean 尚未开放。文本编辑限制为 1 MB 内的 UTF-8 普通文件；含过滤器或子模块的仓库有额外写入限制，也不提供自动撤销承诺。

说明依据：[项目 README](https://github.com/luoyebai/git-vis)。README 记录的验证环境为 Linux、Node 22、Git 2.34 与 Chromium；本页没有将 Windows 启动脚本等同于已完成的平台测试。
