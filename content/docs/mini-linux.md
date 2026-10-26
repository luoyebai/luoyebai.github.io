---
title: 从源码构建 mini Linux
slug: mini-linux
tags: [Linux, 内核, BusyBox, QEMU, 从编程开始的学习]
summary: 把 Linux 内核、BusyBox 与 initramfs 接起来，完成从源码构建到 QEMU 启动的实验。
featured: false
draft: false
archived: false
order: 3
collection: learning
origin: "https://github.com/luoyebai/doc_html/blob/HEAD/从编程开始的学习/OS/构建mini_linux/main.md"
---

# 一个最小的 Linux


--

实验由三部分组成：**内核 + 根文件系统 + 第一个用户态进程**。


--

环境：x86_64 Ubuntu 24.04 虚拟机或 Linux 主机、Bash、网络和足够的编译空间。
以下命令按顺序在同一个终端执行；Windows PowerShell 不能直接运行这些命令。

----
## 启动链路


--

```text
QEMU 加载 bzImage
    → 内核初始化设备与内存
    → 解包 initramfs 到 rootfs
    → 执行 /init（PID 1）
    → 挂载虚拟文件系统，进入 Shell
```


--

BusyBox 把多种命令组合为一个程序；`/bin/sh` 等入口可通过符号链接调用对应 applet。
本实验不接入磁盘镜像，系统修改随关机消失。

----
## 安装构建依赖


--

```bash
sudo apt update
sudo apt install build-essential bison flex bc libssl-dev \
  libelf-dev libncurses-dev cpio gzip xz-utils bzip2 wget \
  qemu-system-x86 file
export WORK="$HOME/mini-linux-lab"
mkdir -p "$WORK"
cd "$WORK"
```


--

源码编译使用普通用户。建议使用新的实验目录，避免把其他项目文件打入镜像。

----
## 获取固定版本源码


--

本课固定 Linux 6.12.111、BusyBox 1.37.0，便于记录与复现，不把版本号写成会漂移的“最新版”。


--

```bash
cd "$WORK"
wget https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.12.111.tar.xz
wget https://busybox.net/downloads/busybox-1.37.0.tar.bz2
tar -xf linux-6.12.111.tar.xz
tar -xf busybox-1.37.0.tar.bz2
```


--

版本与发布信息可在 [Kernel.org](https://www.kernel.org/) 和 [BusyBox 下载页](https://busybox.net/downloads/) 核对。
长期使用镜像时应跟进维护版本；本实验镜像只用于启动学习。

----
## 编译内核


--

```bash
cd "$WORK/linux-6.12.111"
make x86_64_defconfig
scripts/config --enable BLK_DEV_INITRD --enable RD_GZIP \
  --enable DEVTMPFS --enable SERIAL_8250 \
  --enable SERIAL_8250_CONSOLE
make olddefconfig
make -j"$(nproc)" bzImage
test -f arch/x86/boot/bzImage
```


--

64 位 x86 内核的产物路径仍是 `arch/x86/boot/bzImage`。
先用默认配置跑通，再研究裁剪；`allnoconfig` 会增加初学者遗漏启动驱动的机会。

----
## 构建静态 BusyBox


--

```bash
cd "$WORK/busybox-1.37.0"
make defconfig
sed -i 's/# CONFIG_STATIC is not set/CONFIG_STATIC=y/' .config
make oldconfig
make -j"$(nproc)"
make CONFIG_PREFIX="$WORK/rootfs" install
file "$WORK/rootfs/bin/busybox"
```


--

输出应显示静态链接；这样根文件系统不用额外复制动态加载器和共享库。
如果构建失败，先读第一条错误并检查宿主工具链，不要跳过后继续打包。

----
## 创建 /init


--

```bash
mkdir -p "$WORK/rootfs"/{proc,sys,dev,tmp}
cat > "$WORK/rootfs/init" <<'EOF'
#!/bin/sh
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
echo 'mini-linux: ready'
exec /bin/sh
EOF
chmod +x "$WORK/rootfs/init"
```


--

这是最小实验入口，不是完整 init 系统。交互 Shell 充当 PID 1，不提供完整作业控制或服务管理。
也可下载本站 [init 示例](/assets/docs/mini-linux/code/init)。

----
## 打包 initramfs


--

```bash
cd "$WORK/rootfs"
find . -print0 | cpio --null -o --format=newc --owner=0:0 \
  | gzip -9 > "$WORK/initramfs.cpio.gz"
gzip -dc "$WORK/initramfs.cpio.gz" | cpio -t
```


--

归档输出放在 `rootfs` **外部**，避免把正在写入的归档又加入自身。
列表中应包含 `init`、`bin/busybox` 和 `bin/sh`，`init` 必须可执行并使用 LF 换行。

----
## 启动并验证


--

```bash
qemu-system-x86_64 \
  -kernel "$WORK/linux-6.12.111/arch/x86/boot/bzImage" \
  -initrd "$WORK/initramfs.cpio.gz" \
  -append 'console=ttyS0 rdinit=/init' \
  -m 256M -nographic -no-reboot
```


--

在客体 Shell 中运行 `uname -r`、`cat /proc/1/comm`、`ls /sys`。
预期内核版本为 6.12.111，PID 1 是 Shell，并能读取虚拟文件系统。
退出 QEMU 使用 **Ctrl+A，然后 X**；不要用 `exit` 结束 PID 1，否则内核可能 panic。

----
## 从错误反查链路


--

| 现象 | 检查 |
|---|---|
| 没有串口输出 | `console=ttyS0` 与串口驱动 |
| 找不到 `/init` | 归档目录结构、`rdinit` 参数 |
| 文件存在仍无法执行 | 执行权限、shebang、CRLF、动态加载器 |
| `/proc` 为空 | init 中的挂载是否成功 |


--

练习：在 `/init` 中打印启动时间，再打包并验证。答案可用 `cut -d' ' -f1 /proc/uptime`。


--

参考：[内核 initramfs 文档](https://docs.kernel.org/filesystems/ramfs-rootfs-initramfs.html)、[QEMU 启动参数](https://www.qemu.org/docs/master/system/invocation.html)。
