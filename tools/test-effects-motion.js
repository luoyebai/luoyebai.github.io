/* Deterministic DOM/RAF checks for the production controller. CSS appearance,
   real hit testing and morph drawing are covered separately in browser QA. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../theme/static/js/effects.js'), 'utf8');

class Events {
  constructor() { this.listeners = new Map(); this.listenerOptions = []; }
  addEventListener(type, fn, options) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);
    this.listenerOptions.push({type, options});
  }
  dispatchEvent(event) {
    event.target ||= this;
    for (const fn of this.listeners.get(event.type) || []) fn(event);
    return !event.defaultPrevented;
  }
  emit(type, props = {}) {
    const event = {type, target: this, ...props, preventDefault() { this.defaultPrevented = true; }};
    this.dispatchEvent(event); return event;
  }
}

function harness({motion = 'on', reduced = false, fine = true, compact = false, tilt = 12,
  home = false, width = 1200, height = 1000} = {}) {
  let time = 0, nextFrame = 0;
  const frames = new Map(), resizers = [], mutations = [], operations = [];
  class Element extends Events {
    constructor(classNames = '', top = 0) {
      super(); this.children = []; this.attrs = {}; this.parentElement = null;
      this.top = top; this.height = 200; this.hidden = false; this.offsetReads = 0; this.rectReads = 0;
      this.rect = {left: 100, top: 200, width: 400, height: 200};
      const classes = new Set(classNames.split(' ').filter(Boolean));
      this.classList = {
        add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
        toggle(name, force) { const on = force === undefined ? !classes.has(name) : force; on ? classes.add(name) : classes.delete(name); return on; }
      };
      const props = {};
      this.style = new Proxy({
        setProperty: (name, value) => { operations.push({kind: 'write', element: this, name}); props[name] = String(value); },
        getPropertyValue: name => props[name] || ''
      }, {set: (target, name, value) => { operations.push({kind: 'write', element: this, name}); target[name] = value; return true; }});
    }
    append(child) { this.children.push(child); child.parentElement = child.offsetParent = this; return child; }
    get offsetTop() { this.offsetReads++; operations.push({kind: 'read', element: this, name: 'offsetTop'}); return this.top; }
    get offsetHeight() { operations.push({kind: 'read', element: this, name: 'offsetHeight'}); return this.hidden ? 0 : this.height; }
    getBoundingClientRect() { this.rectReads++; operations.push({kind: 'read', element: this, name: 'rect'}); return this.rect; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      for (const observer of mutations) if (observer.target === this && observer.filter.includes(name)) observer.fn([{attributeName: name}]);
    }
    querySelector(selector) { return selector === '.card-tilt' ? this.layer || null : null; }
    querySelectorAll() { return []; }
    contains(element) { for (let el = element; el; el = el.parentElement) if (el === this) return true; return false; }
    closest(selector) {
      for (let el = this; el; el = el.parentElement) {
        if (selector.startsWith('[') && el.getAttribute(selector.slice(1, -1)) !== null) return el;
        if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) return el;
      }
      return null;
    }
  }
  const root = new Element('js'); root.scrollHeight = 4000;
  Object.assign(root.attrs, {'data-motion': motion, 'data-performance': compact ? 'compact' : 'full', 'data-tilt': String(tilt)});
  const body = new Element(), flow = home ? body.append(new Element()) : null;
  let recent = null, chapter = null;
  if (flow) {
    flow.attrs['data-home-flow'] = '';
    recent = flow.append(new Element('section', 800));
    recent.attrs['data-scroll-chapter'] = ''; recent.attrs['data-reading-recent'] = ''; recent.hidden = true;
    chapter = flow.append(new Element('section', 1000));
    chapter.attrs['data-scroll-chapter'] = ''; chapter.height = 640;
  }
  const chapters = home ? [recent, chapter] : [];
  const group = (chapter || body).append(new Element());
  const cards = (home ? [0, 200] : [1000, 1200]).map(top => {
    const card = group.append(new Element('reveal card', top));
    card.layer = card.append(new Element('card-tilt')); return card;
  });
  const spot = new Element('spotlight');
  const document = Object.assign(new Events(), {
    documentElement: root, body, hidden: false, activeElement: body,
    querySelector: selector => selector === '.spotlight' ? spot : null,
    querySelectorAll: selector => ['.reveal', '.card[data-tiltable]'].includes(selector) ? cards
      : selector === '[data-scroll-chapter]' ? chapters : [],
    getElementById: () => null
  });
  const reduceQuery = Object.assign(new Events(), {matches: reduced});
  const fineQuery = Object.assign(new Events(), {matches: fine});
  const theme = {state: {tilt}, listeners: [], onChange(fn) { this.listeners.push(fn); }};
  class MutationObserver {
    constructor(fn) { this.fn = fn; }
    observe(target, {attributeFilter}) { this.target = target; this.filter = attributeFilter; mutations.push(this); }
  }
  class ResizeObserver {
    constructor(fn) { this.fn = fn; this.targets = new Set(); resizers.push(this); }
    observe(target) { this.targets.add(target); }
  }
  const window = Object.assign(new Events(), {
    Theme: theme, performance: {now: () => time}, innerHeight: height, innerWidth: width, pageYOffset: 0, scrollY: 0,
    matchMedia: query => query.includes('prefers-reduced') ? reduceQuery : fineQuery,
    requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    MutationObserver, ResizeObserver
  });
  const revealEvents = [];
  document.addEventListener('reveal:frame', event => {
    for (const card of cards) assert.equal(Number(card.style.getPropertyValue('--rv')), card.__rv, 'bridge sees the same actual CSS progress');
    revealEvents.push({time: event.detail.time, active: event.detail.active, values: cards.map(card => card.__rv),
      chapters: chapters.map(el => ['--chapter-enter', '--chapter-progress'].map(name => Number(el.style.getPropertyValue(name))))});
  });
  vm.runInNewContext(source, {
    window, document, navigator: {}, Theme: theme, MutationObserver, ResizeObserver,
    CustomEvent: class { constructor(type, props) { this.type = type; this.detail = props.detail; } }
  }, {filename: 'effects.js'});
  const h = {
    root, body, flow, recent, chapter, chapters, group, cards, spot, document, window, theme, frames, operations, revealEvents,
    tick(ms = 1000 / 60) {
      time += ms;
      for (const [id, callback] of [...frames]) {
        if (!frames.has(id)) continue;
        frames.delete(id); callback(time);
      }
    },
    drain(max = 300) {
      let count = 0;
      while (frames.size && count++ < max) h.tick();
      assert.equal(frames.size, 0, 'all motion settles in a bounded number of frames'); return count;
    },
    scroll(y) { window.scrollY = window.pageYOffset = y; window.emit('scroll'); },
    point(card, x, y, type = 'pointermove', pointerType = 'mouse') {
      const props = {target: card || window, clientX: x, clientY: y, pointerType};
      const event = card ? card.emit(type, props) : null;
      if (['pointermove', 'pointerup'].includes(type)) window.emit(type, props);
      return event;
    },
    reduced(value) { reduceQuery.matches = value; reduceQuery.emit('change'); },
    fine(value) { fineQuery.matches = value; fineQuery.emit('change'); },
    visible(value) { document.hidden = !value; document.emit('visibilitychange'); },
    resize(target) { for (const observer of resizers) if (!target || observer.targets.has(target)) observer.fn(); },
    focus(target) {
      const previous = document.activeElement; document.activeElement = target || body;
      if (previous) document.emit('focusout', {target: previous, relatedTarget: document.activeElement});
      document.emit('focusin', {target: document.activeElement, relatedTarget: previous});
    },
    get now() { return time; }
  };
  return h;
}

const numeric = (element, name) => parseFloat(element.style.getPropertyValue(name)) || 0;
const spotPosition = h => h.spot.style.transform.match(/translate3d\(([^p]+)px,([^p]+)px,0\)/).slice(1).map(Number);
const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

test('reveal, rotation, hover lift and light follow elapsed time at 30/60/120 Hz', () => {
  const snapshots = [30, 60, 120].map(hz => {
    const h = harness(); h.drain();
    h.point(null, 100, 120); h.drain();
    h.scroll(300); h.point(h.cards[0], 460, 230);
    for (let n = 0; n < hz / 5; n++) h.tick(1000 / hz);
    return [h.cards[0].__rv, numeric(h.cards[0].layer, '--rx'), numeric(h.cards[0].layer, '--ry'), numeric(h.cards[0].layer, '--lift'), ...spotPosition(h)];
  });
  for (const state of snapshots.slice(1)) state.forEach((value, i) => close(value, snapshots[0][i]));
  assert.ok(snapshots[0][0] > .3 && snapshots[0][0] < .41);
  assert.ok(snapshots[0][3] > -5 && snapshots[0][3] < -4, 'hover lift is animated');
});

test('unrounded reveal values match the bridge, fully settle, and restore on reverse scroll', () => {
  const h = harness(); h.drain();
  h.scroll(300); h.tick();
  const actual = h.cards[0].__rv;
  assert.notEqual(actual, Math.round(actual * 100) / 100, 'no one-percent stepping');
  assert.equal(h.cards[0].classList.contains('is-in'), false);
  h.drain(); close(h.cards[0].__rv, 180 / 440);
  assert.equal(h.revealEvents.at(-1).active, false);
  h.scroll(1100); h.drain();
  assert.ok(h.cards.every(card => card.__rv === 1 && card.classList.contains('is-in')));
  h.scroll(0); h.drain(); assert.ok(h.cards.every(card => card.__rv === 0));
  assert.equal(h.root.classList.contains('reveal-driven'), true);
});

test('many pointer events coalesce to one read/write phase, only on the active card', () => {
  const h = harness(); h.drain(); h.operations.length = 0;
  for (let n = 0; n < 100; n++) h.point(h.cards[0], 300 + n, 250);
  assert.equal(h.operations.length, 0, 'input handlers do no layout reads or style writes');
  assert.equal(h.frames.size, 1, 'three effects share one pending frame');
  h.tick();
  assert.equal(h.cards[0].rectReads, 1); assert.equal(h.cards[1].rectReads, 0);
  const firstWrite = h.operations.findIndex(op => op.kind === 'write');
  assert.ok(h.operations.slice(firstWrite).every(op => op.kind !== 'read'), 'all layout reads precede writes');
  h.drain(); close(numeric(h.cards[0].layer, '--ry'), (399 - 100 - 200) / 400 * 12);
  assert.equal(h.cards[0].rectReads, 1, 'settling needs no more layout reads');
  assert.equal(h.root.classList.contains('tilt-driven'), true);
});

test('layout is cached across scroll and remeasured once after resize or lazy image load', () => {
  const h = harness(); h.drain(); const reads = h.cards[0].offsetReads;
  for (let n = 0; n < 40; n++) h.scroll(300 + n);
  h.drain(); assert.equal(h.cards[0].offsetReads, reads);
  h.cards[0].top = 1100;
  for (let n = 0; n < 20; n++) h.resize();
  assert.equal(h.cards[0].offsetReads, reads, 'observer queues rather than measures');
  h.drain(); assert.equal(h.cards[0].offsetReads, reads + 1);
  close(h.cards[0].__rv, (339 + 880 - 1100) / 440);
  h.document.emit('load', {target: {tagName: 'IMG'}}); h.drain();
  assert.equal(h.cards[0].offsetReads, reads + 2);
});

test('first spotlight frame starts at the latest pointer, and idle light stops painting', () => {
  const h = harness(); h.drain();
  h.point(null, 700, 460); h.point(null, 740, 480);
  assert.equal(h.spot.classList.contains('is-on'), false);
  h.tick(); assert.deepEqual(spotPosition(h), [740, 480]);
  assert.equal(h.spot.classList.contains('is-on'), true); assert.equal(h.frames.size, 0);
  h.point(null, 900, 600); h.tick();
  assert.ok(spotPosition(h)[0] > 740 && spotPosition(h)[0] < 900);
  h.drain(); assert.deepEqual(spotPosition(h), [900, 600]);
  h.window.emit('pointerout', {relatedTarget: null});
  assert.equal(h.spot.classList.contains('is-on'), false);
  h.point(null, 200, 300); h.tick(); assert.deepEqual(spotPosition(h), [200, 300]);
});

test('hover, leave, press and blur return the visual layer smoothly without cancelling links', () => {
  const h = harness(); h.drain();
  h.point(h.cards[0], 450, 250, 'pointerenter'); h.drain();
  assert.equal(numeric(h.cards[0].layer, '--lift'), -5);
  const down = h.point(h.cards[0], 450, 250, 'pointerdown');
  assert.equal(down.defaultPrevented, undefined); h.drain();
  assert.equal(numeric(h.cards[0].layer, '--rx'), 0); assert.equal(numeric(h.cards[0].layer, '--lift'), 0);
  h.point(h.cards[0], 450, 250, 'pointerup'); h.drain();
  h.cards[0].emit('pointerleave'); h.tick();
  assert.ok(numeric(h.cards[0].layer, '--lift') < 0 && numeric(h.cards[0].layer, '--lift') > -5);
  h.drain(); assert.equal(numeric(h.cards[0].layer, '--lift'), 0);
  h.point(h.cards[0], 450, 250); h.tick(); h.window.emit('blur'); h.drain();
  assert.equal(numeric(h.cards[0].layer, '--ry'), 0); assert.equal(h.spot.classList.contains('is-on'), false);
});

test('motion off and live reduced-motion changes show all, stop, and resume from fresh time', () => {
  for (const preference of ['motion', 'reduced']) {
    const h = harness(); h.drain(); h.scroll(300); h.point(h.cards[0], 450, 250); h.tick();
    const set = value => preference === 'motion' ? h.root.setAttribute('data-motion', value ? 'off' : 'on') : h.reduced(value);
    set(true);
    assert.equal(h.frames.size, 0); assert.ok(h.cards.every(card => card.__rv === 1));
    assert.equal(h.spot.classList.contains('is-on'), false); assert.equal(numeric(h.cards[0].layer, '--lift'), 0);
    h.tick(100000); set(false); h.tick();
    assert.ok(h.cards[0].__rv > .8 && h.cards[0].__rv < 1, 'resume does not integrate hidden time');
    h.drain(); close(h.cards[0].__rv, 180 / 440);
  }
});

test('starting with motion disabled still installs listeners for later enablement', () => {
  const h = harness({motion: 'off'});
  assert.equal(h.frames.size, 0); assert.equal(h.cards[0].__rv, 1);
  h.root.setAttribute('data-motion', 'on'); h.drain(); assert.equal(h.cards[0].__rv, 0);
  h.point(h.cards[0], 450, 250); h.drain(); assert.equal(numeric(h.cards[0].layer, '--lift'), -5);
});

test('hidden pages cancel all animation and clear hover; foreground remeasures and resumes', () => {
  const h = harness(); h.drain(); h.scroll(300); h.point(h.cards[0], 450, 250); h.tick();
  const before = h.cards[0].__rv, reads = h.cards[0].offsetReads;
  h.visible(false); assert.equal(h.frames.size, 0); h.tick(200000);
  assert.equal(h.cards[0].__rv, before); assert.equal(numeric(h.cards[0].layer, '--lift'), 0);
  h.cards[0].top = 1050; h.visible(true); h.tick();
  assert.equal(h.cards[0].offsetReads, reads + 1); assert.ok(h.cards[0].__rv < .15);
  h.drain(); close(h.cards[0].__rv, 130 / 440);
});

test('compact/coarse/focus settings skip the spotlight and touch never starts tilt', () => {
  for (const options of [{compact: true}, {fine: false}]) {
    const h = harness(options); h.drain(); h.point(null, 500, 400);
    assert.equal(h.frames.size, 0); assert.equal(h.spot.classList.contains('is-on'), false);
  }
  const h = harness(); h.drain();
  h.point(h.cards[0], 450, 250, 'pointermove', 'touch'); assert.equal(h.frames.size, 0);
  h.point(h.cards[0], 450, 250); h.tick(); h.fine(false); h.drain();
  assert.equal(numeric(h.cards[0].layer, '--lift'), 0); assert.equal(h.spot.classList.contains('is-on'), false);
  h.fine(true); h.drain(); h.point(null, 450, 250); h.tick();
  assert.equal(h.spot.classList.contains('is-on'), true);
  h.root.setAttribute('data-performance', 'compact'); h.drain(); assert.equal(h.spot.classList.contains('is-on'), false);
  h.root.setAttribute('data-performance', 'full'); h.root.setAttribute('data-focus', 'on'); h.drain();
  h.point(h.cards[0], 450, 250); assert.equal(h.frames.size, 0);
});

test('changing tilt strength while hovering updates smoothly and never measures inactive cards', () => {
  const h = harness(); h.drain(); h.point(h.cards[0], 500, 200); h.drain();
  assert.equal(numeric(h.cards[0].layer, '--ry'), 6);
  h.theme.state.tilt = 0; h.theme.listeners.forEach(fn => fn()); h.tick();
  assert.ok(numeric(h.cards[0].layer, '--ry') > 0 && numeric(h.cards[0].layer, '--ry') < 6);
  h.drain(); assert.equal(numeric(h.cards[0].layer, '--ry'), 0);
  h.theme.state.tilt = 20; h.theme.listeners.forEach(fn => fn()); h.drain();
  assert.equal(numeric(h.cards[0].layer, '--ry'), 10); assert.equal(h.cards[1].rectReads, 0);
});

test('homepage content is wheel-locked: it appears over half a screen and never drifts on its own', () => {
  const h = harness({home: true}); h.drain();
  assert.equal(h.cards[0].__rv, 0);
  // 行程 vh*.52、起点 vh*.98：卡顶 1000、vh 1000 → (y - 20) / 520
  // 首页**不做时间阻尼**：第一帧就该等于滚动目标（阻尼会让卡片停下来之后还在自己爬）。
  h.scroll(170); h.tick();
  close(h.cards[0].__rv, (170 - 20) / 520, 1e-10);
  const middle = h.cards[0].__rv;
  assert.ok(middle > .2 && middle < .35, 'a card entering the viewport is only partly revealed');
  h.drain(); close(h.cards[0].__rv, middle, 1e-10);   // 不再自己往前走
  h.scroll(540); h.drain();
  assert.equal(h.cards[0].__rv, 1, 'text is fully shown before it reaches the middle of the viewport');
  h.scroll(170); h.tick();
  close(h.cards[0].__rv, middle, 1e-10);              // 反向也直接跟手

  h.scroll(0); h.drain(); assert.equal(h.cards[0].__rv, 0);
});

test('homepage desktop cascade stays inside one reveal step and phones have no index delay', () => {
  for (const width of [390, 700, 1200]) {
    const h = harness({home: true, width}); h.cards[1].top = h.cards[0].top;
    h.scroll(170); h.drain();
    const difference = h.cards[0].__rv - h.cards[1].__rv;
    if (width <= 700) close(difference, 0);
    else assert.ok(difference > 0 && difference < .1, 'same-row stagger does not leave readable cards dark');
    h.window.innerWidth = 390; h.window.emit('resize'); h.drain();
    close(h.cards[0].__rv, h.cards[1].__rv);
  }
});

test('homepage chapter and cards share elapsed time, writes, and idle clock at 30/60/120 Hz', () => {
  const snapshots = [30, 60, 120].map(hz => {
    const h = harness({home: true}); h.drain(); h.operations.length = 0;
    for (let n = 0; n < 50; n++) h.scroll(500);
    assert.equal(h.operations.length, 0, 'scroll handlers only schedule work');
    assert.equal(h.frames.size, 2, 'one progress-bar callback plus one shared animation callback');
    for (let n = 0; n < hz / 5; n++) h.tick(1000 / hz);
    const state = [h.cards[0].__rv, numeric(h.chapter, '--chapter-enter'), numeric(h.chapter, '--chapter-progress')];
    assert.ok(state[2] > 0 && state[2] < 1);
    // 卡片和章节走同一个时钟，但**不是同一条曲线**：卡片的行程是半屏多，
    // 章节的 enter/progress 各管各的（导轨节点与标题点亮）。这里只要求两者都在
    // 中间态、且跨刷新率一致 —— 相等与否是实现细节，不该被钉住。
    assert.ok(state[0] > 0 && state[0] < 1, 'cards keep an in-between value on the same clock');
    assert.ok(state[1] > 0 && state[1] <= 1);
    close(h.revealEvents.at(-1).chapters[1][0], state[1]);
    close(h.revealEvents.at(-1).chapters[1][1], state[2]);
    assert.equal(h.frames.size, 1, 'chapter has no second RAF loop');
    h.drain(); const writes = h.operations.length;
    for (let n = 0; n < 120; n++) h.tick(1000 / hz);
    assert.equal(h.frames.size, 0); assert.equal(h.operations.length, writes, 'settled chapters do not keep writing');
    return state;
  });
  for (const state of snapshots.slice(1)) state.forEach((value, i) => close(value, snapshots[0][i]));
});

test('homepage effects leave native wheel, touch scrolling and link activation alone', () => {
  const h = harness({home: true}); h.drain();
  const targets = [h.window, h.document, h.body, h.flow, h.chapter, ...h.cards];
  for (const target of targets) {
    assert.ok(target.listenerOptions.filter(item => item.type === 'scroll').every(item => item.options?.passive === true));
    assert.ok(!target.listenerOptions.some(item => ['wheel', 'mousewheel', 'touchmove', 'touchstart'].includes(item.type)));
  }
  const wheel = h.window.emit('wheel', {deltaY: 120}), click = h.cards[0].emit('click');
  assert.equal(wheel.defaultPrevented, undefined); assert.equal(click.defaultPrevented, undefined);
  assert.equal(h.frames.size, 0, 'wheel alone does not synthesize a scroll or an animation');
  h.scroll(170); h.tick(); assert.ok(h.cards[0].__rv > 0);
});

test('homepage chapter preferences show all and resume without integrating suspended time', () => {
  for (const preference of ['motion', 'reduced']) {
    const h = harness({home: true}); h.drain(); h.scroll(500); h.tick();
    const set = value => preference === 'motion' ? h.root.setAttribute('data-motion', value ? 'off' : 'on') : h.reduced(value);
    set(true); assert.equal(h.frames.size, 0);
    assert.ok(h.cards.every(card => card.__rv === 1));
    assert.ok(h.chapters.every(el => numeric(el, '--chapter-enter') === 1 && numeric(el, '--chapter-progress') === 1));
    h.tick(120000); set(false); h.tick();
    assert.ok(numeric(h.chapter, '--chapter-progress') > .8 && numeric(h.chapter, '--chapter-progress') < 1);
    h.drain(); assert.ok(numeric(h.chapter, '--chapter-progress') < .2);
    h.scroll(700); h.tick(); const before = numeric(h.chapter, '--chapter-progress');
    h.visible(false); assert.equal(h.frames.size, 0); h.tick(120000);
    assert.equal(numeric(h.chapter, '--chapter-progress'), before);
    h.chapter.top += 60; h.visible(true); h.tick();
    assert.ok(Math.abs(numeric(h.chapter, '--chapter-progress') - before) < .04, 'visibility return uses a fresh clock and layout');
    h.drain(); assert.equal(h.frames.size, 0);
  }
});

test('homepage bottom content becomes fully visible even when its top cannot reach the reveal threshold', () => {
  const h = harness({home: true}); h.root.scrollHeight = 2000;
  h.cards[0].top = 940; h.cards[1].top = 970; h.chapter.height = 1000;
  h.scroll(990); h.drain();
  assert.equal(h.cards[0].__rv, 0, 'short page tail has insufficient scroll range for the normal threshold');
  h.scroll(1000); h.drain();
  assert.ok(h.cards.every(card => card.__rv === 1));
  assert.equal(numeric(h.chapter, '--chapter-progress'), 1);
  h.scroll(990); h.drain(); assert.equal(h.cards[0].__rv, 0, 'bottom completion is not permanently latched');
});

test('keyboard focus wakes hidden homepage links, protects the focused card during reverse scroll, and releases on blur', () => {
  const h = harness({home: true}); h.drain();
  assert.equal(h.cards[0].__rv, 0);
  h.focus(h.cards[0].layer); assert.equal(h.frames.size, 1);
  h.tick(); assert.ok(h.cards[0].__rv > 0, 'focus schedules visibility without needing a scroll event');
  h.drain(); assert.equal(h.cards[0].__rv, 1); assert.equal(h.cards[1].__rv, 0);
  h.scroll(120); h.drain(); h.scroll(0); h.drain(); assert.equal(h.cards[0].__rv, 1);
  h.focus(h.cards[1].layer); h.drain();
  assert.equal(h.cards[0].__rv, 0); assert.equal(h.cards[1].__rv, 1);
  h.focus(null); h.drain(); assert.ok(h.cards.every(card => card.__rv === 0));
});

test('showing or hiding recent reading invalidates chapter positions once without layout reads during notification', () => {
  const h = harness({home: true}); h.scroll(300); h.drain();
  assert.equal(h.cards[0].__rv, 1); const reads = h.cards[0].offsetReads;
  h.recent.hidden = false; h.recent.height = 260; h.chapter.top += 260;
  h.operations.length = 0;
  for (let n = 0; n < 20; n++) h.resize(h.recent);
  assert.equal(h.frames.size, 1, 'the recent section itself is observed');
  assert.equal(h.operations.length, 0, 'ResizeObserver does not synchronously read layout');
  h.tick(); const firstWrite = h.operations.findIndex(op => op.kind === 'write');
  assert.ok(firstWrite > 0 && h.operations.slice(firstWrite).every(op => op.kind !== 'read'));
  h.drain(); assert.equal(h.cards[0].offsetReads, reads + 1); assert.equal(h.cards[0].__rv, 0);
  h.recent.hidden = true; h.chapter.top -= 260; h.resize(h.recent); h.drain();
  assert.equal(h.cards[0].offsetReads, reads + 2); assert.equal(h.cards[0].__rv, 1);
});

test('history page restoration resynchronizes layout and scroll targets without requiring a scroll event', () => {
  const h = harness({home: true}); h.scroll(500); h.drain();
  assert.equal(h.cards[0].__rv, 1);
  const reads = h.cards[0].offsetReads;
  // A restored page can receive pageshow after its scroll position and fonts change.
  h.window.pageYOffset = h.window.scrollY = 0; h.chapter.top = 950;
  h.window.emit('pageshow', {persisted: true});
  assert.equal(h.cards[0].offsetReads, reads, 'pageshow defers layout to the shared animation frame');
  h.tick(); assert.equal(h.cards[0].offsetReads, reads + 1);
  assert.ok(h.cards[0].__rv > .8 && h.cards[0].__rv < 1, 'restoration preserves the current progress while updating its target');
  h.drain(); assert.equal(h.cards[0].__rv, 0); assert.equal(numeric(h.chapter, '--chapter-progress'), 0);
  h.window.pageYOffset = h.window.scrollY = 1400;
  h.window.emit('pageshow', {persisted: false}); h.drain();
  assert.ok(h.cards.every(card => card.__rv === 1));
  assert.ok(numeric(h.chapter, '--chapter-progress') > .9);
  assert.equal(h.frames.size, 0);
});
