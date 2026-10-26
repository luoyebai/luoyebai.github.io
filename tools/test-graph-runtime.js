/* Actual graph.js in a deterministic DOM/canvas. Browser projection, focus
   appearance and touch scrolling still need visual/native-browser checks. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../theme/static/js/graph.js'), 'utf8');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), {fn, options}]);
  }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.fn !== fn)); }
  dispatchEvent(event) { return this.emit(event.type, event); }
  emit(type, props = {}) {
    const event = {type, target: this, ...props};
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    event.stopPropagation ||= () => { event.propagationStopped = true; };
    event.stopImmediatePropagation ||= () => { event.propagationStopped = event.immediateStopped = true; };
    const chain = []; for (let el = this; el; el = el.parentNode) chain.push(el);
    const invoke = (target, capture) => {
      event.currentTarget = target;
      for (const item of target.listeners?.get(type) || []) {
        if (!!(item.options === true || item.options?.capture) !== capture) continue;
        item.fn(event); if (event.immediateStopped) break;
      }
    };
    for (const target of [...chain].reverse()) { invoke(target, true); if (event.propagationStopped) return event; }
    for (const target of chain) { invoke(target, false); if (event.propagationStopped || props.bubbles === false) break; }
    return event;
  }
}

const DATA = [
  {kind: 'post', title: 'ROS 2 通信', summary: 'DDS queue and latency', tags: ['ROS 2', 'Middleware']},
  {kind: 'project', title: 'ROS 2 controller', summary: 'Robot controller', tags: ['ROS 2', 'Control']},
  {kind: 'post', title: 'Ankle kinematics', summary: 'Parallel motion and torque', tags: ['Control', 'Math']},
  {kind: 'project', title: 'Policy runner', summary: 'Reinforcement learning deployment', tags: ['RL', 'Control']},
  {kind: 'post', title: '<img src=x onerror=alert(1)>', summary: 'Literal HTML is documentation', tags: ['<svg onload=alert(1)>', 'Math']},
  {kind: 'post', title: 'ROS 2 executor', summary: 'Callback scheduling', tags: ['ROS 2', 'Middleware']},
];

function harness({motion = 'on', reduced = false, compact = false, context = true, items = DATA, count = items.length,
  width = 1100, height = 680, cardWidth = 250, cardHeight = 330} = {}) {
  let time = 0, nextFrame = 0, seed = 19, randomCalls = 0;
  const frames = new Map(), resizers = [], intersections = [], unsafeHTML = [], contexts = [], errors = [];
  let document;
  class Element extends Events {
    constructor(tag, attrs = {}) {
      super(); this.tagName = tag.toUpperCase(); this.attrs = {...attrs}; this.children = [];
      this.parentNode = this.parentElement = null; this._text = ''; this.hidden = false; this.disabled = false;
      this.value = ''; this.open = false; this.capture = null; this.tabIndex = this.tagName === 'A' ? 0 : -1;
      this.rect = {left: 40, top: 80, width: 1100, height: 680};
      const values = new Map();
      this.style = {setProperty: (key, value) => values.set(key, String(value)),
        getPropertyValue: key => values.get(key) || '', removeProperty: key => values.delete(key)};
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => { const enabled = force ?? !this.classList.contains(name); this.classList[enabled ? 'add' : 'remove'](name); return enabled; }
      };
      this.dataset = new Proxy({}, {get: (_, key) => this.getAttribute('data-' + String(key).replace(/[A-Z]/g, char => '-' + char.toLowerCase()))});
    }
    get className() { return this.attrs.class || ''; }
    set className(value) { this.attrs.class = String(value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value ?? ''); this.children = []; }
    get innerHTML() { return this.textContent; }
    set innerHTML(value) { if (value) unsafeHTML.push({element: this, value: String(value)}); this.textContent = value; }
    get firstChild() { return this._text ? {nodeValue: this._text, textContent: this._text} : this.children[0] || null; }
    get firstElementChild() { return this.children[0] || null; }
    get childNodes() { return this.children; }
    get href() { return this.attrs.href || ''; }
    set href(value) { this.attrs.href = String(value); }
    get offsetWidth() { return this.rect.width; }
    get offsetHeight() { return this.hidden ? 0 : this.rect.height; }
    get clientWidth() { return this.rect.width; }
    get clientHeight() { return this.rect.height; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) { this.attrs[name] = String(value); this.changed?.(name); }
    removeAttribute(name) { delete this.attrs[name]; this.changed?.(name); }
    hasAttribute(name) { return this.getAttribute(name) !== null; }
    appendChild(child) { child.parentNode = child.parentElement = this; this.children.push(child); return child; }
    append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? Object.assign(new Element('text'), {_text: node}) : node); }
    replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(el => el !== this); }
    contains(node) { for (let el = node; el; el = el.parentNode) if (el === this) return true; return false; }
    matches(selector) {
      return selector.split(',').some(part => {
        const s = part.trim(), tag = s.match(/^[a-z][\w-]*/i);
        if (tag && this.tagName !== tag[0].toUpperCase()) return false;
        for (const match of s.matchAll(/#([\w-]+)|\.([\w-]+)|\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
          if (match[1] && this.getAttribute('id') !== match[1]) return false;
          if (match[2] && !this.classList.contains(match[2])) return false;
          if (match[3] && (match[4] === undefined ? !this.hasAttribute(match[3]) : this.getAttribute(match[3]) !== match[4])) return false;
        }
        return !!s;
      });
    }
    closest(selector) { for (let el = this; el instanceof Element; el = el.parentElement) if (el.matches(selector)) return el; return null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return {...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height}; }
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture(id) { if (this.capture === id) { this.capture = null; this.emit('lostpointercapture', {pointerId: id}); } }
    focus() { const previous = document.activeElement; document.activeElement = this; previous?.emit('blur', {bubbles: false}); previous?.emit('focusout'); this.emit('focus', {bubbles: false}); this.emit('focusin'); }
    scrollIntoView() {}
  }
  const create = (tag, attrs, parent, text) => { const el = new Element(tag, attrs); if (text !== undefined) el.textContent = text; if (parent) parent.appendChild(el); return el; };
  const root = create('html', {class: 'js', 'data-motion': motion, 'data-performance': compact ? 'compact' : 'full'});
  const body = create('body', {}, root), page = create('section', {class: 'graph-page'}, body);
  const bar = create('div', {class: 'graph-bar'}, page);
  const q = create('input', {id: 'graph-q', type: 'search'}, bar);
  const layout = create('div', {id: 'graph-layout'}, bar);
  const layouts = Object.fromEntries(['shelf', 'nebula'].map(value => [value, create('button', {'data-val': value}, layout, value)]));
  const kind = create('div', {id: 'graph-kind'}, bar);
  const kinds = Object.fromEntries(['all', 'post', 'project'].map(value => [value, create('button', {'data-kind': value}, kind, value)]));
  const auto = create('button', {id: 'graph-auto'}, bar), reset = create('button', {id: 'graph-reset'}, bar), clear = create('button', {id: 'graph-clear'}, bar);
  const zoomIn = create('button', {id: 'graph-zoom-in'}, bar), zoomOut = create('button', {id: 'graph-zoom-out'}, bar), zoomLabel = create('output', {id: 'graph-zoom-label'}, bar);
  const stage = create('div', {id: 'graph-stage'}, page); stage.tabIndex = 0;
  const makeCanvas = id => {
    const canvas = create('canvas', {id}, stage), ctx = {canvas, operations: 0, clears: 0, invalid: []};
    canvas.rect.width = width; canvas.rect.height = height;
    const record = (name, args) => { ctx.operations++; if (args.some(value => typeof value === 'number' && !Number.isFinite(value))) ctx.invalid.push([name, ...args]); };
    for (const name of ['arc', 'beginPath', 'closePath', 'fill', 'fillRect', 'lineTo', 'moveTo', 'restore', 'save', 'scale', 'setTransform', 'stroke', 'translate', 'setLineDash']) ctx[name] = (...args) => record(name, args);
    ctx.clearRect = (...args) => { ctx.clears++; record('clearRect', args); };
    for (const name of ['createLinearGradient', 'createRadialGradient']) ctx[name] = (...args) => { record(name, args); return {addColorStop() {}}; };
    canvas.getContext = () => context ? ctx : null; contexts.push(ctx); return canvas;
  };
  const canvas = makeCanvas('graph-canvas'), linkCanvas = makeCanvas('graph-links');
  const world = create('div', {id: 'graph-world'}, stage), labels = create('div', {id: 'graph-labels'}, stage);
  const status = create('span', {id: 'graph-status'}, stage), hint = create('span', {id: 'graph-hint'}, stage);
  const legend = create('div', {id: 'graph-legend'}, page);
  const results = create('details', {id: 'graph-results'}, page), resultCount = create('span', {id: 'graph-result-count'}, results);
  const empty = create('p', {id: 'graph-empty'}, results); empty.hidden = true;
  const list = create('ul', {class: 'graph-result-list'}, results);
  const detail = create('aside', {id: 'graph-detail'}, page);
  const details = Object.fromEntries(['kind', 'title', 'summary', 'tags', 'link', 'related'].map(key => [key, create(key === 'link' ? 'a' : 'div', {id: 'graph-detail-' + key}, detail)]));
  const nodes = items.slice(0, count), cards = [], resultItems = [], resultLinks = [];
  nodes.forEach((node, index) => {
    const cloth = index % 6 + 1;
    const attrs = {'data-idx': String(index), 'data-kind': node.kind, 'data-year': '2026', 'data-date': '2026-10-01', 'data-tags': node.tags.join('|'), 'data-cloth': String(cloth), href: '/posts/node-' + index + '/'};
    const card = create('a', {...attrs, class: 'gcard gcl-' + cloth + (index === 3 ? ' is-archived' : '')}, world);
    card.rect.width = cardWidth; card.rect.height = cardHeight;
    create('span', {class: 'gcard-title'}, card, node.title); create('span', {class: 'gcard-sum'}, card, node.summary); cards.push(card);
    const item = create('li', {'data-idx': String(index), 'data-kind': node.kind, class: 'graph-result'}, list);
    const link = create('a', {href: attrs.href, class: 'graph-result-link'}, item);
    create('span', {class: 'graph-result-title'}, link, node.title); resultItems.push(item); resultLinks.push(link);
  });
  const tags = Object.fromEntries([...new Set(nodes.flatMap(node => node.tags))].map(tag => [tag, create('button', {class: 'graph-tag-chip', 'data-tag': tag}, legend, tag)]));
  const outside = create('button', {}, body, 'Unrelated page control');
  const reduce = Object.assign(new Events(), {matches: reduced});
  class MutationObserver {
    constructor(fn) { this.fn = fn; }
    observe(target, {attributeFilter = []} = {}) { const previous = target.changed; target.changed = name => { previous?.(name); if (!attributeFilter.length || attributeFilter.includes(name)) this.fn([{attributeName: name}]); }; }
  }
  class ResizeObserver { constructor(fn) { this.fn = fn; } observe(target) { resizers.push({fn: this.fn, target}); } }
  class IntersectionObserver { constructor(fn) { intersections.push(fn); } observe() {} }
  const requestAnimationFrame = fn => { const id = ++nextFrame; frames.set(id, fn); return id; }, cancelAnimationFrame = id => frames.delete(id);
  const css = {supports: () => true};
  const window = Object.assign(new Events(), {
    innerWidth: 1200, innerHeight: 900, devicePixelRatio: 1, CSS: css, location: {href: 'http://test/graph/'},
    matchMedia: query => query.includes('prefers-reduced-motion') ? reduce : Object.assign(new Events(), {matches: false}),
    requestAnimationFrame, cancelAnimationFrame, performance: {now: () => time},
    MutationObserver, ResizeObserver, IntersectionObserver, console: {error: (...args) => errors.push(args)},
  });
  document = Object.assign(new Events(), {
    documentElement: root, body, hidden: false, readyState: 'complete', activeElement: body, parentNode: window,
    getElementById: id => root.querySelector('#' + id), querySelector: selector => root.querySelector(selector), querySelectorAll: selector => root.querySelectorAll(selector),
    createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), {_text: String(text)}),
  }); root.parentNode = document;
  const math = Object.create(Math); math.random = () => { randomCalls++; return ((seed = seed * 16807 % 2147483647) - 1) / 2147483646; };
  vm.runInNewContext(source, {window, document, CSS: css, Math: math, performance: window.performance,
    requestAnimationFrame, cancelAnimationFrame, MutationObserver, ResizeObserver, IntersectionObserver, console: window.console,
    getComputedStyle: el => ({getPropertyValue: name => el.style.getPropertyValue(name) || ({'--bg': '#0b0d14', '--accent': '#7aa2ff', '--accent-2': '#ff9d5c', '--text-3': '#8b93a7', '--surface-2': '#1a1f2b'})[name] || ''})
  }, {filename: 'graph.js'});
  const h = {root, body, page, stage, canvas, world, q, layouts, kinds, auto, reset, clear, zoomIn, zoomOut, zoomLabel,
    cards, tags, status, hint, results, resultCount, empty, resultItems, resultLinks, details, outside, document, window, contexts, frames, unsafeHTML, errors,
    tick(ms = 1000 / 60) { time += ms; for (const [id, fn] of [...frames]) if (frames.has(id)) { frames.delete(id); fn(time); } },
    drain(max = 600) { let n = 0; while (frames.size && n++ < max) h.tick(); assert.equal(frames.size, 0, 'graph reaches idle without a perpetual RAF'); return n; },
    debug() { return window.__graph.debug(); },
    pointer(target, type, props = {}) { return target.emit(type, {button: 0, pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 300, ...props}); },
    key(target, key, props = {}) { return target.emit('keydown', {key, ...props}); },
    search(value) { q.value = value; q.emit('input'); },
    visible(value) { document.hidden = !value; document.emit('visibilitychange'); },
    intersect(value) { intersections.forEach(fn => fn([{target: stage, isIntersecting: value}])); },
    reduced(value) { reduce.matches = value; reduce.emit('change'); },
    resize(width, height) { canvas.rect.width = width; canvas.rect.height = height; resizers.forEach(({fn, target}) => fn([{target}])); },
    get randomCalls() { return randomCalls; }, get now() { return time; },
  };
  return h;
}

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} ≈ ${b}`);
const shown = h => h.resultItems.map((item, i) => item.hidden ? null : i).filter(i => i !== null);
const assertFinite = h => {
  assert.equal(h.window.__graphError, undefined);
  assert.ok(h.contexts.every(ctx => ctx.invalid.length === 0), 'canvas receives finite coordinates');
  for (const card of h.debug().cards) {
    for (const key of ['x', 'y', 'z', 'rotY', 'k']) assert.ok(Number.isFinite(card[key]), 'finite card ' + key);
    assert.ok(!/NaN|Infinity/.test(h.cards.find(el => el.getAttribute('href') === card.href)?.style.transform || ''));
  }
};

test('boot keeps each cloth colour and archived state through hover and both layouts', () => {
  const h = harness(); h.drain(); assert.equal(h.debug().live, true); assertFinite(h);
  for (const layout of ['shelf', 'nebula', 'shelf']) {
    h.layouts[layout].emit('click'); h.drain(); h.pointer(h.cards[1], 'pointerover'); h.drain();
    h.cards.forEach((card, i) => assert.ok(card.classList.contains('gcl-' + (i + 1)), 'book retains its colour class'));
    assert.equal(h.cards[3].classList.contains('is-archived'), true); assertFinite(h);
  }
});

test('pull follows downward screen movement and cancel, lost capture and blur release the held book', () => {
  for (const release of ['pointercancel', 'lostpointercapture', 'blur']) {
    const h = harness(); h.drain();
    h.pointer(h.cards[2], 'pointerdown'); h.pointer(h.window, 'pointermove', {clientY: 380}); h.tick();
    assert.equal(h.debug().captured, true); assert.ok(h.debug().cards[2].pull.y > 0, 'dragging down cannot pull the book upward');
    if (release === 'blur') h.window.emit('blur');
    else h.pointer(release === 'lostpointercapture' ? h.stage : h.window, release);
    assert.equal(h.debug().grabbing, null); assert.equal(h.debug().captured, false);
    h.drain(); assert.equal(h.debug().pulling, 0); assert.equal(h.debug().dragId, null); assertFinite(h);
  }
});

test('normal wheel and browser zoom stay native; only Shift wheel zooms the stage and wakes it', () => {
  const h = harness(); h.drain(); const zoom = h.debug().zoom;
  for (const mods of [{}, {shiftKey: true, ctrlKey: true}, {shiftKey: true, metaKey: true}]) {
    const event = h.stage.emit('wheel', {deltaY: -120, ...mods});
    assert.equal(!!event.defaultPrevented, false); h.drain(); close(h.debug().zoom, zoom);
  }
  const event = h.stage.emit('wheel', {deltaY: -120, shiftKey: true});
  assert.equal(event.defaultPrevented, true); assert.ok(h.frames.size > 0); h.drain(); assert.ok(h.debug().zoom > zoom);
  h.zoomOut.emit('click'); h.drain(); const smaller = h.debug().zoom;
  h.zoomIn.emit('click'); h.drain(); assert.ok(h.debug().zoom > smaller);
});

test('keyboard camera shortcuts are scoped to the stage and can wake an idle graph', () => {
  const h = harness(); h.drain(); const initial = h.debug().yaw;
  for (const target of [h.outside, h.q, h.kinds.post]) {
    const event = h.key(target, 'ArrowLeft'); assert.equal(!!event.defaultPrevented, false); h.drain(); close(h.debug().yaw, initial);
  }
  h.stage.focus(); h.drain(); const event = h.key(h.stage, 'ArrowLeft');
  assert.equal(event.defaultPrevented, true); assert.ok(h.frames.size > 0); h.drain(); assert.ok(h.debug().yaw > initial);
  const before = h.debug().yaw; h.key(h.stage, 'ArrowRight', {ctrlKey: true}); h.drain(); close(h.debug().yaw, before);
});

test('kind, query and tag filters compose; reset preserves them and clear restores every result', () => {
  const h = harness(); h.drain();
  h.kinds.post.emit('click'); h.search('ROS'); h.tags['ROS 2'].emit('click'); h.drain();
  assert.deepEqual(shown(h), [0, 5]); assert.equal(h.debug().kind, 'post'); assert.equal(h.debug().focusTag, 'ROS 2');
  h.cards.forEach((card, i) => assert.equal(card.tabIndex, [0, 5].includes(i) ? 0 : -1, 'filtered books are removed from keyboard navigation'));
  h.reset.emit('click'); h.drain(); assert.deepEqual(shown(h), [0, 5]);
  h.search('latency'); h.drain(); assert.deepEqual(shown(h), [0], 'summaries are searchable');
  h.kinds.project.emit('click'); h.drain(); assert.deepEqual(shown(h), []); assert.equal(h.empty.hidden, false);
  h.clear.emit('click'); h.drain();
  assert.deepEqual(shown(h), [0, 1, 2, 3, 4, 5]); assert.equal(h.q.value, ''); assert.equal(h.debug().focusTag, null);
  assert.equal(h.debug().kind, 'all'); assert.equal(h.empty.hidden, true);
});

test('search Enter opens accessible results rather than navigating; query and preview render literal text safely', () => {
  const h = harness(); h.drain(); const href = h.window.location.href;
  h.search('ROS'); h.drain(); h.key(h.q, 'Enter');
  assert.equal(h.results.open, true); assert.equal(h.document.activeElement, h.resultLinks[0]); assert.equal(h.window.location.href, href);
  h.clear.emit('click'); h.pointer(h.cards[4], 'pointerover'); h.drain();
  assert.equal(h.details.title.textContent, DATA[4].title); assert.ok(h.details.tags.textContent.includes(DATA[4].tags[0]));
  h.stage.emit('pointerleave'); h.drain(); assert.equal(h.details.title.textContent, DATA[4].title, 'preview persists after leaving a card');
  h.search('<svg onload=alert(1)>'); h.drain(); assert.deepEqual(shown(h), [4]);
  h.search('<script>not found</script>'); h.drain(); assert.deepEqual(shown(h), []); assert.equal(h.empty.hidden, false);
  assert.equal(h.unsafeHTML.length, 0, 'no query, tag or document metadata is parsed as HTML');
});

test('motion preferences stop cruise, retain usable controls and settle to idle', () => {
  for (const preference of ['motion', 'reduced']) {
    const h = harness(); h.drain(); h.auto.emit('click'); h.tick(); assert.ok(h.frames.size > 0);
    if (preference === 'motion') h.root.setAttribute('data-motion', 'off'); else h.reduced(true);
    h.drain(); const draws = h.contexts[0].clears, yaw = h.debug().yaw;
    h.tick(60000); assert.equal(h.contexts[0].clears, draws); close(h.debug().yaw, yaw);
    h.key(h.stage, 'ArrowLeft'); h.drain(); assert.ok(h.debug().yaw > yaw, 'reduced motion keeps explicit camera commands usable');
    if (preference === 'motion') h.root.setAttribute('data-motion', 'on'); else h.reduced(false);
    h.tick(); assert.ok(h.frames.size > 0, 'the chosen cruise preference resumes when animation is allowed');
    h.auto.emit('click'); h.drain(); assert.equal(h.frames.size, 0);
  }
});

test('hidden and offscreen suspension clears held state, cancels RAF and resumes without a time jump', () => {
  for (const suspend of ['visible', 'intersect']) {
    const h = harness(); h.drain(); h.pointer(h.stage, 'pointerdown');
    h.pointer(h.window, 'pointermove', {clientX: 470}); h.tick(); const yaw = h.debug().yaw;
    h[suspend](false); assert.equal(h.frames.size, 0); assert.equal(h.debug().dragId, null); assert.equal(h.debug().dragging, false);
    h.tick(60000); close(h.debug().yaw, yaw); h[suspend](true); h.tick();
    assert.ok(Math.abs(h.debug().yaw - yaw) < .08, 'resume does not integrate a minute of suspended time');
    h.drain(); assertFinite(h);
  }
});

test('camera and hover easing follow elapsed time at 30/60/120 Hz, then stop drawing and allocating random dust', () => {
  const snapshots = [30, 60, 120].map(hz => {
    const h = harness(); h.drain(); const random = h.randomCalls;
    h.key(h.stage, 'ArrowLeft'); h.pointer(h.cards[2], 'pointerover');
    for (let n = 0; n < hz / 5; n++) h.tick(1000 / hz);
    const snapshot = [h.debug().yaw, h.debug().pitch, h.debug().zoom];
    const transform = h.cards[2].style.transform; const scale = transform.match(/scale\(([^,]+)/);
    snapshot.push(scale ? Number(scale[1]) : 1);
    h.drain(); const draws = h.contexts[0].clears; h.tick(60000);
    assert.equal(h.contexts[0].clears, draws); assert.equal(h.randomCalls, random); assertFinite(h); return snapshot;
  });
  for (const state of snapshots.slice(1)) state.forEach((value, i) => close(value, snapshots[0][i], i === 3 ? .00011 : .00001));
});

test('layout switches interrupt a pull safely and repeated transitions keep finite geometry and selected filters', () => {
  const h = harness(); h.drain(); h.tags.Control.emit('click'); h.drain();
  h.pointer(h.cards[2], 'pointerdown'); h.pointer(h.window, 'pointermove', {clientX: 450, clientY: 350}); h.tick();
  assert.ok(h.debug().pullMax > 0); h.layouts.nebula.emit('click'); h.tick();
  assert.equal(h.debug().grabbing, null); assert.equal(h.debug().dragId, null); assert.equal(h.debug().pulling, 0);
  for (const value of ['shelf', 'nebula', 'shelf', 'nebula']) { h.layouts[value].emit('click'); h.tick(); assertFinite(h); }
  h.drain(); assert.equal(h.debug().layout, 'nebula'); assert.equal(h.debug().focusTag, 'Control');
  assert.deepEqual(shown(h), [1, 2, 3]); assert.equal(h.frames.size, 0);
});

test('touch vertical movement stays a page scroll and never starts pulling a book', () => {
  const h = harness(); h.drain(); const before = h.debug().yaw;
  h.pointer(h.cards[1], 'pointerdown', {pointerType: 'touch'});
  const event = h.pointer(h.window, 'pointermove', {pointerType: 'touch', clientX: 403, clientY: 390});
  assert.equal(!!event.defaultPrevented, false); assert.equal(h.debug().grabbing, null); assert.equal(h.debug().captured, false);
  h.pointer(h.window, 'pointerup', {pointerType: 'touch'}); h.drain(); close(h.debug().yaw, before);
});

test('drag suppresses only its accidental click, leaving subsequent taps and keyboard links usable', () => {
  const h = harness(); h.drain(); const card = h.cards[0];
  assert.equal(!!card.emit('click', {detail: 1}).defaultPrevented, false);
  h.pointer(card, 'pointerdown'); h.pointer(h.window, 'pointermove', {clientX: 460}); h.tick();
  h.pointer(h.window, 'pointerup');
  assert.equal(card.emit('click', {detail: 1}).defaultPrevented, true);
  h.drain(); h.tick(500);
  h.pointer(card, 'pointerdown'); h.pointer(h.window, 'pointerup');
  assert.equal(!!card.emit('click', {detail: 1}).defaultPrevented, false, 'a new tap is a normal link activation');
  assert.equal(!!h.key(card, 'Enter').defaultPrevented, false, 'native link keyboard activation stays available');
});

test('canvas initialization failure leaves a readable fallback and no spinning animation', () => {
  const h = harness({context: false});
  assert.equal(h.stage.classList.contains('is-fallback'), true); assert.equal(h.frames.size, 0);
  assert.equal(h.root.classList.contains('js'), true, 'failure does not disable unrelated page scripts');
  assert.ok(h.resultLinks.every(link => !!link.href)); assert.equal(h.window.__graphError, undefined);
});

test('a stationary held book is idle, and its release spring follows elapsed time at 30/60/120 Hz', () => {
  const snapshots = [30, 60, 120].map(hz => {
    const h = harness(); h.drain();
    h.pointer(h.cards[2], 'pointerdown'); h.pointer(h.window, 'pointermove', {clientX: 440, clientY: 380}); h.drain();
    assert.equal(h.debug().captured, true); assert.equal(h.debug().grabbing, 'post:2');
    const draws = h.contexts[0].clears; h.tick(1000);
    assert.equal(h.contexts[0].clears, draws, 'holding without moving does not redraw');
    const initial = h.debug().cards[2].pull;
    h.pointer(h.window, 'pointerup');
    for (let n = 0; n < hz / 5; n++) h.tick(1000 / hz);
    const pull = h.debug().cards[2].pull;
    assert.ok(pull && Math.hypot(pull.x, pull.y, pull.z) < Math.hypot(initial.x, initial.y, initial.z));
    const snapshot = ['x', 'y', 'z'].map(axis => pull[axis]);
    h.drain(); assert.equal(h.debug().pulling, 0); assertFinite(h); return snapshot;
  });
  for (const snapshot of snapshots.slice(1)) snapshot.forEach((value, i) => close(value, snapshots[0][i], 1e-7));
});

test('resizing an idle graph updates canvas and geometry without resetting camera or active filters', () => {
  const h = harness(); h.drain(); h.search('Control'); h.kinds.project.emit('click'); h.drain();
  h.key(h.stage, 'ArrowLeft'); h.drain(); const before = h.debug();
  h.resize(720, 520); h.drain();
  assert.equal(h.canvas.width, 720); assert.equal(h.canvas.height, 520);
  close(h.debug().yaw, before.yaw); assert.deepEqual(shown(h), [1, 3]);
  assertFinite(h); assert.equal(h.frames.size, 0);
  h.window.devicePixelRatio = 2; h.resize(720, 520); h.drain();
  assert.equal(h.canvas.width, 1080, 'DPR changes update backing pixels even when CSS size is unchanged');
  h.root.setAttribute('data-performance', 'compact'); h.drain();
  assert.equal(h.canvas.width, 720, 'compact mode caps backing pixels at one device pixel');
  assertFinite(h);
});

test('switching layouts clears shelf-only camera translation and restores individual book heights', () => {
  const h = harness(); h.drain();
  const shelfScale = h.cards[4].style.transform.match(/scale\(([^)]+)\)/)?.[1];
  assert.ok(shelfScale, 'fixture includes a book with a different height');
  assert.ok(Object.values(h.debug().ext).every(Number.isFinite), 'reported projected shelf bounds are finite');
  h.layouts.nebula.emit('click'); h.drain();
  assert.equal(h.debug().dy, 0, 'nebula has no shelf centering offset');
  assert.match(h.world.style.transform, /^translateY\(0(?:\.0+)?px\)/, 'CSS world uses the same zero vertical origin as the nebula canvas');
  assertFinite(h);
  h.layouts.shelf.emit('click'); h.drain();
  assert.equal(h.cards[4].style.transform.match(/scale\(([^)]+)\)/)?.[1], shelfScale);
  assert.ok(Object.values(h.debug().ext).every(Number.isFinite));
});

test('confirming a Chinese IME candidate does not activate the search Enter shortcut', () => {
  const h = harness(); h.drain(); h.q.focus(); h.search('ROS'); h.drain();
  for (const state of [{isComposing: true}, {keyCode: 229}]) {
    const event = h.key(h.q, 'Enter', state);
    assert.equal(!!event.defaultPrevented, false, 'candidate confirmation stays with the input method');
    assert.equal(h.document.activeElement, h.q, 'IME composition cannot move focus out of the search field');
  }
  h.key(h.q, 'Enter'); assert.equal(h.document.activeElement, h.resultLinks[0]);
});

test('nebula at normal zoom fits complete billboard books plus hover space on desktop and phone stages', () => {
  // Use the public scene pose to project each camera-facing book rectangle;
  // this checks the visible result without reading the camera-fit algorithm.
  const checkBounds = h => {
    const view = h.debug(), cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    close(view.zoom, 1); assert.equal(view.dy, 0);
    for (const card of view.cards) {
      assert.equal(card.billboard, true);
      const x = card.x * cy + card.z * sy, z = -card.x * sy + card.z * cy;
      const y = card.y * cp - z * sp, depth = card.y * sp + z * cp + view.dist;
      const scale = view.f / (view.f - depth);
      assert.ok(Number.isFinite(scale) && scale > 0);
      const centerX = view.cx + x * scale, centerY = view.cyy + y * scale;
      const halfWidth = view.cardW * 1.07 * scale / 2, halfHeight = view.cardH * 1.07 * scale / 2;
      assert.ok(centerX - halfWidth >= -.1 && centerX + halfWidth <= view.w + .1,
        `${view.w}×${view.h}: ${card.id} horizontal corners fit, including hover`);
      assert.ok(centerY - halfHeight >= -.1 && centerY + halfHeight <= view.h + .1,
        `${view.w}×${view.h}: ${card.id} vertical corners fit, including hover`);
    }
  };
  for (const [width, height, cardW, cardH] of [[1269, 468, 250, 330], [390, 473, 196, 258], [320, 340, 196, 258]]) {
    const h = harness(); h.cards.forEach(card => { card.rect.width = cardW; card.rect.height = cardH; });
    h.resize(width, height); h.drain(); h.layouts.nebula.emit('click'); h.drain(); checkBounds(h);
    h.key(h.stage, 'ArrowLeft'); h.key(h.stage, 'ArrowUp'); h.drain(); checkBounds(h);
    h.zoomIn.emit('click'); h.drain(); assert.ok(h.debug().zoom > 1); assertFinite(h);
    // Intentional magnification may crop; resetting restores the complete scene.
    h.reset.emit('click'); h.drain(); checkBounds(h);
  }
});

test('sixteen books form a complete four-row shelf on phone stages without clipping any transformed corner', () => {
  const items = Array.from({length: 16}, (_, i) => ({...DATA[i % DATA.length], title: 'Book ' + i}));
  for (const width of [379, 390]) {
    const h = harness({items}); h.cards.forEach(card => { card.rect.width = 196; card.rect.height = 258; });
    h.resize(width, 472); h.drain(); const view = h.debug();
    assert.equal(view.rows, 4); assert.equal(view.cardW, 196); assert.equal(view.cardH, 258);
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    view.cards.forEach((card, i) => {
      // Read the actual CSS local scale/translation, including different cloth
      // heights. Then apply the shared world camera to all four book corners.
      const transform = h.cards[i].style.transform;
      const center = transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px,([-\d.]+)px\)/).slice(1).map(Number);
      const scale = transform.match(/scale\(([^,]+),([^)]+)\)/)?.slice(1).map(Number) || [1, 1];
      const rot = card.rotY, cr = Math.cos(rot), sr = Math.sin(rot);
      for (const sideX of [-1, 1]) for (const sideY of [-1, 1]) {
        const localX = sideX * view.cardW * scale[0] / 2, localY = sideY * view.cardH * scale[1] / 2;
        const wx = center[0] + localX * cr, wy = center[1] + localY, wz = center[2] - localX * sr;
        const x = wx * cy + wz * sy, z = -wx * sy + wz * cy;
        const y = wy * cp - z * sp + view.dy, depth = wy * sp + z * cp + view.dist;
        const k = view.f / (view.f - depth), px = view.cx + x * k, py = view.cyy + y * k;
        assert.ok(px >= -.1 && px <= view.w + .1 && py >= -.1 && py <= view.h + .1,
          `${width}×472 ${card.id}: visible book corner (${px.toFixed(2)}, ${py.toFixed(2)})`);
      }
    });
    assertFinite(h); assert.equal(h.frames.size, 0);
  }
});

test('first-load zero or phone stage dimensions recover to the normal desktop shelf regardless of compact/resize order', () => {
  const items = Array.from({length: 16}, (_, i) => ({...DATA[i % DATA.length], title: 'Book ' + i}));
  const reference = harness({items, compact: true, width: 1269, height: 468}); reference.drain();
  const expected = reference.debug(); assert.equal(expected.rows, 2);
  for (const initial of [{width: 0, height: 0}, {width: 379, height: 472, cardWidth: 196, cardHeight: 258}]) {
    for (const order of ['compact-first', 'resize-first']) {
      const h = harness({items, ...initial}); h.drain();
      if (initial.width > 0) assert.equal(h.debug().rows, 4);
      h.cards.forEach(card => { card.rect.width = 250; card.rect.height = 330; });
      // The visible element already has its final rect when the preference
      // observer runs. ResizeObserver may deliver the same rect only later.
      h.canvas.rect.width = 1269; h.canvas.rect.height = 468;
      if (order === 'compact-first') {
        h.root.setAttribute('data-performance', 'compact'); h.tick();
        h.resize(1269, 468);
      } else {
        h.resize(1269, 468); h.root.setAttribute('data-performance', 'compact');
      }
      h.drain(); const actual = h.debug();
      assert.equal(actual.rows, expected.rows, `${order}: final canvas size cannot retain the provisional phone row count`);
      assert.equal(actual.cardW, expected.cardW); assert.equal(actual.cardH, expected.cardH);
      close(actual.dist, expected.dist); close(actual.dy, expected.dy);
      assertFinite(h); assert.equal(h.frames.size, 0);
    }
  }
});

test('a resize notification remeasures changed book dimensions even when the stage rectangle is unchanged', () => {
  const items = Array.from({length: 16}, (_, i) => ({...DATA[i % DATA.length], title: 'Book ' + i}));
  const reference = harness({items, width: 1269, height: 468}); reference.drain();
  const h = harness({items, width: 1269, height: 468, cardWidth: 196, cardHeight: 258}); h.drain();
  assert.equal(h.debug().cardW, 196);
  h.cards.forEach(card => { card.rect.width = 250; card.rect.height = 330; });
  h.resize(1269, 468); h.drain();
  assert.equal(h.debug().cardW, 250); assert.equal(h.debug().cardH, 330);
  close(h.debug().dist, reference.debug().dist); close(h.debug().dy, reference.debug().dy);
  assertFinite(h); assert.equal(h.frames.size, 0);
});
