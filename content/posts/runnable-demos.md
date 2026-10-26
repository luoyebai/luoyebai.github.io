---
title: 可运行示例：让文章里的代码真的跑起来
slug: runnable-demos
date: 2026-09-24
updated: 2026-10-02
tags: [本站, 工具]
summary: 七个可以直接操作的浏览器示例：计算与绘图、阻尼调参、缓动曲线编辑、弹簧追踪，以及陨石躲避和记忆翻牌。每个面板独立运行，动画可以暂停和重置。
cover: assets/uploads/yxj5ox-yxj5ox-3b300a8448.webp
featured: true
draft: false
archived: false
---

可运行示例把公式、参数和结果放在一起：读完代码后，可以直接改变输入，观察输出如何变化。

这个站点支持把代码块变成**可运行示例**：在 Markdown 里给围栏加一个 `run` 标记，

````text
```js run
console.log('这段代码会在访客的浏览器里真的执行');
```
````

构建后会渲染成一个面板——上面是带高亮的源码，右上角有「运行」按钮，点一下就在沙箱里执行，`console.log` 的输出、报错、以及代码画出来的东西都会显示出来。

::: tip 怎么用
- ` ```js run ` —— 执行 JavaScript，可用 `demo.root` 拿到一个容器来放自己的 DOM，`demo.log()` / `console.log()` 都会显示在输出区
- ` ```html run ` —— 直接把这段 HTML 渲染出来（适合演示纯 CSS / SVG 效果）
- 只有 `js` / `html` 两种语言认 `run`，其他语言的 ` ```python run ` 仍按普通代码块处理
- 不会自动执行，必须访客自己点
:::

下面有七个独立示例。先点代码面板上的**运行**；动画和小游戏还需要点面板内的**开始**，其他示例不会跟着启动。每个例子都只在浏览器里计算，不需要安装依赖或请求外部服务。

| 示例 | 可以做什么 | 操作方式 |
| --- | --- | --- |
| [1 · 控制周期预算](#例-1纯计算看输出) | 检查串行预算的加法 | 点运行，查看输出 |
| [2 · 阻尼响应对比](#例-2算完画出来) | 对比三条二阶响应曲线 | 点运行，比较峰值和超调 |
| [3 · 参数实验台](#例-3带交互) | 改变阻尼比和自然频率 | 拖动滑块，观察曲线 |
| [4 · 缓动曲线工具](#例-4缓动曲线工具) | 预览动画并生成 CSS 参数 | 调节控制点与时长，开始、暂停、重置 |
| [5 · 弹簧追踪器](#例-5弹簧追踪器) | 观察目标位置、阻尼与回弹 | 拖动目标，调参或施加一次冲量 |
| [6 · 陨石航线](#例-6陨石航线) | 45 秒躲避小游戏 | 方向键 / A、D，或拖动画布、按触屏按钮 |
| [7 · 记忆翻牌](#例-7记忆翻牌) | 找齐八对图案 | 点击卡片，或 Tab / 方向键选卡、Enter 翻开 |

## 例 1：纯计算，看输出

下面用虚构数值演示串行控制链路的预算相加，不代表机器人实测，也不能用各阶段 p99 相加得到整个链路的 p99。

```js run
// 1 kHz 控制回路的延迟预算拆解
const budget = [
  ['传感器采样 + 驱动', 120],
  ['总线传输', 60],
  ['状态估计', 40],
  ['MPC 求解', 310],
  ['WBC / 关节分配', 90],
  ['下发 + 关节响应', 180],
];
const total = budget.reduce((s, [, us]) => s + us, 0);

console.log('控制周期 1000 µs，各段占用：');
for (const [name, us] of budget) {
  const bar = '█'.repeat(Math.max(1, Math.round(us / 18)));
  console.log(`${name}  ${String(us).padStart(4)} µs  ${bar}`);
}
console.log('');
console.log(`合计 ${total} µs，余量 ${1000 - total} µs`);
if (total > 1000) {
  console.error('已经超出周期，必须砍掉一些');
} else if (total > 800) {
  console.warn('余量不足 20%，抖动一来就会超时');
} else {
  console.log('余量还算健康');
}
```

## 例 2：算完画出来

纯文字看不出的东西，就画出来。这是二阶系统在不同阻尼比下的阶跃响应：

```js run
const cv = document.createElement('canvas');
cv.width = 760; cv.height = 260;
demo.root.appendChild(cv);
const g = cv.getContext('2d');

// m·x'' = k(x_d − x) − b·x'  →  二阶系统，ζ 阻尼比，ωn 自然频率
function step(zeta, wn = 7, T = 2.2, dt = 0.0005) {
  let x = 0, v = 0;
  const ys = [];
  for (let t = 0; t <= T; t += dt) {
    const a = wn * wn * (1 - x) - 2 * zeta * wn * v;
    v += a * dt;
    x += v * dt;
    ys.push(x);
  }
  return ys;
}

const cases = [
  { z: 0.15, color: '#ff7ab6', name: 'ζ=0.15 欠阻尼，超调大' },
  { z: 0.70, color: '#7aa2ff', name: 'ζ=0.70 接近临界，常用' },
  { z: 1.60, color: '#5ee7c4', name: 'ζ=1.60 过阻尼，慢但不超调' },
];

const PAD = 34, W = cv.width - PAD * 2, H = cv.height - PAD * 2;
const mapX = t => PAD + (t / 2.2) * W;
const mapY = y => PAD + H - (y / 1.8) * H;

// 坐标轴与目标线
g.strokeStyle = 'rgba(255,255,255,.16)';
g.lineWidth = 1;
g.beginPath();
g.moveTo(PAD, PAD); g.lineTo(PAD, PAD + H); g.lineTo(PAD + W, PAD + H);
g.stroke();
g.setLineDash([4, 4]);
g.beginPath(); g.moveTo(PAD, mapY(1)); g.lineTo(PAD + W, mapY(1)); g.stroke();
g.setLineDash([]);
g.fillStyle = 'rgba(255,255,255,.5)';
g.font = '12px ui-monospace, monospace';
g.fillText('目标 1.0', PAD + 6, mapY(1) - 6);
g.fillText('t / s', PAD + W - 30, PAD + H + 22);
g.fillText('x', PAD - 22, PAD + 10);

let overshootReport = [];
for (const { z, color, name } of cases) {
  const ys = step(z);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  ys.forEach((y, i) => {
    const px = mapX((i / ys.length) * 2.2);
    const py = mapY(y);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  });
  g.stroke();

  const peak = Math.max(...ys);
  const over = Math.max(0, peak - 1) * 100;
  overshootReport.push(`${name}  →  峰值 ${peak.toFixed(3)}，超调 ${over.toFixed(1)}%`);
}
g.fillStyle = 'rgba(255,255,255,.75)';
g.font = '12px ui-monospace, monospace';
cases.forEach((c, i) => {
  g.fillStyle = c.color;
  g.fillRect(PAD + 10, PAD + 8 + i * 17, 10, 3);
  g.fillStyle = 'rgba(255,255,255,.7)';
  g.fillText(c.name, PAD + 26, PAD + 14 + i * 17);
});

console.log('同样的 k，只改阻尼比 b：');
overshootReport.forEach(s => console.log('  ' + s));
console.log('');
console.log('想让超调小就得加阻尼，但加过头响应会变慢——这就是 PD 里 D 项的取舍。');
```

## 例 3：带交互

沙箱里可以放任何 DOM，所以也能做出可调参数的交互 demo：

```js run
const wrap = document.createElement('div');
wrap.innerHTML = `
  <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
    <label style="display:flex;gap:8px;align-items:center">
      阻尼比 ζ
      <input id="z" type="range" min="0.1" max="2" step="0.05" value="0.4" style="width:180px">
      <b id="zv" style="font-family:ui-monospace,monospace;min-width:3.2em">0.40</b>
    </label>
    <label style="display:flex;gap:8px;align-items:center">
      自然频率 ωn
      <input id="w" type="range" min="2" max="16" step="0.5" value="7" style="width:180px">
      <b id="wv" style="font-family:ui-monospace,monospace;min-width:3em">7.0</b>
    </label>
  </div>
  <canvas id="cv" width="760" height="240" style="display:block"></canvas>
  <p id="out" style="margin:10px 0 0;font-family:ui-monospace,monospace;font-size:13px"></p>`;
demo.root.appendChild(wrap);

const cv = wrap.querySelector('#cv');
const g = cv.getContext('2d');
const zIn = wrap.querySelector('#z'), wIn = wrap.querySelector('#w');
const zOut = wrap.querySelector('#zv'), wOut = wrap.querySelector('#wv');
const out = wrap.querySelector('#out');

function draw() {
  const zeta = parseFloat(zIn.value), wn = parseFloat(wIn.value);
  zOut.textContent = zeta.toFixed(2);
  wOut.textContent = wn.toFixed(1);

  const dt = 0.0005, T = 2.2;
  let x = 0, v = 0;
  const ys = [];
  for (let t = 0; t <= T; t += dt) {
    const a = wn * wn * (1 - x) - 2 * zeta * wn * v;
    v += a * dt; x += v * dt;
    ys.push(x);
  }
  const peak = Math.max(...ys);
  let lastOutside = -1;
  ys.forEach((y, i) => { if (Math.abs(y - 1) >= 0.02) lastOutside = i; });
  const settle = lastOutside + 1;
  const settleT = settle >= ys.length ? null : (settle + 1) * dt;

  g.clearRect(0, 0, cv.width, cv.height);
  const PAD = 32, W = cv.width - PAD * 2, H = cv.height - PAD * 2;
  const mapX = t => PAD + (t / T) * W;
  const mapY = y => PAD + H - (y / Math.max(1.9, peak * 1.1)) * H;

  g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(PAD, PAD); g.lineTo(PAD, PAD + H); g.lineTo(PAD + W, PAD + H); g.stroke();
  g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(PAD, mapY(1)); g.lineTo(PAD + W, mapY(1)); g.stroke();
  g.setLineDash([]);

  const grad = g.createLinearGradient(0, PAD, 0, PAD + H);
  grad.addColorStop(0, 'rgba(122,162,255,.35)');
  grad.addColorStop(1, 'rgba(122,162,255,0)');
  g.beginPath();
  g.moveTo(mapX(0), mapY(0));
  ys.forEach((y, i) => g.lineTo(mapX((i + 1) * dt), mapY(y)));
  g.lineTo(mapX(T), mapY(0));
  g.closePath(); g.fillStyle = grad; g.fill();

  g.beginPath();
  ys.forEach((y, i) => {
    const px = mapX((i + 1) * dt), py = mapY(y);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  });
  g.strokeStyle = '#7aa2ff'; g.lineWidth = 2; g.stroke();

  out.textContent = `峰值 ${peak.toFixed(3)}   超调 ${(Math.max(0, peak - 1) * 100).toFixed(1)}%   ` +
    `2% 调节时间 ${settleT === null ? '>2.2' : settleT.toFixed(2)} s`;
}
zIn.addEventListener('input', draw);
wIn.addEventListener('input', draw);
draw();

console.log('拖动上面两个滑块试试：加阻尼压超调，但响应会变慢。');
```

## 例 4：缓动曲线工具

缓动决定动画在每个时刻走了多少路。左边是进度曲线，右边是同一条曲线驱动的小球；把两个纵向控制点移出 `0–1`，就能看到回拉和越过终点的效果。横向控制点始终限制在 `0–1`，符合 CSS `cubic-bezier()` 的要求。

先调参数，再点**开始**。暂停后再次开始会接着播放，重置会回到起点。底部给出了可以直接抄走的 CSS；计算时通过二分法反求曲线的横坐标，没有把贝塞尔参数误当成动画时间。

```js run
demo.root.innerHTML = `
  <style>
    .ease-lab{padding:12px;border:1px solid #34415e;border-radius:16px;background:#101827;color:#e8efff;font:14px/1.5 system-ui}
    .ease-lab *{box-sizing:border-box}.ease-lab h3{margin:0 0 6px;font-size:17px}
    .ease-lab canvas{display:block;width:100%;height:auto;max-height:160px;object-fit:contain;background:#0a1120;border-radius:12px}
    .ease-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin:8px 0}
    .ease-fields label{display:grid;grid-template-columns:24px minmax(0,1fr) 32px;gap:4px;align-items:center}
    .ease-fields output{grid-column:3;grid-row:1;font-size:12px}.ease-fields input{grid-column:2;grid-row:1;width:100%;min-width:0;accent-color:#75e2d0}
    .ease-fields .ease-duration{grid-column:1/-1;grid-template-columns:34px minmax(0,1fr) 44px}.ease-actions{display:flex;gap:8px;flex-wrap:wrap}
    .ease-lab button{min-height:36px;padding:6px 11px;border:1px solid #51618a;border-radius:9px;background:#21324b;color:#fff;cursor:pointer}
    .ease-lab button:focus-visible{outline:3px solid #75e2d0;outline-offset:2px}
    .ease-code{display:block;margin:8px 0 0;padding:7px;border-radius:8px;background:#080e1b;font:11px/1.4 ui-monospace,monospace;overflow-wrap:anywhere;user-select:all}
    .ease-status{margin:6px 0 0;color:#b8c6e0;font-size:12px;line-height:1.4}
  </style>
  <section class="ease-lab">
    <h3>一条曲线，决定运动的节奏</h3>
    <canvas id="ease-canvas" width="640" height="160" aria-label="缓动曲线和小球运动预览"></canvas>
    <div class="ease-fields">
      <label>X₁ <output id="ease-x1-value"></output><input id="ease-x1" aria-label="第一个横向控制点" type="range" min="0" max="1" step="0.01" value="0.25"></label>
      <label>Y₁ <output id="ease-y1-value"></output><input id="ease-y1" aria-label="第一个纵向控制点" type="range" min="-0.5" max="1.5" step="0.01" value="0.1"></label>
      <label>X₂ <output id="ease-x2-value"></output><input id="ease-x2" aria-label="第二个横向控制点" type="range" min="0" max="1" step="0.01" value="0.25"></label>
      <label>Y₂ <output id="ease-y2-value"></output><input id="ease-y2" aria-label="第二个纵向控制点" type="range" min="-0.5" max="1.5" step="0.01" value="1"></label>
      <label class="ease-duration">时长 <output id="ease-duration-value"></output><input id="ease-duration" aria-label="动画时长，秒" type="range" min="0.5" max="4" step="0.1" value="1.8"></label>
    </div>
    <div class="ease-actions"><button id="ease-start">开始</button><button id="ease-pause">暂停</button><button id="ease-reset">重置</button></div>
    <code id="ease-code" class="ease-code"></code><p id="ease-status" class="ease-status" role="status">调好参数，再点开始。</p>
  </section>`;
const $ = id => demo.root.querySelector('#ease-' + id);
const canvas = $('canvas'), g = canvas.getContext('2d');
const controls = ['x1', 'y1', 'x2', 'y2', 'duration'];
let progress = 0;
function coordinate(t, a, b) {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}
function easeAt(time, x1, y1, x2, y2) {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 22; i++) {
    const t = (lo + hi) / 2;
    if (coordinate(t, x1, x2) < time) lo = t; else hi = t;
  }
  return coordinate((lo + hi) / 2, y1, y2);
}
function params() { return controls.map(name => Number($(name).value)); }
function paintEase() {
  const [x1, y1, x2, y2, duration] = params();
  controls.forEach((name, i) => $(name + '-value').textContent = params()[i].toFixed(2) + (name === 'duration' ? ' s' : ''));
  $('code').textContent = `transition: transform ${duration.toFixed(1)}s cubic-bezier(${x1}, ${y1}, ${x2}, ${y2});`;
  g.clearRect(0, 0, 640, 160);
  const px = x => 32 + x * 160, py = y => 128 - y * 88;
  g.strokeStyle = '#263653'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(px(i / 4), 22); g.lineTo(px(i / 4), 143); g.stroke();
  }
  g.setLineDash([4, 5]); g.beginPath(); g.moveTo(px(0), py(0)); g.lineTo(px(1), py(1)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#75e2d0'; g.lineWidth = 3; g.beginPath();
  for (let i = 0; i <= 80; i++) {
    const t = i / 80, x = px(coordinate(t, x1, x2)), y = py(coordinate(t, y1, y2));
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  const eased = easeAt(progress, x1, y1, x2, y2);
  g.fillStyle = '#f7b7d1'; g.beginPath(); g.arc(px(progress), py(eased), 5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#344665'; g.lineWidth = 3; g.beginPath(); g.moveTo(300, 82); g.lineTo(550, 82); g.stroke();
  g.fillStyle = '#8fa2c5'; g.font = '12px system-ui'; g.fillText('起点', 286, 120); g.fillText('终点', 537, 120);
  g.fillText(`时间 ${(progress * 100).toFixed(0)}% · 位移 ${(eased * 100).toFixed(0)}%`, 304, 38);
  g.fillStyle = '#75e2d0'; g.shadowBlur = 18; g.shadowColor = '#75e2d0';
  g.beginPath(); g.arc(300 + eased * 250, 82, 13, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
}
const loop = demo.animate(({ time }) => {
  progress = Math.min(1, time / Number($('duration').value));
  paintEase();
  if (progress === 1) { $('status').textContent = '已到达终点。修改参数后可以再播放一次。'; return false; }
});
controls.forEach(name => $(name).addEventListener('input', paintEase));
$('start').onclick = () => {
  if (progress === 1) { loop.reset(); progress = 0; }
  loop.start(); $('status').textContent = '播放中；可以边播放边调参数。';
};
$('pause').onclick = () => { loop.pause(); $('status').textContent = '已暂停，再点开始可继续。'; };
$('reset').onclick = () => { loop.reset(); progress = 0; paintEase(); $('status').textContent = '回到起点，参数保持不变。'; };
paintEase();
```

## 例 5：弹簧追踪器

把虚线当作目标位置，带光点的小车会按弹簧阻尼模型追过去。点击或拖动画布设置目标，也可以用画布上的左右方向键，或者下方的目标按钮。**轻推一下**会给小车一个初始速度，适合观察同一组参数怎样消除扰动。

模型是单位质量下的 `x'' = ω²(target − x) − 2ζωx'`。它是交互教学模型，没有执行器饱和、采样噪声或机械限位，不能直接拿参数去驱动真实电机。这里把每帧再分成不超过 `1/120 s` 的小步积分；留下的轨迹最多 80 个点，稳定后自动停止绘制。

```js run
demo.root.innerHTML = `
  <style>
    .spring-lab{padding:16px;border:1px solid #35445e;border-radius:16px;background:#101827;color:#e8efff;font:14px/1.5 system-ui}
    .spring-lab *{box-sizing:border-box}.spring-lab h3{margin:0 0 7px;font-size:17px}
    .spring-lab canvas{display:block;width:100%;max-width:640px;height:auto;margin-inline:auto;background:#091221;border-radius:12px;touch-action:none}
    .spring-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:10px 0}
    .spring-controls label{min-width:0}.spring-controls input{display:block;width:100%;accent-color:#88b8ff}
    .spring-buttons{display:flex;gap:7px;flex-wrap:wrap}.spring-lab button{padding:8px 11px;border:1px solid #536486;border-radius:8px;background:#22324c;color:#fff;cursor:pointer}
    .spring-lab :focus-visible{outline:3px solid #88b8ff;outline-offset:2px}.spring-lab p{margin:8px 0 0;color:#bac7e1;font-size:12px}
  </style>
  <section class="spring-lab"><h3>弹簧追踪器 · 拖动虚线目标</h3>
    <canvas id="spring-canvas" width="640" height="190" tabindex="0" aria-label="点击或拖动设置目标；左右方向键微调目标"></canvas>
    <div class="spring-controls">
      <label>自然频率 <output id="spring-frequency-value"></output><input id="spring-frequency" aria-label="自然频率" type="range" min="2" max="12" step="0.5" value="6"></label>
      <label>阻尼比 <output id="spring-damping-value"></output><input id="spring-damping" aria-label="阻尼比" type="range" min="0.1" max="2" step="0.05" value="0.35"></label>
    </div>
    <div class="spring-buttons"><button id="spring-start">开始</button><button id="spring-pause">暂停</button><button id="spring-reset">重置</button><button id="spring-kick">轻推一下</button><button id="spring-left">目标向左</button><button id="spring-right">目标向右</button></div>
    <p id="spring-status" role="status">设置目标后点开始；稳定后会自动停下。</p>
  </section>`;
const $ = id => demo.root.querySelector('#spring-' + id);
const canvas = $('canvas'), g = canvas.getContext('2d');
const state = { x: 0.18, v: 0, target: 0.72, quiet: 0, trail: [] };
function integrateSpring(model, delta, frequency, damping) {
  const count = Math.max(1, Math.ceil(delta * 120)), dt = delta / count;
  for (let i = 0; i < count; i++) {
    const acceleration = frequency * frequency * (model.target - model.x) - 2 * damping * frequency * model.v;
    model.v += acceleration * dt;
    model.x += model.v * dt;
  }
}
function paintSpring() {
  $('frequency-value').textContent = Number($('frequency').value).toFixed(1) + ' rad/s';
  $('damping-value').textContent = Number($('damping').value).toFixed(2);
  const px = x => 44 + x * 500;
  g.clearRect(0, 0, 640, 190);
  g.strokeStyle = '#263851'; g.lineWidth = 1;
  for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(44 + i * 62.5, 24); g.lineTo(44 + i * 62.5, 165); g.stroke(); }
  g.strokeStyle = '#f5bdce'; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(px(state.target), 26); g.lineTo(px(state.target), 162); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#f5bdce'; g.font = '12px system-ui'; g.fillText('目标', px(state.target) - 12, 19);
  state.trail.forEach((x, i) => { g.globalAlpha = (i + 1) / state.trail.length * 0.3; g.fillStyle = '#88b8ff'; g.beginPath(); g.arc(px(x), 95, 4, 0, Math.PI * 2); g.fill(); });
  g.globalAlpha = 1; g.strokeStyle = '#7d9ecf'; g.lineWidth = 2; g.beginPath(); g.moveTo(24, 95);
  for (let i = 1; i <= 30; i++) g.lineTo(24 + (px(state.x) - 24) * i / 30, 95 + (i === 30 ? 0 : (i % 2 ? -9 : 9)));
  g.stroke(); g.fillStyle = '#88b8ff'; g.shadowBlur = 16; g.shadowColor = '#88b8ff';
  g.beginPath(); g.arc(px(state.x), 95, 13, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
  g.fillStyle = '#b8c6e1'; g.font = '12px ui-monospace,monospace';
  g.fillText(`位置 ${state.x.toFixed(3)}  速度 ${state.v.toFixed(3)}  误差 ${(state.target - state.x).toFixed(3)}`, 35, 179);
}
const loop = demo.animate(({ delta }) => {
  integrateSpring(state, delta, Number($('frequency').value), Number($('damping').value));
  state.trail.push(state.x); if (state.trail.length > 80) state.trail.shift();
  state.quiet = Math.abs(state.target - state.x) < 0.001 && Math.abs(state.v) < 0.002 ? state.quiet + delta : 0;
  paintSpring();
  if (state.quiet > 0.6) { $('status').textContent = '已稳定。改变目标或轻推后，再点开始。'; return false; }
});
function setTarget(value) {
  state.target = Math.max(0.08, Math.min(0.92, value)); state.quiet = 0; paintSpring();
  if (!loop.isRunning()) $('status').textContent = '目标已修改，点开始观察追踪过程。';
}
function pointerTarget(event) {
  const rect = canvas.getBoundingClientRect();
  setTarget(((event.clientX - rect.left) / rect.width * 640 - 44) / 500);
}
canvas.onpointerdown = event => { canvas.setPointerCapture(event.pointerId); pointerTarget(event); };
canvas.onpointermove = event => { if (canvas.hasPointerCapture(event.pointerId)) pointerTarget(event); };
canvas.onkeydown = event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setTarget(state.target + (event.key === 'ArrowLeft' ? -0.04 : 0.04)); }
};
$('left').onclick = () => setTarget(state.target - 0.15);
$('right').onclick = () => setTarget(state.target + 0.15);
$('frequency').oninput = $('damping').oninput = () => { state.quiet = 0; paintSpring(); };
$('start').onclick = () => { state.quiet = 0; loop.start(); $('status').textContent = '追踪中，可以直接拖动目标或调参数。'; };
$('pause').onclick = () => { loop.pause(); $('status').textContent = '已暂停，位置和速度都已保留。'; };
$('kick').onclick = () => { state.v = Math.min(3, state.v + 1.2); state.quiet = 0; paintSpring(); if (!loop.isRunning()) $('status').textContent = '已施加一次速度扰动，点开始观察回弹。'; };
$('reset').onclick = () => { loop.reset(); Object.assign(state, { x: 0.18, v: 0, target: 0.72, quiet: 0, trail: [] }); paintSpring(); $('status').textContent = '已回到初始状态，参数保持不变。'; };
paintSpring();
```

## 例 6：陨石航线

用三次护盾机会穿过 45 秒的陨石区。每存活一整秒获得 10 分，每颗从底部飞走且没有击中飞船的陨石再加 25 分；被击中后有 `1.2 s` 保护时间，避免同一瞬间连续扣完护盾。

**桌面**用左右方向键或 A、D，也可以拖动画布；**手机**按住左右按钮或直接拖动。P 键暂停 / 继续。重置会重新开局但不会自动开始。这里使用圆形碰撞判定，画面里的飞船轮廓只是装饰，不做像素级碰撞；随机陨石让每局略有不同，得分只保存在当前面板。

```js run
demo.root.innerHTML = `
  <style>
    .orbit-game{padding:15px;border:1px solid #374868;border-radius:16px;background:#101827;color:#eef4ff;font:14px/1.5 system-ui}
    .orbit-game *{box-sizing:border-box}.orbit-game h3{margin:0;font-size:17px}.orbit-hud{display:flex;justify-content:space-between;gap:8px;margin:7px 0;color:#bcd0ed;font:12px/1.5 ui-monospace,monospace}
    .orbit-game canvas{display:block;width:100%;max-width:640px;height:auto;margin-inline:auto;background:#070d1b;border-radius:12px;touch-action:none}
    .orbit-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.orbit-game button{min-height:40px;padding:8px 13px;border:1px solid #516589;border-radius:9px;background:#213550;color:#fff;cursor:pointer;touch-action:none;user-select:none}
    .orbit-game :focus-visible{outline:3px solid #79e4d8;outline-offset:2px}.orbit-game p{margin:8px 0 0;color:#b9c9e2;font-size:12px}
  </style>
  <section class="orbit-game" id="orbit-panel"><h3>陨石航线 · 坚持 45 秒</h3>
    <div class="orbit-hud"><span id="orbit-score"></span><span id="orbit-time"></span><span id="orbit-lives"></span></div>
    <canvas id="orbit-canvas" width="640" height="230" tabindex="0" aria-label="陨石躲避游戏，左右方向键或拖动控制飞船"></canvas>
    <div class="orbit-actions"><button id="orbit-start">开始</button><button id="orbit-pause">暂停</button><button id="orbit-reset">重置</button><button id="orbit-left" aria-label="按住向左移动">← 向左</button><button id="orbit-right" aria-label="按住向右移动">向右 →</button></div>
    <p id="orbit-status" role="status">准备好了就点开始。方向键 / A、D 移动，P 暂停。</p>
  </section>`;
const $ = id => demo.root.querySelector('#orbit-' + id);
const canvas = $('canvas'), g = canvas.getContext('2d');
const held = new Set();
let targetX = null;
function newFlight() {
  return { mode: 'idle', elapsed: 0, lives: 3, dodged: 0, x: 320, shield: 0, spawn: 0.4, rocks: [] };
}
let game = newFlight();
function collides(x, rock) { return (x - rock.x) ** 2 + (204 - rock.y) ** 2 < (10 + rock.radius) ** 2; }
function flightScore(model) { return Math.floor(model.elapsed) * 10 + model.dodged * 25; }
function stepFlight(model, delta, direction, target, random = Math.random) {
  if (model.mode !== 'running') return;
  const steps = Math.max(1, Math.ceil(Math.min(delta, 0.05) * 120)), dt = Math.min(delta, 0.05) / steps;
  for (let i = 0; i < steps && model.mode === 'running'; i++) {
    model.elapsed = Math.min(45, model.elapsed + dt);
    model.shield = Math.max(0, model.shield - dt);
    const move = direction ? direction * 300 * dt : target === null ? 0 : Math.max(-300 * dt, Math.min(300 * dt, target - model.x));
    model.x = Math.max(15, Math.min(625, model.x + move));
    model.spawn -= dt;
    if (model.spawn <= 0) {
      if (model.rocks.length < 18) model.rocks.push({ x: 18 + random() * 604, y: -20, radius: 8 + random() * 8, speed: 70 + random() * 55 + model.elapsed * 1.2 });
      model.spawn += Math.max(0.22, 0.62 - model.elapsed * 0.007);
    }
    model.rocks = model.rocks.filter(rock => {
      rock.y += rock.speed * dt;
      if (rock.y - rock.radius > 230) { model.dodged += 1; return false; }
      if (model.shield === 0 && collides(model.x, rock)) {
        model.lives -= 1; model.shield = 1.2;
        if (model.lives === 0) model.mode = 'lost';
        return false;
      }
      return true;
    });
    if (model.elapsed >= 45 && model.mode === 'running') model.mode = 'won';
  }
}
function paintFlight() {
  g.clearRect(0, 0, 640, 230);
  for (let i = 0; i < 36; i++) {
    g.fillStyle = i % 3 ? '#314667' : '#708ba9';
    g.fillRect((i * 97 + 21) % 640, (i * 47 + game.elapsed * (12 + i % 9)) % 230, 2, 2);
  }
  game.rocks.forEach(rock => {
    g.fillStyle = '#e9a38e'; g.beginPath(); g.arc(rock.x, rock.y, rock.radius, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8d605f'; g.beginPath(); g.arc(rock.x - 3, rock.y - 2, rock.radius * 0.28, 0, Math.PI * 2); g.fill();
  });
  g.globalAlpha = game.shield > 0 ? 0.45 + 0.5 * Math.abs(Math.sin(game.elapsed * 18)) : 1;
  g.fillStyle = '#79e4d8'; g.shadowColor = '#79e4d8'; g.shadowBlur = 14;
  g.beginPath(); g.moveTo(game.x, 188); g.lineTo(game.x - 13, 216); g.lineTo(game.x, 210); g.lineTo(game.x + 13, 216); g.closePath(); g.fill(); g.shadowBlur = 0; g.globalAlpha = 1;
  if (game.mode === 'idle' || game.mode === 'paused' || game.mode === 'won' || game.mode === 'lost') {
    g.fillStyle = '#091221d9'; g.fillRect(112, 77, 416, 68);
    g.fillStyle = '#eaf1ff'; g.font = '20px system-ui'; g.textAlign = 'center';
    g.fillText({ idle: '等待出发', paused: '航行已暂停', won: '安全抵达！', lost: '护盾耗尽，下次再来' }[game.mode], 320, 118); g.textAlign = 'left';
  }
  $('score').textContent = '得分 ' + flightScore(game);
  $('time').textContent = '剩余 ' + Math.ceil(Math.max(0, 45 - game.elapsed)) + ' s';
  $('lives').textContent = '护盾 ' + game.lives + ' / 3';
}
const loop = demo.animate(({ delta }) => {
  const direction = Number(held.has('right')) - Number(held.has('left'));
  stepFlight(game, delta, direction, targetX);
  paintFlight();
  if (game.mode === 'won' || game.mode === 'lost') {
    held.clear(); targetX = null; $('start').textContent = '再来一局';
    $('status').textContent = (game.mode === 'won' ? '挑战成功！' : '本局结束。') + ` 得分 ${flightScore(game)}，成功避过 ${game.dodged} 颗陨石。`;
    return false;
  }
});
function resetFlight() {
  loop.reset(); game = newFlight(); held.clear(); targetX = null; $('start').textContent = '开始';
  $('status').textContent = '已重置，点开始出发。'; paintFlight();
}
function startFlight() {
  if (game.mode === 'won' || game.mode === 'lost') resetFlight();
  game.mode = 'running'; loop.start(); $('status').textContent = '航行中。按 P 或暂停按钮可以休息。';
}
function pauseFlight() {
  if (game.mode !== 'running') return;
  game.mode = 'paused'; loop.pause(); held.clear(); targetX = null; paintFlight(); $('status').textContent = '已暂停，点开始继续。';
}
$('start').onclick = startFlight; $('pause').onclick = pauseFlight; $('reset').onclick = resetFlight;
$('panel').onkeydown = event => {
  const key = event.key.toLowerCase(), direction = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' }[key];
  if (direction) { event.preventDefault(); held.add(direction); targetX = null; }
  if (key === 'p' && !event.repeat) { event.preventDefault(); game.mode === 'running' ? pauseFlight() : startFlight(); }
};
$('panel').onkeyup = event => { const direction = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' }[event.key.toLowerCase()]; if (direction) held.delete(direction); };
window.addEventListener('blur', () => { held.clear(); targetX = null; });
['left', 'right'].forEach(direction => {
  const button = $(direction);
  button.onpointerdown = event => { button.setPointerCapture(event.pointerId); held.add(direction); targetX = null; };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => held.delete(direction);
});
function steer(event) { const rect = canvas.getBoundingClientRect(); targetX = Math.max(15, Math.min(625, (event.clientX - rect.left) / rect.width * 640)); }
canvas.onpointerdown = event => { canvas.setPointerCapture(event.pointerId); steer(event); };
canvas.onpointermove = event => { if (canvas.hasPointerCapture(event.pointerId)) steer(event); };
paintFlight();
```

## 例 7：记忆翻牌

找齐八对图案，用的步数越少越好。每翻开第二张牌记作一步；不相同的两张会展示 `0.8 s` 后盖回去，这段时间不能继续翻牌。暂停时卡片操作和计时一起停止，正在展示的一对也会保留到继续之后。

卡片都是原生按钮：触屏直接点，键盘可以用 Tab 或方向键移动焦点，再按 Enter / 空格翻牌。洗牌使用 Fisher–Yates 算法；计时和延迟翻回共用同一个动画时钟，没有残留的定时器在重置后继续改动新一局。

```js run
demo.root.innerHTML = `
  <style>
    .memory-game{padding:16px;border:1px solid #394964;border-radius:16px;background:#101827;color:#eef4ff;font:14px/1.5 system-ui}
    .memory-game *{box-sizing:border-box}.memory-game h3{margin:0;font-size:17px}.memory-hud{display:flex;gap:16px;flex-wrap:wrap;margin:6px 0 10px;color:#b9cceb;font-size:12px}
    .memory-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;max-width:420px;margin:auto}
    .memory-card{height:47px;min-width:0;border:1px solid #3c547a;border-radius:9px;background:linear-gradient(145deg,#263c61,#19253d);color:#92b2da;font:22px system-ui;cursor:pointer;transition:background .15s,transform .15s}
    .memory-card.is-open{background:#344267;color:#fff;transform:translateY(-1px)}.memory-card.is-matched{background:#173f42;border-color:#397c76;color:#a2f0d7}
    .memory-card:disabled{cursor:default;opacity:1}.memory-game :focus-visible{outline:3px solid #ecb1d5;outline-offset:2px}
    .memory-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.memory-actions button{padding:8px 14px;min-height:39px;border:1px solid #58698c;border-radius:9px;background:#263550;color:#fff;cursor:pointer}
    .memory-game p{margin:8px 0 0;color:#bccbe2;font-size:12px}@media(prefers-reduced-motion:reduce){.memory-card{transition:none}}
  </style>
  <section class="memory-game"><h3>记忆翻牌 · 找齐八对图案</h3>
    <div class="memory-hud"><span id="memory-pairs">0 / 8 对</span><span id="memory-moves">0 步</span><span id="memory-time">0 s</span></div>
    <div id="memory-grid" class="memory-grid" role="group" aria-label="十六张记忆卡片"></div>
    <div class="memory-actions"><button id="memory-start">开始</button><button id="memory-pause">暂停</button><button id="memory-reset">重新洗牌</button></div>
    <p id="memory-status" role="status">先点开始，再翻开任意两张牌。</p>
  </section>`;
const $ = id => demo.root.querySelector('#memory-' + id);
const symbols = ['🤖', '🔧', '⭐', '⚡', '🚀', '🌙', '🛰️', '🌸'];
const names = ['机器人', '扳手', '星星', '闪电', '火箭', '月亮', '卫星', '花'];
function shuffledPairs(random = Math.random) {
  const cards = [...symbols.keys(), ...symbols.keys()];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function newMemory(random = Math.random) {
  return { cards: shuffledPairs(random), opened: [], matched: new Set(), moves: 0, time: 0, revealUntil: null, mode: 'idle' };
}
let game = newMemory(), buttons = [], lastSecond = -1;
function chooseCard(model, index) {
  if (model.mode !== 'running' || model.revealUntil !== null || !Number.isInteger(index) || model.matched.has(index) || model.opened.includes(index) || index < 0 || index >= model.cards.length) return false;
  model.opened.push(index);
  if (model.opened.length === 2) {
    model.moves += 1;
    const [a, b] = model.opened;
    if (model.cards[a] === model.cards[b]) {
      model.matched.add(a); model.matched.add(b); model.opened = [];
      if (model.matched.size === model.cards.length) model.mode = 'won';
    } else model.revealUntil = model.time + 0.8;
  }
  return true;
}
function tickMemory(model, delta) {
  if (model.mode !== 'running') return false;
  model.time += delta;
  if (model.revealUntil !== null && model.time >= model.revealUntil) {
    model.opened = []; model.revealUntil = null; return true;
  }
  return false;
}
function paintMemory() {
  buttons.forEach((button, index) => {
    const matched = game.matched.has(index), open = matched || game.opened.includes(index);
    button.textContent = open ? symbols[game.cards[index]] : '◇';
    button.classList.toggle('is-open', open); button.classList.toggle('is-matched', matched);
    button.disabled = matched;
    button.setAttribute('aria-label', `第 ${index + 1} 张，` + (open ? names[game.cards[index]] + (matched ? '，已配对' : '') : '未翻开'));
    button.setAttribute('aria-pressed', String(open));
  });
  $('pairs').textContent = game.matched.size / 2 + ' / 8 对'; $('moves').textContent = game.moves + ' 步';
  $('time').textContent = Math.floor(game.time) + ' s';
}
function selectCard(index) {
  if (!chooseCard(game, index)) return;
  paintMemory();
  if (game.mode === 'won') {
    loop.pause(); $('start').textContent = '再来一局';
    $('status').textContent = `全部找到！用了 ${game.moves} 步、${game.time.toFixed(1)} 秒。`;
  } else $('status').textContent = game.revealUntil !== null ? '这两张不同，记住它们的位置。' : game.opened.length ? '再选一张试试。' : '配对成功，继续寻找。';
}
function buildCards() {
  $('grid').textContent = '';
  buttons = game.cards.map((_, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'memory-card'; button.onclick = () => selectCard(index);
    button.onkeydown = event => {
      const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
      if (!(event.key in shifts)) return;
      event.preventDefault(); let next = index;
      for (let tries = 0; tries < 16; tries++) {
        next = (next + shifts[event.key] + 16) % 16;
        if (!buttons[next].disabled) { buttons[next].focus(); break; }
      }
    };
    $('grid').appendChild(button); return button;
  });
  paintMemory();
}
const loop = demo.animate(({ delta }) => {
  const flipped = tickMemory(game, delta), second = Math.floor(game.time);
  if (flipped || second !== lastSecond) { lastSecond = second; paintMemory(); }
  if (flipped) $('status').textContent = '卡片已盖回，继续找下一对。';
});
function resetMemory() {
  loop.reset(); game = newMemory(); lastSecond = -1; buildCards();
  $('start').textContent = '开始'; $('status').textContent = '已重新洗牌，点开始进行新一局。';
}
$('start').onclick = () => {
  if (game.mode === 'won') resetMemory();
  game.mode = 'running'; loop.start(); $('status').textContent = '找出相同的图案。暂停可以保留当前进度。';
};
$('pause').onclick = () => {
  if (game.mode !== 'running') return;
  game.mode = 'paused'; loop.pause(); $('status').textContent = '已暂停，计时和翻牌都已停止。';
};
$('reset').onclick = resetMemory;
buildCards();
```

::: tip 动画为什么使用同一个时钟
`demo.animate(({ time, delta }) => { ... })` 创建的是暂停状态的控制器；`time` 和 `delta` 都以秒为单位。点开始时调用 `start()`，暂停调用 `pause()`；`reset()` 清零时钟并暂停，游戏数据和初始画面由示例自己重置。回调返回 `false` 可以结束一次动画。

面板离开视口或浏览器标签页隐藏时，运行时会暂停调度；回来后继续原来的播放状态，离开的时间不算入小游戏。每帧 `delta` 有上限，示例也限制了积分步长、轨迹和障碍数量，避免把渲染压力越积越大。
:::

::: note 想在自己的文章里用
照抄上面的写法就行。示例运行在不透明源的 sandbox iframe 中（`sandbox="allow-scripts"` 且不给 `allow-same-origin`），
所以 demo 里的代码读不到本站的 DOM、cookie 和 localStorage，也改不了顶层页面——
发布前仍需检查代码来源与运行成本；沙箱并不阻止全部网络请求。
:::

::: warn 一点限制
如果代码里写了同步死循环，浏览器没法从外面打断它，这一块会一直转。
面板会在定时器能够运行时提示超时，并提供**重置**。iframe 不保证独立进程或独立主线程，同步死循环也可能卡住父页面，使超时提示和重置按钮暂时无法响应；不要在示例中运行无界循环。
:::
