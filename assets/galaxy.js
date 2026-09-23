(function () {
  'use strict';
  var cv = document.getElementById('hero-galaxy');
  if (!cv || !cv.getContext) return;
  var hero = cv.parentNode;
  var ctx = cv.getContext('2d');
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var TAU = Math.PI * 2;
  var TILT = 1.06;              
  var ARMS = 3;                 
  var TIGHT = 2.05;             
  var MAXP = 1400, MINP = 380;
  var Q = 0.6;                  
  var LEVELS = [0.26, 0.46, 0.66, 0.92];
  var parts = [], sprites = [], warm = [255, 180, 120], cool = [120, 160, 255];
  var buf = document.createElement('canvas');
  var bctx = buf.getContext('2d');
  var W = 0, H = 0, BW = 0, BH = 0, DPR = 1;
  var cx = 0, cy = 0, RAD = 240, PSPR = 3.4;
  var raf = 0, last = 0, live = false, visible = true;
  var yaw = 0.6;
  var px = 0, py = 0, tpx = 0, tpy = 0;      
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
    out.x = cx + x * RAD * k + px * (0.16 + 0.5 * p.r) * RAD * 0.13;
    out.y = cy + y2 * RAD * k + py * (0.10 + 0.3 * p.r) * RAD * 0.10;
    out.k = k;
    out.depth = z2;
    return out;
  }
  var pt = { x: 0, y: 0, k: 0, depth: 0 };
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
      if (pt.x < -40 || pt.x > BW + 40 || pt.y < -40 || pt.y > BH + 40) continue;
      var depth = 0.55 + 0.45 * (1 - Math.min(1, Math.max(0, (pt.depth + 1) / 2)));
      var tier = p.r < 0.3 ? 1 : 2;
      var size = p.s * PSPR * pt.k * (p.r < 0.18 ? 1.9 : 1);
      if (size < 1.3) { tier = 0; size = 1.3; }
      var lv = (p.lv + (depth > 0.86 ? 1 : 0)) % LEVELS.length;
      bctx.drawImage(sprites[tier][lv], pt.x - size, pt.y - size, size * 2, size * 2);
    }
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
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    BW = Math.max(200, Math.round(W * Q));
    BH = Math.max(180, Math.round(H * Q));
    buf.width = BW; buf.height = BH;
    cx = BW * 0.66;              
    cy = BH * 0.48;
    RAD = Math.min(BW * 0.40, BH * 0.62);
    PSPR = Math.max(2.8, RAD / 52);
    return true;
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
    last = t;
    yaw += dt * 0.055;
    px += (tpx - px) * Math.min(1, dt * 3.2);
    py += (tpy - py) * Math.min(1, dt * 3.2);
    draw();
  }
  function frozen() {
    return reduce.matches || root.getAttribute('data-motion') === 'off';
  }
  function start() {
    if (raf || !live) return;
    if (frozen()) { draw(); return; }
    last = 0;
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
    else { stop(); draw(); }
  }
  if (window.MutationObserver) {
    new MutationObserver(function () { readPalette(); draw(); sync(); })
      .observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-motion'] });
  }
  if (reduce.addEventListener) reduce.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pointermove', function (e) {
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
      return { parts: parts.length, w: W, h: H, bw: BW, bh: BH, q: Q };
    },
    setParts: function (n) { MAXP = n; MINP = n; build(); sync(); }
  };
})();