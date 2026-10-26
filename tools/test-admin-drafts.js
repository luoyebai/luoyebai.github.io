/* Behavioral tests for browser draft persistence; no browser profile is used. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../theme/admin/admin.js'), 'utf8');

function windowFixture(shared = new Map()) {
  const nodes = new Map();
  const messages = [];
  let quota = false;
  let requests = 0;
  const storage = {
    get length() { return shared.size; },
    key(index) { return [...shared.keys()][index]; },
    getItem(key) { return shared.get(key) || null; },
    setItem(key, value) { if (quota) throw new Error('QuotaExceededError'); shared.set(key, value); },
    removeItem(key) { if (quota) throw new Error('Storage denied'); shared.delete(key); }
  };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {value:'', hidden:false, textContent:'', style:{},
      querySelector() { return null; }, querySelectorAll() { return []; }});
    return nodes.get(id);
  }
  const context = { console, Math, Date, JSON, Promise, setTimeout(){return 1;}, clearTimeout(){},
    localStorage:storage, document:{readyState:'loading', getElementById:node, addEventListener(){}},
    window:{}, fetch(){requests++; throw new Error('Unexpected network request');},
    _messages:messages };
  vm.createContext(context);
  vm.runInContext(code.replace("  if (document.readyState === 'loading')", `
    toast = function (message) { _messages.push(message); };
    askConfirm = function () { return Promise.resolve(true); };
    window.test = {S, persistDraft, drafts, forgetDraft, protectDraftBeforeSwitch, openDoc, createDoc, recoveryRestore};
    if (document.readyState === 'loading')`), context);
  const test = context.window.test;
  test.S.state = {root:'fixture-workspace'};
  function edit(slug, body) {
    test.S.cur = {kind:'post', slug, originalSlug:slug, revision:'base', front:{title:slug}};
    test.S.dirty = true;
    node('body').value = body;
    return test.S.cur;
  }
  return {test, edit, node, messages, shared, deny(){quota=true;}, allow(){quota=false;}, get requests(){return requests;}};
}

(async function () {
  const first = windowFixture();
  const a = first.edit('a', 'first document');
  assert.equal(first.test.persistDraft(), true);
  const b = first.edit('b', 'second document');
  first.test.persistDraft();
  assert.equal(first.test.drafts().length, 2, 'switching documents retains both drafts');
  const second = windowFixture(first.shared);
  second.edit('a', 'other window'); second.test.persistDraft();
  assert.equal(first.test.drafts().length, 3, 'another tab cannot overwrite this tab');
  second.test.S.state.root = 'other-workspace';
  assert.equal(second.test.drafts().length, 0, 'workspaces do not mix drafts');
  first.test.forgetDraft(b);
  assert.equal(first.test.drafts().length, 2, 'saving only clears the matching draft');

  const fail = windowFixture();
  const owner = fail.edit('working', 'valuable unsaved text');
  fail.deny();
  assert.equal(fail.test.persistDraft(), false);
  assert.equal(fail.test.S.dirty, true);
  assert.equal(await fail.test.openDoc('post', 'different', true), false);
  assert.equal(fail.test.S.cur, owner, 'quota failure blocks destructive switching');
  assert.equal(fail.test.createDoc('post', 'New doc'), false);
  assert.equal(fail.node('body').value, 'valuable unsaved text');
  fail.test.S.recoveryMode = 'history';
  fail.test.S.recoveryOwner = owner;
  fail.test.S.recoveryItems = [{id:'version'}];
  fail.test.recoveryRestore(0);
  await Promise.resolve();
  assert.equal(fail.requests, 0, 'recovery never begins if unsaved input cannot be protected');
  assert.equal(fail.test.S.cur, owner);
  assert.equal(fail.test.S.dirty, true);
  fail.test.forgetDraft(owner); // Storage failure must not throw after disk save.

  const stale = windowFixture();
  const original = stale.edit('a', 'original'); stale.test.persistDraft();
  const draft = stale.test.drafts()[0];
  const recovered = {recoveredDraft:{key:draft.key, raw:draft.raw}};
  stale.shared.set(draft.key, 'a newer draft from another tab');
  stale.test.forgetDraft(recovered);
  assert.equal(stale.shared.get(draft.key), 'a newer draft from another tab', 'do not delete a concurrently changed draft');
  console.log('Draft recovery: document/tab/workspace isolation, quota protection and concurrent cleanup passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
