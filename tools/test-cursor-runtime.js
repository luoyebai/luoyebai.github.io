/* Exercise the real cursor controller with a deterministic DOM/event/RAF stub.
   CSS appearance and actual fullscreen rendering still need browser QA. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../theme/static/js/cursor.js'), 'utf8');

class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback, options) {
    const list = this.listeners.get(name) || [];
    list.push({ callback, options }); this.listeners.set(name, list);
  }
  emit(name, event = {}) {
    for (const item of this.listeners.get(name) || []) item.callback(event);
  }
}

class Element extends EventTarget {
  constructor(tagName, attrs = {}) {
    super(); this.tagName = tagName.toUpperCase(); this.nodeType = 1;
    this.attributes = new Map(Object.entries(attrs)); this.classes = new Set();
    this.children = []; this.style = {}; this.textContent = '';
    this.parentNode = this.parentElement = null;
    this.clientWidth = this.offsetWidth = this.scrollWidth = 200;
    this.clientHeight = this.offsetHeight = this.scrollHeight = 100;
    this.classList = {
      add: (...items) => items.forEach(item => this.classes.add(item)),
      remove: (...items) => items.forEach(item => this.classes.delete(item)),
      contains: item => this.classes.has(item),
      toggle: (item, force) => {
        const want = force === undefined ? !this.classes.has(item) : !!force;
        if (want) this.classes.add(item); else this.classes.delete(item);
        return want;
      },
    };
    if (attrs.class) this.className = attrs.class;
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  getAttribute(name) { return name === 'class' ? this.className : this.attributes.get(name) ?? null; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (this.onAttribute) this.onAttribute(name);
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
    this.children.push(child); child.parentNode = child.parentElement = this; return child;
  }
  set innerHTML(value) {
    this.children = [];
    for (const match of value.matchAll(/<span class="([^"]+)"/g)) {
      this.appendChild(new Element('span', { class: match[1] }));
    }
  }
  matches(selector) {
    return selector.split(',').some(part => {
      let s = part.trim();
      const excludes = [...s.matchAll(/:not\(([^)]+)\)/g)];
      if (excludes.some(match => this.matches(match[1]))) return false;
      s = s.replace(/:not\([^)]+\)/g, '');
      const tag = s.match(/^[a-z][\w-]*/i);
      if (tag && this.tagName !== tag[0].toUpperCase()) return false;
      for (const match of s.matchAll(/\.([\w-]+)/g)) if (!this.classes.has(match[1])) return false;
      for (const match of s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        const value = this.getAttribute(match[1]);
        if (value === null || (match[2] !== undefined && value !== match[2])) return false;
      }
      return true;
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.offsetWidth, height: this.offsetHeight }; }
}

function harness(mode = 'on') {
  const frames = new Map(), timers = new Map(), observers = [];
  let nextId = 0, elapsed = 0;
  const epoch = 1700000000000;
  const root = new Element('html', { 'data-cursor': mode, 'data-motion': 'on' });
  const body = root.appendChild(new Element('body'));
  const document = Object.assign(new EventTarget(), {
    documentElement: root, body, hidden: false, fullscreenElement: null,
    createElement: tag => new Element(tag),
    elementFromPoint: () => hit,
  });
  let hit = body;
  const fine = Object.assign(new EventTarget(), { matches: true });
  const reduce = Object.assign(new EventTarget(), { matches: false });
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { observers.push({ target, options, callback: this.callback }); }
  }
  root.onAttribute = name => {
    for (const item of observers) {
      if (item.target === root && item.options.attributeFilter.includes(name)) item.callback();
    }
  };
  const window = Object.assign(new EventTarget(), {
    performance: { now: () => elapsed },
    matchMedia: query => query.includes('reduced-motion') ? reduce : fine,
    getComputedStyle: element => ({ overflowX: element.style.overflowX || 'visible', overflowY: element.style.overflowY || 'visible' }),
    MutationObserver,
  });
  const context = vm.createContext({
    window, document, MutationObserver, console,
    Date: class extends Date { static now() { return epoch + elapsed; } },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: elapsed + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: 'cursor.js' });
  const h = {
    root, body, document, window, fine, reduce, frames, timers,
    element(tag, attrs = {}, parent = body) { return parent.appendChild(new Element(tag, attrs)); },
    get cursor() { return root.querySelector('.cursor'); },
    get state() { return this.cursor?.getAttribute('data-state') || ''; },
    move(target = body, x = 100, y = 80, pointerType = 'mouse') {
      hit = target; document.emit('pointermove', { target, clientX: x, clientY: y, pointerType, timeStamp: elapsed });
    },
    down(target, x = 10, y = 10) {
      document.emit('pointerdown', { target, clientX: x, clientY: y, pointerType: 'mouse', timeStamp: elapsed });
    },
    tick(ms = 1000 / 60) {
      elapsed += ms; const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(elapsed);
    },
    settle() {
      let count = 0;
      while (frames.size && count++ < 120) this.tick();
      assert.equal(frames.size, 0, 'cursor RAF must become idle'); return count;
    },
    advance(ms) {
      elapsed += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= elapsed) { timers.delete(id); timer.callback(); }
    },
    scroll(target) { hit = target; window.emit('scroll', { target }); },
    mode(value) { root.setAttribute('data-cursor', value); },
  };
  return h;
}

let tests = 0;
function test(name, body) { body(); tests++; console.log('OK ' + name); }

test('page cursor preference does not turn ordinary body content into a link', () => {
  const h = harness(); h.move();
  assert.equal(h.state, ''); assert.equal(h.root.classList.contains('has-custom-cursor'), true);
  const button = h.element('button', { 'data-cursor-hint': '打开' }); h.move(button);
  assert.equal(h.state, 'link'); assert.equal(h.cursor.querySelector('.cursor-label').textContent, '打开');
  h.move(h.body); assert.equal(h.state, ''); assert.equal(h.cursor.classList.contains('has-label'), false);
});

test('reading text yields immediately while links and zoomable images keep their affordance', () => {
  const h = harness(); h.move(); h.move(h.body, 800, 600);
  const prose = h.element('div', { class: 'prose' }); const paragraph = h.element('p', {}, prose);
  h.move(paragraph);
  assert.equal(h.state, 'text'); assert.equal(h.root.classList.contains('is-cursor-text'), true);
  assert.equal(h.frames.size, 0); assert.equal(h.cursor.classList.contains('is-moving'), false);
  const link = h.element('a', {}, paragraph); h.move(link);
  assert.equal(h.state, 'link'); assert.equal(h.root.classList.contains('is-cursor-text'), false);
  const image = h.element('img', { class: 'is-zoomable' }, prose); h.move(image, 321, 234); h.tick();
  assert.equal(h.state, 'zoom'); assert.equal(h.cursor.querySelector('.cursor-label').textContent, '看原图');
  assert.match(h.cursor.querySelector('.cursor-icon').style.transform, /321\.00px,234\.00px/);
  const linkedImage = h.element('img', { class: 'is-zoomable' }, link); h.move(linkedImage);
  assert.equal(h.state, 'link');
  const slide = h.element('div', { class: 'slide-inner' }); h.move(h.element('code', {}, slide));
  assert.equal(h.state, 'text'); assert.equal(h.frames.size, 0);
});

test('inputs and disabled descendants take priority over ancestor drag labels', () => {
  const h = harness(); h.move();
  const drag = h.element('div', { 'data-cursor': 'drag', 'data-cursor-label': '拖动' });
  h.move(drag); assert.equal(h.state, 'drag');
  for (const tag of ['input', 'textarea', 'select', 'iframe', 'video', 'audio']) {
    h.move(h.element(tag, {}, drag));
    assert.equal(h.state, 'native', tag); assert.equal(h.root.classList.contains('is-cursor-native'), true, tag);
    assert.equal(h.frames.size, 0, tag); assert.equal(h.cursor.classList.contains('has-label'), false, tag);
  }
  const editor = h.element('div', { contenteditable: 'true' }, drag);
  h.move(h.element('span', {}, editor)); assert.equal(h.state, 'native');
  const disabled = h.element('button', { 'aria-disabled': 'true' }, drag);
  h.move(h.element('svg', {}, disabled)); assert.equal(h.state, 'native');
  h.move(h.body); assert.equal(h.root.classList.contains('is-cursor-native'), false);
});

test('glow trail is bounded and both styles stop requesting frames after settling', () => {
  for (const mode of ['on', 'glow']) {
    const h = harness(mode); h.move(); h.settle(); h.move(h.body, 1000, 700); h.tick();
    if (mode === 'glow') {
      const width = parseFloat(h.cursor.querySelector('.cursor-trail').style.width);
      assert.ok(width > 0 && width <= 22);
    }
    assert.ok(h.settle() < 120); assert.equal(h.cursor.classList.contains('is-moving'), false);
  }
});

test('changing styles repaints without pointer movement and system mode removes decoration', () => {
  const h = harness('glow'); h.move(h.body, 100, 80); h.settle();
  assert.match(h.cursor.querySelector('.cursor-ring').style.transform, /114\.00px,98\.00px/);
  h.mode('on'); h.settle();
  assert.match(h.cursor.querySelector('.cursor-ring').style.transform, /100\.00px,80\.00px/);
  h.mode('glow'); h.settle();
  assert.match(h.cursor.querySelector('.cursor-ring').style.transform, /114\.00px,98\.00px/);
  h.mode('off'); assert.equal(h.frames.size, 0);
  assert.equal(h.root.classList.contains('has-custom-cursor'), false); assert.equal(h.cursor.classList.contains('is-on'), false);
  h.move(); assert.equal(h.frames.size, 0); assert.equal(h.cursor.classList.contains('is-on'), false);
  h.mode('glow'); h.move(); assert.equal(h.cursor.classList.contains('is-on'), true);
});

test('motion, reduced motion, hidden page, coarse pointers and touch each stop decoration', () => {
  for (const reason of ['motion', 'reduce', 'hidden', 'coarse', 'touch']) {
    const h = harness('glow'); h.move(); h.move(h.body, 500, 300);
    if (reason === 'motion') h.root.setAttribute('data-motion', 'off');
    if (reason === 'reduce') { h.reduce.matches = true; h.reduce.emit('change'); }
    if (reason === 'hidden') { h.document.hidden = true; h.document.emit('visibilitychange'); }
    if (reason === 'coarse') { h.fine.matches = false; h.fine.emit('change'); }
    if (reason === 'touch') h.move(h.body, 100, 80, 'touch');
    assert.equal(h.frames.size, 0, reason); assert.equal(h.root.classList.contains('has-custom-cursor'), false, reason);
    assert.equal(h.cursor.classList.contains('is-on'), false, reason);
  }
});

test('blur and entry into iframe remove stale overlays and ordinary movement can restart', () => {
  const h = harness(); h.move(); h.down(h.body); h.window.emit('blur');
  assert.equal(h.frames.size, 0); assert.equal(h.cursor.classList.contains('is-on'), false);
  assert.equal(h.cursor.classList.contains('is-down'), false); assert.equal(h.root.classList.contains('has-custom-cursor'), false);
  h.move(); assert.equal(h.cursor.classList.contains('is-on'), true);
  h.document.emit('pointerout', { relatedTarget: h.element('iframe') });
  assert.equal(h.frames.size, 0); assert.equal(h.cursor.classList.contains('is-on'), false);
  h.move(); h.document.emit('pointerout', { relatedTarget: h.element('button') });
  assert.equal(h.cursor.classList.contains('is-on'), true);
  h.document.emit('pointerout', { relatedTarget: null });
  assert.equal(h.root.classList.contains('has-custom-cursor'), false);
});

test('fullscreen cursor attaches under the fullscreen host and returns to body once', () => {
  const h = harness(); h.move(); const cursor = h.cursor; const deck = h.element('section');
  h.document.fullscreenElement = deck; h.document.emit('fullscreenchange');
  assert.equal(cursor.parentNode, deck); assert.equal(deck.children.filter(item => item === cursor).length, 1);
  h.document.emit('fullscreenchange'); assert.equal(deck.children.filter(item => item === cursor).length, 1);
  h.document.fullscreenElement = null; h.document.emit('fullscreenchange');
  assert.equal(cursor.parentNode, h.body); assert.equal(deck.children.includes(cursor), false);
});

test('captured inner scrolling reclassifies a stationary cursor over text and controls', () => {
  const h = harness(); h.move();
  assert.ok(h.window.listeners.get('scroll').some(item => item.options.capture));
  const prose = h.element('div', { class: 'prose' }); h.scroll(prose);
  assert.equal(h.state, 'text'); assert.equal(h.frames.size, 0);
  const button = h.element('button'); h.scroll(button);
  assert.equal(h.state, 'link'); assert.equal(h.root.classList.contains('is-cursor-text'), false);
  assert.equal(h.frames.size, 1);
});

test('scrollbar fallback uses elapsed wall time and releases its native cursor state', () => {
  const h = harness(); const scroller = h.element('div');
  scroller.style.overflowY = 'auto'; scroller.scrollHeight = 500;
  const child = h.element('div', {}, scroller); h.move(child); h.down(child);
  h.advance(80); h.move(child, 15, 15); h.advance(40);
  assert.equal(h.root.classList.contains('is-bar-drag'), false, 'recent moves must not be mistaken for a stolen pointer');
  h.document.emit('pointerup'); h.down(child); h.advance(120);
  assert.equal(h.root.classList.contains('is-bar-drag'), true);
  h.document.emit('pointerup'); assert.equal(h.root.classList.contains('is-bar-drag'), false);
});

function position(h, part) {
  return h.cursor.querySelector('.cursor-' + part).style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px/).slice(1).map(Number);
}
function approximately(actual, expected, tolerance = .011) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be close to ${expected}`);
}

test('60 Hz ring and dot preserve their established 0.22 and 0.55 first-step response', () => {
  const h = harness(); h.move(h.body, 0, 0); h.settle();
  h.move(h.body, 1000, 600); h.tick(1000 / 60);
  assert.deepEqual(position(h, 'ring'), [220, 132]);
  assert.deepEqual(position(h, 'dot'), [550, 330]);
});

test('ring and glow trajectories agree at equal elapsed time across 60/75/120/144 Hz', () => {
  for (const mode of ['on', 'glow']) {
    const states = [60, 75, 120, 144].map(hz => {
      const h = harness(mode); h.move(h.body, 100, 80); h.settle();
      h.move(h.body, 1000, 700);
      // Sample precisely at 100 ms, including a fractional last frame if needed.
      let remaining = 100;
      while (remaining > 1e-8) {
        const dt = Math.min(1000 / hz, remaining); h.tick(dt); remaining -= dt;
        assert.ok(h.frames.size <= 1, 'one cursor RAF at every refresh rate');
      }
      const state = [...position(h, 'ring'), ...position(h, 'dot')];
      h.settle(); assert.equal(h.cursor.classList.contains('is-moving'), false);
      return state;
    });
    states.slice(1).forEach(state => state.forEach((value, i) => approximately(value, states[0][i])));
    assert.ok(states[0][0] < 900 && states[0][2] > 990, 'ring and dot retain their separate follow rates');
  }
});

test('a long frame advances by at most 50 ms and subsequent frames use a fresh timestamp', () => {
  const h = harness(); h.move(h.body, 0, 0); h.settle();
  h.move(h.body, 1000, 600); h.tick();
  h.tick(5000);
  const afterStall = position(h, 'ring')[0];
  approximately(afterStall, 1000 * (1 - Math.pow(.78, 4)));
  assert.ok(afterStall < 700, 'long task cannot teleport the trailing ring to the target');
  h.tick(); approximately(position(h, 'ring')[0], 1000 * (1 - Math.pow(.78, 5)));
  h.settle(); assert.equal(h.frames.size, 0);
});

test('idle, reading and hidden pauses cannot leak elapsed time into restarted animation', () => {
  for (const pause of ['idle', 'reading', 'hidden']) {
    const h = harness(); h.move(h.body, 0, 0); h.settle();
    if (pause === 'reading') h.move(h.element('p', {class: 'prose'}), 0, 0);
    if (pause === 'hidden') { h.document.hidden = true; h.document.emit('visibilitychange'); }
    h.advance(120000); assert.equal(h.frames.size, 0);
    if (pause === 'hidden') {
      h.document.hidden = false; h.document.emit('visibilitychange');
      h.move(h.body, 0, 0); h.settle();
    }
    h.move(h.body, 1000, 600); h.tick();
    assert.deepEqual(position(h, 'ring'), [220, 132], pause);
    assert.deepEqual(position(h, 'dot'), [550, 330], pause);
  }
});

console.log(`${tests} cursor runtime tests passed.`);
