/* Run the real galaxy controller with deterministic events, refresh rates and canvas.
   Actual glow appearance and browser native mouse defaults still need browser QA. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../theme/static/js/galaxy.js'), 'utf8');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
  emit(type, event = {}) {
    event.currentTarget = this;
    event.target ??= this;
    event.preventDefault = () => { event.defaultPrevented = true; };
    for (const fn of this.listeners.get(type) || []) fn(event);
    return event;
  }
}

class Style {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
  getPropertyValue(name) { return this.values.get(name) || ''; }
  removeProperty(name) { const previous = this.getPropertyValue(name); this.values.delete(name); return previous; }
}

class Element extends Events {
  constructor(tag, attrs = {}) {
    super(); this.tag = tag; this.attrs = { ...attrs }; this.children = [];
    this.hidden = false; this.disabled = false; this.textContent = ''; this.capture = null;
    this.style = new Style(); this.offsetTop = 0; this.offsetLeft = 0;
    this.rect = { left: 20, top: 40, width: 1200, height: 620 };
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle(name, force) { const enabled = force ?? !classes.has(name); enabled ? classes.add(name) : classes.delete(name); return enabled; },
    };
  }
  append(node) { node.parentNode = this; node.parentElement = this; this.children.push(node); return node; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = String(value); this.changed?.(name); }
  removeAttribute(name) { delete this.attrs[name]; this.changed?.(name); }
  matches(selector) {
    return selector.split(',').some(s => {
      s = s.trim();
      if (s.startsWith('.')) return this.classList.contains(s.slice(1));
      if (s.startsWith('[')) return this.getAttribute(s.slice(1, -1)) !== null;
      return this.tag === s;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { ...this.rect, x: this.rect.left, y: this.rect.top, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  get offsetHeight() { return this.rect.height; }
  get offsetWidth() { return this.rect.width; }
  get clientHeight() { return this.rect.height; }
  get clientWidth() { return this.rect.width; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture(id) {
    if (this.capture === id) { this.capture = null; this.emit('lostpointercapture', { pointerId: id }); }
  }
}

function harness({ motion = 'on', reduced = false, compact = false, resizeObserver = true } = {}) {
  let now = 0, nextFrame = 0, seed = 13, intersection;
  const frames = new Map(), canvasContexts = [], resizing = new Map();
  const root = new Element('html', { 'data-motion': motion, 'data-performance': compact ? 'compact' : 'full' });
  root.scrollTop = 0;
  const hero = new Element('section', { class: 'hero' }); hero.offsetTop = 40;
  const makeCanvas = () => {
    const canvas = new Element('canvas'); canvas.width = canvas.height = 300;
    const ctx = {
      canvas, images: [], rings: [], paths: [], gradientCount: 0, clears: 0, fills: 0, strokes: 0,
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      setTransform() {},
      clearRect() { this.images = []; this.rings = []; this.paths = []; this.clears++; },
      createRadialGradient() { this.gradientCount++; return { addColorStop() {} }; },
      createLinearGradient() { this.gradientCount++; return { addColorStop() {} }; },
      fillRect() { this.fills++; }, beginPath() {}, fill() { this.fills++; }, stroke() { this.strokes++; },
      arc(...args) { this.rings.push(args); },
      moveTo(...args) { this.paths.push(['move', ...args]); },
      lineTo(...args) { this.paths.push(['line', ...args]); },
      drawImage(sprite, ...args) { this.images.push({ sprite, args, alpha: this.globalAlpha }); },
      save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    };
    canvas.getContext = () => ctx; canvasContexts.push(ctx); return canvas;
  };
  const canvas = hero.append(makeCanvas());
  const controls = hero.append(new Element('div', { 'data-galaxy-controls': '' })); controls.hidden = true;
  const buttons = {};
  for (const mode of ['attract', 'repel', 'burst']) buttons[mode] = controls.append(new Element('button', { 'data-galaxy-action': mode }));
  const status = controls.append(new Element('span', { 'data-galaxy-status': '' }));
  const pause = hero.append(new Element('button', { 'data-galaxy-pause': '' }));
  const document = Object.assign(new Events(), {
    documentElement: root, hidden: false,
    getElementById: id => id === 'hero-galaxy' ? canvas : null,
    querySelector: selector => hero.matches(selector) ? hero : hero.querySelector(selector),
    createElement: tag => tag === 'canvas' ? makeCanvas() : new Element(tag),
  });
  const reduce = Object.assign(new Events(), { matches: reduced });
  class MutationObserver {
    constructor(fn) { this.fn = fn; }
    observe(target, { attributeFilter = [] } = {}) {
      const previous = target.changed;
      target.changed = name => { previous?.(name); if (!attributeFilter.length || attributeFilter.includes(name)) this.fn([{ attributeName: name }]); };
    }
  }
  class IntersectionObserver {
    constructor(fn) { intersection = fn; }
    observe() {}
  }
  class ResizeObserver {
    constructor(fn) { this.fn = fn; }
    observe(target) { resizing.set(target, this.fn); }
  }
  const requestAnimationFrame = fn => { const id = ++nextFrame; frames.set(id, fn); return id; };
  const cancelAnimationFrame = id => { frames.delete(id); };
  const window = Object.assign(new Events(), {
    matchMedia: query => query.includes('prefers-reduced-motion') ? reduce : { matches: query.includes('pointer: fine') },
    devicePixelRatio: 1, innerWidth: 1240, innerHeight: 800, pageYOffset: 0, scrollY: 0,
    MutationObserver, IntersectionObserver, ResizeObserver: resizeObserver ? ResizeObserver : undefined,
    requestAnimationFrame, cancelAnimationFrame,
  });
  hero.getBoundingClientRect = () => {
    const { width, height, left } = hero.rect, top = hero.offsetTop - window.pageYOffset;
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height };
  };
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  vm.runInNewContext(source, {
    window, document, MutationObserver, IntersectionObserver, ResizeObserver: window.ResizeObserver, Math: deterministicMath,
    getComputedStyle: element => ({ opacity: '1', getPropertyValue: name => element?.style.getPropertyValue(name) || (name === '--accent' ? '#78a0ff' : name === '--accent-2' ? '#ffb478' : '') }),
    requestAnimationFrame, cancelAnimationFrame, performance: { now: () => now },
  }, { filename: 'galaxy.js' });
  const h = {
    root, hero, document, window, reduce, frames, canvasContexts, canvas, buttons, status, pause, controls,
    get info() { return window.__galaxy.info(); },
    get gradients() { return canvasContexts.reduce((count, ctx) => count + ctx.gradientCount, 0); },
    snapshot() { return JSON.parse(JSON.stringify(window.__galaxy.snapshot())); },
    element(tag, attrs = {}) { return hero.append(new Element(tag, attrs)); },
    event(type, opts = {}, target = hero) {
      return target.emit(type, { target: hero, pointerType: 'mouse', pointerId: 1, clientX: 925, clientY: 338, button: 0, buttons: 1, ...opts });
    },
    step(ms = 1000 / 60) {
      now += ms;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(now);
      assert.ok(frames.size <= 1, 'at most one galaxy animation loop');
    },
    tick(count = 1, hz = 60) { for (let n = 0; n < count; n++) this.step(1000 / hz); },
    elapse(seconds, hz = 60) {
      const count = Math.floor(seconds * hz);
      this.tick(count, hz);
      const remainder = seconds * 1000 - count * 1000 / hz;
      if (remainder > 1e-6) this.step(remainder);
    },
    click(mode) { buttons[mode].emit('click', { target: buttons[mode] }); },
    inView(value) { intersection([{ target: hero, isIntersecting: value }]); },
    scroll(value) { window.pageYOffset = window.scrollY = root.scrollTop = value; window.emit('scroll'); },
    resize(width, height) {
      hero.rect.width = width; hero.rect.height = height; window.innerWidth = width + 40;
      window.emit('resize');
      for (const [target, callback] of resizing) callback([{ target, contentRect: target.getBoundingClientRect() }]);
    },
  };
  return h;
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('OK ' + name); }
const particles = h => h.snapshot().particles;
function displacement(before, after) {
  const byId = new Map(before.map(p => [p.id, p]));
  return Math.max(0, ...after.filter(p => byId.has(p.id)).map(p => {
    const previous = byId.get(p.id); return Math.hypot(p.x - previous.x, p.y - previous.y);
  }));
}
function assertFiniteSnapshot(h) {
  const shot = h.snapshot();
  assert.ok(shot.width > 0 && shot.height > 0, 'snapshot uses nonzero CSS dimensions');
  assert.equal(shot.particles.length, h.info.parts);
  assert.equal(new Set(shot.particles.map(p => p.id)).size, shot.particles.length, 'particle IDs are unique');
  for (const p of shot.particles) {
    assert.ok([p.x, p.y, p.size, p.alpha].every(Number.isFinite), 'snapshot projections are finite');
    assert.ok(p.size > 0 && p.alpha >= 0 && p.alpha <= 1, 'snapshot size and opacity are renderable');
  }
  assert.ok(Number.isInteger(h.info.fieldCount) && h.info.fieldCount >= 0 && h.info.fieldCount <= 3, 'interaction field list stays bounded');
}

test('first RAF has zero elapsed time, every callback paints, and refresh rates agree', () => {
  const results = [];
  for (const hz of [60, 75, 120, 144]) {
    const h = harness(), yaw = h.info.yaw;
    h.tick(1, hz); assert.equal(h.info.yaw, yaw, 'first RAF must not advance simulation');
    h.event('pointermove', { clientX: 1150, clientY: 570 }, h.window);
    const draws = h.info.draws; h.elapse(1, hz);
    assert.equal(h.info.draws - draws, hz, `${hz} Hz paints every delivered frame`);
    assertFiniteSnapshot(h); results.push({ info: h.info, particles: particles(h) });
  }
  for (const result of results.slice(1)) {
    assert.ok(Math.abs(result.info.yaw - results[0].info.yaw) < 1e-8, 'rotation speed follows elapsed time');
    assert.ok(Math.abs(result.info.px - results[0].info.px) < 0.002 && Math.abs(result.info.py - results[0].info.py) < 0.002, 'pointer smoothing follows elapsed time');
    assert.ok(displacement(results[0].particles, result.particles) < 1, 'same elapsed time produces consistent CSS positions');
  }
});

test('dragging and releasing fields follows elapsed time across refresh rates', () => {
  const shots = [];
  for (const hz of [60, 75, 120, 144]) {
    const h = harness(); h.tick(1, hz); h.event('pointerdown'); h.elapse(0.6, hz);
    h.event('pointermove', { clientX: 1100, clientY: 400 }, h.window); h.elapse(0.4, hz);
    h.event('pointerup', { buttons: 0 }, h.window); h.elapse(0.4, hz);
    shots.push({ particles: particles(h), info: h.info });
  }
  for (const shot of shots.slice(1)) {
    assert.ok(Math.abs(shot.info.strength - shots[0].info.strength) < 1e-8, 'release duration is independent of refresh rate');
    assert.ok(Math.hypot(...shot.info.point.map((value, i) => value - shots[0].info.point[i])) < 1e-8, 'dragged field centers agree');
    assert.ok(displacement(shots[0].particles, shot.particles) < 2, 'integration differences stay below two CSS pixels');
  }
});

test('left and right hold/drag remain bounded, then visibly decay after release', () => {
  for (const [button, mode] of [[0, 'attract'], [2, 'repel']]) {
    const h = harness(); h.tick(); const count = h.info.parts;
    assert.equal(h.controls.hidden, false);
    assert.equal(h.event('pointerdown', { button }).defaultPrevented, true);
    assert.equal(h.info.state, mode); assert.equal(h.info.held, true);
    h.elapse(2); assert.ok(h.info.strength > 0.99 && h.info.strength <= 1); assert.equal(h.info.parts, count);
    const before = particles(h), point = [...h.info.point];
    h.event('pointermove', { clientX: 1160, buttons: button === 0 ? 1 : 2 }, h.window);
    assert.deepEqual(particles(h), before, 'pointer events cannot teleport stars between frames');
    assert.deepEqual([...h.info.point], point, 'field center is smoothed during the next frame');
    h.tick(); assert.ok(h.info.point[0] > point[0]);
    h.event('pointerup', { button, buttons: 0 }, h.window);
    assert.equal(h.info.held, false); assert.equal(h.hero.capture, null);
    h.elapse(0.2); assert.ok(h.info.strength > 0);
    h.elapse(2.2); assert.equal(h.info.state, 'idle'); assert.equal(h.info.parts, count);
  }
});

test('quick clicks retain a visible tail and middle burst finishes without rebuilding', () => {
  const h = harness(); h.tick(); const ids = particles(h).map(p => p.id);
  h.event('pointerdown'); h.event('pointerup', { buttons: 0 }, h.window);
  h.elapse(0.15); assert.equal(h.info.state, 'attract'); assert.ok(h.info.strength > 0.05);
  h.event('pointerdown', { button: 1 });
  assert.equal(h.info.state, 'burst'); assert.equal(h.info.held, false);
  assert.equal(h.event('mousedown', { button: 1 }).defaultPrevented, true);
  assert.equal(h.event('auxclick', { button: 1 }).defaultPrevented, true);
  h.elapse(0.7); assert.ok(h.info.strength > 0);
  h.elapse(2.2); assert.equal(h.info.state, 'idle');
  assert.deepEqual(particles(h).map(p => p.id), ids);
});

test('repeated mixed action buttons preserve positions and bound fields and RAFs', () => {
  const h = harness(); h.tick(); h.click('attract'); h.elapse(0.35); const count = h.info.parts;
  for (let n = 0; n < 30; n++) {
    const before = particles(h); h.click(['attract', 'repel', 'burst'][n % 3]);
    assert.deepEqual(particles(h), before, 'new action preserves the current rendered shape');
    assert.ok(h.info.fieldCount <= 3); assert.equal(h.frames.size, 1);
    h.tick(); assert.ok(displacement(before, particles(h)) < 50, 'next frame continues without a reset');
  }
  h.elapse(2.5); assert.equal(h.info.state, 'idle'); assert.equal(h.info.fieldCount, 0); assert.equal(h.info.parts, count);
});

test('actions visibly move stars and normal animation creates no new gradients', () => {
  const base = harness(), active = harness(); base.tick(); active.tick();
  const baseline = base.gradients, cached = active.gradients;
  active.click('attract'); base.elapse(0.35); active.elapse(0.35);
  assert.ok(displacement(particles(base), particles(active)) > 10, 'attraction changes rendered CSS positions');
  active.click('burst'); active.elapse(0.4); active.click('repel'); active.elapse(0.3);
  active.scroll(200); active.elapse(0.5);
  assert.equal(base.gradients, baseline); assert.equal(active.gradients, cached, 'core and interaction gradients are cached');
  assertFiniteSnapshot(active);
});

test('snapshot coordinates and size match the particles actually drawn during interaction and scroll', () => {
  const h = harness(); h.tick(); h.click('repel'); h.scroll(170); h.elapse(0.4);
  const info = h.info, shot = h.snapshot();
  // The primary canvas receives a composed buffer. Match each star sprite in that
  // buffer to its exported CSS projection, rather than a separate idealized model.
  const rendered = h.canvasContexts[1].images.filter(image => image.sprite.width === 64);
  const byPosition = new Map(shot.particles.map(p => [`${p.x.toFixed(6)},${p.y.toFixed(6)}`, p]));
  assert.ok(rendered.length > 100);
  let masked = 0;
  for (const image of rendered) {
    const [x, y, width, height] = image.args;
    const cssX = (x + width / 2) * info.w / info.bw, cssY = (y + height / 2) * info.h / info.bh;
    const p = byPosition.get(`${cssX.toFixed(6)},${cssY.toFixed(6)}`);
    assert.ok(p, 'a rendered star has the same exported CSS position including displacement');
    assert.ok(Math.abs(p.size - width / 2 * info.w / info.bw) < 1e-8, 'exported size agrees with the rendered sprite radius');
    assert.ok(p.alpha <= image.alpha + 1e-8, 'snapshot includes depth opacity and the hero mask');
    if (p.alpha < image.alpha - 0.01) masked++;
  }
  assert.ok(masked > 0, 'the snapshot does not discard hero opacity and masking');
  assert.equal(shot.scroll, info.scroll); assert.equal(shot.yaw, info.yaw);
});

test('resize preserves particle IDs and normalized geometry with observer or fallback', () => {
  for (const resizeObserver of [true, false]) {
    const h = harness({ resizeObserver }); h.tick();
    const before = particles(h), beforeInfo = h.info;
    h.resize(980, 700);
    const after = particles(h), afterInfo = h.info, byId = new Map(before.map(p => [p.id, p]));
    const common = after.filter(p => byId.has(p.id));
    assert.ok(common.length >= Math.min(before.length, after.length) * 0.95, 'resize retains existing particle identities');
    const normalized = (p, info) => {
      const radius = Math.min(info.bw * 0.35, info.bh * 0.66);
      return [(p.x * info.bw / info.w - info.bw * 0.76) / radius, (p.y * info.bh / info.h - info.bh * 0.48) / radius];
    };
    for (const p of common.slice(0, 120)) {
      const a = normalized(byId.get(p.id), beforeInfo), b = normalized(p, afterInfo);
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.003, 'resize preserves normalized particle arrangement');
    }
    assert.equal(h.frames.size, 1); assertFiniteSnapshot(h);
  }
});

test('links, controls, editable areas and title text keep native mouse actions', () => {
  const h = harness();
  const targets = [h.buttons.attract, h.status];
  for (const tag of ['a', 'button', 'input', 'textarea', 'select']) targets.push(h.element(tag));
  targets.push(h.element('div', { contenteditable: '' }));
  for (const name of ['hero-title', 'hero-sub', 'hero-eyebrow', 'hero-id', 'hero-stats']) targets.push(h.element('span', { class: name }));
  for (const target of targets) {
    for (const button of [0, 1, 2]) assert.equal(h.event('pointerdown', { target, button }).defaultPrevented, undefined);
    assert.equal(h.event('contextmenu', { target, button: 2 }).defaultPrevented, undefined);
    assert.equal(h.event('auxclick', { target, button: 1 }).defaultPrevented, undefined);
  }
  assert.equal(h.info.state, 'idle');
});

test('only blank right-hand hero area intercepts menus and Shift keeps native menu', () => {
  const h = harness();
  assert.equal(h.event('contextmenu', { button: 2 }).defaultPrevented, true);
  assert.equal(h.event('pointerdown', { button: 2, shiftKey: true }).defaultPrevented, undefined);
  assert.equal(h.event('contextmenu', { button: 2, shiftKey: true }).defaultPrevented, undefined);
  for (const position of [{ clientX: 560 }, { clientX: 1221 }, { clientY: 39 }, { clientY: 661 }]) {
    assert.equal(h.event('pointerdown', position).defaultPrevented, undefined);
    assert.equal(h.event('contextmenu', position).defaultPrevented, undefined);
  }
  assert.equal(h.info.state, 'idle');
});

test('touch and pen never intercept scrolling or start mouse effects', () => {
  const h = harness();
  for (const pointerType of ['touch', 'pen']) {
    assert.equal(h.event('pointerdown', { pointerType }).defaultPrevented, undefined);
    assert.equal(h.event('contextmenu', { pointerType }).defaultPrevented, undefined);
  }
  assert.equal(h.info.state, 'idle');
});

test('leave, capture loss, missing releases, cancel and blur release smoothly', () => {
  for (const release of [
    h => h.event('pointerleave'),
    h => h.event('lostpointercapture'),
    h => h.event('pointermove', { buttons: 0 }, h.window),
    h => h.event('pointermove', { clientX: 500 }, h.window),
    h => h.event('pointercancel', {}, h.window),
    h => h.window.emit('blur'),
  ]) {
    const h = harness(); h.tick(); h.event('pointerdown'); h.elapse(0.4);
    const before = particles(h); release(h);
    assert.deepEqual(particles(h), before, 'release cannot snap particle positions to the baseline');
    h.tick(); // Pointer moves are consumed once per RAF; explicit cancels release immediately.
    assert.equal(h.info.held, false); assert.equal(h.hero.capture, null);
    assert.ok(displacement(before, particles(h)) < 50);
    h.elapse(2.2); assert.equal(h.info.state, 'idle');
  }
  const h = harness(); h.tick(); h.event('pointerdown', { button: 1 }); h.elapse(0.2);
  h.event('pointercancel', {}, h.window); h.elapse(2.2); assert.equal(h.info.state, 'idle');
});

test('pause, motion off, reduced motion, hidden and offscreen freeze then resume continuously', () => {
  const cases = [
    [h => h.pause.emit('click'), h => h.pause.emit('click')],
    [h => h.root.setAttribute('data-motion', 'off'), h => h.root.setAttribute('data-motion', 'on')],
    [h => { h.reduce.matches = true; h.reduce.emit('change'); }, h => { h.reduce.matches = false; h.reduce.emit('change'); }],
    [h => { h.document.hidden = true; h.document.emit('visibilitychange'); }, h => { h.document.hidden = false; h.document.emit('visibilitychange'); }],
    [h => h.inView(false), h => h.inView(true)],
  ];
  for (const [stop, resume] of cases) {
    const h = harness(); h.tick(); h.event('pointerdown'); h.elapse(0.4);
    const before = particles(h); stop(h);
    assert.equal(h.info.state, 'paused'); assert.equal(h.info.held, false); assert.equal(h.frames.size, 0);
    assert.ok(Object.values(h.buttons).every(button => button.disabled));
    assert.deepEqual(particles(h), before, 'suspension preserves the rendered shape');
    h.step(5000); h.event('pointerdown'); h.click('burst');
    assert.equal(h.frames.size, 0); assert.deepEqual(particles(h), before, 'suspended events cannot alter the frozen scene');
    resume(h); assert.equal(h.frames.size, 1);
    assert.ok(Object.values(h.buttons).every(button => !button.disabled));
    h.tick(); assert.deepEqual(particles(h), before, 'resume first frame has zero elapsed time');
    h.tick(); assert.ok(displacement(before, particles(h)) < 50, 'release continues on subsequent frames');
    h.elapse(2.2); assert.equal(h.info.state, 'idle');
  }
});

test('long foreground stalls are capped and scroll progress remains finite and reversible', () => {
  const h = harness(); h.tick(); h.elapse(0.2); const yaw = h.info.yaw;
  h.step(5000);
  assert.ok(h.info.yaw > yaw && h.info.yaw - yaw <= 0.055 * 0.05 + 1e-8, 'foreground stall advances at most 50 ms');
  h.scroll(300); h.elapse(0.5);
  assert.ok(h.info.scroll > 0 && h.info.scroll <= 1); assertFiniteSnapshot(h);
  h.scroll(0); h.elapse(2); assert.ok(h.info.scroll < 0.002);
});

test('initial motion preferences stay frozen and compact mode keeps its particle budget', () => {
  for (const options of [{ motion: 'off' }, { reduced: true }]) {
    const h = harness(options); assert.equal(h.info.state, 'paused'); assert.equal(h.frames.size, 0);
    assert.match(h.status.textContent, /开启动效/);
    assert.equal(h.event('mousedown', { button: 1 }).defaultPrevented, undefined);
    assert.equal(h.event('contextmenu').defaultPrevented, undefined);
    assertFiniteSnapshot(h);
  }
  const h = harness({ compact: true }); h.tick(); h.event('pointerdown'); h.elapse(0.2);
  assert.equal(h.info.state, 'attract'); assert.ok(h.info.parts <= 650 && h.info.q <= 0.7); assertFiniteSnapshot(h);
});

console.log(`PASS ${passed} galaxy interaction checks`);
