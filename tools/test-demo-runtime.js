/* Runs the actual serialized sandbox bootstrap in a deterministic browser stub. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../theme/static/js/demo.js'), 'utf8');
const outerEvents = {};
const outer = vm.createContext({
  window: { addEventListener(name, callback) { outerEvents[name] = callback; } },
  document: { readyState: 'loading', hidden: false, addEventListener() {} },
  console,
});
vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.testing={animationRuntime,sandboxDoc,sessions,sendActivity};})();'), outer);
const runtime = outer.testing.animationRuntime.toString();
let tests = 0;
function test(name, body) { body(); tests++; console.log('OK ' + name); }

function animationHarness() {
  const events = {}, documentEvents = {}, frames = new Map(), errors = [];
  let nextFrame = 0;
  const parent = {};
  const context = vm.createContext({
    parent, console,
    document: { hidden: false, addEventListener(name, callback) { documentEvents[name] = callback; } },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(name, callback) { events[name] = callback; },
    demo: {}, errors,
  });
  context.window = context;
  vm.runInContext('(' + runtime + ')(demo,"token",function(type,payload){errors.push({type,payload});});', context);
  return {
    context, frames, errors, events,
    active(value, source = parent, token = 'token') {
      events.message({ source, data: { __demoToken: token, type: 'activity', payload: { active: value } } });
    },
    tick(timestamp) {
      const pending = [...frames.values()]; frames.clear();
      pending.forEach(callback => callback(timestamp));
    },
    hidden(value) { context.document.hidden = value; documentEvents.visibilitychange(); },
    dispose(source = parent) { events.message({ source, data: { __demoToken: 'token', type: 'dispose' } }); },
  };
}

test('default paused; start is idempotent and pause cancels its RAF', () => {
  const h = animationHarness(); const samples = [];
  const loop = h.context.demo.animate(sample => samples.push(sample));
  h.active(true);
  assert.equal(h.frames.size, 0); assert.equal(loop.isRunning(), false);
  loop.start().start(); assert.equal(h.frames.size, 1);
  h.tick(100); assert.equal(samples.length, 1); assert.equal(samples[0].delta, 0);
  assert.equal(h.frames.size, 1);
  loop.pause(); assert.equal(loop.isRunning(), false); assert.equal(h.frames.size, 0);
});

test('clock uses seconds, limits delta and reset rewinds without running a callback', () => {
  const h = animationHarness(); const samples = [];
  const loop = h.context.demo.animate(sample => samples.push(sample));
  h.active(true); loop.start(); h.tick(100); h.tick(116); h.tick(1116);
  assert.equal(samples[1].delta, 0.016); assert.equal(samples[2].delta, 0.05);
  assert.equal(samples[2].time, 0.066);
  loop.reset(); assert.equal(samples.length, 3); assert.equal(h.frames.size, 0);
  loop.start(); h.tick(2000); assert.equal(samples[3].time, 0); assert.equal(samples[3].delta, 0);
});

test('offscreen and hidden frames pause computation and do not accumulate background time', () => {
  const h = animationHarness(); const samples = [];
  const loop = h.context.demo.animate(sample => samples.push(sample));
  h.active(true); loop.start(); h.tick(100); h.tick(120);
  h.active(false); assert.equal(h.frames.size, 0); assert.equal(loop.isRunning(), true);
  h.active(true); h.tick(10000); assert.equal(samples.at(-1).time, 0.02); assert.equal(samples.at(-1).delta, 0);
  h.hidden(true); assert.equal(h.frames.size, 0);
  h.hidden(false); h.tick(20000); assert.equal(samples.at(-1).time, 0.02);
  loop.pause(); h.active(false); h.active(true); assert.equal(h.frames.size, 0);
});

test('activity and disposal messages require both parent source and matching token', () => {
  const h = animationHarness(); const loop = h.context.demo.animate(() => {});
  loop.start(); h.active(true, {}); h.active(true, h.context.parent, 'wrong');
  assert.equal(h.frames.size, 0);
  h.active(true); assert.equal(h.frames.size, 1);
  h.dispose({}); assert.equal(h.frames.size, 1);
  h.dispose(); assert.equal(h.frames.size, 0); assert.equal(loop.isRunning(), false);
  loop.start(); assert.equal(h.frames.size, 0);
});

test('callback false and callback errors stop the loop', () => {
  const h = animationHarness(); h.active(true);
  const done = h.context.demo.animate(() => false).start(); h.tick(0);
  assert.equal(done.isRunning(), false); assert.equal(h.frames.size, 0);
  const bad = h.context.demo.animate(() => { throw new Error('expected failure'); }).start(); h.tick(1);
  assert.equal(bad.isRunning(), false); assert.equal(h.frames.size, 0);
  assert.equal(h.errors.length, 1); assert.match(h.errors[0].payload.text, /expected failure/);
  assert.throws(() => h.context.demo.animate(null), /回调/);
});

function sandboxHarness(payload, resizeSupported = true) {
  const doc = outer.testing.sandboxDoc(payload, 'frame-token', ':root{}');
  const script = doc.match(/<script>([\s\S]*)<\/script>/)[1];
  const events = {}, messages = [], intervals = new Map(), observers = [];
  let id = 0, context;
  const root = { children: [], getBoundingClientRect() { return { height: 108 }; } };
  Object.defineProperty(root, 'innerHTML', { set(value) { this.children = value ? [{}] : []; } });
  const parent = { postMessage(message) { messages.push(message); } };
  const globals = {
    parent, messages, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    document: { hidden: false, addEventListener() {},
      getElementById(name) { return name === 'demo-root' ? root : { textContent: JSON.stringify(payload) }; },
      createElement(tagName) { return { tagName }; },
      body: { appendChild(element) { if (element.tagName === 'script') vm.runInContext(element.textContent, context); } },
    },
    addEventListener(name, callback) { (events[name] ||= []).push(callback); },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    setInterval(callback) { const key = ++id; intervals.set(key, callback); return key; },
    clearInterval(key) { intervals.delete(key); },
  };
  if (resizeSupported) globals.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  };
  context = vm.createContext(globals); context.window = context;
  vm.runInContext(script, context);
  return { context, root, intervals, observers, messages,
    dispose(source = parent) {
      for (const receive of events.message || []) receive({ source, data: { __demoToken: 'frame-token', type: 'dispose' } });
    } };
}

test('generated JS sandbox still executes explicit code, exposes animate and uses ResizeObserver without polling', () => {
  const h = sandboxHarness({ lang: 'js', code: 'demo.root.innerHTML="<p>Hello</p>"; demo.log("hello"); window.loop=demo.animate(function(){return false;});' });
  assert.equal(typeof h.context.demo.animate, 'function'); assert.equal(h.context.loop.isRunning(), false);
  assert.equal(h.intervals.size, 0); assert.equal(h.observers.length, 1); assert.equal(h.observers[0].element, h.root);
  assert.ok(h.messages.some(m => m.type === 'log' && m.payload.text === 'hello'));
  assert.ok(h.messages.some(m => m.type === 'done' && m.payload.ok));
  assert.ok(h.messages.some(m => m.type === 'height' && m.payload.h === 136));
  h.dispose(); assert.equal(h.observers[0].disconnected, true);
});

test('HTML remains supported; legacy size polling is only a fallback and cleans up securely', () => {
  const h = sandboxHarness({ lang: 'html', code: '<p>Example</p>' }, false);
  assert.equal(h.root.children.length, 1); assert.equal(h.intervals.size, 1);
  h.dispose({}); assert.equal(h.intervals.size, 1);
  h.dispose(); assert.equal(h.intervals.size, 0);
});

test('parent rejects forged sandbox start messages before transmitting activity', () => {
  const controls = []; const frameWindow = { postMessage: message => controls.push(message) };
  const frame = { contentWindow: frameWindow };
  const state = { frame, token: 'parent-token', visible: true, lastActive: null };
  outer.testing.sessions['parent-token'] = { frame, state, panel: { querySelector() { return null; } } };
  const message = { __demoToken: 'parent-token', type: 'start' };
  outerEvents.message({ source: {}, data: message }); assert.equal(controls.length, 0);
  outerEvents.message({ source: frameWindow, data: { ...message, __demoToken: 'unknown' } }); assert.equal(controls.length, 0);
  outerEvents.message({ source: frameWindow, data: message }); assert.equal(controls.length, 1);
  assert.equal(controls[0].payload.active, true);
  outer.document.hidden = true; outer.testing.sendActivity(state);
  assert.equal(controls.at(-1).payload.active, false);
});

console.log(`${tests} demo runtime regressions passed.`);
