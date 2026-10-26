/* Kinetic field: a small, deterministic drawing of signals and motion.
   The illustration is procedural geometry, not a robot or policy simulation. */
(function () {
  'use strict';
  var canvas = document.getElementById('hero-orbit');
  if (!canvas) return;
  var stage = canvas.closest('.orbit-stage'), visual = canvas.closest('.orbit-visual');
  if (!stage || !visual) return;
  var root = document.documentElement, context;
  try { context = canvas.getContext('2d', {alpha: true}); } catch (ignore) {}
  var status = visual.querySelector('[data-orbit-status]');
  if (!context) {
    if (status) status.textContent = '运动轨道 · 当前浏览器显示静态图';
    return;
  }
  var buttons = visual.querySelectorAll('[data-orbit-mode]');
  var pauseButton = visual.querySelector('[data-orbit-pause]');
  var controls = visual.querySelector('[data-orbit-controls]');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var modes = ['signal', 'motion', 'policy'], mode = 'motion', weights = [0, 1, 0];
  var descriptions = ['信号相连 · 沿轨道传递每一次变化', '循迹而动 · 在空间中描绘动作', '探索与收敛 · 从变化中寻找秩序'];
  var colors = {}, glow, W = 0, H = 0, DPR = 1, radius = 1, cx = 0, cy = 0;
  var compact = false, segments = 144, paths = [[], [], []], ground = [];
  var time = 0, last = null, raf = 0, draws = 0, paused = false, visible = true;
  var px = 0, py = 0, tx = 0, ty = 0, pointer = null, pendingPointer = null;
  var interaction = {kind: 'idle', strength: 0, held: false, age: 0, tap: false};
  var spin = 0, targetSpin = 0, deformation = 0, bounds = null;
  /* 投影里的「偏航补偿」：正文那层场用它把自己的旋转接到滚动上，
     画完就还原。0 的时候算式和原来一模一样。 */
  var yawShift = 0;
  /* 首屏离开时雕塑的「让位」：偏航、收缩、位移都由同一个进度给。
     投影读的是 `camera` 这个对象 —— hero 用自己的，正文那层场换成 neutral，
     所以两套相机互不污染，也不用逐个变量存了再还原。 */
  var camera = null, heroCamera = {turn: 0, scale: 1, dx: 0, dy: 0};
  var neutralCamera = {turn: 0, scale: 1, dx: 0, dy: 0};
  var heroLeave = 0;
  var debug = /[?&]motion-debug=1(?:&|$)/.test(window.location.search || '');
  var metrics = null, costs = [], intervals = [], metricAt = 0;
  var TAU = Math.PI * 2;
  var ignored = 'a,button,input,textarea,select,[contenteditable]';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* =====================================================================
     正文里的「场」：同一支手接着画

     首页的题目是「运动轨道」，可视觉上很容易变成两块：上头一台会动的雕塑、
     下头一叠会淡入的卡片。要让它们看起来是**同一个系统**，光靠配色不够 ——
     得让同一个引擎、同一个时钟一直画下去：

       1) 导轨        章节左侧那条细线由这里画（和 CSS 的填充线重合），alpha 跟 --chapter-enter 走；
       2) 信号彗星    沿导轨上下走的那颗光点，速度用 hero 的 time（不是另起一个动画）；
       3) 站台节点    章节标题旁边那颗，和 .flow-caption 的小圆点同位置、同色；
       4) 描边光点    卡片「描边」那 2px 线的笔尖，也由这里画 —— 读者看到的是
                      一颗信号在卡片四周跑一圈，卡片跟着实体化；
       5) 连接段      从雕塑下缘弯到第一条导轨顶端的一段，随滚动抽出来。

     静态模式（暂停 / 减少动效 / 关闭动效）一律不画：那时 CSS 那条线自己就是完整的。
     ===================================================================== */
  var flowCanvas = document.getElementById('flow-field');
  var flowCtx = null;
  try { flowCtx = flowCanvas && flowCanvas.getContext ? flowCanvas.getContext('2d', {alpha: true}) : null; } catch (ignore) {}
  var flowW = 0, flowH = 0, flowDpr = 1;
  var flowVisible = false, flowChapters = [], flowCards = [], flowRows = [];
  var flowDots = {x: 0, y: 0}, flowBridge = null;
  /* 正文那层场自己的指针偏移。为什么不复用 hero 的 px/py：那对变量是
     「鼠标在雕塑画框里的位置」，读者在正文里移动鼠标时它不该动 ——
     否则滚回顶部会看见那台雕塑歪着停在那里（没人碰过它）。 */
  var leanX = 0, leanY = 0, leanTX = 0, leanTY = 0;

  function readStep(el, name) {
    var v = parseFloat(el.style.getPropertyValue(name));
    return isFinite(v) ? v : 0;
  }

  function measureFlow() {
    if (!flowCtx) return;
    flowChapters = [].slice.call(document.querySelectorAll('.home-flow [data-scroll-chapter]'))
      .filter(function (el) { return !el.hidden && el.offsetParent !== null; });
    flowCards = [].slice.call(document.querySelectorAll(
      '.home-flow .direction-card, .home-flow .lab-invitation, .home-flow .card'));
    flowRows = [].slice.call(document.querySelectorAll('.home-flow .latest-entry'));
    flowBridge = document.querySelector('.page-home .flow-bridge a');
    /* 标签那一把 pill 用「一路扫过去」的方式到场：每颗按序号分到一点延迟写进
       --d，CSS 再从 --rv 里减掉它。放在这里是因为只需要量一次序号，
       而且给 pill 加 transform 会和它 hover 时的上浮打架，所以只动 opacity。 */
    var pills = [].slice.call(document.querySelectorAll('.home-flow .tag-cloud .tag-pill'));
    pills.forEach(function (pill, index) {
      pill.style.setProperty('--d', (pills.length > 1 ? index / (pills.length - 1) * .38 : 0).toFixed(3));
    });
    var w = Math.max(320, window.innerWidth || 320);
    var h = Math.max(280, window.innerHeight || 280);
    var ratio = Math.min(compact ? 1.25 : 2, window.devicePixelRatio || 1);
    if (w === flowW && h === flowH && ratio === flowDpr) return;
    flowW = w; flowH = h; flowDpr = ratio;
    flowCanvas.width = Math.round(w * ratio);
    flowCanvas.height = Math.round(h * ratio);
  }

  function flowDot(context, x, y, r, color, alpha) {
    context.globalAlpha = alpha; context.fillStyle = color;
    context.beginPath(); context.arc(x, y, r, 0, TAU); context.fill();
  }

  /* 卡片描边笔尖的位置：和 home-flow.css 里那四条渐变边的相位**同一套公式**
     （--p-edge1..4 = (rv - .03/.22/.41/.60) * 5）。两边算同一个点，光点才咬得住线。 */
  function traceHead(el, rv, out) {
    var r = el.getBoundingClientRect();
    var e1 = clamp((rv - .03) * 5, 0, 1), e2 = clamp((rv - .22) * 5, 0, 1);
    var e3 = clamp((rv - .41) * 5, 0, 1), e4 = clamp((rv - .60) * 5, 0, 1);
    if (e1 < 1) { out.x = r.left + r.width * e1; out.y = r.top; return true; }
    if (e2 < 1) { out.x = r.right; out.y = r.top + r.height * e2; return true; }
    if (e3 < 1) { out.x = r.right - r.width * e3; out.y = r.bottom; return true; }
    if (e4 < 1) { out.x = r.left; out.y = r.bottom - r.height * e4; return true; }
    return false;
  }

  /* 正文里的「场」不是另画一套东西：还是 point() / pathColor() 那一组曲线，
     只把「相机」拉远、放大 —— 半径放大到屏幕之外，三条闭环就只剩几条扫过
     卡片背后的弧线。读者认不出它是首屏那台雕塑，但配色、线宽、证物点全对得上。
     两个细节让它「不静止」：它随滚动慢慢转（yawShift），停下来时 time 还在走。 */
  function drawAmbient(alpha) {
    if (alpha <= .012 || !flowCtx) return;
    var saveX = cx, saveY = cy, saveR = radius, saveShift = yawShift, saveCam = camera;
    var savePX = px, savePY = py;
    /* 正文那层场用「中立相机」：首屏的让位（turn / scale / dx / dy）只管舞台，
       不然雕塑一转，正文里的弧线也跟着晃，那层场就没有「一直在那儿」的稳定感了。 */
    camera = neutralCamera;
    radius = Math.max(flowW * .58, flowH * .95);
    cx = flowW * .68; cy = flowH * .30;
    yawShift = -(window.pageYOffset || 0) * .00055;
    /* 鼠标在正文里移动，这几条弧线跟着偏一点 —— 和 hero 用同一对投影参数，
       只是幅度收到 55%，远看像「镜头跟着手走」，不会晃得比首屏还厉害。 */
    px = leanX * .55; py = leanY * .55;
    var steps = compact ? 64 : 120;
    for (var i = 0; i < 3; i++) {
      var a0 = time * (.055 + i * .012) + i * 2.1;
      flowCtx.beginPath();
      for (var n = 0; n <= steps; n++) {
        point(i, a0 + n / steps * TAU, temp);
        if (n === 0) flowCtx.moveTo(temp.x, temp.y); else flowCtx.lineTo(temp.x, temp.y);
      }
      flowCtx.strokeStyle = pathColor(i);
      flowCtx.globalAlpha = alpha * (i === 2 ? .5 : .85);
      flowCtx.lineWidth = 1;
      flowCtx.stroke();
      /* 沿弧线留几颗证物点：和 hero 曲线上那四颗是同一门画法 */
      for (var k = 0; k < 5; k++) {
        point(i, a0 + (k + .4) * TAU / 5, temp);
        flowDot(flowCtx, temp.x, temp.y, 1.5, pathColor(i), alpha * (i === 2 ? .5 : .95));
      }
    }
    cx = saveX; cy = saveY; radius = saveR; yawShift = saveShift;
    px = savePX; py = savePY;
    camera = saveCam;
    flowCtx.globalAlpha = 1;
  }

  function drawFlow() {
    if (!flowCtx || !flowW || !flowH) return;
    var context2 = flowCtx;
    context2.setTransform(flowDpr, 0, 0, flowDpr, 0, 0);
    context2.clearRect(0, 0, flowW, flowH);
    if (staticMode() || !flowVisible || document.hidden) return;

    var vh = flowH;
    context2.lineCap = 'round'; context2.lineJoin = 'round';

    /* 正文里的「场」。它在雕塑**还没走完**的时候就开始浮上来（bounds.bottom 从
       六成屏高往下滑的这 70% 屏高里渐显）：因为放大到七八倍之后，那几条弧线
       已经认不出是上面那台雕塑了，读者看到的是「这片场比首屏大得多」。
       首屏完全在屏幕里时它是 0 —— 顶上的第一眼不能被改动。 */
    var ambient = bounds ? clamp((vh * .60 - bounds.bottom) / (vh * .70), 0, 1) : 0;
    if (ambient > .01) drawAmbient(ambient * (colors.light ? .12 : .19));

    /* 窄屏：CSS 把导轨藏了（见 home-flow.css 的 max-width:700px），导轨上那些
       信号跟着不画，否则彗星会悬在左边距上、底下没有线。背景那层场留着。 */
    if (flowW <= 700) return;

    /* 入口站（「沿着问题，往下探索」）是首屏和正文之间的门。它在屏幕上的位置
       这一帧只量一次，导轨、引线、缺口段全部从这里取，免得各算各的。 */
    var bridgeRect = flowBridge ? flowBridge.getBoundingClientRect() : null;
    var bridgeMid = bridgeRect && bridgeRect.height > 0 ? bridgeRect.top + bridgeRect.height / 2 : null;

    /* ---- 导轨 + 彗星 + 站台 ---- */
    for (var ci = 0; ci < flowChapters.length; ci++) {
      var el = flowChapters[ci];
      var r = el.getBoundingClientRect();
      if (r.bottom < -80 || r.top > vh + 80) continue;
      var enter = readStep(el, '--chapter-enter');
      var progress = readStep(el, '--chapter-progress');
      var railX = Math.round(r.left + 24) + .5;    /* 与 .flow-pulse 的 left:24px 同一个坐标 */
      var top = Math.max(r.top, -40);
      var bottom = Math.min(r.bottom, vh + 40);
      /* 第一章的导轨往上接到「沿着问题，往下探索」那一站：场是从首屏那条路走进来的 */
      var bridgeY = null;
      if (ci === 0 && bridgeMid !== null && bridgeMid > -60 && bridgeMid < vh + 60) {
        bridgeY = bridgeMid;
        if (bridgeY < top) top = Math.max(bridgeY, -40);
      }
      if (bottom - top < 2) continue;

      /* 导轨本身**不在这里画**：CSS 已经有一条灰底 + 进度填充（`::before/::after`），
         这层再叠一条就是两条 alpha 不同的线，看起来时粗时细。这里只画信号与站台。 */
      var headY = r.top + (r.bottom - r.top) * progress;
      var headClamped = clamp(headY, top, bottom);

      /* 行刻度：导轨是一根「尺」，每一排内容都在上面刻一道。
         短、只朝内容那一侧、没有环 —— 和站台不是同一种东西：
         站台标的是「哪一章」，刻度标的是「哪一排」。刻度本身也是 hero 地面
         圆环上那 32 道刻度的画法（`drawGround()`），所以读者认得出它是同一支笔。 */
      if (enter > .2) {
        var bands = el.querySelectorAll('.direction-card, .lab-invitation, .card, .latest-entry, .tag-cloud');
        var bandTops = [];
        for (var bi = 0; bi < bands.length; bi++) {
          var bandRect = bands[bi].getBoundingClientRect();
          if (bandRect.width < 60 || bandRect.bottom < -20 || bandRect.top > vh + 20) continue;
          var dupRow = false;
          for (var bj = 0; bj < bandTops.length; bj++) {
            if (Math.abs(bandTops[bj] - bandRect.top) < 6) { dupRow = true; break; }
          }
          if (dupRow) continue;
          bandTops.push(bandRect.top);
          var bandRv = readStep(bands[bi], '--rv');
          if (bandRv < .1) continue;
          context2.globalAlpha = (.09 + .15 * bandRv) * enter;
          context2.strokeStyle = colors.muted; context2.lineWidth = 1;
          context2.beginPath();
          context2.moveTo(railX + .5, bandRect.top + .5);
          context2.lineTo(railX + 6.5, bandRect.top + .5);
          context2.stroke();
        }
      }

      /* 信号彗星：和 hero 里的 traveller 同一个时钟、同一种"短尾巴 + 亮点"画法 */
      if (progress > .02 && progress < .995 && enter > .02) {
        var tone = ci % 2 ? colors.warm : colors.accent;
        var tail = 18 + 10 * Math.sin(time * .9 + ci * 1.7);
        context2.globalAlpha = .5 * enter;
        context2.strokeStyle = tone; context2.lineWidth = 1.5;
        context2.beginPath();
        context2.moveTo(railX, Math.max(top, headClamped - tail));
        context2.lineTo(railX, headClamped);
        context2.stroke();
        flowDot(context2, railX, headClamped, 7, tone, .13 * enter);
        flowDot(context2, railX, headClamped, 2.6, tone, .85 * enter);
        flowDot(context2, railX, headClamped, .9, colors.bg, .9 * enter);
      }

      /* 入口站：入口链接左边那条短线此刻就是场的一部分（一个环 + 一颗芯） */
      if (ci === 0 && bridgeY !== null && bridgeRect) {
        var brEnter = clamp((vh * .55 - bridgeRect.top) / 200, 0, 1);
        context2.globalAlpha = .22 + .5 * brEnter;
        context2.strokeStyle = colors.accent; context2.lineWidth = 1;
        context2.beginPath(); context2.arc(railX, bridgeY, 4.6, 0, TAU); context2.stroke();
        flowDot(context2, railX, bridgeY, 1.6, colors.accent, .3 + .55 * brEnter);
        /* 引线：CSS 那条 24px 短横（.flow-bridge a::before）左边是空的，这里补上
           环到短横之间那 32px，「环 → 短横 → 文字」才是一条笔直的引线。
           入口站本来就是这条线的一个站台，不是旁边一个链接。 */
        context2.globalAlpha = .26 + .34 * brEnter;
        context2.beginPath();
        context2.moveTo(railX + 5, bridgeY); context2.lineTo(bridgeRect.left, bridgeY); context2.stroke();
        /* 缺口：第一章的导轨从 top + 35px 才开始（CSS ::before 的 top），
           从这里到那儿原本有道口子 —— 补上这一小节，读者才看不到两个组件拼的缝。
           末端由强调色渐变到导轨的灰色，免得两种颜色在断点上突然换脸。 */
        var railStart = r.top + 35;
        if (railStart > bridgeY + 6) {
          var seamLine = context2.createLinearGradient(0, bridgeY, 0, railStart);
          seamLine.addColorStop(0, colors.accent);
          seamLine.addColorStop(1, colors.muted);
          context2.globalAlpha = .3 + .35 * brEnter;
          context2.strokeStyle = seamLine;
          context2.beginPath(); context2.moveTo(railX, bridgeY + 5.5); context2.lineTo(railX, railStart); context2.stroke();
        }
      }

      /* 站台节点：和 .flow-caption::before 同位置 —— 一个 CSS 画的环，一颗 canvas 画的芯 */
      var cap = el.querySelector('.flow-caption');
      if (cap) {
        var cr = cap.getBoundingClientRect();
        var capY = cr.top + cr.height / 2;
        if (capY > -20 && capY < vh + 20) {
          /* 环 → 文字：和入口站「环 → 短横 → 文字」是同一句语法 ——
             每个章节抬头都是这条导轨上的一个站台，不是一段普通标题。 */
          if (enter > .04) {
            context2.globalAlpha = .16 + .3 * enter;
            context2.strokeStyle = colors.accent; context2.lineWidth = 1;
            context2.beginPath();
            context2.moveTo(railX + 5, capY); context2.lineTo(cr.left, capY); context2.stroke();
          }
          flowDot(context2, railX, capY, 4.4, colors.accent, .18 + enter * .5);
          flowDot(context2, railX, capY, 1.7, colors.accent, .35 + enter * .6);
          /* 正在读的这一站：环里有一圈慢慢扩开的余波。彗星是跟着滚轮走的，
             停下来就停住，而这一圈是 hero 那个时钟在走 —— 正文停着也在呼吸。 */
          if (progress > .02 && progress < .985) {
            var wave = (time * .55 + ci * .37) % 1;
            context2.globalAlpha = (1 - wave) * .2 * enter;
            context2.strokeStyle = colors.accent; context2.lineWidth = .9;
            context2.beginPath(); context2.arc(railX, capY, 4.4 + wave * 14, 0, TAU); context2.stroke();
          }
        }
      }
    }

    /* ---- 描边笔尖：让 CSS 那 2px 线看起来是一颗信号画出来的 ---- */
    for (var k = 0; k < flowCards.length; k++) {
      var card = flowCards[k];
      var rv = readStep(card, '--rv');
      if (!(rv > .03 && rv < .999)) continue;
      var rect = card.getBoundingClientRect();
      if (rect.bottom < -40 || rect.top > vh + 40) continue;
      if (rect.width < 40 || rect.height < 40) continue;
      if (!traceHead(card, rv, flowDots)) continue;
      var glowX = flowDots.x, glowY = flowDots.y;
      flowDot(context2, glowX, glowY, 9, colors.warm, .12);
      flowDot(context2, glowX, glowY, 3.4, colors.warm, .42);
      flowDot(context2, glowX, glowY, 1.5, colors.text, .95);
    }

    /* ---- 行式条目：「最近更新」那种没有外框，但有一条上边框 ——
       信号就沿着那条边框从左走到右，和卡片描边是同一门语言。 ---- */
    for (var ri = 0; ri < flowRows.length; ri++) {
      var row = flowRows[ri];
      var rrv = readStep(row, '--rv');
      if (!(rrv > .05 && rrv < .995)) continue;
      var rr = row.getBoundingClientRect();
      if (rr.bottom < -20 || rr.top > vh + 20 || rr.width < 80) continue;
      var hx = rr.left + rr.width * rrv, hy = rr.top;
      context2.globalAlpha = .26 * (1 - rrv * .35);
      context2.strokeStyle = colors.accent; context2.lineWidth = 1.2;
      context2.beginPath();
      context2.moveTo(Math.max(rr.left, hx - Math.min(120, rr.width * .3)), hy);
      context2.lineTo(hx, hy); context2.stroke();
      flowDot(context2, hx, hy, 7, colors.accent, .10);
      flowDot(context2, hx, hy, 2.2, colors.text, .8);
    }

    /* ---- 连接段：从雕塑下缘弯进第一条导轨（滚出首屏的那一小段） ---- */
    if (bounds && flowChapters.length) {
      var first = flowChapters[0].getBoundingClientRect();
      var firstRailX = Math.round(first.left + 24) + .5;
      var startX = bounds.left + bounds.width * .70;
      var startY = bounds.bottom - 6;              /* 雕塑下缘 */
      var endX = firstRailX;
      var endY = first.top + 6;                    /* 第一章导轨顶端 */
      if (flowBridge) {                            /* 有入口站就落在入口站上 */
        var bn = flowBridge.getBoundingClientRect();
        if (bn.height > 0) endY = bn.top + bn.height / 2;
      }
      /* 雕塑在上、导轨在下：从首屏滑到第一章的那一段里，两边都在视口内才画。 */
      if (startY > -40 && startY < vh + 20 && endY > -20 && endY < vh + 80 && startY < endY) {
        var fade = clamp((vh - Math.max(startY, 0)) / 220, 0, 1);
        var midY = startY + (endY - startY) * .55;
        var c1x = startX - 30, c2x = endX + 70;
        /* 三条道，就是 hero 那三条曲线（信号 / 轨迹 / 策略，蓝 / 橙 / 白）。
           注意控制点：只有起手那两个带偏移，收尾那个点回到中线上 ——
           于是三条道在最后三分之一里**并成一条**，正好落在入口站的圆心上。
           读者看到的是「三件事并成一条路」，而这条路的下一段就是左边那根导轨。 */
        var lanes = [[5, 0], [0, 1], [-5, 2]];
        for (var li = 0; li < lanes.length; li++) {
          var off = lanes[li][0];
          context2.strokeStyle = pathColor(lanes[li][1]); context2.lineWidth = 1;
          context2.globalAlpha = (li === 1 ? .13 : .09) + (li === 1 ? .15 : .09) * fade;
          context2.beginPath();
          context2.moveTo(startX, startY + off);
          context2.bezierCurveTo(c1x, midY + off, c2x, midY, endX, endY);
          context2.stroke();
        }
        /* 送货：三条道各走一颗自己的颜色，相隔三分之一个周期 —— 一直送，
           不跟着滚轮停在半路，所以停在正文里也看得见场在动（同一个 `time`）。 */
        var cycle = 3.4;
        for (var d = 0; d < lanes.length; d++) {
          var tt = (time / cycle + d / 3) % 1, u = 1 - tt, laneOff = lanes[d][0];
          var bx = u*u*u*startX + 3*u*u*tt*c1x + 3*u*tt*tt*c2x + tt*tt*tt*endX;
          var by = u*u*u*(startY + laneOff) + 3*u*u*tt*(midY + laneOff) + 3*u*tt*tt*midY + tt*tt*tt*endY;
          /* 两头各淡一点，免得光点凭空出现在雕塑里、又凭空消失在站上 */
          var life = Math.min(1, tt * 5) * Math.min(1, (1 - tt) * 5) * fade;
          if (life > .02) {
            /* 芯用自己那条道的颜色：读者能看出这三颗分别是信号 / 轨迹 / 策略 */
            flowDot(context2, bx, by, 7, pathColor(d), .13 * life);
            flowDot(context2, bx, by, 2.4, pathColor(d), .9 * life);
            flowDot(context2, bx, by, 1, colors.text, .75 * life);
          }
        }
        /* 抵达：三分之一周期一次，正好对上每一颗粒子到头的那一瞬 */
        var pa = (time / cycle * 3) % 1;
        context2.globalAlpha = (1 - pa) * .26 * fade;
        context2.strokeStyle = pathColor(Math.floor(time / cycle * 3) % 3); context2.lineWidth = 1;
        context2.beginPath(); context2.arc(endX, endY, 4.6 + pa * 15, 0, TAU); context2.stroke();
      }
    }
    context2.globalAlpha = 1;
  }


  function ease(v, target, rate, dt) { return dt ? target + (v - target) * Math.exp(-rate * dt) : v; }
  function staticMode() { return paused || reduce.matches || root.getAttribute('data-motion') === 'off'; }
  function unavailable() { return staticMode() || document.hidden || (!visible && !flowVisible); }
  function palette() {
    var style = getComputedStyle(root);
    function color(name, fallback) { return style.getPropertyValue(name).trim() || fallback; }
    colors = {
      accent: color('--accent', '#67d6d1'), warm: color('--accent-2', '#e8b67c'),
      text: color('--text', '#e4edf5'), muted: color('--text-3', '#8291a5'),
      bg: color('--bg', '#101723'), light: root.getAttribute('data-mode') === 'light'
    };
    // A restrained pool of light behind the sculpture; never rebuilt per frame.
    glow = document.createElement('canvas'); glow.width = glow.height = 192;
    var paint = glow.getContext('2d');
    if (paint) {
      var gradient = paint.createRadialGradient(96, 96, 0, 96, 96, 96);
      gradient.addColorStop(0, colors.accent); gradient.addColorStop(1, 'transparent');
      paint.fillStyle = gradient; paint.fillRect(0, 0, 192, 192);
    }
  }
  function resize() {
    bounds = stage.getBoundingClientRect();
    compact = root.getAttribute('data-performance') === 'compact';
    var width = Math.max(1, Math.round(bounds.width)), height = Math.max(1, Math.round(bounds.height));
    var ratio = Math.min(compact ? 1.25 : 2, window.devicePixelRatio || 1);
    var nextSegments = compact ? 96 : 144;
    if (width === W && height === H && ratio === DPR && segments === nextSegments) return;
    W = width; H = height; DPR = ratio;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    radius = Math.min(W * .335, H * .35); cx = W * .5; cy = H * .475;
    segments = nextSegments;
    paths.forEach(function (path) {
      path.length = 0;
      for (var i = 0; i <= segments; i++) path.push({x: 0, y: 0, z: 0});
    });
    ground.length = 0;
    for (var n = 0; n <= 80; n++) ground.push({x: 0, y: 0, z: 0});
    measureFlow();
    draw();
  }
  function project(x, y, z, out) {
    var cam = camera || neutralCamera;
    var yaw = -.48 + time * .065 + px * .24 + spin + yawShift + cam.turn;
    var pitch = .42 + py * .16, roll = -.12;
    var ax = x * Math.cos(yaw) + z * Math.sin(yaw);
    var az = -x * Math.sin(yaw) + z * Math.cos(yaw);
    var ay = y * Math.cos(pitch) - az * Math.sin(pitch);
    var depth = y * Math.sin(pitch) + az * Math.cos(pitch);
    var k = 4.8 / (4.8 + depth);
    var scale = (1 + deformation) * cam.scale;
    out.x = cx + cam.dx + (ax * Math.cos(roll) - ay * Math.sin(roll)) * radius * k * scale;
    out.y = cy + cam.dy - (ax * Math.sin(roll) + ay * Math.cos(roll)) * radius * k * scale;
    out.z = depth; return out;
  }
  var temp = {x: 0, y: 0, z: 0};
  function point(index, a, out) {
    var c = Math.cos(a), s = Math.sin(a), angle = [.10, 1.10, -.94][index];
    var mx = c * 1.12, my = s * .90 * Math.cos(angle), mz = s * .90 * Math.sin(angle);
    if (index === 2) { var old = mx; mx = mx * .84 - my * .53; my = old * .53 + my * .84; }
    var sx = c * 1.05, sy = (index - 1) * .49, sz = s * .68;
    var knot = a + index * TAU / 3, spread = 1 + (index - 1) * .09;
    var kx = (Math.sin(knot) + 2 * Math.sin(2 * knot)) / 2.65 * spread;
    var ky = (Math.cos(knot) - 2 * Math.cos(2 * knot)) / 2.65 * spread;
    var kz = -Math.sin(3 * knot) / 2.5;
    return project(sx * weights[0] + mx * weights[1] + kx * weights[2],
      sy * weights[0] + my * weights[1] + ky * weights[2],
      sz * weights[0] + mz * weights[1] + kz * weights[2], out);
  }
  function pathColor(index) { return index === 0 ? colors.warm : index === 1 ? colors.accent : colors.text; }
  function strokePath(points, color, alpha, width, side) {
    context.beginPath(); var started = false;
    for (var i = 0; i < points.length; i++) {
      var p = points[i], show = side === 0 || (side < 0 ? p.z >= 0 : p.z < 0);
      if (show) {
        if (!started) { var prev = points[Math.max(0, i - 1)]; context.moveTo(prev.x, prev.y); }
        context.lineTo(p.x, p.y); started = true;
      } else started = false;
    }
    context.strokeStyle = color; context.globalAlpha = alpha; context.lineWidth = width; context.stroke();
  }
  function dot(x, y, r, color, alpha) {
    context.globalAlpha = alpha; context.fillStyle = color;
    context.beginPath(); context.arc(x, y, r, 0, TAU); context.fill();
  }
  function drawGround() {
    // A perspective construction plane grounds the illustration without boxing it in.
    for (var i = 0; i <= 80; i++) {
      var a = i / 80 * TAU;
      project(Math.cos(a) * 1.30, -1.02, Math.sin(a) * .86, ground[i]);
    }
    strokePath(ground, colors.muted, colors.light ? .21 : .24, .7, 0);
    context.globalAlpha = .32; context.strokeStyle = colors.muted; context.lineWidth = .7;
    context.beginPath();
    for (var n = 0; n < 32; n++) {
      var t = n / 32 * TAU, p = project(Math.cos(t) * 1.30, -1.02, Math.sin(t) * .86, temp);
      var x = p.x, y = p.y;
      project(Math.cos(t) * (n % 4 ? 1.33 : 1.37), -1.02, Math.sin(t) * (n % 4 ? .88 : .91), temp);
      context.moveTo(x, y); context.lineTo(temp.x, temp.y);
    }
    context.stroke();
  }
  function drawCore() {
    var vertices = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    var p = vertices.map(function (v) { return project(v[0]*.20, v[1]*.20, v[2]*.20, {}); });
    context.lineWidth = 1; context.strokeStyle = colors.text;
    context.beginPath();
    for (var a = 0; a < 6; a++) for (var b = a + 1; b < 6; b++) {
      if (Math.floor(a / 2) === Math.floor(b / 2)) continue;
      context.moveTo(p[a].x, p[a].y); context.lineTo(p[b].x, p[b].y);
    }
    context.globalAlpha = .46; context.stroke();
    var center = project(0, 0, 0, temp);
    dot(center.x, center.y, 5.4, colors.accent, .13);
    dot(center.x, center.y, 2.2, colors.text, .95);
  }
  function drawTraveller(index, a, front) {
    point(index, a, temp); if ((temp.z < 0) !== front) return;
    var color = pathColor(index), opacity = front ? 1 : .48;
    // Small comet-like strokes convey direction, not random flickering particles.
    context.beginPath();
    for (var j = 0; j <= 18; j++) {
      point(index, a - .52 + j / 18 * .52, temp);
      if (j === 0) context.moveTo(temp.x, temp.y); else context.lineTo(temp.x, temp.y);
    }
    context.strokeStyle = color; context.lineWidth = front ? 1.8 : 1.1;
    context.globalAlpha = opacity * .68; context.stroke();
    point(index, a, temp);
    dot(temp.x, temp.y, front ? 8 : 5, color, .09);
    dot(temp.x, temp.y, front ? 3.3 : 2.4, color, opacity);
    dot(temp.x, temp.y, 1, colors.bg, .9);
  }
  /* 首屏开始离开时的「让位」。读者的滚轮一动，雕塑就做四件事，全部由同一个
     `leave` 进度线性给出（跟着滚轮走，不加第二个时钟、不做时间阻尼）：
       转  偏航再转 -0.5rad，像是侧过身去让出门口；
       收  半径收到 93%，从「就在眼前」退成「在门那边」；
       移  往左下挪 14/10px —— 那边正是入口站和导轨的方向；
       退  标注（SIGNAL / MOTION / POLICY / 轴线）淡到 15%，仪表盘跟着雕塑一起退场。
     `leave` 用 stage 的**上沿**算，不用视口比例：首屏在屏幕里时 bounds.top>0，
     leave 恒等于 0，所以「顶上第一眼」在任何窗口高度下都不会被改动 ——
     用 vh 比例做阈值的话，窗口一高，scrollY=0 时就开始转了。 */
  function updateExit() {
    var vh = Math.max(320, window.innerHeight || 320);
    heroLeave = bounds ? clamp(-bounds.top / (vh * .42), 0, 1) : 0;
    heroCamera.turn = -heroLeave * .5;
    heroCamera.scale = 1 - heroLeave * .07;
    heroCamera.dx = -heroLeave * 14;
    heroCamera.dy = heroLeave * 10;
  }
  function drawAnnotations() {
    context.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textBaseline = 'middle'; context.fillStyle = colors.muted;
    var labels = ['SIGNAL', 'MOTION', 'POLICY'];
    var positions = [[.09,.23], [.82,.36], [.14,.76]];
    var life = 1 - heroLeave * .85;
    context.globalAlpha = .72 * life;
    for (var i = 0; i < 3; i++) {
      var x = W * positions[i][0], y = H * positions[i][1];
      context.textAlign = i === 1 ? 'right' : 'left'; context.fillStyle = i === modes.indexOf(mode) ? pathColor(i) : colors.muted;
      context.fillText(labels[i], x, y);
      context.strokeStyle = context.fillStyle; context.lineWidth = .65;
      var direction = i === 1 ? -1 : 1;
      context.beginPath(); context.moveTo(x, y + 11); context.lineTo(x + direction * 24, y + 11);
      context.lineTo(x + direction * 34, y + 20); context.stroke();
    }
    context.textAlign = 'center'; context.fillStyle = colors.muted; context.globalAlpha = .55 * life;
    context.fillText('x', W*.80, H*.79); context.fillText('y', W*.23, H*.86);
  }
  function drawStage() {
    if (!W || !H) return; draws++;
    updateExit(); camera = heroCamera;
    context.setTransform(DPR, 0, 0, DPR, 0, 0); context.clearRect(0, 0, W, H);
    context.lineCap = 'round'; context.lineJoin = 'round';
    if (glow) { context.globalAlpha = (colors.light ? .045 : .085) * (1 - heroLeave * .5); context.drawImage(glow, cx-radius*1.5, cy-radius*1.5, radius*3, radius*3); }
    drawGround();
    paths.forEach(function (path, index) {
      for (var i = 0; i <= segments; i++) point(index, i / segments * TAU, path[i]);
      strokePath(path, pathColor(index), colors.light ? .28 : .29, .85, -1);
      drawTraveller(index, time * (.23 + index * .045) + index * 2.0 + .5 + heroLeave * .9, false);
    });
    drawCore();
    paths.forEach(function (path, index) {
      strokePath(path, pathColor(index), index === 2 ? .55 : .78, index === 2 ? .85 : 1.05, 1);
      drawTraveller(index, time * (.23 + index * .045) + index * 2.0 + .5 + heroLeave * .9, true);
      // Fixed witness marks make the topology visible even when motion is disabled.
      for (var n = 0; n < 4; n++) {
        point(index, n * TAU / 4 + .30, temp); dot(temp.x, temp.y, 1.45, pathColor(index), temp.z < 0 ? .72 : .27);
      }
    });
    if (interaction.kind === 'pulse' && interaction.strength > .001) {
      context.beginPath(); context.ellipse(cx, cy, radius*(.28+interaction.age*.72), radius*(.14+interaction.age*.35), -.18, 0, TAU);
      context.strokeStyle = colors.accent; context.lineWidth = 1; context.globalAlpha = interaction.strength * .45; context.stroke();
    }
    drawAnnotations(); context.globalAlpha = 1;
  }
  /* 一帧里两处都画：舞台（hero 在屏内时）+ 正文里的场 */
  function draw() {
    if (visible) drawStage();
    drawFlow();
  }
  function updateControls() {
    buttons.forEach(function (button) { button.setAttribute('aria-pressed', String(button.getAttribute('data-orbit-mode') === mode)); });
    if (pauseButton) {
      pauseButton.setAttribute('aria-pressed', String(paused));
      pauseButton.textContent = paused ? '继续' : '暂停';
      pauseButton.disabled = reduce.matches || root.getAttribute('data-motion') === 'off';
    }
    if (status) status.textContent = reduce.matches || root.getAttribute('data-motion') === 'off'
      ? '静态观览 · 可切换不同轨道形态' : paused ? '时间停驻 · 点击继续恢复运动' : descriptions[modes.indexOf(mode)];
  }
  function release(allowTap) {
    if (allowTap && interaction.held && interaction.strength < .06) {
      interaction.tap = true; interaction.age = 0;
    }
    interaction.held = false;
    if (pointer !== null && stage.releasePointerCapture) {
      try { if (!stage.hasPointerCapture || stage.hasPointerCapture(pointer)) stage.releasePointerCapture(pointer); } catch (ignore) {}
    }
    pointer = null;
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = null; }
  function sync() {
    if (unavailable()) { release(); pendingPointer = null; stop(); }
    else if (!raf) { last = null; raf = requestAnimationFrame(frame); }
    updateControls();
  }
  function frame(now) {
    raf = 0; if (unavailable()) { stop(); return; }
    var raw = last === null ? 0 : (now - last) / 1000, dt = clamp(raw, 0, .05); last = now;
    if (pendingPointer) {
      var e = pendingPointer; pendingPointer = null;
      tx = clamp((e.clientX - bounds.left) / W * 2 - 1, -1, 1);
      ty = clamp((e.clientY - bounds.top) / H * 2 - 1, -1, 1);
      if (pointer !== null && !e.buttons) release(true);
    }
    px = ease(px, tx, 5, dt); py = ease(py, ty, 5, dt); spin = ease(spin, targetSpin, 4, dt);
    leanX = ease(leanX, leanTX, 3, dt); leanY = ease(leanY, leanTY, 3, dt);
    time += dt;
    weights.forEach(function (w, i) { weights[i] = ease(w, modes[i] === mode ? 1 : 0, 4, dt); });
    interaction.age += dt;
    var target = interaction.held ? 1 : 0;
    if (!interaction.held && interaction.tap) target = Math.pow(Math.sin(Math.PI * clamp(interaction.age / .65, 0, 1)), 2);
    if (interaction.kind === 'pulse') target = Math.pow(Math.sin(Math.PI * clamp(interaction.age / 1.5, 0, 1)), 2);
    interaction.strength = ease(interaction.strength, target, interaction.held ? 6 : 4, dt);
    var shapeTarget = interaction.strength * (interaction.kind === 'attract' ? -.19 : interaction.kind === 'spread' ? .12 : interaction.kind === 'pulse' ? .04 : 0);
    deformation = ease(deformation, shapeTarget, 8, dt);
    if (!interaction.held && interaction.strength < .0001 && interaction.age > 1.5) {
      interaction.kind = 'idle'; interaction.strength = 0; interaction.tap = false;
    }
    var start = debug ? performance.now() : 0; draw();
    if (metrics && raw > 0) {
      costs.push(performance.now() - start); intervals.push(raw);
      if (costs.length > 180) { costs.shift(); intervals.shift(); }
      if (now - metricAt > 700) {
        metricAt = now; var sorted = costs.slice().sort(function(a,b){return a-b;});
        metrics.textContent = '轨道绘制 P95 ' + sorted[Math.floor(sorted.length*.95)].toFixed(2) + ' ms · ' + segments*3 + ' 曲线段';
      }
    }
    raf = requestAnimationFrame(frame);
  }
  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var selected = button.getAttribute('data-orbit-mode'); if (modes.indexOf(selected) < 0) return;
      mode = selected;
      if (unavailable()) weights = modes.map(function (name) { return name === mode ? 1 : 0; });
      updateControls(); if (unavailable()) draw(); else sync();
    });
  });
  if (pauseButton) pauseButton.addEventListener('click', function () { paused = !paused; sync(); });
  function mouse(e) { return !e.pointerType || e.pointerType === 'mouse'; }
  function actionable(e) { return mouse(e) && !unavailable() && !(e.target && e.target.closest && e.target.closest(ignored)); }
  stage.addEventListener('pointerdown', function (e) {
    if (!actionable(e) || e.button < 0 || e.button > 2 || (e.button === 2 && e.shiftKey)) return;
    bounds = stage.getBoundingClientRect();
    release(); interaction.kind = ['attract','pulse','spread'][e.button]; interaction.age = 0; interaction.tap = false;
    interaction.held = e.button !== 1; targetSpin += e.button === 1 ? .30 : 0;
    if (interaction.held) { pointer = e.pointerId; if (stage.setPointerCapture) { try { stage.setPointerCapture(pointer); } catch (ignore) {} } }
    e.preventDefault();
  });
  stage.addEventListener('pointermove', function (e) { if (actionable(e)) pendingPointer = e; }, {passive:true});
  stage.addEventListener('pointerenter', function () { bounds = stage.getBoundingClientRect(); });
  stage.addEventListener('pointerleave', function () { tx = ty = 0; release(); });
  ['pointerup','pointercancel'].forEach(function (name) { window.addEventListener(name, function (e) { if (pointer !== null && e.pointerId === pointer) release(name === 'pointerup'); }); });
  stage.addEventListener('lostpointercapture', function () { interaction.held = false; pointer = null; });
  ['mousedown','auxclick'].forEach(function (name) { stage.addEventListener(name, function(e) { if(e.button === 1 && actionable(e)) e.preventDefault(); }); });
  stage.addEventListener('contextmenu', function(e) { if(!e.shiftKey && actionable(e)) e.preventDefault(); });
  window.addEventListener('blur', function() { release(); tx=ty=0; pendingPointer=null; });
  window.addEventListener('resize', resize, {passive:true});
  window.addEventListener('scroll', function () { bounds = stage.getBoundingClientRect(); }, {passive:true});
  window.addEventListener('resize', measureFlow, {passive:true});
  /* 正文里的场跟着鼠标偏：只在首屏整块滚出视口之后接管目标值，
     首屏还在屏幕上时这一对变量保持不动（雕塑的视角仍然只由 stage 自己给）。 */
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (!bounds || bounds.bottom > 0 || staticMode()) { leanTX = leanTY = 0; return; }
    leanTX = clamp(e.clientX / flowW * 2 - 1, -1, 1);
    leanTY = clamp(e.clientY / flowH * 2 - 1, -1, 1);
  }, {passive:true});
  document.addEventListener('visibilitychange', sync);
  if (reduce.addEventListener) reduce.addEventListener('change', sync);
  if (window.IntersectionObserver) new IntersectionObserver(function(entries) { visible = entries[0].isIntersecting; sync(); }).observe(stage);
  var flowHost = document.querySelector('.home-flow');
  if (flowHost && window.IntersectionObserver) {
    new IntersectionObserver(function (entries) { flowVisible = entries[0].isIntersecting; sync(); }).observe(flowHost);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  if (window.MutationObserver) new MutationObserver(function(records) {
    if (records.some(function(r) {return r.attributeName !== 'data-motion';})) { palette(); resize(); draw(); }
    sync();
  }).observe(root, {attributes:true, attributeFilter:['data-theme','data-mode','data-motion','data-performance','style']});
  palette(); resize(); measureFlow(); stage.classList.add('is-ready'); if (controls) controls.hidden = false;
  if (debug) {
    metrics = document.createElement('output'); metrics.className = 'orbit-metrics'; metrics.id = 'orbit-motion-metrics';
    visual.appendChild(metrics);
  }
  window.__orbitField = {info:function() {return {
    running:!!raf, mode:mode, time:time, paused:paused, draws:draws, width:W, height:H,
    interaction:{kind:interaction.kind,strength:interaction.strength,held:interaction.held},
    quality:compact?'compact':'full', segments:segments, weights:weights.slice(), pointer:[px,py], deformation:deformation,
    flow:{visible:flowVisible, chapters:flowChapters.length, cards:flowCards.length,
          size:[flowW, flowH], drawn:!!flowCtx, lean:[leanX, leanY]},
    exit:{leave:heroLeave, turn:heroCamera.turn, scale:heroCamera.scale,
          dx:heroCamera.dx, dy:heroCamera.dy}
  };}};
  sync();
})();
