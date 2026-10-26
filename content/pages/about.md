---
title: 关于我
slug: about
subtitle: 机器人软件 / 运动控制工程师 · 均普研究院
date: 2026-09-24
summary: 我是洛叶白，关注机器人中间件、运动控制与强化学习。目前在均普研究院从事轮式双臂机器人的工业场景落地与工具链开发，在这里记录从仿真、控制到实机部署的工程实践。
cover: assets/uploads/d6epog-d6epog-0e8f45d3d7.webp
featured: false
draft: false
archived: false
---

我是**洛叶白**，一名机器人软件与运动控制工程师。关注 **Middleware · Motion Control · RL**，也关心这些技术进入真实系统之后，能否稳定运行、方便调试、持续维护。

目前在**宁波均普人工智能与人形机器人研究院（均胜集团）**工作。我的工作连接通信、控制和部署：让数据按时到达，让控制指令得到可靠执行，也让现场的问题能够被记录、定位和复现。

从代码到行动，探索机器人技术。这里记录的既有算法与实现，也有接口约定、参数选择、边界条件和调试过程。

## 现在在做什么

当前重点是**轮式双臂机器人在工业场景中的落地与工具链开发**，使用的平台是智元 G2。

这项工作包含几个相互关联的部分：

- **现场对接**：标定、坐标关系、工艺要求与设备接口。
- **作业流程**：双臂协同、任务编排，以及执行中的状态反馈。
- **调试工具**：配置管理、状态监控、日志采集与回放。
- **部署验证**：把算法改动带到实机上验证，再把现场反馈带回开发过程。

## 技术方向与实践

### 中间件与实时通信

DDS 传输选型、QoS 配置、共享内存与零拷贝、发现机制，以及延迟和抖动的测量。我关心的是通信行为与控制需求是否匹配：哪些数据必须送达，哪些数据更需要保持新鲜，异常时系统如何响应。

[阅读 DDS 选型与调参](/posts/dds-qos-tuning/) · [查看中间件项目](/projects/joysonrobot_comm/)

### 四足与全身运动控制

围绕 MPC 与 WBC 的分层结构，处理接触力、落脚点、关节力矩与任务优先级，也涉及步态生成、状态估计和抗扰。算法之间的接口、约束和运行频率，是这条链路能否协同工作的关键。

[阅读四足 MPC 与腿部正逆运动学](/posts/quadruped-mpc-kinematics/) · [阅读早期步态调参](/posts/legacy-gait-tuning/)

### 强化学习与实机部署

使用 Isaac Lab 等工具进行仿真训练，关注 PPO 策略的观测与动作设计、域随机化、状态估计误差，以及策略导出和实机保护。仿真里的表现只是起点，部署时还需要逐项核对时序、尺度、限幅与反馈。

[阅读人形机器人 0→1 工具链](/posts/humanoid-0-to-1-toolchain/) · [阅读小型人形机器人的共识](/posts/small-humanoid-consensus/)

### 机械臂与接触控制

阻抗控制、导纳控制、力位混合控制与力传感器标定；结合插孔、打磨、拖动示教等接触任务，处理参数整定和保护逻辑。选择控制方式时，先看机器人开放了什么接口，再看任务需要什么行为。

[阅读阻抗与力位混合控制](/posts/arm-impedance-control/) · [查看机械臂控制项目](/projects/arm-impedance-ctrl/)

## 技术栈

| 类别 | 内容 |
|---|---|
| 语言 | C++17/20、Python |
| 中间件 | DDS（CycloneDDS / FastDDS）、iceoryx、ROS 2 |
| 数学与控制 | Eigen、qpOASES、Ceres、Pinocchio、OCS2 |
| 仿真与学习 | Isaac Lab、MuJoCo、PyTorch、PPO、ONNX |
| 工程 | CMake、Docker、PREEMPT_RT、perf / cyclictest / valgrind |

## 工具与开源

- [**joysonrobot_comm**](https://github.com/luoyebai/joysonrobot_comm) —— 基于 Fast-DDS 的机器人通信库：发布订阅、RPC 与 IDL 代码生成。
- [**cordis-cpp**](https://github.com/luoyebai/cordis-cpp) —— C++20 元框架，把可回滚副作用与响应式 coeffect 做成运行时机制。
- [**git-vis**](https://github.com/luoyebai/git-vis) —— 可视化查看 Git 历史、分支与提交关系。
- 更多在 [github.com/luoyebai](https://github.com/luoyebai)

## 在这里可以读到什么

- [**文章**](/posts/)：围绕具体工程问题展开，记录设计取舍、实现与调试。
- [**项目**](/projects/)：按项目整理目标、结构和关键模块。
- [**文档课程**](/docs/)：从 Linux、C/C++ 到 ROS、机器视觉与编程基础，支持按 Markdown 步骤展开的幻灯片，也可以通读。
- [**知识图谱**](/graph/)：通过书架或星云视图，沿标签探索文章与项目之间的联系。
- [**一些网站**](/links/)：整理学习、开发和查阅资料时用到的入口。

内容会随着实践继续修订。比起只留下结论，我更希望把问题的前提、排查路径和适用范围一起写清楚，让之后的自己和遇到类似问题的人能够接着往下走。

### 站点是怎么做的

本站由 Python 静态站点生成器构建，Markdown 解析、代码高亮、模板与本地写作后台都在项目源码中。公式由本地化的 KaTeX 渲染。

文章和 PPT 文档在本地后台编辑，保存后构建生成静态页面，再发布到站点。PPT 支持新增、编辑、拖动排序，以及用 `--` 标记单页内的展示步骤。

外观支持主题、明暗模式、壁纸与阅读设置，偏好保存在当前浏览器。阅读时可以按自己的习惯调整动效、字号和宽度。

## 联系

- GitHub：[@luoyebai](https://github.com/luoyebai)
- Gmail：[luoyebai4444@gmail.com](mailto:luoyebai4444@gmail.com)

欢迎交流机器人中间件、运动控制、强化学习部署，以及开发工具相关的问题。开源项目的问题可以在对应仓库提交 issue；文章勘误或技术讨论也可以发邮件，附上页面链接、问题背景和复现信息会更方便沟通。
