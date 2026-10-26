---
title: 四足运控：MPC 与 WBC 的分层结构
slug: quadruped-mpc-wbc
date: 2026-03-08
updated: 2026-03-20
tags: [四足, 运动控制, MPC, WBC]
summary: 四足机器人的运控栈基本是「上层 MPC 出地面反作用力，下层 WBC 分配到关节力矩」。这篇讲清两层的接口怎么定、任务优先级怎么排、以及为什么我最后放弃了纯 MPC 方案。
cover: assets/bg/dusk.jpg
featured: true
---

四足运控的主流架构现在很统一：**MPC 管质心与落脚点，WBC 管全身协调与力矩分配**。看起来是两个独立模块拼起来，实际上耦合点全在接口上——接口定错了，调多久都不稳。

## 为什么必须分两层

单层 MPC 直接优化关节力矩，理论上最优，实际有两个问题：

1. **维度爆炸**。12 自由度 + 接触力 + 摩擦锥约束，非线性 MPC 的求解时间压不进 1 kHz，而四足的控制周期通常是 500 Hz ~ 1 kHz。
2. **接触状态难处理**。摆动腿与支撑腿的动力学模型不同，单层里处理切换会产生不连续的梯度。

分层之后，上层在**简化模型**（单刚体 / SRBM）上做优化，下层在**全模型**上做瞬时分配。上层 30~50 Hz，下层 500 Hz~1 kHz。

## 上层：单刚体 MPC

状态取质心位置、姿态、线速度、角速度：

$$
 \mathbf{x} = \begin{bmatrix} \mathbf{p} & \boldsymbol{\Theta} & \mathbf{v} & \boldsymbol{\omega} \end{bmatrix}^\top \in \mathbb{R}^{12} 
$$

控制量是四条腿的接触力 $\mathbf{f}_i \in \mathbb{R}^3$，通过质心动力学建立映射：

$$
 \begin{aligned} m\ddot{\mathbf{p}} &= \sum_{i=1}^{4} \mathbf{f}_i + m\mathbf{g} \\ \mathbf{I}\dot{\boldsymbol{\omega}} &= \sum_{i=1}^{4} (\mathbf{r}_i - \mathbf{p}) \times \mathbf{f}_i \end{aligned} 
$$

约束是摩擦锥的线性化近似（金字塔形）：

$$
 \big| f_i^x \big| \le \mu f_i^z, \quad \big| f_i^y \big| \le \mu f_i^z, \quad f_i^z \ge 0 
$$

写成 QP 就能实时求解：

```python
def build_mpc_qp(x0, foot_positions, contact_mask, N=10, dt=0.03):
    """单刚体 MPC -> 每步各腿的接触力"""
    prob = qpsolvers.Problem(P, q, G, h, A, b)
    # 决策变量: 每步 4 条腿 x 3 维力
    # 约束 1: 质心动力学（等式，由 A/b 给出）
    # 约束 2: 摩擦锥 + 法向力非负（不等式，由 G/h 给出）
    return solve_qp(prob)
```

::: tip 落脚点也要进决策变量
只优化力不优化落脚点，机器人只能"原地调整"，遇到大扰动会僵住。把下一步的落脚位置 $(\mathbf{r}_i)$ 也作为决策变量，并加线性化的可达域约束（髋关节可达空间），抗扰能力会明显不同。
:::

## 下层：WBC 的优先级

WBC 要同时满足一堆可能互相冲突的任务，靠的是**零空间投影**：

$$
 \dot{\mathbf{q}} = \mathbf{J}_1^{+} \dot{\mathbf{x}}_1 + \mathbf{N}_1 \big( \mathbf{J}_2^{+} \dot{\mathbf{x}}_2 + \mathbf{N}_2 (\cdots) \big) 
$$

我实际用的任务优先级：

| 优先级 | 任务 | 说明 |
|---|---|---|
| 1 | 动力学方程 | 硬约束，不可违反 |
| 2 | 摩擦锥 / 力矩上限 | 硬约束 |
| 3 | 支撑腿不滑动 | 等式约束 |
| 4 | 质心合力/力矩跟踪 MPC 输出 | 主要目标 |
| 5 | 躯干姿态 | 保持水平或指定俯仰 |
| 6 | 摆动腿轨迹跟踪 | 由步态发生器给出 |
| 7 | 关节速度阻尼 | 抑制高频抖动 |

低优先级任务被投影到高优先级任务的零空间里，所以**永远不会破坏高优先级目标**。

```cpp
// 逐级求解 + 零空间累积
Eigen::MatrixXd N = Eigen::MatrixXd::Identity(nv, nv);
Eigen::VectorXd dq = Eigen::VectorXd::Zero(nv);

for (const auto& task : prioritized_tasks) {
    const Eigen::MatrixXd Jbar = task.J * N;              // 投影后的雅可比
    const Eigen::VectorXd e = task.error();
    Eigen::VectorXd dz = Jbar.completeOrthogonalDecomposition().solve(e);
    dq += N * dz;
    N *= (Eigen::MatrixXd::Identity(nv, nv)
          - Jbar.completeOrthogonalDecomposition().pseudoInverse() * Jbar);
}
```

## 接口怎么定：交换力，不交换轨迹

我试过两种接口：

| 方案 | 上层输出 | 下层输入 | 效果 |
|---|---|---|---|
| A | 质心轨迹 + 落脚点 | WBC 自己算力 | 两层都在解 QP，重复计算；调参互相干扰 |
| B | **接触力 + 落脚点 + 步态相位** | WBC 只做分配与协调 | 职责清晰，好调，我最终选这个 |

方案 B 的关键认识：**MPC 优化出来的接触力本身就是下层最需要的量**。让 WBC 从质心轨迹反推力，等于把上层解出来的信息丢掉再解一遍。

## 踩过的坑

::: warn 五个让我 debug 到凌晨的问题
1. **接触力打滑**。摩擦系数取 0.6，实际地砖只有 0.35。上坡起步直接劈叉。摩擦系数要按最差地面标定，不要用橡胶块实验室数据。
2. **摆动腿提前落地**。步态相位和 MPC 的时间步没对齐，腿在力分配生效前就触地，产生冲击。相位必须由同一个时钟驱动。
3. **WBC 的力矩差分成关节加速度**。数值微分噪声极大，必须加低通，否则高频抖动会烧电机。
4. **MPC 求解超时**。求解时间不固定，偶尔超过周期，控制器用了旧的力。必须做超时保护：超时就退化为上一步的解 + 重力补偿。
5. **姿态用欧拉角**。俯仰接近 ±90° 时万向节死锁，MPC 梯度爆炸。用四元数或旋转矩阵，误差项用 so(3) 对数映射。
:::

## 实测

12 自由度四足，Trot 步态，MPC 33 Hz / WBC 500 Hz，NVIDIA Orin 上：

| 指标 | 纯 MPC | MPC + WBC |
|---|---:|---:|
| 单周期耗时（p99） | 18.4 ms | 1.7 ms |
| 可承受最大侧向推力 | 90 N | 210 N |
| 20° 斜坡通过 | 失败 | 通过 |
| 关节力矩抖动（标准差） | 4.2 N·m | 1.1 N·m |

分层之后不是"精度差一点换速度"，而是**各方面都更好**——因为全模型 WBC 在分配力矩时才能真正考虑关节力限与惯量耦合。
