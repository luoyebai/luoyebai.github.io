/* Exercise the real admin preview closure with deferred API replies and a frame bridge stub. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(kind = 'post') {
  const nodes = new Map(), requests = [], frames = [], updates = [], syncs = [], timers = new Map();
  let timerID = 0;
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set(), attrs = {};
      nodes.set(id, {
        id, value: '', textContent: '', innerHTML: '', hidden: false, checked: false,
        disabled: false, scrollLeft: 0, scrollTop: 0, selectionStart: 3, selectionEnd: 5,
        classList: {
          add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
          toggle(name, on) { on = on === undefined ? !classes.has(name) : on; on ? classes.add(name) : classes.delete(name); },
          contains(name) { return classes.has(name); }
        },
        setAttribute(name, value) { attrs[name] = String(value); },
        getAttribute(name) { return attrs[name]; },
        focus() { document.activeElement = this; }, blur() { if (document.activeElement === this) document.activeElement = null; }
      });
    }
    return nodes.get(id);
  }
  const document = { readyState: 'loading', activeElement: null, addEventListener() {},
    getElementById: node, querySelector: node, querySelectorAll: () => [] };
  const sandbox = {
    document, testBlocks: [{sep: '', text: '# A\n\nText\n', startLine: 1}],
    testFront: {title: 'Current title'},
    setTimeout(fn) { const id = ++timerID; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, opts) {
      return new Promise(resolve => requests.push({url, opts, reply(data, status = 200) {
        resolve({ok: status < 400, status, text: async () => JSON.stringify(data)});
      }}));
    },
    window: {BlogPreview: {
      splitSlides: () => sandbox.testBlocks.map(block => ({...block})),
      render(container, data, options) { frames.push({container, data, options}); },
      update(data) { updates.push({...data}); },
      syncSource(textarea, line) { syncs.push({textarea, line}); textarea.scrollTop = line * 20; }
    }}
  };
  const source = fs.readFileSync(path.join(__dirname, '../theme/admin/admin.js'), 'utf8');
  const marker = "  if (document.readyState === 'loading')";
  assert.ok(source.includes(marker));
  const hooks = `
    globalThis.adminPreview = {S, schedulePreview, doPreview, followPreview,
      renderDeckPreview, paintDeckPreview, deckStep, renderSlideEditor, slideOperation};
    collectFront = function () {return JSON.parse(JSON.stringify(globalThis.testFront));};
  `;
  vm.runInNewContext(source.replace(marker, hooks + marker), sandbox);
  const api = sandbox.adminPreview;
  api.S.cur = {kind, slug: 'current', front: sandbox.testFront};
  api.S.previewSession = 1;
  api.S.slideIndex = 0;
  api.S.slideSource = false;
  api.S.dirty = false;
  node('body').value = '# A\n\nText\n';
  node('previewSync').checked = true;
  node('previewError').hidden = true;
  return {api, sandbox, document, node, requests, frames, updates, syncs, timers};
}

function post(html) { return {ok: true, html, chars: 10, minutes: 1}; }
function slide(blockIndex, fragments = 0) {
  return {blockIndex, html: '<h2>Block ' + blockIndex + '</h2>' + '<div class="deck-fragment">Step</div>'.repeat(fragments)};
}
function deck(slides) { return {ok: true, deck: true, slides, count: slides.length, minutes: 1}; }
function deckFixture(t, blank = true) {
  t.sandbox.testBlocks = [
    {sep: '', text: '# A\n\nText\n', startLine: 1},
    {sep: '----\n', text: blank ? '\n' : '## B\n\nMore\n', startLine: 6},
    {sep: '----\n', text: '## C\n\nLast\n', startLine: 11}
  ];
  t.node('body').value = t.sandbox.testBlocks.map((b, i) => (i ? b.sep : '') + b.text).join('');
  t.api.S.previewBody = t.node('body').value;
  const data = deck(blank ? [slide(0, 2), slide(2, 1)] : [slide(0, 2), slide(1), slide(2, 1)]);
  t.api.S.previewData = data;
  t.api.renderDeckPreview(data);
  return data;
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const cases = [];
function check(name, fn) { cases.push({name, fn}); }

check('latest preview response wins even when requests complete out of order', async () => {
  const t = setup();
  t.api.doPreview();
  assert.equal(JSON.parse(t.requests[0].opts.body).front.title, 'Current title');
  t.node('body').value = '# Updated';
  t.api.schedulePreview();
  t.api.doPreview();
  t.requests[1].reply(post('<h1>Updated</h1>'));
  await settle();
  t.requests[0].reply(post('<h1>Stale</h1>'));
  await settle();
  assert.equal(t.frames.length, 1);
  assert.match(t.frames[0].data.html, /Updated/);
  assert.equal(t.api.S.previewBody, '# Updated');
  t.frames[0].options.onReady();
  assert.equal(t.node('preview').getAttribute('aria-busy'), 'false');
});

check('debounced metadata edits invalidate pending responses before the next fetch starts', async () => {
  const t = setup();
  t.api.doPreview();
  t.sandbox.testFront.title = 'New title, same Markdown';
  t.api.schedulePreview();
  t.requests[0].reply(post('<h1>Old title</h1>'));
  await settle();
  assert.equal(t.frames.length, 0);
  assert.equal(t.requests.length, 1);
});

check('preview responses from the previous document are ignored even for identical body text', async () => {
  const t = setup();
  t.api.doPreview();
  t.api.S.cur = {kind: 'post', slug: 'another-document'};
  t.requests[0].reply(post('<p>Previous document</p>'));
  await settle();
  assert.equal(t.frames.length, 0);
});

check('latest errors remain visible, then successful retry clears them', async () => {
  const t = setup();
  t.api.doPreview();
  t.api.doPreview();
  t.requests[1].reply({ok: false, error: 'Preview unavailable'}, 500);
  await settle();
  t.requests[0].reply(post('Stale success'));
  await settle();
  assert.equal(t.node('previewError').hidden, false);
  assert.match(t.node('previewError').textContent, /Preview unavailable/);
  assert.equal(t.frames.length, 0);
  t.api.doPreview();
  t.requests[2].reply(post('Recovered'));
  await settle();
  assert.equal(t.node('previewError').hidden, true);
  assert.equal(t.frames.length, 1);
});

check('right-side article scrolling syncs position without changing text, dirty flag, caret or focus', () => {
  const t = setup();
  t.api.S.previewBody = t.node('body').value;
  t.document.activeElement = t.node('body');
  const body = t.node('body').value;
  [false, true].forEach(dirty => {
    t.api.S.dirty = dirty;
    t.api.followPreview({line: 8, blockIndex: null});
    assert.equal(t.api.S.dirty, dirty);
  });
  assert.equal(t.syncs[0].textarea.id, 'body');
  assert.equal(t.syncs[0].line, 8);
  assert.equal(t.node('body').value, body);
  assert.equal(t.node('body').selectionStart, 3);
  assert.equal(t.node('body').selectionEnd, 5);
  assert.equal(t.document.activeElement, t.node('body'));
  t.node('previewSync').checked = false;
  t.api.followPreview({line: 9});
  assert.equal(t.syncs.length, 2);
  t.node('previewSync').checked = true;
  t.node('body').value += 'Pending edit';
  t.api.followPreview({line: 9});
  assert.equal(t.syncs.length, 2, 'Stale preview must not scroll newer source');
});

check('read-all scroll maps raw block indices through blank pages and retains read-only editor state', () => {
  const t = setup('doc');
  deckFixture(t);
  t.api.S.deck.all = true;
  t.api.S.dirty = true;
  t.document.activeElement = t.node('slideBody');
  const body = t.node('body').value;
  t.api.followPreview({line: 14, blockIndex: 2});
  assert.equal(t.api.S.slideIndex, 2);
  assert.equal(t.api.S.deck.cur, 1, 'Rendered index must follow the selected raw block');
  assert.equal(t.node('slideBody').value, t.sandbox.testBlocks[2].text);
  assert.equal(t.syncs[0].textarea.id, 'slideBody');
  assert.equal(t.syncs[0].line, 4);
  assert.equal(t.node('body').value, body);
  assert.equal(t.api.S.dirty, true);
  assert.equal(t.document.activeElement, t.node('slideBody'));
  assert.equal(t.node('slideBody').selectionStart, 3);
  t.api.S.slideSource = true;
  t.api.followPreview({line: 14, blockIndex: 2});
  assert.equal(t.syncs[1].textarea.id, 'body');
  assert.equal(t.syncs[1].line, 14);
});

check('PPT steps reveal before page advance and reverse steps before previous-page advance', () => {
  const t = setup('doc');
  deckFixture(t);
  const body = t.node('body').value;
  t.api.deckStep(1);
  assert.equal(t.api.S.deck.cur, 0);
  assert.equal(t.api.S.deck.step, 1);
  t.api.deckStep(1);
  assert.equal(t.api.S.deck.step, 2);
  t.api.deckStep(1);
  assert.equal(t.api.S.deck.cur, 1);
  assert.equal(t.api.S.slideIndex, 2);
  assert.equal(t.api.S.deck.step, 0);
  t.api.deckStep(1);
  assert.equal(t.api.S.deck.step, 1);
  t.api.deckStep(-1);
  assert.equal(t.api.S.deck.cur, 1);
  assert.equal(t.api.S.deck.step, 0);
  t.api.deckStep(-1);
  assert.equal(t.api.S.deck.cur, 0);
  assert.equal(t.api.S.slideIndex, 0);
  assert.equal(t.api.S.deck.step, 2);
  assert.equal(t.node('body').value, body);
  assert.equal(t.api.S.dirty, false);
});

check('blank PPT pages navigate to their real preceding and following source blocks', () => {
  const t = setup('doc');
  const data = deckFixture(t);
  t.api.S.slideIndex = 1;
  t.api.renderDeckPreview(data);
  assert.equal(t.api.S.deck.cur, -1);
  assert.equal(t.node('[data-act="deck-prev"]').disabled, false);
  assert.equal(t.node('[data-act="deck-next"]').disabled, false);
  t.api.deckStep(1);
  assert.equal(t.api.S.slideIndex, 2);
  t.api.S.slideIndex = 1;
  t.api.renderDeckPreview(data);
  t.api.deckStep(-1);
  assert.equal(t.api.S.slideIndex, 0);
  assert.equal(t.api.S.deck.step, 2);
});

check('stale rendered pages cannot navigate into deleted source blocks', () => {
  const t = setup('doc');
  deckFixture(t);
  t.api.S.deck.step = 2;
  t.node('body').value = '# Only remaining page';
  t.sandbox.testBlocks = [{sep: '', text: '# Only remaining page', startLine: 1}];
  assert.doesNotThrow(() => t.api.deckStep(1));
  assert.equal(t.api.S.slideIndex, 0);
  assert.equal(t.api.S.deck.cur, 0);
});

check('removing fragment markers clamps reveal count and a wholly blank deck disables navigation', () => {
  const t = setup('doc');
  deckFixture(t);
  t.api.S.deck.step = 2;
  t.api.renderDeckPreview(deck([slide(0)]));
  assert.equal(t.api.S.deck.step, 0);
  assert.equal(t.node('[data-act="deck-next"]').disabled, true);
  t.api.renderDeckPreview(deck([]));
  assert.equal(t.node('[data-act="deck-prev"]').disabled, true);
  assert.equal(t.node('[data-act="deck-next"]').disabled, true);
  assert.doesNotThrow(() => t.api.deckStep(1));
});

check('filling a blank page in full-source mode makes that page appear in the preview', () => {
  const t = setup('doc');
  const data = deckFixture(t);
  t.api.S.slideIndex = 1;
  t.api.renderDeckPreview(data);
  assert.equal(t.api.S.deck.cur, -1);
  t.api.S.slideSource = true;
  t.api.renderDeckPreview(deck([slide(0, 2), slide(1), slide(2, 1)]));
  assert.equal(t.api.S.deck.cur, 1);
});

(async () => {
  let failed = 0;
  for (const {name, fn} of cases) {
    try { await fn(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(cases.length - failed + '/' + cases.length + ' admin preview integration regressions passed');
  if (failed) process.exitCode = 1;
})();
