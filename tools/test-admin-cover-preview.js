/* Cover picker regressions use the real click handlers with an isolated DOM. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const nodes = new Map(), documentEvents = new Map(), timers = new Map(), requests = [];
let timerId = 0;
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {
    value: '', hidden: true, textContent: '', style: {}, events: {},
    addEventListener(name, callback) { this.events[name] = callback; },
    setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; }
  });
  return nodes.get(id);
}
const context = vm.createContext({
  console, Math, Date, JSON, Promise,
  setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
  document: {
    readyState: 'loading', getElementById: node,
    addEventListener(name, callback) { documentEvents.set(name, callback); }
  },
  window: { addEventListener() {} },
  fetch(url, options) {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Promise(() => {}); // Inspect the outgoing request without a server.
  }
});
const source = fs.readFileSync(path.join(__dirname, '../theme/admin/admin.js'), 'utf8');
vm.runInContext(source.replace("  if (document.readyState === 'loading')", `
  window.test = { S, bind };
  if (document.readyState === 'loading')`), context);
const { S, bind } = context.window.test;
bind();
S.imgTarget = { key: 'cover' };
S.pick = { path: 'assets/uploads/封面.webp' };
node('body').value = 'Original body';

function flushPreview(kind) {
  const pending = [...timers.entries()].filter(([, value]) => value.delay === 300);
  assert.equal(pending.length, 1, 'cover action schedules exactly one preview update');
  timers.delete(pending[0][0]);
  pending[0][1].callback();
  assert.equal(requests.at(-1).url, '/api/preview');
  assert.equal(requests.at(-1).body.kind, kind);
  assert.equal(requests.at(-1).body.body, 'Original body');
}

for (const kind of ['post', 'project', 'page']) {
  S.cur = { kind, front: { title: 'Cover fixture', slug: kind === 'page' ? 'lab' : 'fixture' } };
  node('imgPreviewUse').events.click();
  assert.equal(S.cur.front.cover, S.pick.path);
  assert.equal(S.dirty, true);
  flushPreview(kind);
  assert.equal(requests.at(-1).body.front.cover, S.pick.path,
    'choosing a cover updates the preview without typing in another field');

  documentEvents.get('click')({ target: {
    closest(selector) { return selector === '[data-act]' ? this : null; },
    getAttribute() { return 'clear-cover'; }
  } });
  flushPreview(kind);
  assert.equal(requests.at(-1).body.front.cover, '',
    'clearing the cover removes it from the next preview request');
  assert.equal(node('coverThumb').style.backgroundImage, '');
  assert.equal(S.dirty, true);
}
assert.equal(requests.length, 6, 'cover changes request previews without saving or building');
console.log('Post, project and standalone page covers refresh on selection and clearing without unrelated edits.');
