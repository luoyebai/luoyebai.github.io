# 文档课件内容复核 · 2026-09-24

本轮逐篇修订原有 16 篇，补齐 3 篇课程，共 19 篇、204 页。清除正文 TODO 与课程待更新条目；保留既有 slug 和课程归属，维持原链接。

## 修订范围

- 补齐编程方法、工程工具与设计范式、特性与因果、调试方法四类原本缺失的内容。
- 修正 C 指针越界和生命周期、C++ 引用/移动/RAII、Python 对象与解释执行等表述。
- 重写 Linux/BusyBox/QEMU 启动步骤，修复路径、归档自包含、静态程序和控制台描述符问题。
- 修正 ROS 2 QoS 方向、depth、Action 组成、节点/进程、TF 时钟、仿真和 OpenCV 表述。
- 新增 C++ 构建与包管理、SLAM 入门、相机与手眼标定。
- 同步修正内联教学图，修复课程序号被全站序号覆盖的问题，以及页码 Enter 跳转。
- 增加 C++ 工程 ZIP、最小 C Shell 和内参标定脚本。示例/片段分别注明环境与输入约定。

## 验证

- `tools/check-lessons.py`：19 篇 / 204 页、课程内序号、无占位内容、18 段 Python 语法、8 段独立 Python 执行、4 个 JavaScript 演示和关键边界用例、下载 ZIP 与源文件一致性。
- Git Bash 语法检查：47 个 Bash 代码块及 2 个启动脚本通过。
- `tools/build.py`、`tools/check-site.py`：66 个 HTML 页面、3354 条资源引用正常。
- `tools/selftest.py`、`tools/docfigs.py --check`、`node --check theme/static/js/docs.js` 通过。
- 浏览器验证：新增标定课件展示、正确课程序号、指定页跳转、QoS 演示运行结果。

## 验证边界

当前 Windows 环境没有可用的 C/C++ 编译器、CMake、ROS、QEMU 或 OpenCV Python 包。
因此未宣称完成 C/C++ 编译、真实棋盘图像标定、内核构建启动或 ROS/SLAM 实验。有关命令按官方文档核对，Python/OpenCV 脚本做语法检查；运行验收步骤已写入各课件。
每篇技术课件末尾列出相关官方资料，ROS 系列固定 Jazzy 教学环境，内核实验固定版本。

## 课件清单

| 课件 | 页数 | 源文件 |
|---|---:|---|
| 初识 Linux | 10 | `content/docs/linux-intro.md` |
| 尝试在 Linux 上编写 C 程序 | 10 | `content/docs/linux-c.md` |
| 从指针来理解程序的执行 | 11 | `content/docs/pointers.md` |
| 编程语言的使用 | 10 | `content/docs/shell-and-languages.md` |
| 工程的构建与维护 | 14 | `content/docs/build-and-maintain.md` |
| C++ 的构建与包管理 | 12 | `content/docs/cpp-build-packages.md` |
| 从 C 语言到 C++ 的转变 | 10 | `content/docs/c-to-cpp.md` |
| 初识 ROS | 11 | `content/docs/ros-intro.md` |
| 节点和工具 | 12 | `content/docs/ros-tools.md` |
| 仿真 | 11 | `content/docs/ros-sim.md` |
| 简单的人脸识别 | 12 | `content/docs/face-recognition.md` |
| SLAM 入门 | 12 | `content/docs/slam-intro.md` |
| 标定：相机与手眼 | 14 | `content/docs/camera-handeye-calibration.md` |
| 编程概述 | 8 | `content/docs/what-is-programming.md` |
| 从 Python 入手 | 11 | `content/docs/python-first.md` |
| 从源码构建 mini Linux | 10 | `content/docs/mini-linux.md` |
| mini_sh · 手写一个 shell | 10 | `content/docs/mini-sh.md` |
| 属性及其原因 | 8 | `content/docs/attributes-and-reasons.md` |
| 像侦探一样地 | 8 | `content/docs/be-a-detective.md` |
