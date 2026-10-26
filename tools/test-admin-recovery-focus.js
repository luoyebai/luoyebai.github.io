'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const nodes = new Map();
const document = {readyState:'loading', addEventListener(){}, activeElement:null,
  getElementById(id) { return nodes.get(id); }};
function button(id) {
  const node = {id, isConnected:true, disabled:false, hidden:false,
    focus(){document.activeElement=this;}, closest(){return null;}, getClientRects(){return [{}];}};
  nodes.set(id, node); return node;
}
const opener = button('opener');
const first = button('first');
const second = button('second');
const last = button('last');
const disabled = button('disabled'); disabled.disabled = true;
const invisible = button('invisible'); invisible.getClientRects = () => [];
const modal = {id:'recoveryModal', hidden:true,
  querySelector(){return first;}, querySelectorAll(){return [first, disabled, second, invisible, last];}};
nodes.set('recoveryModal',modal); nodes.set('recoveryContext',{});
const context = {document, window:{}, setTimeout(){}, clearTimeout(){}, console};
vm.createContext(context);
const code = fs.readFileSync(path.join(__dirname,'../theme/admin/admin.js'),'utf8');
vm.runInContext(code.replace("  if (document.readyState === 'loading')", `
  persistDraft = recoveryList = function() {};
  window.test = {S, openRecovery, closeRecovery, recoveryKey, closeModal,
    setConfirmation(value){askState=value;}};
  if (document.readyState === 'loading')`),context);
const api = context.window.test;
function press(key,shiftKey=false) {
  let prevented=false;
  const handled = api.recoveryKey({key,shiftKey,preventDefault(){prevented=true;}});
  return {handled,prevented};
}
opener.focus(); api.openRecovery();
assert.equal(document.activeElement,first,'opening moves focus into the dialog');
last.focus(); assert.equal(press('Tab').prevented,true); assert.equal(document.activeElement,first);
first.focus(); assert.equal(press('Tab',true).prevented,true); assert.equal(document.activeElement,last);
opener.focus(); press('Tab'); assert.equal(document.activeElement,first,'focus outside dialog is recovered');
second.focus(); assert.equal(press('Tab').prevented,false,'native navigation within dialog remains intact');
api.setConfirmation({}); assert.equal(press('Escape').handled,false); assert.equal(modal.hidden,false);
api.setConfirmation(null); assert.equal(press('Escape').prevented,true);
assert.equal(modal.hidden,true); assert.equal(document.activeElement,opener);
api.openRecovery('history'); api.closeModal(modal); assert.equal(document.activeElement,opener);
console.log('Recovery focus: opening, Tab/Shift+Tab loop, hidden/disabled exclusions, confirmation priority, Escape and close restoration passed.');
