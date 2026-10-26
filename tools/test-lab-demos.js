/* Execute the actual Markdown demos: finite simulation, reachable goals and UI reset. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function source(file) {
  const markdown = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const blocks = [...markdown.matchAll(/^```js run\r?\n([\s\S]*?)^```\s*$/gm)];
  assert.equal(blocks.length, 1, `${file}: one self-contained executable example`);
  return blocks[0][1];
}
function run(file, exposed) {
  const nodes = new Map(), loops = [];
  const paint = new Proxy({}, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const root = {
    set innerHTML(html) {
      for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
        const value = /\bvalue="([^"]*)"/.exec(match[2]);
        const node = { value: value ? value[1] : '', textContent: '', disabled: /\bdisabled\b/.test(match[2]), getContext: () => paint };
        if (match[1] === 'select') {
          const options = html.slice(match.index + match[0].length).split('</select>')[0];
          node.value = /<option\s+value="([^"]*)"/.exec(options)[1];
        }
        nodes.set(match[3], node);
      }
    },
    querySelector(selector) { const node = nodes.get(selector.slice(1)); assert.ok(node, selector); return node; }
  };
  const demo = { root, animate(callback) {
    let playing = false, time = 0;
    const loop = {
      start() { playing = true; }, pause() { playing = false; }, reset() { playing = false; time = 0; },
      isRunning() { return playing; },
      tick(delta) { if (!playing) return; delta = Math.min(0.05, delta); time += delta; if (callback({delta,time}) === false) playing = false; }
    };
    loops.push(loop); return loop;
  } };
  const context = vm.createContext({ demo, console });
  vm.runInContext(source(file) + '\nglobalThis.api={' + exposed + '};', context, {timeout:1000});
  assert.equal(loops.length, 1, 'Each panel owns exactly one animation controller.');
  assert.equal(loops[0].isRunning(), false, 'Mounting never autostarts the animation.');
  return { api:context.api, nodes, loop:loops[0] };
}
function advance(loop, seconds, frame = 1/60) {
  for (let i=0;i<Math.ceil(seconds/frame);i++) loop.tick(frame);
}

const control = run('content/pages/lab.md', 'newChallenge,integrateChallenge,getState:()=>challenge');
function trial(level, k, d) {
  const state=control.api.newChallenge();state.mode='running';
  for(let i=0;i<2000;i++)control.api.integrateChallenge(state,{k,d},level);
  return state;
}
for(const level of ['base','load','delay','noise']) {
  const state=trial(level,16,8);
  assert.equal(state.mode,'success', `${level} is completable with the article's suggested K=16, D=8; peak=${state.peak}, stable=${state.stable}, x=${state.x}`);
  assert.equal(state.time,10);assert.ok(state.peak<=.15 && state.stable>=2);
  assert.ok(state.history.length<=21 && state.trace.length<=501,'Memory remains bounded.');
}
assert.equal(trial('base',18,2).mode,'retry','The low-damping default exposes excessive overshoot.');
assert.equal(trial('base',4,18).mode,'retry','Very slow response must not pass just because it does not overshoot.');
const delayTrial=trial('delay',16,8),baseTrial=trial('base',16,8),loadTrial=trial('load',16,8),noiseTrial=trial('noise',16,8);
assert.notEqual(delayTrial.trace[125].measured,baseTrial.trace[125].measured,'Delay changes the observed state.');
assert.notEqual(loadTrial.trace[125].x,baseTrial.trace[125].x,'Payload changes actual motion.');
assert.notEqual(noiseTrial.trace[125].measured,baseTrial.trace[125].measured,'Measurement noise appears in its own curve.');
assert.equal(trial('noise',16,8).x,noiseTrial.x,'Noise is deterministic so comparisons are repeatable.');
control.nodes.get('control-k').value='16';control.nodes.get('control-d').value='8';control.nodes.get('control-k').oninput();
control.nodes.get('control-start').onclick();advance(control.loop,1);
control.nodes.get('control-pause').onclick();const paused=control.api.getState().time;advance(control.loop,1);
assert.equal(control.api.getState().time,paused);assert.equal(control.api.getState().mode,'paused');
control.nodes.get('control-start').onclick();advance(control.loop,10);
assert.equal(control.api.getState().mode,'success');assert.equal(control.loop.isRunning(),false);
control.nodes.get('control-reset').onclick();
assert.equal(control.nodes.get('control-k').value,'18');assert.equal(control.nodes.get('control-d').value,'2');
assert.equal(control.api.getState().time,0);assert.equal(control.api.getState().trace.length,1);assert.equal(control.loop.isRunning(),false);
control.nodes.get('control-start').onclick();advance(control.loop,.3);control.nodes.get('control-k').value='24';control.nodes.get('control-k').oninput();
assert.equal(control.nodes.get('control-k').value,'24');assert.equal(control.api.getState().time,0);assert.equal(control.loop.isRunning(),false,'Parameter changes restart a comparable paused trial.');
control.nodes.get('control-level').value='noise';control.nodes.get('control-level').onchange();
assert.equal(control.nodes.get('control-level').value,'noise');assert.equal(control.nodes.get('control-k').value,'18');assert.equal(control.api.getState().mode,'ready');

const damping=run('content/posts/arm-impedance-control.md','newDamping,stepDamping,getState:()=>damping');
function response(zeta){const state=damping.api.newDamping();state.mode='running';for(let i=0;i<1200;i++)damping.api.stepDamping(state,{k:16,d:2*zeta*4});return state;}
const under=response(.2),critical=response(1);
assert.ok(under.peak>.014 && critical.peak<=.01001,'Damping materially reduces overshoot.');
assert.ok(Math.abs(critical.x-.01)<.000001);assert.equal(critical.time,6);assert.equal(critical.mode,'done');assert.ok(critical.trace.length<=301);
damping.nodes.get('damping-start').onclick();advance(damping.loop,1);damping.nodes.get('damping-pause').onclick();const dampingTime=damping.api.getState().time;advance(damping.loop,1);assert.equal(damping.api.getState().time,dampingTime);
damping.nodes.get('damping-start').onclick();advance(damping.loop,6);assert.equal(damping.api.getState().mode,'done');assert.equal(damping.loop.isRunning(),false);
damping.nodes.get('damping-z').value='1';damping.nodes.get('damping-z').oninput();assert.equal(damping.api.getState().time,0);assert.equal(damping.nodes.get('damping-z').value,'1');
damping.nodes.get('damping-reset').onclick();assert.equal(damping.nodes.get('damping-z').value,'0.35');assert.equal(damping.nodes.get('damping-k').value,'16');assert.equal(damping.loop.isRunning(),false);

const queue=run('content/posts/dds-qos-tuning.md','newQueue,stepQueue,getState:()=>queue');
function queueTrial(depth,delay){
 const state=queue.api.newQueue();state.mode='running';
 for(let i=0;i<1600;i++){
  queue.api.stepQueue(state,{depth,delay});
  assert.ok(state.buffer.length<=depth && state.inflight.length<=6);
  assert.equal(state.created,state.consumed+state.dropped+state.inflight.length+state.buffer.length,'Every message is accounted for exactly once.');
 }
 return state;
}
const shallow=queueTrial(1,.04),deep=queueTrial(8,.04),slow=queueTrial(1,.2);
assert.equal(shallow.mode,'done');assert.equal(shallow.time,8);
assert.ok(deep.ageTotal/deep.consumed>shallow.ageTotal/shallow.consumed+.2,'Deeper backlog creates older samples.');
assert.ok(slow.ageTotal/slow.consumed>shallow.ageTotal/shallow.consumed+.1,'Transport time is reflected in data age.');
assert.ok(shallow.dropped>deep.dropped,'Shallow history discards more unconsumed samples.');
for(const item of [shallow,deep,slow])assert.ok(item.trace.length<=65);
queue.nodes.get('queue-start').onclick();advance(queue.loop,.5);queue.nodes.get('queue-pause').onclick();const queueTime=queue.api.getState().time;advance(queue.loop,1);assert.equal(queue.api.getState().time,queueTime);
queue.nodes.get('queue-start').onclick();advance(queue.loop,8);assert.equal(queue.api.getState().mode,'done');assert.equal(queue.loop.isRunning(),false);
queue.nodes.get('queue-depth').value='8';queue.nodes.get('queue-depth').onchange();assert.equal(queue.api.getState().time,0);assert.equal(queue.nodes.get('queue-depth').value,'8');
queue.nodes.get('queue-reset').onclick();assert.equal(queue.nodes.get('queue-depth').value,'1');assert.equal(queue.nodes.get('queue-delay').value,'40');assert.equal(queue.api.getState().consumed,0);assert.equal(queue.loop.isRunning(),false);

// Simulated duration and trajectories must not depend on a 30 Hz vs 60 Hz display.
function frameTrial(frame){control.nodes.get('control-level').value='base';control.nodes.get('control-reset').onclick();control.nodes.get('control-k').value='16';control.nodes.get('control-d').value='8';control.nodes.get('control-start').onclick();advance(control.loop,10.1,frame);return control.api.getState();}
const slowFrames=frameTrial(1/30),fastFrames=frameTrial(1/60);
assert.equal(slowFrames.x,fastFrames.x);assert.equal(slowFrames.time,fastFrames.time);assert.equal(slowFrames.mode,'success');
console.log('Lab/embedded demos: 4 reachable challenges, repeatable disturbance models, damping behavior, queue accounting/latency, bounded histories, pause/resume, complete stop, parameter/reset and frame-rate invariance passed.');
