/* =========================================================================
   cursor.js — 自定义鼠标指针
   圆环模式替代系统指针；微光模式保留系统指针，带一段短暂的光尾。
   正文、输入框、嵌入内容交还原生指针，停止装饰动画。
   只在「精确指针」设备上启用；触屏、减少动效、或面板里关掉时完全不介入。
   ========================================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');

  var el = document.createElement('div');
  el.className = 'cursor';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<span class="cursor-ring"></span>' +
    '<span class="cursor-dot"></span>' +
    '<span class="cursor-trail"></span>' +
    // 放大镜：正文图片可点开看原图时用它替换圆点。
    // （只写 CSS 的 `cursor: zoom-in` 是没用的 —— 自定义指针把系统指针
    //   整个藏掉了（`cursor: none`），读者看到的永远是这个圆环。）
    '<span class="cursor-icon">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/>' +
    '<path d="M15.4 15.4 21 21"/><path d="M10.5 7.6v5.8M7.6 10.5h5.8"/></svg>' +
    '</span>' +
    '<span class="cursor-label"></span>';
  var ring = el.querySelector('.cursor-ring');
  var dot = el.querySelector('.cursor-dot');
  var icon = el.querySelector('.cursor-icon');
  var trail = el.querySelector('.cursor-trail');
  var label = el.querySelector('.cursor-label');

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var x = -100, y = -100, rx = -100, ry = -100, dx = -100, dy = -100;
  var shown = false, raf = 0, down = false, state = '';
  var lastFrame = null;
  // Preserve the 60 Hz feel while giving high-refresh displays the same timing.
  var ringRate = -Math.log(.78) * 60, dotRate = -Math.log(.45) * 60;
  // html[data-cursor] 是外观偏好，不是可点击元素。
  var interactive = 'a,button,summary,label,[role="button"],[data-cursor]:not(html)';

  /* ---- 拖动滚动条时的事件黑洞 ------------------------------------------
     按住原生滚动条拖动时，Chromium 把鼠标「借走」了：pointermove 不再发给页面
     （或者只零星发几个），而 pointerup 照常发。于是这个靠 pointermove 更新的
     自定义指针会**原地冻住**，直到松手才跳到新位置 —— 用户报的就是这个。

     拿不到坐标就没法跟着画，所以正确的做法是：这种时候把自定义指针让开，
     露出系统指针，让滚动条按原生方式工作。判断方式是「按下的位置落在
     滚动条的轨道带里」，再加一条兜底：「在滚动容器里按下之后，超过 120ms
     没收到任何 pointermove」—— 没收到坐标就说明坐标被截走了。 */
  var barDrag = false, guessTimer = 0, lastMove = 0;

  function overflowScroll(node) {
    if (!node || node.nodeType !== 1) return null;
    var cs = window.getComputedStyle(node);
    var ox = cs.overflowX, oy = cs.overflowY;
    var scrollX = (ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 1;
    var scrollY = (oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1;
    return (scrollX || scrollY) ? { x: scrollX, y: scrollY } : null;
  }

  /* 这一点是不是压在滚动条上（而不是内容区）？
     内容区宽高是 clientWidth/clientHeight，含滚动条的框是 offsetWidth/offsetHeight，
     两者之差就是滚动条本身占的那条带。 */
  function onBar(node, e) {
    var s = overflowScroll(node);
    if (!s) return false;
    var r = node.getBoundingClientRect();
    var barW = node.offsetWidth - node.clientWidth;
    var barH = node.offsetHeight - node.clientHeight;
    var lx = e.clientX - r.left, ly = e.clientY - r.top;
    if (s.y && barW > 0 && lx >= node.clientWidth) return true;
    if (s.x && barH > 0 && ly >= node.clientHeight) return true;
    return false;
  }

  function nearestScroller(node) {
    for (var n = node; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (overflowScroll(n)) return n;
    }
    return null;
  }

  function releaseToNative(on) {
    if (on === barDrag) return;
    barDrag = on;
    root.classList.toggle('is-bar-drag', on);
    el.classList.toggle('is-yield', on);
  }

  function enabled() {
    return fine.matches && !reduce.matches && !document.hidden &&
      root.getAttribute('data-motion') !== 'off' && root.getAttribute('data-cursor') !== 'off';
  }

  function attach() {
    // Only descendants of the fullscreen element are visible in its top layer.
    var host = document.fullscreenElement || document.body;
    if (el.parentNode !== host) host.appendChild(el);
  }

  function describe(target) {
    if (!target || !target.closest) return null;
    var text = target.closest('input,textarea,select,[contenteditable],iframe,video,audio');
    if (text) return { s: 'native', t: '' };
    var dis = target.closest('[disabled],[aria-disabled="true"]');
    if (dis) return { s: 'native', t: '' };
    var host = target.closest('[data-cursor-label]');
    if (host) {
      return { s: host.getAttribute('data-cursor') || 'link',
               t: host.getAttribute('data-cursor-label') || '' };
    }
    var drag = target.closest('[data-cursor="drag"]');
    if (drag) return { s: 'drag', t: '' };
    // 正文里可以点开看原图的图 —— 换成放大镜，让「这里能点」变得可见
    var zoom = target.closest('img.is-zoomable');
    if (zoom && !zoom.closest('a')) return { s: 'zoom', t: '看原图' };
    var inter = target.closest(interactive);
    if (inter) return { s: 'link', t: inter.getAttribute('data-cursor-hint') || '' };
    if (target.closest('.prose,.slide-inner,.phero-title,.phero-lede,.doc-title,.doc-lede')) {
      return { s: 'text', t: '' };
    }
    return { s: '', t: '' };
  }

  function set(target) {
    var d = describe(target);
    var s = d ? d.s : '';
    var t = d ? d.t : '';
    if (s !== state) {
      state = s;
      el.setAttribute('data-state', s);
    }
    root.classList.toggle('is-cursor-text', s === 'text');
    root.classList.toggle('is-cursor-native', s === 'native');
    if (s === 'native' || s === 'text') {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = null;
      rx = dx = x; ry = dy = y;
      el.classList.remove('is-moving');
    }
    if (label.textContent !== t) {
      label.textContent = t;
      el.classList.toggle('has-label', !!t);
    }
  }

  function tick(timestamp) {
    raf = 0;
    if (!enabled() || !shown || state === 'native' || state === 'text') { lastFrame = null; return; }
    // A stalled tab or a long main-thread task must not fling the trailing ring.
    var dt = lastFrame === null ? 1 / 60 : Math.max(0, Math.min(.05, (timestamp - lastFrame) / 1000));
    lastFrame = timestamp;
    var k = 1 - Math.exp(-ringRate * dt), kd = 1 - Math.exp(-dotRate * dt);
    rx += (x - rx) * k;
    ry += (y - ry) * k;
    dx += (x - dx) * kd;
    dy += (y - dy) * kd;
    var glow = root.getAttribute('data-cursor') === 'glow';
    var ox = glow ? 14 : 0, oy = glow ? 18 : 0;
    ring.style.transform = 'translate3d(' + (rx + ox).toFixed(2) + 'px,' + (ry + oy).toFixed(2) + 'px,0) translate(-50%,-50%)';
    dot.style.transform = 'translate3d(' + (dx + ox).toFixed(2) + 'px,' + (dy + oy).toFixed(2) + 'px,0) translate(-50%,-50%)';
    icon.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0) translate(-50%,-50%)';
    if (glow) {
      var tx = rx - dx, ty = ry - dy;
      trail.style.width = Math.min(22, Math.hypot(tx, ty)).toFixed(2) + 'px';
      trail.style.transform = 'translate3d(' + (dx + ox).toFixed(2) + 'px,' + (dy + oy).toFixed(2) + 'px,0) rotate(' + Math.atan2(ty, tx).toFixed(3) + 'rad)';
    }
    label.style.transform = 'translate3d(' + (rx + 22).toFixed(2) + 'px,' + (ry + 20).toFixed(2) + 'px,0)';
    if (Math.abs(x - rx) + Math.abs(y - ry) + Math.abs(x - dx) + Math.abs(y - dy) > 0.15) {
      raf = requestAnimationFrame(tick);
    } else {
      lastFrame = null;
      el.classList.remove('is-moving');
    }
  }

  function start() {
    if (raf || state === 'native' || state === 'text' || !shown || !enabled()) return;
    attach();
    root.classList.add('has-custom-cursor');
    lastFrame = window.performance ? window.performance.now() : null;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastFrame = null;
    shown = false;
    el.classList.remove('is-on');
    el.classList.remove('is-moving');
    root.classList.remove('has-custom-cursor', 'is-cursor-native', 'is-cursor-text');
  }

  function sync() {
    if (!enabled()) stop();
    else if (shown) { set(document.elementFromPoint(x, y)); start(); }
  }

  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') { stop(); return; }
    if (!enabled()) return;
    lastMove = Date.now();
    /* 滚动条拖动期间只要还能收到坐标，就说明没被截走，照常跟手 */
    if (barDrag) { releaseToNative(false); clearTimeout(guessTimer); }
    x = e.clientX; y = e.clientY;
    if (!shown) { shown = true; rx = x; ry = y; dx = x; dy = y; el.classList.add('is-on'); }
    set(e.target);
    if (state !== 'native' && state !== 'text') el.classList.add('is-moving');
    start();
  }, { passive: true, capture: true });

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || !enabled()) return;
    if (!down) {
      down = true;
      el.classList.add('is-down');
    }
    if (onBar(e.target, e)) {
      // 按在滚动条轨道上：十有八九是要拖它，先把指针让开
      releaseToNative(true);
      clearTimeout(guessTimer);
    } else if (nearestScroller(e.target)) {
      // 在滚动容器里按下 —— 也可能是在拖它的滚动条（只是没压准那条带）。
      // 120ms 内收不到 pointermove 就当成拖滚动条处理。
      clearTimeout(guessTimer);
      lastMove = Date.now();
      guessTimer = setTimeout(function () {
        if (down && Date.now() - lastMove > 110) releaseToNative(true);
      }, 120);
    }
  }, { passive: true, capture: true });

  document.addEventListener('pointerup', function () {
    clearTimeout(guessTimer);
    releaseToNative(false);
    if (!down) return;
    down = false;
    el.classList.remove('is-down');
  }, { passive: true, capture: true });

  /* 拖动中途指针可能被系统收回（比如拖出窗口），别把「让位」状态留着 */
  document.addEventListener('pointercancel', function () {
    clearTimeout(guessTimer);
    releaseToNative(false);
    down = false;
    el.classList.remove('is-down');
  }, { passive: true, capture: true });

  window.addEventListener('blur', function () {
    clearTimeout(guessTimer);
    releaseToNative(false);
    down = false;
    el.classList.remove('is-down');
    shown = false;
    el.classList.remove('is-on');
    stop();
  });
  document.addEventListener('mouseleave', function () {
    clearTimeout(guessTimer);
    releaseToNative(false);
    shown = false;
    el.classList.remove('is-on');
    stop();
  });
  // 跨入 iframe 后父文档不再收到移动事件，先收起残留的圆环。
  document.addEventListener('pointerout', function (e) {
    if (!e.relatedTarget || (e.relatedTarget.closest && e.relatedTarget.closest('iframe'))) stop();
  }, { passive: true });
  window.addEventListener('scroll', function () {
    if (shown && enabled()) { set(document.elementFromPoint(x, y)); start(); }
  }, { passive: true, capture: true });

  if (window.MutationObserver) {
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-cursor', 'data-motion'] });
  }
  if (fine.addEventListener) fine.addEventListener('change', function () { if (!fine.matches) stop(); });

  document.addEventListener('visibilitychange', sync);
  document.addEventListener('fullscreenchange', function () {
    attach();
    sync();
  });
  if (reduce.addEventListener) reduce.addEventListener('change', sync);
})();
