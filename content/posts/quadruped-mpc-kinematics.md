---
title: 四足运控：MPC 代价函数推导与腿部正逆运动学
slug: quadruped-mpc-kinematics
date: 2026-03-08
updated: 2026-09-30
tags: [四足, 运动控制, MPC, 运动学]
summary: 把 MPC 从状态转移方程推到有限时域 QP 的代价函数，并解释为什么直接对输入加权会留下稳态误差、改用输入增量就能修掉；再从单腿三个关节的变换矩阵推出足端正运动学、从足端位置反解关节角。文末是三块工程细节：电机的力位速混合控制、状态观测器与拓展卡尔曼滤波，以及 MuJoCo + OCS2 的仿真链路和三种地形上的实测结果与边界。
cover: assets/uploads/5gk7m5-5gk7m5-e4275914b4.webp
featured: true
draft: false
archived: false
---

::: note 迁移说明
原文档引用的《宇树机器狗课程》PDF 是付费课程资料，不随本文转载；「WBC 控制简介」与「MPC-WBC 控制原理」两节在原文档里是空壳，这里补上了正文。文末的电机混合控制、观测器、仿真链路与地形测试几节，整理自学位论文《基于 MPC 算法的机器狗运动控制及在仿真平台中的应用研究》（2025），只保留了工程上能复用的推导、参数和结论。
:::

## 概述

宇树Go2Pro机器狗逆向报告输出

### 任务清单

- [x] MPC 控制简介

- [x] 机器狗运动学建模

- [x] WBC 控制简介

- [x] 机器狗MPC-WBC控制原理

- [x] 电机力位速混合控制

- [x] 观测器与拓展卡尔曼滤波

- [x] MuJoCo + OCS2 仿真链路与地形测试

---

## MPC 控制简介

## 原理概述

MPC通过滚动优化（即预测接下来$N$个离散时间点被控制后的状态）实现控制，实际控制器只输出影响下一个时间点状态的输出结果$u(k)$,其代价方程通常为二次型形式，实际上MPC控制是一个优化求解问题。

### MPC 相关公式、代码

#### 代码实现及参考视频

- sympy实现数学公式计算以及代码（登陆谷歌账号后可在线运行）：

    https://colab.research.google.com/github/luoyebai/mpc_study/blob/main/notebook/sympy_mpc.ipynb

- 参考视频

https://www.bilibili.com/video/BV1Y44y1b7ke/

#### 公式含义

- 状态转移方程：

$$
x(k+1)=\underbrace{A}_{n \times n}\underbrace{x(k)}_{n \times 1}+\underbrace{B}_{n \times p}\underbrace{u(k)}_{p \times 1}
$$

    - 其中$x(k+1)$为下一个时间（离散）点的状态、$x(k)$为当前状态（$n$维向量）。

    - $u(k)$为控制器输出的结果，如力矩、力、位置、角度或是电流大小等（$p$维向量）。

    - 假设环境不存在扰动（即未知外因、外力干扰的情况），$A,B$则是确定的状态转移矩阵（与物理世界对应），控制器输出及当前状态来决定下一个时间的状态。

- 预测空间方程（预测接下来$N$个离散时间点的状态）：

    - $X(k)=Mx(k) + CU(k)$

    - 其中

$$
X(k) =
\underbrace{
\begin{bmatrix}
x(k|k) \\
x(k+1|k) \\
\vdots \\
x(k+i|k) \\
\vdots \\
x(k+N|k) \\
\end{bmatrix}
}_{n(N+1) \times 1}
\\
U(k)=
\underbrace{
\begin{bmatrix}
u(k|k) \\
u(k+1|k) \\
\vdots \\
u(k+i|k) \\
\vdots \\
u(k+N-1|k) \\
\end{bmatrix}
}_{Np \times 1}
\\
M =
\underbrace{
\begin{bmatrix}
I_{n \times n} \\
A_{n \times n} \\
A_2 \\
\vdots \\
A_N \\
\end{bmatrix}
}_{n(N+1) \times n}
\\
C =
\underbrace{
\begin{bmatrix}
0 & 0 & \cdots & 0 \\
\vdots & \vdots & \cdots & \vdots \\
0 & 0 & & 0 \\
B & 0 & \cdots & 0 \\
AB & B & \cdots & 0 \\
\vdots & \vdots & \ddots & 0 \\
A^{N-1}B & A^{N-2}B & \cdots & B \\
\end{bmatrix}
}_{n(N+1) \times Np}
$$

- 代价函数可定义为:

$$
J = (MX_k+CU_k-x^*)^T\overline{Q}(MX_k+CU_k-x^*) + U_k^T\overline{R}U_k
$$

    - 上述公式中

        - $Q,F$为$n$维对角矩阵，$R$为$p$维对角矩阵，它们中每一项都表示权重。

        - $Q$表示这个过程中控制器距离目标状态误差的代价权重，$F$则是$N$次输入之后距离目标状态的误差代价权重，$R$表示过程中输入代价的权重。

        - $R$过大可能导致无法达到目标结果。

        - 对接下来$N$个时间形成权重矩阵（理论上我们可以为接下来的时间设置不同的权重矩阵，然而这些权重都只反映了达到目标过程中的代价，这与时间无关，所以权重是时不变的）

$$
\overline{Q} =
\begin{bmatrix}
Q & \cdots & 0  \\
\vdots & Q & \vdots \\
0  & \cdots & F \\
\end{bmatrix}
\quad \\
\overline{R} =
\begin{bmatrix}
R & \cdots & 0 \\
\vdots & \ddots & \vdots \\
0 & \cdots & R \\
\end{bmatrix}
$$

    - 公式中$x(k)$为当前状态，$x^*$为目标状态，使$J$最小的结果$U(k)$则为MPC控制器的输出结果。

> MPC 缺点：在不使用增量控制的情况下，稳态误差较大，在R过大的情况下会导致状态发散

#### 修正稳态误差

为了修正稳态误差，将输入增量权重矩阵作为代价函数的参考，而非直接使用输入权重矩阵。

- 代价函数修改为：

$$
J = (MX_k+CU_k-x^*)^T\overline{Q}(MX_k+CU_k-x^*) + {\Delta U_k}^T \overline{R} {\Delta U_k}
$$

- 其中

    ${\Delta U_k} = U_k - U_{k-1}$

#### 一个具体的例子

- 状态转移方程如下：

$$
\begin{bmatrix}
x_1(k+1) \\
x_2(k+1) \\
\end{bmatrix}
=
\begin{bmatrix}
1  & 0.1 \\
-1  & -2 \\
\end{bmatrix}
\begin{bmatrix}
x_1(k) \\
x_2(k) \\
\end{bmatrix}
\begin{bmatrix}
0.2 & 1 \\
0.5 & 2 \\
\end{bmatrix}u(k)
$$

- 如果权重矩阵如下：

$$
Q
=
F
=
\begin{bmatrix}
100  & 0 \\
0  & 100 \\
\end{bmatrix}
\\
R
=
\begin{bmatrix}
0.1 & 0 \\
0 & 0.1 \\
\end{bmatrix}
$$

- 参考值（目标值）为：

$$
x^*
=
\begin{bmatrix}
400 \\
-400 \\
\end{bmatrix}
$$

- 不使用增量控制：

![input-noinc.png](/assets/feishu/quadruped-mpc-kinematics/fig-01.webp)![mpc-noinc.png](/assets/feishu/quadruped-mpc-kinematics/fig-02.webp)

- 使用增量控制：

![input-inc.png](/assets/feishu/quadruped-mpc-kinematics/fig-03.webp)![mpc-inc.png](/assets/feishu/quadruped-mpc-kinematics/fig-04.webp)

---

## 机器狗运动学建模

![图片.png](/assets/feishu/quadruped-mpc-kinematics/fig-05.webp)

### 参考来源与约定

下面的推导沿用 [robotsfan 的四足运动学笔记](https://www.robotsfan.com/posts/311d50f4.html)
的坐标系约定：从机身往外依次编号 $\{0\}$ 到 $\{3\}$，$\{0\}$ 固定在机身上，
$\{3\}$ 随小腿转动，足端 $P$ 在 $\{3\}$ 下的坐标恒为 $[0,0,l_3]^\top$。
角度按**右手定则**为正、逆时针为正，所以小腿的限位是负的（$\theta_3 < 0$）——
这一点在写代码时最容易搞反，反了之后正运动学看着还挺正常，逆运动学就会解到机械限位外面去。

左右腿的连杆符号是**镜像**的，$l_1$ 在右腿取负、左腿取正（见下文式 (1)）。
实现里不要用两套公式，而是把符号放进参数，否则改一条腿的连杆长度就得改两份代码。

### 正运动学

![图片.png](/assets/feishu/quadruped-mpc-kinematics/fig-06.webp)

![图片.png](/assets/feishu/quadruped-mpc-kinematics/fig-07.webp)

- 对于单条腿，从上往下，已知三个关节的角度 $\theta_1,\theta_2,\theta_3$（对应$roll,pitch,pitch$）

    - 希望求出足端在坐标系$\{0\}$中的坐标 $x_p,y_p,z_p$

- 对应的变换矩阵为：

$$
\begin{aligned}

\boldsymbol{T}_{01}&=
\begin{bmatrix}
\mathrm{rot}_x(\theta_1) & \boldsymbol{0}_{3\times1} \\
\boldsymbol{0}_{3\times3} & 1
\end{bmatrix}=
\begin{bmatrix}
1 & 0 & 0 & 0 \\
0 & \cos(\theta_1) & -\sin(\theta_1) & 0 \\
0 & \sin(\theta_1) & \cos(\theta_1) & 0 \\
0 & 0 & 0 & 1
\end{bmatrix}\\

\boldsymbol{T}_{12}&=
\begin{bmatrix}
\mathrm{rot}_y(\theta_2) & \boldsymbol{0}_{3\times1} \\
\boldsymbol{0}_{3\times3} & 1
\end{bmatrix}=
\begin{bmatrix}
\cos(\theta_2) & 0 & \sin(\theta_2) & 0 \\
0 & 1 & 0 & 0 \\
-\sin(\theta_2) & 0 & \cos(\theta_2) & 0 \\
0 & 0 & 0 & 1
\end{bmatrix}\\

\boldsymbol{T}_{23}&=
\begin{bmatrix}
\mathrm{rot}_y(\theta_3) & \left[\begin{matrix}0\\l_1\\l_2\end{matrix}\right] \\
\boldsymbol{0}_{3\times3} & 1
\end{bmatrix}=
\begin{bmatrix}
\cos(\theta_3) & 0 & \sin(\theta_3) & 0 \\
0 & 1 & 0 & l_1 \\
-\sin(\theta_3) & 0 & \cos(\theta_3) & l_2 \\
0 & 0 & 0 & 1
\end{bmatrix} \\

\boldsymbol{p}_3 &= \begin{bmatrix}0\\0\\l_3\end{bmatrix}

\end{aligned}
$$

- $p_3$表示为在图片2-2的坐标系$\{3\}$中的坐标

- 其中（左右腿的连接方式是反过来的）

$$
\begin{bmatrix}
l_1 \\
l_2 \\
l_3
\end{bmatrix}
=
\begin{bmatrix}
\left\{ \begin{aligned}-l_{abad}&,\text{right}\\l_{abad}&,\text{left}\end{aligned}\right. \\
-l_{hip} \\
-l_{knee}
\end{bmatrix} \tag{1}
$$

- 结果为：

$$
\begin{bmatrix}
p_0 \\
1
\end{bmatrix}
=
\begin{bmatrix}
x_p\\y_p\\z_p\\1
\end{bmatrix}
=
T_{01}T_{12}T_{23}
\begin{bmatrix}
p_3 \\
1
\end{bmatrix}
=
\begin{bmatrix}
l_3\sin(\theta_1+\theta_2)+l_2\sin(\theta_2)\\
-l_3\sin(\theta_1)\cos(\theta_2+\theta_3)+l_1\cos(\theta_1)-l_2\cos(\theta_2)\sin(\theta_1)\\
l_3\cos(\theta_1)\cos(\theta_2+\theta_3)+l_1\sin(\theta_1)+l_2\cos(\theta_1)\cos(\theta_2)\\
1
\end{bmatrix}
\tag{2}
$$

### 逆运动学

- 同样地，对于单条腿，已知足端空间位置$x,y,z$

    - 希望求出相应关节角度 $\theta_1,\theta_2,\theta_3$（$roll,pitch,pitch$）

![图片.png](/assets/feishu/quadruped-mpc-kinematics/fig-08.webp)![图片.png](/assets/feishu/quadruped-mpc-kinematics/fig-09.webp)

- 足端在该平面坐标系下的投影为

$$
\begin{bmatrix}
y_p \\
z_p \\
\end{bmatrix}
=
\begin{bmatrix}
cos\theta_1 & -sin\theta_1 \\
sin\theta_1 & cos\theta_1 \\
\end{bmatrix}
\begin{bmatrix}
l_1 \\
-L
\end{bmatrix}
$$

- 简单计算可得

$\theta_1 = arctan(\frac{z_pl_1+y_pL}{y_pl_1-z_pL})$

- 其中$L$是机器人大腿和小腿连杆在$yz$平面上的投影长度

$L = \sqrt{y_p^2+z_p^2+l_1}$

- 那么

$$
\theta_1 = arctan(\frac{z_pl_1+y_p\sqrt{y_p^2+z_p^2+l_1}}{y_pl_1-z_p\sqrt{y_p^2+z_p^2+l_1}})
$$

![图片.png](/assets/feishu/quadruped-mpc-kinematics/fig-10.webp)![图片.png](/assets/feishu/quadruped-mpc-kinematics/fig-11.webp)

- 顺时针转动为负值，根据限位，那么$\theta_3 <0$

- 显然

$$
cos(\pi + \theta_3) =
\frac
{|{O_3A}|^2 + |{O_3P}|^2 - |AP|}
{2|{O_3A}||{O_3P}|}
$$

- 又有 图2-6所示，AOP显然为直角，根据勾股定理

$|AP| = \sqrt{x_p^2+y_p^2+z_p^2-l_1^2}$

- 其中|O3A|、|O3P | 为大腿、小腿的长度

$$
|O_3A| = -l_2 \\
|O_3P| = -l_3 \\
$$

- 计算得到

$$
\theta_3 =
\pi - arccos(\frac
{l_2^2 + l_3^2 - \sqrt{x_p^2+y_p^2+z_p^2-l_1^2}}
{2l_2l_3})
$$

---

## 一个可以自己拖的 MPC 例子

前面那个例子的数据躺在论文里，光看曲线不如自己拖一遍。下面这个面板把整套推导实现了一遍：
按「直接对输入加权」和「按输入增量加权」两种代价函数各解一次有限时域问题，
再把第一个控制量喂回去闭环滚 60 步，画出状态与控制量的曲线。改 $N$、$Q$、$F$、$R$ 和目标
$x^*$ 都会立刻重算 —— 尤其是把 $R$ 拉大看稳态误差怎么回来，再勾上增量加权看它怎么被修掉。

代价函数是无约束的二次型，所以不用 QP 求解器，直接写出解析解再解一个线性方程组就行：
$\Delta U = (C^\top \bar Q C + \bar R)^{-1} C^\top \bar Q\, r$。
代码长了一点，点上面的「收起」可以折起来。

```js run
// ===== 第一部分：模型与求解器 =====
// 状态转移 x(k+1) = A x(k) + B u(k)，用的是前面「一个具体的例子」里那组矩阵
var A = [[1, 0.1], [-1, -2]];
var B = [[0.2, 1], [0.5, 2]];
var TARGET = [400, -400];
var STEPS = 60;                 // 闭环仿真步数
var N = 8, Q = 100, F = 100, R = 0.1, incremental = false;

// —— 矩阵小工具（顺带手写高斯消元：N 最大 25，方程组也就 52×52）——
function zeros(r, c) { var m = []; for (var i = 0; i < r; i++) { var w = []; for (var j = 0; j < c; j++) w.push(0); m.push(w); } return m; }
function mul(X, Y) {
  var n = X.length, k = Y.length, p = Y[0].length, o = zeros(n, p);
  for (var i = 0; i < n; i++) for (var t = 0; t < k; t++) {
    var v = X[i][t]; if (!v) continue;
    for (var j = 0; j < p; j++) o[i][j] += v * Y[t][j];
  }
  return o;
}
function T(X) { var o = zeros(X[0].length, X.length); for (var i = 0; i < X.length; i++) for (var j = 0; j < X[0].length; j++) o[j][i] = X[i][j]; return o; }
function add(X, Y) { return X.map(function (r, i) { return r.map(function (v, j) { return v + Y[i][j]; }); }); }
function sub(X, Y) { return X.map(function (r, i) { return r.map(function (v, j) { return v - Y[i][j]; }); }); }
function solve(M, b) {                       // 带部分主元的高斯消元
  var n = M.length, a = M.map(function (r, i) { return r.concat([b[i]]); });
  for (var c = 0; c < n; c++) {
    var p = c;
    for (var r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    var t = a[c]; a[c] = a[p]; a[p] = t;
    if (Math.abs(a[c][c]) < 1e-12) continue;
    for (r = c + 1; r < n; r++) {
      var f = a[r][c] / a[c][c];
      if (!f) continue;
      for (var j = c; j <= n; j++) a[r][j] -= f * a[c][j];
    }
  }
  var x = [];
  for (var i = n - 1; i >= 0; i--) {
    var s = a[i][n];
    for (var j = i + 1; j < n; j++) s -= a[i][j] * x[j];
    x[i] = Math.abs(a[i][i]) < 1e-12 ? 0 : s / a[i][i];
  }
  return x;
}

// —— 预测矩阵：X = M x(k) + C U(k)，X 有 n(N+1) 行、U 有 Np 行 ——
// x(i|k) = A^i x(k) + Σ_{j<i} A^(i-1-j) B u(j)
// C 的第 i 行、第 j 块是 **A^(i-1-j)B**，不是 A^(i-j)B。幂次整体错一位，
// 解出来的控制量会指数发散 —— 曲线看着像「算出来了」，数值却已经是 1e+72。
// 先把 A 的各次幂算好再填，比在循环里边乘边填不容易错。
function buildMC(N) {
  var n = 2, p = 2, rows = n * (N + 1);
  var M = zeros(rows, n), C = zeros(rows, N * p);
  var P = [];                                     // P[k] = A^k
  P[0] = [[1, 0], [0, 1]];
  for (var k = 1; k <= N; k++) P[k] = mul(A, P[k - 1]);

  for (var i = 0; i <= N; i++) {
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) M[i * n + r][c] = P[i][r][c];
    for (var j = 0; j < i; j++) {                 // u(j) 对 x(i) 的贡献
      var blk = mul(P[i - 1 - j], B);
      for (r = 0; r < n; r++) for (c = 0; c < p; c++) C[i * n + r][j * p + c] = blk[r][c];
    }
  }
  return { M: M, C: C, rows: rows };
}

// —— 权重：过程中用 Q，末端用 F，输入用 R ——
function weights(N) {
  var rows = 2 * (N + 1), cols = 2 * N;
  var Qb = zeros(rows, rows), Rb = zeros(cols, cols);
  for (var i = 0; i <= N; i++) {
    var w = (i === N) ? F : Q;
    Qb[i * 2][i * 2] = w; Qb[i * 2 + 1][i * 2 + 1] = w;
  }
  for (i = 0; i < cols; i++) Rb[i][i] = R;
  return { Qb: Qb, Rb: Rb };
}

// —— 解一次，返回整段控制量序列 ——
function solveMPC(x, uPrev) {
  var mc = buildMC(N), W = weights(N);
  var star = zeros(mc.rows, 1);
  for (var i = 0; i <= N; i++) { star[i * 2][0] = TARGET[0]; star[i * 2 + 1][0] = TARGET[1]; }
  var dr = sub(star, mul(mc.M, [[x[0]], [x[1]]]));
  var Ceff = mc.C, rEff = dr;

  if (incremental) {
    // 增量控制：U = U_prev + L·ΔU，L 是逐段累加的下三角（每块 2×2 单位阵）
    var cols = 2 * N, L = zeros(cols, cols);
    for (i = 0; i < N; i++) for (var j = 0; j <= i; j++) { L[i * 2][j * 2] = 1; L[i * 2 + 1][j * 2 + 1] = 1; }
    Ceff = mul(mc.C, L);
    if (uPrev) rEff = sub(dr, mul(mc.C, uPrev.map(function (v) { return [v]; })));
  }
  var Ct = T(Ceff);
  var H = add(mul(mul(Ct, W.Qb), Ceff), W.Rb);            // CᵀQ̄C + R̄
  var g = mul(mul(Ct, W.Qb), rEff).map(function (r) { return r[0]; });
  var U = solve(H, g);
  if (incremental && uPrev) for (i = 0; i < U.length; i++) U[i] += uPrev[i];
  return U;
}

// —— 闭环：每步只施加第一个控制量，剩下的丢掉重算 ——
function simulate() {
  var x = [0, 0], uPrev = null;
  var h = { x1: [], x2: [], u1: [], u2: [], J: [] };
  for (var k = 0; k < STEPS; k++) {
    var U = solveMPC(x, uPrev);
    var u = [U[0], U[1]], cost = 0;
    for (var i = 0; i < N; i++) {
      cost += Q * (Math.pow(x[0] - TARGET[0], 2) + Math.pow(x[1] - TARGET[1], 2)) +
              R * (U[i * 2] * U[i * 2] + U[i * 2 + 1] * U[i * 2 + 1]);
    }
    h.J.push(cost);
    var nx = [
      A[0][0] * x[0] + A[0][1] * x[1] + B[0][0] * u[0] + B[0][1] * u[1],
      A[1][0] * x[0] + A[1][1] * x[1] + B[1][0] * u[0] + B[1][1] * u[1]
    ];
    h.x1.push(x[0]); h.x2.push(x[1]); h.u1.push(u[0]); h.u2.push(u[1]);
    x = nx; uPrev = U;
  }
  h.x1.push(x[0]); h.x2.push(x[1]);
  return h;
}

// ===== 第二部分：接到界面上 =====
// 这段跑在沙箱 iframe 里（allow-scripts、不给 same-origin），
// 所以整块代码必须是自包含的：变量、样式、画布、面板都在这里建。
// 「自包含」也包括样式 —— 站点自己的 components.css 不在这个文档里，
// 不自己塞一份 <style> 的话，滑块和读数就是浏览器默认长相。
var style = document.createElement('style');
style.textContent =
  '.mpc{display:flex;flex-direction:column;gap:10px}' +
  '.mpc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px 14px}' +
  '.mpc-grid label{display:flex;align-items:center;gap:8px;font-size:12px;' +
    'color:var(--text-3,#9aa3b2);white-space:nowrap}' +
  '.mpc-grid output{min-width:3.2em;text-align:right;font-family:ui-monospace,monospace;' +
    'font-size:12px;color:var(--accent,#ff9d5c)}' +
  '.mpc-grid input[type=range]{flex:1 1 auto;min-width:0;accent-color:var(--accent,#ff9d5c)}' +
  '.mpc-check{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-3,#9aa3b2)}' +
  '.mpc-check input{accent-color:var(--accent,#ff9d5c)}' +
  '.mpc-canvas{width:100%;height:auto;max-width:100%;border-radius:8px;' +
    'border:1px solid var(--border,rgba(255,255,255,.12))}' +
  '.mpc-readout{font-family:ui-monospace,monospace;font-size:12px;line-height:1.7;' +
    'color:var(--text-2,#c6c1be)}' +
  '.mpc-readout b{color:var(--text,#f4f3f3)}' +
  '.mpc-warn{color:var(--accent-2,#7aa2ff)}';
document.head.appendChild(style);

var panel = document.createElement('div');
panel.className = 'mpc';
panel.innerHTML =
  '<div class="mpc-grid">' +
    '<label>预测步数 N<output data-out="N">8</output><input type="range" min="1" max="25" step="1" value="8" data-p="N"></label>' +
    '<label>状态权重 Q<output data-out="Q">100</output><input type="range" min="1" max="400" step="1" value="100" data-p="Q"></label>' +
    '<label>末端权重 F<output data-out="F">100</output><input type="range" min="1" max="400" step="1" value="100" data-p="F"></label>' +
    '<label>输入权重 R<output data-out="R">0.10</output><input type="range" min="0.01" max="5" step="0.01" value="0.1" data-p="R"></label>' +
    '<label>目标 x₁*<output data-out="t1">400</output><input type="range" min="-500" max="500" step="10" value="400" data-p="t1"></label>' +
    '<label>目标 x₂*<output data-out="t2">-400</output><input type="range" min="-500" max="500" step="10" value="-400" data-p="t2"></label>' +
  '</div>' +
  '<label class="mpc-check"><input type="checkbox" data-p="inc"> 用输入增量加权（ΔU 而非 U）</label>' +
  '<canvas class="mpc-canvas" width="1040" height="500"></canvas>' +
  '<div class="mpc-readout"></div>';
demo.root.appendChild(panel);

var cv = panel.querySelector('canvas'), cx = cv.getContext('2d');
var readout = panel.querySelector('.mpc-readout');

function cssv(n, fb) {
  var s = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return s || fb;
}
var C1 = cssv('--accent', '#ff9d5c'), C2 = cssv('--accent-2', '#7aa2ff');
var C3 = cssv('--tok-string', '#98c379'), C4 = cssv('--tok-number', '#d19a66');
var GRID = cssv('--border', 'rgba(255,255,255,.12)'), TXT = cssv('--text-3', '#8b93a7');

function plot(h) {
  var W = cv.width, H = cv.height, pad = 62, gap = 40;
  var topH = (H - pad * 2 - gap) / 2, botY = pad + topH + gap;
  cx.clearRect(0, 0, W, H);
  cx.font = '13px ui-monospace, monospace';

  function range(lists) {
    var lo = Infinity, hi = -Infinity;
    lists.forEach(function (d) { d.forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; }); });
    if (!isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-9) hi = lo + 1;
    var m = (hi - lo) * 0.1;
    return { lo: lo - m, hi: hi + m };
  }
  function axes(y, hgt, rg, title) {
    var n = Math.max(2, h.x1.length - 1);
    cx.strokeStyle = GRID; cx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var yy = y + hgt * i / 4;
      cx.beginPath(); cx.moveTo(pad, yy); cx.lineTo(W - 18, yy); cx.stroke();
      cx.fillStyle = TXT; cx.textAlign = 'right';
      cx.fillText((rg.hi - (rg.hi - rg.lo) * i / 4).toFixed(0), pad - 8, yy + 4);
    }
    cx.textAlign = 'left'; cx.fillStyle = TXT; cx.fillText(title, pad, y - 14);
    cx.fillText('0', pad - 4, y + hgt + 20);
    cx.textAlign = 'right'; cx.fillText(STEPS + ' 步', W - 18, y + hgt + 20);
    return function (k) { return pad + (W - pad - 18) * (k / n); };
  }
  function line(X, data, rg, y, hgt, colour) {
    cx.strokeStyle = colour; cx.lineWidth = 2; cx.beginPath();
    data.forEach(function (val, k) {
      var yy = y + hgt * (1 - (val - rg.lo) / (rg.hi - rg.lo));
      k ? cx.lineTo(X(k), yy) : cx.moveTo(X(k), yy);
    });
    cx.stroke();
  }

  var rs = range([h.x1, h.x2]);
  var X1 = axes(pad, topH, rs, '状态  x₁ / x₂');
  cx.strokeStyle = cssv('--ring', 'rgba(255,255,255,.4)'); cx.setLineDash([5, 5]); cx.lineWidth = 1.5;
  TARGET.forEach(function (tv) {                    // 目标值：稳态误差一眼可见
    var yy = pad + topH * (1 - (tv - rs.lo) / (rs.hi - rs.lo));
    cx.beginPath(); cx.moveTo(pad, yy); cx.lineTo(W - 18, yy); cx.stroke();
  });
  cx.setLineDash([]);
  line(X1, h.x1, rs, pad, topH, C1);
  line(X1, h.x2, rs, pad, topH, C2);

  var ru = range([h.u1, h.u2]);
  var X2 = axes(botY, topH, ru, '控制量  u₁ / u₂');
  line(X2, h.u1, ru, botY, topH, C3);
  line(X2, h.u2, ru, botY, topH, C4);

  var items = [['x₁', C1], ['x₂', C2], ['u₁', C3], ['u₂', C4]];
  var lx = pad + 6;
  items.forEach(function (it) {
    cx.fillStyle = it[1]; cx.fillRect(lx, 18, 14, 3);
    cx.fillStyle = TXT; cx.fillText(it[0], lx + 20, 23); lx += 66;
  });
  cx.fillStyle = TXT; cx.textAlign = 'right'; cx.fillText('虚线 = 目标值', W - 18, 23);
}

function run() {
  var h = simulate();
  plot(h);
  var e1 = Math.abs(h.x1[h.x1.length - 1] - TARGET[0]);
  var e2 = Math.abs(h.x2[h.x2.length - 1] - TARGET[1]);
  readout.innerHTML =
    '代价 J(k=0) = <b>' + h.J[0].toFixed(0) + '</b>　·　稳态误差 |x₁−x₁*| = <b>' +
    e1.toFixed(1) + '</b>，|x₂−x₂*| = <b>' + e2.toFixed(1) + '</b>　·　' +
    (incremental ? '增量加权 ΔU' : '直接加权 U') +
    (e1 > 1 || e2 > 1
      ? '<br><span class="mpc-warn">还有残差 —— R 偏大时直接加权会留下稳态误差，勾上「增量加权」看差别。</span>'
      : '');
}

panel.querySelectorAll('[data-p]').forEach(function (el) {
  el.addEventListener('input', function () {
    var k = el.getAttribute('data-p');
    if (k === 'inc') incremental = el.checked;
    else if (k === 't1') TARGET[0] = parseFloat(el.value);
    else if (k === 't2') TARGET[1] = parseFloat(el.value);
    else if (k === 'N') N = parseInt(el.value, 10);
    else if (k === 'Q') Q = parseFloat(el.value);
    else if (k === 'F') F = parseFloat(el.value);
    else if (k === 'R') R = parseFloat(el.value);
    var out = panel.querySelector('[data-out="' + k + '"]');
    if (out) {
      out.textContent = k === 'R' ? R.toFixed(2)
        : k === 't1' ? String(TARGET[0]) : k === 't2' ? String(TARGET[1])
        : String(k === 'N' ? N : k === 'Q' ? Q : F);
    }
    run();
  });
});

if (window.Theme && window.Theme.onChange) window.Theme.onChange(run);
run();

// ===== 第三部分：自检 =====
// 把解析解 U 代回 X = M x + C U，再和逐拍递推同一组 U 得到的状态比一遍。
// 纯看曲线是发现不了建模错误的 —— 幂次错一位时曲线照样画得出来，
// 只是数值已经发散到 1e+72。这个残差必须是小量。
(function selfCheck() {
  var x0 = [0, 0], U = solveMPC(x0, null);
  var mc = buildMC(N);
  var eta = 0, worst = 0;
  var man = x0.slice();
  for (var i = 0; i < N; i++) {                    // 逐步递推
    var u = [U[i * 2], U[i * 2 + 1]];
    man = [A[0][0] * man[0] + A[0][1] * man[1] + B[0][0] * u[0] + B[0][1] * u[1],
           A[1][0] * man[0] + A[1][1] * man[1] + B[1][0] * u[0] + B[1][1] * u[1]];
    var pred = add(mul(mc.M, [[x0[0]], [x0[1]]]),
                   mul(mc.C, U.map(function (v) { return [v]; })));
    var d = Math.max(Math.abs(pred[(i + 1) * 2][0] - man[0]),
                     Math.abs(pred[(i + 1) * 2 + 1][0] - man[1]));
    var scale = Math.max(1, Math.abs(man[0]), Math.abs(man[1]));
    eta = Math.max(eta, d / scale);
    worst = Math.max(worst, d);
  }
  window.__mpcCheck = { rel: eta, abs: worst, N: N, nrm: Math.hypot(U[0], U[1]) };
  console.log('预测矩阵自检：相对残差 ' + eta.toExponential(2) +
              '，绝对残差 ' + worst.toExponential(2) +
              (eta < 1e-9 ? ' ✓' : ' ✗ 建模有问题'));
})();

demo.log('面板就绪：拖滑块改参数，曲线会立刻重算');
console.log('N=' + N + '，代价函数=' + (incremental ? 'ΔU 加权' : 'U 加权') +
            '，N 步预测矩阵尺寸=' + (2 * (N + 1)) + '×' + (2 * N));
```

## WBC 控制简介

MPC 给出的是作用于质心的合力与合力矩。一台四足机器人有 12 个关节，从「机身要受多大的力」
到「每个关节出多少力矩」之间还差一步 —— 这一步就是全身控制（WBC）。

### 浮动基座模型

四足没有固定基座，机身自己就有 6 个自由度，所以广义坐标要写成
$\mathbf{q} = [\mathbf{q}_b^\top, \mathbf{q}_j^\top]^\top$，其中 $\mathbf{q}_b \in \mathbb{R}^6$
是机身位姿、$\mathbf{q}_j \in \mathbb{R}^{12}$ 是关节角。运动方程：

$$\mathbf{M}(\mathbf{q})\ddot{\mathbf{q}} + \mathbf{h}(\mathbf{q}, \dot{\mathbf{q}}) = \mathbf{S}^\top \boldsymbol{\tau} + \sum_i \mathbf{J}_{c_i}^\top \mathbf{f}_i$$

- $\mathbf{h}$ 收拢了科氏力、离心力与重力；
- $\mathbf{S} = [\mathbf{0}_{12\times6}\ \ \mathbf{I}_{12}]$ 是选择矩阵 —— 关节电机只能在
  $\mathbf{q}_j$ 这 12 维上出力，机身那 6 维**没有直接驱动**，只能靠足端接触力
  $\mathbf{f}_i$ 间接推动。这一条是腿式控制与机械臂最本质的区别；
- $\mathbf{J}_{c_i}$ 是第 $i$ 个接触点的雅可比。

理想静止接触还要求接触点不滑动、不弹跳，即加速度约束：

$$\mathbf{J}_{c_i}\ddot{\mathbf{q}} + \dot{\mathbf{J}}_{c_i}\dot{\mathbf{q}} = \mathbf{0}$$

### 把任务写成约束优化

WBC 的通用形式是：找到一个 $\ddot{\mathbf{q}}$、$\boldsymbol{\tau}$、$\mathbf{f}$，
在满足动力学与接触约束的前提下，尽量完成若干条任务。

| 约束 | 数学形式 | 物理含义 |
|---|---|---|
| 浮动基座动力学 | 上面第一式 | 力与加速度必须自洽 |
| 接触不滑动 | 上面第二式 | 支撑脚在惯性系里不动 |
| 摩擦锥 | $\sqrt{f_x^2+f_y^2} \le \mu f_z,\ f_z \ge 0$ | 脚不打滑、只能推不能拉 |
| 力矩上限 | $\lvert\tau_j\rvert \le \tau_j^{\max}$ | 电机能力边界 |
| 关节限位 | $\mathbf{q}_j^{\min} \le \mathbf{q}_j \le \mathbf{q}_j^{\max}$ | 机械行程 |

摩擦锥是二阶锥约束，为了塞进 QP 通常线性化成内接的多棱锥；棱锥内接会**偏保守**，
所以正常行走看不出差别，一到大加速度、大侧向力就会表现为「明明还有余量却先打滑」。

任务侧一般这么分层：

1. **主要任务**：质心轨迹跟踪、机身姿态、摆动腿足端轨迹 —— MPC 给的就是这些参考；
2. **次要任务**：躯干姿态正则、关节阻尼、避免奇异 —— 只在前者留出的零空间里做。

**加权 QP 与严格层级不是一回事。** 给主要任务一个大权重、次要任务一个小权重，
求解器在冲突时**可以**牺牲主要任务；只有零空间投影才是真正的优先级。
工程上常见做法是两层：先解主要任务，再把它的零空间作为等式约束去解次要任务。
代价是要解两次 QP，而且零空间维度低的时候数值条件会变差。

### 一个容易踩的坑：接触计划与求解频率不匹配

WBC 通常跑在 500 Hz ~ 1 kHz，而 MPC 只有 30 ~ 100 Hz。两次 MPC 之间，
WBC 一直拿着上一帧的接触力参考在追。一旦实际触地时刻比计划早或晚，
即使 MPC 的解没过期，接触计划也已经错了 —— 此时正确做法是**立刻按新接触状态重解**，
而不是继续跟踪旧参考。落地检测的迟滞不能设得太大，否则会出现「脚已经踩实了，
WBC 还以为它在空中」这种把机身往下压的发散。

---

## 机器狗MPC-WBC控制原理

把两层接起来，关键在于**分清谁负责什么**：

| 层 | 频率 | 输入 | 输出 |
|---|---|---|---|
| 步态 / 落脚点规划 | 5 ~ 20 Hz | 期望速度、地形 | 接触序列、落脚点 |
| MPC | 30 ~ 100 Hz | 接触序列、机身状态 | 质心轨迹、接触力、机身姿态参考 |
| WBC | 500 ~ 1000 Hz | MPC 参考 + 关节实测 | 12 个关节力矩 |
| 电机驱动 | 1 ~ 5 kHz | 关节力矩 | 电流环 |

### 单刚体 MPC 的简化边界

MPC 层用单刚体模型：把整台机器人当成一个质量集中在质心的刚体，
腿只提供力，不考虑腿自身的惯量与动力学。写成状态空间：

$$\dot{\mathbf{x}} = \mathbf{A}\mathbf{x} + \mathbf{B}\mathbf{u},\qquad
\mathbf{x} = [\boldsymbol{\Theta}^\top, \mathbf{p}^\top, \boldsymbol{\omega}^\top, \dot{\mathbf{p}}^\top]^\top,\qquad
\mathbf{u} = [\mathbf{f}_1^\top, \dots, \mathbf{f}_4^\top]^\top$$

- 机身姿态用欧拉角、并忽略角速度与欧拉角速率的差异（小角度下近似成立）；
- 忽略腿摆动对整机角动量的贡献；
- 接触位置和接触序列**固定**，由上一层给定。

这些近似在 Trot 步态、中低速下足够用。一旦步频变高、腿摆得快，
或者要做一个大幅度的跳跃，被忽略的角动量项就不再是小量，
表现为机身姿态跟踪持续有稳态偏差 —— 这时候要么把腿的动力学补回模型，
要么把姿态环交给 WBC 单独管。

### 为什么力与加速度要分开求解

一种朴素的想法是把 $\mathbf{u} = \mathbf{f}$ 直接代进 WBC 的动力学里解一个联合优化。
问题在于：MPC 的时间步长是 20 ~ 30 ms，WBC 是 1 ~ 2 ms，
两者对模型精度的要求差了一个量级。硬凑成一个优化问题，求解规模会随预测步数 $N$ 线性增长，
算不完；而分开之后，只有**力**这一个接口需要在两层之间传递，
MPC 的预测步数可以随便加，WBC 里也不必重复建模摩擦锥。

### 完整接口清单

只传接触力是不够的，接收方必须能判断参考是否还有效：

```text
Plan
  stamp            // 生成时刻
  valid_until      // 有效期，超期即作废
  frame_id         // 参考所在坐标系
  contact_mask     // 这一帧哪些脚应当支撑
  com_traj         // 预测窗内的质心轨迹
  base_pose_ref    // 机身姿态参考
  contact_forces   // 各支撑脚的力
  solver_status    // 求解器状态：ok / infeasible / timeout
  residuals        // 各任务的残差
```

超期与求解失败都要进入**可观测的状态转换**，而不是悄悄沿用上一帧：
把旧解当万能后备方案，出问题时现场没有任何线索。
规划与控制还必须共用同一个时间基准 —— 一边用传感器时间戳、一边用本地墙上时间，
是这类系统里最难查的一类抖动。

### 怎么调

1. **先单独调 WBC**。给一组固定的质心高度和姿态参考，看四个支撑脚能不能稳住；
   这一步不涉及步态，出问题一定是模型或约束写错了。
2. **再调 MPC 的权重**。$Q$ 管跟踪、$R$ 管省力；
   $R$ 太大 MPC 会「舍不得用力」而达不到目标，太小则输出剧烈抖动、把 WBC 的解带偏。
   注意 $R$ 作用于**增量** $\Delta U_k$ 而不是 $U_k$，这是前面修正稳态误差那一节的结果。
3. **最后合起来看步态**。Trot 的支撑相重叠时间、抬脚高度、机身高度三者互相牵制，
   一次只改一个，并记录足端跟踪误差、关节饱和与机身姿态。

继续阅读：[早期步态调参笔记](/posts/legacy-gait-tuning/) 里那些「调参数之前先做什么」的检查，
放在这里同样成立；[运控回路的实时性](/posts/realtime-control-loop/) 讨论上面那张频率表
为什么必须以「数据年龄」而不是「周期」来衡量。

---

## 电机不是只能力矩一个接口

上面那张频率表最后一行是「电机驱动 1 ~ 5 kHz → 电流环」，但 WBC 的力矩和电流环之间还有一层：
Go2 这类关节电机的接口是**力位速混合控制**，一次下发 5 个量 ——

| 指令 | 含义 |
|---|---|
| $\tau_{ff}$ | 前馈力矩 |
| $q_{des}$ | 期望角度 |
| $\dot{q}_{des}$ | 期望角速度 |
| $K_p$ | 位置刚度 |
| $K_d$ | 阻尼系数 |

电机内部把它们合成成力矩，底层再交给永磁同步电机的 FOC 电流环：

$$\tau = \tau_{ff} + K_p\,(q_{des} - q) + K_d\,(\dot{q}_{des} - \dot{q})$$

这个形式的价值在于**一套接口能覆盖好几种控制**：把 $K_p,K_d$ 置零就退化成纯力矩控制，
把 $\tau_{ff}$ 置零就是纯位置控制，只给 $K_p$ 就是刚度控制（阻抗控制的雏形）。
换控制方式不用换接口，这也是为什么上层可以随时在「MPC/WBC 出力矩」和
「直接把姿态参考下给电机的刚度」之间做取舍。

![力位速混合控制框图](/assets/paper/quadruped-mpc/mix-control-block.webp) ![前馈 + PD 反馈的追踪曲线](/assets/paper/quadruped-mpc/mix-control-tracking.webp)

左图是这 5 个量的合成关系（设定角度经 $K_p$、设定速度经 $K_d$、再加设定力矩），
右图是 Simulink 里单独跑一遍三种方案的结果（横轴时间、纵轴关节角，四条曲线分别是
`desired` / `PID` / `feedforward-feedback` / `feedforward`）：

- **只用前馈**：给定轨迹一动就跟不上，误差一路攒着，最后落到参考曲线下面；
- **只用 PID 反馈**：起步滞后，追上了还会过冲；
- **前馈 + 反馈**：动态跟踪误差最小 —— 所以底层用的就是这一种。

> **仿真里必须把这一层建出来，不能直接把力矩灌进关节。** 直接灌力矩的关节，
> 位置环是「理想」的：没有 PD 的延迟、没有饱和、没有摩擦，仿真里调好的 $K_p$ 拿到
> 实机上根本不是一回事。反过来说，实机调试时如果关节发烫、跟随发飘，
> 先怀疑的是这 5 个量配得对不对，而不是 MPC 的权重。

## 观测器：MPC 的状态是估出来的

前面 MPC 的状态 $\mathbf{x}$ 里有姿态、角速度、质心速度。这些量在仿真里可以随便取真值，
真机上却**没有一个是直接测出来的**：编码器只给关节角度，IMU 只给加速度和角速度。
所以观测器不是"锦上添花"，它直接决定 MPC 拿到的初值有多脏。

**腿部电机观测器。** 单个电机有三个可测量：角度 $q$、速度 $\dot q$、力矩 $\tau$。
状态转移里角度由速度积分得到，力矩又来自下面那一层的混合控制指令 ——
所以观测模型和真实的状态转移并不是同一个东西，这里只按最基础的形式建，
把和传感器数据怎么融合留给下一层（EKF）。

**IMU 观测器。** IMU 的状态包括欧拉角、线速度、角加速度和角速度零偏，
其中**零偏按随机游走过程建模**（过程衰减系数典型值取 0.1）。IMU 只观测、不控制，
所以状态方程里没有控制项；机体的运动会耦合进 IMU 读数，但这一项只在高速运动时才显著，
为了不把模型搞复杂，这里没有把它写进去。

> 零偏为什么必须当成状态：不加的话，姿态角会**匀速漂移**，看起来像"越走越歪"的机械问题，
> 实际上是估计问题。把它放进状态里，EKF 才能把漂移和真实转动分开。

**拓展卡尔曼滤波。** 离散卡尔曼滤波把各传感器的噪声都当零均值白噪声，
于是只需要每个传感器的噪声协方差。已知两个协方差矩阵和测量值，就能按条件概率
把先验估计和测量融合成后验估计 —— 一组递推公式，代入具体数据即可。
四足上这么用的意义是：编码器准但只覆盖关节、IMU 覆盖姿态但噪声大且会漂，
两者单独都不足以喂 MPC，融合之后才可用。

## 仿真平台：MuJoCo + OCS2 + ROS 2

MuJoCo 是 Multi-Joint dynamics with Contact 的缩写，一个面向接触动力学的通用物理引擎：
场景写成 XML，用 C API 驱动，自带 OpenGL 可视化界面。选它的原因是腿式机器人的难点
几乎全在**接触**上（触地、打滑、冲击），而这正是它的设计目标。

验证分两步走：

1. **先不带仿真，只验规划。** 用 rviz2 + OCS2 跑 MPC：需要的东西只有机器人的描述文件
   和一组控制器参数，看质心轨迹、足端轨迹与接触力序列是否合理 ——
   这一步把"控制器本身写没写对"和"仿真接口通不通"分开，出问题不至于两处一起查。
2. **再接仿真。** 用 `unitree_sdk`（DDS）把 12 个关节的混合控制指令发给 MuJoCo 里的 Go2，
   同时从仿真里读回关节与 IMU 数据。**这一份接口在真机上就是发给电机的同一份** ——
   把底层控制和传感器读取封进 ROS 2 的 `hardware_interface`、在 URDF 里注册好之后，
   上层控制器不需要知道自己连的是仿真还是真机。

![Unitree SDK 与 MuJoCo 的交互方式](/assets/paper/quadruped-mpc/sdk-mujoco.webp)

跑起来用的参数如下（数值来自论文，单位按原表）：

| 项 | 值 | 说明 |
|---|---|---|
| 机身质量 | 6.921 kg | 含所有固定件 |
| 机身尺寸 | 0.3762 × 0.0935 × 0.114 m | 碰撞模型包围盒 |
| 机身惯量 Ixx / Iyy / Izz | 0.02448 / 0.098077 / 0.107 kg·m² | 相对质心 |
| 质心位置 x / y / z | 0.0211 / 0 / −0.0054 m | 相对机身坐标系原点 |
| 时间步长 dt | 0.015 s | 预测模型的离散周期 |
| 时域长度 | 1.0 s | 每次优化的时间范围 |
| MPC 求解频率 | 100 Hz | 节点重新求解的频率 |
| SQP 最大迭代 | 1 | 每轮只迭代一次，靠高频滚动补精度 |
| 摩擦系数 μ | 0.3 | 足端与地面 |
| 自碰撞最小距离 | 0.05 m | 8 对连杆，如 FL_calf–FR_calf |
| 初始基座高度 / 大腿 / 小腿 | 0.35 m / 0.72 rad / −1.44 rad | 站立初始状态 |
| 摆动高度 | 0.08 m | 抬腿的峰值高度 |
| 摆动抬升 / 着陆速度 | 0.05 / −0.1 m/s | 摆动相首末的垂直速度 |
| 摆动时间缩放 | 0.15 | 调整摆动相持续时间 |

单腿三个关节的能力边界（其他三条腿对称）：

| 关节 | 运动范围 (rad) | 最大扭矩 (N·m) | 最大速度 (rad/s) |
|---|---|---|---|
| 髋 FL_hip | −1.0472 ~ 1.0472 | 23.7 | 30.1 |
| 大腿 FL_thigh | −1.5708 ~ 3.4907 | 23.7 | 30.1 |
| 小腿 FL_calf | −2.7227 ~ −0.83776 | 45.43 | 15.70 |

注意小腿的限位是**整段为负**的，和前面正运动学里 $\theta_3 < 0$ 的约定是同一件事：
符号搞反了，逆运动学就会解到限位外面去，而正运动学看上去还是对的。
髋和踝的扭矩差了一倍（23.7 与 45.43），因为它们承担的是完全不同的负载 ——
约束里写"力矩上限"时不能所有关节套同一个数。

> **dt 和求解频率是两件事。** 0.015 s 对应约 66.7 Hz，而求解器跑在 100 Hz ——
> 前者决定预测模型的分辨率，后者是重新求解的节奏。把两个数当成一个来配，
> 改一个另一个跟着错，表现是"时域长度莫名其妙地变了"。

权重矩阵里有两处对比很有意思：

| 权重 | 值 | 作用 |
|---|---|---|
| 基座高度 $p_{base,z}$ | 1500 | 先保证机身不掉下去 |
| 基座水平位置 $p_{base,x/y}$ | 1000 | 抑制水平漂移 |
| 基座俯仰 / 横滚 | 300 | 维持机身水平 |
| 腿部关节角 | 2.5 ~ 5.0 | 关节跟踪（小腿权重更低） |
| 足端接触力 | 1.0 | 四足各方向均匀 |
| 足端相对速度 | 5000 | 抑制摆动腿抖动 |

机身那几个量比关节角高两个数量级：**先站住，再谈腿跟得准不准**。
而足端相对速度的权重（5000）远大于接触力（1.0），是典型的"量纲不同就不要横向比大小"——
它换来的效果是摆动腿不抖，代价是腾空相变得更"硬"。
另外这一版用的是 OCS2 的 `FullCentroidalDynamics`（完整质心动力学），
而不是前一节推的单刚体模型：腿的惯量与动量也算进去了，模型更准，但更重、对参数更敏感。

## 三种地形上的实测结果

![碎石地面](/assets/paper/quadruped-mpc/terrain-rubble.webp) ![粗糙地面](/assets/paper/quadruped-mpc/terrain-rough.webp) ![图片生成的凹凸地面](/assets/paper/quadruped-mpc/terrain-heightmap.webp)

在三种地面上跑同一套 MPC：

- **碎石地面**（堆积的碎块，上图左）：能稳定行走与旋转；
- **粗糙地面**（大块不规则起伏，上图中）：能站、能走，但**跨不上较高的边缘**；
- **图片生成的凹凸地面**（把一张高度图贴成地形，上图右）：稳定。

粗糙地面这个失败不是调参能解决的：MPC 不感知边缘高度，抬腿高度是配置里给定的固定值
（0.08 m），边缘一高就踩不上去。单纯把抬腿高度调大，换来的是稳定性下降和能耗上升 ——
这也说明**无感知的 MPC 进不了楼梯一类的环境**。

还有一类失败更值得记：**受到外力时可能不收敛**。缺少外部干扰观测器时，被推歪之后
MPC 会把旧的接触状态继续当成真的，解出来的动作序列就开始错。仿真里只是走歪，
实机上可能是关节堵转、电机受损或者撞坏周围设备。要补就得给系统加维（把干扰当状态估），
这也是 MPC 相比 RL 扩展性差的地方 —— 加一项能力就要动一次模型。

和强化学习对照着看，两种方案的取舍是这样的（论文里的结论，这里的表述保持中立）：

| | 强化学习 | MPC |
|---|---|---|
| 粗糙地形 | 能过，但**可能出现足端一直不着地地"滑"过去** | 无感知时上不去有高差的地形 |
| 能耗 | 上述行为在实机上费电、电机容易过热 | 相对可控，但抬腿高度调大同样费电 |
| 抗扰 | 从训练分布里见过就能扛 | 需要干扰观测器，否则可能不收敛 |
| 可解释性 | 出了事很难说清为什么 | 力从哪来、违反哪条约束，都能从解里读出来 |
| 扩展成本 | 重新训练 | 改模型维度、重推一遍 |

一句话结论：**这套 MPC 在仿真里是能用的**（三种地面都能走、能转、能保持平衡），
但它对模型和观测的依赖是真的 —— 想迁移到另一台 12 自由度的四足上，
需要的是导出一份准确的 URDF、把电机与 MPC 的参数按新机器重调一遍，
再按前面那个接口清单把底层控制与传感器读进 `hardware_interface`；
上实机之前，先在 MuJoCo 里把同一套参数跑通。
