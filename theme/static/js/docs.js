/* =========================================================================
   docs.js — 「文档」区的幻灯片阅读器
   只在 /docs/<slug>/ 加载。

   做四件事：
     1. 逐页 / 通读两种模式（默认逐页，无 JS 时退化成通读）
     2. 键盘翻页：←/→（也吃 ↑/↓、空格、PgUp/PgDn、Home/End）
     3. 目录抽屉 + 进度条 + 章节名 + 页码
     4. 全屏演示（F），Esc 退出

   不是 reveal.js 的复刻：原站那套是把 960x700 的画布整体缩放，
   这里用容器查询单位让幻灯片自己随宽度排版 —— 手机上不用捏着看。
   ========================================================================= */
(function () {
  'use strict';

  var deck = document.getElementById('deck');
  if (!deck) return;

  var stage = deck.querySelector('[data-deck-stage]');
  var slides = [].slice.call(deck.querySelectorAll('.slide'));
  if (!stage || !slides.length) return;

  var elNo = deck.querySelector('[data-deck-no]');
  var elSection = deck.querySelector('[data-deck-section]');
  var elProgress = deck.querySelector('[data-deck-progress]');
  var outline = deck.querySelector('[data-deck-outline-panel]');
  var outlineBtn = deck.querySelector('[data-deck-outline]');
  var cur = 0;
  var mode = 'paged';
  var fragments = slides.map(function (slide) { return Array.from(slide.querySelectorAll('.deck-fragment')); });
  var steps = slides.map(function () { return 0; });
  var stepInfo = document.createElement('span');
  stepInfo.className = 'deck-step-info';
  stepInfo.setAttribute('aria-live', 'polite');
  if (elSection) elSection.after(stepInfo);
  function advance(direction) {
    if (mode === 'paged') {
      if (direction > 0 && steps[cur] < fragments[cur].length) { steps[cur]++; paint(false); return; }
      if (direction < 0 && steps[cur] > 0) { steps[cur]--; paint(false); return; }
      var target = clampNo(cur + direction);
      if (target !== cur) steps[target] = direction < 0 ? fragments[target].length : 0;
    }
    go(cur + direction, true);
  }
  var STORE = 'blog.deck.mode';
  function calm() { return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.getAttribute('data-motion') === 'off'; }
  slides.forEach(function (slide, i) { slide.setAttribute('data-page-label', String(i + 1).padStart(2, '0') + ' / ' + slides.length); });
  var jump = document.createElement('input');
  jump.type = 'number'; jump.min = '1'; jump.max = String(slides.length);
  jump.className = 'deck-jump'; jump.setAttribute('aria-label', '跳转到页码');
  if (elNo) { elNo.hidden = true; elNo.after(jump); }
  function commitJump() {
    var raw = jump.value.trim(), n = Number(raw);
    if (raw && Number.isFinite(n)) go(Math.round(n) - 1, true);
    jump.value = String(cur + 1);
  }
  jump.addEventListener('change', commitJump);
  jump.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      commitJump(); jump.blur(); stage.focus({preventScroll:true});
    }
  });
  if (outline) outline.querySelectorAll('[data-deck-goto]').forEach(function (button) {
    var index = Number(button.getAttribute('data-deck-goto'));
    var number = button.querySelector('.ol-no');
    if (number) number.textContent = String(index + 1).padStart(2, '0');
    var preview = document.createElement('small');
    preview.className = 'deck-outline-preview';
    var source = slides[index].querySelector('p, li');
    preview.textContent = source ? source.textContent.trim().slice(0, 85) : '章节标题';
    button.append(preview);
  });
  var overflowHint = document.createElement('span');
  overflowHint.className = 'deck-overflow-hint'; overflowHint.textContent = '本页可向下滚动 ↓'; overflowHint.hidden = true;
  stage.append(overflowHint);
  function updateOverflow() {
    var slide = slides[cur];
    overflowHint.hidden = mode !== 'paged' || slide.scrollHeight <= slide.clientHeight + 3 || slide.scrollTop + slide.clientHeight >= slide.scrollHeight - 8;
  }
  slides.forEach(function (slide) { slide.addEventListener('scroll', updateOverflow, {passive:true}); });
  if (window.ResizeObserver) {
    var observer = new ResizeObserver(updateOverflow);
    slides.forEach(function (slide) { observer.observe(slide); });
  }
  stage.addEventListener('load', updateOverflow, true);

  function closest(el, sel) {
    return (el && el.closest) ? el.closest(sel) : null;
  }

  /* ---------- 工具 ---------- */

  /* 一张幻灯片属于哪一节：往前找最近的一个「节」开头的幻灯片 */
  function sectionOf(i) {
    for (var k = i; k >= 0; k--) {
      if (slides[k].hasAttribute('data-section') && slides[k].getAttribute('data-title')) {
        return slides[k].getAttribute('data-title');
      }
    }
    return '';
  }

  function clampNo(n) {
    return Math.max(0, Math.min(slides.length - 1, n));
  }

  function paint(animate) {
    stepInfo.textContent = mode === 'paged' && fragments[cur].length ? '展开 ' + steps[cur] + ' / ' + fragments[cur].length : '';
    for (var i = 0; i < slides.length; i++) {
      fragments[i].forEach(function (fragment, index) {
        var hidden = mode === 'paged' && index >= steps[i];
        fragment.classList.toggle('is-pending', hidden);
        fragment.toggleAttribute('inert', hidden);
        if (hidden) fragment.setAttribute('aria-hidden', 'true');
        else fragment.removeAttribute('aria-hidden');
      });
      slides[i].classList.toggle('is-current', i === cur);
      /* 逐页模式下不在当前页的整块移出可访问性树，否则读屏会把 137 页一次念完 */
      if (mode === 'paged') {
        if (i === cur) slides[i].removeAttribute('aria-hidden');
        else slides[i].setAttribute('aria-hidden', 'true');
      } else {
        slides[i].removeAttribute('aria-hidden');
      }
    }
    if (elNo) elNo.textContent = String(cur + 1);
    jump.value = String(cur + 1);
    requestAnimationFrame(updateOverflow);
    if (elProgress) elProgress.style.width = ((cur + 1) / slides.length * 100).toFixed(2) + '%';
    if (elSection) elSection.textContent = sectionOf(cur);
    var prevBtns = deck.querySelectorAll('[data-deck-prev]');
    var nextBtns = deck.querySelectorAll('[data-deck-next]');
    for (var p = 0; p < prevBtns.length; p++) prevBtns[p].disabled = (cur === 0 && steps[cur] === 0 && mode === 'paged');
    for (var q = 0; q < nextBtns.length; q++) {
      nextBtns[q].disabled = (cur === slides.length - 1 && steps[cur] === fragments[cur].length && mode === 'paged');
    }
    /* 目录里标出当前页 */
    var items = outline ? outline.querySelectorAll('[data-deck-goto]') : [];
    for (var j = 0; j < items.length; j++) {
      var on = Number(items[j].getAttribute('data-deck-goto')) === cur;
      items[j].classList.toggle('is-current', on);
      items[j].setAttribute('aria-current', on ? 'true' : 'false');
    }
    if (animate && location.hash !== '#' + (cur + 1)) {
      try { history.replaceState(null, '', '#' + (cur + 1)); } catch (e) { /* file:// 下会抛 */ }
    }
    deck.dispatchEvent(new CustomEvent('deck:change'));
  }

  function go(n, animate) {
    n = clampNo(n);
    var moved = n !== cur;
    deck.setAttribute('data-direction', n < cur ? 'prev' : 'next');
    cur = n;
    if (moved && mode === 'paged') slides[cur].scrollTop = 0;
    paint(animate);
    if (mode === 'scroll') { slides[cur].scrollIntoView({block: 'start', behavior: 'auto'}); return; }
    if (!moved || deck.classList.contains('is-full')) return;
    /* 键盘翻页时焦点可能早就滚出舞台了，这里只在「新的一页看不见」时才把
       舞台拉回视野 —— 每次翻页都强行滚动会让人没法边翻边看别处。 */
    var r = slides[cur].getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 40) {
      var top = window.pageYOffset + r.top - Math.max(80, (window.innerHeight - r.height) / 2);
      window.scrollTo({ top: Math.max(0, top), behavior: animate && !calm() ? 'smooth' : 'auto' });
    }
  }

  function setMode(next, silent) {
    mode = next === 'scroll' ? 'scroll' : 'paged';
    deck.classList.toggle('is-paged', mode === 'paged');
    deck.classList.toggle('is-scroll', mode === 'scroll');
    var btns = deck.querySelectorAll('[data-deck-mode]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-deck-mode') === mode;
      btns[i].classList.toggle('is-on', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    paint(false);
    if (!silent) {
      try { localStorage.setItem(STORE, mode); } catch (e) { /* 隐私模式下会抛 */ }
      if (mode === 'scroll') slides[cur].scrollIntoView({block:'start', behavior:'auto'});
    }
  }

  /* ---------- 交互 ---------- */

  deck.addEventListener('click', function (e) {
    var t = e.target;
    var prev = closest(t, '[data-deck-prev]');
    var next = closest(t, '[data-deck-next]');
    var modeBtn = closest(t, '[data-deck-mode]');
    var goto = closest(t, '[data-deck-goto]');
    if (prev) { advance(-1); return; }
    if (next) { advance(1); return; }
    if (modeBtn) { setMode(modeBtn.getAttribute('data-deck-mode')); return; }
    if (goto) {
      go(Number(goto.getAttribute('data-deck-goto')), true);
      toggleOutline(false);
      stage.focus({preventScroll:true});
      return;
    }
    if (closest(t, '[data-deck-outline]')) { toggleOutline(outline && outline.hidden); return; }
    if (closest(t, '[data-deck-full]')) { toggleFull(); }
  });

  function toggleOutline(open) {
    if (!outline || !outlineBtn) return;
    outline.hidden = !open;
    outlineBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var current = outline.querySelector('.is-current');
      if (current) { current.scrollIntoView({block:'nearest'}); current.focus({preventScroll:true}); }
    } else { outlineBtn.focus({preventScroll:true}); }
  }

  /* 全屏演示 */
  function toggleFull() {
    var on = deck.classList.toggle('is-full');
    document.body.classList.toggle('deck-locked', on);
    if (on) {
      if (deck.requestFullscreen) { try { var request = deck.requestFullscreen(); if (request && request.catch) request.catch(function () {}); } catch (e) {} }
      stage.focus();
    } else if (document.fullscreenElement && document.exitFullscreen) {
      try { document.exitFullscreen(); } catch (e) {}
    }
    paint(false);
  }
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && deck.classList.contains('is-full')) {
      deck.classList.remove('is-full');
      document.body.classList.remove('deck-locked');
    }
  });

  /* 键盘。只在「焦点不在输入框」时接管，翻页键才不会被抢走 */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if (closest(e.target, '[role="dialog"]')) return;
    if (closest(e.target, 'button, a') && (e.key === ' ' || e.key === 'Enter')) return;
    var bounds = deck.getBoundingClientRect();
    if (!deck.classList.contains('is-full') && (bounds.bottom < 0 || bounds.top > innerHeight)) return;

    var k = e.key;
    if (k === 'f' || k === 'F') { e.preventDefault(); toggleFull(); return; }
    if (k === 'Escape') {
      if (deck.classList.contains('is-full')) { e.preventDefault(); toggleFull(); }
      else if (outline && !outline.hidden) { e.preventDefault(); toggleOutline(false); }
      return;
    }
    if (k === 'o' || k === 'O') { e.preventDefault(); toggleOutline(outline && outline.hidden); return; }
    if (mode === 'scroll') return;                 /* 通读模式把滚动留给浏览器 */

    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') {
      e.preventDefault(); advance(1);
    } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') {
      e.preventDefault(); advance(-1);
    } else if (k === 'Home') { e.preventDefault(); go(0, true); }
    else if (k === 'End') { e.preventDefault(); go(slides.length - 1, true); }
  });

  /* 触摸：在舞台上左右滑 = 翻页（不拦横向滚动以外的操作） */
  var tx = 0, ty = 0, tt = 0;
  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now();
  }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (mode !== 'paged' || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - tx;
    var dy = e.changedTouches[0].clientY - ty;
    if (Date.now() - tt > 700 || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    advance(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* ---------- 启动 ---------- */

  // 外部链接在新标签打开（幻灯片里满屏都是参考链接）
  var links = deck.querySelectorAll('.slide a[href^="http"]');
  for (var i = 0; i < links.length; i++) {
    links[i].setAttribute('target', '_blank');
    links[i].setAttribute('rel', 'noopener');
  }

  var saved = null;
  try { saved = localStorage.getItem(STORE); } catch (e) {}
  /* 默认逐页（这是「幻灯片文档」的意义）；记住用户上一次的选择 */
  setMode(saved === 'scroll' ? 'scroll' : 'paged', true);

  /* 触屏没有键盘，提示词要换一套 —— 不然在手机上说「按 ← →」等于没说 */
  if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
    var hint = deck.querySelector('.deck-hint');
    if (hint) hint.innerHTML = '左右滑动逐步展开 / 收起，展开完翻页 · <b>目录</b> 可跳转';
  }

  var fromHash = parseInt((location.hash || '').replace('#', ''), 10);
  cur = isNaN(fromHash) ? 0 : clampNo(fromHash - 1);
  paint(false);
  window.addEventListener('hashchange', function () {
    if (/^#\d+$/.test(location.hash)) go(Number(location.hash.slice(1)) - 1, false);
  });

  /* 调试/自测用：探针靠这几个口子量「翻页到底有没有真的换页」 */
  window.__deck = {
    count: slides.length,
    state: function () {
      return {
        mode: mode, current: cur, total: slides.length,
        step: steps[cur], stepCount: fragments[cur].length,
        section: sectionOf(cur),
        title: slides[cur].getAttribute('data-title') || '',
        visible: slides.filter(function (s) { return s.getClientRects().length > 0; }).length,
        full: deck.classList.contains('is-full'),
        outlineOpen: !!(outline && !outline.hidden),
        progress: elProgress ? elProgress.style.width : ''
      };
    },
    // 续读保存当前页与分步展开位置。通读时按视口查找实际读到的页。
    bookmark: function () {
      var page = cur;
      if (mode === 'scroll') {
        page = 0;
        for (var i = 0; i < slides.length; i++) {
          if (slides[i].getBoundingClientRect().top <= 150) page = i;
          else break;
        }
      }
      return { page: page, step: steps[page], mode: mode, total: slides.length,
        stepCount: fragments[page].length, label: slides[page].getAttribute('data-title') || sectionOf(page),
        complete: page === slides.length - 1 && (mode === 'scroll'
          ? slides[page].getBoundingClientRect().bottom <= innerHeight + 20
          : steps[page] >= fragments[page].length) };
    },
    restore: function (saved) {
      var page = clampNo(Math.round(Number(saved.page) || 0));
      steps[page] = Math.max(0, Math.min(fragments[page].length, Math.round(Number(saved.step) || 0)));
      cur = page;
      setMode(saved.mode === 'scroll' ? 'scroll' : 'paged', true);
      go(page, false);
      if (mode === 'paged') deck.scrollIntoView({ block: 'start', behavior: 'auto' });
    },
    go: function (n) { go(n, false); },
    mode: function (m) { setMode(m, true); },
    full: function () { toggleFull(); },
    outline: function (open) { toggleOutline(open); }
  };
})();
