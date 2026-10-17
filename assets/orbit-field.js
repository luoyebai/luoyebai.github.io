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
  var debug = /[?&]motion-debug=1(?:&|$)/.test(window.location.search || '');
  var metrics = null, costs = [], intervals = [], metricAt = 0;
  var TAU = Math.PI * 2;
  var ignored = 'a,button,input,textarea,select,[contenteditable]';
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function ease(v, target, rate, dt) { return dt ? target + (v - target) * Math.exp(-rate * dt) : v; }
  function staticMode() { return paused || reduce.matches || root.getAttribute('data-motion') === 'off'; }
  function unavailable() { return staticMode() || !visible || document.hidden; }
  function palette() {
    var style = getComputedStyle(root);
    function color(name, fallback) { return style.getPropertyValue(name).trim() || fallback; }
    colors = {
      accent: color('--accent', '#67d6d1'), warm: color('--accent-2', '#e8b67c'),
      text: color('--text', '#e4edf5'), muted: color('--text-3', '#8291a5'),
      bg: color('--bg', '#101723'), light: root.getAttribute('data-mode') === 'light'
    };
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
    draw();
  }
  function project(x, y, z, out) {
    var yaw = -.48 + time * .065 + px * .24 + spin;
    var pitch = .42 + py * .16, roll = -.12;
    var ax = x * Math.cos(yaw) + z * Math.sin(yaw);
    var az = -x * Math.sin(yaw) + z * Math.cos(yaw);
    var ay = y * Math.cos(pitch) - az * Math.sin(pitch);
    var depth = y * Math.sin(pitch) + az * Math.cos(pitch);
    var k = 4.8 / (4.8 + depth);
    var scale = 1 + deformation;
    out.x = cx + (ax * Math.cos(roll) - ay * Math.sin(roll)) * radius * k * scale;
    out.y = cy - (ax * Math.sin(roll) + ay * Math.cos(roll)) * radius * k * scale;
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
  function drawAnnotations() {
    context.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textBaseline = 'middle'; context.fillStyle = colors.muted;
    var labels = ['SIGNAL', 'MOTION', 'POLICY'];
    var positions = [[.09,.23], [.82,.36], [.14,.76]];
    context.globalAlpha = .72;
    for (var i = 0; i < 3; i++) {
      var x = W * positions[i][0], y = H * positions[i][1];
      context.textAlign = i === 1 ? 'right' : 'left'; context.fillStyle = i === modes.indexOf(mode) ? pathColor(i) : colors.muted;
      context.fillText(labels[i], x, y);
      context.strokeStyle = context.fillStyle; context.lineWidth = .65;
      var direction = i === 1 ? -1 : 1;
      context.beginPath(); context.moveTo(x, y + 11); context.lineTo(x + direction * 24, y + 11);
      context.lineTo(x + direction * 34, y + 20); context.stroke();
    }
    context.textAlign = 'center'; context.fillStyle = colors.muted; context.globalAlpha = .55;
    context.fillText('x', W*.80, H*.79); context.fillText('y', W*.23, H*.86);
  }
  function draw() {
    if (!W || !H) return; draws++;
    context.setTransform(DPR, 0, 0, DPR, 0, 0); context.clearRect(0, 0, W, H);
    context.lineCap = 'round'; context.lineJoin = 'round';
    if (glow) { context.globalAlpha = colors.light ? .045 : .085; context.drawImage(glow, cx-radius*1.5, cy-radius*1.5, radius*3, radius*3); }
    drawGround();
    paths.forEach(function (path, index) {
      for (var i = 0; i <= segments; i++) point(index, i / segments * TAU, path[i]);
      strokePath(path, pathColor(index), colors.light ? .28 : .29, .85, -1);
      drawTraveller(index, time * (.23 + index * .045) + index * 2.0 + .5, false);
    });
    drawCore();
    paths.forEach(function (path, index) {
      strokePath(path, pathColor(index), index === 2 ? .55 : .78, index === 2 ? .85 : 1.05, 1);
      drawTraveller(index, time * (.23 + index * .045) + index * 2.0 + .5, true);
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
  document.addEventListener('visibilitychange', sync);
  if (reduce.addEventListener) reduce.addEventListener('change', sync);
  if (window.IntersectionObserver) new IntersectionObserver(function(entries) { visible = entries[0].isIntersecting; sync(); }).observe(stage);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  if (window.MutationObserver) new MutationObserver(function(records) {
    if (records.some(function(r) {return r.attributeName !== 'data-motion';})) { palette(); resize(); draw(); }
    sync();
  }).observe(root, {attributes:true, attributeFilter:['data-theme','data-mode','data-motion','data-performance','style']});
  palette(); resize(); stage.classList.add('is-ready'); if (controls) controls.hidden = false;
  if (debug) {
    metrics = document.createElement('output'); metrics.className = 'orbit-metrics'; metrics.id = 'orbit-motion-metrics';
    visual.appendChild(metrics);
  }
  window.__orbitField = {info:function() {return {
    running:!!raf, mode:mode, time:time, paused:paused, draws:draws, width:W, height:H,
    interaction:{kind:interaction.kind,strength:interaction.strength,held:interaction.held},
    quality:compact?'compact':'full', segments:segments, weights:weights.slice(), pointer:[px,py], deformation:deformation
  };}};
  sync();
})();