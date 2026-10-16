/** Teaching parallel ankle. SI units; theta = [roll, pitch], R = Ry(pitch) Rx(roll).
 * These dimensions are illustrative, not Unitree/LimX hardware specifications.
 */
export const DEFAULT_GEOMETRY = Object.freeze({
  name: 'teaching-parallel-ankle',
  pivot: Object.freeze([0, 0, 0]),
  A: Object.freeze([Object.freeze([0, 0.05, 0.28]), Object.freeze([0, -0.05, 0.28])]),
  C: Object.freeze([Object.freeze([0.06, 0.05, -0.015]), Object.freeze([0.06, -0.05, -0.015])]),
  crank: Object.freeze([0.04, 0.04]),
  rod: Object.freeze([Math.hypot(0.10, 0.295), Math.hypot(0.10, 0.295)]),
  branch: Object.freeze([1, 1]),
  thetaLimits: Object.freeze([Object.freeze([-0.55, 0.55]), Object.freeze([-0.70, 0.70])]),
  motorLimits: Object.freeze([Object.freeze([-1.25, 1.25]), Object.freeze([-1.25, 1.25])]),
});

const TAU = 2 * Math.PI;
const finite = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = a => Math.hypot(...a);
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const near = (angle, seed) => angle + TAU * Math.round((seed - angle) / TAU);
const inLimits = (v, limits) => v.every((x, i) => x >= limits[i][0] - 1e-10 && x <= limits[i][1] + 1e-10);

function validGeometry(g) {
  return g && finite(g.pivot, 3) && Array.isArray(g.A) && g.A.length === 2 && g.A.every(v => finite(v, 3))
    && Array.isArray(g.C) && g.C.length === 2 && g.C.every(v => finite(v, 3))
    && finite(g.crank, 2) && g.crank.every(v => v > 0)
    && finite(g.rod, 2) && g.rod.every(v => v > 0)
    && finite(g.branch, 2) && g.branch.every(v => v === 1 || v === -1)
    && ['thetaLimits', 'motorLimits'].every(k => Array.isArray(g[k]) && g[k].length === 2
      && g[k].every(v => finite(v, 2) && v[0] < v[1]));
}

/** Rotate a foot-local point into the fixed frame; no translation. */
export function rotateFoot(v, theta) {
  const [roll, pitch] = theta;
  const sr = Math.sin(roll), cr = Math.cos(roll), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const z = sr * v[1] + cr * v[2];
  return [cp * v[0] + sp * z, cr * v[1] - sr * v[2], -sp * v[0] + cp * z];
}

function footDerivatives(v, theta) {
  const [roll, pitch] = theta;
  const sr = Math.sin(roll), cr = Math.cos(roll), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const z = sr * v[1] + cr * v[2], dz = cr * v[1] - sr * v[2];
  return [[sp * dz, -sr * v[1] - cr * v[2], cp * dz],
    [-sp * v[0] + cp * z, 0, -cp * v[0] - sp * z]];
}

/** Complete endpoints in the fixed frame. Residual is the largest rod-length error, m. */
export function geometry(theta, q, g = DEFAULT_GEOMETRY) {
  if (!finite(theta, 2) || !finite(q, 2) || !validGeometry(g)) return fail('invalid-input');
  const A = g.A.map(p => [...p]);
  const B = A.map((a, i) => add(a, [-g.crank[i] * Math.cos(q[i]), 0, g.crank[i] * Math.sin(q[i])]));
  const C = g.C.map(p => add(g.pivot, rotateFoot(p, theta)));
  const rods = C.map((c, i) => sub(c, B[i]));
  const rodLengths = rods.map(norm);
  return { ok: true, A, B, C, rods, rodLengths, pivot: [...g.pivot],
    residual: Math.max(...rodLengths.map((l, i) => Math.abs(l - g.rod[i]))) };
}

/** Exact 3D length-constraint IK with a fixed assembly branch and angle unwrapping. */
export function inverseKinematics(theta, options = {}) {
  const g = options.geometry ?? DEFAULT_GEOMETRY, seed = options.seed ?? [0, 0];
  if (!finite(theta, 2) || !finite(seed, 2) || !validGeometry(g)) return fail('invalid-input');
  if (!inLimits(theta, g.thetaLimits)) return fail('foot-limit');
  const q = [], branch = [...g.branch];
  for (let i = 0; i < 2; i++) {
    const d = sub(add(g.pivot, rotateFoot(g.C[i], theta)), g.A[i]);
    const rho = Math.hypot(d[0], d[2]);
    const k = (dot(d, d) + g.crank[i] ** 2 - g.rod[i] ** 2) / (2 * g.crank[i]);
    if (rho < 1e-12) return fail('singular', { leg: i });
    const ratio = k / rho;
    if (Math.abs(ratio) > 1 + 1e-12) return fail('unreachable', { leg: i, ratio });
    if (1 - Math.abs(ratio) < 1e-12) return fail('singular', { leg: i, ratio });
    const beta = Math.atan2(d[2], -d[0]);
    const angle = beta + branch[i] * Math.acos(Math.max(-1, Math.min(1, ratio)));
    q.push(near(angle, seed[i]));
  }
  if (!inLimits(q, g.motorLimits)) return fail('motor-limit', { q, branch });
  return { ok: true, q, branch, residual: geometry(theta, q, g).residual };
}

function invert2(M) {
  const [[a, b], [c, d]] = M, det = a * d - b * c;
  const sum = a * a + b * b + c * c + d * d;
  const largest = (sum + Math.sqrt(Math.max(0, sum * sum - 4 * det * det))) / 2;
  const condition = largest > 0 && det !== 0 ? largest / Math.abs(det) : Infinity;
  if (!Number.isFinite(condition) || condition > 1e8) return fail('singular', { det, condition });
  return { ok: true, inverse: [[d / det, -b / det], [-c / det, a / det]], det, condition };
}
const multiply2 = (M, v) => M.map(row => dot(row, v));

/** J = dq/dtheta. Differentiate |C(theta)-B(q)|^2 = L^2: A thetaDot = D qDot. */
export function jacobian(theta, q, options = {}) {
  const g = options.geometry ?? DEFAULT_GEOMETRY;
  const points = geometry(theta, q, g);
  if (!points.ok) return points;
  if (points.residual > (options.constraintTolerance ?? 1e-6)) return fail('open-constraint', { residual: points.residual });
  const J = [], A = [], D = [];
  for (let i = 0; i < 2; i++) {
    const derivatives = footDerivatives(g.C[i], theta);
    const row = derivatives.map(v => dot(points.rods[i], v));
    const denom = dot(points.rods[i], [g.crank[i] * Math.sin(q[i]), 0, g.crank[i] * Math.cos(q[i])]);
    if (Math.abs(denom) / (g.rod[i] * g.crank[i]) < 1e-7) return fail('singular', { leg: i });
    A.push(row); D.push(denom); J.push(row.map(x => x / denom));
  }
  const inv = invert2(J);
  return inv.ok ? { ...inv, J, A, D } : inv;
}

/** Damped Newton FK on the two rod constraints. Seed selects the nearby foot branch. */
export function forwardKinematics(q, options = {}) {
  const g = options.geometry ?? DEFAULT_GEOMETRY;
  const seed = options.seed ?? [0, 0];
  if (!finite(q, 2) || !finite(seed, 2) || !validGeometry(g)) return fail('invalid-input');
  let theta = [...seed];
  if (!inLimits(q, g.motorLimits)) return fail('motor-limit');
  if (!inLimits(theta, g.thetaLimits)) return fail('foot-limit');
  const tolerance = options.tolerance ?? 1e-10, maxIterations = options.maxIterations ?? 60;
  if (!Number.isFinite(tolerance) || !(tolerance > 0) || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 1000) return fail('invalid-input');
  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    const points = geometry(theta, q, g);
    if (points.residual <= tolerance) {
      const ik = inverseKinematics(theta, { seed: q, geometry: g });
      if (!ik.ok) return { ...ik, theta, residual: points.residual, iterations: iteration };
      const motorResidual = Math.max(...ik.q.map((x, i) => Math.abs(x - q[i])));
      if (motorResidual > 1e-6) return fail('assembly-branch', { theta, residual: points.residual, motorResidual });
      const j = jacobian(theta, q, { geometry: g, constraintTolerance: Math.max(1e-6, tolerance * 2) });
      if (!j.ok) return { ...j, theta, iterations: iteration };
      return { ok: true, theta, residual: points.residual, motorResidual, iterations: iteration };
    }
    if (iteration === maxIterations) return fail('no-convergence', { theta, residual: points.residual, iterations: iteration });
    const F = points.rods.map((r, i) => (dot(r, r) - g.rod[i] ** 2) / 2);
    const A = points.rods.map((r, i) => footDerivatives(g.C[i], theta).map(v => dot(r, v)));
    const inverse = invert2(A);
    if (!inverse.ok) return { ...inverse, theta, iterations: iteration };
    let step = multiply2(inverse.inverse, F).map(x => -x);
    const maxStep = Math.max(...step.map(Math.abs));
    if (maxStep > 0.2) step = step.map(x => x * 0.2 / maxStep);
    let accepted = false;
    for (let damping = 1; damping >= 1 / 65536; damping /= 2) {
      const candidate = theta.map((x, i) => x + damping * step[i]);
      if (!inLimits(candidate, g.thetaLimits)) continue;
      if (geometry(candidate, q, g).residual < points.residual) {
        theta = candidate; accepted = true; break;
      }
    }
    if (!accepted) return fail('no-convergence', { theta, residual: points.residual, iterations: iteration });
  }
}

/** Desired generalized foot torque -> motor torque: tauQ = J^(-T) tauTheta. */
export function motorTorques(theta, q, tauTheta, options = {}) {
  if (!finite(tauTheta, 2)) return fail('invalid-input');
  const j = jacobian(theta, q, options);
  if (!j.ok) return j;
  const K = j.inverse;
  return { ...j, tauQ: [K[0][0] * tauTheta[0] + K[1][0] * tauTheta[1],
    K[0][1] * tauTheta[0] + K[1][1] * tauTheta[1]] };
}

/** World angular velocity differs from Euler-angle rates for nonzero pitch. */
export function worldAngularVelocity(theta, thetaDot) {
  if (!finite(theta, 2) || !finite(thetaDot, 2)) return fail('invalid-input');
  return { ok: true, omega: [Math.cos(theta[1]) * thetaDot[0], thetaDot[1], -Math.sin(theta[1]) * thetaDot[0]] };
}
