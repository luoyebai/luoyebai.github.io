/* 外观管理器：主题预设 / 明暗 / 背景 / 玻璃 / 字体 / 字号 / 动效 / 阅读宽度 / 强调色 */
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

  /* ---------- 视频背景 ---------- */
  var _video = null;
  var _reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var _vidState = '';

  /* 动态壁纸按需加载当前主题的循环片，切过去要等一会儿。
     这期间在背景层上挂一个 .is-loading，让 .bg-video 保持透明、
     那层扫光留在静态图上 —— 否则会先黑一下再突然跳出来。 */
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
    if (p && p.catch) p.catch(function () { /* 自动播放被拦或未就绪，忽略 */ });
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
    // 设置变化时回调（effects.js 用它把倾斜角度实时切过去）
    onChange: function (fn) { this.listeners.push(fn); },

    apply: function () {
      // 专注模式是显示层覆盖，原先的壁纸、动效、指针等选项不被改写。
      var s = this.state.focus === 'on'
        ? Object.assign({}, this.state, { bg: 'off', motion: 'off', tilt: '0', cursor: 'off' })
        : this.state;
      HTML.setAttribute('data-focus', this.state.focus);
      ATTRS.forEach(function (k) { HTML.setAttribute('data-' + k, s[k]); });

      HTML.style.setProperty('--bg-opacity', (Number(s.bgOpacity) / 100).toFixed(3));
      HTML.style.setProperty('--bg-blur', Number(s.bgBlur) + 'px');
      HTML.style.setProperty('--font-scale', String(s.scale));

      // 玻璃不透明度。注意「玻璃质感 = 关闭」时要**移除**内联值而不是设成 1：
      // 内联样式优先级最高，留着会把 effects.css 里 data-glass="off" 的实底规则压掉。
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
  // 初始化时必须跑一次 apply：它会写回属性、同步面板，并触发视频背景的加载判断
  Theme.apply();
  // ?panel=1 直接展开外观面板（方便截图与分享具体设置）
  if (/[?&]panel=1\b/.test(location.search)) Theme.open();
  window.Theme = Theme;
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-toggle-focus]')) Theme.set({ focus: Theme.state.focus === 'on' ? 'off' : 'on' });
  });
  // DOM 里可能已经有 .bg-video（defer 脚本执行时 body 已解析完），再兜一次
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncVideo);
  }
})();
