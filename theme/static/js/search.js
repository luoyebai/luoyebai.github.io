/* 站内搜索：按需索引、内容类型筛选、命中上下文和键盘导航。 */
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
  // 在原文中定位，再分别转义，避免关键词命中 &amp; 之类的 HTML 实体。
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
