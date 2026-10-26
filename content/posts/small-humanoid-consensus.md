---
title: 小型人形机器人的结构、硬件与算法共识
slug: small-humanoid-consensus
date: 2026-02-20
tags: [人形, 强化学习, 系统工程]
summary: 把市面上四款小型人形机器人（G1 / PM01 / T1 / X2）的公开规格摆在一起看：关节数与运动空间、算力与传感器配置、电池与电机选型，以及它们在 SDK 通讯、状态机和行走算法上不约而同的选择。
cover: assets/uploads/gpzko7-gpzko7-996c03172c.webp
featured: false
draft: false
archived: false
---

::: note 迁移说明
规格数据来自各厂商公开资料与实测，判断性结论都标注了「推测」。
:::

## 市面上常见的人形机器人产品

以下面四款小型人形机器人为例：

- 宇树G1：https://www.unitree.com/cn/g1

- 众擎PM01：https://www.engineai.com.cn/product-pm01

- 加速进化T1：https://www.booster.tech/cn/booster-t1/

- 智元灵犀X2：https://www.zhiyuan-robot.com/products/X2

以下简称G1、PM01、T1、X2。

![宇树 G1](/assets/feishu/small-humanoid-consensus/fig-01.webp) ![众擎 PM01](/assets/feishu/small-humanoid-consensus/fig-02.webp) ![加速进化 T1](/assets/feishu/small-humanoid-consensus/fig-03.webp) ![智元灵犀 X2](/assets/feishu/small-humanoid-consensus/fig-04.webp)

---

## 结构上的共同点

- 构形特征

    四款机器人都采用 **两条腿**作为主要支撑和推进结构，而非轮式或履带式。

    每条腿通常由髋（hip）、膝（knee）、踝（ankle）关节组成，形成类似人类的下肢结构。

    上身通常由腰（waist）连接腿部与躯干，上身再延伸出手臂。这样的 “腿–腰–躯干–手臂–头”结构是人形机器人的通用骨架形式。

![图片.png](/assets/feishu/small-humanoid-consensus/fig-05.webp)

![图片.png](/assets/feishu/small-humanoid-consensus/fig-06.webp)

    **腿部脚踝处**基本采用并链结构：

![image.png](/assets/feishu/small-humanoid-consensus/fig-07.webp)

详细解算：

- 规格总结

|机器人|G1|PM01|T1|X2|
|---|---|---|---|---|
|关节数（无灵巧手）|23~25（腰部可选1~3）|24|23|25/29/30|
|头部关节数|0|1|2|0/1|
|腰部关节数|1~3|1|1|3|
|单腿关节数|6|6|6|6/7|
|单手臂关节数|5|5|4|5|
|关节运动空间|腰关节：Z±155°、X±45°、Y±30°|腰关节：-230°~90°|腰关节：Y±58°|腰关节：P±18°、Y-196.5° ~ +136.5°、R±28°|
||髋关节：P±154°、R-30~+170°、Y±158°|髋关节:R-29°~+134°、P-180°~+140°、Y-90°~+230°|髋关节：P±118°、R-21°~88°、Y±58°|髋关节：P±146.5°、R-166.5°~+13.5°、Y-96.5°~196.5°|
||膝关节：0~165°|膝关节：-30°~+137°|膝关节：0°~123°|膝关节：0°~121.5°|
||踝关节：P-50°~30°、R±15°|踝关节：P-39°~41.5°、R±15°|踝关节：P-50°~20°、R±25°|踝关节：P-46°~26°、R±15°|
|高长宽（mm）|1320x450x200|1400x 535.55x252.66|1180x470x230|1310x460x210|
|大致重量（kg）|35|42|30|35|
|脚踝处是否采用并链结构|是|是|是|否|

- 结构形态上：这些尺寸表明它们是 “成人小型”或 “青少年成人” 级别的人形机器人，接近人体下肢高度比例。上肢、腿部长度比例、关节布局都向人体结构靠近。

- 关节自由度上：他们手臂设计为4或5自由度、腿部除了X2皆为6自由度（同时X2并没有使用并链结构）、腰部1～3自由度、头部按需0～2自由度。

- 重量：都在30kg～45kg之间。

- 脚部：在这些机器人中，脚部通常设计为平面或带有限接触区域，以便于支撑和步态稳定。

总结：

- 结构设计前就需要确定机器人的关节数量，因为关系到后续关节选型、URDF、SDK封装等，因而需要尽早确定。

- 目前单条腿基本都为6自由度（6个关节）

- 小型人形机器人整机重量基本控制在 40kg 内（不含灵巧手）

---

## 硬件上的共同点

- 算力平台配置、传感器配置、电池容量、电机选型（方案）在一定程度上趋同，具体数据如下表

|机器人|G1|PM01|T1|X2|
|---|---|---|---|---|
|算力配置|8核高性能CPU+NVIDIA Jetson Orin（可选）|4核高性能CPU+NVIDIA Jetson Orin NX (16G) 157Tops|8核高性能CPU（Express-i7、可选）+Jetson AGX Orin 32GB 200Tops<br>|（RK3588*2）<br>+NVIDIA Jetson Orin NX 157Tops（可选）|
|传感器配置|深度相机（头部 realsense D435i）+3D激光雷达（LIVOX-MID360）<br>|深度相机*2（头部和腰部）<br>|深度相机（头部）|RGB相机（交互）+ RGB相机*2（前后视）、双目RGB相机（前视）、3D激光雷达（可选）|
|电池容量|48V 9Ah|48V（推测） 10Ah|48V 10.5Ah|48V（推测） 10.42Ah|
|电机选型|双编码器旋转电机<br>|双编码器全行星旋转电机|双编码器全行星旋转电机（因克斯）|Unknow<br>|

- 电机：多数人形机器人平台在腿部、膝关节等处采用高扭矩电机＋减速机构＋高精度编码器，以应对步态中快速切换、支撑变换、冲击力等。

- 目前已经售卖的产品基本都是旋转关节，而非直线关节，这可能是由于直线关节在结构、硬件、算法上的适配难度远高于旋转关节，但是直线关节在性能、能耗等方面均有较大优势，目前作为前沿的设计方案之一，如小鹏机器人*IRON。*

- 传感器：普遍参用多个深度相机 +  3D激光雷达（可选）的方案作为机器人的感知硬件配置，除此之外，IMU作为本体感知也是必不可少的传感器。

- 主控方案：基本都采用了 4/8核CPU+ Orin（可选）的方案。

- 电池：电池容量在10Ah左右，且都采用 48V 供电输出。

目前已经产品化的机器人基本都采用了相似的电机选型，几乎相同的电池配置和主控平台。

---

## 软件上的共同点

各厂商机器人后台代码基本都不会开放，因为这可能会暴露所使用的技术路线和硬件选择，也可能被破解逆向造成损失或是发现其中二进制漏洞造成事故。

### SDK接口的共同点

- 算力平台的软件配置基本均为

    - **操作系统**：Ubuntu 22.04/20.04 LTS

    - **ROS2 版本**：Humble/Foxy

    - **Python 版本**：Python 3.8 及以上

    - **C++ 标准**：C++17

- 都采用FSM（有限状态机）来进行模式切换

::: gallery 2 四款机器人的状态机与模式切换
![image.png](/assets/feishu/small-humanoid-consensus/fig-08.webp)
![image.png](/assets/feishu/small-humanoid-consensus/fig-09.webp)
![image.png](/assets/feishu/small-humanoid-consensus/fig-10.webp)
![image.png](/assets/feishu/small-humanoid-consensus/fig-11.webp)
:::

    **通常包括以下状态：**

    - **零力矩模式**

    - **阻尼模式**

    - **站立准备模式**

    - **行走模式/跑步模式**

    - **其他特殊模式**

- SDK 通讯方案汇总

|通讯方案支持|G1|PM01|T1|X2|
|---|---|---|---|---|
|DDS<br>|Cyclone DDS<br>|ROS2<br>|Fast DDS|支持|
|RPC<br>|通过 DDS 自主实现的RPC|ROS2|通过 DDS 自主实现的RPC|支持|
|ROS2接口|支持|支持|支持|支持|
|自动类型发现|是|否|否|Unknow|
|关节通讯频率|500hz|500hz|500hz|Unknow|
|备注<br>|![image.png](/assets/feishu/small-humanoid-consensus/fig-12.webp)|无<br>|![image.png](/assets/feishu/small-humanoid-consensus/fig-13.webp)<br>|无<br>|

- 这四家SDK通讯频率基本接近PM01参数：

![image.png](/assets/feishu/small-humanoid-consensus/fig-14.webp)

    - 底层控制在500hz、高层控制5~50hz

- 基本可以断定，目前都使用DDS作为通讯底层（读写硬件）接口。

- 内部实现是否使用其他组件通讯暂不清楚，可能存在部分进程间通讯会使用以下方案之一

    - POSIX Shared Memory + Lock-Free Ring Buffer（手写底层通讯，与DDS底层相同）

    - LCM（其他类型的通讯组件）

    https://lcm-proj.github.io/lcm/

    - ZeroMQ（其他类型的通讯组件）

    https://github.com/zeromq/libzmq

    - UDS（unix domain socket）

    > 小机器人内部除了DDS外还使用了UDS作为动态配置的方案，如通过UDS启动看门狗实现自动重启、暂停底层控制、启动底层控制等
    >
    >

- 与云端、手机客户端通讯方案

    - 为了支持 **网络穿透（ICE/STUN/TURN）、长连接与实时性**，通常采用 **WebRTC** 或 **gRPC** 作为通讯框架。

    - **WebRTC**

        - 信令阶段通常使用 JSON（因为信令由开发者自定义实现），

        - 实际数据传输可使用任意格式，包括 JSON、Protobuf 或自定义二进制格式。

    - **gRPC**

        - 使用 **Protocol Buffers（Protobuf）** 作为强类型、高效的序列化格式。

        - 适用于结构化 RPC 调用和客户端-服务端通讯。

### 客户端的共同点

- 基本都配备了手机客户端（Android）。

- 具备图形化界面，图形化编程，上层控制等功能。

- 基本都采用AP直连的进行局域网通信。

### 行走/跳舞控制算法的共同点

> 运控主流的 IL(Imitation Learning) 算法可参考： 8.3小节
> 一些前沿的机器人算法论文/存储库可关注：
> https://github.com/YanjieZe/awesome-humanoid-robot-learning

这部分内容无法了解全貌，根据相关厂商开源：

- 宇树开源：

    https://github.com/unitreerobotics/unitree_rl_gym

    https://github.com/unitreerobotics/unitree_rl_lab

    - 第一份仓库基于IsaacGym进行训练，主要通过修改 [legged_gym](https://github.com/leggedrobotics/legged_gym) 实现基础的行走（线速度、角速度追踪任务）策略，仅使用下半身关节（12dof）。

    - 第二份仓库基于IsaacLab进行训练，包括基础的行走策略和基于 [BeyondMimic](https://github.com/HybridRobotics/whole_body_tracking) 实现的全身追踪控制策略，

- 众擎开源：

    https://github.com/engineai-robotics/engineai_rl_workspace

    - 基于IsaacGym进行训练，同上，仅使用下半身关节（12dof）。

    - 可能存在基于 [AMP_for_hardware](https://github.com/Alescontrela/AMP_for_hardware) 实现的风格化策略（比如拟人行走），但是并为开源数据集和代码。

- 加速进化开源：

    https://github.com/BoosterRobotics/booster_gym

    - 基于IsaacGym进行训练，同上，仅使用下半身关节（12dof）。

- 智元没有开源 X2 相关的训练，但是开源了 X1 相关的训练：

    https://github.com/AgibotTech/agibot_x1_train

    - 基于IsaacGym进行训练，同上，仅使用下半身关节（12dof）。

目前常见的小机器人产品厂商开源的RL训练内容均与实际所使用的策略存在巨大差异，推测均为早期实现的开源，参考价值不大。

根据实机表现，推测目前主流的方案如下：

1. 风格化行走策略：基于 [AMP_for_hardware](https://github.com/Alescontrela/AMP_for_hardware) 实现的站立、行走、跑步自动切换（线速度追踪任务，根据参考数据集进行风格化处理和自动切换）。

2. 全身控制（用于全身遥操，跳舞等）：基于 [BeyondMimic](https://github.com/HybridRobotics/whole_body_tracking) 实现的全身追踪，详细可参考，技术路线可参考 [机器人跳舞技术路线概述](https://zhuanlan.zhihu.com/p/1973155848332280065) 。

3. 数据集来源：

    - **开源人体动作数据集**

        这些数据集主要来自动作捕捉（MoCap）系统，常用于 IM 模仿学习、Diffusion Policy、Trajectory Library 训练等。

        常用的开源数据集包括：

        - **AMASS**：当前最大的统一 MoCap 数据集（包含 CMU、HumanEva、MPI 等子集）

        - **OMOMO**：多场景、多动作的人体动作序列

        - **LAFAN1**：适用于动作预测、单步步态生成

        这些数据集通常提供 **人体关节位姿（SMPL 或 3D 关节点）**，可直接转为机器人可用的 joint-space 或 task-space 演示数据。

    - **通过视频生成动作数据：GVHMR + GMR**

        从视频中恢复 3D 人类姿态 → 转换为机器人动作轨迹。最终得到的人形机器人“模仿数据”可直接用于：强化学习 warm-up、行为克隆（BC）、Diffusion Policy 训练、多技能融合策略（如站立、走路、挥手、踢腿等）。

        流程：详细请查看 。

    - **直接采集（遥操作 / Teleoperation）**

        通过以下方式直接记录机器人自身的关节空间数据：

        - VR 手柄（Oculus/HTC）、外骨骼装置、力反馈机械臂、手持六维力传感器、操作者直接操控机器人。

        采集的数据包括：

        - Joint position&velocity、Base pose（IMU）、End-effector trajectory、Force/torque 数据。

        遥操作的数据具有：

        - **高质量、可控动作**（如抓取、搬运、平衡）

        - **最接近实际机器人动力学**（最利于 sim2real）

        通常用于：

        - 复杂技能学习（如上楼梯、搬物、跑跳等）

        - 低延迟控制策略（MPC+RL）

        - 行为克隆 BC → PPO 微调

---
