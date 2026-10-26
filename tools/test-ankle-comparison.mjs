import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadXML} from '../assets/tools/ankle/mujoco-engine.js';
import {MotorSimulation, PD_LIMITS} from '../assets/tools/ankle/simulation.js';
import {runMotorComparison} from '../assets/tools/ankle/comparison.js';

const directory = new URL('../assets/tools/ankle/limx/', import.meta.url);
const descriptor = JSON.parse(fs.readFileSync(new URL('descriptor.json', directory), 'utf8'));
const xml = fs.readFileSync(new URL(descriptor.model, directory), 'utf8');
const assets = Object.fromEntries(descriptor.assets.map(name => [name, new Uint8Array(fs.readFileSync(new URL(name, directory)))]));
const config = Object.freeze({motorJoints: Object.freeze([...descriptor.motorJoints]),
  actuatorNames: Object.freeze([...descriptor.actuators]), footJoints: Object.freeze([...descriptor.footJoints].reverse()),
  kp: 180, kd: 6, torqueLimit: 42, targetLimit: .3, gainLimits: PD_LIMITS.limx});
const amplitude = 10 * Math.PI / 180;
const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const footDistance = (one, two) => Math.hypot(...one.foot.map((angle, index) => angle - two.foot[index]));
function gravity(engine) {
  const option = engine.model.opt;
  try {return Array.from(option.gravity);} finally {option.delete();}
}
function trackedFactory(source = xml) {
  const track = {created: 0, disposed: 0, engine: null, disposeTime: null, gravityBefore: null, gravityAfter: null};
  const factory = async () => {
    const engine = await loadXML(source, {assets});
    track.created++; track.engine = engine; track.gravityBefore = gravity(engine);
    const dispose = engine.dispose;
    engine.dispose = () => {
      track.disposed++; track.disposeTime = engine.data.time; track.gravityAfter = gravity(engine); dispose();
    };
    return engine;
  };
  return {factory, track};
}

let referencePromise;
const referenceComparison = () => referencePromise ??= runMotorComparison(() => loadXML(xml, {assets}), config, {yieldControl: async () => {}});
test('six real LimX experiments each reset and integrate exactly two seconds with explicit sample metadata', async () => {
  const {factory, track} = trackedFactory();
  const progress = [], times = [];
  const result = await runMotorComparison(async () => {
    const engine = await factory();
    // Deliberately dirty the fresh model: each experiment must clear this load.
    engine.data.ctrl.fill(4); engine.data.qfrc_applied.fill(2); engine.data.xfrc_applied.fill(1);
    return engine;
  }, config, {
    onProgress: value => progress.push(value),
    yieldControl: async () => {
      times.push(track.engine.data.time);
      assert.ok(track.engine.data.qfrc_applied.every(value => value === 0), 'generalized external force is reset');
      assert.ok(track.engine.data.xfrc_applied.every(value => value === 0), 'spatial external force is reset');
    },
  });
  referencePromise ??= Promise.resolve(result);
  assert.equal(result.duration, 2); assert.equal(result.amplitude, amplitude); assert.equal(result.cases.length, 6);
  assert.deepEqual(result.cases.map(item => item.id), ['zero', 'motor-a', 'motor-b', 'same', 'opposite', 'motor-b-off']);
  assert.deepEqual(result.cases.map(item => item.targets), [[0, 0], [amplitude, 0], [0, amplitude],
    [amplitude, amplitude], [amplitude, -amplitude], [amplitude, 0]]);
  assert.deepEqual(progress.map(item => item.completed), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(progress.every(item => item.total === 6 && typeof item.label === 'string'));
  assert.equal(times.length, 120, 'each 100-step batch yields control, including case boundaries');
  times.forEach((time, index) => near(time, (index % 20 + 1) * .1));
  for (const item of result.cases) {
    assert.equal(item.state.finite, true); near(item.state.time, 2);
    assert.equal(item.timestep, .001); assert.equal(item.stepCount, 2000);
    assert.equal(item.sampleEverySteps, 100); assert.equal(item.closureSamples, 21);
    assert.ok(item.sampledMaxClosure >= item.state.closure); assert.ok(Number.isFinite(item.sampledMaxClosure));
    assert.equal(Object.hasOwn(item, 'maxClosure'), false, 'batch samples must not be advertised as the continuous peak');
    assert.deepEqual(item.state.enabled, item.enabled);
    for (const key of ['motors', 'velocities', 'foot', 'torques']) {
      assert.equal(item.state[key].length, 2); assert.ok(item.state[key].every(Number.isFinite));
    }
    if (item.id !== 'motor-b-off') {
      assert.deepEqual(item.enabled, [true, true]);
      assert.ok(item.state.motors.every((angle, index) => Math.abs(angle - item.targets[index]) < .001), JSON.stringify(item));
      assert.ok(item.state.velocities.every(value => Math.abs(value) < .002), JSON.stringify(item));
      assert.ok(item.sampledMaxClosure < .00012, JSON.stringify(item));
    }
  }
  assert.equal(track.created, 1); assert.equal(track.disposed, 1); assert.equal(track.engine.disposed, true);
  assert.deepEqual(track.gravityBefore, [0, 0, -9.81]); assert.deepEqual(track.gravityAfter, track.gravityBefore);
});

test('single, same and opposite motor inputs produce distinct passive outputs; B-off removes its torque', async () => {
  const verifiedResult = await referenceComparison();
  const states = Object.fromEntries(verifiedResult.cases.map(item => [item.id, item.state]));
  assert.ok(Math.hypot(...states.zero.foot) < .001);
  assert.ok(states['motor-a'].foot[0] > .05 && states['motor-a'].foot[1] > .05);
  assert.ok(states['motor-b'].foot[0] > .05 && states['motor-b'].foot[1] < -.05);
  assert.ok(states.same.foot[0] > .15 && Math.abs(states.same.foot[1]) < .003);
  assert.ok(states.opposite.foot[1] > .15 && Math.abs(states.opposite.foot[0]) < .015);
  const unpowered = states['motor-b-off'];
  assert.deepEqual(unpowered.enabled, [true, false]); assert.equal(unpowered.torques[1], 0);
  assert.ok(footDistance(unpowered, states['motor-a']) > .04, JSON.stringify({powered: states['motor-a'], unpowered}));
});

test('opening one actual rod closure changes comparison outputs rather than replaying a pose mapping', async () => {
  const verifiedResult = await referenceComparison();
  const {factory, track} = trackedFactory(xml.replace('name="A_achilles_connect_L"', 'name="A_achilles_connect_L" active="false"'));
  const result = await runMotorComparison(factory, config, {yieldControl: async () => {}});
  const intact = verifiedResult.cases.find(item => item.id === 'motor-a').state;
  const opened = result.cases.find(item => item.id === 'motor-a').state;
  assert.equal(opened.finite, true); assert.ok(footDistance(intact, opened) > .05, JSON.stringify({intact, opened}));
  assert.equal(track.disposed, 1);
});

test('comparison never changes a separately running viewer model or its power/load/target state', async () => {
  const viewer = await loadXML(xml, {assets});
  try {
    const simulation = new MotorSimulation(viewer, config);
    simulation.setTargets([.08, -.09]); simulation.setMotorEnabled(0, false); simulation.load = .6; simulation.advance(35);
    const before = simulation.read();
    const applied = Array.from(viewer.data.qfrc_applied);
    const {factory, track} = trackedFactory();
    await runMotorComparison(factory, config, {yieldControl: async () => {}});
    assert.deepEqual(simulation.read(), before);
    assert.deepEqual(simulation.targets, [.08, -.09]); assert.equal(simulation.load, .6);
    assert.deepEqual(Array.from(viewer.data.qfrc_applied), applied);
    assert.equal(viewer.disposed, false); assert.equal(track.disposed, 1);
  } finally {viewer.dispose();}
});

test('already aborted requests allocate nothing; abort while loading disposes the acquired engine', async () => {
  const first = new AbortController(); first.abort('before allocation'); let calls = 0;
  await assert.rejects(runMotorComparison(() => {calls++;}, config, {signal: first.signal}), {name: 'AbortError'});
  assert.equal(calls, 0);
  const second = new AbortController(); const {factory, track} = trackedFactory();
  await assert.rejects(runMotorComparison(async () => {
    const engine = await factory(); second.abort('loading cancelled'); return engine;
  }, config, {signal: second.signal}), {name: 'AbortError'});
  assert.equal(track.disposed, 1); assert.equal(track.disposeTime, 0);
});

test('cancellation between physics batches releases the engine and reports no completed result', async () => {
  const controller = new AbortController(); const {factory, track} = trackedFactory(); let batches = 0;
  const progress = [];
  await assert.rejects(runMotorComparison(factory, config, {
    signal: controller.signal, onProgress: value => progress.push(value),
    yieldControl: async () => {if (++batches === 2) controller.abort('stop experiment');},
  }), error => error.name === 'AbortError' && error.cause === 'stop experiment');
  assert.equal(batches, 2); near(track.disposeTime, .2); assert.equal(track.disposed, 1);
  assert.equal(progress.at(-1).completed, 0);
});

test('the default scheduler yields to real tasks so a UI-style timer can cancel', async () => {
  const controller = new AbortController(); const {factory, track} = trackedFactory(); let timer;
  try {
    await assert.rejects(runMotorComparison(factory, config, {
      signal: controller.signal,
      onProgress: () => {timer = setTimeout(() => controller.abort(), 0);},
    }), {name: 'AbortError'});
    assert.equal(track.disposed, 1); near(track.disposeTime, .1);
  } finally {clearTimeout(timer);}
});

test('factory failures propagate, and callback/controller/timestep failures dispose acquired models', async () => {
  const factoryError = new Error('model download failed');
  await assert.rejects(runMotorComparison(async () => {throw factoryError;}, config), error => error === factoryError);
  await assert.rejects(runMotorComparison(null, config), /createEngine/);
  for (const failure of ['progress', 'yield', 'controller', 'timestep']) {
    const {factory, track} = trackedFactory(failure === 'timestep' ? xml.replace('timestep="0.001"', 'timestep="0.003"') : xml);
    const callbackError = new Error(`${failure} failed`);
    const options = {yieldControl: async () => {if (failure === 'yield') throw callbackError;}};
    if (failure === 'progress') options.onProgress = () => {throw callbackError;};
    await assert.rejects(runMotorComparison(factory, failure === 'controller' ? {...config, targetLimit: .1} : config, options),
      failure === 'progress' || failure === 'yield' ? error => error === callbackError : /range|whole steps/);
    assert.equal(track.disposed, 1, failure); assert.equal(track.engine.disposed, true, failure);
    near(track.disposeTime, failure === 'yield' ? .1 : 0);
  }
});
