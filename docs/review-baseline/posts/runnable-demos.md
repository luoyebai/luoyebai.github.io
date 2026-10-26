---
title: 可运行示例：让文章里的代码真的跑起来
slug: runnable-demos
date: 2026-09-24
tags: [本站, 工具]
summary: 在 Markdown 里用 ```js run 标记一段代码，构建后它会变成带「运行」按钮的交互面板——访客可以自己点开跑，看到真实输出。
cover: assets/uploads/下载.gif
featured: true
draft: false
archived: false
---

技术文章里最没用的东西，就是一段**你看不到它跑起来**的代码。

这个站点支持把代码块变成**可运行示例**：在 Markdown 里给围栏加一个 `run` 标记，

````text
```js run
console.log('这段代码会在访客的浏览器里真的执行');
```
````

构建后会渲染成一个面板——上面是带高亮的源码，右上角有「运行」按钮，点一下就在沙箱里执行，`console.log` 的输出、报错、以及代码画出来的东西都会显示出来。

::: tip 怎么用
- ` ```js run ` —— 执行 JavaScript，可用 `demo.root` 拿到一个容器来放自己的 DOM，`demo.log()` / `console.log()` 都会显示在输出区
- ` ```html run ` —— 直接把这坨 HTML 渲染出来（适合演示纯 CSS / SVG 效果）
- 只有 `js` / `html` 两种语言认 `run`，其他语言的 ` ```python run ` 仍按普通代码块处理
- 不会自动执行，必须访客自己点
:::

下面放三个真实例子。

## 例 1：纯计算，看输出

这种最适合放"算一下就知道"的东西——比如控制回路的延迟预算。

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
  const over = ((peak - 1) * 100);
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
  const settle = ys.findIndex((y, i) => ys.slice(i).every(v2 => Math.abs(v2 - 1) < 0.02));
  const settleT = settle < 0 ? null : (settle / ys.length) * T;

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
  ys.forEach((y, i) => g.lineTo(mapX((i / ys.length) * T), mapY(y)));
  g.lineTo(mapX(T), mapY(0));
  g.closePath(); g.fillStyle = grad; g.fill();

  g.beginPath();
  ys.forEach((y, i) => {
    const px = mapX((i / ys.length) * T), py = mapY(y);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  });
  g.strokeStyle = '#7aa2ff'; g.lineWidth = 2; g.stroke();

  out.textContent = `峰值 ${peak.toFixed(3)}   超调 ${((peak - 1) * 100).toFixed(1)}%   ` +
    `2% 调节时间 ${settleT === null ? '>2.2' : settleT.toFixed(2)} s`;
}
zIn.addEventListener('input', draw);
wIn.addEventListener('input', draw);
draw();

console.log('拖动上面两个滑块试试：加阻尼压超调，但响应会变慢。');
```

::: note 想在自己的文章里用
照抄上面的写法就行。沙箱是**跨源隔离**的（`sandbox="allow-scripts"` 且不给 `allow-same-origin`），
所以 demo 里的代码读不到本站的 DOM、cookie 和 localStorage，也改不了顶层页面——
可以放心贴。
:::

::: warn 一点限制
如果代码里写了同步死循环，浏览器没法从外面打断它，这一块会一直转。
所以面板有个看门狗：超过 8 秒没跑完会提示「可能陷入死循环」，点**重置**重建沙箱即可恢复
（父页面本身不会被卡住，因为 iframe 是独立进程）。
:::
