import assert from 'node:assert/strict';
import { DEFAULT_GEOMETRY as g, geometry, inverseKinematics as ik, forwardKinematics as fk,
  jacobian, motorTorques, worldAngularVelocity } from '../assets/tools/ankle/ankle-math.js';
import { mujocoConfiguration } from '../assets/tools/ankle/ankle-model.js';

const close = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} != ${b} (tolerance ${e})`);
const mul = (M, v) => M.map(r => r.reduce((s, x, i) => s + x * v[i], 0));
let randomSeed = 491;
const random = () => ((randomSeed = (1664525 * randomSeed + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
function quaternionRotate(q, v) {
  const [w, x, y, z] = q;
  return mul([[1 - 2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
    [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
    [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]], v);
}
let poses = 0;
for (let roll = -0.20; roll <= 0.20 + 1e-8; roll += 0.05) {
  for (let pitch = -0.30; pitch <= 0.30 + 1e-8; pitch += 0.05) {
    const theta = [roll, pitch], result = ik(theta);
    assert.ok(result.ok, JSON.stringify({theta, result}));
    assert.ok(result.residual < 1e-12);
    const solved = fk(result.q);
    assert.ok(solved.ok, JSON.stringify({theta, solved}));
    solved.theta.forEach((x, i) => close(x, theta[i], 1e-7));
    const j = jacobian(theta, result.q);
    assert.ok(j.ok);
    for (let column = 0; column < 2; column++) {
      const plus = [...theta], minus = [...theta];
      plus[column] += 1e-6; minus[column] -= 1e-6;
      const a = ik(plus, {seed: result.q}), b = ik(minus, {seed: result.q});
      assert.ok(a.ok && b.ok);
      for (let row = 0; row < 2; row++) close(j.J[row][column], (a.q[row] - b.q[row]) / 2e-6, 1e-7);
    }
    const rates = [random()*0.3, random()*0.3], motorRates = mul(j.J, rates), requestedTorque = [random()*8, random()*8];
    const torque = motorTorques(theta, result.q, requestedTorque);
    assert.ok(torque.ok);
    close(torque.tauQ.reduce((s, x, i) => s + x * motorRates[i], 0), requestedTorque.reduce((s, x, i) => s + x * rates[i], 0));
    const plusTheta = theta.map((x, i) => x + 1e-6 * rates[i]);
    const plusQ = result.q.map((x, i) => x + 1e-6 * motorRates[i]);
    assert.ok(geometry(plusTheta, plusQ).residual < 1e-12, 'first-order rod constraint');
    // Initializing arbitrary closed poses also requires the rods' ball quaternions.
    const config = mujocoConfiguration(theta, result.q);
    assert.ok(config.ok);
    const neutral = geometry([0, 0], [0, 0]), current = geometry(theta, result.q);
    for (let i = 0; i < 2; i++) {
      const local = quaternionRotate(config.joints[`rod_ball_${i+1}`], neutral.rods[i]);
      const c = Math.cos(result.q[i]), s = Math.sin(result.q[i]);
      const world = [c*local[0]+s*local[2], local[1], -s*local[0]+c*local[2]];
      world.forEach((v, j) => close(v, current.rods[i][j], 1e-10));
    }
    poses++;
  }
}

// Continuous fixed assembly branch across a complete smooth trajectory.
let seed = [0, 0];
for (let n = 0; n <= 400; n++) {
  const t = n / 400 * Math.PI * 2, result = ik([0.20 * Math.sin(t), 0.25 * Math.cos(t)], {seed});
  assert.ok(result.ok);
  if (n) result.q.forEach((q, i) => assert.ok(Math.abs(q - seed[i]) < 0.02));
  seed = result.q;
}

// No NaNs, forced projection or silent branch swaps on invalid/degenerate inputs.
assert.equal(ik([NaN, 0]).reason, 'invalid-input');
assert.equal(fk([0, Infinity]).reason, 'invalid-input');
assert.equal(fk([0, 0], {seed: 2}).reason, 'invalid-input');
assert.equal(fk([0, 0], {tolerance: Infinity}).reason, 'invalid-input');
assert.equal(ik([1, 0]).reason, 'foot-limit');
assert.equal(fk([2, 0]).reason, 'motor-limit');
assert.equal(ik([0, 0], {geometry: {...g, rod: [0.001, 0.001]}}).reason, 'unreachable');
assert.equal(jacobian([0, 0], [0.2, -0.1]).reason, 'open-constraint');
const singularGeometry = {...g, C: [[0.06, 0, -0.015], [0.06, 0, -0.015]],
  A: [[0, 0, 0.28], [0, 0, 0.28]]};
assert.equal(jacobian([0, 0], [0, 0], {geometry: singularGeometry}).reason, 'singular');
const alternateGeometry = {...g, motorLimits: [[-4, 4], [-4, 4]], branch: [-1, -1]};
const alternate = ik([0, 0], {geometry: alternateGeometry});
assert.ok(alternate.ok);
assert.equal(fk(alternate.q, {geometry: {...alternateGeometry, branch: [1, 1]}}).reason, 'assembly-branch');
const angular = worldAngularVelocity([0.3, 0.2], [0.7, -0.4]);
assert.ok(angular.ok); close(angular.omega[1], -0.4); close(Math.hypot(angular.omega[0], angular.omega[2]), 0.7);
console.log(`Ankle mathematics: ${poses} IK/FK poses, central-difference Jacobians, first-order constraints, virtual work, continuous branches, invalid/singular cases passed.`);
