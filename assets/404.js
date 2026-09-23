(function () {
  'use strict';
  var cv = document.getElementById('e404-canvas');
  if (!cv || !cv.getContext) return;
  var stage = cv.parentNode;
  var ctx = cv.getContext('2d');
  var statsEl = document.getElementById('e404-stats');
  var statusEl = document.getElementById('e404-status');
  var barEl = document.getElementById('e404-bar');
  var retryEl = document.getElementById('e404-retry');
  var hintEl = document.getElementById('e404-hint');
  var root = document.documentElement;
  var TAU = Math.PI * 2;
  var GOAL_R = 44;
  var STEP = 32;
  var BUDGET = 900;
  var PER_FRAME = 3;
  var FAIL_HOLD = 2.9;
  var W = 0, H = 0, DPR = 1;
  var nodes = [], walls = [], userWalls = [], flashes = [];
  var goal = { x: 0, y: 0 }, start = { x: 0, y: 0 };
  var samples = 0, collisions = 0, phase = 'grow', hold = 0, fade = 0;
  var raf = 0, last = 0, hudAt = 0;
  var palette = {};
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  function toRgb(c) {
    if (!c) return null;
    c = String(c).trim();
    var m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = c.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      var p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 3) return [p[0], p[1], p[2]];
    }
    return null;
  }
  function mix(rgb, a, fallback) {
    var r = rgb || toRgb(fallback) || [122, 162, 255];
    return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + a + ')';
  }
  function readPalette() {
    var cs = getComputedStyle(root);
    var get = function (n, f) { return (cs.getPropertyValue(n) || '').trim() || f; };
    var accent = get('--accent', '#7aa2ff');
    var accent2 = get('--accent-2', '#ff9d5c');
    var border = get('--border', 'rgba(128,128,128,.18)');
    var light = root.getAttribute('data-mode') === 'light';
    palette = {
      accent: toRgb(accent),
      accent2: toRgb(accent2),
      grid: mix(toRgb(border), light ? 0.5 : 0.34, border),
      wallFill: light ? 'rgba(18,22,32,.055)' : 'rgba(255,255,255,.05)',
      wallEdge: mix(toRgb(border), light ? 0.9 : 0.7, border),
      cage: toRgb(accent2),
      text: get('--text-3', '#8b93a7'),
      light: light,
      danger: light ? [206, 52, 78] : [255, 104, 128]
    };
  }
  function clipAxis(p, q, t0, t1) {
    if (p === 0) return q < 0 ? null : [t0, t1];
    var t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
    return [t0, t1];
  }
  function segHitsWall(x1, y1, x2, y2, w) {
    var ca = Math.cos(-w.a), sa = Math.sin(-w.a);
    var ax = x1 - w.cx, ay = y1 - w.cy;
    var bx = x2 - w.cx, by = y2 - w.cy;
    var p1x = ax * ca - ay * sa, p1y = ax * sa + ay * ca;
    var p2x = bx * ca - by * sa, p2y = bx * sa + by * ca;
    var r = clipAxis(-(p2x - p1x), p1x + w.hw, 0, 1);
    if (!r) return false;
    var t0 = r[0], t1 = r[1];
    r = clipAxis(p2x - p1x, w.hw - p1x, t0, t1);
    if (!r) return false;
    t0 = r[0]; t1 = r[1];
    r = clipAxis(-(p2y - p1y), p1y + w.hh, t0, t1);
    if (!r) return false;
    t0 = r[0]; t1 = r[1];
    return !!clipAxis(p2y - p1y, w.hh - p1y, t0, t1);
  }
  function blocked(x1, y1, x2, y2) {
    for (var i = 0; i < walls.length; i++) {
      if (segHitsWall(x1, y1, x2, y2, walls[i])) return true;
    }
    return false;
  }
  function freePoint(pad) {
    var x, y, ok, tries = 0;
    do {
      x = pad + Math.random() * (W - pad * 2);
      y = pad + Math.random() * (H - pad * 2);
      ok = Math.hypot(x - goal.x, y - goal.y) > GOAL_R + 34;
      for (var i = 0; ok && i < walls.length; i++) {
        var w = walls[i];
        if (Math.abs(x - w.cx) < w.hw + w.hh + 16 && Math.abs(y - w.cy) < w.hw + w.hh + 16) ok = false;
      }
    } while (!ok && ++tries < 60);
    return { x: x, y: y };
  }
  function layout() {
    walls = [];
    goal.x = W * (0.6 + Math.random() * 0.2);
    goal.y = H * (0.3 + Math.random() * 0.24);
    goal.x = Math.min(Math.max(goal.x, GOAL_R + 26), W - GOAL_R - 26);
    goal.y = Math.min(Math.max(goal.y, GOAL_R + 30), H - GOAL_R - 34);
    var seg = 9, R = GOAL_R + 6;
    var len = 2 * R * Math.tan(Math.PI / seg) * 1.45;
    for (var i = 0; i < seg; i++) {
      var a = (i + 0.5) / seg * TAU;
      walls.push({
        cx: goal.x + Math.cos(a) * R,
        cy: goal.y + Math.sin(a) * R,
        hw: len / 2, hh: 5, a: a + Math.PI / 2, cage: true
      });
    }
    var n = 5 + Math.floor(Math.random() * 4);
    for (var k = 0; k < n; k++) {
      var w = 56 + Math.random() * 150, h = 20 + Math.random() * 42;
      var x = 18 + Math.random() * Math.max(10, W - 36 - w);
      var y = 18 + Math.random() * Math.max(10, H - 36 - h);
      var rect = { cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2, a: (Math.random() - 0.5) * 1.0 };
      if (Math.hypot(rect.cx - goal.x, rect.cy - goal.y) < GOAL_R + 96) continue;
      walls.push(rect);
    }
    for (var u = 0; u < userWalls.length; u++) walls.push(userWalls[u]);
    var fallback = null, mid = null;
    for (var t = 0; t < 40; t++) {
      var cand = freePoint(30);
      if (cand.y > H * 0.24 && cand.y < H * 0.76) {
        if (!mid || cand.x < mid.x) mid = cand;
      } else if (!fallback) {
        fallback = cand;
      }
    }
    start = mid || fallback || freePoint(30);
    reset();
  }
  function reset() {
    nodes = [{ x: start.x, y: start.y, p: 0, g: 1 }];
    flashes = [];
    samples = 0;
    collisions = 0;
    phase = 'grow';
    hold = 0;
    fade = 0;
    paintHud(true);
  }
  function restart() {
    stop();
    layout();
    start_();
  }
  function step(count) {
    var n = count || PER_FRAME;
    for (var k = 0; k < n && samples < BUDGET; k++) {
      samples++;
      var px, py;
      if (Math.random() < 0.3) {          
        px = goal.x + (Math.random() - 0.5) * GOAL_R * 3.2;
        py = goal.y + (Math.random() - 0.5) * GOAL_R * 3.2;
      } else {
        px = 10 + Math.random() * (W - 20);
        py = 10 + Math.random() * (H - 20);
      }
      px = Math.min(Math.max(px, 6), W - 6);
      py = Math.min(Math.max(py, 6), H - 6);
      var best = 0, bd = Infinity;
      for (var i = 0; i < nodes.length; i++) {
        var dx = px - nodes[i].x, dy = py - nodes[i].y;
        var d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
      var near = nodes[best];
      var d = Math.sqrt(bd);
      if (d < 2) continue;
      var sc = Math.min(STEP, d) / d;
      var qx = near.x + (px - near.x) * sc;
      var qy = near.y + (py - near.y) * sc;
      if (blocked(near.x, near.y, qx, qy)) {
        collisions++;
        flashes.push({ x: qx, y: qy, life: 1 });
        if (flashes.length > 90) flashes.shift();
        continue;
      }
      nodes.push({ x: qx, y: qy, p: best, g: 0 });
    }
    if (samples >= BUDGET && phase === 'grow') {
      phase = 'failed';
      hold = FAIL_HOLD;
    }
  }
  function settle() {
    while (samples < BUDGET) step(120);
    for (var i = 0; i < nodes.length; i++) nodes[i].g = 1;
    flashes = [];
    fade = 1;
    phase = 'failed';
    hold = Infinity;
  }
  function drawGrid() {
    var s = 46;
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = ((W % s) / 2); x < W; x += s) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (var y = ((H % s) / 2); y < H; y += s) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
  }
  function drawTree() {
    var i, n, p, g, ex, ey;
    ctx.lineCap = 'round';
    ctx.strokeStyle = mix(palette.accent, 0.34 * fade, '#ff9d5c');
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    for (i = 1; i < nodes.length; i++) {
      n = nodes[i]; p = nodes[n.p];
      g = n.g; if (g <= 0) continue;
      ex = p.x + (n.x - p.x) * g;
      ey = p.y + (n.y - p.y) * g;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
    var from = Math.max(1, nodes.length - 150);
    ctx.strokeStyle = mix(palette.accent2, 0.78 * fade, '#7aa2ff');
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (i = from; i < nodes.length; i++) {
      n = nodes[i]; p = nodes[n.p];
      g = n.g; if (g <= 0) continue;
      ex = p.x + (n.x - p.x) * g;
      ey = p.y + (n.y - p.y) * g;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
    ctx.fillStyle = mix(palette.accent, 0.95 * fade, '#ff9d5c');
    ctx.beginPath();
    var dot = Math.max(1.6, 2.3 * (1 - samples / (BUDGET * 1.6)));
    for (i = Math.max(0, nodes.length - 130); i < nodes.length; i++) {
      n = nodes[i];
      if (n.g < 1) continue;
      ctx.moveTo(n.x + dot, n.y);
      ctx.arc(n.x, n.y, dot, 0, TAU);
    }
    ctx.fill();
    if (nodes.length > 1) {
      var tip = nodes[nodes.length - 1];
      ctx.fillStyle = mix(palette.accent2, 0.95 * fade, '#7aa2ff');
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 3.2, 0, TAU);
      ctx.fill();
    }
  }
  function wallPath(w) {
    var r = Math.min(4, w.hh);
    ctx.beginPath();
    ctx.moveTo(-w.hw + r, -w.hh);
    ctx.lineTo(w.hw - r, -w.hh);
    ctx.quadraticCurveTo(w.hw, -w.hh, w.hw, -w.hh + r);
    ctx.lineTo(w.hw, w.hh - r);
    ctx.quadraticCurveTo(w.hw, w.hh, w.hw - r, w.hh);
    ctx.lineTo(-w.hw + r, w.hh);
    ctx.quadraticCurveTo(-w.hw, w.hh, -w.hw, w.hh - r);
    ctx.lineTo(-w.hw, -w.hh + r);
    ctx.quadraticCurveTo(-w.hw, -w.hh, -w.hw + r, -w.hh);
    ctx.closePath();
  }
  function drawWalls() {
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      ctx.save();
      ctx.translate(w.cx, w.cy);
      ctx.rotate(w.a);
      wallPath(w);
      ctx.fillStyle = w.cage ? mix(palette.cage, 0.09, '#ff9d5c') : palette.wallFill;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = w.cage ? mix(palette.cage, 0.2, '#ff9d5c') : palette.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      var span = w.hw + w.hh;
      for (var s = -span; s < span; s += 9) {
        ctx.moveTo(s, -w.hh - 2);
        ctx.lineTo(s + w.hh * 2 + 4, w.hh + 2);
      }
      ctx.stroke();
      ctx.restore();
      wallPath(w);
      ctx.strokeStyle = w.cage ? mix(palette.cage, 0.64, '#ff9d5c') : palette.wallEdge;
      ctx.lineWidth = w.cage ? 1.4 : 1;
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawGoal(t) {
    var i, p, r;
    if (fade > 0.9) {
      for (i = 0; i < 3; i++) {
        p = ((t * 0.42) + i / 3) % 1;
        r = GOAL_R * (0.92 + p * 0.7);
        ctx.strokeStyle = mix(palette.accent2, (1 - p) * 0.28, '--accent-2');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(goal.x, goal.y, r, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -t * 14;
    ctx.strokeStyle = mix(palette.accent2, 0.75, '--accent-2');
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(goal.x, goal.y, GOAL_R * 0.82, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(goal.x - 8, goal.y - 11);
    ctx.lineTo(goal.x + 3, goal.y - 11);
    ctx.lineTo(goal.x + 8, goal.y - 6);
    ctx.lineTo(goal.x + 8, goal.y + 11);
    ctx.lineTo(goal.x - 8, goal.y + 11);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(goal.x + 3, goal.y - 11);
    ctx.lineTo(goal.x + 3, goal.y - 6);
    ctx.lineTo(goal.x + 8, goal.y - 6);
    ctx.moveTo(goal.x - 4, goal.y - 1);
    ctx.lineTo(goal.x + 4, goal.y - 1);
    ctx.moveTo(goal.x - 4, goal.y + 4);
    ctx.lineTo(goal.x + 4, goal.y + 4);
    ctx.stroke();
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = palette.text;
    ctx.fillText('目标页面 /404', goal.x, goal.y + GOAL_R + 16);
  }
  function drawStart(t) {
    ctx.strokeStyle = mix(palette.accent, 0.3 + (fade > 0.9 ? 0.16 * (0.5 + 0.5 * Math.sin(t * 2.4)) : 0), '--accent');
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 11, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = mix(palette.accent, 0.95, '--accent');
    ctx.beginPath();
    ctx.arc(start.x, start.y, 4.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = palette.text;
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('起点', start.x, start.y + 26);
  }
  function drawFlashes(dt) {
    for (var i = flashes.length - 1; i >= 0; i--) {
      var f = flashes[i];
      f.life -= dt * 1.9;
      if (f.life <= 0) { flashes.splice(i, 1); continue; }
      var a = f.life;
      ctx.strokeStyle = mix(palette.danger, a * 0.75, '#ff6880');
      ctx.lineWidth = 1.3;
      var r = 3 + (1 - a) * 9;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(f.x - 3, f.y - 3); ctx.lineTo(f.x + 3, f.y + 3);
      ctx.moveTo(f.x + 3, f.y - 3); ctx.lineTo(f.x - 3, f.y + 3);
      ctx.stroke();
    }
  }
  function drawStamp(prog) {
    if (prog <= 0) return;
    var w = Math.min(252, W * 0.62), h = 50;
    ctx.save();
    ctx.globalAlpha = prog * 0.95;
    ctx.translate(W / 2, H * 0.5);
    ctx.rotate(-0.055);
    ctx.strokeStyle = mix(palette.danger, 0.85, '#ff6880');
    ctx.lineWidth = 2.4;
    ctx.setLineDash([9, 6]);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = mix(palette.danger, 0.13, '#ff6880');
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = mix(palette.danger, 1, '#ff6880');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 20px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText('规划失败 · 无可行路径', 0, 1);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }
  function paintHud(force) {
    var now = performance.now();
    if (!force && now - hudAt < 110) return;
    hudAt = now;
    if (statsEl) {
      statsEl.textContent = '采样 ' + samples + ' / ' + BUDGET +
        '　碰撞 ' + collisions + '　节点 ' + nodes.length;
    }
    if (barEl) barEl.style.width = (samples / BUDGET * 100).toFixed(1) + '%';
    if (statusEl) {
      if (phase === 'grow') { statusEl.textContent = '搜索中…'; statusEl.setAttribute('data-state', 'run'); }
      else { statusEl.textContent = '无可行路径'; statusEl.setAttribute('data-state', 'fail'); }
    }
  }
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    var t = ts / 1000;
    if (phase === 'grow') {
      step(Math.max(2, Math.round(BUDGET / 6 * dt)));
      fade = Math.min(1, fade + dt * 1.6);
    } else if (hold !== Infinity) {
      hold -= dt;
      fade = Math.max(0, Math.min(1, hold / 0.8));
      if (hold <= 0) { layout(); return; }
    }
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].g < 1) nodes[i].g = Math.min(1, nodes[i].g + dt * 7);
    }
    ctx.clearRect(0, 0, W, H);
    drawGrid();
    drawTree();
    drawWalls();
    drawGoal(t);
    drawStart(t);
    drawFlashes(dt);
    drawStamp(phase === 'failed' && hold !== Infinity
      ? Math.min(1, Math.max(0, (FAIL_HOLD - hold) / 0.5)) : 0);
    paintHud(false);
  }
  function running() {
    return !motionQuery.matches && root.getAttribute('data-motion') !== 'off';
  }
  function start_() {
    stop();
    if (!running()) { settle(); paint(); return; }
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function paint() {
    ctx.clearRect(0, 0, W, H);
    drawGrid();
    drawTree();
    drawWalls();
    drawGoal(0);
    drawStart(0);
    drawStamp(phase === 'failed' ? 1 : 0);
    paintHud(true);
  }
  function resize() {
    var r = stage.getBoundingClientRect();
    var w = Math.max(300, Math.round(r.width));
    var h = Math.max(210, Math.round(r.height));
    if (w === W && h === H) return false;
    W = w; H = h;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return true;
  }
  cv.addEventListener('pointerdown', function (e) {
    var r = cv.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    if (Math.hypot(x - goal.x, y - goal.y) < GOAL_R + 40) return;
    if (userWalls.length >= 7) userWalls.shift();
    userWalls.push({ cx: x, cy: y, hw: 34, hh: 11, a: (Math.random() - 0.5) * 1.2 });
    if (hintEl) hintEl.textContent = '已放置 ' + userWalls.length + ' 个障碍 · 再点几下试试';
    restart();
  });
  if (retryEl) {
    retryEl.addEventListener('click', function () {
      userWalls = [];
      if (hintEl) hintEl.textContent = '点一下画面可以丢一个障碍物进去';
      restart();
    });
  }
  if (window.MutationObserver) {
    new MutationObserver(function () {
      readPalette();
      if (running()) { if (!raf) start_(); }
      else { stop(); settle(); paint(); }
    }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-motion'] });
  }
  if (motionQuery.addEventListener) {
    motionQuery.addEventListener('change', function () { start_(); });
  }
  function onResize() {
    if (!resize()) return;
    layout();
    start_();
  }
  if (window.ResizeObserver) {
    new ResizeObserver(onResize).observe(stage);
  } else {
    window.addEventListener('resize', onResize);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (!raf && W) start_();
  });
  readPalette();
  resize();
  layout();
  start_();
})();