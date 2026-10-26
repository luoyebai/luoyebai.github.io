---
title: 脚踝并联机构：正逆运动学与静力学解算
slug: parallel-ankle-kinematics
date: 2025-07-20
tags: [运动控制, 运动学, 人形]
summary: 从三维连杆约束推导并联踝的逆解、正解、雅可比与力矩映射，并在浏览器中的 MuJoCo 闭环机构里观察两台电机如何带动被动脚底关节。
cover: assets/uploads/yxz3pd-yxz3pd-5f025e515c.webp
featured: false
draft: false
archived: false
---

::: note 迁移说明
原文档里的两个代码压缩包未随导出保留，相关小节改成文字说明。
:::

先打开下面的实验，试试“只动 A”“同向输入”“反向输入”，再拖动电机目标角。输入曲线的虚线是电机目标，实线是积分得到的实际电机角；输出曲线显示被动脚底 Roll/Pitch。目标更新不会直接改变脚底姿态，需要开始或单步推进物理仿真。

再取消“电机 B 通电”：它的驱动力矩变为零，改变 B 的目标不再驱动机构，但 B 仍能被连杆和重力带动。**B 目标为零且保持通电**意味着 PD 控制器主动维持零位，与断电不同。重新通电后看恢复目标的过程，再到“控制器与外力”给脚底施加力矩，比较姿态偏差、电机力矩和闭环残差。暂停时修改通电状态会在下一物理步体现到响应中。

也可以点击实验台下方的 **“运行对照实验”**：浏览器会另开一个独立的物理实例，从相同零位分别运行六组输入，列出 2 秒时的电机实际角、被动 Roll/Pitch 和闭环残差。特别比较“只给 A”与“B 断电”：两组目标相同，但 B 是否主动出力会改变传动结果。表格里的“观察”可以在三维视图中复现该组过程；这些数值每次由 MuJoCo 重算，2 秒时的状态不一定已经达到稳态。

默认的 **LimX HU-D04 左踝**截取自 [LimX 官方闭环模型](https://github.com/limxdynamics/humanoid-description)，保留电机、球铰连杆及被动脚底关节，小腿固定在实验台上。切到 **双杆教学模型**，可以对照本文的双 Y 轴电机推导，输入期望姿态并用 IK 生成电机目标；脚底依然由 MuJoCo 通过电机力矩和闭环约束求解。两套模型的轴向、零位和尺寸不同，教学参数不代表 LimX 或 Unitree G1 真机。

为什么默认选 LimX？它的公开模型明确驱动 A/B 电机，Pitch/Roll 是被动关节，两根连杆通过 `connect` 闭合，适合观察传动因果关系。[Unitree 的 G1 mjlab 配置](https://github.com/unitreerobotics/unitree_rl_mjlab/blob/main/src/assets/robots/unitree_g1/g1_23dof_constants.py)则注明连杆准确几何未知，采用名义 1:1 传动比近似，并直接控制 Pitch/Roll；这份配置不能单独说明两台实体电机如何经连杆带动脚底。[社区 G1 并联踝示例](https://github.com/feidedao/Parallel_Ankle_Joint)有闭链运动学实现，但作者注明动力学参数不准确，因此本站没有把它当作 G1 力矩响应的依据。

```mujoco ankle
```

## 脚踝并联解算需求

> 标准 URDF 的关节拓扑是一棵树，不能直接表达闭环约束。控制侧需要处理并联踝电机坐标与脚底姿态的映射；MuJoCo 则可以在运动学树之外追加等式约束，模拟闭环机构。

实现以下函数

输入：脚踝目标欧拉角、电机当前角度、电机当前转速

得到输出：电机目标角度、脚踝当前欧拉角、脚踝当前角速度

```cpp
ParallelCal::CalOutData ParallelCal::calculate(const ParallelCal::Euler& euler, const ParallelCal::Q& q, const ParallelCal::Dq& dq) const {
    ParallelCal::Q q_c = this->iKCal(euler);
    ParallelCal::Euler e_c = this->fKCal(q);
    ParallelCal::Gyro gyro = this->dqToGryo(e_c, q, dq);

    return ParallelCal::CalOutData{q_c, e_c, gyro};
}
```

2种实现方式

1. 通过采集数据进行插值打表或函数拟合

2. 建立几何模型做正逆运动学解算，并用标定与实验核对参数和误差。几何推导可解释，但精度仍取决于模型、尺寸和实际机构。

## 通过采集数据进行函数拟合

### 通过Solidworks进行数据采集

- [x] ~~相关方式已确认~~

### 数据形式和脚本使用方式

#### 数据形式

![图片.png](/assets/feishu/parallel-ankle-kinematics/fig-01.webp)

#### 脚本使用方式

脚本为python代码，推荐使用linux进行可视化，windows暂未进行适配。

演示：

![符号回归拟合出的函数与评估结果](/assets/feishu/parallel-ankle-kinematics/video-01.mp4)

安装依赖

```bash
pip install pysr sympy pandas numpy matplotlib scikit-learn
```

修改参数

```python
# 修改以下参数，n为迭代次数
config = {'data_path':'data.csv','name_dict':['high_motor','low_motor','pitch','roll'],'min_max':{'high':[0,180],'low':[0,180],'pitch':[-90,90],'roll':[-90,90]},'n':100,'figsize':(18,8)}
```

运行代码

```bash
# 运行即可
python3 pysr_sim.py
```

结果包括：

采集数据的3d图像

![图片.png](/assets/feishu/parallel-ankle-kinematics/fig-02.webp)

迭代得到的函数和评估结果

![图片.png](/assets/feishu/parallel-ankle-kinematics/fig-03.webp)

评估结果的图像

![图片.png](/assets/feishu/parallel-ankle-kinematics/fig-04.webp)

得到函数的图像以及散点图（在边界可能出现奇异情况）

![图片.png](/assets/feishu/parallel-ankle-kinematics/fig-05.webp)

![图片.png](/assets/feishu/parallel-ankle-kinematics/fig-06.webp)

---

## 通过正逆运动学解算得到答案

参考以下文章

https://zhuanlan.zhihu.com/p/702587845

存在两种常见结构：电机轴沿固定坐标系的 $y$ 方向，或沿 $x$ 方向。轴向不同，摇臂端点的表达式也不同，不能直接互换电机角度的符号。

![两类并联踝结构示意](/assets/feishu/parallel-ankle-kinematics/fig-07.webp)![并联踝实物与坐标示意](/assets/feishu/parallel-ankle-kinematics/fig-08.webp)

### 先统一坐标、顺序和单位

以下推导对应**两电机轴都沿 $+y$ 的教学机构**。上方工具里的 LimX 实机模型采用它自己的电机轴、零位和连杆尺寸；这组教学参数不能直接套到 LimX 或 Unitree G1 上。

- 固定坐标系 $O$：$x$ 向前、$y$ 向左、$z$ 向上，使用右手系。
- 脚底姿态写作 $\boldsymbol\theta=[\psi,\phi]^T$：先列 roll，再列 pitch；旋转矩阵为 $R=R_y(\phi)R_x(\psi)$。
- $O_w$ 是脚底两转轴的交点，在固定系中的位置 $\mathbf p_0$ 不随姿态改变。选它作为 $O$ 的原点时，$\mathbf p_0=0$；若固定系另设在电机附近，必须保留其有符号平移量。
- $\mathbf q=[q_1,q_2]^T$ 是电机角；计算统一使用米、弧度、牛米，界面才转换为角度。

对于脚底局部安装点 $\mathbf c_i$，固定系中的点为

$$
\mathbf C_i(\boldsymbol\theta)=\mathbf p_0+R_y(\phi)R_x(\psi)\mathbf c_i
$$

$$
R_y(\phi)R_x(\psi)=
\begin{bmatrix}
\cos\phi & \sin\phi\sin\psi & \sin\phi\cos\psi \\
0 & \cos\psi & -\sin\psi \\
-\sin\phi & \cos\phi\sin\psi & \cos\phi\cos\psi
\end{bmatrix}
$$

电机中心为 $\mathbf A_i$，摇臂长度为 $a_i$。选 $q_i=0$ 时摇臂朝 $-x$，则

$$
\mathbf B_i(q_i)=\mathbf A_i+
\begin{bmatrix}-a_i\cos q_i\\0\\a_i\sin q_i\end{bmatrix}
$$

两根连杆长度 $\ell_i$ 固定，机构真正需要满足的是两个三维闭环约束：

$$
F_i(\boldsymbol\theta,\mathbf q)=\frac12\left(\|\mathbf C_i-\mathbf B_i\|^2-\ell_i^2\right)=0,
\quad i=1,2
$$

工具中“教学双杆”的尺寸公开如下。这些是便于理解的示例参数，不是任何厂商的标定数据。

| 参数 | 左支链 | 右支链 |
| --- | --- | --- |
| $\mathbf A_i$，m | $(0,0.05,0.28)$ | $(0,-0.05,0.28)$ |
| $\mathbf c_i$，m | $(0.06,0.05,-0.015)$ | $(0.06,-0.05,-0.015)$ |
| 摇臂 $a_i$，m | $0.04$ | $0.04$ |
| 连杆 $\ell_i$，m | $\sqrt{0.10^2+0.295^2}\approx0.31149$ | 同左 |

此时 $\mathbf p_0=0$，$\boldsymbol\theta=0,\mathbf q=0$ 是闭合的初始装配姿态。

### 逆运动学：姿态到两台电机

已知 $\boldsymbol\theta$ 后，$\mathbf C_i$ 已知。记

$$
\mathbf d_i=\mathbf C_i-\mathbf A_i,
\qquad
k_i=\frac{\|\mathbf d_i\|^2+a_i^2-\ell_i^2}{2a_i}
$$

将 $\mathbf B_i$ 代入长度约束，有

$$
-d_{ix}\cos q_i+d_{iz}\sin q_i=k_i
$$

这里 $\|\mathbf d_i\|^2$ 包含 $y$ 分量。脚底翻滚后，连杆通常不再处于单一 $xz$ 平面；仅对投影三角形套正弦公式会丢掉这一项。

令

$$
\rho_i=\sqrt{d_{ix}^2+d_{iz}^2},
\qquad
\beta_i=\operatorname{atan2}(d_{iz},-d_{ix})
$$

则候选角为

$$
q_i=\beta_i+s_i\arccos\left(\frac{k_i}{\rho_i}\right)+2n\pi,
\qquad s_i\in\{-1,+1\}
$$

![摇臂、连杆与脚底安装点的几何关系](/assets/feishu/parallel-ankle-kinematics/fig-09.webp)

这一步必须同时处理三个问题：

1. **可达性**：$|k_i|>\rho_i$ 时没有实数解，应返回不可达，不能把超界值强行截断成一个“看起来能运行”的角度。
2. **装配分支**：两组 $s_i$ 代表不同装配方式。教学例子从零姿态选择 $s_1=s_2=+1$，沿轨迹固定这个分支，再用上一帧角度做 $2\pi$ 解缠，避免突然跳到另一组解。
3. **奇异与限位**：$\rho_i\approx0$、$|k_i|\approx\rho_i$、电机超限或脚底超限都要显式报告。单轴合法并不意味着两个轴同时到极限仍可达。

### 雅可比：始终使用同一个方向

本文统一定义

$$
\boldsymbol J=\frac{\partial\mathbf q}{\partial\boldsymbol\theta},
\qquad
\dot{\mathbf q}=\boldsymbol J\dot{\boldsymbol\theta}
$$

因此电机速度到姿态角速度是 $\dot{\boldsymbol\theta}=\boldsymbol J^{-1}\dot{\mathbf q}$，两者不能都记为同一个 $J$。

记 $\mathbf r_i=\mathbf C_i-\mathbf B_i$。对连杆长度约束求一阶微分：

$$
\mathbf r_i^T\left(
\frac{\partial\mathbf C_i}{\partial\psi}\,d\psi+
\frac{\partial\mathbf C_i}{\partial\phi}\,d\phi-
\frac{\partial\mathbf B_i}{\partial q_i}\,dq_i
\right)=0
$$

令

$$
\boldsymbol A_{i,:}=
\begin{bmatrix}
\mathbf r_i^T\frac{\partial\mathbf C_i}{\partial\psi}&
\mathbf r_i^T\frac{\partial\mathbf C_i}{\partial\phi}
\end{bmatrix},
\qquad
D_i=\mathbf r_i^T\frac{\partial\mathbf B_i}{\partial q_i}
$$

其中

$$
\frac{\partial\mathbf B_i}{\partial q_i}=
\begin{bmatrix}a_i\sin q_i\\0\\a_i\cos q_i\end{bmatrix},
\quad
\frac{\partial\mathbf C_i}{\partial\psi}=R_y(\phi)\frac{\partial R_x(\psi)}{\partial\psi}\mathbf c_i,
\quad
\frac{\partial\mathbf C_i}{\partial\phi}=\frac{\partial R_y(\phi)}{\partial\phi}R_x(\psi)\mathbf c_i
$$

于是

$$
\boldsymbol A\,d\boldsymbol\theta=\operatorname{diag}(D_1,D_2)\,d\mathbf q,
\qquad
\boxed{\boldsymbol J=\operatorname{diag}(D_1,D_2)^{-1}\boldsymbol A}
$$

当 $D_i$ 接近零时，姿态微小变化可能需要很大的电机角变化；当 $\boldsymbol A$ 秩亏时，电机角也不足以局部唯一确定脚底姿态。实现要检查这些退化条件及矩阵条件数，不能只测试 $\det J$ 是否恰好等于零。

### 正运动学：电机到姿态

给定目标电机角 $\mathbf q^*$，正解是在当前装配分支上求两个闭环方程 $F_i(\boldsymbol\theta,\mathbf q^*)=0$，不是直接把电机角当作 roll、pitch。

如果使用逆解函数迭代，可以在第 $k$ 步求出 $\mathbf q_k=\operatorname{IK}(\boldsymbol\theta_k)$，再解线性方程

$$
\boldsymbol J_k\,\Delta\boldsymbol\theta=\mathbf q^*-\mathbf q_k,
\qquad
\boldsymbol\theta_{k+1}=\boldsymbol\theta_k+\alpha\Delta\boldsymbol\theta
$$

$\alpha\in(0,1]$ 是线搜索步长。这里是**有限误差的 Newton 修正**，无需给误差加时间导数；实际程序应解线性方程，避免显式求逆。

工具的教学解算器直接迭代长度约束，使用等价的更新

$$
\boldsymbol A_k\,\Delta\boldsymbol\theta=-\mathbf F_k
$$

每一步限制角度增量，并缩短步长直到连杆误差减小。以上一帧姿态为初值，返回时再次核对装配分支、电机角误差与连杆长度误差；超出最大迭代次数或遇到奇异，返回失败而非伪造收敛。

还需要区分**姿态角速度**和**空间角速度**。在本旋转顺序下，固定系角速度为

$$
\boldsymbol\omega=
\begin{bmatrix}
\cos\phi&0\\0&1\\-\sin\phi&0
\end{bmatrix}
\begin{bmatrix}\dot\psi\\\dot\phi\end{bmatrix}
$$

因此 `dqToGyro` 若要输出陀螺仪对应的三维角速度，应先算 $\dot{\boldsymbol\theta}=J^{-1}\dot{\mathbf q}$，再变换到所需坐标系，不能直接把两个欧拉角导数当成三维 gyro。

### 静力学：力矩映射与外力符号

令 $\boldsymbol\tau_q=[\tau_1,\tau_2]^T$ 为电机输出力矩，$\boldsymbol\tau_\theta=[\tau_\psi,\tau_\phi]^T$ 为与姿态坐标共轭的广义力矩。由虚功

$$
\delta W=\boldsymbol\tau_q^T\delta\mathbf q
=\boldsymbol\tau_\theta^T\delta\boldsymbol\theta,
\qquad
\delta\mathbf q=\boldsymbol J\,\delta\boldsymbol\theta
$$

得到

$$
\boxed{\boldsymbol\tau_\theta=\boldsymbol J^T\boldsymbol\tau_q},
\qquad
\boxed{\boldsymbol\tau_q=\boldsymbol J^{-T}\boldsymbol\tau_\theta^{\mathrm{des}}}
$$

右侧的 $\boldsymbol\tau_\theta^{\mathrm{des}}$ 是**希望执行器在脚底产生的广义力矩**。若给定的是环境施加在脚底的外力矩 $\boldsymbol\tau_\theta^{\mathrm{ext}}$ 和重力产生的广义力 $\boldsymbol\tau_\theta^{g}$，静止平衡应写成

$$
\boldsymbol J^T\boldsymbol\tau_q+
\boldsymbol\tau_\theta^{\mathrm{ext}}+
\boldsymbol\tau_\theta^{g}=0
$$

$$
\boldsymbol\tau_q=-\boldsymbol J^{-T}
\left(\boldsymbol\tau_\theta^{\mathrm{ext}}+\boldsymbol\tau_\theta^{g}\right)
$$

“外界施加的力矩”和“控制器要求抵消它的力矩”符号相反，必须先说明定义。空间三维力矩也不能直接截成两个分量：若 $\boldsymbol\omega=E\dot{\boldsymbol\theta}$，则与欧拉角共轭的力矩是 $\boldsymbol\tau_\theta=E^T\mathbf m$。

这只是刚性机构的理想静态映射。运动中的惯性、摩擦、执行器限幅和约束误差还需要动力学与反馈控制；使用雅可比并不意味着必须弃用位置伺服。工具中的 PD 控制先产生电机力矩，再由 MuJoCo 的动力学与闭环约束求出被动脚底关节的运动。

### 怎样核对可视化确实来自并联机构

可视化中的传动链应当是“电机力矩 → 摇臂 → 连杆约束 → 被动脚底”，脚底 roll、pitch 不应被界面每帧直接赋值。教学 MJCF 为每根杆配置球铰，并用 `connect` 等式约束闭合到脚底安装点；只有两个电机有执行器。

下面是本站 LimX 模型的可复现对照：每次先复位，保持两电机通电，设置 `Kp=180`、`Kd=6`、外加力矩为零，保留重力；从零位推进 2 秒（2000 个 1 ms 物理步）。表中角度均为度，输出读取 MuJoCo 状态。

| 电机目标 A / B | 实际电机 A / B | 被动 Roll / Pitch | 2 秒时闭环残差 |
| --- | --- | --- | --- |
| 8 / 0 | 7.994 / −0.005 | 3.916 / 3.730 | 0.0046 mm |
| 8 / 8 | 7.994 / 7.988 | 7.911 / 0.008 | 0.0069 mm |
| 8 / −8 | 7.994 / −7.998 | −0.004 / 7.468 | 0.0024 mm |

在这套轴向与装配零位下，同向电机输入主要形成 Roll，反向输入主要形成 Pitch；只改变 A 会同时影响两个姿态角。因此不能把 A、B 分别当成两个互不耦合的姿态轴。表中的残差是 `connect` 约束分量的最大绝对值，不是实机误差；这些数值也不能直接套到另一套教学机构上。

物理回归还做了两个对照：禁用一条 `connect` 后，相同输入会导致杆端分离、最终脚底姿态改变；关闭一台电机后，改变它的目标不能改变相同初态下的动力学轨迹。断电仅令该电机驱动力矩为零，不锁定关节，也不重设位置、速度。这些对照直接检查传动因果关系。

解析解用于设定目标与交叉核对，实际曲线读取 MuJoCo 积分后的电机角和被动脚底角。MuJoCo 使用软约束，运动中可能有小的闭合残差；真实动态姿态、解析刚性正解与控制目标也不必完全重合。要同时观察残差、目标误差和电机力矩，才能区分几何不可达、增益不合适、力矩饱和与正常动态滞后。

本站对教学解算器做三类独立核对：在可达网格上执行 IK→FK 往返；用中心差分核对解析雅可比；用随机方向的速度与力矩检查 $\boldsymbol\tau_q^T\dot{\mathbf q}=\boldsymbol\tau_\theta^T\dot{\boldsymbol\theta}$。这些检查验证实现的一致性，不等同于真实硬件参数标定。

---

参考论文：

> *A Draft on the Comprehensive Kinematics Analysis of a Humanoid Parallel Ankle Mechanism.*
> 本文的几何关系与雅可比推导与它同源；原 PDF 是第三方论文，不随本文转载。


模型与实现参考：

- [LimX HU_D04 官方完整动力学模型（固定版本）](https://github.com/limxdynamics/humanoid-description/blob/80fbd2d650c43c38916979c2a6eab7a4c79e38de/HU_D04_description/xml/HU_D04_01.xml)：本站默认模型的来源。
- [LimX 官方并联关节映射说明](https://github.com/limxdynamics/humanoid-rl-deploy-python/blob/main/doc/parallel_joint_mapping_en.md)：区分实际 A/B 电机坐标与被动 Pitch/Roll 坐标。
- [社区 G1 并联踝项目](https://github.com/feidedao/Parallel_Ankle_Joint)：有闭环运动学示例，但作者明确说明动力学参数有误。因此本文没有将它作为可预测 G1 真实电机力矩响应的模型。

- [MuJoCo：闭环连接约束（connect）](https://mujoco.readthedocs.io/en/stable/XMLreference.html#equality-connect)
- [MuJoCo：模型坐标与约束求解参数](https://mujoco.readthedocs.io/en/stable/modeling.html)
- [MuJoCo：动力学与执行器模型](https://mujoco.readthedocs.io/en/stable/computation/index.html#actuation-model)
