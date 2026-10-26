/* =========================================================================
   graph.js — 「知识图谱」三维书库
   卡片走真 CSS 3D（translate3d + rotateY），canvas 用同一套相机做投影，
   负责重雾、地面网格、浮尘和关系弧线。两边共用 project()，所以完全对齐。
   零依赖，只在这一页加载。

   相机约定（必须与 graph.css 的 perspective 一致）：
     #world  transform = translateZ(dist) rotateX(pitch) rotateY(yaw)
     投影    k = f / (f - z),  screen = center + (x, y) * k
   ========================================================================= */
(function () {
  'use strict';

  var stage = document.getElementById('graph-stage');
  if (!stage) return;
  function fallbackGraph() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; live = false;
    stage.classList.remove('is-initializing', 'is-live', 'is-ready');
    stage.classList.add('is-fallback');
    stage.style.perspective = '';
    var fallbackWorld = document.getElementById('graph-world');
    if (fallbackWorld) {
      fallbackWorld.style.transform = '';
      fallbackWorld.querySelectorAll('.gcard').forEach(function (el) {
        el.style.transform = ''; el.style.opacity = ''; el.style.visibility = '';
        el.style.pointerEvents = ''; el.tabIndex = 0; el.removeAttribute('aria-hidden');
      });
    }
    var fallbackHint = document.getElementById('graph-hint');
    if (fallbackHint) fallbackHint.textContent = '当前以书目列表显示，点击即可阅读';
    ['graph-layout', 'graph-auto', 'graph-reset', 'graph-zoom-in', 'graph-zoom-out', 'graph-kind', 'graph-clear', 'graph-q', 'graph-legend'].forEach(function (id) {
      var control = document.getElementById(id);
      if (!control) return;
      if (control.tagName === 'BUTTON' || control.tagName === 'INPUT') control.disabled = true;
      else control.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
    });
    var fallbackResults = document.getElementById('graph-results');
    if (fallbackResults) fallbackResults.open = true;
    if (window.__boot) window.__boot.done('graph');
  }
  if (!(window.CSS && CSS.supports && CSS.supports('transform-style', 'preserve-3d'))) {
    fallbackGraph();
    return;
  }

  var world = document.getElementById('graph-world');
  var canvas = document.getElementById('graph-canvas');
  var linkCanvas = document.getElementById('graph-links');
  var labelBox = document.getElementById('graph-labels');
  var statusEl = document.getElementById('graph-status');
  var hintEl = document.getElementById('graph-hint');
  var qEl = document.getElementById('graph-q');
  var autoBtn = document.getElementById('graph-auto');
  var resetBtn = document.getElementById('graph-reset');
  var layoutBox = document.getElementById('graph-layout');
  var legendBox = document.getElementById('graph-legend');
  var kindBox = document.getElementById('graph-kind');
  var clearBtn = document.getElementById('graph-clear');
  var zoomIn = document.getElementById('graph-zoom-in');
  var zoomOut = document.getElementById('graph-zoom-out');
  var zoomLabel = document.getElementById('graph-zoom-label');
  var resultsBox = document.getElementById('graph-results');
  var resultCount = document.getElementById('graph-result-count');
  var emptyEl = document.getElementById('graph-empty');
  var resultEls = [].slice.call(document.querySelectorAll('.graph-result[data-idx]'));
  var detail = document.getElementById('graph-detail');
  var detailKind = document.getElementById('graph-detail-kind');
  var detailTitle = document.getElementById('graph-detail-title');
  var detailSummary = document.getElementById('graph-detail-summary');
  var detailTags = document.getElementById('graph-detail-tags');
  var detailLink = document.getElementById('graph-detail-link');
  var detailRelated = document.getElementById('graph-detail-related');
  var ctx = null, lctx = null;
  try { ctx = canvas && canvas.getContext('2d'); lctx = linkCanvas ? linkCanvas.getContext('2d') : ctx; } catch (error) { /* The static book list remains usable. */ }
  var root = document.documentElement;
  if (!ctx || !lctx) {
    fallbackGraph();
    return;
  }

  var BASE_F = 1500;          /* 与 graph.css 的 perspective 初值一致 */
  var R = 900;                /* 书架半径 */
  /* 书是**竖版**的切向面板（250x330，接近真实书封比例）。
     宽度 + 间隙 决定一层最多放几本，高度决定层间距。
     这三个值会按真实 DOM 尺寸覆盖（移动端书会小一号）。 */
  var CARD_W = 250, CARD_H = 330, CARD_GAP = 34;
  var ROW_GAP = CARD_H + 28;
  /* 半径越大，同样角度对应的弧越长，书架在屏幕上就越宽。
     470 的时候整面墙只占舞台宽度的 45%，显得缩在中间；900 能铺到七成以上。 */
  /* 星云：同样靠 dist 推远 */
  var NEB_R = 560, NEB_DIST = -780, NEB_SQUASH = 0.66;
  var FLOOR_Y = 620, FLOOR_HALF = 1700, FLOOR_STEP = 150;
  var PITCH_MAX = 0.72;
  var compact = root.getAttribute('data-performance') === 'compact';
  var DUST = 85;
  var TAU = Math.PI * 2;
  var HINT = '拖空白处转动 · 拖书本抽出 · Shift + 滚轮缩放';

  var state = { layout: 'shelf' };
  var shelfRows = [];         /* [{items[], y}] —— 一层书架一行 */
  var shelfHeight = 900;      /* 整面书架墙的世界高度，用来算相机距离 */
  var cards = [], links = [], tagList = [], dust = [];
  var hover = null, selected = null, focusTag = null, query = '', kind = 'all';
  var autoPref = false, dragging = false, dragDist = 0, lastX = 0, lastY = 0, idle = 0;
  var dragId = null, captured = false;
  var touchPending = false, touchDrag = false, pointerOriginX = 0, pointerOriginY = 0;
  var suppressClickUntil = 0;
  var DRAG_MIN = 6;           /* 超过这个位移才算拖拽，否则当点击 */
  /* 「把书抽出来」的弹簧参数：ζ≈0.55 的欠阻尼，松手后 0.7s 左右归位，
     收尾带一次很轻的回弹 —— 像真书被推回架上 */
  var PULL_K = 105, PULL_D = 11.2;
  var grabbing = null;        /* 正在被抽出来的那本书 */
  var grabVX = 0, grabVY = 0; /* 松手瞬间的指针速度（像素/秒），用来「甩」一下 */
  var grabOriginX = 0, grabOriginY = 0;   /* 按下时的指针位置，抽取位移的基准 */
  var grabT = 0;              /* 上一次 pointermove 的时间戳，用来把位移换算成速度 */
  var PULL_VMAX = 6000;       /* 手速上限（像素/秒），防止甩出天际 */
  var raf = 0, lastT = null, W = 0, H = 0, DPR = 1, live = false, cachedPersp = '', cachedWorldT = '';
  var cameraDirty = true, layoutDirty = true, draws = 0, skyGradient = null, linkPhase = 0;
  var worldDY = 0;            /* 书架整体的竖直补偿（世界单位） */
  var CX = 0, CY = 0;         /* 投影中心（canvas 内坐标，带小数） */
  var C = null;
  var view = { yaw: 0.0, pitch: -0.04, zoom: 1 };
  var goal = { yaw: 0.0, pitch: -0.04, zoom: 1 };
  var pal = {};

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var inViewport = true, lastPaint = null;
  function motionAllowed() { return !reduce.matches && root.getAttribute('data-motion') !== 'off'; }
  function wake() {
    if (!raf && live && inViewport && !document.hidden) {
      lastT = performance.now(); raf = requestAnimationFrame(frame);
    }
  }
  function follow(value, target, rate, dt, epsilon) {
    var next = motionAllowed() ? value + (target - value) * (1 - Math.exp(-rate * dt)) : target;
    return Math.abs(next - target) < epsilon ? target : next;
  }

  /* ---------------- 颜色 ---------------- */

  function toRgb(c) {
    if (!c) return null;
    c = String(c).trim();
    var m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var m2 = c.match(/^rgba?\(([^)]+)\)$/i);
    if (m2) {
      var p = m2[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 3) return [p[0], p[1], p[2]];
    }
    return null;
  }

  function rgba(rgb, a) {
    var r = rgb || [140, 160, 200];
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + a.toFixed(3) + ')';
  }

  function readPalette() {
    var cs = getComputedStyle(root);
    function g(n, f) { return (cs.getPropertyValue(n) || '').trim() || f; }
    pal.bg = toRgb(g('--bg', '#0b0d14'));
    pal.accent = toRgb(g('--accent', '#7aa2ff'));
    pal.accent2 = toRgb(g('--accent-2', '#ff9d5c'));
    pal.text = toRgb(g('--text-3', '#8b93a7'));
    pal.surface = toRgb(g('--surface-2', '#1a1f2b'));
    /* 阴影色：暗色下用底色（比黑更贴环境），亮色下必须换成文字色 ——
       亮色底上再压一层浅色等于没压，接触阴影会整条消失。 */
    var bright = (pal.bg[0] * 0.299 + pal.bg[1] * 0.587 + pal.bg[2] * 0.114) > 128;
    pal.shadow = bright ? pal.text : pal.bg;
    skyGradient = null;
  }

  /* 同排相邻两本书的角步长 */
  function rowStep() { return (CARD_W + CARD_GAP) / R; }

  /* ---------------- 相机 ---------------- */

  function makeCam() {
    var neb = state.layout === 'nebula';
    var f = BASE_F;
    var dist;
    var cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    if (neb) {
      /* Billboard corners are camera-facing: each corner shares its centre's
         depth, so fit both axes analytically. Include hover scale, then leave
         a little stage margin. A fixed distance clips books on short screens.
         Explicit zoom still moves closer and may intentionally crop the view. */
      var cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw);
      var halfWidth = Math.max(1, Math.min(CX, W - CX) * .92);
      var halfHeight = Math.max(1, Math.min(CY, H - CY) * .88);
      var halfBookWidth = CARD_W * 1.07 / 2, halfBookHeight = CARD_H * 1.07 / 2;
      var fitted = NEB_DIST;
      for (var ni = 0; ni < cards.length; ni++) {
        var np = cards[ni].pos;
        var nx = np.x * cyw + np.z * syw;
        var nz = -np.x * syw + np.z * cyw;
        var ny = np.y * cp - nz * sp;
        var depth = np.y * sp + nz * cp;
        var extentRatio = Math.max((Math.abs(nx) + halfBookWidth) / halfWidth,
          (Math.abs(ny) + halfBookHeight) / halfHeight);
        fitted = Math.min(fitted, f - depth - f * extentRatio);
      }
      dist = fitted / view.zoom;
      worldDY = 0;
    } else {
      /* 书架：二分拟合整墙的真实投影边界，预留舞台边距。
         为什么不用解析式：书是绕竖直轴转过的矩形，透视之后投影是个梯形，
         它的外接高度比 `书高 × k` 大，而且上下不对称 —— 拿中心 ± 半高去估，
         居中和缩放都会差二十来个像素，底下一层就被舞台下沿切掉了。
         所以直接取每本书的四个角投影，按真实外接框来拟合。

         仅在镜头或布局变化时重新拟合；静止时复用缓存。 */
      var target = H * 0.84;
      var lo = -3600, hi = -80;
      // Small screens and large libraries can need a farther distance than
      // the old -3600 bound. Expand only when the camera fit is invalidated.
      for (var expand = 0; expand < 12; expand++) {
        var farExtent = shelfExtent(lo, f, cp, sp, 0);
        if (farExtent.bot - farExtent.top <= target &&
            Math.max(Math.abs(farExtent.left), Math.abs(farExtent.right)) * 2 <= W * .92) break;
        lo *= 2;
      }
      for (var it = 0; it < 18; it++) {
        var mid = (lo + hi) / 2;
        var e0 = shelfExtent(mid, f, cp, sp, 0);
        /* ext 随 dist 单调递增（镜头越近，墙越大）：
           太大说明 mid 太近，答案在左半边 */
        if (e0.bot - e0.top > target || Math.max(Math.abs(e0.left), Math.abs(e0.right)) * 2 > W * 0.92) hi = mid; else lo = mid;
      }
      dist = ((lo + hi) / 2) / view.zoom;

      /* 竖直居中：俯仰角会把整墙整体推下去，给书架加一个竖直补偿 dy。
         **不能**靠挪 perspective-origin 来抵消 —— 透视原点是投影的**不动点**，
         挪它等于把内容按 k 缩放地推，而不是整体平移：
         实测挪 25px 只让内容动了 13px，而且和我 canvas 上的投影直接对不上。
         加在 #world 的 transform 上（translateY(dy)）才是真正的世界平移。
         dy 作用在透视之前，屏幕上是 dy·k，所以要迭代几次才收敛。 */
      var kRef = scaleAt(0, R, dist, f, cp, sp);
      var dy = 0;
      for (var it2 = 0; it2 < 4; it2++) {
        var e1 = shelfExtent(dist, f, cp, sp, dy);
        var ctr = (e1.top + e1.bot) / 2;
        if (Math.abs(ctr) < 0.4) break;
        dy -= ctr / kRef;
      }
      worldDY = dy;
    }
    var mid = f - dist;                 /* 世界原点到镜头的距离 */
    return {
      cy: Math.cos(view.yaw), sy: Math.sin(view.yaw),
      cp: cp, sp: sp,
      f: f, dist: dist, neb: neb,
      /* 雾的起止距离：两种布局的景深差一个量级，必须各算各的 */
      near: mid - (neb ? NEB_R * 1.25 : R * 0.55),
      far: mid + (neb ? NEB_R * 1.05 : R * 1.15),
      cx: CX, cyy: CY, dy: neb ? 0 : worldDY,
      /* 相机的右/上/前基向量（世界坐标）。
         把「指针在屏幕上移动了多少像素」换算成「卡片在世界里该移动多少」时要用：
         屏幕位移 ÷ 透视缩放，再投到这三个基上。 */
      right: { x: Math.cos(view.yaw), y: 0, z: Math.sin(view.yaw) },
      up: {
        x: -Math.sin(view.pitch) * Math.sin(view.yaw),
        y: Math.cos(view.pitch),
        z: -Math.sin(view.pitch) * Math.cos(view.yaw)
      },
      fwd: {
        x: Math.cos(view.pitch) * Math.sin(view.yaw),
        y: -Math.sin(view.pitch),
        z: -Math.cos(view.pitch) * Math.cos(view.yaw)
      }
    };
  }

  /* 整面书架墙在当前镜头距离下的投影外接框（相对投影中心）。
     取每本书的四个角逐个投影 —— 绕竖直轴转过的书投影是梯形，
     只用中心 ± 半高会低估，居中与缩放都会偏。
     dy 是书架整体的竖直补偿（见 makeCam）。 */
  function shelfExtent(dist, f, cp, sp, dy) {
    var cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw);
    var hw = CARD_W / 2, hh = CARD_H / 2;
    var top = Infinity, bot = -Infinity, left = Infinity, right = -Infinity;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], q = c.pos;
      var cr = Math.cos(c.rotY), sr = Math.sin(c.rotY);
      for (var k = 0; k < 4; k++) {
        var lx = (k & 1) ? hw : -hw;
        var ly = (k & 2) ? hh : -hh;
        var wx = q.x + lx * cr;
        var wy = q.y + ly;
        var wz = q.z - lx * sr;
        var Z = -wx * syw + wz * cyw;
        var kk = f / (f - (wy * sp + Z * cp + dist));
        var yy = (wy * cp - Z * sp + dy) * kk;
        var xx = (wx * cyw + wz * syw) * kk;
        left = Math.min(left, xx); right = Math.max(right, xx);
        if (yy < top) top = yy;
        if (yy > bot) bot = yy;
      }
    }
    return { top: top, bot: bot, left: left, right: right };
  }

  /* dy 之后的屏幕竖直偏移量：竖屏里 dy 作用在**透视之前**，
     所以屏幕上是 dy·k 而不是 dy。 */
  function scaleAt(y, Z, dist, f, cp, sp) {
    return f / (f - (y * sp + Z * cp + dist));
  }

  function project(x, y, z, c, dy) {
    var X = x * c.cy + z * c.sy;
    var Z = -x * c.sy + z * c.cy;
    /* dy 加在旋转**之后**、透视之前 —— 对应 CSS 里 #world 的 translateY(dy)。
       加在旋转之前的话会被 rotateX 混到 z 上去，和浏览器算的对不上。 */
    var Y2 = y * c.cp - Z * c.sp + (dy || 0);
    var Z2 = y * c.sp + Z * c.cp + c.dist;
    var k = c.f / (c.f - Z2);
    return { x: c.cx + X * k, y: c.cyy + Y2 * k, z: Z2, k: k };
  }

  /* 0 = 贴近镜头（清晰），1 = 完全化进雾里 */
  function fog(z, c) {
    var d = c.f - z;                    /* 到镜头的距离 */
    var t = (d - c.near) / (c.far - c.near || 1);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /* 相机在世界坐标里的位置（书架是相机在柱体外面） */
  function camLocal(c) {
    var h = c.f - c.dist;
    var cp = Math.cos(view.pitch);
    return {
      x: -Math.sin(view.yaw) * cp * h,
      y: Math.sin(view.pitch) * h,
      z: Math.cos(view.yaw) * cp * h
    };
  }

  /* ---------------- 布局 ---------------- */

  /* 一排最多放几本？
     同一排相邻卡片是贴在圆柱面上的两块**切向面板**，弧长间距 R·Δ 只要
     ≥ 卡片宽度 + 间隙，两块板在曲面上就不相交（透视是连续映射，
     同排相邻的投影也不会重叠）。所以每排上限 = floor(π/Δ) + 1，
     即卡片再宽也不能超过半圈。 */
  function colsMax() {
    var d = (CARD_W + CARD_GAP) / R;
    var arcLimit = Math.max(1, Math.floor(Math.PI / d) + 1);
    return Math.min(arcLimit, W <= 700 ? 4 : W <= 1000 ? 6 : arcLimit);
  }

  function layoutShelf() {
    var flat = [], i;
    var byYear = {};
    for (i = 0; i < cards.length; i++) {
      var y = cards[i].node.year || '—';
      (byYear[y] = byYear[y] || []).push(cards[i]);
    }
    /* 层内先按年份（新→旧），年内按主标签，同标签的挨在一起 */
    var years = Object.keys(byYear).sort().reverse();
    for (var r = 0; r < years.length; r++) {
      var list = byYear[years[r]];
      list.sort(function (a, b) {
        var ka = a.node.tags[0] || '', kb = b.node.tags[0] || '';
        if (ka !== kb) return ka < kb ? -1 : 1;
        return a.node.date < b.node.date ? 1 : -1;
      });
      flat = flat.concat(list);
    }

    /* 一层放不下就往下再开一层，真书架就是这么干的。
       注意这里是**按顺序整段分层**，不再按年份各自成层：
       竖版书高得多，再按年份分（2026 / 2025 / 2023 三层）会把整面墙撑得过高，
       镜头只能一退再退，书就小到看不清了。改成顺序流之后
       12 本正好两排各 6 本，每本还能保持 240x318 的尺寸。
       分层用**均分**而不是贪心：12 本上限 10 的话贪心会分成 10+2，均分 6+6 才像样。 */
    var maxCols = colsMax();
    var step = (CARD_W + CARD_GAP) / R;
    var nRows = Math.max(1, Math.ceil(flat.length / maxCols));
    var per = Math.ceil(flat.length / nRows);

    shelfRows = [];
    for (var s = 0; s < flat.length; s += per) {
      shelfRows.push({ items: flat.slice(s, s + per), y: 0 });
    }

    /* 竖向排布，整体居中 */
    var cursor = 0;
    for (var q = 0; q < shelfRows.length; q++) {
      if (q > 0) cursor += ROW_GAP;
      shelfRows[q].y = cursor;
    }
    var mid = cursor / 2;
    for (var m = 0; m < shelfRows.length; m++) shelfRows[m].y -= mid;
    shelfHeight = cursor + CARD_H;

    /* 横向：固定角度步长、整排居中。步长统一，看起来才像一层层码好的书，
       而不是每排都硬撑满整个弧。 */
    for (var a = 0; a < shelfRows.length; a++) {
      var row = shelfRows[a];
      var n = row.items.length;
      for (var k = 0; k < n; k++) {
        var c = row.items[k];
        var ang = (k - (n - 1) / 2) * step;
        c.pos = { x: R * Math.sin(ang), y: row.y, z: R * Math.cos(ang) };
        c.rotY = ang;
        c.normal = { x: Math.sin(ang), y: 0, z: Math.cos(ang) };
        c.billboard = false;
        c.hs = 1 + (c.cloth - 1) * .013;
      }
    }
  }

  /* 以主标签为引力中心聚成几团，散在球面上 */
  function layoutNebula() {
    var clusters = [], map = {}, i;
    for (i = 0; i < cards.length; i++) {
      var key = cards[i].node.tags[0] || '其他';
      if (!map[key]) { map[key] = { key: key, items: [] }; clusters.push(map[key]); }
      map[key].items.push(cards[i]);
    }
    clusters.sort(function (a, b) { return b.items.length - a.items.length; });
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var ci = 0; ci < clusters.length; ci++) {
      var cy0 = 1 - (ci + 0.5) * 2 / clusters.length;
      var rad = Math.sqrt(Math.max(0.0001, 1 - cy0 * cy0));
      var th = golden * ci + 0.6;
      var dir = { x: Math.cos(th) * rad, y: cy0, z: Math.sin(th) * rad };
      var items = clusters[ci].items;
      for (var j = 0; j < items.length; j++) {
        var a = (j / Math.max(1, items.length)) * TAU + ci * 1.7;
        var spread = 0.26 + 0.07 * (j % 3);
        var off = {
          x: dir.x * Math.cos(spread) + Math.sin(spread) * Math.cos(a) * dir.z,
          y: dir.y + Math.sin(spread) * Math.sin(a) * 0.8,
          z: dir.z * Math.cos(spread) - Math.sin(spread) * Math.cos(a) * dir.x
        };
        var L = Math.hypot(off.x, off.y, off.z) || 1;
        items[j].pos = {
          x: off.x / L * NEB_R,
          y: off.y / L * NEB_R * NEB_SQUASH,   /* 压扁一点，适配宽屏舞台 */
          z: off.z / L * NEB_R
        };
        items[j].rotY = 0;
        items[j].normal = { x: 0, y: 0, z: 1 };
        items[j].billboard = true;
        items[j].hs = 1;          /* 星云里书是悬浮的，没有「站在板上」这回事，高度统一 */
      }
    }
  }

  function relayout() {
    /* 用真实的 DOM 尺寸，移动端断点会把卡片改小，间距与镜头距离要跟着变 */
    if (cards.length && cards[0].el.offsetWidth) {
      CARD_W = cards[0].el.offsetWidth;
      CARD_H = cards[0].el.offsetHeight;
    }
    ROW_GAP = CARD_H + 28;
    if (state.layout === 'nebula') layoutNebula(); else layoutShelf();
    buildTagAnchors();
    cameraDirty = true; layoutDirty = false;
  }

  function buildTagAnchors() {
    var acc = {}, i, j;
    for (i = 0; i < cards.length; i++) {
      var c = cards[i];
      for (j = 0; j < c.node.tags.length; j++) {
        var t = c.node.tags[j];
        if (!acc[t]) acc[t] = { name: t, n: 0, x: 0, y: 0, z: 0, minY: Infinity };
        acc[t].n++;
        acc[t].x += c.pos.x; acc[t].y += c.pos.y; acc[t].z += c.pos.z;
        if (c.pos.y < acc[t].minY) acc[t].minY = c.pos.y;
      }
    }
    var out = [];
    for (var k in acc) {
      var a = acc[k];
      a.x /= a.n; a.y /= a.n; a.z /= a.n;
      if (state.layout === 'nebula') {
        /* 星云：往球外推，当星座名用 */
        var L = Math.hypot(a.x, a.y, a.z) || 1;
        var push = (NEB_R * 1.34) / L;
        a.x *= push; a.y *= push; a.z *= push;
      } else {
        /* 书架：浮在自己那一簇正前方一点点的位置，像挂在书架外侧的牌子 */
        var ang = Math.atan2(a.x, a.z);
        var rr = R * 1.2;
        a.x = rr * Math.sin(ang);
        a.z = rr * Math.cos(ang);
      }
      out.push(a);
    }
    out.sort(function (p, q) { return q.n - p.n; });
    tagList = out;
    syncTagLabels();
  }

  function syncTagLabels() {
    labelBox.textContent = '';
    for (var i = 0; i < tagList.length; i++) {
      if (tagList[i].n < 2) { tagList[i].el = null; continue; }
      var el = document.createElement('span');
      el.className = 'graph-label';
      el.textContent = tagList[i].name;
      var num = document.createElement('i');
      num.textContent = tagList[i].n;
      el.appendChild(num);
      el.style.display = 'none';
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      labelBox.appendChild(el);
      tagList[i].el = el;
    }
  }

  /* ---------------- 关系 ---------------- */

  function buildLinks() {
    links = [];
    var i, j, a, b;
    for (i = 0; i < cards.length; i++) {
      cards[i].links = [];
      cards[i].rel = {};
    }
    for (i = 0; i < cards.length; i++) {
      var sa = cards[i].node.tags;
      for (j = i + 1; j < cards.length; j++) {
        var sb = cards[j].node.tags, shared = 0;
        for (a = 0; a < sa.length; a++) {
          for (b = 0; b < sb.length; b++) if (sa[a] === sb[b]) shared++;
        }
        if (shared) {
          var L = { a: cards[i], b: cards[j], w: shared };
          links.push(L);
          L.a.links.push(L);
          L.b.links.push(L);
          L.a.rel[L.b.node.id] = true;
          L.b.rel[L.a.node.id] = true;
        }
      }
    }
  }

  /* ---------------- 状态判定 ---------------- */

  function isHot(c) { return hover === c || c.el === document.activeElement; }
  function isRel(c) { return !!(hover && hover.rel[c.node.id]); }
  function isMatch(c) {
    if (!query) return true;
    var q = query.toLowerCase();
    if (c.node.title.toLowerCase().indexOf(q) >= 0) return true;
    if ((c.node.summary || '').toLowerCase().indexOf(q) >= 0) return true;
    for (var i = 0; i < c.node.tags.length; i++) {
      if (c.node.tags[i].toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  }
  function inTag(c) { return !focusTag || c.node.tags.indexOf(focusTag) >= 0; }
  function matches(c) { return isMatch(c) && inTag(c) && (kind === 'all' || c.node.kind === kind); }
  function cruises() {
    return autoPref && !focusTag && !query && kind === 'all' && !hover && !dragging && !grabbing && motionAllowed();
  }

  /* ---------------- 主循环 ---------------- */

  function resize() {
    /* 投影中心必须取 canvas 自己 rect 的一半：
       - canvas 是 inset:0，尺寸等于「padding box」，而 #world 的 left/top:50% 也是相对它；
       - 舞台有 1px 边框，CSS 的 perspective-origin 却是相对 border box 的，
         直接用 clientWidth/2 会差一个边框宽度，弧线就会整体偏 1px。 */
    var r = canvas.getBoundingClientRect();
    var w = Math.max(280, Math.round(r.width));
    var h = Math.max(220, Math.round(r.height));
    // Canvas allocation and book layout have separate lifetimes. A preference
    // observer can resize the canvas before ResizeObserver delivers its entry;
    // only relayout may consume the pending geometry change.
    if (w !== W || h !== H) layoutDirty = true;
    if (cards.length) {
      var measuredWidth = cards[0].el.offsetWidth, measuredHeight = cards[0].el.offsetHeight;
      if (measuredWidth > 0 && measuredHeight > 0 &&
          (measuredWidth !== CARD_W || measuredHeight !== CARD_H)) layoutDirty = true;
    }
    if (CX !== r.width / 2 || CY !== r.height / 2) cameraDirty = true;
    CX = r.width / 2;
    CY = r.height / 2;
    var nextDPR = Math.min(compact ? 1 : 1.5, window.devicePixelRatio || 1);
    if (w === W && h === H && nextDPR === DPR) return false;
    W = w; H = h;
    DPR = nextDPR; cameraDirty = true; skyGradient = null;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (linkCanvas && linkCanvas !== canvas) {
      linkCanvas.width = Math.round(W * DPR);
      linkCanvas.height = Math.round(H * DPR);
      lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    return true;
  }

  function frame(t) {
    raf = 0;
    if (!inViewport || document.hidden) return;
    if (layoutDirty) relayout();
    var budget = compact ? 1000 / 30 : 0;
    if (lastPaint !== null && t - lastPaint < budget - 1) { raf = requestAnimationFrame(frame); return; }
    lastPaint = t;
    var dt = lastT === null ? 0 : Math.max(0, Math.min(0.05, (t - lastT) / 1000));
    lastT = t;

    if (cruises()) {
      idle += dt;
      if (idle > 1.2) goal.yaw += dt * 0.07;
    }

    var yaw = follow(view.yaw, goal.yaw, 8, dt, .00001);
    var pitch = follow(view.pitch, goal.pitch, 8, dt, .00001);
    var zoom = follow(view.zoom, goal.zoom, 8, dt, .00001);
    if (yaw !== view.yaw || pitch !== view.pitch || zoom !== view.zoom) cameraDirty = true;
    view.yaw = yaw; view.pitch = pitch; view.zoom = zoom;
    if (cameraDirty || !C) { C = makeCam(); cameraDirty = false; }

    var persp = C.f.toFixed(1) + 'px';
    if (persp !== cachedPersp) { stage.style.perspective = persp; cachedPersp = persp; }
    /* 竖直居中靠 #world 的 translateY(worldDY)，不靠挪 perspective-origin：
       透视原点是投影的**不动点**，挪它等于按 k 缩放地推，而不是整体平移。 */
    var wt = 'translateY(' + worldDY.toFixed(2) + 'px) translateZ(' + C.dist.toFixed(1) +
      'px) rotateX(' + view.pitch.toFixed(5) + 'rad) rotateY(' + view.yaw.toFixed(5) + 'rad)';
    if (wt !== cachedWorldT) { world.style.transform = wt; cachedWorldT = wt; }

    drawSky();
    drawFloor();
    drawShelves();
    drawDust(cruises() ? dt : 0);
    if (motionAllowed()) linkPhase += dt;
    stepSprings(dt);        /* 松手后的回位要在算位置之前推进 */
    drawLinks();
    var cardsMoving = placeCards(dt);
    placeLabels();
    paintHud();
    draws++;
    if (cruises() || cardsMoving || cards.some(function (c) { return !!c.pull && c !== grabbing; }) ||
        goal.yaw !== view.yaw || goal.pitch !== view.pitch || goal.zoom !== view.zoom) {
      raf = requestAnimationFrame(frame);
    } else { lastT = null; }
  }

  /* ---------------- 卡片 ---------------- */

  function placeCards(dt) {
    var cam = camLocal(C);
    var moving = false;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], p = c.pos;

      /* 被抽出来的书：位置 = 原位 + 抽取偏移（屏幕跟随 + 沿法线抬出书架） */
      var fx = p.x, fy = p.y, fz = p.z;
      var pulled = 0;
      if (c.pull) {
        var pl = Math.hypot(c.pull.x, c.pull.y, c.pull.z);
        pulled = Math.min(1, pl / 150);          /* 0~1：决定转正与放大多少 */
        fx += c.pull.x; fy += c.pull.y; fz += c.pull.z;
      }
      /* 高度差是绕中心缩放的，底边会被顶下去／拉上来；
         补回一半，底边就始终落在隔板线上，只有书顶高低不齐。 */
      var hs = c.hs || 1;
      if (hs !== 1) fy -= (hs - 1) * CARD_H / 2;

      var pr = project(fx, fy, fz, C, C.dy);

      var vis;
      if (c.billboard) {
        var L = Math.hypot(p.x, p.y, p.z) || 1;
        var CL = Math.hypot(cam.x, cam.y, cam.z) || 1;
        vis = (p.x * cam.x + p.y * cam.y + p.z * cam.z) / (L * CL);
      } else {
        var X = p.x * C.cy + p.z * C.sy;
        var Z = -p.x * C.sy + p.z * C.cy;
        var Y2 = p.y * C.cp - Z * C.sp;
        var Z2 = p.y * C.sp + Z * C.cp + C.dist;
        var nx = c.normal.x * C.cy + c.normal.z * C.sy;
        var nz = -c.normal.x * C.sy + c.normal.z * C.cy;
        var ny = -nz * C.sp;
        nz = nz * C.cp;
        var vx = -X, vy = -Y2, vz = C.f - Z2;
        var vl = Math.hypot(vx, vy, vz) || 1;
        vis = (nx * vx + ny * vy + nz * vz) / vl;
      }

      var face = (vis - 0.02) / 0.26;
      face = face < 0 ? 0 : face > 1 ? 1 : face;

      var f = fog(pr.z, C);
      /* 抽出来的书必须清楚：雾和「背对镜头」的淡出都不能作用在它身上，
         否则一抽出来就糊了。 */
      if (pulled > 0) { f *= (1 - pulled); face = Math.max(face, pulled); }
      var op = (1 - f * 0.86) * face;

      var hot = isHot(c), rel = isRel(c), match = isMatch(c), inside = inTag(c);
      var deemph = !matches(c);
      if (deemph) op *= 0.16;
      else if (query || focusTag || kind !== 'all') op = Math.min(1, op * 1.45);
      if (hover && !hot && !rel && !pulled) op *= 0.34;

      var targetScale = hot ? 1.07 : rel ? 1.025 : 1;
      c.sc = follow(c.sc, targetScale, 10, dt, .0001);
      moving = moving || c.sc !== targetScale;
      var sc = c.sc * (1 + 0.07 * pulled);

      var t = 'translate3d(' + fx.toFixed(2) + 'px,' + fy.toFixed(2) + 'px,' + fz.toFixed(2) + 'px)';
      if (c.billboard) {
        t += ' rotateY(' + (-view.yaw).toFixed(5) + 'rad) rotateX(' + (-view.pitch).toFixed(5) + 'rad)';
      } else if (pulled > 0.001) {
        /* 抽出来的过程中把书**转正对着你**：切向角 c.rotY 线性过渡到 -yaw
           （正对镜头时 rotY + yaw = 0），顺带补上俯仰，读起来才正面。 */
        var rot = c.rotY + (-view.yaw - c.rotY) * pulled;
        t += ' rotateY(' + rot.toFixed(5) + 'rad) rotateX(' + (-view.pitch * pulled).toFixed(5) + 'rad)';
      } else {
        t += ' rotateY(' + c.rotY.toFixed(5) + 'rad)';
      }
      if (Math.abs(sc - 1) > 0.001 || hs !== 1) {
        t += ' scale(' + sc.toFixed(4) + ',' + (sc * hs).toFixed(4) + ')';
      }
      if (c.t !== t) { c.el.style.transform = t; c.t = t; }

      var o = op.toFixed(3);
      if (c.o !== o) {
        c.el.style.opacity = o;
        c.el.style.visibility = op < 0.02 ? 'hidden' : '';
        c.o = o;
      }
      var cls = 'gcard gcl-' + c.cloth + (c.node.archived ? ' is-archived' : '') +
        (hot ? ' is-hot' : '') + (rel ? ' is-rel' : '') + (deemph ? ' is-dim' : '') +
        /* 阈值别用 0：弹簧收尾那半秒位移已经小于 1 世界单位、肉眼等于归位了，
           再挂着 is-pulled 的辉光就成了「书回去了、光圈还在」。 */
        (pulled > 0.02 ? ' is-pulled' : '');
      if (c.cls !== cls) { c.el.className = cls; c.cls = cls; }
      c.screen = pr;          /* 下一帧换算指针位移时要用它的透视缩放 */
    }
    return moving;
  }

  /* ---------------- 「把书抽出来」 ---------------- */

  /* 屏幕位移 -> 世界位移：除以该书的透视缩放，再投到相机的右/上基上。
     再沿书的法线（背离书架轴的方向）额外抬出一点，才有「从架上抽出来」的感觉。 */
  function applyPull(c, dx, dy) {
    if (!c || !c.screen) return;
    var inv = 1 / Math.max(0.25, c.screen.k);
    var wx = (C.right.x * dx + C.up.x * dy) * inv;
    var wy = (C.right.y * dx + C.up.y * dy) * inv;
    var wz = (C.right.z * dx + C.up.z * dy) * inv;
    var plan = Math.hypot(wx, wy, wz);
    var lift = Math.min(260, plan * 0.55 + 26);   /* 抽出来就给一点初始行程 */
    c.pull = {
      x: wx + c.normal.x * lift,
      y: wy + c.normal.y * lift,
      z: wz + c.normal.z * lift
    };
  }

  function releasePull(c, vx, vy) {
    if (!c) return;
    /* 把手速换算成世界初速度，甩一下书会飞出去一点再弹回来。
       单位要对齐：vx/vy 是**像素/秒**，乘上该书的透视缩放就是世界单位/秒，
       正好和 stepSprings 里 p += v*dt 的单位一致（差 60 倍就会出现「一松手就贴回去」）。 */
    var inv = 1 / Math.max(0.25, c.screen ? c.screen.k : 1);
    c.pv = {
      x: (C.right.x * vx + C.up.x * vy) * inv,
      y: (C.right.y * vx + C.up.y * vy) * inv,
      z: (C.right.z * vx + C.up.z * vy) * inv
    };
  }

  /* 松手之后每帧做一次弹簧回位（欠阻尼，收尾有一点回弹） */
  function stepSprings(dt) {
    if (dt <= 0) return;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!c.pull || c === grabbing) continue;
      if (!motionAllowed()) { c.pull = null; c.pv = null; continue; }
      var p = c.pull, v = c.pv || (c.pv = { x: 0, y: 0, z: 0 });
      // Exact damped-spring integration keeps release motion equal at 60/120 Hz.
      var damping = PULL_D / 2, omega = Math.sqrt(PULL_K - damping * damping);
      var decay = Math.exp(-damping * dt), cosine = Math.cos(omega * dt), sine = Math.sin(omega * dt);
      ['x', 'y', 'z'].forEach(function (axis) {
        var position = p[axis], velocity = v[axis];
        p[axis] = decay * (position * cosine + (velocity + damping * position) / omega * sine);
        v[axis] = decay * (velocity * cosine - (damping * velocity + PULL_K * position) / omega * sine);
      });
      if (Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) < 0.6 &&
          Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) < 0.4) {
        c.pull = null; c.pv = null;
      }
    }
  }

  /* ---------------- 标签浮标 ---------------- */

  function placeLabels() {
    for (var i = 0; i < tagList.length; i++) {
      var t = tagList[i];
      if (!t.el) continue;
      var pr = project(t.x, t.y, t.z, C, C.dy);
      var op = (1 - fog(pr.z, C) * 0.9) * (focusTag === t.name ? 1 : 0.8);
      if (pr.z < -60) op *= 0.42;
      if (op < 0.06) {
        if (t.el.style.display !== 'none') t.el.style.display = 'none';
        continue;
      }
      if (t.el.style.display === 'none') t.el.style.display = '';
      var s = Math.max(0.74, Math.min(1.1, pr.k));
      t.el.style.transform = 'translate3d(' + pr.x.toFixed(1) + 'px,' + pr.y.toFixed(1) +
        'px,0) translate(-50%,-50%) scale(' + s.toFixed(3) + ')';
      t.el.style.opacity = op.toFixed(3);
      var on = focusTag === t.name;
      if (on !== t.on) { t.el.classList.toggle('is-on', on); t.on = on; }
    }
  }

  /* ---------------- canvas ---------------- */

  /* 沿半径为 rad 的弧采样一排点，y 是世界高度。
     书架的每层隔板都是弯的（弧心在书架轴心上），所以不能用一条直线代替。 */
  function rowArc(y, rad, angHalf, steps) {
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var ang = (-0.5 + i / steps) * 2 * angHalf;
      pts.push(project(rad * Math.sin(ang), y, rad * Math.cos(ang), C, C.dy));
    }
    return pts;
  }

  /* 由上下两条弧围成一条带，用来画隔板正面、书脚的接地阴影 */
  function arcBandPath(top, bot) {
    var i;
    ctx.beginPath();
    for (i = 0; i < top.length; i++) {
      if (i) ctx.lineTo(top[i].x, top[i].y); else ctx.moveTo(top[i].x, top[i].y);
    }
    for (i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
    ctx.closePath();
  }

  /* 在一条弧带里填竖直渐变（渐变按带子的屏幕包围盒算，足够准） */
  function fillBand(top, bot, stops) {
    var i, y0 = Infinity, y1 = -Infinity;
    for (i = 0; i < top.length; i++) {
      if (top[i].y < y0) y0 = top[i].y;
      if (bot[i].y > y1) y1 = bot[i].y;
    }
    if (!(y1 > y0)) y1 = y0 + 1;
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    for (i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    arcBandPath(top, bot);
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* 每层书下面都要有一块**看得见的隔板** —— 没有它，书就是浮在空中的。
     几何：板面在 y0，从 z=R-34（里）铺到 z=R+26（外）；正面是那块板的厚度。
     镜头几乎平视，所以板面投影成很窄的一条，正面才是主要可见面。
     板画在 canvas 上（卡片是上面一层的 DOM），书会把板面压住 —— 正好是想要的效果。

     板的角宽必须**按这一排实际铺开的弧长**算：一排 6 本铺到 ±0.94 rad，
     写死一个 0.34 的话隔板只有书排的三分之一长，看起来像一段悬空的亮条。 */
  function drawShelves() {
    if (state.layout !== 'shelf' || !shelfRows.length) return;
    var PLANK_T = 20, UNDER = 34, OVER = (CARD_W / 2 + 16) / R;
    for (var r = 0; r < shelfRows.length; r++) {
      var row = shelfRows[r];
      var n = row.items.length;
      var angHalf = ((n - 1) / 2) * rowStep() + OVER;
      /* CARD_H/2 是卡片中心到底边；+2 让书脚略微压进板里，不留缝 */
      var y0 = row.y + CARD_H / 2 + 2;

      var topBack = rowArc(y0, R - 34, angHalf, 46);
      var topFront = rowArc(y0, R + 26, angHalf, 46);
      var frontBot = rowArc(y0 + PLANK_T, R + 26, angHalf, 46);
      var under = rowArc(y0 + PLANK_T + UNDER, R + 26, angHalf, 46);

      /* 板面：靠外（近镜头）那一条是受光的板沿，整块隔板就靠它被认出来。
         不能用 --bg 去压暗 —— 暗色主题下板和背景一样黑，等于没画。 */
      fillBand(topBack, topFront, [
        [0, rgba(pal.surface, 0.62)],
        [0.55, rgba(pal.surface, 0.95)],
        [1, rgba(pal.accent, 0.46)]
      ]);
      /* 正面：紧贴书脚处最暗（书压在板上投出来的接触阴影），往下回到板本色 */
      fillBand(topFront, frontBot, [
        [0, rgba(pal.shadow, 0.72)],
        [0.22, rgba(pal.surface, 0.95)],
        [0.78, rgba(pal.surface, 0.72)],
        [1, rgba(pal.surface, 0.40)]
      ]);
      /* 板下投影：给下一层一个「上面还有东西」的暗示 */
      fillBand(frontBot, under, [
        [0, rgba(pal.shadow, 0.62)],
        [1, rgba(pal.shadow, 0)]
      ]);

      /* 板沿高光：一道细线，让板看起来是硬的 */
      ctx.beginPath();
      for (var i = 0; i < topFront.length; i++) {
        if (i) ctx.lineTo(topFront[i].x, topFront[i].y);
        else ctx.moveTo(topFront[i].x, topFront[i].y);
      }
      ctx.strokeStyle = rgba(pal.accent, 0.34);
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
  }

  function drawSky() {
    ctx.clearRect(0, 0, W, H);
    if (!skyGradient) {
      skyGradient = ctx.createRadialGradient(W / 2, H * 0.64, 0, W / 2, H * 0.64, Math.max(W, H) * 0.74);
      skyGradient.addColorStop(0, rgba(pal.accent, 0.11));
      skyGradient.addColorStop(0.46, rgba(pal.accent, 0.03));
      skyGradient.addColorStop(1, rgba(pal.bg, 0));
    }
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, W, H);

    /* 书架脚下的一摊光：给空荡的下半场一点着落 */
    var pool = project(0, FLOOR_Y, 0, C);
    if (pool.z < C.f - 90) {
      var pr = Math.max(120, 1180 * pool.k);
      var pg = ctx.createRadialGradient(pool.x, pool.y, 0, pool.x, pool.y, pr);
      pg.addColorStop(0, rgba(pal.accent, 0.13));
      pg.addColorStop(0.42, rgba(pal.accent, 0.045));
      pg.addColorStop(1, rgba(pal.bg, 0));
      ctx.save();
      ctx.translate(pool.x, pool.y);
      ctx.scale(1, 0.34);                 /* 压扁成贴着地面的椭圆 */
      ctx.translate(-pool.x, -pool.y);
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, pr, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawFloor() {
    ctx.lineWidth = 1;
    var i, a, b, segs = [];
    for (i = -FLOOR_HALF; i <= FLOOR_HALF; i += FLOOR_STEP) {
      segs.push([i, -FLOOR_HALF, i, FLOOR_HALF]);
      segs.push([-FLOOR_HALF, i, FLOOR_HALF, i]);
    }
    for (var k = 0; k < segs.length; k++) {
      var s = segs[k];
      a = project(s[0], FLOOR_Y, s[1], C);
      b = project(s[2], FLOOR_Y, s[3], C);
      if (a.z > C.f - 90 || b.z > C.f - 90) continue;
      var da = Math.hypot(s[0], s[1]) / FLOOR_HALF;
      var db = Math.hypot(s[2], s[3]) / FLOOR_HALF;
      var edge = 1 - Math.max(da, db);
      edge = edge < 0 ? 0 : edge * edge;
      var alpha = 0.52 * edge * (1 - (fog(a.z, C) + fog(b.z, C)) * 0.5);
      if (alpha < 0.012) continue;
      ctx.strokeStyle = rgba(pal.accent, alpha);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function drawDust(dt) {
    if (!motionAllowed()) dt = 0;
    for (var i = 0; i < Math.min(dust.length, compact ? 45 : 85); i++) {
      var d = dust[i];
      if (dt) {
        d.y -= d.v * dt;
        d.a += dt * 0.16;
        if (d.y < -FLOOR_Y) d.y = FLOOR_Y;
      }
      var pr = project(d.r * Math.cos(d.a), d.y, d.r * Math.sin(d.a), C);
      if (pr.z > C.f - 130) continue;
      var op = (1 - fog(pr.z, C)) * d.s * 0.5;
      if (op < 0.03) continue;
      ctx.fillStyle = rgba(pal.text, op);
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, Math.max(0.6, 1.7 * pr.k * d.s), 0, TAU);
      ctx.fill();
    }
  }

  function drawLinks() {
    var active = hover;
    lctx.clearRect(0, 0, W, H);
    var dashOff = motionAllowed() ? -(linkPhase * 1000 / 42) % 10 : 0;
    for (var i = 0; i < links.length; i++) {
      var L = links[i];
      var on = active && (L.a === active || L.b === active);
      var base = active ? (on ? 0.62 + L.w * 0.14 : 0.018) : 0.055 + L.w * 0.016;
      if (base < 0.012) continue;

      var a0 = L.a.pos, b0 = L.b.pos, ap = L.a.pull, bp = L.b.pull;
      var a = ap ? {x:a0.x+ap.x, y:a0.y+ap.y, z:a0.z+ap.z} : a0;
      var b = bp ? {x:b0.x+bp.x, y:b0.y+bp.y, z:b0.z+bp.z} : b0;
      /* 控制点往柱体外侧鼓出去（而不是收进柱心）：
         镜头现在在柱体外面，收进去的弧线会被书架墙挡住、在屏幕上缩成一小段。 */
      var ax = (a.x + b.x) * 0.5, az = (a.z + b.z) * 0.5;
      var rad = Math.hypot(ax, az);
      var bulge = 1 + 0.42 * Math.min(1, rad / R);
      var mx = ax * bulge, my = (a.y + b.y) * 0.5 + 34, mz = az * bulge;
      var steps = 14, prev = null;
      lctx.beginPath();
      for (var s = 0; s <= steps; s++) {
        var t = s / steps, u = 1 - t;
        var x = u * u * a.x + 2 * u * t * mx + t * t * b.x;
        var y = u * u * a.y + 2 * u * t * my + t * t * b.y;
        var z = u * u * a.z + 2 * u * t * mz + t * t * b.z;
        var pr = project(x, y, z, C, C.dy);
        if (pr.z > C.f - 90) { prev = null; continue; }
        if (prev) { lctx.moveTo(prev.x, prev.y); lctx.lineTo(pr.x, pr.y); }
        prev = pr;
      }
      lctx.strokeStyle = rgba(on ? pal.accent2 : pal.accent, base);
      lctx.lineWidth = on ? 1.4 + L.w * 0.22 : 1;
      if (on) {
        lctx.setLineDash([5, 5]);
        lctx.lineDashOffset = dashOff;
        lctx.shadowColor = rgba(pal.accent2, 0.5);
        lctx.shadowBlur = 8;
      }
      lctx.stroke();
      if (on) { lctx.setLineDash([]); lctx.shadowBlur = 0; }
    }
  }

  /* ---------------- HUD ---------------- */

  function paintHud() {
    if (!statusEl) return;
    var shown = 0;
    for (var i = 0; i < cards.length; i++) if (matches(cards[i])) shown++;
    var deg = Math.round(((view.yaw * 180 / Math.PI) % 360 + 360) % 360);
    var txt = (state.layout === 'nebula' ? '星云' : '书架') + ' · ' + shown + '/' +
      cards.length + ' 个节点 · 关系 ' + links.length + ' 条 · 视角 ' + deg + '°';
    if (focusTag) txt += ' · 标签 ' + focusTag;
    else if (query) txt += ' · 搜索 “' + query + '”';
    if (statusEl.textContent !== txt) statusEl.textContent = txt;
    if (zoomLabel) zoomLabel.textContent = Math.round(view.zoom * 100) + '%';
  }

  function setHint(s) { if (hintEl && hintEl.textContent !== s) hintEl.textContent = s; }

  function defaultHint() {
    if (window.matchMedia('(pointer: coarse)').matches) return '竖向滑动页面 · 横向拖动书库 · 用 + / − 缩放';
    if (document.activeElement === stage) return '方向键转动 · + / − 缩放 · R 复位 · Tab 进入书本';
    return HINT;
  }

  function selectCard(card) {
    if (selected === card && card) return;
    selected = card;
    if (!detail) return;
    if (detailKind) detailKind.textContent = card ? (card.node.kind === 'project' ? '项目' : '文章') : '';
    if (detailTitle) detailTitle.textContent = card ? card.node.title : '没有匹配的书目';
    if (detailSummary) detailSummary.textContent = card ? card.node.summary : '试试更短的关键词，或清除筛选后继续探索。';
    if (detailTags) {
      detailTags.textContent = '';
      if (card) card.node.tags.forEach(function (tag) {
        var span = document.createElement('span'); span.textContent = tag; detailTags.appendChild(span);
      });
    }
    if (detailLink) {
      detailLink.hidden = !card;
      if (card) detailLink.setAttribute('href', card.el.getAttribute('href'));
      else detailLink.removeAttribute('href');
    }
    if (detailRelated) {
      detailRelated.textContent = '';
      if (card) {
        var related = cards.filter(function (other) { return card.rel[other.node.id] && matches(other); }).slice(0, 3);
        if (related.length) {
          var label = document.createElement('span'); label.textContent = '相关书目'; detailRelated.appendChild(label);
          related.forEach(function (other) {
            var link = document.createElement('a'); link.textContent = other.node.title;
            link.setAttribute('href', other.el.getAttribute('href')); detailRelated.appendChild(link);
          });
        }
      }
    }
  }

  function applyFilters() {
    var count = 0, first = null, filtered = !!query || !!focusTag || kind !== 'all';
    cards.forEach(function (card) {
      var match = matches(card); card.el.tabIndex = match ? 0 : -1;
      card.el.style.pointerEvents = match ? '' : 'none';
      card.el.setAttribute('aria-hidden', String(!match));
      if (match) { count++; if (!first) first = card; }
    });
    resultEls.forEach(function (el) {
      var card = cards.find(function (item) { return item.idx === el.getAttribute('data-idx'); });
      el.hidden = !card || !matches(card);
    });
    if (resultCount) resultCount.textContent = filtered ? count + ' / ' + cards.length + ' 本匹配' : cards.length + ' 本，可直接阅读';
    if (emptyEl) emptyEl.hidden = count !== 0;
    if (clearBtn) clearBtn.hidden = !filtered;
    if (resultsBox && filtered) resultsBox.open = true;
    if (hover && !matches(hover)) hover = null;
    var next = selected && matches(selected) ? selected : first;
    // Refresh related links as filters change, even if the selected book survives.
    selected = null; selectCard(next);
    syncLegend(); syncAuto();
    if (kindBox) kindBox.querySelectorAll('button[data-kind]').forEach(function (button) {
      var on = button.getAttribute('data-kind') === kind;
      button.classList.toggle('is-on', on); button.setAttribute('aria-pressed', String(on));
    });
    paintHud();
    wake();
  }

  function clearFilters() {
    focusTag = null; query = ''; kind = 'all';
    if (qEl) qEl.value = '';
    applyFilters();
  }

  function zoomBy(factor) {
    goal.zoom = Math.max(.55, Math.min(1.75, goal.zoom * factor));
    idle = 0; wake();
  }

  /* ---------------- 交互 ---------------- */

  function cardOf(el) {
    for (var i = 0; i < cards.length; i++) if (cards[i].el === el) return cards[i];
    return null;
  }

  function findCard(el) {
    while (el && el !== stage) {
      if (el.classList && el.classList.contains('gcard')) return el;
      el = el.parentNode;
    }
    return null;
  }

  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (dragId !== null) return;
    dragDist = 0; dragId = e.pointerId; captured = false; suppressClickUntil = 0;
    touchPending = e.pointerType === 'touch'; touchDrag = false;
    pointerOriginX = e.clientX; pointerOriginY = e.clientY;
    lastX = e.clientX; lastY = e.clientY;
    idle = 0;
    grabVX = 0; grabVY = 0; grabT = 0;
    /* 按在书上 = 把书抽出来；按在空白处 = 转书架。
       星云布局没有「书」，一律走转视角。 */
    var el = findCard(e.target);
    var c = el ? cardOf(el) : null;
    if (c && matches(c)) selectCard(c);
    if (touchPending) { setHint(defaultHint()); return; }
    if (c && state.layout === 'shelf' && matches(c)) {
      grabbing = c;
      grabOriginX = e.clientX; grabOriginY = e.clientY;
      c.pv = { x: 0, y: 0, z: 0 };
      setHint('松手让它归位');
      if (stage.setAttribute) stage.setAttribute('data-cursor-label', '松手归位');
    } else {
      dragging = true;
    }
    /* 这里**绝对不能**马上 setPointerCapture。
       一旦捕获指针，浏览器会把随后那一下 click 重定向到捕获元素（也就是 stage），
       <a class="gcard"> 永远收不到点击 —— 卡片点不进去就是这么来的。
       改成「等真的拖起来了再捕获」，这样轻点仍然是点，拖动仍然拖得稳。 */
  });

  window.addEventListener('pointermove', function (e) {
    if (e.pointerId !== dragId) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (touchPending) {
      var totalX = e.clientX - pointerOriginX, totalY = e.clientY - pointerOriginY;
      if (Math.max(Math.abs(totalX), Math.abs(totalY)) < 10) return;
      if (Math.abs(totalY) >= Math.abs(totalX)) { cancelInteraction(); return; }
      if (Math.abs(totalX) < Math.abs(totalY) * 1.2) return;
      touchPending = false; touchDrag = true; dragging = true;
    }
    lastX = e.clientX; lastY = e.clientY;
    dragDist += Math.abs(dx) + Math.abs(dy);

    if (grabbing) {
      /* 指针一离开原位就当作「在抽书」，避免和点击抢事件 */
      if (!captured && dragDist > DRAG_MIN) {
        captured = true;
        stage.classList.add('is-dragging');
        if (stage.setPointerCapture) { try { stage.setPointerCapture(dragId); } catch (err) {} }
        grabT = 0;
      }
      if (captured) {
        /* 手速按**像素/秒**记，松手才能把「甩」的劲道交给弹簧；
           事件间隔用真实时间戳，别拿「每帧像素」当速度（会差 60 倍）。 */
        var now = performance.now();
        var span = grabT ? (now - grabT) / 1000 : 0;
        if (span > 0.001) {
          var fx = dx / span, fy = dy / span;
          var fm = Math.hypot(fx, fy);
          if (fm > PULL_VMAX) { fx = fx / fm * PULL_VMAX; fy = fy / fm * PULL_VMAX; }
          /* 手停住再松手不算甩：留一点衰减，别让上一段的余速接着起作用 */
          var k = Math.min(1, span / 0.09);
          grabVX = grabVX * (1 - k) + fx * k;
          grabVY = grabVY * (1 - k) + fy * k;
        }
        grabT = now;
        applyPull(grabbing, e.clientX - grabOriginX, e.clientY - grabOriginY);
        wake();
      }
      idle = 0;
      return;
    }

    if (!dragging) return;
    if (!captured && dragDist > DRAG_MIN) {
      captured = true;
      stage.classList.add('is-dragging');
      if (stage.setPointerCapture) { try { stage.setPointerCapture(dragId); } catch (err) {} }
    }
    /* 拖拽方向 = **直接抓取**：往右拖，书架就往右走；往下拖，书架就往下走。
       原来用的是「轨道相机」式（拖右 = 相机右移 = 内容左移），反直觉 ——
       手指推的是内容，内容就该跟着手指走。
       方向推导：卡片在世界里位于角度 θ，投影后 X = R·sin(θ + yaw)，
       所以 yaw 变大 = 卡片向右移；而 Y2 = -R·sin(pitch)，
       所以 pitch 变小 = 卡片向下移。 */
    goal.yaw += dx * 0.0042 * view.zoom;
    if (!touchDrag) goal.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, goal.pitch - dy * 0.0031));
    idle = 0;
    wake();
  });

  function endDrag() {
    dragging = false;
    touchPending = false; touchDrag = false;
    if (captured) {
      captured = false;
      try { stage.releasePointerCapture(dragId); } catch (err) {}
    }
    dragId = null;
    stage.classList.remove('is-dragging');
  }

  function endGrab() {
    if (!grabbing) return;
    var c = grabbing;
    /* 松手：真拖过就把手速交给弹簧（书飞一下再弹回原位）；
       只是轻点、或者手已经停住超过 120ms 才松，就直接清掉偏移，别留余速。 */
    if (captured) {
      var stale = grabT && (performance.now() - grabT) > 120;
      releasePull(c, stale ? 0 : grabVX, stale ? 0 : grabVY);
      if (!c.pull || Math.hypot(c.pull.x, c.pull.y, c.pull.z) < 0.5) {
        c.pull = null; c.pv = null;
      }
    } else { c.pull = null; c.pv = null; }
    grabbing = null;
    if (stage.setAttribute) stage.setAttribute('data-cursor-label', '按住抽书');
    setHint(HINT);
    if (captured) {
      captured = false;
      try { stage.releasePointerCapture(dragId); } catch (err) {}
    }
    captured = false;
    dragId = null;
    stage.classList.remove('is-dragging');
    wake();
  }

  function cancelInteraction() {
    if (grabbing) { grabT = 0; grabVX = grabVY = 0; endGrab(); }
    endDrag();
    setHint(defaultHint());
    if (stage.setAttribute) stage.setAttribute('data-cursor-label', '拖动探索');
  }

  window.addEventListener('pointerup', function (e) {
    if (e.pointerId !== dragId) return;
    if (captured && dragDist > DRAG_MIN) suppressClickUntil = performance.now() + 450;
    if (grabbing) endGrab(); else endDrag();
    wake();
  });
  window.addEventListener('pointercancel', function (e) {
    if (e.pointerId !== dragId) return;
    cancelInteraction(); wake();
  });
  stage.addEventListener('lostpointercapture', function (e) {
    if (captured && e.pointerId === dragId) { cancelInteraction(); wake(); }
  });
  window.addEventListener('blur', function () {
    cancelInteraction(); hover = null; wake();
  });

  /* 双保险：任何原生拖放都在 stage 上掐掉（书是 <a>，默认可拖） */
  stage.addEventListener('dragstart', function (e) { e.preventDefault(); });

  stage.addEventListener('pointerover', function (e) {
    if (e.pointerType === 'touch') return;
    var el = findCard(e.target);
    var c = el ? cardOf(el) : null;
    if (c && !matches(c)) c = null;
    if (c !== hover) {
      hover = c;
      if (c) selectCard(c);
      if (!grabbing) {
        setHint(c ? (state.layout === 'shelf' ? '按住把书抽出来 · 点击进入' : '点击进入') : HINT);
      }
      idle = 0;
      wake();
    }
  });
  stage.addEventListener('pointerleave', function () { if (hover) { hover = null; wake(); } setHint(defaultHint()); });

  /* 拖动之后不要误触发链接 */
  stage.addEventListener('click', function (e) {
    if (e.detail > 0 && performance.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  stage.addEventListener('wheel', function (e) {
    if (!e.shiftKey || e.ctrlKey || e.metaKey || !e.deltaY) return;
    e.preventDefault();
    var pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1);
    zoomBy(Math.exp(-Math.max(-600, Math.min(600, pixels)) * .0012));
  }, { passive: false });

  window.addEventListener('keydown', function (e) {
    if (!e.target || !stage.contains(e.target) || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key, hit = true;
    if (k === 'ArrowLeft') goal.yaw += 0.17;
    else if (k === 'ArrowRight') goal.yaw -= 0.17;
    else if (k === 'ArrowUp') goal.pitch = Math.max(-PITCH_MAX, goal.pitch - 0.09);
    else if (k === 'ArrowDown') goal.pitch = Math.min(PITCH_MAX, goal.pitch + 0.09);
    else if (k === '+' || k === '=') goal.zoom = Math.min(1.75, goal.zoom * 1.1);
    else if (k === '-' || k === '_') goal.zoom = Math.max(0.55, goal.zoom * 0.9);
    else if (k === 'Escape') { cancelInteraction(); clearFilters(); }
    else if (k === 'r' || k === 'R') resetView();
    else hit = false;
    if (hit) { idle = 0; e.preventDefault(); wake(); }
  });
  stage.addEventListener('focus', function () { setHint(defaultHint()); });
  stage.addEventListener('blur', function () { setHint(defaultHint()); });

  function resetView() {
    goal.yaw = 0.0; goal.pitch = -0.04; goal.zoom = 1;
    idle = 0; cancelInteraction(); wake();
  }

  function syncAuto() {
    if (autoBtn) {
      autoBtn.setAttribute('aria-pressed', autoPref && motionAllowed() ? 'true' : 'false');
      autoBtn.disabled = !motionAllowed();
      autoBtn.title = motionAllowed() ? '缓慢转动书库；悬停阅读时暂停' : '开启动态效果后可使用自动巡航';
    }
  }

  function syncLegend() {
    if (!legendBox) return;
    var chips = legendBox.querySelectorAll('.graph-tag-chip');
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i].getAttribute('data-tag') === focusTag;
      chips[i].classList.toggle('is-on', on);
      chips[i].setAttribute('aria-pressed', String(on));
    }
  }

  /* 把某一簇转到正前方 */
  function focusOn(name) {
    focusTag = (focusTag === name) ? null : name;
    applyFilters();
    if (!focusTag) return;
    var sx = 0, sy = 0, sz = 0, n = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!matches(c)) continue;
      sx += c.pos.x; sy += c.pos.y; sz += c.pos.z; n++;
    }
    if (!n) return;
    sx /= n; sy /= n; sz /= n;
    var targetYaw = -Math.atan2(sx, sz);
    // Take the nearest equivalent turn, including clusters behind the nebula.
    goal.yaw = view.yaw + Math.atan2(Math.sin(targetYaw - view.yaw), Math.cos(targetYaw - view.yaw));
    goal.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.atan2(sy, Math.hypot(sx, sz))));
    wake();
  }

  if (qEl) {
    qEl.addEventListener('input', function () {
      query = qEl.value.trim();
      idle = 0;
      applyFilters();
    });
    qEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (resultsBox) resultsBox.open = true;
      var first = resultEls.find(function (el) { return !el.hidden; });
      var link = first && (first.tagName === 'A' ? first : first.querySelector('a'));
      if (link) link.focus();
    });
  }

  if (legendBox) {
    legendBox.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.graph-tag-chip') : null;
      if (chip) focusOn(chip.getAttribute('data-tag'));
    });
  }

  if (labelBox) {
    labelBox.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.graph-label') : null;
      if (!el) return;
      var name = (el.firstChild && el.firstChild.nodeValue ? el.firstChild.nodeValue : '').trim();
      if (name) focusOn(name);
    });
  }

  if (autoBtn) {
    autoBtn.addEventListener('click', function () {
      if (!motionAllowed()) return;
      autoPref = !autoPref;
      idle = autoPref ? 1.2 : 0;
      syncAuto(); wake();
    });
  }
  if (resetBtn) resetBtn.addEventListener('click', resetView);
  if (clearBtn) clearBtn.addEventListener('click', clearFilters);
  if (zoomIn) zoomIn.addEventListener('click', function () { zoomBy(1.12); });
  if (zoomOut) zoomOut.addEventListener('click', function () { zoomBy(1 / 1.12); });
  if (kindBox) kindBox.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('button[data-kind]');
    if (!button) return;
    var value = button.getAttribute('data-kind');
    if (['all', 'post', 'project'].indexOf(value) === -1) return;
    kind = value; applyFilters();
  });
  resultEls.forEach(function (el) {
    function preview() {
      var card = cards.find(function (item) { return item.idx === el.getAttribute('data-idx'); });
      if (card && matches(card)) selectCard(card);
    }
    el.addEventListener('pointerover', preview);
    el.addEventListener('focusin', preview);
  });

  if (layoutBox) {
    layoutBox.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-val]') : null;
      if (!b) return;
      var v = b.getAttribute('data-val');
      if (v === state.layout) return;
      state.layout = v;
      cancelInteraction();
      cards.forEach(function (card) { card.pull = null; card.pv = null; });
      var kids = layoutBox.querySelectorAll('button');
      for (var i = 0; i < kids.length; i++) {
        var on = kids[i] === b;
        kids[i].classList.toggle('is-on', on);
        kids[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      relayout();
      goal.pitch = v === 'nebula' ? 0.02 : -0.04;
      goal.zoom = 1;
      wake();
    });
  }

  if (window.MutationObserver) {
    new MutationObserver(function (records) {
      var paletteChanged = records.some(function (record) { return ['data-theme', 'data-mode', 'style'].indexOf(record.attributeName) >= 0; });
      if (paletteChanged) readPalette();
      var nextCompact = root.getAttribute('data-performance') === 'compact';
      if (nextCompact !== compact) { compact = nextCompact; resize(); }
      if (!motionAllowed()) cancelInteraction();
      syncAuto(); wake();
    }).observe(root, {
      attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-glass', 'data-motion', 'data-performance', 'style']
    });
  }
  if (reduce.addEventListener) {
    reduce.addEventListener('change', function () { if (!motionAllowed()) cancelInteraction(); syncAuto(); wake(); });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    stage.classList.add('is-initializing');
    /* JS 到位 = 最慢的一段（两个包加字体）已经过去了 */
    boot0('正在铺书架');
    bootP(22);
    var els = world.querySelectorAll('.gcard'), i;
    for (i = 0; i < els.length; i++) {
      (function (el, idx) {
        var tags = (el.getAttribute('data-tags') || '').split('|').filter(Boolean);
        var titleEl = el.querySelector('.gcard-title');
        var sumEl = el.querySelector('.gcard-sum');
        var card = {
          el: el,
          idx: el.getAttribute('data-idx') || String(idx),
          cloth: Math.max(1, Math.min(6, parseInt(el.getAttribute('data-cloth'), 10) || 1)),
          node: {
            id: el.getAttribute('data-kind') + ':' + idx,
            kind: el.getAttribute('data-kind'),
            year: el.getAttribute('data-year') || '',
            date: el.getAttribute('data-date') || '',
            title: titleEl ? titleEl.textContent : '',
            summary: sumEl ? sumEl.textContent : '',
            tags: tags,
            archived: el.classList.contains('is-archived')
          },
          /* 书的高度：真书架上一排书不可能是同一个高度，这条差异比任何贴图都更像书。
             取 1.000~1.065，最多高出 21px；配合 placeCards 里的下移补偿，
             **底边仍然贴在隔板上**，所以隔板位置不用改。 */
          hs: 1 + ((parseInt(el.getAttribute('data-cloth'), 10) || 1) - 1) * 0.013,
          pos: { x: 0, y: 0, z: 0 }, rotY: 0,
          normal: { x: 0, y: 0, z: 1 }, billboard: false,
          sc: 1, t: '', o: '', cls: '', links: [], rel: {}
        };
        cards.push(card);
        /* <a> 天生是可拖拽的：按住书往旁边一挪，浏览器就起**原生链接拖放**，
           紧接着甩来一个 pointercancel —— 「抽书」在第一帧就被掐死了。
           关掉元素级拖拽，再在 stage 上兜一层 dragstart（见下）。 */
        el.draggable = false;
        el.setAttribute('draggable', 'false');
        el.addEventListener('focus', function () { if (matches(card)) { hover = card; selectCard(card); idle = 0; wake(); } });
        el.addEventListener('blur', function () { if (hover === card) { hover = null; wake(); } });
      }(els[i], i));
    }
    for (i = 0; i < DUST; i++) {
      dust.push({
        r: 200 + Math.random() * 880,
        y: (Math.random() - 0.5) * 900,
        a: Math.random() * TAU,
        v: 6 + Math.random() * 22,
        s: 0.4 + Math.random() * 0.9
      });
    }
    buildLinks();
    applyFilters();
    boot0('正在连线');
    bootP(52);
    readPalette();
    resize();
    /* 第一帧画出来之前别急着揭开遮罩：镜头要跑 14 次二分拟合，
       卡片位置也要算一轮，这中间揭开会看到一次跳动。 */
    relayout();
    bootP(78);
    stage.classList.add('is-live', 'is-ready');
    stage.classList.remove('is-initializing');
    live = true;
    syncAuto();
    setHint(defaultHint());
    lastT = performance.now();
    raf = requestAnimationFrame(function (t) {
      frame(t);
      boot0('书架就绪');
      bootP(100);
      if (window.__boot) window.__boot.done('graph');
    });
  }

  if (reduce.matches) autoPref = false;

  /* 启动遮罩的真实阶段。资源没到位时它走不定量扫描，
     这里每报一次里程碑就切成定量条 —— 不编进度，只报真的做完了什么。 */
  function boot0(text) {
    if (window.__boot) window.__boot.label('graph', text);
  }
  function bootP(p) {
    if (window.__boot) window.__boot.progress('graph', p);
  }

  function safeBoot() {
    try {
      boot();
    } catch (err) {
      /* 3D 起不来就退回普通网格：至少还能看、还能点。
         遮罩也必须一起撤掉 —— 否则它会在一个已经降级的页面上永远转下去。 */
      window.__graphError = String((err && err.stack) || err);
      if (window.console && console.error) console.error('[graph]', err);
      fallbackGraph();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeBoot);
  else safeBoot();

  /* 调试/自测用：把相机与卡片位姿暴露出来，tools/probe-graph.py 靠它核对
     「canvas 的投影」和「浏览器自己算的 CSS 3D」是不是同一套。 */
  window.__graph = {
    debug: function () {
      return {
        live: live,
        running: !!raf, draws: draws, kind: kind,
        selected: selected ? selected.idx : null,
        visible: cards.filter(matches).length,
        focused: hover ? hover.idx : null,
        layout: state.layout,
        yaw: view.yaw, pitch: view.pitch, zoom: view.zoom,
        f: C ? C.f : 0, dist: C ? C.dist : 0,
        w: W, h: H, cx: CX, cy: CY,
        cyy: C ? C.cyy : CY,
        dy: worldDY,
        pullMax: cards.reduce(function(m,c){return c.pull?Math.max(m,Math.hypot(c.pull.x,c.pull.y,c.pull.z)):m;},0),
        pulling: cards.filter(function(c){return !!c.pull;}).length,
        ext: C && !C.neb ? shelfExtent(C.dist, C.f, C.cp, C.sp, C.dy) : null,
        shelfHeight: shelfHeight,
        cardW: CARD_W, cardH: CARD_H,
        rows: shelfRows.length,
        ox: canvas.getBoundingClientRect().left,
        oy: canvas.getBoundingClientRect().top,
        auto: autoPref, dragging: dragging,
        grabbing: grabbing ? grabbing.node.id : null,
        captured: captured, dragId: dragId, dragDist: dragDist,
        focusTag: focusTag, query: query,
        baseF: BASE_F, R: R,
        cards: cards.map(function (c) {
          return {
            id: c.node.id, title: c.node.title, kind: c.node.kind,
            x: c.pos.x, y: c.pos.y, z: c.pos.z, rotY: c.rotY,
            pull: c.pull ? { x: c.pull.x, y: c.pull.y, z: c.pull.z } : null,
            pv: c.pv ? { x: c.pv.x, y: c.pv.y, z: c.pv.z } : null,
            normal: { x: c.normal.x, y: c.normal.y, z: c.normal.z },
            k: c.screen ? c.screen.k : null,
            billboard: c.billboard, tags: c.node.tags,
            opacity: c.el.style.opacity, cls: c.el.className,
            href: c.el.getAttribute('href')
          };
        }),
        links: links.length,
        labels: tagList.filter(function (t) { return !!t.el; }).length
      };
    },
    set: function (o) {
      if (o.yaw !== undefined) goal.yaw = view.yaw = o.yaw;
      if (o.pitch !== undefined) goal.pitch = view.pitch = o.pitch;
      if (o.zoom !== undefined) goal.zoom = view.zoom = o.zoom;
      /* 立刻把相机写进 DOM，这样"读 debug() + 量矩形"在同一个同步块里就是自洽的。
         translateY 别漏 —— 它是书架的整体竖直补偿，漏了投影就对不上（踩过）。 */
      C = makeCam();
      stage.style.perspective = C.f.toFixed(1) + 'px';
      world.style.transform = 'translateY(' + worldDY.toFixed(2) + 'px) translateZ(' +
        C.dist.toFixed(1) + 'px) rotateX(' +
        view.pitch.toFixed(5) + 'rad) rotateY(' + view.yaw.toFixed(5) + 'rad)';
      cachedPersp = '';
      cachedWorldT = '';
    }
  };

  /* An observer may already have updated W/H before this notification. The
     pending book layout must still run, including CSS-only card-size changes. */
  function onResize() {
    var changed = resize();
    if (!live) return;
    if (layoutDirty) relayout();
    if (changed || cameraDirty) wake();
  }

  if (window.ResizeObserver) {
    new ResizeObserver(onResize).observe(stage);
  } else {
    window.addEventListener('resize', onResize);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { cancelInteraction(); hover = null; if (raf) cancelAnimationFrame(raf); raf = 0; lastT = null; lastPaint = null; }
    else wake();
  });
  if (window.IntersectionObserver) new IntersectionObserver(function (entries) {
    inViewport = entries[0].isIntersecting;
    if (!inViewport) { cancelInteraction(); hover = null; if (raf) cancelAnimationFrame(raf); raf = 0; lastT = null; lastPaint = null; }
    else wake();
  }, {rootMargin:'80px'}).observe(stage);
})();
