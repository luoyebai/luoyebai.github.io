/* Async regression checks against the real admin closure. No server or DOM library needed. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, hidden: false, value: '', textContent: '', disabled: false,
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute() {}, focus() {}, select() {}, querySelector: () => node('slugInput')
    });
    return nodes.get(id);
  }
  const buttons = ['save', 'save-build', 'delete', 'reload'].map(node);
  const requests = [];
  const drafts = new Map();
  const sandbox = {
    localStorage: {
      get length() { return drafts.size; }, key(i) { return Array.from(drafts.keys())[i]; },
      getItem(key) { return drafts.get(key) || null; }, setItem(key, value) { drafts.set(key, value); },
      removeItem(key) { drafts.delete(key); }
    },
    document: { readyState: 'loading', addEventListener() {}, getElementById: node,
      querySelectorAll: () => buttons },
    window: {}, setTimeout() {}, clearTimeout() {},
    fetch(url, opts) {
      return new Promise(resolve => requests.push({url, opts, reply(data, status = 200) {
        resolve({ ok: status < 400, status, text: async () => JSON.stringify(data) });
      }}));
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '../theme/admin/admin.js'), 'utf8');
  const marker = "  if (document.readyState === 'loading')";
  assert.ok(source.includes(marker));
  const instrumentation = `
    globalThis.testAdmin = { S, save, openDoc, setDirty, askClose, askAccept, askConfirm, askText, busy };
    collectFront = function () { return JSON.parse(JSON.stringify(globalThis.testFront)); };
    renderMeta = renderList = doPreview = function () {};
    refresh = function () { return Promise.resolve(); };
  `;
  vm.runInNewContext(source.replace(marker, instrumentation + marker), sandbox);
  sandbox.testFront = {slug: 'draft', title: 'Draft'};
  sandbox.testAdmin.S.cur = {kind: 'post', slug: 'draft', originalSlug: 'draft', revision: 'v1', front: sandbox.testFront};
  sandbox.testAdmin.S.state = {labels: {post: '文章'}};
  node('body').value = 'First revision';
  node('slugInput').value = 'draft';
  return {api: sandbox.testAdmin, sandbox, node, buttons, requests};
}

const settle = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  {
    const t = setup();
    t.api.setDirty(true);
    const saving = t.api.save(true);
    t.api.save(false);
    assert.equal(t.requests.length, 1, 'Repeated Save cannot create a second concurrent write');
    assert.ok(t.buttons.every(b => b.disabled));
    t.node('body').value = 'Text typed while request is pending';
    t.api.setDirty(true);
    t.requests[0].reply({ok: true, slug: 'draft', path: 'content/posts/draft.md', revision: 'v2'});
    await saving;
    assert.equal(t.api.S.dirty, true, 'New text must stay unsaved');
    assert.equal(t.api.S.cur.revision, 'v2', 'Next save uses the completed write revision');
    assert.equal(t.node('body').value, 'Text typed while request is pending');
    assert.match(t.node('statusText').textContent, /新改动未保存/);
    assert.equal(t.requests.length, 1, 'Save and build must not build while newer edits are unsaved');
    assert.ok(t.buttons.every(b => !b.disabled));
  }
  {
    const t = setup();
    t.api.setDirty(true);
    const saving = t.api.save(false);
    t.requests[0].reply({ok: true, slug: 'draft', path: 'content/posts/draft.md', revision: 'v2'});
    await saving;
    assert.equal(t.api.S.dirty, false);
    assert.match(t.node('statusText').textContent, /^已保存/);
    assert.equal(t.node('loading').hidden, true);
  }
  {
    const t = setup();
    const saving = t.api.save(false);
    t.requests[0].reply({ok: false, error: '文件已被其他编辑器修改'}, 409);
    await saving;
    assert.equal(t.api.S.dirty, true);
    assert.equal(t.api.S.cur.revision, 'v1');
    assert.equal(t.node('body').value, 'First revision');
    assert.match(t.node('statusText').textContent, /保存失败/);
    assert.equal(t.api.S.saving, false);
  }
  {
    const t = setup();
    t.api.openDoc('post', 'older-click');
    t.api.openDoc('post', 'latest-click');
    assert.equal(t.requests.length, 2);
    t.requests[1].reply({slug: 'latest-click', front: {}, body: 'Latest chosen document', revision: 'latest'});
    await settle();
    t.requests[0].reply({slug: 'older-click', front: {}, body: 'Stale response', revision: 'older'});
    await settle();
    assert.equal(t.api.S.cur.slug, 'latest-click');
    assert.equal(t.node('body').value, 'Latest chosen document');
    assert.equal(t.node('editorBody').inert, false);
    assert.equal(t.node('loading').hidden, true);
  }
  {
    const t = setup();
    t.api.setDirty(true);
    t.api.openDoc('post', 'next');
    t.api.openDoc('post', 'next');
    assert.equal(t.requests.length, 0, 'Double clicking a document must not bypass the discard dialog');
    t.api.askAccept();
    await settle();
    assert.equal(t.requests.length, 1);
    t.requests[0].reply({slug: 'next', front: {}, body: 'Next', revision: 'v-next'});
    await settle();
    assert.equal(t.api.S.cur.slug, 'next');
  }
  {
    const t = setup();
    const confirmation = t.api.askConfirm({title: 'Delete?'});
    assert.equal(t.node('askInput').value, '');
    t.api.askAccept();
    assert.equal(await confirmation, true, 'Confirm buttons must accept even without an input value');
    const cancelled = t.api.askConfirm({});
    t.api.askClose(null);
    assert.equal(await cancelled, false);
    const input = t.api.askText({value: '  New title  '});
    t.api.askAccept();
    assert.equal(await input, 'New title');
  }
  console.log('PASS: 6 admin saving, navigation and confirmation regressions');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
