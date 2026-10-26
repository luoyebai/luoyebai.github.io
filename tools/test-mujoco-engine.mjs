import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadXML, loadMujocoRuntime, MUJOCO_VERSION } from '../assets/tools/ankle/mujoco-engine.js';
import { createTeachingMJCF, TEACHING_MODEL, mujocoConfiguration } from '../assets/tools/ankle/ankle-model.js';
import { forwardKinematics } from '../assets/tools/ankle/ankle-math.js';
import { readFile } from 'node:fs/promises';

const fixture = `<mujoco model="adapter-smoke">
  <compiler angle="radian"/>
  <option timestep="0.001" gravity="0 0 0" integrator="implicitfast"/>
  <default><joint damping=".2"/><geom density="500"/></default>
  <worldbody>
    <body name="driven"><joint name="motor" axis="0 1 0"/>
      <geom name="arm" type="capsule" fromto="0 0 0 .2 0 0" size=".02"/>
      <site name="tip" pos=".2 0 0"/>
    </body>
    <body name="passive" pos="0 .2 0"><joint name="passive_hinge" axis="0 1 0"/>
      <geom name="passive_arm" type="capsule" fromto="0 0 0 .2 0 0" size=".02"/>
    </body>
  </worldbody>
  <equality><joint name="coupling" joint1="motor" joint2="passive_hinge" polycoef="0 1 0 0 0" solref=".004 1"/></equality>
  <actuator><position name="motor_servo" joint="motor" kp="20" kv="2" ctrlrange="-.5 .5" forcerange="-5 5"/></actuator>
</mujoco>`;

test('the fixed official WASM module loads and is shared by independent models', async () => {
  const [one, two] = await Promise.all([loadMujocoRuntime(), loadMujocoRuntime()]);
  assert.equal(one, two);
  assert.equal(one.mj_versionString(), MUJOCO_VERSION);
  assert.equal(typeof one.mj_step, 'function');
});

test('forward exposes true MuJoCo Z-up world transforms, named joints, sites and geoms', async () => {
  const engine = await loadXML(fixture);
  try {
    const state = engine.setNamedJoints({ motor: Math.PI / 6, passive_hinge: Math.PI / 6 });
    const pose = engine.getBodyPose('driven');
    assert.ok(Math.abs(pose.mat[0] - Math.cos(Math.PI / 6)) < 1e-12);
    assert.ok(Math.abs(pose.mat[2] - Math.sin(Math.PI / 6)) < 1e-12);
    assert.ok(Math.abs(state.sites[0].pos[2] + .1) < 1e-12);
    assert.equal(engine.getJoint('motor').qpos[0], Math.PI / 6);
    assert.equal(state.geoms.find(item => item.name === 'arm').type, 'capsule');
    assert.equal(state.constraints.equalityRows.length, 1);
  } finally { engine.dispose(); }
});

test('real integration transfers motor force to an unactuated constrained joint', async () => {
  const engine = await loadXML(fixture);
  try {
    assert.equal(engine.model.nu, 1);
    assert.equal(engine.model.nv, 2);
    engine.setControls({ motor_servo: .25 });
    engine.step(1000);
    engine.step(1000);
    const motor = engine.getJoint('motor').qpos[0];
    const passive = engine.getJoint('passive_hinge').qpos[0];
    assert.ok(Math.abs(motor - .25) < .001, `motor=${motor}`);
    assert.ok(Math.abs(passive - .25) < .001, `passive=${passive}`);
    assert.ok(engine.getConstraintState().maxAbsEqualityResidual < 1e-5);
    assert.ok(Math.abs(engine.data.time - 2) < 1e-9);
    assert.ok(Number.isFinite(engine.getActuatorStates()[0].force));
    const state = engine.reset();
    assert.equal(state.time, 0);
    assert.equal(engine.getJoint('passive_hinge').qpos[0], 0);
  } finally { engine.dispose(); }
});

test('VFS assets compile without remote fetches or filesystem writes', async () => {
  const engine = await loadXML('<mujoco><worldbody><include file="link.xml"/></worldbody></mujoco>', {
    assets: new Map([['link.xml', new TextEncoder().encode('<mujocoinclude><body name="included"><joint name="ball" type="ball"/><geom name="ball_geom" type="sphere" size=".04"/></body></mujocoinclude>')]]),
  });
  try {
    engine.setNamedJoints({ ball: [2, 0, 0, 0] });
    assert.deepEqual(engine.getJoint('ball').qpos, [1, 0, 0, 0]);
    assert.throws(() => engine.setNamedJoints({ ball: [0, 0, 0, 0] }), /nonzero quaternion/);
    assert.equal(engine.getBodyPose('included').name, 'included');
    engine.setQpos([Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    assert.ok(Math.abs(engine.getBodyPose('included').mat[0]) < 1e-12);
  } finally { engine.dispose(); }
});

test('invalid input does not partially mutate joint or actuator state', async () => {
  const engine = await loadXML(fixture);
  try {
    assert.throws(() => engine.setNamedJoints({ motor: .2, wrong_name: .2 }), /Unknown/);
    assert.equal(engine.data.qpos[0], 0);
    assert.throws(() => engine.setControls({ motor_servo: .2, wrong_name: .2 }), /Unknown/);
    assert.equal(engine.data.ctrl[0], 0);
    assert.equal(engine.setControls({ motor_servo: 3 })[0].control, .5);
    assert.throws(() => engine.setControls({ motor_servo: 3 }, { clamp: false }), /out of range/);
    assert.throws(() => engine.setQpos([NaN, 0]), /finite/);
    assert.throws(() => engine.step(1001), /Step count/);
    engine.destroy();
    engine.destroy();
    assert.equal(engine.disposed, true);
    assert.throws(() => engine.forward(), /disposed/);
  } finally { engine.dispose(); }
});

test('a rejected XML model does not poison the runtime for the next model', async () => {
  await assert.rejects(loadXML('<mujoco><nonexistent/></mujoco>'), /could not load/);
  const engine = await loadXML(fixture);
  assert.equal(engine.version, MUJOCO_VERSION);
  engine.dispose();
});

function runPD(engine, motorNames, actuatorNames, targets, kp, kd, seconds) {
  let maxResidual = 0;
  for (let i = 0; i < Math.round(seconds / engine.timestep); i++) {
    const controls = {};
    motorNames.forEach((name, index) => {
      const joint = engine.getJoint(name);
      controls[actuatorNames[index]] = kp * (targets[index] - joint.qpos[0]) - kd * joint.qvel[0];
    });
    engine.setControls(controls);
    // No qpos writes: only motor torque and genuine integration drive passive joints.
    engine.module.mj_step(engine.model, engine.data);
    maxResidual = Math.max(maxResidual, engine.getConstraintState().maxAbsEqualityResidual);
  }
  engine.forward();
  return maxResidual;
}

test('the educational ankle closes both rods and two torque motors move the passive foot', async () => {
  const engine = await loadXML(createTeachingMJCF());
  try {
    assert.equal(engine.model.nu, 2);
    assert.equal(engine.model.neq, 2);
    assert.equal(engine.model.nv, 10);
    assert.equal(engine.getConstraintState().equalityRows.length, 6);
    assert.ok(engine.getConstraintState().maxAbsEqualityResidual < 1e-12);
    const { kp, kd } = TEACHING_MODEL.controller;
    for (const targets of [[0, 0], [.2, .2], [.2, -.2], [-.2, .2], [.6, -.6]]) {
      engine.reset();
      const peak = runPD(engine, TEACHING_MODEL.motors, TEACHING_MODEL.actuators, targets, kp, kd, 3);
      const q = TEACHING_MODEL.motors.map(name => engine.getJoint(name).qpos[0]);
      const theta = [engine.getJoint('ankle_roll').qpos[0], engine.getJoint('ankle_pitch').qpos[0]];
      const predicted = forwardKinematics(q, { seed: theta });
      assert.ok(predicted.ok, JSON.stringify(predicted));
      assert.ok(q.every((value, i) => Math.abs(value - targets[i]) < .002), `motor tracking: ${q}`);
      assert.ok(theta.every((value, i) => Math.abs(value - predicted.theta[i]) < .0002), `closed-loop FK: ${theta}`);
      assert.ok(TEACHING_MODEL.motors.every(name => Math.abs(engine.getJoint(name).qvel[0]) < 1e-5), 'PD must settle, not saturate in a discrete-time limit cycle');
      assert.ok(peak < .00035, `peak closure residual: ${peak}`);
      assert.ok(engine.getConstraintState().maxAbsEqualityResidual < .00001);
      if (targets.some(value => value !== 0)) assert.ok(Math.hypot(...theta) > .1, 'passive foot should actually move');
    }
    const initial = mujocoConfiguration([.1, -.2]);
    assert.ok(initial.ok);
    engine.setNamedJoints(initial.joints);
    assert.ok(engine.getConstraintState().maxAbsEqualityResidual < 1e-12, 'reset quaternion alignment must close the rods');
  } finally { engine.dispose(); }
});

test('the official LimX ankle meshes compile and physical motors move its passive closed loop', async () => {
  const directory = new URL('../assets/tools/ankle/limx/', import.meta.url);
  const descriptor = JSON.parse(await readFile(new URL('descriptor.json', directory), 'utf8'));
  const assets = Object.fromEntries(await Promise.all(descriptor.assets.map(async name => [name, new Uint8Array(await readFile(new URL(name, directory)))])));
  const engine = await loadXML(await readFile(new URL(descriptor.model, directory), 'utf8'), { assets });
  try {
    assert.equal(engine.model.nu, 2);
    assert.equal(engine.model.neq, 2);
    assert.equal(engine.model.nmesh, 7);
    assert.equal(engine.getConstraintState().equalityRows.length, 6);
    assert.ok(engine.getConstraintState().maxAbsEqualityResidual < 1e-12);
    for (const targets of [[.3, .3], [.3, -.3], [-.3, .3]]) {
      engine.reset();
      const peak = runPD(engine, descriptor.motorJoints, descriptor.actuators, targets, descriptor.demoController.kp, descriptor.demoController.kd, 3);
      const motors = descriptor.motorJoints.map(name => engine.getJoint(name).qpos[0]);
      const foot = descriptor.footJoints.map(name => engine.getJoint(name).qpos[0]);
      assert.ok(motors.every((value, i) => Math.abs(value - targets[i]) < .0004));
      assert.ok(Math.hypot(...foot) > .1);
      assert.ok(peak < .00012, `LimX peak closure residual: ${peak}`);
      assert.ok(engine.getConstraintState().maxAbsEqualityResidual < .00001);
      assert.ok(Array.from(engine.data.qpos).every(Number.isFinite));
    }
  } finally { engine.dispose(); }
});
