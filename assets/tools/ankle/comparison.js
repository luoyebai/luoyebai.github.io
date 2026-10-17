import {MotorSimulation} from './simulation.js';

const DURATION = 2;
const AMPLITUDE = 10 * Math.PI / 180;
const BATCH_SIZE = 100;

function checkAbort(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Motor comparison was cancelled.');
  error.name = 'AbortError';
  if (signal.reason !== undefined) error.cause = signal.reason;
  throw error;
}

const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Run six independent two-second experiments using one separately owned engine.
 * createEngine must return a fresh loadXML engine, never the live viewer's engine.
 * Every case resets both motor drives and external forces; model gravity remains
 * unchanged. Only the B-off case disables a drive. Foot poses are read exclusively
 * from MotorSimulation's actual MuJoCo integration.
 *
 * State values use seconds, radians, Nm and meters. sampledMaxClosure includes the
 * reset state and batch ends, not every physics step; it is not a true peak. The
 * two-second output is a timed sample and makes no promise of steady state.
 * The model timestep must divide two seconds into whole steps; it is not changed.
 * yieldControl is awaited after every batch (at most 100 physics steps). The
 * default yields to a new task so the browser can paint and deliver cancellation.
 * Abort or any factory/controller/callback error rejects; acquired engines are
 * disposed in finally, including cancellation while their factory was loading.
 */
export async function runMotorComparison(createEngine, config, {signal, onProgress, yieldControl = yieldTask} = {}) {
  if (typeof createEngine !== 'function') throw new TypeError('createEngine must be a function returning a fresh MuJoCo engine.');
  if (typeof yieldControl !== 'function') throw new TypeError('yieldControl must be a function.');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function.');
  checkAbort(signal);

  const experiments = [
    {id: 'zero', label: '零目标', targets: [0, 0], enabled: [true, true]},
    {id: 'motor-a', label: '只给 A', targets: [AMPLITUDE, 0], enabled: [true, true]},
    {id: 'motor-b', label: '只给 B', targets: [0, AMPLITUDE], enabled: [true, true]},
    {id: 'same', label: '同向', targets: [AMPLITUDE, AMPLITUDE], enabled: [true, true]},
    {id: 'opposite', label: '反向', targets: [AMPLITUDE, -AMPLITUDE], enabled: [true, true]},
    {id: 'motor-b-off', label: 'B 断电', targets: [AMPLITUDE, 0], enabled: [true, false]},
  ];
  let engine;
  try {
    engine = await createEngine();
    checkAbort(signal);
    if (!engine || (typeof engine.dispose !== 'function' && typeof engine.destroy !== 'function')) {
      throw new TypeError('createEngine must return a disposable MuJoCo engine.');
    }
    const timestep = engine.timestep;
    const stepCount = Math.round(DURATION / timestep);
    if (!Number.isFinite(timestep) || timestep <= 0 || !Number.isSafeInteger(stepCount) || stepCount < 1
      || Math.abs(stepCount * timestep - DURATION) > 1e-9) {
      throw new RangeError('The model timestep must divide the two-second comparison duration into whole steps.');
    }
    const simulation = new MotorSimulation(engine, config);
    // Validate all six commands before spending time on the first experiment.
    for (const experiment of experiments) simulation.setTargets(experiment.targets);
    const cases = [];
    for (const experiment of experiments) {
      checkAbort(signal);
      await onProgress?.({completed: cases.length, total: experiments.length, label: experiment.label});
      checkAbort(signal);
      let state = simulation.reset();
      if (!state.finite) throw new Error('The comparison model has a non-finite reset state.');
      simulation.setTargets(experiment.targets);
      experiment.enabled.forEach((enabled, index) => simulation.setMotorEnabled(index, enabled));
      let sampledMaxClosure = state.closure;
      let closureSamples = 1;
      for (let steps = 0; steps < stepCount; steps += BATCH_SIZE) {
        checkAbort(signal);
        state = simulation.advance(Math.min(BATCH_SIZE, stepCount - steps));
        sampledMaxClosure = Math.max(sampledMaxClosure, state.closure);
        closureSamples++;
        await yieldControl();
        checkAbort(signal);
      }
      if (Math.abs(state.time - DURATION) > 1e-9) throw new Error('MuJoCo did not reach the requested two-second sample time.');
      cases.push({
        id: experiment.id, label: experiment.label, targets: [...experiment.targets], enabled: [...experiment.enabled],
        state, timestep, stepCount, sampledMaxClosure, sampleEverySteps: BATCH_SIZE, closureSamples,
      });
    }
    await onProgress?.({completed: cases.length, total: experiments.length, label: experiments.at(-1).label});
    checkAbort(signal);
    return {duration: DURATION, amplitude: AMPLITUDE, cases};
  } finally {
    if (engine) {
      const dispose = typeof engine.dispose === 'function' ? engine.dispose : engine.destroy;
      if (typeof dispose === 'function') await dispose.call(engine);
    }
  }
}
