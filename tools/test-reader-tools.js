/* Behavior tests for real browser controllers: recovery, navigation, privacy and reversible appearance. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Events {
  constructor() { this.events = {}; }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  dispatchEvent(e) { for (const fn of this.events[e.type] || []) fn(e); }
  emit(type, props = {}) { this.dispatchEvent({ type, preventDefault() {}, ...props }); }
}
class Element extends Events {
  constructor(tag = 'div', attrs = {}) {
    super(); this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = [];
    this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    this.hidden = false; this.textContent = ''; this.value = ''; this.isConnected = true;
    this.top = 0; this.height = 400; this.clientHeight = 400; this.scrollHeight = 400; this.scrollTop = 0;
    this.classList = { contains: c => this.className.split(' ').includes(c),
      add: c => this.classList.toggle(c, true), remove: c => this.classList.toggle(c, false),
      toggle: (c, force) => { const s = new Set(this.className.split(' ').filter(Boolean)); const on = force === undefined ? !s.has(c) : force; if (on) s.add(c); else s.delete(c); this.className = [...s].join(' '); return on; } };
  }
  get id() { return this.attrs.id || ''; }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return Object.hasOwn(this.attrs, k); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  toggleAttribute(k, on) { if (on) this.setAttribute(k, ''); else this.removeAttribute(k); }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
  appendChild(n) { n.parentElement = this; this.children.push(n); return n; }
  before(n) { const p = this.parentElement; n.parentElement = p; p.children.splice(p.children.indexOf(this), 0, n); }
  after(n) { const p = this.parentElement; n.parentElement = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  matches(selector) {
    return selector.split(',').some(part => {
      const s = part.trim();
      if (!s || s.includes(' ')) return false;
      const tag = s.match(/^[a-z][\w-]*/i); if (tag && this.tagName !== tag[0].toUpperCase()) return false;
      for (const m of s.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(m[1])) return false;
      for (const m of s.matchAll(/\[([\w-]+)(?:([\^]?=)"([^"]*)")?\]/g)) {
        const v = this.getAttribute(m[1]); if (v === null) return false;
        if (m[2] === '=' && v !== m[3]) return false;
        if (m[2] === '^=' && !v.startsWith(m[3])) return false;
      }
      return true;
    });
  }
  closest(s) { for (let n = this; n; n = n.parentElement) if (n.matches(s)) return n; return null; }
  querySelectorAll(s) {
    const result = [];
    for (const n of this.children) { if (n.matches(s)) result.push(n); result.push(...n.querySelectorAll(s)); }
    return result;
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  getBoundingClientRect() { return { top: this.top, bottom: this.top + this.height, height: this.height, width: 900 }; }
  getClientRects() { return [{}]; }
  focus() { this.focused = true; }
  select() {}
  blur() {}
  scrollIntoView() { this.scrolled = true; }
  set innerHTML(v) {
    this.html = v; this.children = [];
    for (const match of v.matchAll(/<a class="([^"]+)" href="([^"]+)">/g)) this.appendChild(new Element('a', { class: match[1], href: match[2] }));
  }
  get innerHTML() { return this.html || ''; }
}
function harness(url = 'http://localhost/posts/test/') {
  const root = new Element('html'), body = root.appendChild(new Element('body'));
  const document = Object.assign(new Events(), { documentElement: root, body, readyState: 'complete', hidden: false,
    createElement: tag => new Element(tag), querySelectorAll: s => root.querySelectorAll(s),
    querySelector: s => root.querySelector(s), getElementById: id => root.querySelectorAll('[id]').find(e => e.id === id) || null,
    activeElement: body });
  const timers = new Map(), storage = new Map(); let tick = 0, writes = 0;
  let currentUrl = new URL(url);
  const location = new Proxy({}, { get(_target, prop) { return currentUrl[prop]; },
    set(_target, prop, value) { if (prop === 'href') currentUrl = new URL(value, currentUrl); else currentUrl[prop] = value; return true; } });
  const window = Object.assign(new Events(), { document, location, scrollY: 0, innerHeight: 800,
    setTimeout: fn => { timers.set(++tick, fn); return tick; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { timers.set(++tick, fn); return tick; },
    scrollTo(opts) { this.lastScroll = opts; this.scrollY = opts.top; },
    matchMedia: () => ({ matches: false, addEventListener() {} }) });
  window.parent = window;
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem(key, value) { storage.set(key, value); writes++; }, removeItem: key => storage.delete(key) };
  const context = vm.createContext({ window, document, location, localStorage, URL, URLSearchParams,
    console, Date, Number, Object, Array, Math, Promise, navigator: {}, innerHeight: 800,
    getComputedStyle: () => ({ getPropertyValue: () => '#fff' }), matchMedia: window.matchMedia,
    requestAnimationFrame: window.requestAnimationFrame, CustomEvent: class { constructor(type) { this.type = type; } },
    history: { replaceState(_a, _b, hash) { location.hash = hash; } } });
  Object.defineProperty(context, 'scrollY', { get: () => window.scrollY });
  return { root, body, document, window, context, storage, timers, location, get writes() { return writes; },
    add: (tag, attrs, parent = body) => parent.appendChild(new Element(tag, attrs)),
    run(name) { vm.runInContext(fs.readFileSync(path.join(__dirname, '../theme/static/js/' + name + '.js'), 'utf8'), context, { filename: name + '.js' }); },
    tick() { const list = [...timers.values()]; timers.clear(); list.forEach(fn => fn()); } };
}
function article(h) {
  h.body.classList.add('page-post');
  const main = h.add('main', { class: 'post-main' }), prose = h.add('div', { class: 'prose' }, main);
  prose.top = -700; prose.height = 4000;
  const heading = h.add('h2', { id: 'chapter-two' }, prose); heading.top = -70; heading.textContent = '第二节';
  h.add('h1', { class: 'phero-title' }).textContent = '测试文章';
  const query = h.document.querySelector;
  h.document.querySelector = s => s === '.post-main > .prose' ? prose : query(s);
  return { main, prose, heading };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function searchTests() {
  const h = harness(), panel = h.add('div', { id: 'search' }); panel.hidden = true;
  const input = h.add('input', { 'data-search-input': '' }, panel), box = h.add('div', { 'data-search-results': '' }, panel);
  let requests = 0;
  h.context.fetch = async () => {
    requests++;
    if (requests === 1) return { ok: false };
    return { ok: true, json: async () => [
      { t: 'post', title: 'Linux article', url: '/posts/linux/', summary: 'short', text: 'prefix '.repeat(70) + 'Linux deep body match' },
      { t: 'doc', title: 'Linux slides', url: '/docs/linux/', summary: 'intro', text: 'exact Linux document context' },
      { t: 'project', title: 'Linux project', url: '/projects/linux/', text: 'Linux' },
      { t: 'doc', title: 'Linux evil', url: 'javascript:alert(1)' },
    ] };
  };
  h.run('search'); input.value = 'Linux'; h.window.__openSearch(); await settle();
  assert.match(box.innerHTML, /重新加载/);
  h.window.__openSearch(); await settle(); assert.equal(requests, 2); assert.match(box.innerHTML, /3 条结果/);
  assert.match(box.innerHTML, /<span class="st">文档/); assert.match(box.innerHTML, /deep body match/);
  assert.doesNotMatch(box.innerHTML, /javascript:|Linux evil/);
  const docFilter = panel.querySelector('[data-search-type="doc"]'); panel.emit('click', { target: docFilter });
  assert.match(box.innerHTML, /1 条结果/); assert.doesNotMatch(box.innerHTML, /Linux article/);
  input.emit('keydown', { key: 'ArrowDown' }); input.emit('keydown', { key: 'Enter' });
  assert.equal(h.location.pathname, '/docs/linux/');
  input.value = 'no-match'; input.emit('input'); h.tick(); assert.match(box.innerHTML, /没有匹配的文档/);
  h.document.emit('keydown', { key: 'Escape' }); assert.equal(panel.hidden, true);
  console.log('✓ search: retry, type filters, body excerpts, safe URLs and keyboard');
}
function readingTests() {
  const h = harness(); const { prose } = article(h);
  const record = { version: 1, entries: { '/posts/test/': { kind: 'post', title: '测试文章', anchor: 'chapter-two', label: '第二节', offset: 190, ratio: .25, updated: Date.now() } } };
  h.storage.set('blog.reading.v1', JSON.stringify(record)); h.run('reading');
  assert.equal(h.window.lastScroll, undefined, 'opening must not jump');
  assert.equal(h.writes, 0, 'opening must not overwrite previous progress');
  h.window.emit('pagehide'); assert.equal(h.writes, 0);
  h.root.querySelectorAll('button').find(b => b.textContent === '继续阅读').emit('click');
  assert.equal(h.window.lastScroll.top, 0); // top -70 - offset120 + saved offset190
  for (let i = 0; i < 30; i++) h.window.emit('scroll');
  assert.equal(h.writes, 0, 'scrolls are throttled'); h.tick(); assert.equal(h.writes, 1);
  assert.equal(JSON.parse(h.storage.get('blog.reading.v1')).entries['/posts/test/'].anchor, 'chapter-two');
  prose.top = -3400; h.window.emit('scroll'); h.window.emit('pagehide');
  assert.equal(JSON.parse(h.storage.get('blog.reading.v1')).entries['/posts/test/'].complete, true);
  const deep = harness('http://localhost/posts/test/#explicit'); article(deep); deep.storage.set('blog.reading.v1', JSON.stringify(record)); deep.run('reading');
  assert.equal(deep.root.querySelector('.reading-resume').hidden, true); assert.equal(deep.location.hash, '#explicit');
  const preview = harness(); article(preview); preview.window.parent = {}; preview.run('reading');
  assert.equal(preview.root.querySelector('.reading-tools'), null); assert.equal(preview.writes, 0);
  const broken = harness(); article(broken); broken.storage.set('blog.reading.v1', '{broken'); broken.run('reading');
  broken.window.emit('scroll'); broken.tick(); assert.equal(broken.writes, 1);
  const learning = harness('http://localhost/learning/'); article(learning); learning.body.classList.remove('page-post');
  learning.run('reading'); assert.equal(learning.root.querySelector('.reading-tools'), null, 'ordinary pages are not articles');
  console.log('✓ article resume: explicit opt-in, hash preservation, throttling, completion, preview isolation and corrupt storage');
}
function appearanceTests() {
  const h = harness(); h.root.setAttribute('data-theme', 'dusk');
  const settings = { theme: 'dusk', bg: 'on', motion: 'on', tilt: '20', cursor: 'glow', mode: 'light', bgmode: 'video', accent: '#123456' };
  h.storage.set('blog.appearance', JSON.stringify(settings)); h.run('theme');
  h.window.Theme.set({ focus: 'on' });
  assert.equal(h.root.getAttribute('data-motion'), 'off'); assert.equal(h.root.getAttribute('data-bg'), 'off');
  assert.equal(h.window.Theme.state.bg, 'on'); assert.equal(h.window.Theme.state.tilt, '20');
  assert.equal(h.root.getAttribute('data-mode'), 'light');
  h.window.Theme.set({ focus: 'off' });
  for (const key of ['theme', 'bg', 'motion', 'tilt', 'cursor', 'mode', 'bgmode']) assert.equal(h.root.getAttribute('data-' + key), settings[key]);
  assert.equal(h.window.Theme.state.accent, '#123456');
  console.log('✓ focus preset restores wallpaper, motion, cursor and tilt without losing color choices');
}
function deckTests() {
  const h = harness('http://localhost/docs/test/'), deck = h.add('section', { id: 'deck' });
  const stage = h.add('div', { 'data-deck-stage': '' }, deck);
  for (let i = 0; i < 3; i++) {
    const slide = h.add('section', { class: 'slide', 'data-title': 'Page ' + (i + 1) }, stage);
    for (let j = 0; j < 2; j++) h.add('div', { class: 'deck-fragment' }, slide);
  }
  h.run('docs'); const api = h.window.__deck;
  api.restore({ page: 1, step: 1, mode: 'paged' });
  assert.equal(api.state().current, 1); assert.equal(api.state().step, 1);
  assert.equal(deck.querySelectorAll('.slide')[1].querySelectorAll('.is-pending').length, 1);
  assert.equal(h.location.hash, '', 'restoring must not rewrite an explicit URL');
  api.restore({ page: 99, step: 99 }); assert.equal(api.state().current, 2); assert.equal(api.state().step, 2);
  assert.equal(api.bookmark().complete, true);
  api.restore({ page: 0, step: 0 }); assert.equal(api.bookmark().complete, false);
  api.mode('scroll'); const slides = deck.querySelectorAll('.slide');
  slides[0].top = -700; slides[1].top = -100; slides[2].top = 700;
  assert.equal(api.bookmark().page, 1, 'continuous mode follows actual viewport');
  console.log('✓ PPT resume restores and clamps page/step, preserves URL, tracks continuous mode');
}
(async () => { await searchTests(); readingTests(); appearanceTests(); deckTests(); })().catch(error => { console.error(error); process.exitCode = 1; });
