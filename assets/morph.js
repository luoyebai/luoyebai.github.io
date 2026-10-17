(function () {
  'use strict';
  var cv = document.getElementById('morph-canvas');
  if (!cv || !cv.getContext) return;
  var hero = document.querySelector('.hero');
  var headEl = document.querySelector('[data-morph="head"]');
  var cardEls = [].slice.call(document.querySelectorAll(
    '.direction-card, .lab-invitation, .post-card, .project-card'));
  if (!hero || !headEl || !cardEls.length) return;
  var root = document.documentElement;
  var ctx = cv.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var compact = root.getAttribute('data-performance') === 'compact';
  var TAU = Math.PI * 2;
  var TILT = 0.64, ARMS = 3, TIGHT = 2.05;      
  var TRAVEL = 0.80;                            
  var SPAN = 1.10;                              
  var N = compact ? 520 : 1200;                 
  var Q = compact ? 0.5 : 0.62;                 
  var LEVELS = [0.26, 0.46, 0.66, 0.92];
  var buf = document.createElement('canvas');
  var bctx = buf.getContext('2d');
  var W = 0, H = 0, BW = 0, BH = 0, DPR = 1;
  var sprites = [], strokeCols = ['255,255,255', '255,180,120', '120,160,255'];
  var warm = [255, 180, 120], cool = [120, 160, 255];
  var parts = [];
  var textPts = [];
  var live = false, raf = 0, lastPaint = 0, frameBudget = 1000 / 30;
  var progress = 0, targetProgress = 0, time = 0;
  var headTop = null;                           
  var headBox = null;                           
  var lastVars = { head: -1 };
  var sampleInfo = null;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function ss(a, b, x) {              
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
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
    strokeCols = ['255,255,255', warm.join(','), cool.join(',')];
    var tiers = [null, warm, cool];
    sprites = [];
    for (var t = 0; t < tiers.length; t++) {
      var row = [];
      for (var i = 0; i < LEVELS.length; i++) row.push(makeSprite(tiers[t], LEVELS[i], 64));
      sprites.push(row);
    }
  }
  function build() {
    parts = [];
    for (var i = 0; i < N; i++) {
      var core = Math.random() < 0.12;
      var t = core ? Math.pow(Math.random(), 2.2) : Math.sqrt(Math.random());
      var arm = i % ARMS;
      var spread = (0.34 + 0.30 * (1 - t)) * (Math.random() - 0.5) * 2;
      var ang = arm * TAU / ARMS + t * TIGHT * Math.PI + spread;
      var r = core ? t * 0.24 : 0.12 + t * 0.88 + (Math.random() - 0.5) * 0.07;
      var h = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      parts.push({
        r: r, a: ang, y: h * (0.035 + 0.16 * r),
        s: (core ? 0.85 : 0.4) + Math.random() * (core ? 0.8 : 0.7),
        lv: (Math.random() * LEVELS.length) | 0,
        nx: Math.cos(Math.random() * TAU), ny: Math.sin(Math.random() * TAU),
        nph: Math.random() * TAU,
        ptone: Math.random(),                     
        tx: 0, ty: 0, ci: 0, cu: 0
      });
    }
    parts.sort(function (p, q) { return p.r - q.r; });
    assign();
  }
  function onRect(r, u) {
    var per = 2 * (r.w + r.h) || 1;
    var d = u * per;
    if (d < r.w) return [r.x + d, r.y];
    d -= r.w;
    if (d < r.h) return [r.x + r.w, r.y + d];
    d -= r.h;
    if (d < r.w) return [r.x + r.w - d, r.y + r.h];
    d -= r.w;
    return [r.x, r.y + r.h - d];
  }
  function assign() {
    if (textPts.length) {
      var ps = parts.slice().sort(function (p, q) {
        var px = Math.cos(p.a) * p.r, qx = Math.cos(q.a) * q.r;
        return (px - qx) || (p.y - q.y);
      });
      for (var i = 0; i < ps.length; i++) {
        var pt = textPts[Math.floor(i * textPts.length / ps.length)];
        ps[i].word = true;
        ps[i].tx = pt[0];
        ps[i].ty = pt[1];
      }
    }
    var per = cardEls.map(function (el) {
      var r = el.getBoundingClientRect();
      return 2 * (r.width + r.height);
    });
    var total = per.reduce(function (a, b) { return a + b; }, 0) || 1;
    var cursor = 0, ci = 0, inCard = 0;
    var counts = per.map(function (p) { return Math.max(4, Math.round(N * p / total)); });
    for (var k = 0; k < parts.length; k++) {
      while (ci < counts.length - 1 && inCard >= counts[ci]) { ci++; inCard = 0; }
      parts[k].ci = ci;
      parts[k].cu = (inCard + 0.5) / counts[ci];
      inCard++;
      cursor++;
    }
    void cursor;
  }
  function sampleText(text) {
    text = (text || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    var h2 = headEl.querySelector('h2') || headEl;
    var hcs = getComputedStyle(h2);
    var family = hcs.fontFamily || 'sans-serif';
    var weight = hcs.fontWeight || '700';
    var ch = 200;                                  
    var size = Math.max(16, Math.round(ch * lineRatio()));
    var probe = document.createElement('canvas');
    var pctx = probe.getContext('2d');
    pctx.font = weight + ' ' + size + 'px ' + family;
    var m = Math.max(8, Math.ceil(pctx.measureText(text).width));
    var c = document.createElement('canvas');
    c.width = m; c.height = ch;
    var x = c.getContext('2d');
    x.font = weight + ' ' + size + 'px ' + family;
    x.textAlign = 'left';
    x.textBaseline = 'middle';
    x.fillStyle = '#fff';
    x.fillText(text, 0, ch / 2);
    sampleInfo = { w: m, h: ch, font: size };
    var data;
    try { data = x.getImageData(0, 0, m, ch).data; } catch (e) { return []; }
    var pts = [];
    for (var yy = 0; yy < ch; yy += 2) {
      for (var xx = 0; xx < m; xx += 2) {
        if (data[(yy * m + xx) * 4 + 3] > 140) pts.push([xx / m, yy / ch]);
      }
    }
    pts.sort(function (p, q) { return (p[0] - q[0]) || (p[1] - q[1]); });
    return pts;
  }
  function textRect() {
    var h2 = headEl.querySelector('h2') || headEl;
    try {
      var range = document.createRange();
      range.selectNodeContents(h2);
      var rects = range.getClientRects();
      if (rects.length) {
        var r = rects[0];
        var w = r.width;
        for (var i = 1; i < rects.length; i++) w = Math.max(w, rects[i].right - r.left);
        if (w > 20 && r.height > 8) return { x: r.left, y: r.top, w: w, h: r.height };
      }
    } catch (e) {  }
    var own = h2.getBoundingClientRect();
    return { x: own.left, y: own.top, w: own.width, h: own.height };
  }
  function lineRatio() {
    var hcs = getComputedStyle(headEl.querySelector('h2') || headEl);
    var fs = parseFloat(hcs.fontSize) || 32;
    var lh = parseFloat(hcs.lineHeight);
    if (!lh || isNaN(lh)) lh = fs * 1.25;
    return fs / lh;
  }
  function textTarget() {
    var r = textRect();
    if (isFinite(r.y) && r.w > 8 && r.h > 4) return r;
    if (headBox) {
      return { x: headBox.x, y: headBox.y - (window.pageYOffset || 0),
               w: headBox.w, h: headBox.h };
    }
    return r;
  }
  function resize() {
    var w = Math.max(320, window.innerWidth || 320);
    var h = Math.max(280, window.innerHeight || 280);
    if (w === W && h === H) return false;
    W = w; H = h;
    DPR = Math.min(compact ? 1 : 1.4, window.devicePixelRatio || 1);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    BW = Math.max(200, Math.round(W * Q));
    BH = Math.max(180, Math.round(H * Q));
    buf.width = BW; buf.height = BH;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    return true;
  }
  function measureHead() {
    if (!headEl) return;
    var prev = headEl.style.getPropertyValue('--rv');
    headEl.style.setProperty('--rv', '1');
    var box = textRect();
    if (isFinite(box.y) && box.w > 8 && box.h > 4) {
      headBox = { x: box.x, y: box.y + (window.pageYOffset || 0), w: box.w, h: box.h };
      headTop = headBox.y;
    }
    if (prev && prev !== 'NaN') headEl.style.setProperty('--rv', prev);
    else headEl.style.removeProperty('--rv');
  }
  function phases(p) {
    var s1 = ss(0.34, 0.50, p);                 
    return { g: 1 - s1, t: s1, s1: s1 };
  }
  function headVar(p) { return ss(0.54, 0.86, p); }
  function textFade(p) { return 1 - ss(0.62, 0.92, p); }
  function cardGate(p) { return ss(0.66, 0.78, p); }
  function turbulence(p) {
    return Math.sin(ss(0.08, 0.40, p) * Math.PI) * 0.20;
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  function cardWindows(gate) {
    var out = [], any = 0;
    for (var i = 0; i < cardEls.length; i++) {
      var el = cardEls[i];
      var r = rectOf(el);
      var rv = parseFloat(el.style.getPropertyValue('--rv'));
      if (isNaN(rv)) rv = 1;
      var live = gate * ss(0.06, 0.34, rv) * (1 - ss(0.34, 0.80, rv));
      if (live > any) any = live;
      out.push({ x: r.x * Q, y: r.y * Q, w: r.w * Q, h: r.h * Q, rv: rv, live: live });
    }
    out.any = any;
    return out;
  }
  function anyCardLive() {
    var gate = cardGate(progress);
    if (gate <= 0.001) return 0;
    var any = 0;
    for (var i = 0; i < cardEls.length; i++) {
      var rv = parseFloat(cardEls[i].style.getPropertyValue('--rv'));
      if (isNaN(rv)) rv = 1;
      var live = gate * ss(0.06, 0.34, rv) * (1 - ss(0.34, 0.80, rv));
      if (live > any) any = live;
    }
    return any;
  }
  var P = { x: 0, y: 0, k: 1, r: 0 };
  function galaxyPoint(p, box, yaw, px, py, out) {
    var cx = box.x + box.w * 0.76;
    var cy = box.y + box.h * 0.48;
    var RAD = Math.min(box.w * 0.35, box.h * 0.66);
    var ang = p.a + yaw * (0.55 / (0.34 + p.r));
    var x = Math.cos(ang) * p.r, z = Math.sin(ang) * p.r;
    var y2 = p.y * Math.cos(TILT) - z * Math.sin(TILT);
    var z2 = p.y * Math.sin(TILT) + z * Math.cos(TILT);
    var k = 2.35 / (2.35 + z2);
    var roll = -0.28, cr = Math.cos(roll), sr = Math.sin(roll);
    out.x = cx + (x * cr - y2 * sr) * RAD * k
      + px * (0.16 + 0.5 * p.r) * RAD * 0.34;
    out.y = cy + (x * sr + y2 * cr) * RAD * k
      + py * (0.10 + 0.3 * p.r) * RAD * 0.26;
    out.rad = RAD;
    out.k = k;
    return out;
  }
  function draw() {
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, BW, BH);
    bctx.globalCompositeOperation = 'lighter';
    var ph = phases(progress);
    var turb0 = turbulence(progress);
    var arrive = ss(0.34, 0.50, progress);
    var lit = ss(0.42, 0.68, progress);
    var intro = ss(0.0, 0.06, progress);
    var heroRect = rectOf(hero);
    var hx = heroRect.x * Q, hw = heroRect.w * Q, hy = heroRect.y * Q, hh = heroRect.h * Q;
    var tb = textTarget();
    var tx0 = tb.x * Q, ty0 = tb.y * Q, tw = tb.w * Q, th = tb.h * Q;
    var cardRects = cardWindows(cardGate(progress));
    var anyLive = cardRects.any;
    var gRect = { x: hx, y: hy, w: hw, h: hh };
    var gi = (window.__galaxy && window.__galaxy.info) ? window.__galaxy.info() : null;
    var yaw = gi ? gi.yaw : (0.6 + time * 0.055);
    var gpx = gi ? gi.px || 0 : 0;
    var gpy = gi ? gi.py || 0 : 0;
    var inter = null;
    if (gi && gi.point && gi.strength > 0.01 && gi.bw && gi.bh) {
      inter = {
        mode: gi.state,
        x: gi.point[0] * BW / gi.bw,
        y: gi.point[1] * BH / gi.bh,
        strength: gi.strength
      };
    }
    var want = Math.max(arrive * lit * textFade(progress), anyLive * 0.6);
    var wG0 = 1 - arrive;                          
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var cr2 = cardRects[p.ci] || cardRects[0];
      var out = ss(0.62 + 0.08 * p.ptone, 0.84 + 0.08 * p.ptone, progress);
      var wG = wG0;                          
      var wT = arrive * (1 - out);           
      var wC = cr2.live;
      var sum = wG + wT + wC;
      if (sum < 0.04) continue;
      var aMul = (wG + wT * lit + wC) / sum;
      galaxyPoint(p, gRect, yaw, gpx, gpy, P);
      var gx = P.x, gy = P.y, k = P.k;
      if (inter) {
        var idx = gx - inter.x, idy = gy - inter.y;
        var idist = Math.sqrt(idx * idx + idy * idy) || 1;
        var irad = P.rad * (inter.mode === 'burst' ? 1.9 : 1.1);
        var ifall = Math.max(0, 1 - idist / irad);
        var iamt = inter.mode === 'burst'
          ? P.rad * 0.72 * inter.strength * Math.sqrt(ifall) / idist
          : (inter.mode === 'attract' ? -0.88 : 1.05) * ifall * inter.strength;
        var ipull = (inter.mode === 'attract' ? -1 : 1) * P.rad * 0.045 * inter.strength;
        gx += (idx * iamt + idx / idist * ipull) * wG;
        gy += (idy * iamt + idy / idist * ipull) * wG;
      }
      var txp = tx0 + p.tx * tw, typ = ty0 + p.ty * th;
      var cp = onRect(cr2, p.cu);
      var x = (gx * wG + txp * wT + cp[0] * wC) / sum;
      var y = (gy * wG + typ * wT + cp[1] * wC) / sum;
      var turb = turb0 + wC * 0.10;
      if (turb > 0.001) {
        var wob = turb * BH * 0.34;
        x += p.nx * wob + Math.cos(time * 0.9 + p.nph) * wob * 0.35;
        y += p.ny * wob + Math.sin(time * 0.7 + p.nph) * wob * 0.35;
      }
      if (x < -60 || x > BW + 60 || y < -60 || y > BH + 60) continue;
      var sizeG = p.s * (2.6 + 4.4 * p.r) * (0.6 + 0.4 * k);
      var sizeT = p.s * (1.1 + 0.6 * p.r);
      var sizeC = p.s * (2.4 + 2.2 * p.r);
      var size = (sizeG * wG + sizeT * wT + sizeC * wC) / sum;
      if (size < 1.2) size = 1.2;
      var sweepGlow = 1;
      if (wC > 0.001) {
        var sw = p.cu - time * 0.22;
        sw -= Math.floor(sw);
        sweepGlow = 1.15 + 0.85 * Math.exp(-sw * sw * 55);
      }
      var tier;
      if (p.ptone < want * 0.82) tier = 0;
      else if (p.ptone < want * 0.94) tier = 2;
      else tier = p.r < 0.10 ? 0 : (p.r < 0.3 ? 1 : 2);
      var v = (p.lv / (LEVELS.length - 1)) * (1 - want * 0.35) + want * 0.45;
      v *= (0.25 + 0.75 * Math.min(1, aMul)) * sweepGlow;
      if (wC > 0.02 && v < 0.66 * wC) v = 0.66 * wC;
      var lv = Math.max(0, Math.min(LEVELS.length - 1,
                                    Math.round(v * (LEVELS.length - 1))));
      if (turb > 0.05 && ph.s1 > 0.05 && ph.s1 < 0.95) {
        var dx = x - BW * 0.76, dy = y - BH * 0.48;
        var dd = Math.sqrt(dx * dx + dy * dy) || 1;
        var len = turb * (16 + 70 * p.r);
        bctx.strokeStyle = 'rgba(' + strokeCols[tier] + ',' + (0.10 + 0.16 * turb).toFixed(3) + ')';
        bctx.lineWidth = Math.max(0.7, size * 0.5);
        bctx.beginPath();
        bctx.moveTo(x - dx / dd * len, y - dy / dd * len);
        bctx.lineTo(x, y);
        bctx.stroke();
      }
      bctx.drawImage(sprites[tier][lv], x - size, y - size, size * 2, size * 2);
    }
    bctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = intro;               
    ctx.drawImage(buf, 0, 0, BW, BH, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  function setVar(el, v) {
    if (!isFinite(v)) return;
    var r = Math.round(v * 1000) / 1000;
    if (el.__v === r) return;
    el.__v = r;
    el.style.setProperty('--rv', r);
  }
  function syncDom(force) {
    var headV = headVar(progress);
    if (force || lastVars.head !== headV) {
      lastVars.head = headV;
      setVar(headEl, headV);
    }
  }
  function readScroll() {
    var vh = window.innerHeight || 800;
    var y = window.pageYOffset || 0;
    var p;
    if (isFinite(headTop)) {
      var top = headTop - y;
      p = clamp((vh - top) / (vh * TRAVEL), 0, 1);
    } else {
      p = clamp(y / (vh * SPAN), 0, 1);
    }
    targetProgress = p;
    if (!raf) { progress = targetProgress; syncDom(false); }
  }
  function wanted() {
    return !reduce.matches && root.getAttribute('data-motion') !== 'off';
  }
  function idle() {
    if (anyCardLive() > 0.02) return false;
    return progress <= 0.012 || progress >= 0.94;
  }
  function frame(t) {
    if (lastPaint && t - lastPaint < frameBudget - 1) {
      raf = window.requestAnimationFrame(frame);
      return;
    }
    var dt = lastPaint ? Math.min(0.05, (t - lastPaint) / 1000) : 0.016;
    lastPaint = t;
    time += dt;
    progress += (targetProgress - progress) * Math.min(1, dt * 5.5);
    syncDom(false);
    if (idle()) {
      cv.classList.remove('is-live');
      live = false;
      stop();
      return;
    }
    cv.classList.add('is-live');
    live = true;
    draw();
    raf = window.requestAnimationFrame(frame);
  }
  function start() {
    if (raf) return;
    lastPaint = 0;
    raf = window.requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    if (!live) cv.classList.remove('is-live');
  }
  function sync() {
    if (!wanted()) {                         
      stop();
      cv.classList.remove('is-live');
      progress = targetProgress = 0;
      syncDom(true);
      setVar(headEl, 1);
      for (var i = 0; i < cardEls.length; i++) setVar(cardEls[i], 1);
      document.querySelectorAll('[data-morph]').forEach(function (el) {
        el.style.setProperty('--rv', 1);
      });
      return;
    }
    readScroll();
    if (document.hidden) { stop(); return; }
    start();
  }
  readPalette();
  measureHead();
  resize();
  build();
  function loadText() {
    var h2 = headEl.querySelector('h2');
    textPts = sampleText(h2 ? h2.textContent : headEl.textContent);
    assign();
    measureHead();
  }
  loadText();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(loadText);
  if (!wanted()) {
    sync();
  } else {
    document.querySelectorAll('[data-morph]').forEach(function (el) {
      el.style.setProperty('--rv', 0);
    });
    syncDom(true);
  }
  sync();
  window.addEventListener('scroll', function () {
    readScroll();
    if (!raf && wanted()) start();
  }, { passive: true });
  window.addEventListener('resize', function () {
    resize(); assign(); measureHead();
    if (!raf && wanted()) start();
  });
  window.addEventListener('load', function () {
    measureHead();
    if (!raf && wanted()) start();
  });
  if (reduce.addEventListener) reduce.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  if (window.MutationObserver) {
    new MutationObserver(function () { readPalette(); })
      .observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] });
  }
  window.__morph = {
    info: function () {
      var ph = phases(progress);
      var cards = [];
      var gate = cardGate(progress);
      for (var i = 0; i < cardEls.length; i++) {
        var rv = parseFloat(cardEls[i].style.getPropertyValue('--rv'));
        if (isNaN(rv)) rv = 1;
        cards.push({ rv: Math.round(rv * 1000) / 1000,
                     live: Math.round(gate * ss(0.06, 0.34, rv) * (1 - ss(0.34, 0.80, rv)) * 1000) / 1000 });
      }
      var heroRect = rectOf(hero);
      var gInfo = (window.__galaxy && window.__galaxy.info) ? window.__galaxy.info() : null;
      return {
        n: parts.length, p: Math.round(progress * 1000) / 1000,
        target: Math.round(targetProgress * 1000) / 1000,
        galaxy: Math.round(ph.g * 1000) / 1000,
        text: Math.round(ph.t * 1000) / 1000,
        fade: Math.round(textFade(progress) * 1000) / 1000,
        turb: Math.round(turbulence(progress) * 1000) / 1000,
        cards: cards,
        cardLive: Math.round(anyCardLive() * 1000) / 1000,
        idle: idle(), live: live, running: !!raf,
        headTop: headTop == null ? null : Math.round(headTop),
        gpx: gInfo ? gInfo.px : null,
        gpy: gInfo ? gInfo.py : null,
        inter: (gInfo && gInfo.point && gInfo.strength > 0.01)
          ? { mode: gInfo.state, strength: Math.round(gInfo.strength * 1000) / 1000,
              at: [Math.round(gInfo.point[0] * BW / (gInfo.bw || 1)),
                   Math.round(gInfo.point[1] * BH / (gInfo.bh || 1))] }
          : null,
        g: [Math.round(heroRect.x + heroRect.w * 0.76), Math.round(heroRect.y + heroRect.h * 0.48)],
        pts: textPts.length, words: (function () {
          var k = 0;
          for (var i = 0; i < parts.length; i++) if (parts[i].word) k++;
          return k;
        })(),
        tbox: [Math.round(textRect().w), Math.round(textRect().h)],
        tgt: (function () { var t = textTarget(); return [Math.round(t.x), Math.round(t.y), Math.round(t.w), Math.round(t.h)]; })(),
        ty: (function () {
          var lo = 1, hi = 0, xlo = 1, xhi = 0;
          for (var i = 0; i < parts.length; i++) {
            if (!parts[i].word) continue;
            if (parts[i].ty < lo) lo = parts[i].ty;
            if (parts[i].ty > hi) hi = parts[i].ty;
            if (parts[i].tx < xlo) xlo = parts[i].tx;
            if (parts[i].tx > xhi) xhi = parts[i].tx;
          }
          return [Math.round(lo * 1000) / 1000, Math.round(hi * 1000) / 1000,
                  Math.round(xlo * 1000) / 1000, Math.round(xhi * 1000) / 1000];
        })(),
        sample: sampleInfo,
        ptsY: (function () {
          if (!textPts.length) return null;
          var lo = 1, hi = 0;
          for (var i = 0; i < textPts.length; i++) {
            if (textPts[i][1] < lo) lo = textPts[i][1];
            if (textPts[i][1] > hi) hi = textPts[i][1];
          }
          return [Math.round(lo * 1000) / 1000, Math.round(hi * 1000) / 1000];
        })(),
        head: headEl.__v,
        w: W, h: H, bw: BW, bh: BH
      };
    },
    bench: function (n) {
      n = n || 30;
      var t0 = performance.now();
      for (var i = 0; i < n; i++) { time += 0.01; draw(); }
      return (performance.now() - t0) / n;
    },
    setProgress: function (v) { progress = targetProgress = clamp(v, 0, 1); syncDom(true); draw(); }
  };
})();