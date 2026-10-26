/* Pure logic and iframe boundary regressions; no browser or real content writes. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const listeners = {}, opened = [], sent = [];
let created = 0;
const browser = {
  location: { origin: 'http://127.0.0.1:4200' },
  document: {
    createElement(tag) {
      assert.equal(tag, 'iframe');
      created += 1;
      return { style: {}, attributes: {}, contentWindow: { postMessage: (data, origin) => sent.push({ data, origin }) },
        setAttribute(name, value) { this.attributes[name] = value; } };
    }
  },
  addEventListener(name, handler) { listeners[name] = handler; },
  open(...args) { opened.push(args); }
};
const context = vm.createContext({ window: browser, URL, Uint32Array, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../theme/admin/preview.js'), 'utf8'), context);
const api = browser.BlogPreview;
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function join(blocks) { return blocks.map(block => block.sep + block.text).join(''); }
function config(frame) { return JSON.parse(frame.srcdoc.match(/window\.PREVIEW_CONFIG=(.*?);<\/script>/)[1]); }
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('ok - ' + name); }

test('page splitting preserves exact separators, empty pages and Windows newlines', () => {
  const text = '\r\n---\r\n# A\r\n----\r\n\r\n++++\r\n';
  const blocks = api.splitSlides(text);
  assert.equal(join(blocks), text);
  assert.deepEqual(plain(blocks.map(block => block.startLine)), [1, 3, 5, 7]);
  assert.deepEqual(plain(api.splitSlides('')), [{ sep: '', text: '', startLine: 1 }]);
  assert.equal(join(api.splitSlides('---')), '---');
  assert.equal(api.splitSlides('---').length, 2);
});

test('fenced separators follow the deck parser, including long and mixed fences', () => {
  const text = '# A\n````text\n---\n```\n++++\n~~~~\n--\n````\n----\n# B\n~~~text\n---\n~~~\n++++\n# C';
  const blocks = api.splitSlides(text);
  assert.equal(join(blocks), text);
  assert.equal(blocks.length, 3);
  assert.deepEqual(plain(blocks.map(block => block.startLine)), [1, 10, 15]);
  assert.equal(api.splitSlides('# A\n```text\n---\n# remains code').length, 1);
  assert.equal(api.splitSlides('# A\n--\n# same slide').length, 1);
});

const container = { appendChild(frame) { frame.parentNode = this; this.frame = frame; } };
const response = {
  front: { title: 'Title </script><b>', summary: 'Summary <x>', tags: ['<tag>'], cover: '/assets/cover.webp' },
  html: '<h2 data-source-line="10" data-source-end="10">A</h2>',
  previewAssets: {
    styles: ['/preview-assets/site.css'], mathStyle: '/preview-assets/katex.css',
    mathScripts: ['/preview-assets/katex.js'], scripts: ['/preview-assets/runtime/site.js', '/preview-assets/runtime/math.js'],
    siteBase: 'http://127.0.0.1:4201/'
  },
  previewTheme: { theme: 'bocchi', mode: 'light', font: 'sans' }
};
let scrollEvents = [], ready = 0;
const opts = { key: 'post/a', index: 0, all: false, step: 0,
  onScroll: value => scrollEvents.push(value), onReady: () => ready++ };
let frame, firstToken;

test('preview uses blog assets and markup inside an opaque reusable frame', () => {
  frame = api.render(container, response, opts);
  assert.equal(frame.title, '博客实时预览');
  assert.equal(frame.attributes.sandbox, 'allow-scripts');
  assert.ok(frame.srcdoc.includes('class="prose"'));
  assert.ok(frame.srcdoc.includes('data-theme="bocchi"'));
  assert.ok(frame.srcdoc.includes('<base href="http://127.0.0.1:4200/">'));
  assert.ok(frame.srcdoc.includes('http://127.0.0.1:4200/preview-assets/site.css'));
  assert.ok(frame.srcdoc.includes('Title &lt;/script&gt;&lt;b&gt;'));
  assert.ok(frame.srcdoc.indexOf('katex.js') < frame.srcdoc.indexOf('runtime/math.js'));
  assert.ok(frame.srcdoc.indexOf('runtime/math.js') < frame.srcdoc.indexOf('/admin/preview-frame.js'));
  firstToken = config(frame).token;
});

test('messages require the active frame and token, then keep source line on refresh', () => {
  listeners.message({ source: {}, data: { type: 'blog-preview-scroll', token: firstToken, line: 55 } });
  listeners.message({ source: frame.contentWindow, data: { type: 'blog-preview-scroll', token: 'wrong', line: 55 } });
  assert.equal(scrollEvents.length, 0);
  listeners.message({ source: frame.contentWindow, data: { type: 'blog-preview-scroll', token: firstToken, line: 32, blockIndex: 2 } });
  assert.deepEqual(plain(scrollEvents), [{ line: 32, blockIndex: 2 }]);
  assert.equal(api.render(container, response, opts), frame);
  assert.equal(config(frame).restoreLine, 32);
  assert.notEqual(config(frame).token, firstToken);
  assert.equal(created, 1);
  listeners.message({ source: frame.contentWindow, data: { type: 'blog-preview-scroll', token: firstToken, line: 100 } });
  assert.equal(scrollEvents.length, 1);
});

test('same-page step updates do not reload and empty source pages do not show other slides', () => {
  const before = frame.srcdoc;
  api.update({ step: 2 });
  assert.equal(frame.srcdoc, before);
  assert.equal(sent.at(-1).data.step, 2);
  assert.equal(sent.at(-1).data.token, config(frame).token);
  const deckResponse = { ...response, deck: true, slides: [{ html: '<p>Actual content</p>', source_line: 8, source_end: 10, block_index: 2 }] };
  api.render(container, deckResponse, { ...opts, key: 'doc/b', index: -1 });
  assert.equal(config(frame).restoreLine, 0);
  assert.ok(frame.srcdoc.includes('这一页没有可预览的内容'));
  assert.ok(!frame.srcdoc.includes('Actual content'));
  api.render(container, deckResponse, { ...opts, key: 'doc/b', index: 0 });
  assert.ok(frame.srcdoc.includes('class="slide is-current"'));
  assert.ok(frame.srcdoc.includes('data-block-index="2"'));
});

test('ready callbacks and safe links use authenticated messages', () => {
  const token = config(frame).token;
  listeners.message({ source: frame.contentWindow, data: { type: 'blog-preview-ready', token } });
  assert.equal(ready, 1);
  listeners.message({ source: frame.contentWindow, data: { type: 'blog-preview-link', token, href: 'javascript:alert(1)' } });
  listeners.message({ source: frame.contentWindow, data: { type: 'blog-preview-link', token, href: 'file:///C:/secret' } });
  assert.equal(opened.length, 0);
  listeners.message({ source: frame.contentWindow, data: { type: 'blog-preview-link', token, href: '/about/' } });
  assert.deepEqual(opened, [['http://127.0.0.1:4201/about/', '_blank', 'noopener,noreferrer']]);
});

test('read-all refresh keeps its source position after scrolling into another slide', () => {
  const deckResponse = { ...response, deck: true, slides: [{ html: '<p>A</p>' }, { html: '<p>B</p>' }] };
  api.render(container, deckResponse, { ...opts, key: 'doc/all', index: 0, all: true });
  listeners.message({ source: frame.contentWindow, data: { type: 'blog-preview-scroll', token: config(frame).token, line: 56, blockIndex: 1 } });
  api.render(container, deckResponse, { ...opts, key: 'doc/all', index: 1, all: true });
  assert.equal(config(frame).restoreLine, 56);
});

test('custom pages keep their page styles while rejecting unrelated body classes', () => {
  api.render(container, { ...response, previewBodyClass: 'page-single page-learning unexpected',
    previewAssets: { ...response.previewAssets, styles: ['/preview-assets/site.css', '/preview-assets/discovery.css'] }
  }, { ...opts, key: 'page/learning' });
  assert.ok(frame.srcdoc.includes('class="preview-page page-single page-learning"'));
  assert.ok(frame.srcdoc.includes('/preview-assets/discovery.css'));
  assert.ok(!frame.srcdoc.includes('unexpected'));
});

console.log(`${passed} preview module regressions passed.`);
