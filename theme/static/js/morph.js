/* The hero engine owns the stars. This layer carries those exact projected
   particles into the title and card outlines; it never invents a second galaxy. */
(function () {
  'use strict';
  var cv = document.getElementById('morph-canvas');
  var hero = document.querySelector('.hero');
  var head = document.querySelector('[data-morph="head"]');
  var cards = [].slice.call(document.querySelectorAll('.direction-card, .lab-invitation, .post-card, .project-card'));
  if (!cv || !cv.getContext || !hero || !head || !cards.length) return;
  var ctx = cv.getContext('2d');
  if (!ctx) return;
  var root = document.documentElement, reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var compact = root.getAttribute('data-performance') === 'compact';
  var Q = compact ? .5 : .62, LEVELS = [.26, .46, .66, .92];
  var buffer = document.createElement('canvas'), paint = buffer.getContext('2d');
  var W = 0, H = 0, BW = 0, BH = 0, dpr = 1;
  var layout = null, layoutDirty = true, paletteDirty = true, textDirty = true;
  var parts = [], sourceList = null, points = [], sprites = [], lastSnapshot = null;
  var progress = 0, target = 0, initialized = false, lastTime = null, lastPaint = -1, raf = 0;
  var live = false, headValue = null, handoffValue = null, measured = 0, rendered = 0;
  var sampleInfo = null, lastAlpha = 0, firstDraw = null;
  var fontScale = root.style.getPropertyValue('--font-scale');
  var inlineAccent = root.style.getPropertyValue('--accent') + '/' + root.style.getPropertyValue('--accent-2');

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function ss(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function scrollY() { return window.pageYOffset || 0; }
  function allowed() { return !reduce.matches && root.getAttribute('data-motion') !== 'off'; }
  function hash(id, salt) {
    var value = String(id) + ':' + salt, n = 2166136261;
    for (var i = 0; i < value.length; i++) { n ^= value.charCodeAt(i); n = Math.imul(n, 16777619); }
    return (n >>> 0) / 4294967296;
  }
  function rgb(value, fallback) {
    var match = String(value || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (match) {
      var hex = match[1]; if (hex.length === 3) hex = hex.replace(/./g, function (c) { return c + c; });
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    match = String(value || '').match(/^rgba?\(([^)]+)\)/i);
    if (match) { var values = match[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat); if (values.length >= 3) return values.slice(0, 3); }
    return fallback;
  }
  function palette() {
    var style = getComputedStyle(root);
    var colors = [[255, 255, 255], rgb(style.getPropertyValue('--accent-2'), [255, 157, 92]), rgb(style.getPropertyValue('--accent'), [122, 162, 255])];
    sprites = colors.map(function (color) {
      return LEVELS.map(function (alpha) {
        var sprite = document.createElement('canvas'); sprite.width = sprite.height = 64;
        var c = sprite.getContext('2d'), gradient = c.createRadialGradient(32, 32, 0, 32, 32, 32);
        [[0, alpha], [.22, alpha * .72], [.55, alpha * .16], [1, 0]].forEach(function (stop) {
          gradient.addColorStop(stop[0], 'rgba(' + color.join(',') + ',' + stop[1] + ')');
        });
        c.fillStyle = gradient; c.fillRect(0, 0, 64, 64); return sprite;
      });
    });
    paletteDirty = false;
  }
  function rawRect(element) {
    var rect = element.getBoundingClientRect();
    return {x: rect.left, y: rect.top + scrollY(), w: rect.width, h: rect.height};
  }
  function cardBase(element) {
    var box = rawRect(element), transform = getComputedStyle(element).transform || '';
    var matrix = transform.match(/^matrix(3d)?\(([^)]+)\)$/);
    if (matrix) {
      var values = matrix[2].split(',').map(Number), scale = values[0], is3d = !!matrix[1];
      var sy = values[is3d ? 5 : 3], tx = values[is3d ? 12 : 4], ty = values[is3d ? 13 : 5];
      var aligned = is3d ? values.length === 16 && [1, 2, 3, 4, 6, 7, 8, 9, 11, 14].every(function (i) { return Math.abs(values[i]) < 1e-6; }) : values.length === 6 && Math.abs(values[1]) < 1e-6 && Math.abs(values[2]) < 1e-6;
      if (scale > 0 && aligned && Math.abs(sy - scale) < 1e-6) {
        var width = box.w / scale, height = box.h / scale;
        box.x -= width * (1 - scale) / 2 + tx;
        box.y -= height * (1 - scale) / 2 + ty;
        box.w = width; box.h = height;
      }
    }
    return box;
  }
  function titleRect() {
    var title = head.querySelector('h2') || head;
    try {
      var range = document.createRange(); range.selectNodeContents(title);
      var rect = range.getBoundingClientRect();
      if (rect.width > 8 && rect.height > 4) return {x: rect.left, y: rect.top + scrollY(), w: rect.width, h: rect.height};
    } catch (ignore) { /* The actual title stays readable if Range is unavailable. */ }
    return rawRect(title);
  }
  function sampleText() {
    var title = head.querySelector('h2') || head, style = getComputedStyle(title);
    var text = String(title.textContent || '').replace(/\s+/g, ' ').trim();
    var fontSize = parseFloat(style.fontSize) || 32, lineHeight = parseFloat(style.lineHeight) || fontSize * 1.25;
    var height = 160, size = height * fontSize / lineHeight;
    var sample = document.createElement('canvas'), c = sample.getContext('2d');
    var font = (style.fontWeight || '700') + ' ' + size + 'px ' + (style.fontFamily || 'sans-serif');
    c.font = font; sample.width = Math.max(8, Math.ceil(c.measureText(text).width)); sample.height = height;
    c.font = font; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(text, 0, height / 2);
    sampleInfo = {w: sample.width, h: height, font: size}; points = [];
    try {
      var pixels = c.getImageData(0, 0, sample.width, height).data;
      for (var x = 0; x < sample.width; x += 2) for (var y = 0; y < height; y += 2) {
        if (pixels[(y * sample.width + x) * 4 + 3] > 140) points.push([x / sample.width, y / height]);
      }
    } catch (ignore) { /* An unavailable text rasterizer must not hide the title. */ }
    textDirty = false;
  }
  function assign() {
    if (!layout || !parts.length) return;
    var ordered = parts.slice().sort(function (a, b) { return a.source.x - b.source.x || String(a.id).localeCompare(String(b.id)); });
    ordered.forEach(function (p, i) {
      var point = points[Math.floor(i * points.length / ordered.length)] || [.5, .5];
      p.tx = point[0]; p.ty = point[1];
    });
    var perimeters = layout.cards.map(function (box) { return 2 * (box.w + box.h); });
    var total = perimeters.reduce(function (sum, value) { return sum + value; }, 0) || 1;
    var cumulative = [], used = 0;
    perimeters.forEach(function (value) { used += value / total; cumulative.push(used); });
    parts.forEach(function (p, i) {
      var position = (i + .5) / parts.length, index = 0;
      while (index < cumulative.length - 1 && position > cumulative[index]) index++;
      var start = index ? cumulative[index - 1] : 0;
      p.card = index; p.u = (position - start) / Math.max(1e-6, cumulative[index] - start);
    });
  }
  function measure() {
    // One read phase on actual layout changes. Scroll only subtracts document Y;
    // no temporary --rv writes and no layout reads in the particle loop.
    W = Math.max(1, window.innerWidth || 320); H = Math.max(1, window.innerHeight || 280);
    layout = {hero: rawRect(hero), head: titleRect(), cards: cards.map(cardBase)};
    if (textDirty) sampleText();
    dpr = Math.min(compact ? 1 : 1.4, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    BW = Math.max(1, Math.round(W * Q)); BH = Math.max(1, Math.round(H * Q));
    buffer.width = BW; buffer.height = BH;
    layoutDirty = false; measured++; assign();
  }
  function snapshot() {
    var bridge = window.__galaxy;
    if (!bridge || typeof bridge.snapshot !== 'function') return null;
    var value = bridge.snapshot();
    return value && Array.isArray(value.particles) && value.particles.length ? value : null;
  }
  function adopt(value) {
    if (sourceList === value.particles && parts.length === value.particles.length &&
      parts.every(function (p, i) { return p.source === value.particles[i] && p.id === value.particles[i].id; })) return;
    var old = new Map(parts.map(function (p) { return [p.id, p]; }));
    parts = value.particles.map(function (source) {
      var p = old.get(source.id) || {id: source.id, tone: hash(source.id, 1),
        nx: Math.cos(hash(source.id, 2) * Math.PI * 2), ny: Math.sin(hash(source.id, 3) * Math.PI * 2)};
      p.source = source; return p;
    });
    sourceList = value.particles; assign();
  }
  function setHead(value) {
    if (headValue === value) return;
    headValue = value; head.__v = value; head.style.setProperty('--rv', String(value));
  }
  function setHandoff(value) {
    if (handoffValue === value) return;
    handoffValue = value; hero.style.setProperty('--galaxy-handoff', String(value));
  }
  function setLive(value) {
    if (live === value) return;
    live = value; cv.classList.toggle('is-live', value);
  }
  function readTarget() {
    if (layout) target = clamp((H - (layout.head.y - scrollY())) / (H * .8), 0, 1);
  }
  function cardFrames() {
    var gate = ss(.66, .78, progress), y = scrollY();
    return layout.cards.map(function (box, index) {
      var rv = cards[index].__rv;
      if (!Number.isFinite(rv)) rv = parseFloat(cards[index].style.getPropertyValue('--rv'));
      if (!Number.isFinite(rv)) rv = 1;
      rv = clamp(rv, 0, 1);
      var scale = .982 + .018 * rv;
      return {x: box.x + box.w * (1 - scale) / 2, y: box.y - y + box.h * (1 - scale) / 2 + (1 - rv) * 34,
        w: box.w * scale, h: box.h * scale, rv: rv,
        live: gate * ss(.06, .34, rv) * (1 - ss(.34, .80, rv))};
    });
  }
  function onRect(box, u) {
    var distance = u * 2 * (box.w + box.h);
    if (distance < box.w) return [box.x + distance, box.y]; distance -= box.w;
    if (distance < box.h) return [box.x + box.w, box.y + distance]; distance -= box.h;
    if (distance < box.w) return [box.x + box.w - distance, box.y + box.h]; distance -= box.w;
    return [box.x, box.y + box.h - distance];
  }
  function draw() {
    var frames = cardFrames(), yScroll = scrollY();
    var scaleX = BW / W, scaleY = BH / H;
    var arrive = ss(.34, .50, progress), lit = ss(.42, .68, progress), intro = ss(0, .065, progress);
    var turbulence = Math.sin(ss(.08, .40, progress) * Math.PI) * .20;
    paint.setTransform(1, 0, 0, 1, 0, 0); paint.clearRect(0, 0, BW, BH);
    paint.globalCompositeOperation = 'lighter'; lastAlpha = 0; firstDraw = null;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], source = p.source, card = frames[p.card];
      var wG = 1 - arrive, wT = arrive * (1 - ss(.62 + .08 * p.tone, .84 + .08 * p.tone, progress));
      var wC = card.live, total = wG + wT + wC;
      if (total < 1e-7) continue;
      var sourceAlpha = Number.isFinite(source.alpha) ? clamp(source.alpha, 0, 1) : 1;
      // Normalizing positions must NOT normalize away the overall fade envelope.
      var alpha = clamp(total, 0, 1) * (wG * sourceAlpha + wT * lit + wC) / total;
      var gx = layout.hero.x + source.x, gy = layout.hero.y - yScroll + source.y;
      var tx = layout.head.x + p.tx * layout.head.w, ty = layout.head.y - yScroll + p.ty * layout.head.h;
      var edge = onRect(card, p.u);
      var x = (gx * wG + tx * wT + edge[0] * wC) / total;
      var y = (gy * wG + ty * wT + edge[1] * wC) / total;
      x += p.nx * turbulence * H * .34; y += p.ny * turbulence * H * .34;
      var radius = (source.size * wG + (1 + p.tone * .6) * wT + (1.8 + p.tone) * wC) / total;
      if (x + radius < 0 || x - radius > W || y + radius < 0 || y - radius > H) continue;
      var white = clamp((wT * lit + wC * .8) / total, 0, 1);
      var tier = clamp(source.tier | 0, 0, 2), level = clamp(source.level | 0, 0, 3);
      var sizeX = Math.max(.25, radius * scaleX), sizeY = Math.max(.25, radius * scaleY), px = x * scaleX, py = y * scaleY;
      if (!firstDraw) firstDraw = {id: p.id, x: x, y: y, size: radius, alpha: alpha * intro, sourceAlpha: sourceAlpha};
      lastAlpha = Math.max(lastAlpha, alpha * intro);
      paint.globalAlpha = alpha * (tier === 0 ? 1 : 1 - white);
      if (paint.globalAlpha > 1e-7) paint.drawImage(sprites[tier][level], px - sizeX, py - sizeY, 2 * sizeX, 2 * sizeY);
      if (tier !== 0 && white > 1e-7) {
        paint.globalAlpha = alpha * white; paint.drawImage(sprites[0][level], px - sizeX, py - sizeY, 2 * sizeX, 2 * sizeY);
      }
    }
    paint.globalAlpha = 1; paint.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = intro; ctx.drawImage(buffer, 0, 0, BW, BH, 0, 0, W, H); ctx.globalAlpha = 1;
    setHandoff(intro); setHead(ss(.54, .86, progress)); setLive(lastAlpha > 1e-7); rendered++;
  }
  function stop() { if (raf) window.cancelAnimationFrame(raf); raf = 0; lastTime = null; }
  function fallback() {
    stop(); setLive(false); setHandoff(0); setHead(1); lastAlpha = 0;
    ctx.clearRect(0, 0, W, H);
  }
  function frame(timestamp) {
    raf = 0;
    if (!allowed()) { fallback(); return; }
    if (document.hidden) { stop(); return; }
    // Batch all layout/style reads before any visible style writes.
    if (paletteDirty) palette();
    if (layoutDirty) measure();
    readTarget(); lastSnapshot = snapshot();
    if (!lastSnapshot || !points.length) { fallback(); return; }
    adopt(lastSnapshot);
    if (!initialized) { progress = target; initialized = true; }
    var dt = lastTime === null ? 0 : clamp((timestamp - lastTime) / 1000, 0, .064);
    lastTime = timestamp;
    progress += (target - progress) * (1 - Math.exp(-5.5 * dt));
    if (Math.abs(target - progress) < 1e-6) progress = target;
    draw(); lastPaint = timestamp;
    var followingGalaxy = progress > 1e-6 && progress < .50 && !lastSnapshot.paused;
    if (Math.abs(target - progress) > 1e-6 || followingGalaxy) raf = window.requestAnimationFrame(frame);
    else lastTime = null;
  }
  function wake() {
    if (!allowed()) { fallback(); return; }
    if (document.hidden || raf) return;
    raf = window.requestAnimationFrame(frame);
  }
  function invalidate(text) { layoutDirty = true; if (text) textDirty = true; wake(); }
  window.addEventListener('scroll', wake, {passive: true});
  window.addEventListener('resize', function () { invalidate(true); });
  window.addEventListener('load', function () { invalidate(true); });
  document.addEventListener('load', function (event) { if (event.target && event.target.tagName === 'IMG') invalidate(false); }, true);
  window.addEventListener('galaxy:change', wake);
  document.addEventListener('reveal:frame', function (event) {
    // effects.js normally paints first. If its RAF ran second, catch up from
    // cached rectangles in the same frame, without another layout measurement.
    if (allowed() && !document.hidden && layout && !layoutDirty && lastSnapshot && event.detail && (event.detail.time === lastPaint || !raf)) draw();
    else wake();
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else wake(); });
  if (reduce.addEventListener) reduce.addEventListener('change', wake);
  else if (reduce.addListener) reduce.addListener(wake);
  if (window.MutationObserver) new MutationObserver(function (changes) {
    changes.forEach(function (change) {
      if (change.attributeName === 'data-theme' || change.attributeName === 'data-mode') paletteDirty = true;
      if (change.attributeName === 'data-font' || change.attributeName === 'data-width') { layoutDirty = true; textDirty = true; }
      if (change.attributeName === 'style') {
        var scale = root.style.getPropertyValue('--font-scale');
        var accent = root.style.getPropertyValue('--accent') + '/' + root.style.getPropertyValue('--accent-2');
        if (scale !== fontScale) { fontScale = scale; layoutDirty = true; textDirty = true; }
        if (accent !== inlineAccent) { inlineAccent = accent; paletteDirty = true; }
      }
    });
    wake();
  }).observe(root, {attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-motion', 'data-font', 'data-width', 'style']});
  if (window.ResizeObserver) {
    var observer = new ResizeObserver(function () { invalidate(false); });
    [hero, head, document.body].concat(cards).forEach(function (element) { if (element) observer.observe(element); });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { invalidate(true); });
  wake();

  // Read-only diagnostics plus an explicit deterministic progress probe for QA.
  window.__morph = {
    info: function () {
      return {n: parts.length, p: progress, target: target, live: live, running: !!raf,
        idle: !raf, bridge: !!lastSnapshot, maxAlpha: lastAlpha, first: firstDraw,
        handoff: handoffValue, head: headValue, headTop: layout ? layout.head.y : null,
        measurements: measured, frames: rendered, sample: sampleInfo, pts: points.length,
        w: W, h: H, bw: BW, bh: BH, cards: layout ? cardFrames().map(function (card) { return {rv: card.rv, live: card.live}; }) : []};
    },
    setProgress: function (value) {
      if (!allowed() || document.hidden) return;
      if (paletteDirty) palette(); if (layoutDirty) measure();
      lastSnapshot = snapshot(); if (!lastSnapshot || !points.length) { fallback(); return; }
      adopt(lastSnapshot); progress = target = clamp(Number(value) || 0, 0, 1); initialized = true; draw();
    }
  };
})();
