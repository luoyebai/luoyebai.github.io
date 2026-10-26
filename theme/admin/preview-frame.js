/* Runs inside the opaque live-preview iframe; communicates only with its parent. */
(function () {
  'use strict';
  var config = window.PREVIEW_CONFIG || {};
  var token = config.token;
  if (!token) return;
  var probeY = 24;
  var restoreLine = positive(config.restoreLine);
  var interacted = false;
  var restoring = false;
  var restoreFrame = 0;
  var reportTimer = 0;
  var lastReport = '';
  var suppressUntil = 0;

  function positive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }
  function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
  function send(type, data) {
    parent.postMessage(Object.assign({ type: type, token: token }, data || {}), '*');
  }
  function shown(el) {
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    var rect = el.getBoundingClientRect();
    return rect.height > 0 && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  function sourceBlocks() {
    return Array.from(document.querySelectorAll('[data-source-line]')).filter(function (el) {
      if (!shown(el)) return false;
      // A slide/fragment surrounds many source blocks. Prefer its visible
      // children, otherwise a tall wrapper overwhelms precise paragraph maps.
      if (el.matches('.slide, .deck-fragment')) {
        return !Array.from(el.querySelectorAll('[data-source-line]')).some(shown);
      }
      return positive(Number(el.getAttribute('data-source-line'))) !== null;
    });
  }
  function bounds(el) {
    var first = Number(el.getAttribute('data-source-line')) || 1;
    return { first: first, last: Math.max(first, Number(el.getAttribute('data-source-end')) || first) };
  }
  function codeGeometry(el) {
    if (!el.matches('.code-block')) return null;
    var pre = el.querySelector('.code-pre');
    if (!pre) return null;
    var css = getComputedStyle(pre);
    var height = parseFloat(css.lineHeight) || (parseFloat(css.fontSize) || 14) * 1.72;
    var padding = parseFloat(css.paddingTop) || 0;
    var total = Math.max(1, Number(el.getAttribute('data-lines')) || bounds(el).last - bounds(el).first - 1);
    var folded = el.classList.contains('is-folded');
    var visible = folded ? Math.max(1, Math.floor((pre.clientHeight - padding - (parseFloat(css.paddingBottom) || 0)) / height)) : total;
    return { pre: pre, top: pre.getBoundingClientRect().top + padding, height: height,
      count: Math.min(total, folded ? Math.min(24, visible) : total) };
  }
  function lineAt(el, y) {
    var range = bounds(el);
    var code = codeGeometry(el);
    if (code) {
      if (y < code.top) return range.first;
      var row = clamp(Math.floor((y - code.top + code.pre.scrollTop) / code.height), 0, code.count - 1);
      return Math.min(range.last, range.first + 1 + row);
    }
    var rect = el.getBoundingClientRect();
    var fraction = clamp((y - rect.top) / Math.max(1, rect.height), 0, 0.999999);
    return range.first + Math.floor(fraction * (range.last - range.first + 1));
  }
  function closestBlock(blocks, y) {
    var above = null, below = null;
    blocks.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
      if (rect.top <= y) {
        if (!above || rect.top >= above.getBoundingClientRect().top) above = el;
      } else if (!below || rect.top < below.getBoundingClientRect().top) below = el;
    });
    return above || below;
  }
  function reportPosition() {
    reportTimer = 0;
    if (!interacted || restoring || Date.now() < suppressUntil) return;
    var el = closestBlock(sourceBlocks(), probeY);
    if (!el) return;
    var line = lineAt(el, probeY);
    var slide = el.closest('[data-block-index]');
    var blockIndex = slide ? Number(slide.getAttribute('data-block-index')) : null;
    var signature = line + ':' + blockIndex;
    if (signature === lastReport) return;
    lastReport = signature;
    send('blog-preview-scroll', { line: line, blockIndex: blockIndex });
  }
  function queueReport() {
    if (!interacted || reportTimer || restoring) return;
    reportTimer = window.setTimeout(reportPosition, 65);
  }
  function userInteraction() {
    interacted = true;
    restoreLine = null;
    if (restoreFrame) cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
  }
  function blockForLine(blocks, line) {
    var match = null, preceding = null, following = null;
    blocks.forEach(function (el) {
      var range = bounds(el);
      if (range.first <= line && range.last >= line) {
        if (!match || range.last - range.first < bounds(match).last - bounds(match).first) match = el;
      }
      if (range.first <= line && (!preceding || range.first > bounds(preceding).first)) preceding = el;
      if (range.first > line && (!following || range.first < bounds(following).first)) following = el;
    });
    return match || preceding || following;
  }
  function positionForLine(el, line) {
    var range = bounds(el), code = codeGeometry(el);
    if (code && line > range.first) {
      return window.scrollY + code.top + clamp(line - range.first - 1, 0, code.count - 1) * code.height - probeY;
    }
    var rect = el.getBoundingClientRect();
    var fraction = clamp((line - range.first) / Math.max(1, range.last - range.first + 1), 0, 1);
    return window.scrollY + rect.top + fraction * rect.height - probeY;
  }
  function restorePosition() {
    restoreFrame = 0;
    if (interacted || restoreLine === null) return;
    var el = blockForLine(sourceBlocks(), restoreLine);
    if (!el) return;
    restoring = true;
    suppressUntil = Date.now() + 100;
    window.scrollTo({ top: Math.max(0, positionForLine(el, restoreLine)), behavior: 'instant' });
    restoring = false;
  }
  function queueRestore() {
    if (interacted || restoreLine === null || restoreFrame) return;
    restoreFrame = requestAnimationFrame(restorePosition);
  }
  function setSteps(step, all) {
    var count = Math.max(0, Number(step) || 0);
    var slides = Array.from(document.querySelectorAll('.slide'));
    if (!slides.length) slides = [document];
    slides.forEach(function (slide) {
      slide.querySelectorAll('.deck-fragment').forEach(function (fragment, index) {
        var hidden = !all && index >= count;
        fragment.hidden = hidden;
        fragment.classList.toggle('is-pending', hidden);
        fragment.setAttribute('aria-hidden', String(hidden));
        fragment.toggleAttribute('inert', hidden);
      });
    });
  }

  function fallbackCopy(text) {
    var active = document.activeElement;
    var selection = window.getSelection();
    var ranges = [];
    if (selection) for (var i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange());
    var input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(input);
    input.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (error) { /* Sandbox clipboard can be unavailable. */ }
    input.remove();
    if (active && active.focus) active.focus({ preventScroll: true });
    if (selection && ranges.length) {
      selection.removeAllRanges();
      ranges.forEach(function (range) { selection.addRange(range); });
    }
    return copied;
  }
  function copyButton(button) {
    var text = '', math = button.hasAttribute('data-math-copy');
    var container = button.closest(math ? '.math-wrap, .math-figure' : '.code-block, .demo');
    var content = container && container.querySelector(math ? '[data-tex]' : 'code');
    if (!content) return;
    if (math) {
      var tex = content.getAttribute('data-tex') || '';
      text = content.classList.contains('math-block') ? '$$\n' + tex + '\n$$' : '$' + tex + '$';
    } else text = content.textContent || '';
    var copy;
    try { copy = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); }) : Promise.resolve(fallbackCopy(text)); }
    catch (error) { copy = Promise.resolve(fallbackCopy(text)); }
    copy.then(function (ok) {
      var label = button.querySelector('[data-copy-label]');
      var old = label ? label.textContent : '';
      if (label) label.textContent = ok ? '已复制' : '复制未成功';
      button.classList.toggle('is-done', ok);
      window.setTimeout(function () { if (label) label.textContent = old; button.classList.remove('is-done'); }, 1600);
    });
  }
  function click(event) {
    var target = event.target && event.target.closest ? event.target : null;
    if (!target) return;
    var button = target.closest('[data-copy], [data-math-copy]');
    if (button) { event.preventDefault(); copyButton(button); return; }
    var link = target.closest('a[href]');
    if (!link) { queueReport(); return; }
    event.preventDefault();
    // Capture prevents the public heading-anchor handler from calling
    // history.replaceState(), which is forbidden for an opaque srcdoc origin.
    event.stopImmediatePropagation();
    var href = link.getAttribute('href') || '';
    if (href.charAt(0) === '#') {
      var id;
      try { id = decodeURIComponent(href.slice(1)); } catch (error) { return; }
      var anchor = document.getElementById(id);
      if (anchor && shown(anchor)) {
        userInteraction();
        window.scrollTo({ top: Math.max(0, window.scrollY + anchor.getBoundingClientRect().top - probeY), behavior: 'instant' });
        queueReport();
      }
      return;
    }
    if (href) send('blog-preview-link', { href: href });
  }
  function boot() {
    setSteps(config.step, config.all);
    window.addEventListener('wheel', userInteraction, { passive: true });
    window.addEventListener('touchstart', userInteraction, { passive: true });
    window.addEventListener('pointerdown', userInteraction, { passive: true });
    window.addEventListener('keydown', function (event) {
      if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| |Tab)$/.test(event.key)) userInteraction();
    });
    window.addEventListener('scroll', queueReport, { passive: true, capture: true });
    document.addEventListener('click', click, true);
    // Middle-click must also stay inside the controlled preview link flow.
    document.addEventListener('auxclick', function (event) { if (event.button === 1) click(event); }, true);
    document.addEventListener('submit', function (event) { event.preventDefault(); });
    window.addEventListener('message', function (event) {
      var message = event.data;
      if (event.source !== parent || !message || message.type !== 'blog-preview-control' || message.token !== token) return;
      suppressUntil = Date.now() + 100;
      if ('step' in message) config.step = message.step;
      if ('all' in message) config.all = message.all;
      setSteps(config.step, config.all);
      if (Object.prototype.hasOwnProperty.call(message, 'restoreLine')) {
        restoreLine = positive(message.restoreLine);
        interacted = false;
      }
      queueRestore();
    });
    document.addEventListener('load', queueRestore, true);
    document.addEventListener('error', queueRestore, true);
    window.addEventListener('resize', queueRestore, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueRestore, function () {});
    if (window.ResizeObserver) new ResizeObserver(queueRestore).observe(document.body);
    queueRestore();
    send('blog-preview-ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
