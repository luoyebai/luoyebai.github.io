/* =========================================================================
   loading.js — 等待状态的统一驱动器（全站加载，随 site.js）

   管两件事：

   1. 图片骨架屏。给容器加 .media-shim，这里负责在图片 load / error 时
      翻成 .is-ready / .is-failed。要点：
        · 图片可能**在脚本跑到之前就已经加载完**（缓存命中），所以不能只挂事件，
          必须先查 img.complete；不然缓存图会永远停在暗淡态。
        · 图片是懒加载的，可能要等用户滚到跟前才加载 —— 那期间骨架屏就该一直亮着。

   2. 启动遮罩。`.boot[data-boot]` 由页面 HTML 直接给出（必须早于 JS），
      这里提供 window.__boot 让重活页面报告**真实**阶段：
          __boot.label('graph', '正在连线…')
          __boot.done('graph')
      资源还没到位时进度条走不定量扫描（没有可信进度就别假装有）；
      一旦有页面开始报里程碑，就切成定量条。

   还有一层兜底：遮罩里的「网络好像有点慢」提示是**纯 CSS 的延迟动画**，
   脚本压根没到也会到点出现 —— 交给 JS 定时器的话，恰恰在最需要它的
   场景下（脚本没加载）不会出现。
   ========================================================================= */
(function () {
  'use strict';

  var byId = {};
  var measured = {};          /* 哪些遮罩已经拿到过真实进度 */

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ---------------- 图片骨架屏 ---------------- */
  function wireShim(box) {
    /* 正文里的视频（`![说明](x.mp4)`）走单独一条：它没有 <img>，
       原来的写法会直接判定「没有图 -> is-ready」，于是永远不显示等待态。 */
    var vid = box.querySelector('video');
    if (vid) { wireVideo(box, vid); return; }

    var img = box.querySelector('img');
    if (!img) { box.classList.add('is-ready'); return; }

    function done(failed) {
      box.classList.remove('is-armed');
      box.classList.add(failed ? 'is-failed' : 'is-ready');
      box.removeAttribute('aria-busy');
    }
    /* 缓存命中的图 `complete` 已经是 true，load 事件早就过去了 ——
       这时候再去 arm 就会先黑一下再恢复（封面每次刷新闪一次）。 */
    if (img.complete) {
      done(img.naturalWidth === 0);
      return;
    }
    box.classList.add('is-armed');
    box.setAttribute('aria-busy', 'true');
    img.addEventListener('load', function () { done(false); }, { once: true });
    img.addEventListener('error', function () { done(true); }, { once: true });
  }

  /* ---------------- 正文视频 ---------------- */
  function wireVideo(box, vid) {
    function done(failed) {
      box.classList.remove('is-armed');
      box.classList.add(failed ? 'is-failed' : 'is-ready');
      box.removeAttribute('aria-busy');
    }
    /* `preload="metadata"` 只拉头部，readyState >= 1 就说明海报帧能出来了 */
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
        vid.play().catch(function () { /* 自动播放策略拦下就交给原生控件 */ });
      });
    }
    vid.addEventListener('play', function () { box.classList.add('is-playing'); });
    vid.addEventListener('pause', function () { box.classList.remove('is-playing'); });
    vid.addEventListener('ended', function () { box.classList.remove('is-playing'); });
  }

  /* ---------------- 启动遮罩 ---------------- */
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
        /* 淡出必须**从当前不透明度**开始。
           直接加 .is-done 的话，正在跑的淡入动画（fill: forwards）会压住声明值，
           元素会先跳回 1 再消失 —— 快加载时那一下就是「闪了个遮罩」。
           做法：把动画停掉、把当前值写成内联样式、强制回流让浏览器认下这个起点，
           再改到 0，过渡才会从「现在的样子」开始。 */
        var cur = getComputedStyle(el).opacity;
        el.style.animation = 'none';
        el.style.opacity = cur;
        void el.offsetWidth;              /* 强制回流：让 cur 成为过渡起点 */
        el.style.opacity = '0';
        el.classList.add('is-done');
        /* 淡出之后从可访问性树里摘掉，读屏不会再念到一个已经消失的遮罩 */
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

  /* 兜底之二：图省事直接暴露一个给外部标记的方法（视频背景、搜索面板用） */
  window.__loading = {
    mark: function (el, state) {
      if (!el) return;
      el.classList.remove('is-ready', 'is-failed');
      if (state) el.classList.add('is-' + state);
    },
    /* 已经在 DOM 里但脚本跑得比解析晚时的补挂 */
    wire: function (root) {
      var list = (root || document).querySelectorAll('.media-shim:not(.is-ready):not(.is-failed)');
      for (var i = 0; i < list.length; i++) wireShim(list[i]);
    }
  };
})();
