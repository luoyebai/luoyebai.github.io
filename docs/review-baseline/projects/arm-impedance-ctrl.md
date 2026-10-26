---
title: arm-impedance-ctrl
slug: arm-impedance-ctrl
tagline: 机械臂阻抗与力位混合控制库，含参数自整定
date: 2026-01-28
tags: [机械臂, 力控, 运动控制]
stack: [C++17, Eigen, ROS 2, Python]
status: 维护中
links:
  - { label: GitHub, href: "https://github.com/" }
  - { label: 力控笔记, href: "/posts/arm-impedance-control/" }
cover: assets/bg/cyber.jpg
order: 4
---

把阻抗控制、导纳控制、力位混合三种力控方法统一到一套接口下，并附带基于阶跃响应的参数自整定工具。

## 三种控制器的统一接口

```cpp
class ForceController {
public:
    virtual ~ForceController() = default;
    virtual Eigen::VectorXd update(const RobotState& s, const Target& t) = 0;
    virtual void set_stiffness(const Eigen::Matrix<double,6,1>& k) = 0;
    virtual void set_damping(const Eigen::Matrix<double,6,1>& d) = 0;
    virtual Eigen::Matrix<double,6,1> current_params() const = 0;
};

// 工厂
auto ctrl = make_force_controller(
    ForceMode::Impedance,      // 或 Admittance / Hybrid
    robot_model,
    ForceParams{ .K = {300,300,300,0,0,0}, .critical_damping = true });
```

| 模式 | 需要接口 | 适用 |
|---|---|---|
| `Impedance` | 力矩 | 自研关节、有直接力矩接口 |
| `Admittance` | 位置 | 商用协作臂（位置环封装） |
| `Hybrid` | 力矩 | 平面接触任务（法向力 + 切向位） |

## 参数自整定

手动调 $\mathbf{K}_d / \mathbf{D}_d$ 很费时间。库里带一个整定工具：施加阶跃参考，记录响应，自动算出临界阻尼对应的阻尼值，并检查超调。

```bash
# 单方向阶跃整定，输出建议参数
ros2 run arm_impedance tune --axis z --stiffness 500 --step 0.01 --duration 2.0
```

```python
# 输出示例
# measured  : K=500 N/m, zeta=0.42, overshoot=23%, settling=0.68s
# suggested : D=2*zeta_target*sqrt(M*K) -> 建议 D 从 12.0 提到 28.6
#             (临界阻尼 zeta=1.0, 预估 settling 0.21s)
```

## 混合控制的约束坐标系

力位混合的关键是选择矩阵 $\mathbf{S}$ 要和**约束坐标系**对齐。库内置表面法向估计：

```cpp
// 从最近 N 个接触力样本估计表面法向，构造约束坐标系
Eigen::Matrix3d R_c = SurfaceEstimator(window=50).constraint_frame(f_ext_history);

// 在约束坐标系下分解：法向控力，切向控位
Eigen::Matrix<double,6,6> S = Eigen::Matrix<double,6,6>::Zero();
S.topLeftCorner<3,3>() = R_c * normal_selection * R_c.transpose();
```

这样斜面打磨时不需要手工指定方向。

## 安全检查

力控出事故的代价比位置控制大得多，库里内置了这些：

- **上电零力补偿**：任务开始前补偿重力与摩擦，否则操作员感受到的是机器人自重
- **力传感器零漂检测**：静置时读数漂移超阈值就报警，要求重标
- **接触力上限硬限幅**：在力矩层限，不是在期望力层限
- **刚度下限**：$\mathbf{K}_d$ 允许小但不允许为 0（数值发散）

## 实测

UR5e（导纳模式）+ 六维力传感器，插孔任务（间隙 0.2 mm）：

| 参数 | 成功率 | 单次耗时 | 最大接触力 |
|---|---:|---:|---:|
| 位置控制 | 32% | 8.4 s | 78 N |
| 阻抗 K=2000 | 71% | 4.1 s | 34 N |
| 阻抗 K=400 | **94%** | **2.6 s** | **19 N** |
| 阻抗 K=400 + 搜索运动 | **98%** | 2.9 s | 22 N |

低刚度反而更快——因为顺应误差后不需要反复微调位置。

## 已知限制

- 导纳模式受位置环带宽限制，接触刚度上限约 3000 N/m
- 表面法向估计需要至少 30 个接触样本才收敛，起弧阶段仍要用保守参数
- 未做双臂协调力分配
