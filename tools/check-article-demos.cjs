// Execute the actual article's JS with a small DOM/canvas stub; assert numerical output.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const markdown = fs.readFileSync(path.join(__dirname, '../content/posts/runnable-demos.md'), 'utf8');
const blocks = [];
let fence = '', runnable = false, lines = [];
for (const line of markdown.split(/\r?\n/)) {
  if (!fence) {
    const match = line.match(/^(`{3,})(.*)$/);
    if (match) { fence = match[1]; runnable = match[2].trim() === 'js run'; lines = []; }
  } else if (line.trim() === fence) {
    if (runnable) blocks.push(lines.join('\n'));
    fence = '';
  } else lines.push(line);
}
assert.equal(blocks.length, 3);
const handlers = {};
const elements = {};
const canvas = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' ? () => ({addColorStop(){}}) : () => {}, set: () => true });
function element(id = '') {
  return { value: id === '#z' ? '.4' : '7', textContent: '', style: {},
    appendChild(){}, getContext(){return canvas;},
    querySelector(key){ return elements[key] ||= element(key); },
    addEventListener(event, fn){handlers[id + ':' + event] = fn;} };
}
const logs = [];
const context = { document: {createElement: element}, demo: {root: element()},
  console: {log: (...args) => logs.push(args.join(' ')), warn(){}, error(){}} };
blocks.forEach(code => vm.runInNewContext(code, {...context}, {timeout: 1000}));
assert(logs.some(line => line.includes('合计 800 µs')));
assert.match(elements['#out'].textContent, /超调 25\.4%/);
elements['#z'].value = '2';
handlers['#z:input']();
assert.match(elements['#out'].textContent, /超调 0\.0%/);
elements['#z'].value = '1';
elements['#w'].value = '7';
handlers['#w:input']();
// Critically damped continuous solution: (1 + wn*t) exp(-wn*t) = .02 at t≈.8334 s.
const settling = Number(elements['#out'].textContent.match(/调节时间 ([\d.]+)/)[1]);
assert(Math.abs(settling - .8334) < .02);
console.log('3 article demos executed; budget, overshoot and settling time passed.');
