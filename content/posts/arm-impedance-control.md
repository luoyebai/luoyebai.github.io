---
title: 机械臂运控：阻抗控制与力位混合
slug: arm-impedance-control
date: 2026-01-22
tags: [机械臂, 运动控制, 力控]
summary: 从接口、量纲与坐标系出发区分阻抗、导纳和力位混合控制，给出可运行的一维示例与接触任务的验证方法。
cover: assets/bg/cyber.jpg
updated: 2026-10-02
---

接触任务里，位置误差可能转化为接触力。误差有多大、接触有多硬、驱动是否限流、控制带宽与延迟如何，都会影响结果。因此，选择力控方案前先确认机器人提供的接口和反馈，而不是只选一个控制器名字。

## 三种方式，输入和输出不同

| 方法 | 核心关系 | 常见实现条件 |
|---|---|---|
| 阻抗 | 运动偏差产生期望作用力或力矩 | 可用的力矩接口，或厂商提供的阻抗模式 |
| 导纳 | 测得的外力产生运动修正 | 力反馈与可跟踪的位置 / 速度接口 |
| 力位混合 | 在任务坐标系中分别指定力与运动目标 | 明确的接触几何与相应控制接口 |

这些分类不意味着某一种方式天然稳定。离散周期、延迟、滤波、饱和、环境刚度和内环行为，都属于闭环的一部分。

## 先把符号与单位写对

对单个平移方向，定义偏差 $e=x-x_d$，$F_{ext}$ 表示环境施加在机器人上的力。一个期望的阻抗关系是：

$$M_d\ddot e+D_d\dot e+K_de=F_{ext}$$

三项单位都是牛顿：$M_d$ 是 kg，$D_d$ 是 N·s/m，$K_d$ 是 N/m。改变外力的正方向时，方程右侧符号也必须随之改变。

对于简单的笛卡尔弹簧阻尼控制，先生成作用力，再用雅可比转置映射到关节力矩：

$$\mathbf F_{cmd}=-\mathbf K\mathbf e-\mathbf D\dot{\mathbf e},\qquad \boldsymbol\tau=\mathbf J^\top\mathbf F_{cmd}+\boldsymbol\tau_{comp}$$

不能把笛卡尔加速度直接乘 $J^\top$ 当成关节力矩。完整惯量整形还需要动力学推导；上式只是弹簧阻尼形式，不承诺任意期望惯量都能被准确实现。

补偿项由接口约定决定。驱动已补偿重力时，再加一遍重力会出错。可对照 [libfranka 的无惯量整形阻抗示例](https://frankarobotics.github.io/libfranka/0.15.0/cartesian_impedance_control_8cpp-example.html)，理解它的误差、雅可比与补偿项约定。

### 先用一个滑块感受阻尼

下面把质量固定为 **1 kg**，让简化执行器跟踪 **1 cm** 的位置阶跃：$m\ddot x=K(x_d-x)-D\dot x$，其中 $D=2\zeta\sqrt{mK}$。先点运行，再开始；改变参数会清空曲线并暂停，以相同起点重新比较。这里没有接触环境或驱动内环，不能把结果直接当成机械臂参数。

```js run
demo.root.innerHTML = `
<style>.damping-demo{font:13px/1.5 system-ui}.damping-demo canvas{width:100%;height:auto;background:#0c1624;border-radius:12px}.damping-fields{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0}.damping-fields label{flex:1;min-width:130px;display:grid;gap:3px}.damping-fields input{width:100%}.damping-actions{display:flex;gap:7px;flex-wrap:wrap}.damping-message{min-height:38px;margin:8px 0 0;font-size:12px}</style>
<section class="damping-demo" aria-label="阻尼响应实验">
 <canvas id="damping-canvas" width="640" height="180" role="img" aria-label="一厘米位置阶跃响应，青色为位置，虚线为目标"></canvas>
 <div class="damping-fields"><label>阻尼比 ζ <output id="damping-z-value"></output><input id="damping-z" aria-label="阻尼比" type="range" min="0.1" max="2" step="0.05" value="0.35"></label><label>刚度 K <output id="damping-k-value"></output><input id="damping-k" aria-label="刚度，牛顿每米" type="range" min="4" max="64" step="1" value="16"></label></div>
 <div class="damping-actions"><button id="damping-start" type="button">开始</button><button id="damping-pause" type="button" disabled>暂停</button><button id="damping-reset" type="button">重置参数</button></div>
 <p id="damping-metrics" class="demo-readout"></p><p id="damping-status" class="damping-message" role="status" aria-live="polite">用方向键或触屏调滑块，再开始观察 6 秒响应。</p>
</section>`;
const dampingNode = id => demo.root.querySelector('#damping-' + id);
const dampingCanvas = dampingNode('canvas'), dampingPaint = dampingCanvas.getContext('2d');
function newDamping() { return { x: 0, v: 0, steps: 0, time: 0, pending: 0, peak: 0, trace: [{t:0,x:0}], mode: 'ready' }; }
function dampingParameters() {
 const k = Number(dampingNode('k').value), zeta = Number(dampingNode('z').value);
 return { k, zeta, d: 2 * zeta * Math.sqrt(k) };
}
function stepDamping(s, p) {
 if (s.mode !== 'running') return;
 const dt = 0.005, target = 0.01;
 s.v += (p.k * (target - s.x) - p.d * s.v) * dt; s.x += s.v * dt;
 s.steps += 1; s.time = s.steps * dt; s.peak = Math.max(s.peak, s.x);
 if (s.steps % 4 === 0) s.trace.push({ t: s.time, x: s.x });
 if (s.steps >= 1200) s.mode = 'done';
}
let damping = newDamping();
function drawDamping() {
 const g = dampingPaint, p = dampingParameters(), mapX = t => 44 + t / 6 * 572, mapY = x => 151 - x / 0.02 * 124;
 g.clearRect(0,0,640,180); g.font='11px system-ui'; g.fillStyle='#b6c8da';
 g.fillText('位置 / mm',12,16); g.fillText('0',42,172); g.fillText('3',328,172); g.fillText('6 s',594,172);
 for (const y of [0,0.01,0.02]) {g.strokeStyle='#294052';g.beginPath();g.moveTo(44,mapY(y));g.lineTo(616,mapY(y));g.stroke();g.fillText(String(y*1000),14,mapY(y)+4);}
 g.strokeStyle='#d8b570';g.setLineDash([4,5]);g.beginPath();g.moveTo(44,mapY(0.01));g.lineTo(616,mapY(0.01));g.stroke();g.setLineDash([]);
 g.strokeStyle='#6de0c4';g.lineWidth=2;g.beginPath();damping.trace.forEach((s,i)=>{i?g.lineTo(mapX(s.t),mapY(s.x)):g.moveTo(mapX(s.t),mapY(s.x));});g.stroke();g.lineWidth=1;
 dampingNode('z-value').textContent=p.zeta.toFixed(2);dampingNode('k-value').textContent=p.k+' N/m';
 dampingNode('metrics').textContent='D = '+p.d.toFixed(2)+' N·s/m · 超调 '+(Math.max(0,damping.peak/0.01-1)*100).toFixed(1)+'% · 误差 '+(Math.abs(0.01-damping.x)*1000).toFixed(2)+' mm';
 dampingNode('pause').disabled=damping.mode!=='running'; dampingNode('start').disabled=damping.mode==='running';
 dampingNode('start').textContent=damping.mode==='paused'?'继续':'开始';
}
const dampingLoop=demo.animate(({delta})=>{
 damping.pending+=delta;const p=dampingParameters();
 while(damping.pending+1e-12>=0.005&&damping.mode==='running'){damping.pending-=0.005;stepDamping(damping,p);}
 drawDamping();if(damping.mode==='done'){dampingNode('status').textContent='6 秒记录结束。试试 ζ = 0.2、1、2，比较振荡与接近目标的速度。';return false;}
});
function resetDamping(defaults){dampingLoop.reset();if(defaults){dampingNode('z').value='0.35';dampingNode('k').value='16';}damping=newDamping();drawDamping();dampingNode('status').textContent='已准备新实验，点击开始。参数只用于简化模型。';}
dampingNode('start').onclick=()=>{if(damping.mode==='done')resetDamping(false);damping.mode='running';drawDamping();dampingNode('status').textContent='计算中；青色为真实位置，虚线为目标。';dampingLoop.start();};
dampingNode('pause').onclick=()=>{if(damping.mode!=='running')return;dampingLoop.pause();damping.mode='paused';drawDamping();dampingNode('status').textContent='已暂停，曲线与参数保留。';};
dampingNode('reset').onclick=()=>resetDamping(true);
dampingNode('z').oninput=dampingNode('k').oninput=()=>resetDamping(false);
drawDamping();
```

加入负载、反馈延迟或测量噪声后，同一组参数会有什么变化？可以到 [机器人实验室](/lab/#把控制环调稳) 继续挑战。

## 一个可运行的一维计算

下面使用 Python 3 标准库，展示偏差与阻尼如何改变指令力。它只做数值计算，不连接机器人。

```python
import math

def spring_damper(error_m, velocity_mps, stiffness, mass, zeta=1.0):
    if not all(math.isfinite(v) for v in (error_m, velocity_mps, stiffness, mass, zeta)):
        raise ValueError('参数必须有限')
    if mass <= 0 or stiffness < 0 or zeta < 0:
        raise ValueError('质量应为正，刚度和阻尼比不能为负')
    damping = 2.0 * zeta * math.sqrt(mass * stiffness)
    force = -stiffness * error_m - damping * velocity_mps
    return force, damping

force, damping = spring_damper(0.01, 0.02, 400.0, 2.0)
print(f'D = {damping:.3f} N·s/m, F = {force:.3f} N')
```

这里的临界阻尼公式针对解耦的标量二阶模型。不要把矩阵乘积的逐元素平方根直接推广到任意耦合的六维系统。平移与转动的单位不同，姿态误差也需要合适的旋转表示。

## 导纳：把力反馈变成运动参考

一种一维形式为：

$$M_d\ddot x_r+D_d\dot x_r+K_d(x_r-x_0)=F_{ext}-F_d$$

这里把 $x_r$ 作为运动参考；力的符号和运动方向仍须按传感器与任务约定核对。离散实现需要明确积分方法和实际采样周期，并限制参考速度、加速度与可达位置。

当位置内环无法及时跟随，外环积累的位移可能在稍后集中释放。调低增益不能替代对延迟、内环带宽、饱和与积分状态的检查。

## 力位混合：先选对坐标系

沿平面移动时，可以让法向跟踪力，切向跟踪运动。在接触坐标系中，用选择矩阵划分方向，再将力和运动量一致地变换到控制坐标系。

仅凭几个有摩擦的接触力样本，不一定能准确估计表面法向。几何模型、标定误差、摩擦与传感器偏置都可能影响结果。初次接触与稳定接触也应作为不同阶段处理。

## 参数调试的顺序

1. 核对坐标系、力的正负号、传感器零偏、工具质量与重心补偿。
2. 在可控条件下验证单轴运动，记录实际周期、力反馈和驱动饱和。
3. 由允许位移与任务力范围估计刚度，再按简化模型选择阻尼起点。
4. 观察接触与脱离接触的瞬态，检查滤波延迟和积分残留。
5. 再扩展到耦合方向与完整任务，保留各阶段的配置和记录。

零刚度在自由方向或拖动模式中可以有意义，不会自动导致雅可比伪逆发散；但它也意味着没有位置恢复力，必须处理漂移、速度和工作空间限制。旋转刚度是否为零同样由任务决定。

## 评价一次接触任务

同时记录峰值力、稳态误差、超调、饱和次数、完成时间和失败原因。比较不同参数时保持工具、工件、接触速度与误差分布一致，并给出试验次数。

低刚度能改善某些装配误差下的顺应性，却不保证任务更快；力矩限幅也不等于精确限制接触力。应通过对应硬件上的反馈与验证来判断。

继续阅读：[机械臂控制项目](/projects/arm-impedance-ctrl/) · [相机与手眼标定](/docs/camera-handeye-calibration/)。
