---
title: humanoid-rl-pipeline
slug: humanoid-rl-pipeline
tagline: 人形 RL 从 Isaac 训练到实机部署的完整流水线
date: 2026-02-20
tags: [人形, 强化学习, sim2real]
stack: [Isaac Lab, PyTorch, PPO, ONNX, C++]
status: 开发中
links:
  - { label: GitHub, href: "https://github.com/" }
  - { label: sim2real 笔记, href: "/posts/humanoid-rl-sim2real/" }
cover: assets/bg/sakura.jpg
featured: true
order: 3
---

把"仿真是龙，实机是虫"这件事工程化：统一的域随机化配置、状态估计误差建模、策略导出与实机保护，一条命令从训练跑到部署包。

## 流程

```
1. train    Isaac Lab 并行训练（4096 环境）→ checkpoint
2. eval     仿真内评估：成功率 / 能耗 / 跟踪误差
3. export   torch → ONNX → 定点化检查
4. verify   离线回放：用录制的实机观测跑一遍，比对输出
5. deploy   生成实机部署包（策略 + 观测/动作配置 + 保护阈值）
```

## 为什么要有第 4 步

直接把 ONNX 丢到实机，出问题只能靠现场看日志猜。离线回放会录制实机运行时的**真实观测序列**，导出的策略在本地跑一遍，和仿真内输出对比：

- 输出差异 < 1%：估计误差是主因
- 输出差异 > 5%：策略本身对观测分布敏感，需要补训练

这一步把"上机才发现"变成"上机前就知道"，省掉大量现场时间。

## 域随机化配置

配置化的随机项，每项都记录**依据来源**（实测值还是经验值）：

```yaml
randomization:
  base_mass:        { range: 0.85..1.15,  source: 实测(含负载) }
  com_offset:       { range: -0.03..0.03, source: 装配误差实测 }
  joint_kp:         { range: 0.75..1.25, source: 三批次电机实测 }
  joint_kd:         { range: 0.75..1.25, source: 同上 }
  motor_delay:      { range: 0..0.004,    source: 总线+驱动实测 }
  ground_friction:  { range: 0.3..1.2,    source: 场地实测 }
  obs_noise:        { range: 标定表,       source: 实机估计误差拟合 }
  push_force:       { range: 50..150,     source: 人为扰动上限 }
```

::: warn 随机化范围必须有依据
早期给关节 PD 加了 ±60% 随机，策略学得非常保守——它在照顾一个现实中不存在的极端机器人。结果能走但走不快。**每一项都写清依据，无依据的先按 ±10% 起步。**
:::

## 实机保护

策略输出不是直接下发电机，中间三层：

```cpp
// 1. 动作层：限幅 + 变化率限制
target = clamp(target, lo, hi);
target = clamp(target, last - max_delta, last + max_delta);

// 2. 状态层：估计器健康 + 姿态角
if (!est.healthy() || fabs(pitch) > 0.9 || fabs(roll) > 0.9) {
    enter_damping_mode();   // 缓慢下蹲，不是直接断力
    return;
}

// 3. 硬件层（独立实时线程，不依赖上位机）
if (current > i_limit || temp > t_limit) hardware_estop();
```

第三层必须独立实现——上位机崩了的时候机器人还在通电。

## 实测

23 自由度人形，Orin NX 部署，策略推理 0.6 ms：

| 任务 | 仿真成功率 | 实机成功率 |
|---|---:|---:|
| 站立抗扰（150 N 侧推） | 99.8% | 96% |
| 0.8 m/s 直线行走 | 99.5% | 92% |
| 含转向行走 | 98.7% | 85% |
| 12° 斜坡 | 97.2% | 78% |

实机普遍低 10~20 个百分点，差距主要来自状态估计误差——这一点从"指令越复杂差距越大"能看出来。

## 已知限制

- 状态估计误差模型目前靠动捕录数据拟合，没有动捕的场景退化到经验噪声
- 只验证过 Orin 平台，x86 上 ONNX Runtime 的推理延迟特性不同
- 未做在线自适应，遇到仿真里没见过的地面（例如松散砂石）会退化
