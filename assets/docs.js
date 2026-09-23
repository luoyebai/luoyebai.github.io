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
  var STORE = 'blog.deck.mode';
  function closest(el, sel) {
    return (el && el.closest) ? el.closest(sel) : null;
  }
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
    for (var i = 0; i < slides.length; i++) {
      slides[i].classList.toggle('is-current', i === cur);
      if (mode === 'paged') {
        if (i === cur) slides[i].removeAttribute('aria-hidden');
        else slides[i].setAttribute('aria-hidden', 'true');
      } else {
        slides[i].removeAttribute('aria-hidden');
      }
    }
    if (elNo) elNo.textContent = String(cur + 1);
    if (elProgress) elProgress.style.width = ((cur + 1) / slides.length * 100).toFixed(2) + '%';
    if (elSection) elSection.textContent = sectionOf(cur);
    var prevBtns = deck.querySelectorAll('[data-deck-prev]');
    var nextBtns = deck.querySelectorAll('[data-deck-next]');
    for (var p = 0; p < prevBtns.length; p++) prevBtns[p].disabled = (cur === 0 && mode === 'paged');
    for (var q = 0; q < nextBtns.length; q++) {
      nextBtns[q].disabled = (cur === slides.length - 1 && mode === 'paged');
    }
    var items = outline ? outline.querySelectorAll('[data-deck-goto]') : [];
    for (var j = 0; j < items.length; j++) {
      var on = Number(items[j].getAttribute('data-deck-goto')) === cur;
      items[j].classList.toggle('is-current', on);
      items[j].setAttribute('aria-current', on ? 'true' : 'false');
    }
    if (animate && location.hash !== '#' + (cur + 1)) {
      try { history.replaceState(null, '', '#' + (cur + 1)); } catch (e) {  }
    }
  }
  function go(n, animate) {
    n = clampNo(n);
    var moved = n !== cur;
    cur = n;
    paint(animate);
    if (!moved || mode !== 'paged') return;
    var r = slides[cur].getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 40) {
      var top = window.pageYOffset + r.top - Math.max(80, (window.innerHeight - r.height) / 2);
      window.scrollTo({ top: Math.max(0, top), behavior: animate ? 'smooth' : 'auto' });
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
      try { localStorage.setItem(STORE, mode); } catch (e) {  }
    }
  }
  deck.addEventListener('click', function (e) {
    var t = e.target;
    var prev = closest(t, '[data-deck-prev]');
    var next = closest(t, '[data-deck-next]');
    var modeBtn = closest(t, '[data-deck-mode]');
    var goto = closest(t, '[data-deck-goto]');
    if (prev) { go(cur - 1, true); return; }
    if (next) { go(cur + 1, true); return; }
    if (modeBtn) { setMode(modeBtn.getAttribute('data-deck-mode')); return; }
    if (goto) {
      go(Number(goto.getAttribute('data-deck-goto')), true);
      toggleOutline(false);
      return;
    }
    if (closest(t, '[data-deck-outline]')) { toggleOutline(outline && outline.hidden); return; }
    if (closest(t, '[data-deck-full]')) { toggleFull(); }
  });
  function toggleOutline(open) {
    if (!outline || !outlineBtn) return;
    outline.hidden = !open;
    outlineBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function toggleFull() {
    var on = deck.classList.toggle('is-full');
    document.body.classList.toggle('deck-locked', on);
    if (on) {
      if (deck.requestFullscreen) { try { deck.requestFullscreen(); } catch (e) {} }
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
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
    var k = e.key;
    if (k === 'f' || k === 'F') { e.preventDefault(); toggleFull(); return; }
    if (k === 'Escape') {
      if (deck.classList.contains('is-full')) { e.preventDefault(); toggleFull(); }
      else if (outline && !outline.hidden) { e.preventDefault(); toggleOutline(false); }
      return;
    }
    if (k === 'o' || k === 'O') { e.preventDefault(); toggleOutline(outline && outline.hidden); return; }
    if (mode === 'scroll') return;                 
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') {
      e.preventDefault(); go(cur + 1, true);
    } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') {
      e.preventDefault(); go(cur - 1, true);
    } else if (k === 'Home') { e.preventDefault(); go(0, true); }
    else if (k === 'End') { e.preventDefault(); go(slides.length - 1, true); }
  });
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
    go(cur + (dx < 0 ? 1 : -1), true);
  }, { passive: true });
  var links = deck.querySelectorAll('.slide a[href^="http"]');
  for (var i = 0; i < links.length; i++) {
    links[i].setAttribute('target', '_blank');
    links[i].setAttribute('rel', 'noopener');
  }
  var saved = null;
  try { saved = localStorage.getItem(STORE); } catch (e) {}
  setMode(saved === 'scroll' ? 'scroll' : 'paged', true);
  if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
    var hint = deck.querySelector('.deck-hint');
    if (hint) hint.innerHTML = '左右滑动翻页 · 也可以点下方的箭头 · <b>目录</b> 可跳转';
  }
  var fromHash = parseInt((location.hash || '').replace('#', ''), 10);
  cur = isNaN(fromHash) ? 0 : clampNo(fromHash - 1);
  paint(false);
  window.__deck = {
    count: slides.length,
    state: function () {
      return {
        mode: mode, current: cur, total: slides.length,
        section: sectionOf(cur),
        title: slides[cur].getAttribute('data-title') || '',
        visible: slides.filter(function (s) { return s.getClientRects().length > 0; }).length,
        full: deck.classList.contains('is-full'),
        outlineOpen: !!(outline && !outline.hidden),
        progress: elProgress ? elProgress.style.width : ''
      };
    },
    go: function (n) { go(n, false); },
    mode: function (m) { setMode(m, true); },
    full: function () { toggleFull(); },
    outline: function (open) { toggleOutline(open); }
  };
})();