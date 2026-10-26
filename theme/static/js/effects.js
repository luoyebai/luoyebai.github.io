/* 交互动效：滚动进度、进场、卡片倾斜、光标聚光、吸顶导航、回顶、目录跟随、代码复制 */
(function () {
  'use strict';

  var HTML = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointer = window.matchMedia('(pointer: fine)');

  function motionOn() { return HTML.getAttribute('data-motion') !== 'off' && !reduce.matches; }

  /* ---------- 滚动进度 + 吸顶导航 + 回顶 ---------- */
  var bar = document.querySelector('.scroll-progress i');
  var nav = document.getElementById('nav');
  var toTop = document.querySelector('[data-to-top]');
  var ticking = false;

  function onScroll() {
    var y = window.scrollY || 0;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    var p = h > 0 ? Math.min(1, y / h) : 0;
    if (bar) bar.style.width = (p * 100).toFixed(2) + '%';
    if (nav) nav.classList.toggle('is-stuck', y > 12);
    if (toTop) toTop.classList.toggle('is-on', y > 620);
    ticking = false;
  }
  function requestScroll() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(onScroll); }
  }
  window.addEventListener('scroll', requestScroll, { passive: true });
  onScroll();

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: motionOn() ? 'smooth' : 'auto' });
    });
  }

  /* ---------- 显现、倾斜、光斑共用一个按需动画时钟 ----------
     指针和滚动事件只更新目标；帧内先读布局，再写样式。
     指数阻尼按经过的秒数计算，60/120 Hz 的速度相同，静止收敛后不再申请帧。
     --rv 就是实际显示进度；首页的章节连线也使用这一个时钟。 */
  var revealables = [].slice.call(document.querySelectorAll('.reveal'));
  var reveals = revealables.map(function (el) {
    return {el: el, top: 0, lag: 0, target: 0, home: !!(el.closest && el.closest('[data-home-flow]'))};
  });
  var chapters = [].slice.call(document.querySelectorAll('[data-scroll-chapter]')).map(function (el) {
    return {el: el, top: 0, height: 1, enter: null, progress: null, enterTarget: 0, progressTarget: 0};
  });
  var tilts = [], movingTilts = [], activeTilt = null;
  var spot = document.querySelector('.spotlight');
  var spotOn = false, spotFresh = true, sx = 0, sy = 0, cx = 0, cy = 0;
  var motionFrame = 0, motionTime = null, layoutDirty = true, targetsDirty = true;
  var layoutKey = '';

  function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
  function now() { return window.performance ? window.performance.now() : Date.now(); }
  function follow(value, target, rate, dt, epsilon) {
    var next = value + (target - value) * (1 - Math.exp(-rate * dt));
    return Math.abs(target - next) < epsilon ? target : next;
  }
  function pointerOn() {
    return motionOn() && finePointer.matches && !document.hidden && HTML.getAttribute('data-focus') !== 'on';
  }
  function spotAllowed() { return spot && pointerOn() && HTML.getAttribute('data-performance') !== 'compact'; }
  function paintReveal(el, value) {
    if (el.__rv === value) return false;
    el.__rv = value;
    el.style.setProperty('--rv', String(value));
    el.classList.toggle('is-in', value === 1);
    return true;
  }
  function revealEvent(time, active) {
    document.dispatchEvent(new CustomEvent('reveal:frame', {detail: {time: time, active: active}}));
  }
  function showAll() {
    var changed = false;
    reveals.forEach(function (item) { changed = paintReveal(item.el, 1) || changed; });
    chapters.forEach(function (item) { paintChapter(item, 1, 1); });
    if (changed) revealEvent(now(), false);
  }
  function stopMotion() {
    if (motionFrame) window.cancelAnimationFrame(motionFrame);
    motionFrame = 0; motionTime = null;
  }
  function wakeMotion() {
    if (!window.requestAnimationFrame || motionFrame || document.hidden || !motionOn()) return;
    if (motionTime === null) motionTime = now();
    motionFrame = window.requestAnimationFrame(motionStep);
  }
  function docTop(el) {
    // Transformed client rectangles would feed the 34px reveal offset back into the target.
    var top = 0;
    while (el) { top += el.offsetTop; el = el.offsetParent; }
    return top;
  }
  function measureReveals() {
    reveals.forEach(function (item) {
      var siblings = item.el.parentElement ? [].slice.call(item.el.parentElement.children).filter(function (el) {
        return el.classList.contains('reveal');
      }) : [];
      item.top = docTop(item.el);
      // 首页那一列卡片用**跟着滚轮走**的错峰：行程拉长之后，排头与排尾
      // 相隔 .085 的行程才看得出来是「一张张浮起来」；手机上不累加延迟。
      item.lag = item.home
        ? (window.innerWidth <= 700 ? 0 : clamp(siblings.indexOf(item.el), 0, 2) * .085)
        : clamp(siblings.indexOf(item.el), 0, 5) * .07;
    });
    chapters.forEach(function (item) { item.top = docTop(item.el); item.height = Math.max(1, item.el.offsetHeight); });
    layoutDirty = false; targetsDirty = true;
    if (activeTilt) activeTilt.dirty = true;
  }
  function readRevealTargets() {
    var y = window.pageYOffset || 0, vh = window.innerHeight || 800;
    var atBottom = y + vh >= HTML.scrollHeight - 2;
    reveals.forEach(function (item) {
      if (!item.home) { item.target = clamp((y + vh * .88 - item.top) / (vh * .44) - item.lag, 0, 1); return; }
      /* 首页正文：**跟着滚轮一点点浮起来**，而不是「进视野就快速淡入一次」。
         行程 = 半屏多一点（元素顶端从视口 98% 走到 46% 处才走完），所以每滚一格
         它就多露一点，停下来就停在半路；走完时内容已经稳稳落在视口上半部。 */
      item.target = atBottom || (document.activeElement && item.el.contains(document.activeElement))
        ? 1 : clamp((y + vh * .98 - item.top) / (vh * .52) - item.lag, 0, 1);
    });
    chapters.forEach(function (item) {
      item.enterTarget = clamp((y + vh * .9 - item.top) / (vh * .28), 0, 1);
      item.progressTarget = atBottom ? 1 : clamp((y + vh * .58 - item.top) / item.height, 0, 1);
    });
    targetsDirty = false;
  }
  function paintChapter(item, enter, progress) {
    if (item.enter !== enter) item.el.style.setProperty('--chapter-enter', String(enter));
    if (item.progress !== progress) item.el.style.setProperty('--chapter-progress', String(progress));
    item.enter = enter; item.progress = progress;
  }
  function maxTilt() {
    var state = window.Theme && window.Theme.state;
    var value = parseFloat(state ? state.tilt : HTML.getAttribute('data-tilt'));
    return clamp(isNaN(value) ? 12 : value, 0, 30);
  }
  function queueTilt(item) {
    if (movingTilts.indexOf(item) === -1) movingTilts.push(item);
    wakeMotion();
  }
  function writeTilt(item, x, y, lift) {
    if (item.x !== x) item.layer.style.setProperty('--rx', x + 'deg');
    if (item.y !== y) item.layer.style.setProperty('--ry', y + 'deg');
    if (item.lift !== lift) item.layer.style.setProperty('--lift', lift + 'px');
    item.x = x; item.y = y; item.lift = lift;
  }
  function leaveTilt(item) {
    item.tx = item.ty = item.tl = 0; item.pressed = false; item.dirty = false;
    if (activeTilt === item) activeTilt = null;
    queueTilt(item);
  }
  function clearTilts() {
    tilts.forEach(function (item) {
      writeTilt(item, 0, 0, 0); item.tx = item.ty = item.tl = 0;
      item.dirty = item.pressed = false;
    });
    movingTilts = []; activeTilt = null;
  }
  function stopSpot() {
    spotOn = false; spotFresh = true;
    if (spot) spot.classList.remove('is-on');
  }
  function readTiltTarget() {
    if (!activeTilt || !activeTilt.dirty) return;
    var item = activeTilt, rect = item.card.getBoundingClientRect(), max = maxTilt();
    item.tx = !item.pressed && rect.height ? -clamp((item.py - rect.top) / rect.height - .5, -.5, .5) * max : 0;
    item.ty = !item.pressed && rect.width ? clamp((item.px - rect.left) / rect.width - .5, -.5, .5) * max : 0;
    item.tl = item.pressed ? 0 : -5;
    item.dirty = false;
    if (movingTilts.indexOf(item) === -1) movingTilts.push(item);
  }
  function motionStep(timestamp) {
    motionFrame = 0;
    if (document.hidden || !motionOn()) { syncMotion(); return; }
    var dt = Math.max(0, (timestamp - motionTime) / 1000);
    motionTime = timestamp;
    if (layoutDirty) measureReveals();
    if (targetsDirty) readRevealTargets();
    readTiltTarget();

    var revealChanged = false, revealActive = false;
    reveals.forEach(function (item) {
      var value = Number.isFinite(item.el.__rv) ? item.el.__rv : 0;
      /* 首页**直接等于滚动目标**，不做时间阻尼：阻尼会让内容"追"滚轮 ——
         快速滚一下再停下，它还在自己慢慢挪，看起来就像卡片在一格一格地爬。
         滚轮驱动的东西就该跟手：停在哪，卡片就停在哪一步。
         非首页（正文、列表）保留原来的阻尼。 */
      value = item.home ? item.target : follow(value, item.target, 10, dt, .0001);
      revealChanged = paintReveal(item.el, value) || revealChanged;
      revealActive = revealActive || value !== item.target;
    });
    chapters.forEach(function (item) {
      var enter = follow(item.enter === null ? 0 : item.enter, item.enterTarget, 10, dt, .0001);
      var progress = follow(item.progress === null ? 0 : item.progress, item.progressTarget, 10, dt, .0001);
      paintChapter(item, enter, progress);
      revealActive = revealActive || enter !== item.enterTarget || progress !== item.progressTarget;
    });
    movingTilts = movingTilts.filter(function (item) {
      writeTilt(item, follow(item.x, item.tx, 14, dt, .001), follow(item.y, item.ty, 14, dt, .001), follow(item.lift, item.tl, 14, dt, .001));
      return item.x !== item.tx || item.y !== item.ty || item.lift !== item.tl;
    });
    var spotActive = false;
    if (spotOn) {
      var nextX = spotFresh ? sx : follow(cx, sx, 10, dt, .1);
      var nextY = spotFresh ? sy : follow(cy, sy, 10, dt, .1);
      if (spotFresh || cx !== nextX || cy !== nextY) spot.style.transform = 'translate3d(' + nextX + 'px,' + nextY + 'px,0)';
      if (spotFresh) spot.classList.add('is-on');
      cx = nextX; cy = nextY;
      spotFresh = false;
      spotActive = cx !== sx || cy !== sy;
    }
    // Emit after all writes so the canvas can follow the rendered card in this very frame.
    if (revealChanged) revealEvent(timestamp, revealActive);
    if (revealActive || movingTilts.length || spotActive) wakeMotion();
    else motionTime = null;
  }
  function invalidateLayout() { layoutDirty = true; wakeMotion(); }
  function syncMotion() {
    var key = [HTML.getAttribute('data-font'), HTML.getAttribute('data-width'), HTML.style.getPropertyValue('--font-scale')].join('|');
    if (key !== layoutKey) { layoutKey = key; layoutDirty = true; }
    if (!motionOn() || !window.requestAnimationFrame) {
      stopMotion(); clearTilts(); stopSpot(); showAll(); return;
    }
    if (document.hidden) { stopMotion(); clearTilts(); stopSpot(); return; }
    if (!pointerOn()) clearTilts();
    else if (activeTilt) { activeTilt.dirty = true; queueTilt(activeTilt); }
    if (!spotAllowed()) stopSpot();
    targetsDirty = true;
    if (reveals.length || chapters.length || movingTilts.length || spotOn) wakeMotion();
  }

  if (window.requestAnimationFrame) {
    if (reveals.length) HTML.classList.add('reveal-driven');
    document.querySelectorAll('.card[data-tiltable]').forEach(function (card) {
      var layer = card.querySelector('.card-tilt');
      if (!layer) return;
      var item = {card: card, layer: layer, x: 0, y: 0, lift: 0, tx: 0, ty: 0, tl: 0, px: 0, py: 0, dirty: false, pressed: false};
      tilts.push(item);
      function point(ev) {
        if (!pointerOn() || ev.pointerType === 'touch') return;
        if (activeTilt && activeTilt !== item) leaveTilt(activeTilt);
        activeTilt = item; item.px = ev.clientX; item.py = ev.clientY; item.dirty = true;
        queueTilt(item);
      }
      card.addEventListener('pointerenter', point, {passive: true});
      card.addEventListener('pointermove', point, {passive: true});
      card.addEventListener('pointerleave', function () { if (activeTilt === item) leaveTilt(item); });
      card.addEventListener('pointercancel', function () { if (activeTilt === item) leaveTilt(item); });
      // Only the visual layer changes; anchors and tag hit boxes keep their native events.
      card.addEventListener('pointerdown', function (ev) {
        if (activeTilt !== item || ev.pointerType === 'touch') return;
        item.pressed = true; item.dirty = true; queueTilt(item);
      }, {passive: true});
    });
    if (tilts.length) HTML.classList.add('tilt-driven');
  }
  window.addEventListener('pointerup', function () {
    if (!activeTilt || !activeTilt.pressed) return;
    activeTilt.pressed = false; activeTilt.dirty = true; queueTilt(activeTilt);
  }, {passive: true});
  window.addEventListener('pointermove', function (ev) {
    if (!spotAllowed() || ev.pointerType === 'touch') return;
    sx = ev.clientX; sy = ev.clientY; spotOn = true; wakeMotion();
  }, {passive: true});
  window.addEventListener('pointerout', function (ev) { if (!ev.relatedTarget) stopSpot(); }, {passive: true});
  window.addEventListener('blur', function () { stopSpot(); if (activeTilt) leaveTilt(activeTilt); });
  window.addEventListener('scroll', function () {
    targetsDirty = true;
    if (activeTilt) { activeTilt.dirty = true; queueTilt(activeTilt); }
    if (reveals.length || chapters.length) wakeMotion();
  }, {passive: true});
  // Keyboard navigation must never land on transparent homepage links.
  ['focusin', 'focusout'].forEach(function (name) {
    document.addEventListener(name, function (event) {
      if (!event.target || !event.target.closest || !event.target.closest('[data-home-flow]')) return;
      targetsDirty = true; wakeMotion();
    });
  });
  window.addEventListener('resize', invalidateLayout, {passive: true});
  window.addEventListener('load', invalidateLayout);
  window.addEventListener('pageshow', function () { layoutDirty = true; syncMotion(); });
  document.addEventListener('load', function (ev) { if (ev.target && ev.target.tagName === 'IMG') invalidateLayout(); }, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) layoutDirty = true; syncMotion(); });
  if (window.Theme && window.Theme.onChange) window.Theme.onChange(syncMotion);
  [reduce, finePointer].forEach(function (query) {
    if (query.addEventListener) query.addEventListener('change', syncMotion);
    else if (query.addListener) query.addListener(syncMotion);
  });
  if (window.MutationObserver) new MutationObserver(syncMotion).observe(HTML, {
    attributes: true, attributeFilter: ['data-motion', 'data-tilt', 'data-performance', 'data-focus', 'data-font', 'data-width', 'style']
  });
  if (window.ResizeObserver && reveals.length) {
    var resize = new ResizeObserver(invalidateLayout), observed = [];
    [document.body].concat(revealables.map(function (el) { return el.parentElement; }), chapters.map(function (item) { return item.el; })).forEach(function (el) {
      if (el && observed.indexOf(el) === -1) { observed.push(el); resize.observe(el); }
    });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(invalidateLayout);
  syncMotion();

  /* ---------- 目录跟随 ---------- */
  var toc = document.querySelector('[data-toc]');
  if (toc) {
    var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
    var targets = links.map(function (a) {
      var id = decodeURIComponent(a.getAttribute('href').slice(1));
      return document.getElementById(id);
    });
    if (targets.some(Boolean)) {
      var spy = new IntersectionObserver(function () {
        var best = -1, bestTop = Infinity;
        targets.forEach(function (t, i) {
          if (!t) return;
          var top = t.getBoundingClientRect().top - 120;
          if (top <= 0 && Math.abs(top) < Math.abs(bestTop)) { bestTop = top; best = i; }
          else if (best === -1 && top > 0 && top < bestTop) { bestTop = top; best = i; }
        });
        links.forEach(function (a, i) { a.classList.toggle('is-active', i === best); });
      }, { rootMargin: '-100px 0px -70% 0px', threshold: [0, 1] });
      targets.forEach(function (t) { if (t) spy.observe(t); });
    }
  }

  /* ---------- 代码复制（普通代码块与可运行示例共用） ---------- */
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    var block = btn.closest('.code-block, .demo');
    var code = block && block.querySelector('code');
    if (!code) return;
    var label = btn.querySelector('[data-copy-label]');
    btn.addEventListener('click', function () {
      var text = code.textContent || '';
      var done = function () {
        btn.classList.add('is-done');
        if (label) label.textContent = '已复制';
        window.setTimeout(function () {
          btn.classList.remove('is-done');
          if (label) label.textContent = '复制';
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    });
  });

  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }

  /* ---------- 公式复制 ----------
     复制的是**站点自己的 Markdown 写法**：行内 `$…$`、块级 `$$…$$`。
     这样粘回文章、粘进 LaTeX 文档都能直接用，不用自己去补分隔符。
     按钮不在 .math-inline 里（KaTeX 渲染时会替换掉元素内容），
     而是它的兄弟节点，所以从 DOM 上取 data-tex 而不是从按钮自己身上取。 */
  document.querySelectorAll('[data-math-copy]').forEach(function (btn) {
    var wrap = btn.closest('.math-wrap, .math-figure');
    var el = wrap && wrap.querySelector('.math-inline, .math-block');
    var label = btn.querySelector('[data-copy-label]');
    var restore = null;
    btn.addEventListener('click', function () {
      if (!el) return;
      var tex = el.getAttribute('data-tex') || '';
      if (!tex) return;
      var block = el.classList.contains('math-block');
      copyText(block ? '$$\n' + tex + '\n$$' : '$' + tex + '$', function () {
        btn.classList.add('is-done');
        btn.setAttribute('aria-label', '已复制到剪贴板');
        if (label) label.textContent = '已复制';
        if (restore) window.clearTimeout(restore);
        restore = window.setTimeout(function () {
          btn.classList.remove('is-done');
          btn.setAttribute('aria-label', '复制 LaTeX 公式');
          if (label) label.textContent = '复制 LaTeX';
        }, 1600);
      });
    });
  });

  /* ---------- 面板开关 ---------- */
  function wire(openSel, panelId, closeAttr) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    document.querySelectorAll(openSel).forEach(function (b) {
      b.addEventListener('click', function () {
        panel.hidden = false;
        document.body.style.overflow = 'hidden';
      });
    });
    panel.addEventListener('click', function (ev) {
      if (ev.target.closest('[' + closeAttr + ']')) {
        panel.hidden = true;
        document.body.style.overflow = '';
      }
    });
  }
  wire('[data-open-settings]', 'settings', 'data-close-settings');
  wire('[data-open-menu]', 'mobile-menu', 'data-close-menu');

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    ['settings', 'mobile-menu'].forEach(function (id) {
      var p = document.getElementById(id);
      if (p && !p.hidden) { p.hidden = true; document.body.style.overflow = ''; }
    });
  });
})();
