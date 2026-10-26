---
title: 机械臂运控：阻抗控制与力位混合
slug: arm-impedance-control
date: 2026-01-22
tags: [机械臂, 运动控制, 力控]
summary: 位置控制只能应付自由空间，一旦接触工件，位置环会把力误差一路放大到撞坏东西。这篇讲阻抗控制的核心式子和参数怎么定，以及和力位混合控制到底该选哪个。
cover: assets/bg/cyber.jpg
---

机械臂只做位置控制有个硬伤：**它不知道自己使了多大劲**。轨迹上多出 2 mm 的工件，位置环就会一直加压直到电机堵转或者工件变形。

力控的三种主流做法：阻抗控制、导纳控制、力位混合控制。它们解决的问题不同，选错会很难用。

## 阻抗控制：把机器人变成弹簧阻尼

核心思想是不再控制位置，而是**建立力与位置偏差之间的动态关系**：

$$
 \mathbf{M}_d (\ddot{\mathbf{x}} - \ddot{\mathbf{x}}_d) + \mathbf{D}_d (\dot{\mathbf{x}} - \dot{\mathbf{x}}_d) + \mathbf{K}_d (\mathbf{x} - \mathbf{x}_d) = -\mathbf{F}_{ext} 
$$

翻译成人话：外部施加 $\mathbf{F}_{ext}$ 时，末端偏移多少由 $\mathbf{K}_d$ 决定，偏移多快由 $\mathbf{D}_d$ 决定，加速度响应由 $\mathbf{M}_d$ 决定。三个矩阵就是你要调的全部参数。

关节力矩由下面的控制律给出：

$$
 \boldsymbol{\tau} = \mathbf{J}^\top \Big( \mathbf{M}_d^{-1}\big( \mathbf{D}_d \dot{\tilde{\mathbf{x}}} + \mathbf{K}_d \tilde{\mathbf{x}} - \mathbf{F}_{ext} \big) \Big) + \mathbf{C}(\mathbf{q},\dot{\mathbf{q}})\dot{\mathbf{q}} + \mathbf{g}(\mathbf{q}) 
$$

其中 $\tilde{\mathbf{x}} = \mathbf{x}_d - \mathbf{x}$ 是位置偏差。

```cpp
Eigen::VectorXd impedance_control(const RobotState& s, const Target& t) {
    const Eigen::MatrixXd J = jacobian(s.q);
    const Eigen::Vector3d dx  = t.x_des - s.x;          // 位置偏差
    const Eigen::Vector3d dv  = t.v_des - s.v;          // 速度偏差

    // 期望的笛卡尔加速度
    Eigen::Vector3d a_cmd =
        Md_inv * (Dd * dv + Kd * dx - s.f_ext);

    // 关节力矩：J^T 映射 + 补偿项
    Eigen::VectorXd tau = J.transpose() * (Md * a_cmd)
                        + coriolis(s.q, s.dq) + gravity(s.q);
    return tau;
}
```

## 参数怎么定

$\mathbf{M}_d, \mathbf{D}_d, \mathbf{K}_d$ 都是 6×6（3 平移 + 3 旋转）。实际调试时按下面的顺序：

1. **先定 $\mathbf{K}_d$**。它决定"刚度"，也就是接触时机器人有多"硬"。
   - 装配插孔：低刚度（平移 200~500 N/m），让机器人能顺应误差
   - 打磨/抛光：中等（1000~3000 N/m），保持恒定接触力
   - 搬运重物：高刚度（10000+ N/m），接近位置控制

2. **$\mathbf{D}_d$ 按临界阻尼配**：

$$
 \mathbf{D}_d = 2\sqrt{\mathbf{M}_d \mathbf{K}_d} 
$$

   欠阻尼会振荡，过阻尼响应迟钝。取临界阻尼的 0.8~1.2 倍区间微调。

3. **$\mathbf{M}_d$ 最后调**。它主要影响动态响应，稳态行为由 $\mathbf{K}_d$ 决定。多数场景直接取对角阵，数值取任务惯量的量级即可。

::: tip 旋转自由度要单独处理
平移和旋转的刚度量纲不同（N/m vs N·m/rad），不能用一个数。而且旋转方向的惯量随姿态变化，$\mathbf{M}_d$ 用定值会导致某些姿态下振荡。实际做法是只对旋转方向做阻尼控制，刚度给 0。
:::

## 导纳控制：位置环机器人也能用力控

阻抗控制需要**力矩接口**。如果你的机械臂只能收位置指令（很多协作臂是这个情况），那就用导纳控制——它是阻抗的对偶：

$$
 \mathbf{M}_d \ddot{\mathbf{x}} + \mathbf{D}_d \dot{\mathbf{x}} + \mathbf{K}_d (\mathbf{x} - \mathbf{x}_0) = \mathbf{F}_{ext} 
$$

解出 $\mathbf{x}$，作为位置指令发给位置环。区别在于：阻抗控制是"力的控制器"，导纳控制是"位置的修正器"。

| | 阻抗控制 | 导纳控制 |
|---|---|---|
| 需要接口 | 力矩 | 位置 |
| 接触刚度上限 | 高（可做刚性接触） | 低（受位置环带宽限制） |
| 稳定性 | 无源性易保证 | 需要额外处理接触刚度 |
| 适用 | 自研关节、有力和位混合接口 | 商用协作臂 |

## 力位混合控制：任务空间分解

如果任务本身可以明确分成"某些方向控位、某些方向控力"，用 Raibert-Craig 的混合控制更直接：

$$
 \boldsymbol{\tau} = \mathbf{J}^\top \big( \mathbf{S} \mathbf{F}_{pos} + (\mathbf{I} - \mathbf{S}) \mathbf{F}_{force} \big) 
$$

$\mathbf{S}$ 是对角选择矩阵：$\mathbf{S}_{ii}=1$ 表示该方向控位，$=0$ 表示控力。

典型场景是**平面接触**：法向控力（比如恒定 20 N 压紧），切向控位（沿表面移动）。这时候混合控制比阻抗控制好调得多，因为两个方向解耦了。

::: warn 选择矩阵不能随便取
$\mathbf{S}$ 必须和**约束坐标系**对齐。工件表面是斜面时，如果还在世界坐标系里选方向，法向控力的那个轴就指错了。做法是先估计表面法向，构造约束坐标系再分解。
:::

## 什么时候用哪个

| 场景 | 推荐 | 理由 |
|---|---|---|
| 插孔 / 装配 | 阻抗控制（低刚度） | 需要顺应位置误差，接触力不需要精确 |
| 表面打磨 / 抛光 | 力位混合 或 力控阻抗 | 法向力要恒定，切向要跟轨迹 |
| 人机协作 / 拖动示教 | 导纳控制 | 只需外力感知，位置接口够用 |
| 抓取易碎物 | 阻抗 + 抓取力闭环 | 需要柔顺，不能撞 |
| 高速搬运 | 位置控制 + 前馈 | 力控反而拖慢节拍 |

## 踩过的坑

::: danger 三个真实事故

1. **零力补偿没做，机器人"锁死"**。上电时电机抱闸，末端无法被推动，操作员以为力控坏了。阻抗控制必须在任务开始前做重力与摩擦补偿，否则你感受到的是机器人的自重。
2. **力传感器零漂**。开机时传感器读数有 0.8 N 偏置，插孔时一直往一边顶，工件被顶飞。力控任务前必须做零点标定，且温度变化后要重标。
3. **$\mathbf{K}_d$ 给了纯对角 0**。想让机器人"完全柔顺"，结果数值上 $\mathbf{J}^\top$ 的伪逆发散了。刚度可以小，但不能是 0，至少留一点做数值稳定。
:::
