/** Tested UI ranges for these exact models/timesteps, not robot firmware limits.
 * The light teaching crank at 2 ms develops a sampled-control limit cycle when
 * explicit derivative gain is too high; increasing kd is not always stabilizing. */
export const PD_LIMITS = Object.freeze({
  limx: Object.freeze({kp: Object.freeze([40, 300]), kd: Object.freeze([1, 12])}),
  teaching: Object.freeze({kp: Object.freeze([20, 160]), kd: Object.freeze([0.1, 1.2])}),
});

/** Motor-space PD controller for the real MuJoCo model. Foot and rod qpos are
 * never assigned here: passive motion is produced by mj_step and loop constraints. */
export class MotorSimulation {
  constructor(engine, {
    motorJoints, actuatorNames, footJoints,
    kp = 180, kd = 6, torqueLimit = 42, targetLimit = 0.3, gainLimits = null,
  } = {}) {
    if (!engine?.module || !engine.model || !engine.data || engine.disposed) throw new TypeError('A live MuJoCo engine is required.');
    const pair = (value, label) => {
      if (!Array.isArray(value) || value.length !== 2 || value.some(name => typeof name !== 'string' || !name) || value[0] === value[1]) {
        throw new TypeError(`${label} must contain two distinct joint or actuator names.`);
      }
      return [...value];
    };
    this.engine = engine;
    this.motorJoints = pair(motorJoints, 'motorJoints');
    this.actuatorNames = pair(actuatorNames, 'actuatorNames');
    this.footJoints = pair(footJoints, 'footJoints [roll,pitch]');
    this._motors = this.motorJoints.map(name => engine.getJoint(name));
    this._foot = this.footJoints.map(name => engine.getJoint(name));
    if ([...this._motors, ...this._foot].some(joint => joint.type !== 'hinge')) throw new TypeError('Motor and foot joints must be hinges.');
    if (this.footJoints.some(name => this.motorJoints.includes(name))) throw new TypeError('Foot joints must be passive and distinct from motor joints.');
    const footIds = new Set(this._foot.map(joint => joint.id));
    for (const actuator of engine.actuators) {
      // MuJoCo transmission 0/1 means joint / joint-in-parent. Inspect every
      // actuator, not only the two selected motors: a hidden foot servo would
      // invalidate the motor -> rod -> passive-foot comparison.
      const transmission = engine.model.actuator_trntype[actuator.id];
      if ((transmission === 0 || transmission === 1)
        && footIds.has(engine.model.actuator_trnid[actuator.id * 2])) {
        throw new TypeError(`Foot joints must be passive; actuator ${actuator.name} directly drives a foot joint.`);
      }
    }
    this._actuators = this.actuatorNames.map((name, index) => {
      const actuator = engine.actuators.find(item => item.name === name);
      if (!actuator) throw new RangeError(`Unknown actuator: ${name}`);
      if (engine.model.actuator_trntype[actuator.id] !== 0
        || engine.model.actuator_trnid[actuator.id * 2] !== this._motors[index].id) throw new TypeError(`Actuator ${name} must drive its matching motor joint.`);
      if (engine.model.actuator_dyntype[actuator.id] !== 0 || engine.model.actuator_gaintype[actuator.id] !== 0
        || engine.model.actuator_biastype[actuator.id] !== 0 || engine.model.actuator_gainprm[actuator.id * 10] !== 1
        || engine.model.actuator_gear[actuator.id * 6] !== 1) {
        throw new TypeError(`Actuator ${name} must be a direct unit-gear torque motor, not a position or velocity servo.`);
      }
      return actuator;
    });
    this.targets = [0, 0];
    this.enabled = [true, true];
    this.kp = kp; this.kd = kd; this.torqueLimit = torqueLimit; this.targetLimit = targetLimit;
    if (gainLimits !== null && ['kp', 'kd'].some(key => !Array.isArray(gainLimits[key]) || gainLimits[key].length !== 2
      || !gainLimits[key].every(Number.isFinite) || gainLimits[key][0] < 0 || gainLimits[key][0] > gainLimits[key][1])) {
      throw new TypeError('gainLimits must contain finite increasing kp and kd ranges.');
    }
    this.gainLimits = gainLimits === null ? null : Object.freeze({kp: Object.freeze([...gainLimits.kp]), kd: Object.freeze([...gainLimits.kd])});
    this.load = 0;
    this.stopped = false;
    this.error = '';
    this._validateSettings();
  }

  get time() { return this.engine.data.time; }

  _live() {
    if (this.engine.disposed) throw new Error('The MuJoCo model has been disposed.');
    if (this.stopped) throw new Error(`Simulation stopped: ${this.error} Reset before resuming.`);
  }

  _halt(message) {
    this.stopped = true; this.error = message;
    if (!this.engine.disposed) {
      this.engine.data.ctrl.fill(0);
      this.engine.data.qfrc_applied.fill(0);
      this.engine.data.xfrc_applied.fill(0);
    }
  }

  _reject(message, Type = RangeError) {
    this._halt(message);
    throw new Type(message);
  }

  _validateSettings() {
    if (![this.kp, this.kd, this.torqueLimit, this.targetLimit, this.load].every(value => typeof value === 'number' && Number.isFinite(value))) {
      this._reject('Controller gains, limits and load must be finite numbers.', TypeError);
    }
    if (this.kp < 0 || this.kd < 0 || this.torqueLimit <= 0 || this.targetLimit <= 0) {
      this._reject('Gains must be nonnegative and controller limits positive.');
    }
    if (this.gainLimits && ['kp', 'kd'].some(key => this[key] < this.gainLimits[key][0] || this[key] > this.gainLimits[key][1])) {
      this._reject('PD gains are outside this model\'s tested range. Restore a supported gain and reset.');
    }
    if (!Array.isArray(this.enabled) || this.enabled.length !== 2 || [0, 1].some(index => typeof this.enabled[index] !== 'boolean')) {
      this._reject('Motor enabled state must contain two booleans.', TypeError);
    }
    this._validateTargets(this.targets);
  }

  _validateTargets(values) {
    if (!Array.isArray(values) || values.length !== 2 || [0, 1].some(index => typeof values[index] !== 'number' || !Number.isFinite(values[index]))) {
      this._reject('Motor targets must contain two finite angles.', TypeError);
    }
    for (let i = 0; i < 2; i++) {
      const joint = this._motors[i];
      if (Math.abs(values[i]) > this.targetLimit || (joint.limited && (values[i] < joint.range[0] || values[i] > joint.range[1]))) {
        this._reject('Motor target is outside the configured exploration or joint range.');
      }
    }
  }

  _finiteState() {
    const {data} = this.engine;
    return Number.isFinite(data.time)
      && [data.qpos, data.qvel, data.qacc, data.actuator_force, data.qfrc_applied].every(values => values.every(Number.isFinite));
  }

  setTargets(values) {
    this._live();
    this._validateTargets(values);
    this.targets = [...values];
    return [...this.targets];
  }

  setMotorEnabled(index, enabled) {
    this._live();
    if (!Number.isInteger(index) || index < 0 || index > 1) {
      this._reject('Motor index must be the integer 0 or 1.');
    }
    if (typeof enabled !== 'boolean') this._reject('Motor enabled value must be a boolean.', TypeError);
    this._validateSettings();
    this.enabled[index] = enabled;
    // No forward/integration call and no coordinate or velocity assignment.
    // actuator_force remains the last solved force until the next physics step.
    if (!enabled) this.engine.data.ctrl[this._actuators[index].id] = 0;
    return [...this.enabled];
  }

  advance(count = 1) {
    this._live();
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('Step count must be an integer from 1 to 100.');
    this._validateSettings();
    if (!this._finiteState()) this._reject('Non-finite physics state; reset the simulation.');
    const {module, model, data} = this.engine;
    for (let step = 0; step < count; step++) {
      for (let i = 0; i < 2; i++) {
        const joint = this._motors[i], actuator = this._actuators[i];
        const torque = this.enabled[i]
          ? this.kp * (this.targets[i] - data.qpos[joint.qposAddress]) - this.kd * data.qvel[joint.dofAddress]
          : 0;
        if (!Number.isFinite(torque)) this._reject('Non-finite motor torque; reset the simulation.');
        const low = actuator.limited ? Math.max(-this.torqueLimit, actuator.range[0]) : -this.torqueLimit;
        const high = actuator.limited ? Math.min(this.torqueLimit, actuator.range[1]) : this.torqueLimit;
        data.ctrl[actuator.id] = Math.max(low, Math.min(high, torque));
      }
      // This view owns applied load: one generalized torque on passive pitch.
      data.qfrc_applied.fill(0);
      data.qfrc_applied[this._foot[1].dofAddress] = this.load;
      const previousTime = data.time;
      module.mj_step(model, data);
      if (!this._finiteState() || data.time <= previousTime) this._reject('MuJoCo became unstable; reset the simulation.');
    }
    // mj_step integrates qpos after the position stage: refresh render transforms.
    module.mj_forward(model, data);
    const result = this.read();
    if (!result.finite) throw new Error(this.error);
    return result;
  }

  reset() {
    if (this.engine.disposed) throw new Error('The MuJoCo model has been disposed.');
    const {module, model, data} = this.engine;
    module.mj_resetData(model, data);
    this.targets = [0, 0]; this.enabled = [true, true]; this.load = 0;
    this.stopped = false; this.error = '';
    data.ctrl.fill(0); data.qfrc_applied.fill(0); data.xfrc_applied.fill(0);
    module.mj_forward(model, data);
    return this.read();
  }

  read() {
    if (this.engine.disposed) throw new Error('The MuJoCo model has been disposed.');
    const {data} = this.engine;
    const closure = this.engine.getConstraintState().maxAbsEqualityResidual;
    const finite = this._finiteState() && Number.isFinite(closure);
    const state = {
      time: data.time,
      enabled: [...this.enabled],
      motors: this._motors.map(joint => data.qpos[joint.qposAddress]),
      velocities: this._motors.map(joint => data.qvel[joint.dofAddress]),
      foot: this._foot.map(joint => data.qpos[joint.qposAddress]),
      torques: this._actuators.map(actuator => data.actuator_force[actuator.id]),
      closure, finite,
    };
    if (!finite) this._halt('Non-finite physics state; reset the simulation.');
    return state;
  }
}
