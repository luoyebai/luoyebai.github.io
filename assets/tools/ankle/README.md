# 并联踝 MuJoCo 实验

独立入口为 `/lab/ankle/`。文章可用下面的 Markdown 围栏嵌入同一个实验：

````markdown
```mujoco
ankle
```
````

也支持把场景名称放在围栏首行：`mujoco ankle`。场景名称只允许已注册的
`ankle`，围栏不会执行任意用户提供的 JavaScript 或加载任意模型地址。

## 两种模型

**LimX HU_D04_01 官方并联踝**保留官方模型的两个 A/B 电机、两根刚性连杆、
两个被动球铰、被动 pitch/roll 和两条 `connect` 闭环约束。小腿固定，其余身体
和地面接触被裁去。模型和七块原始网格来自
[LimX 官方模型仓库](https://github.com/limxdynamics/humanoid-description)，固定提交、
Apache-2.0 许可证、裁剪说明和校验值见 [limx/SOURCES.md](limx/SOURCES.md)。
它不是 Unitree G1，也不是凭外观推断出的 G1 内部机构。

**教学并联踝**由 `ankle-model.js` 生成，采用与文章解析计算一致的示意尺寸。
两路曲柄电机通过球铰连杆驱动被动两轴脚底；两条连接约束实际参与 MuJoCo 求解。
尺寸、惯性与控制增益用于教学，未声称来自实机标定。

## 真实输入与输出

`simulation.js` 的 `MotorSimulation` 接受两路电机目标角，逐个物理子步计算
`τ = kp × (目标角 − 电机角) − kd × 电机角速度`，限制转矩后调用真实 `mj_step`。
`load` 是施加在被动 pitch 自由度上的广义外力矩，单位 N·m。

正常推进从不覆盖脚底、连杆或电机的 `qpos`。脚底姿态来自电机转矩、连杆、
闭环约束、惯性及重力的共同响应；`mj_forward` 只在积分后刷新用于渲染的变换。
`reset()` 使用 `mj_resetData`，清空目标和外力。它不修改用户选好的 PD 增益；
UI 的“恢复默认参数”应先恢复对应默认增益，再调用 `reset()`。

`read()` 返回：

- `time`：MuJoCo 仿真时间，秒。
- `motors` / `velocities`：电机角和角速度，rad / rad·s⁻¹。
- `foot`：按配置顺序 `[roll, pitch]` 的被动关节角，rad。
- `torques`：实际电机执行器力矩，N·m。
- `closure`：最大 connect 约束分量残差，米。
- `finite`：物理状态是否全部为有限数。

闭环约束有数值柔顺性，外力下的小残差不等同于假动画或闭环失效。脚底广义
关节没有执行器。测试会禁用一条连接约束，确认对应杆端分离、脚底响应改变，
验证传动因果关系。

## PD 参数范围

`PD_LIMITS` 导出以下经过实际 WASM 步进验证的 UI 范围。构造控制器时传入
对应的 `gainLimits`，超范围或非有限输入会拒绝推进，并清空转矩与外力；
修正参数后调用 `reset()` 恢复。

| 模型 | 物理步长 | 默认 kp / kd | UI kp 范围 | UI kd 范围 | 演示电机目标范围 |
| --- | --- | --- | --- | --- | --- |
| LimX | 1 ms | 180 / 6 | 40–300 | 1–12 | ±0.3 rad |
| 教学 | 2 ms | 80 / 1 | 20–160 | 0.1–1.2 | ±0.6 rad |

这些是此模型、此离散控制器的演示范围，不是制造商硬件参数。教学模型的轻型
曲柄在 2 ms 步长下使用过大的显式 D 增益会出现数值极限环：审计中 `kd≥1.5`
出现持续约 5–6 rad/s 的振荡，所以不能共用 LimX 的增益滑条范围。

实际回归覆盖两个增益范围的四角、目标反向切换和 ±2 N·m 外力。在所测工况中，
末段速度低于 0.001 rad/s，稳态 connect 残差低于 0.2 mm；最剧烈的教学目标
反向切换可有约 1.20 mm 的瞬态残差。该检查不构成所有状态下的稳定性证明。

```js
import { MotorSimulation, PD_LIMITS } from './simulation.js';

const simulation = new MotorSimulation(engine, {
  motorJoints: ['left_A_achilles_joint', 'left_B_achilles_joint'],
  actuatorNames: ['ankle_A_left', 'ankle_B_left'],
  footJoints: ['left_ankle_roll_joint', 'left_ankle_pitch_joint'],
  kp: 180, kd: 6, torqueLimit: 42, targetLimit: 0.3,
  gainLimits: PD_LIMITS.limx,
});
simulation.setTargets([0.15, -0.15]);
simulation.advance(10); // 每个子步重新计算 PD；最多允许 100 个子步
const state = simulation.read();
```

## 延迟加载与资源

文章初次渲染只显示入口卡片，点击加载后才创建实验 iframe。独立工具按需导入
Three.js 和 MuJoCo；浏览普通文章不会加载它们。MuJoCo 使用固定版本 3.14.0
的官方单线程 WASM，约 10.3 MB；LimX 网格另约 2.94 MB。无需 SharedArrayBuffer
或跨源隔离响应头，资源可随静态博客部署。

嵌入层通过 `mujoco-activity` 消息传递页面和面板可见性，工具按可见状态暂停
帧推进。关闭实验会移除 iframe；切换模型应销毁旧 `model` / `data` 和 Three.js
几何材质。每帧限制补步时间，避免后台标签页恢复时追赶累积时间。

`mujoco-engine.js` 只负责引擎、VFS 资产、步进和状态接口。渲染器读取编译后的
`mesh_vert` / `mesh_face`，配合对应 `geom_xpos` / `geom_xmat`；不能混用原始 STL
顶点和编译后已重心化的 geom 坐标。

发布的 MuJoCo 目录仅保留 `mujoco.js`、`mujoco.wasm`、`LICENSE`、
`PROVENANCE.md` 和用于 Node 模块识别的 `package.json`。上游类型定义及开发
README 保留在项目 `_staging/vendor-mujoco-reference/`，不随博客分发。

## 开发验证

在项目根目录运行：

```text
node --test tools/test-mujoco-engine.mjs
node --test tools/test-ankle-physics.mjs
node tools/test-ankle-math.mjs
```

引擎测试运行官方 WASM；物理测试覆盖两种实际模型、闭环残差、电机响应、
外力、断开闭环的对照、模型隔离、PD 边界及无效值停机。数学测试验证解析
几何、正逆运动学与雅可比。最终还需要在浏览器验收操作、渲染和移动布局。
