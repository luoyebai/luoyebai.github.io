/* Syntax and state-machine checks for the seven examples in runnable-demos.md. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const markdown = fs.readFileSync(path.join(__dirname, '../content/posts/runnable-demos.md'), 'utf8');
function runnableBlocks(text) {
  const result = []; let fence = null, runnable = false, body = [];
  for (const line of text.split(/\r?\n/)) {
    if (!fence) {
      const match = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*(.*)$/.exec(line);
      if (match) { fence = match[1]; runnable = /^(js|javascript|mjs)$/.test(match[2]) && /\brun\b/.test(match[3]); body = []; }
    } else if (new RegExp('^\\s*' + fence[0] + '{' + fence.length + ',}\\s*$').test(line)) {
      if (runnable) result.push(body.join('\n'));
      fence = null;
    } else body.push(line);
  }
  return result;
}
const examples = runnableBlocks(markdown);
assert.equal(examples.length, 7, 'The tutorial must contain seven active JavaScript examples, excluding its quoted Markdown tutorial.');
examples.forEach((source, index) => new vm.Script(source, { filename: `example-${index + 1}.js` }));

function runExample(index, exposed) {
  const nodes = new Map(), controllers = [];
  const paint = new Proxy({}, { get(target, name) {
    if (name in target) return target[name];
    if (name === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  } });
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.style = {}; this.children = []; this.value = ''; this.classList = { toggle() {}, add() {}, remove() {} }; this.width = 640; this.height = 230; }
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
        const node = new Element(match[1]);
        const value = /\bvalue="([^"]*)"/.exec(match[2]);
        if (value) node.value = value[1];
        nodes.set(match[3], node);
      }
    }
    get innerHTML() { return this.html || ''; }
    set textContent(text) { this.text = text; this.children = []; }
    get textContent() { return this.text || ''; }
    appendChild(child) { this.children.push(child); return child; }
    querySelector(selector) { const found = nodes.get(selector.replace(/^#/, '')); assert.ok(found, `Missing mock selector ${selector}`); return found; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, handler) { this['on' + name] = handler; }
    getContext() { return paint; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
    setPointerCapture() {}
    hasPointerCapture() { return false; }
    focus() {}
  }
  const root = new Element();
  const demo = { root, animate(callback) {
    let playing = false, time = 0;
    const controller = {
      start() { playing = true; }, pause() { playing = false; }, reset() { playing = false; time = 0; },
      isRunning() { return playing; },
      tick(delta) { if (!playing) return; delta = Math.min(delta, 0.05); time += delta; if (callback({ time, delta }) === false) playing = false; }
    };
    controllers.push(controller); return controller;
  } };
  const context = vm.createContext({ demo, document: { createElement: tag => new Element(tag) }, window: { addEventListener() {} }, console });
  vm.runInContext(examples[index] + '\nglobalThis.EXPOSED = {' + exposed + '};', context, { timeout: 1000 });
  assert.equal(controllers.length, 1);
  assert.equal(controllers[0].isRunning(), false, `Example ${index + 1} must wait for a start action.`);
  return { api: context.EXPOSED, nodes, loop: controllers[0] };
}

const ease = runExample(3, 'easeAt,coordinate,readProgress:()=>progress');
assert.equal(ease.api.easeAt(0, 0.25, 0.1, 0.25, 1), 0);
assert.equal(ease.api.easeAt(1, 0.25, 0.1, 0.25, 1), 1);
for (const time of [0.1, 0.3, 0.5, 0.8]) assert.ok(Math.abs(ease.api.easeAt(time, 0.25, 0.25, 0.75, 0.75) - time) < 0.000001);
assert.ok(ease.api.easeAt(0.8, 0.3, 1.5, 0.7, 1.5) > 1, 'Vertical control points can create overshoot.');
ease.nodes.get('ease-start').onclick();
for (let i = 0; i < 100; i++) ease.loop.tick(0.05);
assert.equal(ease.api.readProgress(), 1);
assert.equal(ease.loop.isRunning(), false, 'A completed animation stops requesting frames.');
ease.nodes.get('ease-reset').onclick();
assert.equal(ease.api.readProgress(), 0);
assert.equal(ease.loop.isRunning(), false);

const spring = runExample(4, 'integrateSpring,state');
const model = { x: 0, v: 0, target: 0.7 };
for (let i = 0; i < 480; i++) spring.api.integrateSpring(model, 1 / 120, 6, 0.9);
assert.ok(Math.abs(model.x - 0.7) < 0.001 && Math.abs(model.v) < 0.002, 'Damped tracking converges.');
spring.nodes.get('spring-start').onclick();
for (let i = 0; i < 300; i++) spring.loop.tick(1 / 60);
assert.ok(spring.api.state.trail.length <= 80, 'Trails have a fixed memory bound.');
for (let i = 0; i < 20; i++) spring.nodes.get('spring-kick').onclick();
assert.ok(spring.api.state.v <= 3, 'Repeated impulses remain bounded.');
spring.nodes.get('spring-reset').onclick();
assert.equal(spring.api.state.x, 0.18);
assert.equal(spring.api.state.trail.length, 0);
assert.equal(spring.loop.isRunning(), false);

const flight = runExample(5, 'newFlight,collides,flightScore,stepFlight,getGame:()=>game');
const { newFlight, collides, flightScore, stepFlight } = flight.api;
assert.equal(collides(320, { x: 337, y: 204, radius: 8 }), true);
assert.equal(collides(320, { x: 340, y: 204, radius: 8 }), false);
let ship = newFlight(); ship.mode = 'running'; ship.spawn = 999;
ship.rocks.push({ x: 320, y: 204, radius: 8, speed: 0 });
stepFlight(ship, 1 / 60, 0, null);
assert.equal(ship.lives, 2);
ship.rocks.push({ x: 320, y: 204, radius: 8, speed: 0 });
stepFlight(ship, 1 / 60, 0, null);
assert.equal(ship.lives, 2, 'Temporary shield prevents consecutive hits.');
ship = newFlight(); ship.mode = 'running'; ship.spawn = 999; ship.lives = 1;
ship.rocks.push({ x: 320, y: 204, radius: 8, speed: 0 });
stepFlight(ship, 1 / 60, 0, null);
assert.equal(ship.mode, 'lost');
ship = newFlight(); ship.mode = 'running'; ship.spawn = 999; ship.elapsed = 44.99;
stepFlight(ship, 0.05, 0, null);
assert.equal(ship.mode, 'won'); assert.equal(ship.elapsed, 45);
ship = newFlight(); ship.mode = 'running'; ship.spawn = 999;
ship.rocks.push({ x: 40, y: 250, radius: 8, speed: 0 });
stepFlight(ship, 1 / 60, 0, null);
assert.equal(ship.dodged, 1); assert.equal(flightScore(ship), 25);
ship.x = 625; stepFlight(ship, 0.05, 1, null); assert.equal(ship.x, 625);
ship.mode = 'paused'; const time = ship.elapsed; stepFlight(ship, 0.05, 1, null); assert.equal(ship.elapsed, time);
flight.nodes.get('orbit-start').onclick(); flight.nodes.get('orbit-pause').onclick();
assert.equal(flight.api.getGame().mode, 'paused'); assert.equal(flight.loop.isRunning(), false);
flight.nodes.get('orbit-reset').onclick(); assert.equal(flight.api.getGame().lives, 3); assert.equal(flight.api.getGame().elapsed, 0);

const memory = runExample(6, 'shuffledPairs,newMemory,chooseCard,tickMemory,getGame:()=>game');
const { shuffledPairs, newMemory, chooseCard, tickMemory } = memory.api;
const cards = shuffledPairs(() => 0.4);
assert.equal(cards.length, 16);
for (let value = 0; value < 8; value++) assert.equal(cards.filter(card => card === value).length, 2);
let round = newMemory(); round.cards = Array.from({ length: 16 }, (_, i) => Math.floor(i / 2));
assert.equal(chooseCard(round, 0), false, 'Idle games do not reveal cards.');
round.mode = 'running';
assert.equal(chooseCard(round, 0), true); assert.equal(chooseCard(round, 0), false);
assert.equal(chooseCard(round, 2), true); assert.equal(round.moves, 1);
assert.equal(chooseCard(round, 3), false, 'Mismatched cards lock input until hidden.');
assert.equal(tickMemory(round, 0.7), false); assert.equal(round.opened.length, 2);
round.mode = 'paused'; tickMemory(round, 10); assert.equal(round.time, 0.7);
round.mode = 'running'; assert.equal(tickMemory(round, 0.11), true); assert.equal(round.opened.length, 0);
round = newMemory(); round.cards = Array.from({ length: 16 }, (_, i) => Math.floor(i / 2)); round.mode = 'running';
for (let i = 0; i < 16; i += 2) { chooseCard(round, i); chooseCard(round, i + 1); }
assert.equal(round.mode, 'won'); assert.equal(round.moves, 8); assert.equal(round.matched.size, 16);
memory.nodes.get('memory-start').onclick(); memory.loop.tick(0.05); memory.nodes.get('memory-pause').onclick();
assert.equal(memory.api.getGame().mode, 'paused'); assert.equal(memory.loop.isRunning(), false);
memory.nodes.get('memory-reset').onclick(); assert.equal(memory.api.getGame().moves, 0); assert.equal(memory.api.getGame().time, 0);
assert.equal(memory.loop.isRunning(), false);

console.log('Seven JS blocks compile; four demos start paused; easing, spring, collision/shield/scoring, win/loss, memory matching/locking, pause and reset regressions passed.');
