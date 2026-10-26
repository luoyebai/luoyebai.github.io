import { DEFAULT_GEOMETRY, geometry, inverseKinematics } from './ankle-math.js';

export const TEACHING_MODEL = Object.freeze({
  motors: Object.freeze(['motor_1', 'motor_2']),
  actuators: Object.freeze(['motor_1_torque', 'motor_2_torque']),
  controller: Object.freeze({ kp: 80, kd: 1, torqueLimit: 8, targetRange: [-0.60, 0.60] }),
  foot: Object.freeze({ roll: 'ankle_roll', pitch: 'ankle_pitch', body: 'foot' }),
  constraints: Object.freeze(['rod_1_closure', 'rod_2_closure']),
  sites: Object.freeze({ A: ['motor_A_1', 'motor_A_2'], B: ['crank_B_1', 'crank_B_2'],
    C: ['foot_C_1', 'foot_C_2'], rodEnds: ['rod_end_1', 'rod_end_2'], pivot: 'ankle_pivot' }),
});

const vector = v => v.map(x => Number(x.toPrecision(14))).join(' ');

/** Two actuated cranks + two rigid rods + a passive two-axis foot.
 * All sizes/masses/gains are educational; this is not a calibrated hardware model.
 * The foot is NEVER actuated. Six scalar connect equations close two ball-jointed rods.
 */
export function createTeachingMJCF(options = {}) {
  const g = DEFAULT_GEOMETRY;
  const gravity = options.gravity ?? [0, 0, -9.81];
  if (!Array.isArray(gravity) || gravity.length !== 3 || !gravity.every(Number.isFinite)) throw new TypeError('Invalid model parameters');
  const neutral = geometry([0, 0], [0, 0]);
  const motorBodies = [0, 1].map(i => {
    const n = i + 1, rod = neutral.rods[i];
    return `<body name="crank_${n}" pos="${vector(g.A[i])}">
      <joint name="motor_${n}" type="hinge" axis="0 1 0" range="${vector(g.motorLimits[i])}" damping="0.04" armature="0.001"/>
      <geom name="crank_geom_${n}" type="capsule" fromto="0 0 0 ${-g.crank[i]} 0 0" size="0.007" mass="0.06" rgba="${i ? '0.96 0.61 0.22 1' : '0.24 0.76 0.92 1'}"/>
      <geom name="rotor_${n}" type="cylinder" fromto="0 -0.012 0 0 0.012 0" size="0.015" mass="0.08" rgba="0.33 0.39 0.49 1"/>
      <site name="motor_A_${n}" pos="0 0 0"/>
      <site name="crank_B_${n}" pos="${-g.crank[i]} 0 0"/>
      <body name="rod_${n}" pos="${-g.crank[i]} 0 0">
        <joint name="rod_ball_${n}" type="ball" limited="false" damping="0.002"/>
        <geom name="rod_geom_${n}" type="capsule" fromto="0 0 0 ${vector(rod)}" size="0.0045" mass="0.055" rgba="${i ? '0.96 0.61 0.22 1' : '0.24 0.76 0.92 1'}"/>
        <site name="rod_end_${n}" pos="${vector(rod)}"/>
      </body>
    </body>`;
  }).join('\n');
  return `<mujoco model="Teaching closed-loop parallel ankle">
  <compiler angle="radian" autolimits="true"/>
  <option timestep="0.002" gravity="${vector(gravity)}" integrator="implicitfast" solver="Newton" iterations="80" tolerance="1e-10"/>
  <default>
    <geom contype="0" conaffinity="0" friction="0.8 0.01 0.001"/>
    <site size="0.006" rgba="0.95 0.95 1 1"/>
    <joint limited="true"/>
  </default>
  <worldbody>
    <light pos="0.3 -0.4 0.6" dir="-0.4 0.4 -1"/>
    <geom name="fixed_shin" type="capsule" fromto="-0.025 0 0.035 -0.025 0 0.31" size="0.012" rgba="0.24 0.28 0.35 0.75"/>
    <geom name="motor_bracket" type="capsule" fromto="0 -0.07 0.28 0 0.07 0.28" size="0.008" rgba="0.4 0.45 0.55 1"/>
    <site name="ankle_pivot" pos="0 0 0"/>
    ${motorBodies}
    <body name="pitch_carrier">
      <joint name="ankle_pitch" type="hinge" axis="0 1 0" range="${vector(g.thetaLimits[1])}" damping="0.04"/>
      <geom name="pitch_hub" type="sphere" size="0.012" mass="0.05" rgba="0.7 0.75 0.82 1"/>
      <body name="foot">
        <joint name="ankle_roll" type="hinge" axis="1 0 0" range="${vector(g.thetaLimits[0])}" damping="0.04"/>
        <geom name="foot_plate" type="box" pos="0.025 0 -0.02" size="0.10 0.062 0.012" mass="0.7" rgba="0.39 0.65 0.83 1"/>
        <geom name="roll_axle" type="capsule" fromto="-0.035 0 0 0.045 0 0" size="0.008" mass="0.04" rgba="0.72 0.78 0.87 1"/>
        <site name="foot_C_1" pos="${vector(g.C[0])}"/>
        <site name="foot_C_2" pos="${vector(g.C[1])}"/>
      </body>
    </body>
  </worldbody>
  <equality>
    <connect name="rod_1_closure" site1="rod_end_1" site2="foot_C_1" solref="0.006 1" solimp="0.99 0.9999 0.001"/>
    <connect name="rod_2_closure" site1="rod_end_2" site2="foot_C_2" solref="0.006 1" solimp="0.99 0.9999 0.001"/>
  </equality>
  <actuator>
    <motor name="motor_1_torque" joint="motor_1" gear="1" ctrlrange="-8 8"/>
    <motor name="motor_2_torque" joint="motor_2" gear="1" ctrlrange="-8 8"/>
  </actuator>
</mujoco>`;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function quaternionBetween(a, b) {
  const al = Math.hypot(...a), bl = Math.hypot(...b);
  const u = a.map(x => x / al), v = b.map(x => x / bl);
  const scalar = 1 + u.reduce((s, x, i) => s + x * v[i], 0);
  if (scalar < 1e-12) {
    let axis = cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    const length = Math.hypot(...axis); axis = axis.map(x => x / length);
    return [0, ...axis];
  }
  const quat = [scalar, ...cross(u, v)], length = Math.hypot(...quat);
  return quat.map(x => x / length);
}

/** For reset/initialization ONLY; normal animation must use actuators + mj_step.
 * MuJoCo ball-joint quaternions use [w,x,y,z].
 */
export function mujocoConfiguration(theta, q = null) {
  const ik = q === null ? inverseKinematics(theta) : { ok: true, q };
  if (!ik.ok) return ik;
  const points = geometry(theta, ik.q);
  if (!points.ok) return points;
  if (points.residual > 1e-7) return { ok: false, reason: 'open-constraint', residual: points.residual };
  const neutral = geometry([0, 0], [0, 0]);
  const joints = { ankle_roll: theta[0], ankle_pitch: theta[1], motor_1: ik.q[0], motor_2: ik.q[1] };
  points.rods.forEach((r, i) => {
    const c = Math.cos(ik.q[i]), s = Math.sin(ik.q[i]);
    const localRod = [c * r[0] - s * r[2], r[1], s * r[0] + c * r[2]];
    joints[`rod_ball_${i + 1}`] = quaternionBetween(neutral.rods[i], localRod);
  });
  return { ok: true, joints, q: [...ik.q], theta: [...theta] };
}
