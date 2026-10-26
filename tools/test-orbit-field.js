/* Run the actual orbit controller against a deterministic DOM and recording 2D
   canvas. Pixel quality and browser-native button behaviour still need visual QA. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../theme/static/js/orbit-field.js'), 'utf8');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== fn)); }
  emit(type, event = {}) {
    event.type = type; event.target ??= this; event.currentTarget = this;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    event.stopPropagation ??= () => { event.propagationStopped = true; };
    for (const fn of this.listeners.get(type) || []) fn(event);
    return event;
  }
  dispatchEvent(event) { return this.emit(event.type, event); }
}

class Style {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
  getPropertyValue(name) { return this.values.get(name) || ''; }
  removeProperty(name) { const previous = this.getPropertyValue(name); this.values.delete(name); return previous; }
}

class Element extends Events {
  constructor(tag, attrs = {}) {
    super(); this.tag = tag; this.tagName = tag.toUpperCase(); this.attrs = {...attrs}; this.children = [];
    this.hidden = false; this.disabled = false; this.textContent = ''; this.capture = null; this.style = new Style();
    this.rect = {left: 80, top: 100, width: 960, height: 560}; this.offsetTop = 100;
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle(name, force) { const enabled = force ?? !classes.has(name); enabled ? classes.add(name) : classes.delete(name); return enabled; },
    };
    this.dataset = new Proxy({}, {get: (target, key) => this.getAttribute('data-' + String(key).replace(/[A-Z]/g, value => '-' + value.toLowerCase()))});
  }
  append(node) { node.parentNode = this; node.parentElement = this; this.children.push(node); return node; }
  appendChild(node) { return this.append(node); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = String(value); this.changed?.(name); }
  removeAttribute(name) { delete this.attrs[name]; this.changed?.(name); }
  matches(selector) {
    return selector.split(',').some(value => {
      const s = value.trim();
      if (s.startsWith('.')) return this.classList.contains(s.slice(1));
      if (s.startsWith('#')) return this.getAttribute('id') === s.slice(1);
      if (s.startsWith('[')) {
        const match = s.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
        return match && (match[2] === undefined ? this.getAttribute(match[1]) !== null : this.getAttribute(match[1]) === match[2]);
      }
      return this.tag === s;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return {...this.rect, x: this.rect.left, y: this.rect.top, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height}; }
  get clientWidth() { return this.rect.width; }
  get clientHeight() { return this.rect.height; }
  get offsetWidth() { return this.rect.width; }
  get offsetHeight() { return this.rect.height; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture(id) {
    if (this.capture === id) { this.capture = null; this.emit('lostpointercapture', {pointerId: id}); }
  }
}

function harness({motion = 'on', reduced = false, compact = false, context = true, observers = true, dpr = 1} = {}) {
  let now = 0, nextFrame = 0, seed = 17, randomCalls = 0, intersection;
  const frames = new Map(), contexts = [], resizeCallbacks = new Map();
  const root = new Element('html', {'data-motion': motion, 'data-performance': compact ? 'compact' : 'full'});
  const body = root.append(new Element('body'));
  const hero = body.append(new Element('section', {class: 'hero'}));
  const visual = hero.append(new Element('div', {class: 'orbit-visual'}));
  const stage = visual.append(new Element('div', {class: 'orbit-stage'}));
  const makeCanvas = (primary = false) => {
    const canvas = new Element('canvas'); canvas.width = canvas.height = 300;
    const stateStack = [];
    const ctx = {
      canvas, operations: 0, gradients: 0, images: [], points: [], clears: 0, invalid: [],
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      record(kind, args) {
        this.operations++;
        if (args.some(value => typeof value === 'number' && !Number.isFinite(value))) this.invalid.push([kind, ...args]);
      },
      clearRect(...args) { this.clears++; this.points = []; this.images = []; this.record('clear', args); },
      setTransform(...args) { this.record('transform', args); },
      resetTransform() {},
      createRadialGradient(...args) { this.record('radial', args); this.gradients++; return {addColorStop() {}}; },
      createLinearGradient(...args) { this.record('linear', args); this.gradients++; return {addColorStop() {}}; },
      drawImage(image, ...args) { this.record('image', args); this.images.push({image, args, alpha: this.globalAlpha}); },
      fillText(text, ...args) { this.record('text', args); },
      strokeText(text, ...args) { this.record('text', args); },
      measureText(text) { return {width: String(text).length * 8}; },
      save() { stateStack.push({globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation}); },
      restore() { Object.assign(this, stateStack.pop() || {}); },
    };
    for (const name of ['beginPath', 'closePath', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'rect', 'roundRect', 'arc', 'ellipse', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'translate', 'scale', 'rotate', 'transform', 'setLineDash']) {
      ctx[name] = function (...args) {
        this.record(name, args);
        if (['arc', 'ellipse', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo'].includes(name)) this.points.push([name, ...args]);
      };
    }
    canvas.getContext = () => primary && !context ? null : ctx;
    contexts.push(ctx); return canvas;
  };
  const canvas = stage.append(makeCanvas(true)); canvas.setAttribute('id', 'hero-orbit');
  const controls = visual.append(new Element('div', {'data-orbit-controls': ''}));
  const buttons = Object.fromEntries(['signal', 'motion', 'policy'].map(mode => [mode, controls.append(new Element('button', {'data-orbit-mode': mode}))]));
  const pause = controls.append(new Element('button', {'data-orbit-pause': ''}));
  const status = visual.append(new Element('span', {'data-orbit-status': ''}));
  const document = Object.assign(new Events(), {
    documentElement: root, body, hidden: false,
    getElementById: id => id === 'hero-orbit' ? canvas : null,
    querySelector: selector => root.querySelector(selector),
    querySelectorAll: selector => root.querySelectorAll(selector),
    createElement: tag => tag === 'canvas' ? makeCanvas() : new Element(tag),
  });
  const reduce = Object.assign(new Events(), {matches: reduced});
  class MutationObserver {
    constructor(fn) { this.fn = fn; }
    observe(target, {attributeFilter = []} = {}) {
      const previous = target.changed;
      target.changed = name => { previous?.(name); if (!attributeFilter.length || attributeFilter.includes(name)) this.fn([{attributeName: name}]); };
    }
  }
  class IntersectionObserver {
    constructor(fn) { intersection = fn; }
    observe() {}
  }
  class ResizeObserver {
    constructor(fn) { this.fn = fn; }
    observe(target) { resizeCallbacks.set(target, this.fn); }
  }
  const requestAnimationFrame = fn => { const id = ++nextFrame; frames.set(id, fn); return id; };
  const cancelAnimationFrame = id => { frames.delete(id); };
  const window = Object.assign(new Events(), {
    innerWidth: 1200, innerHeight: 800, pageYOffset: 0, scrollY: 0, devicePixelRatio: dpr,
    location: {search: ''},
    matchMedia: query => query.includes('prefers-reduced-motion') ? reduce : {matches: query.includes('pointer: fine')},
    MutationObserver, IntersectionObserver: observers ? IntersectionObserver : undefined, ResizeObserver: observers ? ResizeObserver : undefined,
    requestAnimationFrame, cancelAnimationFrame, performance: {now: () => now},
  });
  const math = Object.create(Math);
  math.random = () => { randomCalls++; return ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; };
  vm.runInNewContext(source, {
    window, document, MutationObserver, IntersectionObserver: window.IntersectionObserver, ResizeObserver: window.ResizeObserver,
    requestAnimationFrame, cancelAnimationFrame, performance: window.performance, Math: math,
    Event: class Event {constructor(type) {this.type = type;}},
    CustomEvent: class CustomEvent {constructor(type, options = {}) {this.type = type; Object.assign(this, options);}},
    getComputedStyle: element => ({getPropertyValue: name => element.style.getPropertyValue(name) || ({'--accent': '#82a9ca', '--accent-2': '#b6aa8f', '--text': '#e7edf4', '--muted': '#93a2b8'})[name] || ''}),
  }, {filename: 'orbit-field.js'});
  const h = {
    window, document, root, hero, visual, stage, canvas, controls, buttons, pause, status, reduce, contexts, frames,
    get info() { return window.__orbitField?.info(); },
    get randomCalls() { return randomCalls; },
    get gradients() { return contexts.reduce((sum, ctx) => sum + ctx.gradients, 0); },
    get operations() { return contexts.reduce((sum, ctx) => sum + ctx.operations, 0); },
    get now() { return now; },
    tick(count = 1, dt = 1000 / 60) {
      for (let i = 0; i < count; i++) {
        now += dt; const pending = [...frames.values()]; frames.clear();
        for (const fn of pending) fn(now);
        assert.ok(frames.size <= 1, 'at most one orbit RAF loop');
      }
    },
    event(type, options = {}, target = stage) {
      const event = {target, pointerType: 'mouse', pointerId: 1, clientX: 750, clientY: 350, button: 0, buttons: 1, ...options};
      for (let node = target; node; node = node.parentElement) { node.emit(type, event); if (event.propagationStopped) break; }
      return event;
    },
    click(mode) { return this.event('click', {}, buttons[mode]); },
    pauseToggle() { return this.event('click', {}, pause); },
    inView(value) { assert.ok(intersection, 'IntersectionObserver registered'); intersection([{isIntersecting: value}]); },
    hidden(value) { document.hidden = value; document.emit('visibilitychange'); },
    reduced(value) { reduce.matches = value; reduce.emit('change'); },
    resize(width, height) {
      stage.rect.width = width; stage.rect.height = height; visual.rect.width = width; visual.rect.height = height + 70;
      window.innerWidth = width + 120;
      for (const [target, callback] of resizeCallbacks) callback([{target, contentRect: target.getBoundingClientRect()}]);
      if (!resizeCallbacks.size) window.emit('resize');
    },
  };
  return h;
}

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const interaction = h => h.info.interaction;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('OK ' + name); }

test('boots one motion-mode canvas loop with finite recorded geometry', () => {
  const h = harness(); assert.equal(h.info.mode, 'motion'); h.tick(5);
  assert.ok(h.info.running); assert.ok(h.info.draws >= 5);
  assert.equal(h.info.width, 960); assert.equal(h.info.height, 560);
  assert.ok(h.contexts.some(ctx => ctx.points.length > 20));
  assert.ok(h.contexts.every(ctx => ctx.invalid.length === 0));
});

test('60 Hz and 120 Hz advance the same simulation time without a 30 fps gate', () => {
  const values = [60, 120].map(hz => {
    const h = harness(); h.tick(1, 1000 / hz); const initial = h.info.time, draws = h.info.draws;
    h.tick(hz, 1000 / hz); close(h.info.time - initial, 1, 1e-10);
    assert.equal(h.info.draws - draws, hz);
    return h.info.time - initial;
  });
  close(values[0], values[1]);
});

test('mode changes preserve phase, actually change geometry and never accumulate loops', () => {
  const h = harness(); h.tick(20);
  const signatures = [];
  for (const mode of ['signal', 'motion', 'policy']) {
    const time = h.info.time;
    h.click(mode); assert.equal(h.info.mode, mode); close(h.info.time, time);
    for (let i = 0; i < 5; i++) h.click(mode);
    assert.ok(h.frames.size <= 1);
    h.tick();
    const comparison = harness(); comparison.click(mode); comparison.tick(20);
    signatures.push(JSON.stringify(comparison.contexts.flatMap(ctx => ctx.points)));
  }
  assert.equal(new Set(signatures).size, 3, 'the three modes must not only rename a label');
});

test('left attraction, right spreading and middle pulse have finite release tails', () => {
  for (const [button, kind] of [[0, 'attract'], [2, 'spread'], [1, 'pulse']]) {
    const h = harness(); h.tick();
    assert.equal(h.event('pointerdown', {button}).defaultPrevented, true);
    assert.equal(interaction(h).kind, kind); h.tick(12);
    assert.ok(interaction(h).strength > 0 && interaction(h).strength <= 1);
    if (button !== 1) {
      assert.equal(interaction(h).held, true);
      h.event('pointerup', {button, buttons: 0}, h.window);
      assert.equal(interaction(h).held, false);
    }
    h.tick(360); assert.equal(interaction(h).kind, 'idle');
    close(interaction(h).strength, 0);
  }
});

test('a quick click between animation frames still produces a visible finite response', () => {
  for (const [button, kind] of [[0, 'attract'], [2, 'spread']]) {
    const h = harness(); h.tick();
    h.event('pointerdown', {button}); h.event('pointerup', {button, buttons: 0}, h.window);
    h.tick(8);
    assert.equal(interaction(h).kind, kind); assert.equal(interaction(h).held, false);
    assert.ok(interaction(h).strength > .01, 'a click must not be lost between display frames');
    h.tick(360); assert.equal(interaction(h).kind, 'idle'); close(interaction(h).strength, 0);
  }
});

test('reversing attraction into spreading preserves geometry until time advances', () => {
  const h = harness(); h.tick(); h.event('pointerdown', {button: 0}); h.tick(40);
  assert.ok(interaction(h).strength > .9);
  const before = JSON.stringify(h.contexts.flatMap(ctx => ctx.points));
  h.event('pointerdown', {button: 2}); h.tick(1, 0);
  assert.equal(JSON.stringify(h.contexts.flatMap(ctx => ctx.points)), before,
    'changing field direction must not instantly replace a fully active scale coefficient');
  h.tick(12); assert.notEqual(JSON.stringify(h.contexts.flatMap(ctx => ctx.points)), before);
});

test('mouse controls preserve Shift-right click, touch, pen and native interactive elements', () => {
  const h = harness(); h.tick();
  for (const type of ['pointerdown', 'contextmenu']) assert.equal(h.event(type, {button: 2, shiftKey: true}).defaultPrevented, undefined);
  for (const pointerType of ['touch', 'pen']) {
    assert.equal(h.event('pointerdown', {pointerType}).defaultPrevented, undefined);
    assert.equal(interaction(h).kind, 'idle');
  }
  for (const tag of ['a', 'button', 'input', 'textarea', 'select']) {
    const child = h.stage.append(new Element(tag));
    assert.equal(h.event('pointerdown', {target: child}).defaultPrevented, undefined);
  }
  assert.equal(interaction(h).kind, 'idle');
  assert.equal(h.event('contextmenu', {button: 2}).defaultPrevented, true);
  assert.equal(h.event('auxclick', {button: 1}).defaultPrevented, true);
});

test('pause preserves phase and resume never integrates the paused wall-clock interval', () => {
  const h = harness(); h.tick(15); h.pauseToggle();
  const time = h.info.time, draws = h.info.draws;
  assert.equal(h.info.paused, true); assert.equal(h.frames.size, 0);
  h.tick(1, 120000); close(h.info.time, time); assert.equal(h.info.draws, draws);
  h.pauseToggle(); h.tick(); close(h.info.time, time);
  h.tick(); assert.ok(h.info.time > time && h.info.time - time <= .05);
});

test('reduced-motion, explicit motion-off, offscreen and hidden states stop and restore safely', () => {
  for (const type of ['reduced', 'motion', 'offscreen', 'hidden']) {
    const h = harness(); h.tick(8);
    const set = value => type === 'reduced' ? h.reduced(value) : type === 'motion' ? h.root.setAttribute('data-motion', value ? 'off' : 'on') : type === 'offscreen' ? h.inView(!value) : h.hidden(value);
    set(true); const time = h.info.time; assert.equal(h.frames.size, 0, type);
    h.tick(1, 45000); close(h.info.time, time);
    set(false); h.tick(); close(h.info.time, time); h.tick(); assert.ok(h.info.time > time);
    assert.ok(h.frames.size <= 1);
  }
});

test('a single long frame contributes no more than 50 ms of simulated motion', () => {
  const h = harness(); h.tick(4); const time = h.info.time;
  h.tick(1, 10000); close(h.info.time - time, .05, 1e-10);
});

test('resize and compact/DPR sizing retain time without increasing the frame budget', () => {
  const full = harness({dpr: 3}); full.tick(12); const before = full.info.time;
  full.resize(380, 420); close(full.info.time, before); full.tick();
  assert.equal(full.info.width, 380); assert.equal(full.info.height, 420);
  assert.ok(full.canvas.width <= 380 * 2 && full.canvas.height <= 420 * 2, 'retina canvas has a bounded backing-store scale');
  assert.ok(full.contexts.every(ctx => ctx.invalid.length === 0));
  const desktop = harness(), compact = harness({compact: true}); desktop.tick(); compact.tick();
  const a = desktop.operations, b = compact.operations;
  desktop.tick(); compact.tick();
  assert.ok(compact.operations - b <= desktop.operations - a, 'compact mode must not add work');
});

test('changing performance preference at DPR 1 rebuilds the advertised curve resolution', () => {
  const h = harness({dpr: 1}); h.tick(5); const time = h.info.time;
  assert.equal(h.info.quality, 'full'); assert.equal(h.info.segments, 144);
  h.root.setAttribute('data-performance', 'compact');
  close(h.info.time, time); assert.equal(h.info.quality, 'compact'); assert.equal(h.info.segments, 96);
  h.tick(); const compactTime = h.info.time;
  h.root.setAttribute('data-performance', 'full');
  close(h.info.time, compactTime); assert.equal(h.info.quality, 'full'); assert.equal(h.info.segments, 144);
  assert.ok(h.contexts.every(ctx => ctx.invalid.length === 0));
});

test('steady animation avoids random regeneration, gradient churn and unbounded drawing work', () => {
  const h = harness(); h.tick(2); const initialRandom = h.randomCalls, gradients = h.gradients;
  for (let i = 0; i < 180; i++) {
    const before = h.operations; h.tick();
    assert.ok(h.operations - before < 4000, `frame ${i}: ${h.operations - before} canvas calls`);
  }
  assert.equal(h.randomCalls, initialRandom, 'no per-frame random particle rebuilds');
  assert.ok(h.gradients - gradients <= 2, 'gradient assets must be cached outside the animation loop');
  assert.ok(h.contexts.every(ctx => ctx.invalid.length === 0));
});

test('initial disabled preferences and unavailable 2D context keep the static page usable', () => {
  for (const options of [{motion: 'off'}, {reduced: true}]) {
    const h = harness(options); assert.equal(h.frames.size, 0); h.tick(10);
    assert.equal(h.visual.hidden, false); assert.equal(h.stage.hidden, false);
  }
  const h = harness({context: false});
  assert.equal(h.frames.size, 0); assert.equal(h.visual.hidden, false);
  assert.equal(h.event('pointerdown').defaultPrevented, undefined, 'missing canvas must not capture native page input');
});

console.log(`PASS ${passed} orbit field tests`);
