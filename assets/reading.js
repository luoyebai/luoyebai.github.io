(function () {
  'use strict';
  if (window.parent !== window) return; // 后台预览及嵌入演示不读写阅读记录。
  var KEY = 'blog.reading.v1';
  function pathFor(value) {
    try {
      var url = new URL(value, location.href);
      return url.origin === location.origin && /^https?:$/.test(url.protocol) ? url.pathname : '';
    } catch (e) { return ''; }
  }
  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (raw.version !== 1 || !raw.entries || typeof raw.entries !== 'object') return {};
      var clean = Object.create(null);
      Object.keys(raw.entries).forEach(function (key) {
        var e = raw.entries[key];
        if (pathFor(key) !== key || !e || ['post', 'doc'].indexOf(e.kind) < 0 || !Number.isFinite(e.updated)) return;
        clean[key] = e;
      });
      return clean;
    } catch (e) { return {}; }
  }
  function status(entry) {
    if (!entry) return '未开始';
    if (entry.complete) return '已读完';
    return entry.kind === 'doc' ? '读至第 ' + ((Number(entry.page) || 0) + 1) + ' 页' : '读至 ' + (entry.label || '正文');
  }
  function updateDiscovery() {
    var entries = read();
    document.querySelectorAll('[data-reading-url]').forEach(function (el) {
      var entry = entries[pathFor(el.getAttribute('data-reading-url'))];
      el.setAttribute('data-reading-state', entry ? entry.complete ? 'complete' : 'reading' : 'unread');
      var label = el.querySelector('[data-reading-status]');
      if (label) label.textContent = status(entry);
    });
    document.querySelectorAll('[data-reading-recent]').forEach(function (section) {
      var list = section.querySelector('[data-reading-recent-list]');
      if (!list) return;
      list.replaceChildren();
      Object.keys(entries).filter(function (key) { return !entries[key].complete; })
        .sort(function (a, b) { return entries[b].updated - entries[a].updated; }).slice(0, 3)
        .forEach(function (key) {
          var entry = entries[key], a = document.createElement('a');
          a.className = 'reading-recent-link'; a.href = key;
          var title = document.createElement('strong'), detail = document.createElement('small');
          title.textContent = entry.title || '继续阅读'; detail.textContent = status(entry);
          a.append(title, detail); list.appendChild(a);
        });
      section.hidden = !list.children.length;
    });
  }
  function init() {
    updateDiscovery();
    window.addEventListener('storage', function (event) { if (event.key === KEY || event.key === null) updateDiscovery(); });
    var deck = document.getElementById('deck'), api = window.__deck;
    var prose = document.body.classList.contains('page-post') ? document.querySelector('.post-main > .prose') : null;
    var isDoc = !!(deck && api && api.bookmark);
    if (!isDoc && !prose) return;
    var kind = isDoc ? 'doc' : 'post', route = location.pathname;
    var titleNode = document.querySelector(isDoc ? '.doc-title' : '.phero-title');
    var title = titleNode ? titleNode.textContent.trim() : document.title;
    var headings = prose ? Array.from(prose.querySelectorAll('h2[id], h3[id], h4[id]')) : [];
    var saved = read()[route], pending = null, dirty = false, suppress = false;
    var initialY = window.scrollY, eligible = !saved || !!location.hash;
    var tools = document.createElement('div'); tools.className = 'reading-tools';
    var resume = document.createElement('div'); resume.className = 'reading-resume'; resume.hidden = true;
    var focus = document.createElement('button'); focus.type = 'button'; focus.className = 'btn ghost';
    focus.setAttribute('data-toggle-focus', '');
    var focused = document.documentElement.getAttribute('data-focus') === 'on';
    focus.textContent = focused ? '退出专注' : '专注阅读'; focus.setAttribute('aria-pressed', String(focused));
    var note = document.createElement('span'); note.className = 'reading-note'; note.textContent = '阅读进度仅保存在本机';
    var actions = document.createElement('div'); actions.className = 'reading-actions'; actions.append(focus, note);
    tools.append(resume, actions);
    (isDoc ? deck : prose).before(tools);
    function dismiss() { eligible = true; resume.hidden = true; }
    function button(text, action) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.textContent = text;
      b.addEventListener('click', action); return b;
    }
    function articlePosition() {
      var rect = prose.getBoundingClientRect();
      if (rect.top > 160) return null;
      var heading = null;
      headings.forEach(function (h) { if (h.getBoundingClientRect().top <= 160) heading = h; });
      var anchorRect = (heading || prose).getBoundingClientRect();
      var range = Math.max(1, rect.height - innerHeight + 120);
      return { anchor: heading ? heading.id : '', label: heading ? heading.textContent.replace(/#\s*$/, '').trim() : '正文',
        offset: Math.max(0, 120 - anchorRect.top), ratio: Math.max(0, Math.min(1, (120 - rect.top) / range)),
        complete: rect.bottom <= innerHeight + 40 && rect.top < 120 };
    }
    function snapshot() {
      var pos = isDoc ? api.bookmark() : articlePosition();
      if (!pos) return null;
      return Object.assign({ kind: kind, title: title.slice(0, 180), updated: Date.now() }, pos);
    }
    function flush() {
      window.clearTimeout(pending); pending = null;
      if (!eligible || !dirty || suppress) return;
      dirty = false;
      var entry = snapshot(); if (!entry) return;
      var entries = read(); entries[route] = entry;
      var keys = Object.keys(entries).sort(function (a, b) { return entries[b].updated - entries[a].updated; });
      keys.slice(100).forEach(function (key) { delete entries[key]; });
      try { localStorage.setItem(KEY, JSON.stringify({ version: 1, entries: entries })); } catch (e) {  }
    }
    function changed() {
      if (suppress) return;
      dirty = true;
      if (!eligible) return;
      if (pending === null) pending = window.setTimeout(flush, 1200);
    }
    function resumeReading() {
      dismiss(); suppress = true;
      if (isDoc) api.restore(saved);
      else {
        var target = saved.anchor ? document.getElementById(saved.anchor) : prose;
        if (target && prose.contains(target)) {
          window.scrollTo({ top: Math.max(0, scrollY + target.getBoundingClientRect().top - 120 + (Number(saved.offset) || 0)), behavior: 'auto' });
        } else {
          var rect = prose.getBoundingClientRect();
          window.scrollTo({ top: Math.max(0, scrollY + rect.top - 120 + Math.max(0, Math.min(1, Number(saved.ratio) || 0)) * Math.max(1, rect.height - innerHeight + 120)), behavior: 'auto' });
        }
      }
      suppress = false; changed();
    }
    function restart() {
      dismiss(); suppress = true;
      if (isDoc) api.restore({ page: 0, step: 0, mode: api.state().mode });
      else window.scrollTo({ top: Math.max(0, scrollY + prose.getBoundingClientRect().top - 120), behavior: 'auto' });
      suppress = false; changed();
    }
    if (saved && saved.kind === kind && !location.hash) {
      var message = document.createElement('p');
      message.textContent = saved.complete ? '这篇内容上次已读完，可以从头再看。' : '上次' + status(saved) + (isDoc && saved.step ? ' · 已展开 ' + saved.step + ' 步' : '') + '。';
      resume.appendChild(message);
      if (!saved.complete) resume.appendChild(button('继续阅读', resumeReading));
      resume.appendChild(button('从头开始', restart)); resume.hidden = false;
    }
    if (isDoc) deck.addEventListener('deck:change', function () {
      if (suppress) return;
      dismiss(); changed();
    });
    window.addEventListener('scroll', function () {
      if (!eligible && Math.abs(scrollY - initialY) > 240) dismiss();
      changed();
    }, { passive: true });
    window.addEventListener('hashchange', function () { dismiss(); changed(); });
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
  }
  if (document.readyState === 'complete') init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();