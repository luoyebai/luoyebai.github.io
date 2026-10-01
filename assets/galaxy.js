(function () {
  'use strict';
  var cv = document.getElementById('hero-galaxy');
  if (!cv || !cv.getContext) return;
  var hero = cv.parentNode;
  var ctx = cv.getContext('2d');
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var TAU = Math.PI * 2;
  var TILT = 0.64;              
  var ARMS = 3;                 
  var TIGHT = 2.05;             
  var compact = root.getAttribute('data-performance') === 'compact';
  var MAXP = compact ? 650 : 1250, MINP = compact ? 280 : 460;
  var Q = compact ? 0.55 : 0.7;
  var lastPaint = 0, frameBudget = 1000 / 30;
  var LEVELS = [0.26, 0.46, 0.66, 0.92];
  var parts = [], sprites = [], warm = [255, 180, 120], cool = [120, 160, 255];
  var buf = document.createElement('canvas');
  var bctx = buf.getContext('2d');
  var W = 0, H = 0, BW = 0, BH = 0, DPR = 1;
  var cx = 0, cy = 0, RAD = 240, PSPR = 3.4;
  var raf = 0, last = 0, live = false, visible = true;
  var yaw = 0.6;
  var paused = false;
  var pauseBtn = document.querySelector('[data-galaxy-pause]');
  var px = 0, py = 0, tpx = 0, tpy = 0;      
  var actionButtons = hero.querySelectorAll('[data-galaxy-action]');
  var status = hero.querySelector('[data-galaxy-status]');
  var interaction = null, activePointer = null;
  var actionNames = ['attract', 'burst', 'repel'];
  var ignoredTargets = 'a,button,input,textarea,select,[contenteditable],.hero-title,.hero-sub,.hero-eyebrow,.hero-id,.hero-stats,[data-galaxy-controls]';
  var lastState = '', lastStatus = '', lastDisabled = null;
  function toRgb(c) {
    if (!c) return null;
    c = String(c).trim();
    var m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var m2 = c.match(/^rgba?\(([^)]+)\)/i);
    if (m2) {
      var p = m2[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
      if (p.length >= 3) return [p[0], p[1], p[2]];
    }
    return null;
  }
  function makeSprite(rgb, a, size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var x = c.getContext('2d');
    var r = size / 2;
    var col = rgb ? (rgb[0] + ',' + rgb[1] + ',' + rgb[2]) : '255,255,255';
    var g = x.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(' + col + ',' + a + ')');
    g.addColorStop(0.22, 'rgba(' + col + ',' + (a * 0.72).toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(' + col + ',' + (a * 0.16).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(' + col + ',0)');
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    return c;
  }
  function readPalette() {
    var cs = getComputedStyle(root);
    function g(n, f) { return (cs.getPropertyValue(n) || '').trim() || f; }
    warm = toRgb(g('--accent-2', '#ff9d5c')) || warm;
    cool = toRgb(g('--accent', '#7aa2ff')) || cool;
    var tiers = [null, warm, cool];
    sprites = [];
    for (var t = 0; t < tiers.length; t++) {
      var row = [];
      for (var i = 0; i < LEVELS.length; i++) row.push(makeSprite(tiers[t], LEVELS[i], 64));
      sprites.push(row);
    }
  }
  function build() {
    var n = Math.max(MINP, Math.min(MAXP, Math.round(RAD * RAD / 78)));
    parts = [];
    for (var i = 0; i < n; i++) {
      var core = Math.random() < 0.12;
      var t = core ? Math.pow(Math.random(), 2.2) : Math.sqrt(Math.random());
      var arm = i % ARMS;
      var spread = (0.34 + 0.30 * (1 - t)) * (Math.random() - 0.5) * 2;
      var ang = arm * TAU / ARMS + t * TIGHT * Math.PI + spread;
      var r = core ? t * 0.24 : 0.12 + t * 0.88 + (Math.random() - 0.5) * 0.07;
      var h = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      parts.push({
        r: r,
        a: ang,
        y: h * (0.035 + 0.16 * r),
        s: (core ? 0.85 : 0.4) + Math.random() * (core ? 0.8 : 0.7),
        lv: (Math.random() * LEVELS.length) | 0
      });
    }
    parts.sort(function (p, q) { return p.r - q.r; });   
  }
  function project(p, out) {
    var ang = p.a + yaw * (0.55 / (0.34 + p.r));      
    var x = Math.cos(ang) * p.r;
    var z = Math.sin(ang) * p.r;
    var y2 = p.y * Math.cos(TILT) - z * Math.sin(TILT);
    var z2 = p.y * Math.sin(TILT) + z * Math.cos(TILT);
    var k = 2.35 / (2.35 + z2);
    var roll = -0.28, cr = Math.cos(roll), sr = Math.sin(roll);
    out.x = cx + (x * cr - y2 * sr) * RAD * k + px * (0.16 + 0.5 * p.r) * RAD * 0.13;
    out.y = cy + (x * sr + y2 * cr) * RAD * k + py * (0.10 + 0.3 * p.r) * RAD * 0.10;
    out.k = k;
    out.depth = z2;
    return out;
  }
  var pt = { x: 0, y: 0, k: 0, depth: 0 };
  function unavailable() {
    return frozen() || !visible || document.hidden;
  }
  function updateControls() {
    var disabled = unavailable();
    var state = disabled ? 'paused' : (interaction ? interaction.mode : 'idle');
    var message = '移动鼠标或点击按钮探索星系';
    if (reduce.matches || root.getAttribute('data-motion') === 'off') message = '请先开启动效，再探索星系';
    else if (paused) message = '请先继续星系动效';
    else if (!visible || document.hidden) message = '星系回到视野后继续';
    else if (state === 'attract') message = '引力汇聚 · 星尘正在靠近';
    else if (state === 'repel') message = '斥力涟漪 · 星尘向外散开';
    else if (state === 'burst') message = '星爆展开 · 旋臂即将归位';
    if (state !== lastState) { hero.setAttribute('data-galaxy-state', state); lastState = state; }
    if (status && message !== lastStatus) { status.textContent = message; lastStatus = message; }
    if (disabled !== lastDisabled) {
      for (var i = 0; i < actionButtons.length; i++) actionButtons[i].disabled = disabled;
      lastDisabled = disabled;
    }
  }
  function releasePointer() {
    var pointer = activePointer;
    activePointer = null;
    if (pointer !== null && hero.releasePointerCapture) {
      try { if (!hero.hasPointerCapture || hero.hasPointerCapture(pointer)) hero.releasePointerCapture(pointer); } catch (ignore) {}
    }
  }
  function clearInteraction() {
    releasePointer();
    interaction = null;
    updateControls();
  }
  function releaseInteraction() {
    releasePointer();
    if (interaction && interaction.held) {
      interaction.held = false;
      interaction.releaseAge = 0;
    }
  }
  function beginInteraction(mode, x, y, held) {
    if (unavailable()) { clearInteraction(); return false; }
    interaction = { mode: mode, x: x, y: y, age: 0, releaseAge: 0, held: !!held, strength: 0 };
    updateControls();
    return true;
  }
  function advanceInteraction(dt) {
    if (!interaction) return;
    var a = interaction;
    a.age += dt;
    if (a.mode === 'burst') {
      a.strength = Math.sin(Math.min(1, a.age / 1.8) * Math.PI);
      if (a.age >= 1.8) { interaction = null; updateControls(); }
    } else {
      if (!a.held) a.releaseAge += dt;
      a.strength = Math.min(1, a.age / 0.12) * Math.pow(Math.max(0, 1 - a.releaseAge / 0.95), 0.7);
      if (!a.held && a.releaseAge >= 0.95) { interaction = null; updateControls(); }
    }
  }
  function displace(point) {
    if (!interaction) return;
    var a = interaction;
    var dx = point.x - a.x, dy = point.y - a.y;
    var distance = Math.sqrt(dx * dx + dy * dy);
    var radius = RAD * (a.mode === 'burst' ? 1.9 : 1.1);
    var falloff = Math.max(0, 1 - distance / radius);
    if (!falloff || distance < 0.01) return;
    var amount;
    if (a.mode === 'burst') amount = RAD * 0.72 * a.strength * Math.sqrt(falloff) / distance;
    else amount = (a.mode === 'attract' ? -0.88 : 1.05) * falloff * a.strength;
    point.x += dx * amount;
    point.y += dy * amount;
  }
  function drawInteraction() {
    if (!interaction || interaction.strength <= 0) return;
    var a = interaction, burst = a.mode === 'burst';
    var color = a.mode === 'attract' ? warm : cool;
    var rgb = color.join(',');
    var progress = Math.min(1, a.age / 1.8);
    var radius = RAD * (burst ? 0.12 + progress * 1.75 : 0.44);
    var alpha = a.strength * (burst ? 0.20 : 0.26);
    var glow = bctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, radius);
    glow.addColorStop(0, 'rgba(' + rgb + ',' + (alpha * 0.38).toFixed(3) + ')');
    glow.addColorStop(burst ? 0.82 : 0.70, 'rgba(' + rgb + ',' + (alpha * 0.5).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(' + rgb + ',0)');
    bctx.fillStyle = glow;
    bctx.beginPath();
    bctx.arc(a.x, a.y, radius, 0, TAU);
    bctx.fill();
    bctx.strokeStyle = 'rgba(' + rgb + ',' + (alpha * 1.75).toFixed(3) + ')';
    bctx.lineWidth = Math.max(0.9, Q * 1.4);
    bctx.beginPath();
    bctx.arc(a.x, a.y, radius * (burst ? 0.88 : 0.76), 0, TAU);
    bctx.stroke();
  }
  function draw() {
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, BW, BH);
    bctx.globalCompositeOperation = 'lighter';
    var coreR = RAD * 1.15;
    var g = bctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    g.addColorStop(0, 'rgba(' + warm[0] + ',' + warm[1] + ',' + warm[2] + ',0.19)');
    g.addColorStop(0.28, 'rgba(' + warm[0] + ',' + warm[1] + ',' + warm[2] + ',0.07)');
    g.addColorStop(0.62, 'rgba(' + cool[0] + ',' + cool[1] + ',' + cool[2] + ',0.032)');
    g.addColorStop(1, 'rgba(' + cool[0] + ',' + cool[1] + ',' + cool[2] + ',0)');
    bctx.fillStyle = g;
    bctx.beginPath();
    bctx.arc(cx, cy, coreR, 0, TAU);
    bctx.fill();
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      project(p, pt);
      displace(pt);
      if (pt.x < -40 || pt.x > BW + 40 || pt.y < -40 || pt.y > BH + 40) continue;
      var depth = 0.55 + 0.45 * (1 - Math.min(1, Math.max(0, (pt.depth + 1) / 2)));
      var tier = p.r < 0.3 ? 1 : 2;
      var size = p.s * PSPR * pt.k * (p.r < 0.18 ? 1.3 : 1);
      if (p.r < 0.10) tier = 0;
      if (size < 1.3) { tier = 0; size = 1.3; }
      var lv = (p.lv + (depth > 0.86 ? 1 : 0)) % LEVELS.length;
      bctx.drawImage(sprites[tier][lv], pt.x - size, pt.y - size, size * 2, size * 2);
    }
    drawInteraction();
    bctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(buf, 0, 0, BW, BH, 0, 0, W, H);
  }
  function resize() {
    var r = hero.getBoundingClientRect();
    var w = Math.max(320, Math.round(r.width));
    var h = Math.max(280, Math.round(r.height));
    if (w === W && h === H) return false;
    W = w; H = h;
    DPR = Math.min(compact ? 1 : 1.5, window.devicePixelRatio || 1);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    BW = Math.max(200, Math.round(W * Q));
    BH = Math.max(180, Math.round(H * Q));
    buf.width = BW; buf.height = BH;
    cx = BW * 0.76;              
    cy = BH * 0.48;
    RAD = Math.min(BW * 0.35, BH * 0.66);
    PSPR = Math.max(1.7, RAD / 100);
    return true;
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (lastPaint && t - lastPaint < frameBudget - 1) return;
    lastPaint = t;
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
    last = t;
    yaw += dt * 0.055;
    px += (tpx - px) * Math.min(1, dt * 3.2);
    py += (tpy - py) * Math.min(1, dt * 3.2);
    advanceInteraction(dt);
    draw();
  }
  function frozen() {
    return paused || reduce.matches || root.getAttribute('data-motion') === 'off';
  }
  function start() {
    if (raf || !live) return;
    if (frozen()) { draw(); return; }
    last = 0;
    lastPaint = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function sync() {
    live = parts.length > 0;
    if (!live) return;
    if (visible && !document.hidden && !frozen()) start();
    else { stop(); clearInteraction(); draw(); }
    updateControls();
  }
  if (pauseBtn) pauseBtn.addEventListener('click', function () {
    paused = !paused;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.textContent = paused ? '继续星系动效' : '暂停星系动效';
    sync();
  });
  if (window.MutationObserver) {
    new MutationObserver(function () { readPalette(); draw(); sync(); })
      .observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-motion'] });
  }
  if (reduce.addEventListener) reduce.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  function isMouse(e) { return !e.pointerType || e.pointerType === 'mouse'; }
  function interactionPoint(e) {
    if (!isMouse(e) || (e.target && e.target.closest && e.target.closest(ignoredTargets))) return null;
    var r = hero.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < r.width * 0.46 || x > r.width || y < 0 || y > r.height) return null;
    return { x: x * BW / r.width, y: y * BH / r.height };
  }
  hero.addEventListener('pointerdown', function (e) {
    if (e.button < 0 || e.button > 2 || (e.button === 2 && e.shiftKey)) return;
    var point = interactionPoint(e);
    if (!point) return;
    if (unavailable()) { clearInteraction(); return; }
    releasePointer();
    if (!beginInteraction(actionNames[e.button], point.x, point.y, e.button !== 1)) return;
    e.preventDefault();
    if (e.button !== 1) {
      activePointer = e.pointerId;
      if (hero.setPointerCapture) { try { hero.setPointerCapture(e.pointerId); } catch (ignore) {} }
    }
  });
  hero.addEventListener('mousedown', function (e) {
    if (e.button === 1 && !unavailable() && interactionPoint(e)) e.preventDefault();
  });
  hero.addEventListener('auxclick', function (e) {
    if (e.button === 1 && !unavailable() && interactionPoint(e)) e.preventDefault();
  });
  hero.addEventListener('contextmenu', function (e) {
    if (!e.shiftKey && !unavailable() && interactionPoint(e)) e.preventDefault();
  });
  window.addEventListener('pointerup', function (e) {
    if (activePointer !== null && e.pointerId === activePointer) releaseInteraction();
  });
  window.addEventListener('pointercancel', function (e) {
    if (isMouse(e) && interaction && (activePointer === null || e.pointerId === activePointer)) clearInteraction();
  });
  hero.addEventListener('lostpointercapture', function (e) {
    if (activePointer !== null && e.pointerId === activePointer) releaseInteraction();
  });
  hero.addEventListener('pointerleave', releaseInteraction);
  window.addEventListener('blur', function () { clearInteraction(); if (live) draw(); });
  for (var actionIndex = 0; actionIndex < actionButtons.length; actionIndex++) {
    actionButtons[actionIndex].addEventListener('click', function (e) {
      var mode = e.currentTarget.getAttribute('data-galaxy-action');
      if (actionNames.indexOf(mode) === -1) return;
      releasePointer();
      beginInteraction(mode, cx, cy, false);
    });
  }
  window.addEventListener('pointermove', function (e) {
    if (!isMouse(e) || unavailable()) return;
    if (activePointer !== null && e.pointerId === activePointer) {
      if (e.buttons === 0) releaseInteraction();
      else {
        var point = interactionPoint(e);
        if (!point) releaseInteraction();
        else if (interaction) { interaction.x = point.x; interaction.y = point.y; }
      }
    }
    if (compact) return;
    var r = hero.getBoundingClientRect();
    tpx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    tpy = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
  }, { passive: true });
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      sync();
    }, { threshold: 0 }).observe(hero);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(function () { if (resize()) { build(); sync(); } }).observe(hero);
  } else {
    window.addEventListener('resize', function () { if (resize()) { build(); sync(); } });
  }
  readPalette();
  resize();
  build();
  var controls = hero.querySelector('[data-galaxy-controls]');
  if (controls) controls.hidden = false;
  sync();
  if (window.__boot) {
    window.__boot.label('hero', '正在点亮星系');
    window.__boot.progress('hero', 60);
    requestAnimationFrame(function () {
      window.__boot.done('hero');
    });
  }
  window.__galaxy = {
    bench: function (n) {
      n = n || 60;
      var t0 = performance.now();
      for (var i = 0; i < n; i++) { yaw += 0.01; draw(); }
      return (performance.now() - t0) / n;
    },
    info: function () {
      return {
        parts: parts.length, w: W, h: H, bw: BW, bh: BH, q: Q,
        state: lastState, held: !!(interaction && interaction.held),
        strength: interaction ? interaction.strength : 0,
        point: interaction ? [interaction.x, interaction.y] : null,
        running: !!raf
      };
    },
    setParts: function (n) { MAXP = n; MINP = n; build(); sync(); }
  };
})();