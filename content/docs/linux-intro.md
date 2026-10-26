---
title: 初识 Linux
slug: linux-intro
tags: [Linux, 命令行, 视觉组教程]
summary: 认识 Linux 的组成，在虚拟机或 WSL 中建立练习环境，掌握路径、权限、软件包与求助方法。
order: 1
collection: windows-to-linux
origin: "https://github.com/luoyebai/doc_html/blob/HEAD/视觉组教程/从Windows到Linux/初识linux/main.md"
---

# 从 Windows 到 Linux


--

目标：能解释发行版是什么，建立练习环境，并在命令行中完成基本文件操作。


--

示例以 Ubuntu 24.04 LTS 的 Bash 终端为教学环境；其他发行版的软件包命令可能不同。

----
## Linux、发行版与桌面


--

- **Linux 内核**管理进程、内存、设备和文件系统接口。

--

- **发行版**把内核、用户空间工具、包管理器和默认配置组合起来。

--

- **桌面环境**提供图形交互，但服务器也可以不安装桌面。

--

- **Shell**解释命令；终端提供输入和显示窗口。


--

Linux 属于 Unix-like 系统，不能简单写成“Linux 是 UNIX 的一个版本”。

----
## 为什么机器人项目常用 Linux


--

驱动、编译器、ROS 软件包、自动化脚本和远程运维形成了常见的开发环境。


--

选择平台仍要看：硬件驱动、供应商 SDK、实时要求、团队经验与部署方式。


--

Linux 不会自动让程序更安全、更快或满足实时性；这些结果依赖系统配置和软件设计。

----
## 先选择练习方式


--

| 方式 | 适合 | 需要注意 |
|---|---|---|
| 虚拟机 | 学习完整系统与快照恢复 | USB、GPU 和网络行为有差异 |
| WSL 2 | Windows 上使用 Linux 开发工具 | 设备直通、网络和桌面依赖需核对 |
| 原生安装 | 实际硬件与驱动联调 | 先备份，再处理磁盘分区 |


--

初学可先使用虚拟机或 WSL，不必一开始改动主机磁盘布局。
涉及机器人驱动时，再按硬件要求选择环境。

----
## 路径：知道自己在哪里


--

```bash
pwd
mkdir -p "$HOME/linux-practice/notes"
cd "$HOME/linux-practice"
printf 'hello\n' > notes/hello.txt
ls -l notes
cat notes/hello.txt
```


--

`/` 开头是绝对路径；`notes/hello.txt` 是相对路径；`.` 是当前目录，`..` 是父目录。
大小写通常有区别，带空格的路径应加引号。

----
## 文件操作与检查


--

```bash
cp notes/hello.txt notes/hello-copy.txt
mv notes/hello-copy.txt notes/greeting.txt
find notes -type f -name '*.txt'
wc -l notes/hello.txt
```


--

执行修改前先看路径与文件名。Shell 的通配符会展开，`'*.txt'` 在这里交给 `find` 解释。


--

编辑配置前保留可恢复副本；不要把不理解的删除命令直接复制到终端。

----
## 用户与权限


--

```bash
id
ls -l notes/hello.txt
chmod u+rw notes/hello.txt
```


--

权限分所有者、组和其他用户，`r/w/x` 分别控制读、写、执行；目录的 `x` 表示可遍历。


--

`sudo` 仅用于确实需要管理员权限的操作。日常写代码和编译不需要设置 root 密码或以 root 身份工作。

----
## 软件包与更新


--

Ubuntu / Debian 示例：


--

```bash
sudo apt update
apt show build-essential
sudo apt install build-essential gdb
```


--

`update` 刷新软件包索引，`upgrade` 才更新已安装的软件包。
发行版包、项目依赖和 Python 虚拟环境承担不同职责，不要混成一个全局环境。

----
## 错误不是终点


--

| 现象 | 先检查 |
|---|---|
| `command not found` | 命令是否安装、`PATH` 是否正确 |
| `Permission denied` | 文件权限、目录权限、挂载选项 |
| `No such file or directory` | 当前目录、路径拼写、解释器是否存在 |
| 网络连接失败 | 服务是否监听、地址端口、路由与防火墙 |


--

使用 `man ls`、`ls --help` 和完整错误信息查找原因，不要先尝试给所有命令加 `sudo`。

----
## 练习与下一步


--

建立 `linux-practice/logs`，写入两行文本，复制到 `backup.txt`，用 `wc -l` 验证行数。


--

参考答案：


--

```bash
mkdir -p "$HOME/linux-practice/logs"
cd "$HOME/linux-practice/logs"
printf 'first\nsecond\n' > sample.txt
cp sample.txt backup.txt
wc -l backup.txt
```


--

预期行数为 2。接着学习 [Linux 下的 C 语言](/docs/linux-c/)。


--

参考：[Ubuntu 命令行教程](https://ubuntu.com/tutorials/command-line-for-beginners)、[WSL 安装说明](https://learn.microsoft.com/windows/wsl/install)。
