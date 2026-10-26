/* Deterministic controller tests for the actual morph script. A recording canvas
   checks projection and opacity; native raster quality remains browser QA. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../theme/static/js/morph.js'), 'utf8');
const galaxySource = fs.readFileSync(path.join(__dirname, '../theme/static/js/galaxy.js'), 'utf8');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
  emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
  dispatchEvent(event) { this.emit(event.type, event); }
}

function harness({ motion = 'on', reduced = false, bridge = true, matrix3d = true, realGalaxy = false } = {}) {
  let now = 0, nextFrame = 0, fontsReady, intersect;
  const frames = new Map(), contexts = [], observers = [];
  const counters = { layout: 0, computed: 0, writes: 0, readAfterWrite: 0 };
  let inFrame = false, written = false;
  const write = () => { counters.writes++; if (inFrame) written = true; };
  const read = key => { counters[key]++; if (inFrame && written) counters.readAfterWrite++; };
  class Element extends Events {
    constructor(tag, attrs = {}, box = {}) {
      super(); this.tag = tag; this.attrs = { ...attrs }; this.children = [];
      this.box = { x: 0, y: 0, w: 300, h: 100, ...box }; this.textContent = '';
      const styles = new Map(), classes = new Set();
      const element = this;
      this.style = {
        setProperty(key, value) { styles.set(key, String(value)); write(); if (element.changed) element.changed('style'); },
        getPropertyValue(key) { return styles.get(key) || ''; },
      };
      this.classList = {
        toggle(key, value) { write(); if (value) classes.add(key); else classes.delete(key); },
        contains(key) { return classes.has(key); },
      };
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) { this.attrs[name] = String(value); write(); if (this.changed) this.changed(name); }
    querySelector(selector) { return this.children.find(child => child.tag === selector || (selector[0] === '[' && child.getAttribute(selector.slice(1, -1)) !== null)) || null; }
    querySelectorAll() { return []; }
    visual() {
      const b = this.box;
      const rv = this.card && root.getAttribute('data-motion') !== 'off' && !reduce.matches ? this.__rv : 1;
      const scale = .982 + .018 * rv;
      return { left: b.x + b.w * (1 - scale) / 2, top: b.y - window.pageYOffset + b.h * (1 - scale) / 2 + (1 - rv) * 34,
        width: b.w * scale, height: b.h * scale };
    }
    getBoundingClientRect() { read('layout'); return this.visual(); }
  }
  const makeCanvas = () => {
    const canvas = new Element('canvas');
    const ctx = {
      images: [], globalAlpha: 1,
      setTransform() {}, clearRect() { this.images = []; },
      createRadialGradient() { return { addColorStop() {} }; },
      fillRect() {}, fillText() {}, measureText() { return { width: 128 }; },
      beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {},
      getImageData(x, y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        // Four columns of glyph pixels, sufficient to inspect point assignment.
        for (let row = 32; row < 128; row += 2) for (let col = 8; col < 120; col += 8) data[(row * width + col) * 4 + 3] = 255;
        return { data };
      },
      drawImage(sprite, ...args) { this.images.push({ sprite, args, alpha: this.globalAlpha }); },
    };
    canvas.getContext = () => ctx; contexts.push(ctx); return canvas;
  };
  const root = new Element('html', { 'data-motion': motion });
  const hero = new Element('section', {}, { x: 20, y: 40, w: 960, h: 680 });
  const head = new Element('header', {}, { x: 60, y: 900, w: 500, h: 90 });
  const title = new Element('h2', {}, { x: 60, y: 900, w: 320, h: 40 });
  title.textContent = '从一个问题开始'; head.children.push(title);
  const cards = [new Element('article', {}, { x: 60, y: 1030, w: 360, h: 200 }), new Element('article', {}, { x: 480, y: 1030, w: 360, h: 200 })];
  cards.forEach(card => { card.card = true; card.__rv = 1; });
  const canvas = makeCanvas(), body = new Element('body');
  const galaxyCanvas = realGalaxy ? makeCanvas() : null;
  if (galaxyCanvas) galaxyCanvas.parentNode = hero;
  const pause = new Element('button', { 'data-galaxy-pause': '' }); hero.children.push(pause);
  const document = Object.assign(new Events(), {
    documentElement: root, body, hidden: false,
    getElementById: id => id === 'morph-canvas' ? canvas : id === 'hero-galaxy' ? galaxyCanvas : null,
    querySelector: selector => selector === '.hero' ? hero : selector === '[data-morph="head"]' ? head : null,
    querySelectorAll: () => cards,
    createElement: tag => tag === 'canvas' ? makeCanvas() : new Element(tag),
    createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => title.getBoundingClientRect() }),
    fonts: { ready: { then(fn) { fontsReady = fn; } } },
  });
  const reduce = Object.assign(new Events(), { matches: reduced });
  class MutationObserver {
    constructor(fn) { this.fn = fn; }
    observe(target, { attributeFilter }) {
      const previous = target.changed;
      target.changed = name => { if (previous) previous(name); if (attributeFilter.includes(name)) this.fn([{ attributeName: name }]); };
    }
  }
  class ResizeObserver {
    constructor(fn) { observers.push(fn); }
    observe() {}
  }
  class IntersectionObserver {
    constructor(fn) { intersect = fn; }
    observe() {}
  }
  const particles = Array.from({ length: 8 }, (_, i) => ({ id: 40 + i, x: 520 + i * 20, y: 300 + i * 8, size: 1.5 + i / 8, tier: i % 3, level: i % 4, alpha: .2 + i / 10 }));
  const snap = { particles, width: 960, height: 680, paused: false, scroll: 0, yaw: 0 };
  const galaxy = { snapshot: () => snap };
  const window = Object.assign(new Events(), {
    innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1, pageYOffset: 0,
    matchMedia: () => reduce, MutationObserver, ResizeObserver, IntersectionObserver,
    requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  if (bridge) window.__galaxy = galaxy;
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => { throw new Error('morph must never invent a random galaxy'); };
  const getComputedStyle = element => {
    read('computed');
    const rv = element.card && root.getAttribute('data-motion') !== 'off' && !reduce.matches ? element.__rv : 1;
    const scale = .982 + .018 * rv, ty = (1 - rv) * 34;
    return {
      fontSize: '32px', lineHeight: '40px', fontWeight: '700', fontFamily: 'sans-serif',
      transform: matrix3d ? `matrix3d(${scale},0,0,0,0,${scale},0,0,0,0,1,0,0,${ty},0,1)` : `matrix(${scale},0,0,${scale},0,${ty})`,
      getPropertyValue: name => name === '--accent' ? '#7aa2ff' : '#ff9d5c',
    };
  };
  const context = vm.createContext({ window, document, MutationObserver, ResizeObserver, IntersectionObserver, getComputedStyle, Math: deterministicMath,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    Event: class Event { constructor(type) { this.type = type; } },
  });
  if (realGalaxy) {
    let seed = 13;
    deterministicMath.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    vm.runInContext(galaxySource, context, { filename: 'galaxy.js' });
    deterministicMath.random = () => { throw new Error('morph must reuse existing particles'); };
  }
  vm.runInContext(source, context, { filename: 'morph.js' });
  return {
    window, document, root, hero, head, title, cards, canvas, contexts, particles, snap, frames, counters, reduce, pause,
    get info() { return window.__morph.info(); },
    get now() { return now; },
    attachBridge() { window.__galaxy = galaxy; window.emit('galaxy:change'); },
    tick(count = 1, dt = 1000 / 60) {
      for (let i = 0; i < count; i++) {
        now += dt; written = false; inFrame = true;
        const pending = [...frames.values()]; frames.clear();
        for (const fn of pending) fn(now);
        inFrame = false;
        assert.ok(frames.size <= (realGalaxy ? 2 : 1), 'only one RAF per controller may be pending');
      }
    },
    scrollToProgress(p, event = true) {
      window.pageYOffset = title.box.y - window.innerHeight + window.innerHeight * .8 * p;
      if (event) window.emit('scroll');
    },
    probe(p) { this.scrollToProgress(p, false); window.__morph.setProgress(p); return this.info; },
    resize() { observers.forEach(fn => fn([])); },
    fontsReady() { fontsReady(); },
    reduced(value) { reduce.matches = value; reduce.emit('change'); },
    inView(value) { intersect([{ isIntersecting: value }]); },
    hidden(value) { document.hidden = value; document.emit('visibilitychange'); },
    reveal(time = now) { document.emit('reveal:frame', { detail: { time, active: true } }); },
  };
}

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('OK ' + name); }

test('handoff reuses source positions, size, depth/mask alpha and live projection objects', () => {
  const h = harness(); h.tick();
  const p = .03, info = h.probe(p), star = h.particles[0], blend = smooth(0, .065, p);
  assert.equal(info.n, h.particles.length); assert.equal(info.first.id, star.id);
  close(info.first.x, h.hero.box.x + star.x);
  close(info.first.y, h.hero.box.y - h.window.pageYOffset + star.y);
  close(info.first.size, star.size); close(info.first.alpha, star.alpha * blend);
  close(info.handoff, blend); close(star.alpha * (1 - info.handoff) + info.first.alpha, star.alpha);
  close(h.contexts[0].images[0].alpha, blend);
  close(h.contexts[1].images[0].alpha, star.alpha);
  star.x += 73; star.y -= 21; star.size = 4; star.alpha = .13;
  const next = h.probe(p);
  close(next.first.x, info.first.x + 73); close(next.first.y, info.first.y - 21);
  close(next.first.size, 4); close(next.first.alpha, .13 * blend);
  h.window.innerWidth = 983; h.window.innerHeight = 769; h.window.emit('resize'); h.tick();
  const resized = h.probe(p), actual = h.contexts[1].images[0].args;
  close((actual[0] + actual[2] / 2) * resized.w / resized.bw, resized.first.x);
  close((actual[1] + actual[3] / 2) * resized.h / resized.bh, resized.first.y);
  close(actual[2] / 2 * resized.w / resized.bw, resized.first.size);
});

test('masked stars may brighten into text; final text alpha tends continuously to zero', () => {
  const h = harness(); h.tick(); h.particles.forEach(star => { star.alpha = .001; });
  assert.ok(h.probe(.58).maxAlpha > .5, 'text uses its own opacity rather than inheriting a hidden source mask');
  const values = [.86, .88, .90, .91, .915, .919, .92].map(p => h.probe(p).maxAlpha);
  assert.ok(values[0] > .01); assert.equal(values.at(-1), 0);
  values.slice(1).forEach((v, i) => assert.ok(v <= values[i] + 1e-12, 'fade must never normalize back to opaque'));
  assert.ok(values.at(-2) < .005, 'particles fade down before being omitted');
  assert.equal(h.info.live, false); assert.equal(h.info.head, 1);
});

test('card outline follows the same transformed perimeter with both CSS matrix forms', () => {
  for (const matrix3d of [false, true]) {
    const h = harness({ matrix3d }); h.cards.forEach(card => { card.__rv = .2; }); h.tick();
    const first = h.probe(1).first, box = h.cards[0].visual();
    // Eight particles, two identical perimeters: first particle is at u=.125.
    const perimeter = 2 * (box.width + box.height);
    close(first.x, box.left + .125 * perimeter); close(first.y, box.top);
    assert.ok(first.alpha > .1);
    h.cards.forEach(card => { card.__rv = .79; }); const nearEnd = h.probe(1).maxAlpha;
    assert.ok(nearEnd > 0 && nearEnd < .002);
    h.cards.forEach(card => { card.__rv = .8; }); assert.equal(h.probe(1).maxAlpha, 0);
  }
});

test('same-frame reveal events update outlines without reading layout', () => {
  const h = harness(); h.tick(); h.scrollToProgress(1); h.window.__morph.setProgress(1); h.tick();
  const reads = h.counters.layout + h.counters.computed, frames = h.info.frames;
  assert.equal(h.info.maxAlpha, 0); h.cards.forEach(card => { card.__rv = .3; }); h.reveal();
  assert.ok(h.info.maxAlpha > .7); assert.equal(h.info.frames, frames + 1);
  assert.equal(h.counters.layout + h.counters.computed, reads);
  assert.equal(h.frames.size, 0, 'a one-off same-frame repaint needs no idle animation loop');
  h.cards.forEach(card => { card.__rv = .4; }); h.reveal(h.now + 16);
  assert.equal(h.info.frames, frames + 2, 'a later reveal frame paints immediately even while morph is idle');
  assert.equal(h.frames.size, 0);
});

test('scroll damping is refresh-rate independent and renders each requested animation frame', () => {
  const runs = [60, 120].map(hz => {
    const h = harness(); h.tick(); h.scrollToProgress(.9); h.tick(1, 1000 / hz);
    const before = h.info.frames; h.tick(hz, 1000 / hz);
    assert.equal(h.info.frames - before, hz, 'do not skip alternate or fractional frames');
    close(h.info.p, .9 * (1 - Math.exp(-5.5)), 1e-10);
    return h.info.p;
  });
  close(runs[0], runs[1], 1e-10);
});

test('idle scroll restarts smoothly, and a hidden-tab interval never becomes a huge delta', () => {
  const h = harness(); h.tick(); assert.equal(h.frames.size, 0);
  h.scrollToProgress(.8); h.tick(); assert.equal(h.info.p, 0, 'first wake preserves the last pose');
  h.tick(8); const before = h.info.p; assert.ok(before > 0 && before < .8);
  h.hidden(true); assert.equal(h.frames.size, 0); h.tick(1, 120000);
  h.hidden(false); h.tick(); close(h.info.p, before);
  h.tick(); assert.ok(h.info.p > before && h.info.p < .8);
  h.tick(220); assert.equal(h.info.p, .8); assert.equal(h.frames.size, 0);
  h.scrollToProgress(.9); h.tick(); close(h.info.p, .8);
});

test('top, settled text and offscreen bottom stop, while live star handoff follows the bridge', () => {
  const h = harness(); h.tick(); assert.equal(h.frames.size, 0);
  h.scrollToProgress(.2); h.window.__morph.setProgress(.2); h.tick(); assert.equal(h.frames.size, 1);
  h.snap.paused = true; h.window.emit('galaxy:change'); h.tick(); assert.equal(h.frames.size, 0);
  h.snap.paused = false; h.window.emit('galaxy:change'); h.tick(); assert.equal(h.frames.size, 1);
  h.scrollToProgress(.6); h.window.__morph.setProgress(.6); h.tick(); assert.equal(h.frames.size, 0);
  h.scrollToProgress(1); h.window.emit('scroll'); h.tick(250);
  assert.equal(h.info.p, 1); assert.equal(h.info.live, false); assert.equal(h.frames.size, 0);
  const count = h.info.frames; h.tick(60); assert.equal(h.info.frames, count);
});

test('motion and reduced-motion preferences disable immediately and resume from the last pose', () => {
  for (const kind of ['motion', 'reduced']) {
    const h = harness(); h.tick(); h.probe(.2); h.window.emit('scroll'); h.tick();
    const before = h.info.p;
    const preference = value => kind === 'motion' ? h.root.setAttribute('data-motion', value ? 'off' : 'on') : h.reduced(value);
    preference(true); assert.equal(h.frames.size, 0); assert.equal(h.info.live, false);
    assert.equal(h.info.head, 1); assert.equal(h.info.handoff, 0);
    h.scrollToProgress(.4); h.tick(10); close(h.info.p, before);
    preference(false); h.tick(); close(h.info.p, before); h.tick();
    assert.ok(h.info.p > before && h.info.p < .4); assert.ok(h.info.live);
  }
});

test('starting with motion disabled and missing bridge leaves the real title readable', () => {
  const off = harness({ motion: 'off' }); assert.equal(off.info.head, 1); assert.equal(off.frames.size, 0);
  off.root.setAttribute('data-motion', 'on'); off.tick(); assert.ok(off.info.bridge);
  const h = harness({ bridge: false }); h.tick();
  assert.equal(h.info.head, 1); assert.equal(h.info.handoff, 0); assert.equal(h.info.live, false); assert.equal(h.frames.size, 0);
  h.attachBridge(); h.tick(); assert.ok(h.info.bridge); assert.equal(h.info.n, h.particles.length);
});

test('scroll/reveal frames use cached layout; resize, font and responsive geometry invalidate it', () => {
  const h = harness(); h.tick(); const measured = h.info.measurements, reads = h.counters.layout + h.counters.computed;
  h.scrollToProgress(.65); h.tick(45); h.cards[0].__rv = .3; h.reveal(); h.tick();
  assert.equal(h.info.measurements, measured); assert.equal(h.counters.layout + h.counters.computed, reads);
  h.cards[0].box.w = 420; h.resize(); h.tick(); assert.equal(h.info.measurements, measured + 1);
  h.title.box.y += 100; h.fontsReady(); h.tick(); assert.equal(h.info.measurements, measured + 2);
  close(h.info.headTop, 1000);
  h.window.innerWidth = 720; h.window.innerHeight = 700; h.window.emit('resize'); h.tick();
  assert.equal(h.info.w, 720); assert.equal(h.info.h, 700); assert.equal(h.canvas.width, 720);
  const afterResize = h.info.measurements;
  h.root.style.setProperty('--font-scale', '1.2'); h.tick(); assert.equal(h.info.measurements, afterResize + 1);
  assert.equal(h.counters.readAfterWrite, 0, 'visible writes must never precede forced style/layout reads in a frame');
});

test('stable IDs survive bridge array replacement without randomized targets', () => {
  const h = harness(); h.tick(); const before = h.probe(.6).first;
  h.snap.particles = h.particles.map(star => ({ ...star }));
  const after = h.probe(.6).first;
  assert.equal(after.id, before.id); close(after.x, before.x); close(after.y, before.y); close(after.size, before.size);
});

test('real galaxy and morph share projected particles through pointer interaction, pause and recovery', () => {
  const h = harness({ realGalaxy: true }); h.tick();
  const galaxy = h.window.__galaxy, snapshot = galaxy.snapshot(), list = snapshot.particles;
  h.probe(.03); h.window.emit('scroll'); h.tick(3);
  let info = h.info, star = list.find(value => value.id === info.first.id);
  close(info.first.x, h.hero.box.x + star.x); close(info.first.y, h.hero.box.y - h.window.pageYOffset + star.y);
  close(info.first.size, star.size); close(info.first.alpha, star.alpha * info.handoff);
  assert.equal(galaxy.snapshot().particles, list);
  const x = star.x;
  h.window.emit('pointermove', { pointerType: 'mouse', clientX: 900, clientY: 180 }); h.tick(12);
  info = h.info; star = list.find(value => value.id === info.first.id);
  assert.ok(Math.abs(star.x - x) > .1, 'the actual galaxy engine moves the shared projection');
  close(info.first.x, h.hero.box.x + star.x); close(info.first.alpha, star.alpha * info.handoff);
  h.pause.emit('click'); h.tick(); assert.equal(galaxy.snapshot().paused, true); assert.equal(h.frames.size, 0);
  const paused = { ...h.info.first }; h.tick(30); close(h.info.first.x, paused.x);
  h.pause.emit('click'); h.tick(); assert.equal(galaxy.snapshot().paused, false); close(h.info.first.x, paused.x);
  h.tick(5); assert.notEqual(h.info.first.x, paused.x);
  h.inView(false); h.tick(); assert.equal(h.frames.size, 0);
  h.inView(true); h.tick(); assert.ok(h.frames.size > 0);
});

console.log(`PASS ${passed} morph motion tests`);
