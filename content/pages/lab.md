---
title: 机器人实验室
slug: lab
date: 2026-10-02
summary: 调一组参数，看一次响应。用可以暂停、重置的浏览器实验，理解控制、通信与动画。
cover: assets/uploads/7286p3-7286p3-d0aaa302ed.webp
featured: false
draft: false
archived: false
order: 50
---

从下面的控制挑战开始，也可以直接打开一个小工具。每个实验都在浏览器里独立计算，先点代码面板上的 **运行**，再点实验里的 **开始**；离开画面会暂停动画，回来后继续。

## MuJoCo 并联踝实验

两个电机、一对连杆、一个被动脚底。调节电机目标角度，用真实的闭环动力学观察脚踝如何运动，再施加外力，看电机力矩与最终姿态如何改变。

[打开并联踝实验台 →](/lab/ankle/)

默认使用 **LimX 官方 HU-D04 左踝模型**，也可切换到与[并联踝运动学推导](/posts/parallel-ankle-kinematics/)对应的教学机构。引擎与模型点击后才加载；支持暂停、单步、视角旋转和数据导出。

## 把控制环调稳

让一维执行器从 **0 m** 移动到 **1 m**：先压住超调，再让它在目标附近稳定下来。切换关卡会重置参数；修改参数会暂停并重新准备这一轮，让每次比较使用相同起点。

| 关卡 | 第 2 秒发生什么 | 想一想 |
| --- | --- | --- |
| 01 · 基础响应 | 无额外变化，质量为 1 kg | 为什么阻尼过小会反复摆动？ |
| 02 · 带上负载 | 质量从 1 kg 增加到 1.8 kg | 同一组参数，还能保持同样快的响应吗？ |
| 03 · 迟到的反馈 | 反馈延迟从 0 增加到 100 ms | 对过去的位置用力，会怎样？ |
| 04 · 测量有噪声 | 位置测量叠加两种固定频率扰动，幅值之和不超过 9 mm | 误差曲线里的细小抖动一定是真实运动吗？ |

**通关条件：** 模拟运行 10 秒，整轮超调不超过 15%，最后连续至少 2 秒满足位置误差 ≤ 2 cm、速度 ≤ 3 cm/s。绿色提示表示这一次模拟符合条件，不是控制器稳定性证明。

```js run
demo.root.innerHTML = `
<style>
 .control-lab{padding:14px;border:1px solid var(--border-2,#354760);border-radius:16px;background:var(--surface,#101a28);font:13px/1.5 system-ui;color:var(--text,#e6efff)}
 .control-lab *{box-sizing:border-box}.control-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.control-top strong{font-size:16px}.control-top select{max-width:100%;font-size:12px}
 .control-lab canvas{width:100%;height:auto;margin:10px 0;border:1px solid #314458;background:#0c1624;border-radius:12px}
 .control-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.control-fields label{display:grid;grid-template-columns:1fr auto;gap:4px}.control-fields input{grid-column:1/-1;width:100%;min-width:0}.control-fields output{font-size:12px}
 .control-actions{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.control-actions button{min-height:38px;font-size:12px}.control-actions button:first-child{background:#244e51;color:#e7fffa;border-color:#5ac8b5}
 .control-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px;color:var(--text-2,#b6c6db)}.control-stats output{display:block;font-size:17px;color:var(--accent-2,#7fe4d3)}
 .control-message{min-height:38px;margin:8px 0 0;font-size:12px;color:var(--text-2,#b6c6db)}.control-hint{font-size:11px;color:var(--text-3,#92a4bc);margin:0}
 @media(max-width:380px){.control-fields{gap:6px}.control-stats output{font-size:15px}.control-top select{width:100%}}
</style>
<section class="control-lab" aria-label="一维控制挑战">
 <div class="control-top"><strong>CONTROL / 调稳这一程</strong><select id="control-level" aria-label="选择控制关卡"><option value="base">01 · 基础响应</option><option value="load">02 · 带上负载</option><option value="delay">03 · 迟到的反馈</option><option value="noise">04 · 测量有噪声</option></select></div>
 <canvas id="control-canvas" width="640" height="190" role="img" aria-label="执行器位置动画与响应曲线：青色为真实位置，虚线为一米目标，紫色为测量值"></canvas>
 <div class="control-fields">
  <label>刚度 K <output id="control-k-value"></output><input id="control-k" aria-label="刚度，牛顿每米" type="range" min="4" max="40" step="1" value="18"></label>
  <label>阻尼 D <output id="control-d-value"></output><input id="control-d" aria-label="阻尼，牛顿秒每米" type="range" min="1" max="18" step="0.5" value="2"></label>
 </div>
 <div class="control-actions"><button id="control-start" type="button">开始挑战</button><button id="control-pause" type="button" disabled>暂停</button><button id="control-reset" type="button">重置本关</button></div>
 <div class="control-stats"><span>模拟时间<output id="control-time">0.0 / 10 s</output></span><span>整轮最大超调<output id="control-peak">0.0%</output></span><span>当前位置误差<output id="control-error">100.0 cm</output></span></div>
 <p class="control-message" id="control-message" role="status" aria-live="polite">先选参数，再开始。原生滑块支持方向键，也可触屏拖动。</p>
 <p class="control-hint">青色：真实位置 · 紫色：测量位置 · 虚线：目标。这里是简化模型，不连接硬件。</p>
</section>`;
const controlNode = id => demo.root.querySelector('#control-' + id);
const controlCanvas = controlNode('canvas'), controlPaint = controlCanvas.getContext('2d');
const controlK = controlNode('k'), controlD = controlNode('d'), controlLevel = controlNode('level');
const controlStep = 0.005, controlDuration = 10;
function newChallenge() {
  return { x: 0, v: 0, time: 0, steps: 0, pending: 0, peak: 0, stable: 0, measured: 0,
    mode: 'ready', history: [{ x: 0, v: 0 }], trace: [{ t: 0, x: 0, measured: 0 }] };
}
function controlParameters() {
  return { k: Math.max(4, Math.min(40, Number(controlK.value) || 18)),
    d: Math.max(1, Math.min(18, Number(controlD.value) || 2)) };
}
// Fixed 5 ms integration steps; rendering speed never changes the experiment.
function integrateChallenge(s, p, level) {
  if (s.mode !== 'running') return;
  s.steps += 1; s.time = s.steps * controlStep;
  const changed = s.time >= 2;
  const mass = level === 'load' && changed ? 1.8 : 1;
  const delaySteps = level === 'delay' && changed ? 20 : 0;
  const past = s.history[Math.max(0, s.history.length - 1 - delaySteps)];
  const noise = level === 'noise' && changed ? 0.006 * (Math.sin(43 * s.time) + 0.5 * Math.sin(71 * s.time)) : 0;
  s.measured = past.x + noise;
  const force = Math.max(-18, Math.min(18, p.k * (1 - s.measured) - p.d * past.v));
  s.v += force / mass * controlStep; s.x += s.v * controlStep;
  s.history.push({ x: s.x, v: s.v });
  if (s.history.length > 21) s.history.shift();
  s.peak = Math.max(s.peak, s.x - 1);
  s.stable = s.time >= 2 && Math.abs(1 - s.x) <= 0.02 && Math.abs(s.v) <= 0.03 ? s.stable + controlStep : 0;
  if (s.steps % 4 === 0) s.trace.push({ t: s.time, x: s.x, measured: s.measured });
  if (!Number.isFinite(s.x) || Math.abs(s.x) > 3 || Math.abs(s.v) > 20) s.mode = 'unstable';
  else if (s.steps >= controlDuration / controlStep) s.mode = s.peak <= 0.15 && s.stable >= 2 ? 'success' : 'retry';
}
let challenge = newChallenge();
function drawChallenge() {
  const g = controlPaint, w = 640, h = 190;
  g.clearRect(0, 0, w, h); g.fillStyle = '#0c1624'; g.fillRect(0, 0, w, h);
  const px = t => 42 + t / 10 * 574, py = x => 167 - x / 1.5 * 88;
  g.font = '11px system-ui'; g.fillStyle = '#a9bcd0'; g.fillText('位置 / m', 42, 65);
  g.strokeStyle = '#243748'; g.lineWidth = 1;
  for (const y of [0, 0.5, 1, 1.5]) { g.beginPath(); g.moveTo(42, py(y)); g.lineTo(616, py(y)); g.stroke(); g.fillText(y.toFixed(1), 12, py(y) + 4); }
  g.setLineDash([4, 5]); g.strokeStyle = '#d8b570'; g.beginPath(); g.moveTo(42, py(1)); g.lineTo(616, py(1)); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#a9bcd0'; g.fillText('0', 40, 184); g.fillText('5', 326, 184); g.fillText('10 s', 593, 184);
  function curve(key, color, width) {
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    challenge.trace.forEach((sample, i) => { const y = py(Math.max(-0.12, Math.min(1.58, sample[key]))); i ? g.lineTo(px(sample.t), y) : g.moveTo(px(sample.t), y); }); g.stroke();
  }
  curve('measured', '#ba9ce7', 1); curve('x', '#6de0c4', 2);
  const cart = 44 + Math.max(-0.02, Math.min(1.5, challenge.x)) / 1.5 * 564;
  const goal = 44 + 564 / 1.5;
  g.strokeStyle = '#344e63'; g.lineWidth = 2; g.beginPath(); g.moveTo(42, 46); g.lineTo(616, 46); g.stroke();
  g.fillStyle = '#d8b570'; g.fillRect(goal - 2, 12, 4, 35); g.fillText('目标 1 m', goal + 9, 23);
  g.fillStyle = '#6de0c4'; g.fillRect(cart - 13, 27, 26, 16); g.fillStyle = '#d8fff4';
  for (const offset of [-7, 7]) { g.beginPath(); g.arc(cart + offset, 44, 3, 0, Math.PI * 2); g.fill(); }
  const p = controlParameters(); controlNode('k-value').textContent = p.k + ' N/m'; controlNode('d-value').textContent = p.d.toFixed(1) + ' N·s/m';
  controlNode('time').textContent = challenge.time.toFixed(1) + ' / 10 s';
  controlNode('peak').textContent = (challenge.peak * 100).toFixed(1) + '%';
  controlNode('error').textContent = (Math.abs(1 - challenge.x) * 100).toFixed(1) + ' cm';
  controlNode('pause').disabled = challenge.mode !== 'running';
  controlNode('start').disabled = challenge.mode === 'running';
  controlNode('start').textContent = challenge.mode === 'paused' ? '继续挑战' : '开始挑战';
}
function challengeMessage(text) { controlNode('message').textContent = text; }
function finishChallenge() {
  if (challenge.mode === 'success') challengeMessage('通关！超调与最后 2 秒的位置、速度都满足条件。可以换一关，观察同一思路是否仍然有效。');
  else if (challenge.mode === 'unstable') challengeMessage('本轮响应超出了显示范围。暂停计算；降低刚度或增大阻尼后再试。');
  else challengeMessage('再试一次：' + (challenge.peak > 0.15 ? '整轮超调超过 15%。尝试增大阻尼，或降低刚度。' : '最后连续稳定时间不足 2 秒。过大的阻尼也会拖慢响应。'));
}
const controlLoop = demo.animate(({ delta }) => {
  challenge.pending += delta;
  const p = controlParameters();
  while (challenge.pending + 1e-12 >= controlStep && challenge.mode === 'running') {
    challenge.pending -= controlStep; integrateChallenge(challenge, p, controlLevel.value);
  }
  drawChallenge();
  if (challenge.mode !== 'running') { finishChallenge(); return false; }
});
function resetChallenge(defaults) {
  controlLoop.reset();
  if (defaults) { controlK.value = '18'; controlD.value = '2'; }
  challenge = newChallenge(); drawChallenge();
  challengeMessage('已准备新一轮。参数修改后需要重新开始；试着让超调低于 15%。');
}
controlNode('start').onclick = () => {
  if (!['ready', 'paused'].includes(challenge.mode)) resetChallenge(false);
  challenge.mode = 'running'; challengeMessage('计算中：' + ({base:'质量 1 kg，无额外扰动。',load:'第 2 秒增加负载。',delay:'第 2 秒引入 100 ms 反馈延迟。',noise:'第 2 秒叠加位置测量噪声。'}[controlLevel.value]));
  drawChallenge(); controlLoop.start();
};
controlNode('pause').onclick = () => { if (challenge.mode !== 'running') return; controlLoop.pause(); challenge.mode = 'paused'; drawChallenge(); challengeMessage('已暂停，参数与曲线保留。点继续挑战从此处恢复。'); };
controlNode('reset').onclick = () => resetChallenge(true);
controlLevel.onchange = () => resetChallenge(true);
controlK.oninput = controlD.oninput = () => resetChallenge(false);
drawChallenge();
```

不知道从哪里开始时，可以试 **K = 16 N/m、D = 8 N·s/m**，再与默认的低阻尼参数比较；进入延迟关后，先观察测量曲线为何落后于真实位置。原生滑块可用方向键微调，所有按钮都可用 Tab / Enter 操作。

模型使用 $F=K(1-x_{measured})-D v_{measured}$，力限制为 ±18 N，固定 5 ms 积分步长。基础质量为 1 kg，负载关增加惯量；噪声只施加在位置测量，速度测量保持理想。实验没有摩擦、驱动内环、完整刚体动力学或网络随机性，因此只用于观察趋势。真实参数选取还需要对应硬件的测量与验证。读完可继续看 [机械臂阻抗与力位混合](/posts/arm-impedance-control/) 和 [DDS 选型与调参](/posts/dds-qos-tuning/)。

## 计算与控制

| 实验 | 做什么 | 打开 |
| --- | --- | --- |
| 01 · 控制周期预算 | 把采样、通信和求解的时间加起来，找出余量 | [查看预算](/posts/runnable-demos/#例-1纯计算看输出) |
| 02 · 阻尼响应对比 | 同一目标，比较三种阻尼的峰值与振荡 | [对比响应](/posts/runnable-demos/#例-2算完画出来) |
| 03 · 参数实验台 | 调阻尼比和自然频率，观察超调与调节时间 | [拖动参数](/posts/runnable-demos/#例-3带交互) |

## 动画工具

| 工具 | 做什么 | 打开 |
| --- | --- | --- |
| 04 · 缓动曲线 | 一边预览运动，一边生成 CSS cubic-bezier 参数 | [设计一条曲线](/posts/runnable-demos/#例-4缓动曲线工具) |
| 05 · 弹簧追踪器 | 拖动目标或施加冲量，看阻尼如何改变回弹 | [试试回弹](/posts/runnable-demos/#例-5弹簧追踪器) |

## 休息一下

| 小游戏 | 玩法 | 打开 |
| --- | --- | --- |
| 06 · 陨石航线 | 45 秒躲避挑战；键盘、拖动与触屏按钮都能操作 | [进入航线](/posts/runnable-demos/#例-6陨石航线) |
| 07 · 记忆翻牌 | 找齐八对图案，支持键盘选卡和翻开 | [开始翻牌](/posts/runnable-demos/#例-7记忆翻牌) |

所有示例都能查看源码。想给自己的文章加一个实验，可以参考 [可运行示例的写法](/posts/runnable-demos/)。
