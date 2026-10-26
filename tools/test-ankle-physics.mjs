import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadXML} from '../assets/tools/ankle/mujoco-engine.js';
import {MotorSimulation, PD_LIMITS} from '../assets/tools/ankle/simulation.js';
import {createTeachingMJCF} from '../assets/tools/ankle/ankle-model.js';

const directory = new URL('../assets/tools/ankle/limx/', import.meta.url);
const descriptor = JSON.parse(fs.readFileSync(new URL('descriptor.json', directory), 'utf8'));
const limxXML = fs.readFileSync(new URL(descriptor.model, directory), 'utf8');
const limxAssets = Object.fromEntries(descriptor.assets.map(name => [name, new Uint8Array(fs.readFileSync(new URL(name, directory)))]));
const limxConfig = {motorJoints: descriptor.motorJoints, actuatorNames: descriptor.actuators,
  footJoints: [...descriptor.footJoints].reverse(), kp: 180, kd: 6, torqueLimit: 42, targetLimit: .3, gainLimits: PD_LIMITS.limx};
const teachingConfig = {motorJoints: ['motor_1', 'motor_2'], actuatorNames: ['motor_1_torque', 'motor_2_torque'],
  footJoints: ['ankle_roll', 'ankle_pitch'], kp: 80, kd: 1, torqueLimit: 8, targetLimit: .6, gainLimits: PD_LIMITS.teaching};

async function fixture(kind = 'limx', xml = null) {
  const engine = await loadXML(xml ?? (kind === 'limx' ? limxXML : createTeachingMJCF()), kind === 'limx' ? {assets: limxAssets} : {});
  return {engine, sim: new MotorSimulation(engine, kind === 'limx' ? limxConfig : teachingConfig)};
}

function run(sim, count = 3000) {
  let maximumClosure = 0;
  let state;
  for (let step = 0; step < count; step += 10) {
    state = sim.advance(Math.min(10, count - step));
    assert.equal(state.finite, true);
    maximumClosure = Math.max(maximumClosure, state.closure);
  }
  return {...state, maximumClosure};
}

const worldPoint = (pose, point) => pose.pos.map((value, row) => value + point.reduce((sum, v, col) => sum + pose.mat[row * 3 + col] * v, 0));
const gapA = engine => {
  const foot = worldPoint(engine.getBodyPose('left_ankle_roll_link'), [-.035, .033, .0045]);
  const rod = worldPoint(engine.getBodyPose('left_A_achilles_rod_link'), [0, .000308, -.27]);
  return Math.hypot(...foot.map((value, i) => value - rod[i]));
};

test('LimX uses two actual motors and two loop constraints to move passive pitch/roll', async () => {
  const {engine, sim} = await fixture();
  try {
    assert.equal(engine.model.nu, 2); assert.equal(engine.model.neq, 2);
    assert.equal(engine.model.nq, 12); assert.equal(engine.model.nv, 10);
    assert.equal(sim.read().closure, 0);
    const results = [];
    for (const targets of [[0, 0], [.15, .15], [.15, -.15], [-.15, .15],
      [.3, .3], [.3, -.3], [-.3, .3], [-.3, -.3], [.3, 0], [-.3, 0], [0, .3], [0, -.3]]) {
      sim.reset(); sim.setTargets(targets);
      const result = run(sim);
      assert.ok(result.motors.every((angle, i) => Math.abs(angle - targets[i]) < .0004), JSON.stringify(result));
      assert.ok(result.maximumClosure < .00012, JSON.stringify(result));
      assert.ok(result.closure < .00001);
      assert.ok(result.torques.every(torque => Math.abs(torque) <= 42));
      assert.ok(gapA(engine) < .00002);
      results.push(result);
    }
    assert.ok(results[1].foot[0] > .14, 'same-signed A/B motors create passive roll');
    assert.ok(Math.abs(results[1].foot[1]) < .002);
    assert.ok(results[2].foot[1] > .13, 'opposite-signed A/B motors create passive pitch');
    assert.ok(results[3].foot[1] < -.13);
  } finally {engine.destroy();}
});

test('teaching model is independently integrated and responds to different motor combinations', async () => {
  const {engine, sim} = await fixture('teaching');
  try {
    assert.equal(engine.model.nu, 2); assert.equal(engine.model.neq, 2);
    const results = [];
    for (const targets of [[.2, .2], [.2, -.2], [-.2, .2], [-.5, -.5], [.5, .5]]) {
      sim.reset(); sim.setTargets(targets);
      const result = run(sim, 2000);
      assert.ok(result.motors.every((angle, i) => Math.abs(angle - targets[i]) < .004), JSON.stringify(result));
      assert.ok(result.closure < .0001, JSON.stringify(result));
      assert.ok(result.maximumClosure < .001, JSON.stringify(result));
      assert.ok(result.torques.every(torque => Math.abs(torque) <= 8));
      results.push(result);
    }
    assert.ok(Math.hypot(...results[0].foot) > .05);
    assert.ok(Math.hypot(...results[0].foot.map((angle, i) => angle - results[1].foot[i])) > .05);
    assert.ok(results[1].foot[0] * results[2].foot[0] < 0, 'differential motor targets reverse passive roll');
  } finally {engine.destroy();}
});

test('a generalized external pitch load changes the physical motor reactions', async () => {
  for (const kind of ['limx', 'teaching']) {
    const {engine, sim} = await fixture(kind);
    try {
      const unloaded = run(sim, 2000);
      sim.load = .8;
      const loaded = run(sim, 2000);
      assert.ok(Math.hypot(...loaded.torques.map((torque, i) => torque - unloaded.torques[i])) > .15, JSON.stringify({kind, unloaded, loaded}));
      assert.ok(loaded.closure < .0001);
      assert.equal(engine.data.qfrc_applied[engine.getJoint(sim.footJoints[1]).dofAddress], .8);
      const reset = sim.reset();
      assert.equal(reset.time, 0); assert.deepEqual(sim.targets, [0, 0]); assert.equal(sim.load, 0);
      assert.ok(engine.data.qfrc_applied.every(value => value === 0));
    } finally {engine.destroy();}
  }
});

test('disabling one connect in either model breaks rod transmission instead of faking the foot pose', async () => {
  for (const kind of ['limx', 'teaching']) {
    const original = kind === 'limx' ? limxXML : createTeachingMJCF();
    const constraint = kind === 'limx' ? 'A_achilles_connect_L' : 'rod_1_closure';
    const gap = kind === 'limx' ? gapA : engine => {
      const sites = engine.getSitePoses();
      const rod = sites.find(site => site.name === 'rod_end_1').pos;
      const foot = sites.find(site => site.name === 'foot_C_1').pos;
      return Math.hypot(...rod.map((value, i) => value - foot[i]));
    };
    const intact = await fixture(kind);
    const open = await fixture(kind, original.replace(`name="${constraint}"`, `name="${constraint}" active="false"`));
    try {
      assert.equal(intact.engine.getConstraintState().equalityRows.length, 6);
      assert.equal(open.engine.getConstraintState().equalityRows.length, 3);
      intact.sim.setTargets([.2, 0]); open.sim.setTargets([.2, 0]);
      const closedState = run(intact.sim), openState = run(open.sim);
      assert.ok(gap(intact.engine) < .00002);
      assert.ok(gap(open.engine) > .001, `${kind} disabled rod gap=${gap(open.engine)}`);
      assert.ok(Math.hypot(...closedState.foot.map((angle, i) => angle - openState.foot[i])) > .05,
        JSON.stringify({kind, closed: closedState.foot, open: openState.foot}));
    } finally {intact.engine.destroy(); open.engine.destroy();}
  }
});

test('two live models keep separate time, targets and generalized forces', async () => {
  const one = await fixture(), two = await fixture('teaching');
  try {
    one.sim.setTargets([.1, -.1]); one.sim.load = .2; one.sim.advance(25);
    assert.ok(one.sim.time > 0); assert.equal(two.sim.time, 0);
    assert.deepEqual(two.sim.targets, [0, 0]); assert.equal(two.sim.load, 0);
    assert.ok(two.engine.data.qfrc_applied.every(value => value === 0));
    const snapshot = one.sim.read();
    two.sim.setTargets([-.1, .1]); two.sim.advance(25);
    assert.deepEqual(one.sim.read(), snapshot);
  } finally {one.engine.destroy(); two.engine.destroy();}
});

test('invalid inputs cannot advance, partially change targets or restart a stopped simulation', async () => {
  const {engine, sim} = await fixture();
  try {
    for (const value of [0, -1, 1.5, 101, NaN, Infinity, '10']) {
      assert.throws(() => sim.advance(value), /integer/); assert.equal(sim.time, 0);
    }
    sim.setTargets([.1, .2]);
    assert.throws(() => sim.setTargets([.1, NaN]), /finite/);
    assert.deepEqual(sim.targets, [.1, .2]); assert.equal(sim.stopped, true);
    assert.throws(() => sim.advance(1), /stopped/);
    sim.reset(); assert.equal(sim.stopped, false);
    assert.throws(() => sim.setTargets([.31, 0]), /range/); sim.reset();
    sim.kp = Infinity; assert.throws(() => sim.advance(1), /finite/); assert.equal(sim.stopped, true);
    sim.kp = 180; sim.reset(); sim.load = NaN;
    assert.throws(() => sim.advance(1), /finite/); assert.ok(engine.data.ctrl.every(value => value === 0));
    sim.reset(); sim.targets[1] = NaN;
    assert.throws(() => sim.advance(1), /finite/);
    sim.reset(); engine.data.qvel[0] = NaN;
    assert.equal(sim.read().finite, false); assert.equal(sim.stopped, true);
    sim.reset(); assert.equal(sim.advance(1).finite, true);
    sim.kp = PD_LIMITS.limx.kp[1] + 1;
    assert.throws(() => sim.advance(1), /tested range/); assert.equal(sim.stopped, true);
    sim.kp = 180; sim.reset(); sim.kd = PD_LIMITS.limx.kd[1] + 1;
    assert.throws(() => sim.advance(1), /tested range/);
    sim.kd = 6; sim.reset();
    engine.destroy(); assert.throws(() => sim.advance(1), /disposed/);
  } finally {engine.destroy();}
});

test('tested gain-range corners settle after target reversal and ±2 Nm external loads', async () => {
  for (const kind of ['limx', 'teaching']) {
    const {engine, sim} = await fixture(kind);
    try {
      const range = PD_LIMITS[kind], amplitude = kind === 'limx' ? .3 : .6;
      const steps = kind === 'limx' ? 3000 : 1500;
      for (const kp of range.kp) for (const kd of range.kd) for (const load of [-2, 2]) {
        sim.reset(); sim.kp = kp; sim.kd = kd;
        for (const sign of [1, -1]) {
          sim.setTargets([amplitude * sign, -amplitude * sign]); sim.load = load;
          let maxTailVelocity = 0, maxClosure = 0, maxTailClosure = 0;
          for (let i = 0; i < steps; i += 10) {
            const state = sim.advance(10);
            assert.equal(state.finite, true);
            maxClosure = Math.max(maxClosure, state.closure);
            if (i >= steps - 250) {
              maxTailVelocity = Math.max(maxTailVelocity, ...state.velocities.map(Math.abs));
              maxTailClosure = Math.max(maxTailClosure, state.closure);
            }
          }
          const label = JSON.stringify({kind, kp, kd, load, sign, maxTailVelocity, maxClosure, maxTailClosure});
          assert.ok(maxTailVelocity < .001, label);
          assert.ok(maxClosure < .0013, label);
          // Equality constraints are compliant: a sustained external load can
          // leave a small nonzero residual even after velocities have settled.
          assert.ok(maxTailClosure < .0002, label);
        }
      }
    } finally {engine.destroy();}
  }
});

test('the teaching UI profile rejects the known oscillatory derivative gain before stepping', async () => {
  const {engine, sim} = await fixture('teaching');
  try {
    sim.kd = 2;
    assert.throws(() => sim.advance(1), /tested range/);
    assert.equal(sim.time, 0); assert.equal(sim.stopped, true);
    sim.kd = 1; sim.reset();
    assert.equal(sim.advance(1).finite, true);
  } finally {engine.destroy();}
});

test('motor power switches remove only drive torque, preserve the instantaneous state and reset to enabled', async () => {
  for (const kind of ['limx', 'teaching']) {
    const {engine, sim} = await fixture(kind);
    try {
      for (const index of [0, 1]) {
        sim.reset(); sim.setTargets([.15, -.1]); sim.advance(40);
        const qpos = Array.from(engine.data.qpos), qvel = Array.from(engine.data.qvel);
        const qacc = Array.from(engine.data.qacc), time = sim.time;
        const otherControl = engine.data.ctrl[1 - index];
        const state = sim.setMotorEnabled(index, false);
        assert.equal(state[index], false);
        assert.deepEqual(Array.from(engine.data.qpos), qpos, 'switching power must not reposition a joint');
        assert.deepEqual(Array.from(engine.data.qvel), qvel, 'switching power must not lock or stop a joint');
        assert.deepEqual(Array.from(engine.data.qacc), qacc, 'the switch must not silently run mj_forward');
        assert.equal(sim.time, time);
        assert.equal(engine.data.ctrl[index], 0);
        assert.equal(engine.data.ctrl[1 - index], otherControl, 'the other motor command is untouched');
        const poweredOff = sim.advance(1);
        assert.equal(poweredOff.torques[index], 0);
        assert.equal(poweredOff.enabled[index], false);
        poweredOff.enabled[index] = true;
        state[index] = true;
        assert.equal(sim.read().enabled[index], false, 'read and setter return independent copies');
        assert.ok(Math.abs(poweredOff.velocities[index]) > 1e-4, 'unpowered joint remains free to move');
        const reset = sim.reset();
        assert.deepEqual(reset.enabled, [true, true]);
        assert.ok(engine.data.ctrl.every(value => value === 0));
      }
      sim.setMotorEnabled(0, false); sim.setMotorEnabled(1, false);
      const noDrive = sim.advance(30);
      assert.deepEqual(noDrive.torques, [0, 0]);
      assert.deepEqual(noDrive.enabled, [false, false]);
    } finally {engine.destroy();}
  }
});

test('changing an unpowered motor target cannot change the physical trajectory, and repowering restores tracking', async () => {
  for (const kind of ['limx', 'teaching']) {
    const {engine, sim} = await fixture(kind);
    try {
      for (const index of [0, 1]) {
        function trajectory(target, repower = false) {
          sim.reset();
          const targets = [.08, .08]; targets[index] = target;
          sim.setTargets(targets); sim.setMotorEnabled(index, false);
          const trace = [];
          for (let n = 0; n < 20; n++) {
            const state = sim.advance(10);
            assert.equal(state.torques[index], 0);
            assert.equal(engine.data.ctrl[index], 0);
            trace.push({qpos: Array.from(engine.data.qpos), qvel: Array.from(engine.data.qvel)});
          }
          if (repower) {
            const before = sim.read();
            sim.setMotorEnabled(index, true);
            assert.deepEqual(sim.read().motors, before.motors);
            assert.deepEqual(sim.read().velocities, before.velocities);
            const first = sim.advance(1);
            assert.ok(Math.abs(first.torques[index]) > .001, 'restored PD must supply a real motor torque');
            const result = run(sim, kind === 'limx' ? 3000 : 1500);
            assert.ok(result.motors.every((angle, i) => Math.abs(angle - targets[i]) < .004), JSON.stringify({kind, index, result}));
            assert.ok(result.closure < .0001);
            assert.ok(result.velocities.every(value => Math.abs(value) < .001));
            assert.deepEqual(result.enabled, [true, true]);
          }
          return trace;
        }
        const positive = trajectory(.2);
        const negative = trajectory(-.2);
        assert.deepEqual(positive, negative, `${kind} motor ${index}: disconnected target must have no causal effect`);
        const beforeRepower = trajectory(.2, true);
        assert.deepEqual(beforeRepower, positive);
      }
    } finally {engine.destroy();}
  }
});

test('invalid power switches cannot partially mutate the enabled pair or physical state', async () => {
  const {engine, sim} = await fixture();
  try {
    for (const [index, value] of [[-1, false], [2, false], [0.5, false], [NaN, true], ['0', false],
      [0, 0], [0, 1], [0, 'false'], [0, null], [0, undefined], [0, []], [0, {}]]) {
      sim.reset(); sim.setMotorEnabled(1, false); sim.advance(10);
      const enabled = [...sim.enabled], qpos = Array.from(engine.data.qpos), qvel = Array.from(engine.data.qvel), time = sim.time;
      assert.throws(() => sim.setMotorEnabled(index, value), /integer|boolean/);
      assert.deepEqual(sim.enabled, enabled);
      assert.deepEqual(Array.from(engine.data.qpos), qpos);
      assert.deepEqual(Array.from(engine.data.qvel), qvel);
      assert.equal(sim.time, time); assert.equal(sim.stopped, true);
      assert.ok(engine.data.ctrl.every(control => control === 0));
    }
    sim.reset(); sim.enabled[1] = 'false';
    assert.throws(() => sim.advance(1), /booleans/);
    assert.equal(sim.time, 0);
    sim.reset(); delete sim.enabled[0];
    assert.throws(() => sim.advance(1), /booleans/);
    sim.reset();
    assert.throws(() => sim.setTargets(new Array(2)), /finite/);
    assert.deepEqual(sim.targets, [0, 0]);
    assert.deepEqual(sim.reset().enabled, [true, true]);
    engine.destroy(); assert.throws(() => sim.setMotorEnabled(0, false), /disposed/);
  } finally {engine.destroy();}
});

test('a hidden foot actuator or a substituted position servo cannot masquerade as two passive-foot torque motors', async () => {
  for (const kind of ['limx', 'teaching']) {
    const config = kind === 'limx' ? limxConfig : teachingConfig;
    const original = kind === 'limx' ? limxXML : createTeachingMJCF();
    const xml = original.replace('</actuator>', `<motor name="hidden_foot_drive" joint="${config.footJoints[0]}"/>\n</actuator>`);
    const engine = await loadXML(xml, kind === 'limx' ? {assets: limxAssets} : {});
    try {
      assert.equal(engine.model.nu, 3);
      assert.throws(() => new MotorSimulation(engine, config), /passive.*hidden_foot_drive/);
    } finally {engine.destroy();}
  }
  const xml = createTeachingMJCF().replace('<motor name="motor_1_torque"', '<position kp="20" name="motor_1_torque"');
  const engine = await loadXML(xml);
  try { assert.throws(() => new MotorSimulation(engine, teachingConfig), /torque motor/); }
  finally {engine.destroy();}
});
