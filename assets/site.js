(function () {
  'use strict';
  var STORE_KEY = 'blog.appearance';
  var HTML = document.documentElement;
  var metaEl = document.getElementById('theme-meta');
  if (metaEl) {
    try { window.__THEMES__ = JSON.parse(metaEl.textContent || '{}'); } catch (e) { window.__THEMES__ = {}; }
  }
  window.__THEMES__ = window.__THEMES__ || {};
  var DEFAULTS = {
    theme: HTML.getAttribute('data-theme') || 'dusk',
    mode: HTML.getAttribute('data-mode') || 'dark',
    bg: HTML.getAttribute('data-bg') || 'on',
    bgmode: HTML.getAttribute('data-bgmode') || 'image',
    tilt: HTML.getAttribute('data-tilt') || '12',
    glass: HTML.getAttribute('data-glass') || 'med',
    font: HTML.getAttribute('data-font') || 'sans',
    motion: HTML.getAttribute('data-motion') || 'on',
    width: HTML.getAttribute('data-width') || 'normal',
    cursor: HTML.getAttribute('data-default-cursor') || 'glow',
    focus: 'off',
    bgOpacity: 72,
    bgBlur: 0,
    glassAlpha: 72,
    scale: 1,
    accent: ''
  };
  var ATTRS = ['theme', 'mode', 'bg', 'bgmode', 'tilt', 'glass', 'font', 'motion', 'width', 'cursor'];
  var _video = null;
  var _reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var _vidState = '';
  function videoState(v) {
    if (v === _vidState) return;
    _vidState = v;
    var layer = document.querySelector('.bg-layer');
    if (layer) {
      layer.classList.toggle('is-video-loading', v === 'loading');
      layer.classList.toggle('is-video-ready', v === 'ready');
    }
    if (_video) _video.classList.toggle('is-ready', v === 'ready');
  }
  function syncVideo() {
    if (!_video) _video = document.querySelector('.bg-video');
    if (!_video) return;
    var s = Theme.state;
    var meta = (window.__THEMES__ || {})[s.theme] || {};
    var root = HTML.getAttribute('data-root') || '';
    var want = s.focus !== 'on' && s.bgmode === 'video' && s.bg === 'on' && s.motion !== 'off'
      && !_reduced.matches && !document.hidden && !!meta.video &&
      !(navigator.connection && navigator.connection.saveData);
    if (!want) {
      if (!_video.paused) _video.pause();
      videoState('');
      return;
    }
    var src = root + '/' + meta.video;
    if (_video.getAttribute('data-src') !== src) {
      _video.setAttribute('data-src', src);
      if (meta.bg) _video.setAttribute('poster', root + '/' + meta.bg);
      videoState('loading');
      _video.src = src;
      _video.load();
    } else if (_video.readyState < 3) {
      videoState('loading');
    } else {
      videoState('ready');
    }
    var p = _video.play();
    if (p && p.catch) p.catch(function () {  });
  }
  if (!_video && document.querySelector) {
    _video = document.querySelector('.bg-video');
  }
  if (_video) {
    _video.addEventListener('canplay', function () { videoState('ready'); });
    _video.addEventListener('playing', function () { videoState('ready'); });
    _video.addEventListener('waiting', function () {
      if (Theme.state.bgmode === 'video') videoState('loading');
    });
    _video.addEventListener('error', function () { videoState(''); });
  }
  document.addEventListener('visibilitychange', function () {
    HTML.classList.toggle('is-page-hidden', document.hidden); syncVideo();
  });
  if (_reduced.addEventListener) _reduced.addEventListener('change', function () { syncVideo(); });
  function urlOverrides() {
    var q = {};
    try {
      new URLSearchParams(window.location.search).forEach(function (v, k) { q[k] = v; });
    } catch (e) { return {}; }
    var out = {};
    ['theme', 'mode', 'bg', 'bgmode', 'tilt', 'glass', 'font', 'motion', 'width', 'cursor'].forEach(function (k) {
      if (q[k]) out[k] = q[k];
    });
    if (q.bgOpacity) out.bgOpacity = Number(q.bgOpacity);
    if (q.bgBlur) out.bgBlur = Number(q.bgBlur);
    if (q.glassAlpha) out.glassAlpha = Number(q.glassAlpha);
    if (q.scale) out.scale = Number(q.scale);
    if (q.accent) out.accent = q.accent;
    return out;
  }
  function read() {
    var raw = {};
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { raw = {}; }
    var state = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      state[k] = (raw[k] === undefined || raw[k] === null || raw[k] === '') ? DEFAULTS[k] : raw[k];
    });
    var over = urlOverrides();
    Object.keys(over).forEach(function (k) { state[k] = over[k]; });
    if (['glow', 'on', 'off'].indexOf(state.cursor) === -1) state.cursor = DEFAULTS.cursor;
    state.focus = state.focus === 'on' ? 'on' : 'off';
    return state;
  }
  function save(state) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  var Theme = {
    state: read(),
    listeners: [],
    onChange: function (fn) { this.listeners.push(fn); },
    apply: function () {
      var s = this.state.focus === 'on'
        ? Object.assign({}, this.state, { bg: 'off', motion: 'off', tilt: '0', cursor: 'off' })
        : this.state;
      HTML.setAttribute('data-focus', this.state.focus);
      ATTRS.forEach(function (k) { HTML.setAttribute('data-' + k, s[k]); });
      HTML.style.setProperty('--bg-opacity', (Number(s.bgOpacity) / 100).toFixed(3));
      HTML.style.setProperty('--bg-blur', Number(s.bgBlur) + 'px');
      HTML.style.setProperty('--font-scale', String(s.scale));
      if (s.glass === 'off') {
        HTML.style.removeProperty('--glass-alpha');
      } else {
        HTML.style.setProperty('--glass-alpha', (Number(s.glassAlpha) / 100).toFixed(3));
      }
      if (s.accent) {
        HTML.style.setProperty('--accent', s.accent);
      } else {
        HTML.style.removeProperty('--accent');
      }
      this.syncPanel();
      syncVideo();
      this.listeners.forEach(function (fn) { try { fn(s); } catch (e) {} });
      document.querySelectorAll('[data-toggle-focus]').forEach(function (button) {
        button.setAttribute('aria-pressed', s.focus === 'on' ? 'true' : 'false');
        button.textContent = s.focus === 'on' ? '退出专注' : '专注阅读';
      });
    },
    set: function (patch, persist) {
      Object.assign(this.state, patch);
      if (persist !== false) save(this.state);
      if (patch.theme) {
        var meta = (window.__THEMES__ || {})[this.state.theme];
        var color = meta && meta.swatch && meta.swatch[0];
        var tag = document.querySelector('meta[name="theme-color"]');
        if (tag && color) tag.setAttribute('content', color);
      }
      this.apply();
    },
    reset: function () {
      this.state = Object.assign({}, DEFAULTS);
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      HTML.style.removeProperty('--accent');
      this.apply();
    },
    toggleMode: function () {
      this.set({ mode: this.state.mode === 'dark' ? 'light' : 'dark' });
    },
    syncPanel: function () {
      var s = this.state;
      document.querySelectorAll('[data-theme-pick]').forEach(function (el) {
        el.classList.toggle('is-active', el.getAttribute('data-theme-pick') === s.theme);
      });
      document.querySelectorAll('.seg[data-seg]').forEach(function (seg) {
        var key = seg.getAttribute('data-seg');
        seg.querySelectorAll('button[data-val]').forEach(function (b) {
          var on = String(s[key]) === b.getAttribute('data-val');
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
      document.querySelectorAll('[data-range]').forEach(function (input) {
        var key = input.getAttribute('data-range');
        if (s[key] === undefined) return;
        input.value = s[key];
        var out = document.querySelector('[data-out="' + key + '"]');
        if (!out) return;
        if (key === 'scale') out.textContent = Number(s[key]).toFixed(2) + '×';
        else if (key === 'bgBlur') out.textContent = Math.round(Number(s[key])) + 'px';
        else if (key === 'bgOpacity') out.textContent = Math.round(Number(s[key])) + '%';
        else if (key === 'glassAlpha') out.textContent = Math.round(Number(s[key])) + '%';
      });
      var color = document.querySelector('[data-color="accent"]');
      if (color) {
        var live = getComputedStyle(HTML).getPropertyValue('--accent').trim();
        var meta2 = window.__THEMES__[s.theme];
        color.value = s.accent || (meta2 && meta2.swatch && meta2.swatch[0]) || live || '#888888';
      }
    },
    bind: function () {
      var self = this;
      var panel = document.getElementById('settings');
      if (!panel) return;
      panel.addEventListener('click', function (ev) {
        var themeBtn = ev.target.closest('[data-theme-pick]');
        if (themeBtn) { self.set({ theme: themeBtn.getAttribute('data-theme-pick') }); return; }
        var segBtn = ev.target.closest('.seg[data-seg] button[data-val]');
        if (segBtn) {
          var key = segBtn.parentElement.getAttribute('data-seg');
          var patch = {};
          patch[key] = segBtn.getAttribute('data-val');
          self.set(patch);
          return;
        }
        if (ev.target.closest('[data-reset-appearance]')) { self.reset(); return; }
        if (ev.target.closest('[data-close-settings]')) { self.close(); }
      });
      panel.addEventListener('input', function (ev) {
        var range = ev.target.closest('[data-range]');
        if (range) {
          var key = range.getAttribute('data-range');
          var patch = {};
          patch[key] = Number(range.value);
          self.set(patch);
          return;
        }
        var color = ev.target.closest('[data-color="accent"]');
        if (color) {
          var c = color.value;
          var meta = (window.__THEMES__ || {})[self.state.theme];
          var base = meta && meta.swatch && meta.swatch[0];
          self.set({ accent: (base && c.toLowerCase() === String(base).toLowerCase()) ? '' : c });
        }
      });
      document.querySelectorAll('[data-toggle-mode]').forEach(function (b) {
        b.addEventListener('click', function () { self.toggleMode(); });
      });
    },
    open: function () {
      var p = document.getElementById('settings');
      if (!p) return;
      p.hidden = false;
      document.body.style.overflow = 'hidden';
      var first = p.querySelector('.theme-card');
      if (first) first.focus({ preventScroll: true });
    },
    close: function () {
      var p = document.getElementById('settings');
      if (!p) return;
      p.hidden = true;
      document.body.style.overflow = '';
    }
  };
  Theme.bind();
  Theme.apply();
  if (/[?&]panel=1\b/.test(location.search)) Theme.open();
  window.Theme = Theme;
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-toggle-focus]')) Theme.set({ focus: Theme.state.focus === 'on' ? 'off' : 'on' });
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncVideo);
  }
})();
(function () {
  'use strict';
  var HTML = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function motionOn() { return HTML.getAttribute('data-motion') !== 'off' && !reduce; }
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
  var revealables = document.querySelectorAll('.reveal');
  if (revealables.length) {
    var show = function (el, delay) {
      if (delay) el.style.setProperty('--d', delay + 'ms');
      el.classList.add('is-in');
    };
    if (!motionOn()) {
      revealables.forEach(function (el) { show(el, 0); });
    } else {
      var vh = window.innerHeight || 800;
      var pending = [];
      revealables.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < vh + 80 && r.bottom > -80) show(el, 0);
        else pending.push(el);
      });
      if (!('IntersectionObserver' in window)) {
        pending.forEach(function (el) { show(el, 0); });
      } else {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en, i) {
            if (!en.isIntersecting) return;
            show(en.target, Math.min(i * 70, 280));
            io.unobserve(en.target);
          });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
        pending.forEach(function (el) { io.observe(el); });
        window.setTimeout(function () {
          pending.forEach(function (el) { if (!el.classList.contains('is-in')) show(el, 0); });
        }, 2600);
      }
    }
  }
  function maxTilt() {
    var v = parseFloat(Theme.state.tilt);
    if (isNaN(v)) v = 12;
    return Math.max(0, Math.min(30, v));
  }
  if (window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.card[data-tiltable]').forEach(function (card) {
      var tilt = card.querySelector('.card-tilt');
      if (!tilt) return;
      var lastX = 0, lastY = 0;
      function setTilt(degX, degY) {
        lastX = degX; lastY = degY;
        tilt.style.setProperty('--ry', degY.toFixed(2) + 'deg');
        tilt.style.setProperty('--rx', degX.toFixed(2) + 'deg');
      }
      card.addEventListener('pointermove', function (ev) {
        var max = motionOn() ? maxTilt() : 0;
        var r = card.getBoundingClientRect();
        if (!max || !r.width || !r.height) {
          if (lastX || lastY) setTilt(0, 0);
          return;
        }
        var px = (ev.clientX - r.left) / r.width - 0.5;
        var py = (ev.clientY - r.top) / r.height - 0.5;
        setTilt(-py * max, px * max);
      });
      card.addEventListener('pointerleave', function () { setTilt(0, 0); });
      card.addEventListener('pointerdown', function () { setTilt(0, 0); });
      if (window.Theme && Theme.onChange) {
        Theme.onChange(function () {
          var max = motionOn() ? maxTilt() : 0;
          if (!max) setTilt(0, 0);
        });
      }
    });
  }
  var spot = document.querySelector('.spotlight');
  if (spot && window.matchMedia('(pointer: fine)').matches) {
    var sx = 0, sy = 0, cx = 0, cy = 0, raf = null;
    function stopSpot() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      spot.classList.remove('is-on');
    }
    window.addEventListener('pointermove', function (ev) {
      if (!motionOn() || document.hidden) { stopSpot(); return; }
      sx = ev.clientX; sy = ev.clientY;
      spot.classList.add('is-on');
      if (!raf) raf = window.requestAnimationFrame(step);
    }, { passive: true });
    function step() {
      if (!motionOn() || document.hidden) { stopSpot(); return; }
      cx += (sx - cx) * 0.12;
      cy += (sy - cy) * 0.12;
      spot.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)';
      raf = (Math.abs(sx - cx) > 0.6 || Math.abs(sy - cy) > 0.6) ? window.requestAnimationFrame(step) : null;
    }
    if (window.Theme && Theme.onChange) Theme.onChange(function () { if (!motionOn()) stopSpot(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopSpot(); });
  }
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
  var interactive = 'a,button,summary,label,[role="button"],[data-cursor]:not(html)';
  var barDrag = false, guessTimer = 0, lastMove = 0;
  function overflowScroll(node) {
    if (!node || node.nodeType !== 1) return null;
    var cs = window.getComputedStyle(node);
    var ox = cs.overflowX, oy = cs.overflowY;
    var scrollX = (ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 1;
    var scrollY = (oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1;
    return (scrollX || scrollY) ? { x: scrollX, y: scrollY } : null;
  }
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
      rx = dx = x; ry = dy = y;
      el.classList.remove('is-moving');
    }
    if (label.textContent !== t) {
      label.textContent = t;
      el.classList.toggle('has-label', !!t);
    }
  }
  function tick() {
    raf = 0;
    if (!enabled() || !shown || state === 'native' || state === 'text') return;
    var k = reduce.matches ? 1 : 0.22;
    rx += (x - rx) * k;
    ry += (y - ry) * k;
    dx += (x - dx) * (reduce.matches ? 1 : 0.55);
    dy += (y - dy) * (reduce.matches ? 1 : 0.55);
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
      el.classList.remove('is-moving');
    }
  }
  function start() {
    if (raf || state === 'native' || state === 'text' || !shown || !enabled()) return;
    attach();
    root.classList.add('has-custom-cursor');
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
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
      releaseToNative(true);
      clearTimeout(guessTimer);
    } else if (nearestScroller(e.target)) {
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
(function () {
  'use strict';
  var panel = document.getElementById('search');
  if (!panel) return;
  var input = panel.querySelector('[data-search-input]');
  var box = panel.querySelector('[data-search-results]');
  var indexUrl = document.documentElement.getAttribute('data-search-url') || '/search-index.json';
  var docs = null, loading = null, loadError = false;
  var results = [], active = -1, selectedType = 'all', opener = null, previousOverflow = '';
  var labels = { all: '全部', post: '文章', project: '项目', doc: '文档' };
  var filters = document.createElement('div');
  filters.className = 'search-filters';
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', '搜索内容类型');
  Object.keys(labels).forEach(function (type) {
    var button = document.createElement('button');
    button.type = 'button'; button.textContent = labels[type];
    button.setAttribute('data-search-type', type);
    button.setAttribute('aria-pressed', type === selectedType ? 'true' : 'false');
    filters.appendChild(button);
  });
  box.before(filters);
  box.setAttribute('aria-live', 'polite');
  input.setAttribute('aria-label', '搜索文章、项目和文档');
  function text(s) { return String(s == null ? '' : s); }
  function escapeHtml(s) {
    return text(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      var url = new URL(value, location.href);
      return url.origin === location.origin && /^https?:$/.test(url.protocol) ? url.pathname + url.search + url.hash : '';
    } catch (e) { return ''; }
  }
  function load() {
    if (docs) return Promise.resolve(docs);
    if (loading) return loading;
    loadError = false;
    loading = fetch(indexUrl, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('index'); return r.json(); })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error('index');
        docs = data.filter(function (d) { return d && safeUrl(d.url); }); return docs;
      }).catch(function () { loadError = true; return null; })
      .finally(function () { loading = null; });
    return loading;
  }
  function score(doc, q) {
    var s = 0;
    if (text(doc.title).toLowerCase().indexOf(q) >= 0) s += 12;
    if ((Array.isArray(doc.tags) ? doc.tags : []).join(' ').toLowerCase().indexOf(q) >= 0) s += 6;
    if (text(doc.summary).toLowerCase().indexOf(q) >= 0) s += 4;
    if (text(doc.text).toLowerCase().indexOf(q) >= 0) s += 1;
    return s;
  }
  function mark(value, q) {
    var raw = text(value), lower = raw.toLowerCase(), out = '', i = 0, at = lower.indexOf(q);
    if (!q) return escapeHtml(raw);
    while (at >= 0) {
      out += escapeHtml(raw.slice(i, at)) + '<mark>' + escapeHtml(raw.slice(at, at + q.length)) + '</mark>';
      i = at + q.length; at = lower.indexOf(q, i);
    }
    return out + escapeHtml(raw.slice(i));
  }
  function snippet(doc, q) {
    var summary = text(doc.summary), body = text(doc.text);
    var raw = body.toLowerCase().indexOf(q) >= 0 ? body : summary || body;
    raw = raw.replace(/\s+/g, ' ').trim();
    var at = raw.toLowerCase().indexOf(q), start = Math.max(0, at - 38);
    var end = Math.min(raw.length, start + Math.max(150, q.length + 76));
    return (start ? '…' : '') + raw.slice(start, end) + (end < raw.length ? '…' : '');
  }
  function renderLoading() {
    results = []; active = -1;
    box.innerHTML = '<p class="search-hint search-loading">正在载入搜索索引<span class="boot-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>';
  }
  function search(query) {
    var q = query.trim().toLowerCase(); results = []; active = -1;
    if (loadError && !docs) {
      box.innerHTML = '<p class="search-hint">暂时无法载入搜索索引。<button type="button" class="btn ghost" data-search-retry>重新加载</button></p>'; return;
    }
    if (!q) { box.innerHTML = '<p class="search-hint">输入关键词开始搜索 · ↑↓ 选择 · Enter 打开</p>'; return; }
    if (!docs) { renderLoading(); return; }
    var matched = docs.filter(function (d) { return selectedType === 'all' || d.t === selectedType; })
      .map(function (d) { return { d: d, s: score(d, q) }; })
      .filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; });
    results = matched.slice(0, 40).map(function (x) { return x.d; });
    active = results.length ? 0 : -1;
    if (!results.length) { box.innerHTML = '<p class="search-hint">没有匹配的' + (selectedType === 'all' ? '结果' : labels[selectedType]) + '，试试其他关键词或内容类型。</p>'; return; }
    var html = '<div class="search-count">' + matched.length + ' 条结果' + (matched.length > 40 ? ' · 显示前 40 条' : '') + '</div>';
    results.forEach(function (d, i) {
      html += '<a class="search-item' + (i === active ? ' is-active' : '') + '" href="' + escapeHtml(safeUrl(d.url)) + '">'
        + '<span class="st">' + (labels[d.t] || '内容') + (d.date ? ' · ' + escapeHtml(d.date) : '') + '</span>'
        + '<span class="sname">' + mark(d.title, q) + '</span><span class="ssum">' + mark(snippet(d, q), q) + '</span></a>';
    });
    box.innerHTML = html;
  }
  function ensureIndex() { renderLoading(); load().then(function () { search(input.value); }); }
  function open() {
    if (panel.hidden) { opener = document.activeElement; previousOverflow = document.body.style.overflow; }
    panel.hidden = false; document.body.style.overflow = 'hidden';
    input.focus({ preventScroll: true }); input.select();
    if (docs) search(input.value); else ensureIndex();
  }
  function close() {
    panel.hidden = true; document.body.style.overflow = previousOverflow;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }
  document.querySelectorAll('[data-open-search]').forEach(function (b) { b.addEventListener('click', open); });
  panel.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-close-search]')) { close(); return; }
    if (ev.target.closest('[data-search-retry]')) { ensureIndex(); return; }
    var button = ev.target.closest('[data-search-type]'); if (!button) return;
    selectedType = button.getAttribute('data-search-type');
    filters.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b === button ? 'true' : 'false'); });
    search(input.value);
  });
  var timer = null;
  input.addEventListener('input', function () {
    window.clearTimeout(timer); timer = window.setTimeout(function () { search(input.value); }, 90);
  });
  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault(); if (!results.length) return;
      active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      var items = box.querySelectorAll('.search-item');
      items.forEach(function (el, i) { el.classList.toggle('is-active', i === active); });
      if (items[active]) items[active].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' && results[active]) { ev.preventDefault(); window.location.href = safeUrl(results[active].url); }
  });
  document.addEventListener('keydown', function (ev) {
    var k = ev.key.toLowerCase();
    if (k === 'escape' && !panel.hidden) { ev.preventDefault(); close(); }
    if ((ev.ctrlKey || ev.metaKey) && k === 'k') { ev.preventDefault(); panel.hidden ? open() : close(); }
    if (k === '/' && panel.hidden && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { ev.preventDefault(); open(); }
  });
  window.__openSearch = open;
})();
(function () {
  'use strict';
  var byId = {};
  var measured = {};          
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  function wireShim(box) {
    var vid = box.querySelector('video');
    if (vid) { wireVideo(box, vid); return; }
    var img = box.querySelector('img');
    if (!img) { box.classList.add('is-ready'); return; }
    function done(failed) {
      box.classList.remove('is-armed');
      box.classList.add(failed ? 'is-failed' : 'is-ready');
      box.removeAttribute('aria-busy');
    }
    if (img.complete) {
      done(img.naturalWidth === 0);
      return;
    }
    box.classList.add('is-armed');
    box.setAttribute('aria-busy', 'true');
    img.addEventListener('load', function () { done(false); }, { once: true });
    img.addEventListener('error', function () { done(true); }, { once: true });
  }
  function wireVideo(box, vid) {
    function done(failed) {
      box.classList.remove('is-armed');
      box.classList.add(failed ? 'is-failed' : 'is-ready');
      box.removeAttribute('aria-busy');
    }
    if (vid.readyState >= 1) {
      done(false);
    } else {
      box.classList.add('is-armed');
      box.setAttribute('aria-busy', 'true');
      vid.addEventListener('loadedmetadata', function () { done(false); }, { once: true });
      vid.addEventListener('error', function () { done(true); }, { once: true });
    }
    var btn = box.querySelector('.docvideo-play');
    if (btn) {
      btn.addEventListener('click', function () {
        vid.play().catch(function () {  });
      });
    }
    vid.addEventListener('play', function () { box.classList.add('is-playing'); });
    vid.addEventListener('pause', function () { box.classList.remove('is-playing'); });
    vid.addEventListener('ended', function () { box.classList.remove('is-playing'); });
  }
  function findBoot(id) {
    if (byId[id]) return byId[id];
    var el = document.querySelector('.boot[data-boot="' + id + '"]');
    if (el) byId[id] = el;
    return el;
  }
  function api(id) {
    return {
      label: function (text) {
        var el = findBoot(id);
        if (!el) return;
        var lab = el.querySelector('.boot-text');
        if (lab && lab.textContent !== text) lab.textContent = text;
      },
      progress: function (p) {
        var el = findBoot(id);
        if (!el) return;
        el.classList.add('is-measured');
        measured[id] = 1;
        var bar = el.querySelector('.boot-bar i');
        if (bar) bar.style.width = Math.max(0, Math.min(100, p)) + '%';
      },
      done: function () {
        var el = findBoot(id);
        if (!el || el.classList.contains('is-done')) return;
        el.classList.add('is-measured');
        var bar = el.querySelector('.boot-bar i');
        if (bar) bar.style.width = '100%';
        var cur = getComputedStyle(el).opacity;
        el.style.animation = 'none';
        el.style.opacity = cur;
        void el.offsetWidth;              
        el.style.opacity = '0';
        el.classList.add('is-done');
        window.setTimeout(function () { el.setAttribute('aria-hidden', 'true'); }, 520);
      },
      el: function () { return findBoot(id); }
    };
  }
  window.__boot = {
    label: function (id, text) { api(id).label(text); },
    progress: function (id, p) { api(id).progress(p); },
    done: function (id) { api(id).done(); },
    state: function (id) {
      var el = findBoot(id);
      if (!el) return null;
      var hint = el.querySelector('.boot-hint');
      return {
        id: id,
        done: el.classList.contains('is-done'),
        measured: !!measured[id],
        hintShown: !!hint && parseFloat(getComputedStyle(hint).opacity) > 0.5,
        label: (el.querySelector('.boot-text') || {}).textContent || '',
        hidden: el.getAttribute('aria-hidden') === 'true'
      };
    }
  };
  ready(function () {
    var shims = document.querySelectorAll('.media-shim');
    for (var i = 0; i < shims.length; i++) wireShim(shims[i]);
  });
  window.__loading = {
    mark: function (el, state) {
      if (!el) return;
      el.classList.remove('is-ready', 'is-failed');
      if (state) el.classList.add('is-' + state);
    },
    wire: function (root) {
      var list = (root || document).querySelectorAll('.media-shim:not(.is-ready):not(.is-failed)');
      for (var i = 0; i < list.length; i++) wireShim(list[i]);
    }
  };
})();
(function () {
  'use strict';
  var metaEl = document.getElementById('theme-meta');
  if (metaEl) {
    try {
      window.__THEMES__ = JSON.parse(metaEl.textContent || '{}');
    } catch (e) { window.__THEMES__ = {}; }
  } else {
    window.__THEMES__ = window.__THEMES__ || {};
  }
  var root = document.documentElement.getAttribute('data-root') || '';
  if (!document.documentElement.getAttribute('data-search-url')) {
    document.documentElement.setAttribute('data-search-url', root + '/search-index.json');
  }
  document.querySelectorAll('.prose a[href^="http"]').forEach(function (a) {
    if (a.hostname && a.hostname !== window.location.hostname) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });
  document.querySelectorAll('.mobile-toc a').forEach(function (a) {
    a.addEventListener('click', function () {
      a.closest('details').open = false;
    });
  });
  document.querySelectorAll('.code-pre').forEach(function (pre) {
    if (pre.scrollWidth > pre.clientWidth + 4) pre.classList.add('is-scrollable');
  });
  var AUTO_FOLD = 24;
  document.querySelectorAll('.code-block[data-lines]').forEach(function (box) {
    var lines = parseInt(box.getAttribute('data-lines'), 10) || 0;
    var more = box.querySelector('.code-more');
    var foldBtn = box.querySelector('.code-fold');
    function apply(folded) {
      box.classList.toggle('is-folded', folded);
      if (more) {
        more.hidden = !folded;
        var lab = more.querySelector('[data-fold-more]');
        if (lab) lab.textContent = '展开全部 ' + lines + ' 行';
      }
      if (foldBtn) {
        foldBtn.setAttribute('aria-expanded', String(!folded));
        var t = foldBtn.querySelector('[data-fold-label]');
        if (t) t.textContent = folded ? '展开' : '收起';
      }
    }
    apply(lines > AUTO_FOLD);
    function toggle() { apply(!box.classList.contains('is-folded')); }
    if (foldBtn) foldBtn.addEventListener('click', toggle);
    if (more) more.addEventListener('click', toggle);
  });
  var toc = document.querySelector('[data-toc]');
  if (toc) {
    var tocBtn = toc.querySelector('[data-toc-toggle]');
    var cur = toc.querySelector('[data-toc-current]');
    var TOC_KEY = 'luoyebai.toc.folded';
    var stored = null;
    try { stored = window.localStorage.getItem(TOC_KEY); } catch (e) {  }
    function setToc(folded, remember) {
      toc.classList.toggle('is-folded', folded);
      if (tocBtn) tocBtn.setAttribute('aria-expanded', String(!folded));
      if (remember) {
        try { window.localStorage.setItem(TOC_KEY, folded ? '1' : '0'); } catch (e) {  }
      }
    }
    setToc(stored === '1', false);
    if (tocBtn) {
      tocBtn.addEventListener('click', function () {
        setToc(!toc.classList.contains('is-folded'), true);
      });
    }
    document.querySelectorAll('.toc, .mobile-toc').forEach(function (box) {
      box.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-toc-node]');
        if (!btn) return;
        ev.preventDefault();
        var li = btn.closest('.toc-item');
        if (!li) return;
        var collapsed = li.classList.toggle('is-collapsed');
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.setAttribute('aria-label', collapsed ? '展开这一节' : '折叠这一节');
        markCurrent(toc.querySelector('a.is-active'));
      });
    });
    var litNode = null;          // 当前点亮的那个箭头
    var markCurrent = function (a) {
      if (!a) return;
      var t = a.textContent.trim();
      if (cur && cur.textContent !== t) cur.textContent = t;
      var hit = null, li = a.closest('.toc-item');
      while (li && !hit) {
        if (li.classList.contains('has-kids') && li.classList.contains('is-collapsed')) {
          hit = li.querySelector(':scope > .toc-row > .toc-node');
        }
        li = li.parentElement ? li.parentElement.closest('.toc-item') : null;
      }
      if (litNode === hit) return;
      if (litNode) litNode.classList.remove('is-active-branch');
      litNode = hit;
      if (litNode) litNode.classList.add('is-active-branch');
    };
    markCurrent(toc.querySelector('a.is-active'));
    if (window.MutationObserver) {
      new MutationObserver(function () {
        markCurrent(toc.querySelector('a.is-active'));
      }).observe(toc, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }
  (function () {
    var list = [].slice.call(document.querySelectorAll('.prose img'));
    if (!list.length) return;
    list.forEach(function (img) {
      img.classList.add('is-zoomable');
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
    });
    var box = null, pic = null, cap = null, prevBtn = null, nextBtn = null;
    var count = null, opener = null, index = 0;
    function build() {
      box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', '查看大图');
      box.innerHTML =
        '<button class="lightbox-close" type="button" aria-label="关闭（Esc）">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" ' +
        'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
        '<button class="lightbox-nav is-prev" type="button" data-lb-prev aria-label="上一张（←）">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<figure class="lightbox-figure"><img alt=""><figcaption></figcaption></figure>' +
        '<button class="lightbox-nav is-next" type="button" data-lb-next aria-label="下一张（→）">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<span class="lightbox-count" aria-live="polite"></span>';
      pic = box.querySelector('img');
      cap = box.querySelector('figcaption');
      prevBtn = box.querySelector('[data-lb-prev]');
      nextBtn = box.querySelector('[data-lb-next]');
      count = box.querySelector('.lightbox-count');
      if (list.length < 2) {                       // 只有一张图就不摆上一张/下一张
        prevBtn.hidden = true;
        nextBtn.hidden = true;
        count.hidden = true;
      }
      box.addEventListener('click', function (e) {
        if (e.target === pic || e.target === cap) return;
        if (e.target.closest && e.target.closest('.lightbox-close, .lightbox-nav, .lightbox-count')) return;
        close();
      });
      box.querySelector('.lightbox-close').addEventListener('click', close);
      prevBtn.addEventListener('click', function () { step(-1); });
      nextBtn.addEventListener('click', function () { step(1); });
      document.body.appendChild(box);
    }
    function show(i) {
      index = i;
      var img = list[i];
      opener = img;                                 // 关掉时焦点回到**当前**这张
      pic.src = img.currentSrc || img.src;
      pic.alt = img.alt || '';
      var text = (img.alt || '').trim();
      var useful = text && !/\.(png|jpe?g|webp|gif|svg)$/i.test(text);
      cap.textContent = useful ? text : '';
      cap.hidden = !useful;
      if (count) count.textContent = (i + 1) + ' / ' + list.length;
      prevBtn.disabled = (i === 0);
      nextBtn.disabled = (i === list.length - 1);
    }
    function step(delta) {
      var next = index + delta;
      if (next < 0 || next >= list.length) return;
      show(next);
    }
    function open(img) {
      if (!box) build();
      var i = list.indexOf(img);
      show(i < 0 ? 0 : i);
      box.classList.add('is-open');
      document.documentElement.classList.add('has-lightbox');
      var btn = box.querySelector('.lightbox-close');
      if (btn) btn.focus();
    }
    function close() {
      if (!box || !box.classList.contains('is-open')) return;
      box.classList.remove('is-open');
      document.documentElement.classList.remove('has-lightbox');
      pic.removeAttribute('src');
      if (opener && opener.focus) opener.focus();
      opener = null;
    }
    document.addEventListener('click', function (e) {
      var img = e.target.closest && e.target.closest('.prose img.is-zoomable');
      if (!img) return;
      if (img.closest('a')) return;
      e.preventDefault();
      open(img);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (!box || !box.classList.contains('is-open')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    });
    window.__lightbox = {
      open: open, close: close, next: function () { step(1); },
      prev: function () { step(-1); },
      index: function () { return index; }, total: list.length,
      isOpen: function () { return !!box && box.classList.contains('is-open'); }
    };
  })();
  document.querySelectorAll('.heading-anchor').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var id = decodeURIComponent(a.getAttribute('href').slice(1));
      var t = document.getElementById(id);
      if (!t) return;
      ev.preventDefault();
      var smooth = document.documentElement.getAttribute('data-motion') !== 'off';
      t.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
      history.replaceState(null, '', '#' + id);
    });
  });
})();
(function () {
  'use strict';
  var MAX_HEIGHT = 720;
  var MAX_LOG_LINES = 500;
  var BLOCKED_HINT_MS = 8000;
  var sessions = {};          // token -> { panel, frame }
  var panels = [];
  var activityObserver = null;
  var activityFrame = 0;
  function inViewport(panel) {
    var rect = panel.getBoundingClientRect();
    return rect.height > 0 && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;
  }
  function sendActivity(state, force) {
    if (!state || !state.frame || !state.frame.contentWindow) return;
    var active = !document.hidden && state.visible;
    if (!force && state.lastActive === active) return;
    state.lastActive = active;
    state.frame.contentWindow.postMessage({ __demoToken: state.token, type: 'activity', payload: { active: active } }, '*');
  }
  function refreshActivity() {
    activityFrame = 0;
    panels.forEach(function (panel) {
      var state = panel.__demoState;
      if (!state) return;
      if (!activityObserver) state.visible = inViewport(panel);
      sendActivity(state);
    });
  }
  function animationRuntime(demo, token, send) {
    var loops = [];
    var parentActive = false;
    var disposed = false;
    function active() { return !disposed && parentActive && !document.hidden; }
    function stopFrame(loop) {
      if (loop.frame) cancelAnimationFrame(loop.frame);
      loop.frame = 0;
      loop.previous = null;
    }
    function schedule(loop) {
      if (!loop.frame && loop.playing && active()) loop.frame = requestAnimationFrame(loop.tick);
    }
    function sync() {
      loops.forEach(function (loop) {
        if (active()) schedule(loop);
        else stopFrame(loop);
      });
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      loops.forEach(function (loop) { loop.playing = false; stopFrame(loop); });
      loops.length = 0;
    }
    demo.animate = function (callback) {
      if (typeof callback !== 'function') throw new TypeError('demo.animate 需要一个回调函数');
      var loop = { playing: false, frame: 0, previous: null, elapsed: 0 };
      var api = {
        start: function () {
          if (disposed) return api;
          if (!loop.playing) loop.previous = null;
          loop.playing = true;
          schedule(loop);
          return api;
        },
        pause: function () { loop.playing = false; stopFrame(loop); return api; },
        reset: function () { api.pause(); loop.elapsed = 0; return api; },
        isRunning: function () { return loop.playing && !disposed; }
      };
      loop.tick = function (timestamp) {
        loop.frame = 0;
        if (!loop.playing || !active()) { loop.previous = null; return; }
        var delta = loop.previous === null ? 0 : Math.min(0.05, Math.max(0, (timestamp - loop.previous) / 1000));
        loop.previous = timestamp;
        loop.elapsed += delta;
        try {
          if (callback({ time: loop.elapsed, delta: delta }) === false) api.pause();
        } catch (error) {
          api.pause();
          send('error', { text: (error && (error.stack || error.message)) || String(error) });
        }
        schedule(loop);
      };
      loops.push(loop);
      return api;
    };
    window.addEventListener('message', function (event) {
      var message = event.data;
      if (event.source !== parent || !message || message.__demoToken !== token) return;
      if (message.type === 'dispose') { dispose(); return; }
      if (message.type !== 'activity') return;
      parentActive = !!(message.payload && message.payload.active === true);
      sync();
    });
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', dispose, { once: true });
  }
  function resolveColor(expr, fallback) {
    var d = document.createElement('div');
    d.style.color = expr;
    d.style.display = 'none';
    document.body.appendChild(d);
    var v = getComputedStyle(d).color;
    d.remove();
    return v && v !== 'rgba(0, 0, 0, 0)' ? v : fallback;
  }
  function themeVars() {
    var cs = getComputedStyle(document.documentElement);
    var names = ['--accent', '--accent-2', '--accent-softer', '--text', '--text-2', '--text-3',
                 '--surface', '--surface-2', '--surface-3', '--border', '--border-2',
                 '--radius', '--radius-sm', '--font-mono', '--font-body',
                 '--ok', '--warn', '--danger'];
    var out = [];
    names.forEach(function (n) {
      var v = cs.getPropertyValue(n).trim();
      if (v) out.push(n + ':' + v);
    });
    out.push('--demo-bg:' + resolveColor(
      'color-mix(in oklab, var(--surface) 82%, var(--bg))', '#14161d'));
    return ':root{' + out.join(';') + '}';
  }
  function sandboxDoc(payload, token, themeCss) {
    var json = JSON.stringify(payload).replace(/</g, '\\u003c');
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>' + themeCss +
      '*,*::before,*::after{box-sizing:border-box}' +
      'html,body{margin:0;background:var(--demo-bg,#14161d)}' +
      'body{font-family:var(--font-body,system-ui,sans-serif);font-size:14px;line-height:1.65;' +
      'color:var(--text,#e8e8ef);padding:14px 16px;word-break:break-word}' +
      '#demo-root:empty{display:none}' +
      'canvas,svg,video{max-width:100%;height:auto}' +
      'img{max-width:100%;height:auto}' +
      'button{font:inherit;color:inherit;cursor:pointer;min-height:36px;padding:.38em .9em;border-radius:8px;' +
      'background:var(--surface-2,rgba(255,255,255,.06));border:1px solid var(--border-2,rgba(255,255,255,.2))}' +
      'button:hover{border-color:var(--accent,#7aa2ff)}' +
      'button:disabled{cursor:default;opacity:.5}' +
      ':is(button,input,select,textarea,a):focus-visible{outline:2px solid var(--accent,#7aa2ff);outline-offset:3px}' +
      'input,select,textarea{font:inherit;color:inherit;padding:.28em .55em;border-radius:6px;' +
      'background:var(--surface-2,rgba(255,255,255,.06));border:1px solid var(--border-2,rgba(255,255,255,.2))}' +
      'input,select,textarea{max-width:100%}input[type="range"]{accent-color:var(--accent,#7aa2ff);min-height:28px;padding:0;cursor:pointer}' +
      'input[type="checkbox"],input[type="radio"]{accent-color:var(--accent,#7aa2ff)}' +
      'label{display:inline-flex;align-items:center;gap:.55em;flex-wrap:wrap}' +
      'fieldset{min-width:0;border:1px solid var(--border,rgba(255,255,255,.15));border-radius:10px}' +
      'output,.demo-readout{font-variant-numeric:tabular-nums;color:var(--accent-2,#7aa2ff)}' +
      '.demo-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0}' +
      'canvas{display:block;border-radius:10px;touch-action:pan-y}' +
      'a{color:var(--accent-2,#7aa2ff)}' +
      'h1,h2,h3,h4{margin:.8em 0 .4em;line-height:1.3}' +
      'table{border-collapse:collapse}td,th{border:1px solid var(--border,rgba(255,255,255,.15));padding:.3em .6em}' +
      '::-webkit-scrollbar{width:10px;height:10px}' +
      '::-webkit-scrollbar-thumb{background:var(--surface-3,rgba(255,255,255,.15));border-radius:99px}' +
      '</style></head><body>' +
      '<div id="demo-root"></div>' +
      '<script type="application/json" id="demo-payload">' + json + '<\/script>' +
      '<script>(function(){' +
      'var P=JSON.parse(document.getElementById("demo-payload").textContent);' +
      'var TOKEN=' + JSON.stringify(token) + ';' +
      'var root=document.getElementById("demo-root");' +
      'function send(t,p){try{parent.postMessage({__demoToken:TOKEN,type:t,payload:p||{}},"*");}catch(e){}}' +
      'function fmt(v,d){d=d||0;' +
      'if(typeof v==="string")return v;' +
      'if(v===null)return "null";if(v===undefined)return "undefined";' +
      'if(typeof v==="number"||typeof v==="boolean")return String(v);' +
      'if(typeof v==="function")return "ƒ "+(v.name||"anonymous")+"()";' +
      'if(v instanceof Error)return v.stack||(v.name+": "+v.message);' +
      'if(v&&v.nodeType)return "<"+(v.tagName||"node").toLowerCase()+">";' +
      'if(v&&typeof v.then==="function")return "Promise";' +
      'if(d>2)return Array.isArray(v)?"[…]":"{…}";' +
      'try{if(Array.isArray(v))return "["+v.slice(0,40).map(function(x){return fmt(x,d+1);}).join(", ")+' +
      '(v.length>40?", …":"")+"]";' +
      'if(typeof v==="object"){var k=Object.keys(v);' +
      'var b=k.slice(0,24).map(function(x){return x+": "+fmt(v[x],d+1);}).join(", ");' +
      'if(k.length>24)b+=", …";var c=v.constructor&&v.constructor.name;' +
      'return (c&&c!=="Object"?c+" ":"")+"{"+b+"}";}}catch(e){}' +
      'return String(v);}' +
      'function write(lv,args){send("log",{level:lv,text:Array.prototype.map.call(args,function(a){return fmt(a);}).join(" ")});}' +
      '["log","info","warn","error","debug"].forEach(function(k){' +
      'console[k]=function(){write(k==="debug"?"log":k,arguments);};});' +
      'var demo={root:root,log:function(){write("log",arguments);},warn:function(){write("warn",arguments);},' +
      'error:function(){write("error",arguments);},clear:function(){root.innerHTML="";send("clear");}};' +
      '(' + animationRuntime.toString() + ')(demo,TOKEN,send);' +
      'try{window.demo=demo;}catch(e){}' +
      'window.addEventListener("error",function(ev){' +
      'send("error",{text:(ev.message||"Script error")+(ev.lineno?"  (第 "+ev.lineno+" 行)":"")});});' +
      'window.addEventListener("unhandledrejection",function(ev){' +
      'send("error",{text:"未处理的 Promise 拒绝: "+fmt(ev.reason)});});' +
      'var lastH=-1;function measure(){' +
      'var r=document.getElementById("demo-root");' +
      'var b=r.getBoundingClientRect();' +
      'var hasDom=r.children.length>0;' +
      'return {h:hasDom?Math.ceil(b.height+28):0,hasDom:hasDom};}' +
      'function report(){var m=measure();' +
      'if(m.h!==lastH){lastH=m.h;send("height",{h:m.h,hasDom:m.hasDom});}}' +
      'var resizeWatcher=null,resizeTimer=0;' +
      'if(window.ResizeObserver){try{resizeWatcher=new ResizeObserver(report);resizeWatcher.observe(root);}catch(e){if(resizeWatcher)resizeWatcher.disconnect();resizeWatcher=null;}}' +
      'if(!resizeWatcher)resizeTimer=setInterval(report,400);' +
      'function cleanupMeasure(){if(resizeWatcher)resizeWatcher.disconnect();if(resizeTimer)clearInterval(resizeTimer);resizeWatcher=null;resizeTimer=0;}' +
      'window.addEventListener("pagehide",cleanupMeasure,{once:true});' +
      'window.addEventListener("message",function(e){var d=e.data;if(e.source===parent&&d&&d.__demoToken===TOKEN&&d.type==="dispose")cleanupMeasure();});' +
      'send("start");' +
      'try{' +
      'if(P.lang==="html"){root.innerHTML=P.code;}' +
      'else{var s=document.createElement("script");s.textContent=P.code;document.body.appendChild(s);}' +
      'send("done",{ok:true});' +
      '}catch(err){send("error",{text:(err&&(err.stack||err.message))||String(err)});send("done",{ok:false});}' +
      'report();' +
      '})();<\/script></body></html>';
  }
  function setupPanel(panel) {
    var srcEl = panel.querySelector('[data-demo-src]');
    var stage = panel.querySelector('[data-demo-stage]');
    var mountEl = panel.querySelector('[data-demo-mount]');
    var logEl = panel.querySelector('[data-demo-log]');
    var runBtn = panel.querySelector('[data-demo-run]');
    var runLabel = panel.querySelector('[data-demo-run-label]');
    var resetBtn = panel.querySelector('[data-demo-reset]');
    var statusEl = panel.querySelector('[data-demo-status]');
    var codeEl = panel.querySelector('[data-demo-code]');
    var toggleBtn = panel.querySelector('[data-demo-toggle]');
    var toggleLabel = panel.querySelector('[data-demo-toggle-label]');
    if (!srcEl || !mountEl || !runBtn) return;
    if (toggleBtn && codeEl) {
      toggleBtn.addEventListener('click', function () {
        var open = codeEl.hidden;      // 当前是折叠状态 -> 这次要展开
        codeEl.hidden = !open;
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggleBtn.classList.toggle('is-open', open);
        if (toggleLabel) toggleLabel.textContent = open ? '收起代码' : '查看代码';
      });
    }
    var code = '';
    try { code = JSON.parse(srcEl.textContent || '""'); } catch (e) { code = ''; }
    if (typeof code !== 'string') code = '';
    var lang = panel.getAttribute('data-demo') || 'js';
    var lineCount = 0;
    var state = { frame: null, token: '', timer: null, done: false, visible: inViewport(panel), lastActive: null };
    function setStatus(text, cls) {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.className = 'demo-status' + (cls ? ' is-' + cls : '');
    }
    function clearLog() {
      lineCount = 0;
      if (logEl) { logEl.innerHTML = ''; logEl.hidden = true; }
      panel.removeAttribute('data-demo-lines');
    }
    function teardown() {
      if (state.frame) {
        if (state.frame.contentWindow) state.frame.contentWindow.postMessage({ __demoToken: state.token, type: 'dispose' }, '*');
        if (sessions[state.token]) delete sessions[state.token];
        state.frame.remove();
        state.frame = null;
      }
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      state.token = '';
      state.done = false;
      state.lastActive = null;
    }
    function reset() {
      teardown();
      clearLog();
      stage.hidden = true;
      panel.classList.remove('is-running', 'is-done', 'is-error', 'is-blocked');
      runLabel.textContent = '运行';
      resetBtn.hidden = true;
      setStatus('');
    }
    function run() {
      teardown();
      clearLog();
      var token = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      state.token = token;
      var frame = document.createElement('iframe');
      frame.className = 'demo-frame';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('title', '可运行示例的运行结果');
      frame.srcdoc = sandboxDoc({ lang: lang, code: code }, token, themeVars());
      state.frame = frame;
      sessions[token] = { panel: panel, frame: frame, state: state };
      frame.addEventListener('load', function () { if (state.frame === frame) sendActivity(state, true); });
      mountEl.innerHTML = '';
      mountEl.appendChild(frame);
      stage.hidden = false;
      state.visible = inViewport(panel);
      sendActivity(state, true);
      panel.classList.remove('is-done', 'is-error', 'is-blocked');
      panel.classList.add('is-running');
      runLabel.textContent = '重新运行';
      resetBtn.hidden = false;
      setStatus('运行中…');
      state.timer = setTimeout(function () {
        if (!state.done) {
          panel.classList.add('is-blocked');
          setStatus('代码可能陷入死循环，点「重置」可恢复', 'error');
        }
      }, BLOCKED_HINT_MS);
    }
    runBtn.addEventListener('click', run);
    resetBtn.addEventListener('click', reset);
    panel.__demoReset = reset;
    panel.__demoState = state;
    panels.push(panel);
    if (activityObserver) activityObserver.observe(panel);
    panel.__demoAppendLog = function (level, text) {
      if (!logEl || lineCount >= MAX_LOG_LINES) return;
      if (lineCount === 0) logEl.hidden = false;
      lineCount++;
      var d = document.createElement('div');
      d.className = 'demo-line is-' + level;
      d.textContent = text;
      logEl.appendChild(d);
      panel.setAttribute('data-demo-lines', String(lineCount));
      if (lineCount === MAX_LOG_LINES) {
        var more = document.createElement('div');
        more.className = 'demo-line is-muted';
        more.textContent = '…输出过多，已截断';
        logEl.appendChild(more);
      }
    };
  }
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d.__demoToken !== 'string') return;
    var s = sessions[d.__demoToken];
    if (!s) return;
    if (!s.frame || ev.source !== s.frame.contentWindow) return;
    var panel = s.panel;
    var stage = panel.querySelector('[data-demo-stage]');
    var statusEl = panel.querySelector('[data-demo-status]');
    var frame = s.frame;
    if (d.type === 'start') {
      sendActivity(s.state, true);
      return;
    }
    if (d.type === 'height') {
      var p = d.payload || {};
      var h = Math.min(Math.max(0, p.h || 0), MAX_HEIGHT);
      var target = p.hasDom ? h : 0;
      if (Math.abs((parseInt(frame.style.height, 10) || 0) - target) > 1) {
        frame.style.height = target + 'px';
      }
      if (stage) stage.hidden = false;
      return;
    }
    if (d.type === 'log') {
      if (panel.__demoAppendLog) {
        panel.__demoAppendLog((d.payload && d.payload.level) || 'log',
                              String((d.payload && d.payload.text) || ''));
      }
      return;
    }
    if (d.type === 'clear') {
      var logEl = panel.querySelector('[data-demo-log]');
      if (logEl) { logEl.innerHTML = ''; logEl.hidden = true; }
      return;
    }
    if (d.type === 'error') {
      panel.classList.add('is-error');
      if (statusEl) {
        statusEl.textContent = String((d.payload && d.payload.text) || '运行出错');
        statusEl.className = 'demo-status is-error';
      }
      return;
    }
    if (d.type === 'done') {
      var st = panel.__demoState;
      if (st) { st.done = true; if (st.timer) { clearTimeout(st.timer); st.timer = null; } }
      panel.classList.remove('is-running');
      panel.classList.add(d.payload && d.payload.ok ? 'is-done' : 'is-error');
      if (!panel.classList.contains('is-error') && statusEl) {
        statusEl.textContent = '运行完成';
        statusEl.className = 'demo-status is-done';
      }
    }
  });
  function boot() {
    if (window.IntersectionObserver) {
      activityObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var state = entry.target.__demoState;
          if (!state) return;
          state.visible = entry.isIntersecting && entry.intersectionRatio > 0;
          sendActivity(state);
        });
      }, { threshold: [0, 0.01] });
    } else {
      var scheduleActivity = function () {
        if (!activityFrame) activityFrame = requestAnimationFrame(refreshActivity);
      };
      document.addEventListener('scroll', scheduleActivity, { passive: true, capture: true });
      window.addEventListener('resize', scheduleActivity, { passive: true });
    }
    document.querySelectorAll('.demo[data-demo]').forEach(setupPanel);
    document.addEventListener('visibilitychange', refreshActivity);
    window.addEventListener('pagehide', function () {
      panels.forEach(function (panel) { if (panel.__demoReset) panel.__demoReset(); });
      if (activityObserver) activityObserver.disconnect();
      if (activityFrame) cancelAnimationFrame(activityFrame);
    });
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted) return;
      if (activityObserver) panels.forEach(function (panel) { activityObserver.observe(panel); });
      refreshActivity();
    });
    if (window.Theme && Theme.onChange) {
      Theme.onChange(function () {
        document.querySelectorAll('.demo[data-demo]').forEach(function (p) {
          if (p.__demoReset) p.__demoReset();
        });
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
(function () {
  'use strict';
  function renderAll() {
    var katex = window.katex;
    if (!katex) return;
    document.querySelectorAll('.math-inline, .math-block').forEach(function (el) {
      if (el.getAttribute('data-rendered')) return;
      var tex = el.getAttribute('data-tex');
      if (tex === null || tex === '') return;
      var display = el.classList.contains('math-block');
      try {
        katex.render(tex, el, {
          displayMode: display,
          throwOnError: false,
          strict: false,
          trust: false,
          output: 'html'
        });
        el.setAttribute('data-rendered', '1');
        el.classList.add('is-rendered');
      } catch (err) {
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAll);
  } else {
    renderAll();
  }
  window.__renderMath = renderAll;
})();