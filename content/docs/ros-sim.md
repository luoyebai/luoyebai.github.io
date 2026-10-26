---
title: 仿真
slug: ros-sim
collection: vision
order: 3
tags: [仿真, Gazebo, MuJoCo, URDF, sim2real, 视觉组教程]
summary: 从模型、时钟和控制周期建立可信的仿真实验，再用实测数据评估 sim2real 差距。
---

# 仿真：把结论的边界说清楚


--

目标：选择适合任务的仿真工具，检查机器人模型，并建立可重复的验证方法。


--

仿真能加快迭代，但模型误差、数值求解和硬件差异仍需要量化。

----
## 先定义要验证的事情


--

- 系统集成：节点、话题、坐标和启动配置是否正确？

--

- 控制：在设定的动力学与噪声下，跟踪误差和稳定性怎样？

--

- 感知：渲染数据是否覆盖实际光照、视角与材质？

--

- 学习：训练分布是否覆盖部署条件？


--

记录版本、随机种子、时间步和初始状态；不同硬件或引擎版本不保证逐位相同结果。

----
## 按能力选择工具


--

| 工具 | 常见用途 | 选择时核对 |
|---|---|---|
| Gazebo | ROS 系统、传感器与场景联调 | ROS/发行版配对、插件 |
| MuJoCo | 机器人动力学与控制实验 | 接触模型、执行器参数 |
| Isaac Sim / Isaac Lab | 传感器合成、机器人与学习工作流 | GPU、显存、并行方式 |
| PyBullet | 快速物理原型 | API、模型导入与维护需求 |


--

不能脱离模型和硬件给“精度高低”或“几千环境速度”统一排名。
Jazzy 官方配对可使用 Gazebo Harmonic，按对应版本文档安装。

----
## 三种时间要分清楚


--

<!--fig:sim-loop-->


--

物理步长、控制周期、渲染周期可以不同。例如物理 1 ms、控制 10 ms，控制每 10 个物理步更新一次。


--

多数机器人实时仿真实验优先采用固定物理步长，以方便复现和调参；数值积分也存在自适应方法，不能说物理仿真普遍“必须定步长”。
步长应通过减半实验检查结果是否明显变化。


--

ROS 节点需要仿真时间时设置 `use_sim_time=true`，并确认 `/clock` 确实发布。

----
## URDF 描述结构


--

<!--fig:urdf-tree-->


--

link 描述刚体；joint 描述父子关系与运动约束。模型一般组织为树。


--

| joint 类型 | 自由度 |
|---|---|
| fixed | 0 |
| revolute / continuous / prismatic | 1 |
| planar | 3：平面内两平移、一旋转 |
| floating | 6 |


--

不同解析器或仿真插件对关节类型的支持可能不同。

----
## 惯性、可视与碰撞是三件事


--

下面是质量 1 kg、边长 0.2 m 的均匀立方体 link，可用于模型检查：


--

```xml
<robot name="box">
  <link name="base_link">
    <inertial>
      <mass value="1"/>
      <inertia ixx="0.006666667" iyy="0.006666667" izz="0.006666667"
               ixy="0" ixz="0" iyz="0"/>
    </inertial>
    <visual><geometry><box size="0.2 0.2 0.2"/></geometry></visual>
    <collision><geometry><box size="0.2 0.2 0.2"/></geometry></collision>
  </link>
</robot>
```


--

这不是完整仿真世界或控制配置。URDF 长度使用米、质量使用千克；惯量单位为 kg·m²。

----
## origin 与 axis 各在哪个坐标系


--

joint 的 `origin` 描述关节坐标系相对父 link 的位姿；`axis` 表达在关节坐标系中。
inertial 的 origin 描述质心与惯性坐标系；visual/collision 也各有自己的偏移。


--

使用 Xacro 复用参数和重复结构，然后展开为 URDF 检查。


--

```bash
xacro robot.urdf.xacro > robot.urdf
check_urdf robot.urdf
```


--

`check_urdf` 检查解析与树结构，不自动替你汇总质量或证明惯量正确。

----
## 可视化不等于物理验证


--

RViz 展示模型与数据，不执行刚体动力学，不能用“在 RViz 中是否掉落”判断质量。


--

分层检查：


--

1. RViz 中查看 TF、关节轴和几何位置。

--

2. 从 CAD 或独立计算核对质量、质心、惯性。

--

3. 在物理仿真器中检查静止支撑、自由运动与接触。

--

4. 逐个加入执行器、传感器和控制器，观察何时开始异常。

----
## sim2real 差距来自具体机制


--

<!--fig:domain-random-->


--

摩擦、接触、背隙、柔性、执行器饱和、通信与计算延迟、传感器噪声，都可能影响结果。


--

不能统一假设所有真机电机都是 5–20 ms 延迟；应测量自己的链路。
仿真执行器也可以包含延迟与带宽模型，关键是是否正确配置。

----
## 系统辨识与域随机化


--

先用实测数据确定参数和不确定范围，再进行随机化训练或鲁棒性验证。


--

- 区分训练样本与验证轨迹。

--

- 记录随机分布、范围和相关性。

--

- 不只检查奖励，还检查误差、饱和、接触和超时。

--

- 对最差场景与失败案例单独分析。


--

区间太窄可能覆盖不足，太宽可能让任务过于保守；需要实验确定，而不是越随机越好。

----
## 练习与验收


--

在相同初始条件下，将物理步长减半，比较跟踪误差、能量趋势与接触状态。


--

**参考解释**：结果显著改变时，应调查积分误差、接触求解与控制离散化，不能直接归因“控制器坏了”。
仿真与实测出现相位或幅值差异，只提供诊断线索，无法唯一确定是延迟还是摩擦。


--

参考：[Gazebo 与 ROS 版本配对](https://gazebosim.org/docs/harmonic/ros_installation/)、[MuJoCo 计算模型](https://mujoco.readthedocs.io/en/stable/computation/index.html)、[URDF](https://docs.ros.org/en/jazzy/Tutorials/Intermediate/URDF/URDF-Main.html)。
