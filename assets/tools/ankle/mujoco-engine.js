/**
 * Small, renderer-independent adapter for the official MuJoCo WASM bindings.
 * World coordinates are MuJoCo's Z-up meters; joint angles are radians;
 * quaternions are [w, x, y, z]; 3x3 matrices are row-major.
 * Importing this file does not fetch or instantiate the 10 MB WASM runtime.
 */
export const MUJOCO_VERSION = '3.14.0';
export const GEOM_TYPES = Object.freeze({
  0: 'plane', 1: 'hfield', 2: 'sphere', 3: 'capsule', 4: 'ellipsoid',
  5: 'cylinder', 6: 'box', 7: 'mesh', 8: 'sdf',
});

const OBJECT = { body: 1, joint: 3, geom: 5, site: 6, actuator: 19 };
const JOINT_TYPES = ['free', 'ball', 'slide', 'hinge'];
let runtimePromise;

export async function loadMujocoRuntime() {
  if (!runtimePromise) {
    runtimePromise = import('../../vendor/mujoco/mujoco.js')
      .then(({ default: loadMujoco }) => loadMujoco())
      .catch(error => { runtimePromise = undefined; throw error; });
  }
  return runtimePromise;
}

const valuesAt = (array, id, width) => Array.from(array.subarray(id * width, (id + 1) * width));

function finiteVector(value, length, label) {
  const result = typeof value === 'number' ? [value] : Array.from(value ?? []);
  if (result.length !== length || result.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new TypeError(`${label} needs ${length} finite number${length === 1 ? '' : 's'}.`);
  }
  return result;
}

function normalizedJoint(value, joint) {
  const result = finiteVector(value, joint.width, `Joint ${joint.name}`);
  const offset = joint.type === 'ball' ? 0 : joint.type === 'free' ? 3 : -1;
  if (offset >= 0) {
    const length = Math.hypot(...result.slice(offset, offset + 4));
    if (length < 1e-12) throw new RangeError(`Joint ${joint.name} needs a nonzero quaternion.`);
    for (let i = offset; i < offset + 4; i++) result[i] /= length;
  }
  return result;
}

function assetBytes(value) {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('MJCF assets must be strings, ArrayBuffers or typed arrays.');
}

/** Compile XML and optional local assets into a model. Nothing is fetched implicitly. */
export async function loadXML(xml, { assets = {} } = {}) {
  if (typeof xml !== 'string' || !xml.trim()) throw new TypeError('A nonempty MJCF XML string is required.');
  const module = await loadMujocoRuntime();
  let model;
  let data;
  let vfs;
  try {
    const entries = assets instanceof Map ? [...assets] : Object.entries(assets);
    if (entries.length) {
      vfs = new module.MjVFS();
      for (const [name, value] of entries) {
        if (typeof name !== 'string' || !name || name.includes('\0') || /^(?:[\\/]|[a-z]:)/i.test(name) || /(^|[\\/])\.\.([\\/]|$)/.test(name)) {
          throw new TypeError('Asset names must be relative MJCF paths without traversal.');
        }
        vfs.addBuffer(name, assetBytes(value));
      }
    }
    model = vfs ? module.MjModel.from_xml_string(xml, vfs) : module.MjModel.from_xml_string(xml);
    data = new module.MjData(model);
    module.mj_forward(model, data);
    return makeEngine(module, model, data);
  } catch (error) {
    data?.delete();
    model?.delete();
    throw new Error(`MuJoCo could not load the model: ${error?.message || String(error)}`, { cause: error });
  } finally {
    // MuJoCo's compiler copies asset data into the model; VFS is no longer needed.
    vfs?.delete();
  }
}

export const createMujocoEngine = loadXML;

function makeEngine(module, model, data) {
  let disposed = false;
  const options = model.opt;
  const timestep = options.timestep;
  options.delete();
  const requireLive = () => { if (disposed) throw new Error('This MuJoCo model has been disposed.'); };
  const nameOf = (kind, id) => module.mj_id2name(model, OBJECT[kind], id) || `${kind}_${id}`;
  const booleanField = (kind, id, field) => {
    // 3.14.0's bulk bool-array views lack an Embind registration. The official
    // named accessors expose the same scalar field correctly; free the handle.
    const accessor = model[kind](id);
    try { return Boolean(accessor[field]); } finally { accessor.delete(); }
  };
  const joints = Array.from({ length: model.njnt }, (_, id) => {
    const type = JOINT_TYPES[model.jnt_type[id]];
    return Object.freeze({
      id, name: nameOf('joint', id), type,
      width: type === 'free' ? 7 : type === 'ball' ? 4 : 1,
      qposAddress: model.jnt_qposadr[id], dofAddress: model.jnt_dofadr[id],
      dofWidth: type === 'free' ? 6 : type === 'ball' ? 3 : 1,
      limited: booleanField('jnt', id, 'limited'), range: valuesAt(model.jnt_range, id, 2),
    });
  });
  const jointByName = new Map(joints.map(joint => [joint.name, joint]));
  const bodies = Array.from({ length: model.nbody }, (_, id) => ({ id, name: nameOf('body', id), parentId: model.body_parentid[id] }));
  const geoms = Array.from({ length: model.ngeom }, (_, id) => ({
    id, name: nameOf('geom', id), bodyId: model.geom_bodyid[id],
    typeId: model.geom_type[id], type: GEOM_TYPES[model.geom_type[id]] || 'unknown',
    meshId: model.geom_type[id] === 7 ? model.geom_dataid[id] : -1,
    size: valuesAt(model.geom_size, id, 3), rgba: valuesAt(model.geom_rgba, id, 4),
  }));
  const sites = Array.from({ length: model.nsite }, (_, id) => ({ id, name: nameOf('site', id), bodyId: model.site_bodyid[id] }));
  const actuators = Array.from({ length: model.nu }, (_, id) => ({
    id, name: nameOf('actuator', id), limited: booleanField('actuator', id, 'ctrllimited'),
    range: valuesAt(model.actuator_ctrlrange, id, 2),
  }));
  const actuatorByName = new Map(actuators.map(actuator => [actuator.name, actuator]));

  function getJoint(name) {
    requireLive();
    const joint = typeof name === 'number' ? joints[name] : jointByName.get(name);
    if (!joint) throw new RangeError(`Unknown MuJoCo joint: ${String(name)}`);
    return {
      ...joint,
      qpos: Array.from(data.qpos.subarray(joint.qposAddress, joint.qposAddress + joint.width)),
      qvel: Array.from(data.qvel.subarray(joint.dofAddress, joint.dofAddress + joint.dofWidth)),
    };
  }

  function getBodyPose(name) {
    requireLive();
    const id = typeof name === 'number' ? name : module.mj_name2id(model, OBJECT.body, name);
    if (!Number.isInteger(id) || !bodies[id]) throw new RangeError(`Unknown MuJoCo body: ${String(name)}`);
    return { ...bodies[id], pos: valuesAt(data.xpos, id, 3), quat: valuesAt(data.xquat, id, 4), mat: valuesAt(data.xmat, id, 9) };
  }

  function getGeomPoses() {
    requireLive();
    return geoms.map(geom => ({ ...geom, pos: valuesAt(data.geom_xpos, geom.id, 3), mat: valuesAt(data.geom_xmat, geom.id, 9) }));
  }

  function getSitePoses() {
    requireLive();
    return sites.map(site => ({ ...site, pos: valuesAt(data.site_xpos, site.id, 3), mat: valuesAt(data.site_xmat, site.id, 9) }));
  }

  function getState() {
    requireLive();
    return {
      time: data.time, qpos: Array.from(data.qpos), qvel: Array.from(data.qvel),
      bodies: bodies.map(body => getBodyPose(body.id)), geoms: getGeomPoses(), sites: getSitePoses(),
      actuators: getActuatorStates(), constraints: getConstraintState(),
    };
  }

  function getActuatorStates() {
    requireLive();
    return actuators.map(actuator => ({
      ...actuator, control: data.ctrl[actuator.id], force: data.actuator_force[actuator.id],
      length: data.actuator_length[actuator.id], velocity: data.actuator_velocity[actuator.id],
    }));
  }

  function getConstraintState() {
    requireLive();
    const equalityRows = [];
    let maxAbsEqualityResidual = 0;
    for (let row = 0; row < data.nefc; row++) {
      if (data.efc_type[row] !== 0) continue;
      const residual = data.efc_pos[row];
      maxAbsEqualityResidual = Math.max(maxAbsEqualityResidual, Math.abs(residual));
      equalityRows.push({ row, equalityId: data.efc_id[row], residual, force: data.efc_force[row] });
    }
    // Units follow each constraint: connect rows are meters, weld mixes position/rotation.
    return { count: data.nefc, equalityRows, maxAbsEqualityResidual };
  }

  function setControls(values, { clamp = true } = {}) {
    requireLive();
    const updates = Object.entries(values).map(([name, value]) => {
      const actuator = actuatorByName.get(name);
      if (!actuator) throw new RangeError(`Unknown MuJoCo actuator: ${name}`);
      let [control] = finiteVector(value, 1, `Actuator ${name}`);
      if (actuator.limited) {
        if (clamp) control = Math.max(actuator.range[0], Math.min(actuator.range[1], control));
        else if (control < actuator.range[0] || control > actuator.range[1]) throw new RangeError(`Actuator ${name} control is out of range.`);
      }
      return { id: actuator.id, control };
    });
    for (const { id, control } of updates) data.ctrl[id] = control;
    return getActuatorStates();
  }

  function forward() {
    requireLive();
    module.mj_forward(model, data);
    return getState();
  }

  function setNamedJoints(values, { zeroVelocity = true } = {}) {
    requireLive();
    // Validate all input before changing the state, so a typo cannot partly move a model.
    const updates = Object.entries(values).map(([name, value]) => {
      const joint = getJoint(name);
      return { joint, value: normalizedJoint(value, joint) };
    });
    for (const update of updates) data.qpos.set(update.value, update.joint.qposAddress);
    if (zeroVelocity) data.qvel.fill(0);
    return forward();
  }

  function setQpos(values, { zeroVelocity = true } = {}) {
    requireLive();
    const result = finiteVector(values, model.nq, 'qpos');
    for (const joint of joints) {
      const value = normalizedJoint(result.slice(joint.qposAddress, joint.qposAddress + joint.width), joint);
      result.splice(joint.qposAddress, joint.width, ...value);
    }
    data.qpos.set(result);
    if (zeroVelocity) data.qvel.fill(0);
    return forward();
  }

  function step(count = 1) {
    requireLive();
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new RangeError('Step count must be an integer from 1 to 1000.');
    for (let i = 0; i < count; i++) module.mj_step(model, data);
    // mj_step integrates qpos after its position stage; refresh render transforms.
    return forward();
  }

  function reset() {
    requireLive();
    module.mj_resetData(model, data);
    return forward();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    data.delete();
    model.delete();
  }

  return {
    module, model, data, version: module.mj_versionString(), timestep, joints, actuators,
    get disposed() { return disposed; },
    getJoint, getBodyPose, getGeomPoses, getSitePoses, getState, getActuatorStates, getConstraintState,
    setControls, setNamedJoints, setQpos, forward, step, reset, dispose, destroy: dispose,
  };
}
