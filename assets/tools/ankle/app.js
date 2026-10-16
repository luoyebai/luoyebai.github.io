import { createTeachingMJCF, TEACHING_MODEL } from './ankle-model.js';
import { inverseKinematics, forwardKinematics, jacobian } from './ankle-math.js';
import { MotorSimulation, PD_LIMITS } from './simulation.js';

const $ = id => document.getElementById(id);
const rad = Math.PI / 180, degrees = angle => angle / rad;
const angleText = angle => `${degrees(angle).toFixed(2)}°`;
const query = new URLSearchParams(location.search);
let engine, simulation, renderer, descriptor, loading = false, generation = 0;
let playing = false, visible = true, parentActive = true, frame = 0, lastTime = 0, remainder = 0;
let history = [], lastMathTime = -1, fkSeed = [0, 0];
const palette = getComputedStyle(document.documentElement);
const chart = $('plot'), plot = chart.getContext('2d');

function status(message, error = false) {
  $('sim-status').textContent = message;
  $('sim-status').classList.toggle('error', error);
}

function halt(error) {
  setPlaying(false);
  status(`仿真已暂停：${error.message || error}。可复位后重试。`, true);
}

function advancePhysics(count) {
  const state = simulation.advance(count);
  if (state.closure > .005) throw new Error('闭环偏差过大，请降低输入或恢复默认控制器');
  return state;
}

function setPlaying(value) {
  playing = Boolean(value && simulation && !simulation.stopped);
  $('play').textContent = playing ? '暂停仿真' : '开始仿真';
  schedule();
}

function schedule() {
  cancelAnimationFrame(frame); frame = 0; lastTime = 0; remainder = 0;
  if (playing && visible && parentActive && !document.hidden) frame = requestAnimationFrame(tick);
}

function tick(now) {
  if (!playing || !simulation || !visible || !parentActive || document.hidden) return;
  frame = requestAnimationFrame(tick);
  if (!lastTime) { lastTime = now; return; }
  const elapsed = (now - lastTime) / 1000;
  if (elapsed < 1 / 30) return;
  lastTime = now;
  // Fixed physics steps; discard long wall-clock gaps instead of catching up on return.
  remainder += Math.min(elapsed, .05);
  const count = Math.min(100, Math.floor(remainder / engine.timestep));
  if (count < 1) return;
  remainder -= count * engine.timestep;
  try {
    const state = advancePhysics(count);
    update(state, true);
  } catch (error) { halt(error); }
}

function drawPlot() {
  if (!plot) return;
  const width = chart.clientWidth || 600, height = chart.clientHeight || 120;
  const ratio = Math.min(devicePixelRatio || 1, 1.5);
  if (chart.width !== Math.round(width * ratio) || chart.height !== Math.round(height * ratio)) {
    chart.width = Math.round(width * ratio); chart.height = Math.round(height * ratio);
  }
  plot.setTransform(ratio, 0, 0, ratio, 0, 0); plot.clearRect(0, 0, width, height);
  const left = 36, right = width - 6, top = 13, bottom = height - 19;
  const bound = Math.max(5, Math.ceil(history.reduce((m, s) => Math.max(m, ...s.foot.map(x => Math.abs(degrees(x)))), 0) / 5) * 5);
  const y = angle => top + (bound - degrees(angle)) / (2 * bound) * (bottom - top);
  const end = history.at(-1)?.time || 0, start = Math.max(0, end - 6);
  plot.font = '9px ui-monospace, monospace'; plot.lineWidth = 1;
  [bound, 0, -bound].forEach(value => {
    const py = y(value * rad);
    plot.strokeStyle = palette.getPropertyValue('--line'); plot.beginPath(); plot.moveTo(left, py); plot.lineTo(right, py); plot.stroke();
    plot.fillStyle = palette.getPropertyValue('--muted'); plot.fillText(`${value}°`, 0, py + 3);
  });
  plot.fillText(`${start.toFixed(1)} s`, left, height - 3);
  plot.textAlign = 'right'; plot.fillText(`${(start + 6).toFixed(1)} s`, right, height - 3); plot.textAlign = 'left';
  [0, 1].forEach(index => {
    plot.strokeStyle = palette.getPropertyValue(index ? '--b' : '--a'); plot.lineWidth = 1.7; plot.beginPath();
    history.forEach((s, i) => {
      const x = left + (s.time - start) / 6 * (right - left);
      if (i === 0) plot.moveTo(x, y(s.foot[index])); else plot.lineTo(x, y(s.foot[index]));
    });
    plot.stroke();
  });
}

function update(state = simulation?.read(), record = false) {
  if (!state) { drawPlot(); return; }
  $('actual-roll').textContent = angleText(state.foot[0]);
  $('actual-pitch').textContent = angleText(state.foot[1]);
  $('closure-error').textContent = `${(state.closure * 1000).toFixed(3)} mm`;
  $('sim-time').textContent = `${state.time.toFixed(2)} s`;
  ['a', 'b'].forEach((name, i) => {
    $(`motor-${name}-angle`).textContent = angleText(state.motors[i]);
    $(`motor-${name}-torque`).textContent = `${state.torques[i].toFixed(2)} N·m`;
  });
  if (record || !history.length) {
    history.push({time: state.time, foot: [...state.foot]});
    while (history.length > 310 || (history.length > 1 && history[0].time < state.time - 6)) history.shift();
  }
  if ($('model').value === 'teaching' && (state.time - lastMathTime > .1 || lastMathTime < 0)) {
    lastMathTime = state.time;
    const fk = forwardKinematics(state.motors, {seed: fkSeed});
    if (fk.ok) {
      fkSeed = fk.theta;
      $('fk-prediction').textContent = fk.theta.map(angleText).join(' / ');
      const j = jacobian(fk.theta, state.motors);
      $('jacobian').textContent = j.ok ? j.J.map(row => `[ ${row.map(v => v.toFixed(3)).join('  ')} ]`).join('\n') : '接近奇异位置';
      $('condition').textContent = j.ok ? j.condition.toFixed(2) : '—';
    } else {
      $('fk-prediction').textContent = `当前分支未收敛 (${fk.reason})`;
      $('jacobian').textContent = '—'; $('condition').textContent = '—';
    }
  }
  renderer?.render(); drawPlot();
}

async function fetchLocal(path, binary = false) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`模型资源读取失败 (${response.status})`);
  return binary ? new Uint8Array(await response.arrayBuffer()) : response.text();
}

function destroyModel() {
  setPlaying(false); renderer?.dispose(); renderer = null;
  engine?.dispose(); engine = null; simulation = null;
  history = []; fkSeed = [0, 0]; lastMathTime = -1;
  $('controls').disabled = true;
  ['camera', 'xray', 'export'].forEach(id => $(id).disabled = true);
}

function configureInputs(teaching) {
  const limit = teaching ? 30 : 17;
  const gains = PD_LIMITS[teaching ? 'teaching' : 'limx'];
  ['kp', 'kd'].forEach(name => {
    $(name).min = gains[name][0]; $(name).max = gains[name][1];
  });
  $('kd').step = teaching ? .1 : .5;
  ['a', 'b'].forEach(name => {
    $(`target-${name}`).min = -limit; $(`target-${name}`).max = limit;
    $(`target-${name}`).step = .1;
    $(`target-${name}`).value = 0; $(`target-${name}-value`).textContent = '0.0°';
  });
  $('kp').value = simulation.kp; $('kp-value').textContent = simulation.kp;
  $('kd').value = simulation.kd; $('kd-value').textContent = simulation.kd.toFixed(1);
  $('external-load').value = 0; $('load-value').textContent = '0.0 N·m';
  ['roll', 'pitch'].forEach(name => { $(`desired-${name}`).value = 0; $(`desired-${name}-value`).textContent = '0.0°'; });
  $('formula-panel').hidden = !teaching;
  $('scene-name').textContent = teaching ? '双杆教学模型 · 公式对照' : 'LimX HU-D04 · 左踝';
  $('model-note').textContent = teaching
    ? '教学尺寸 · 双 Y 轴电机 · 固定小腿、无足地接触。公式预测与物理解算可对照；尺寸不代表 G1 或 LimX 真机。'
    : 'LimX 官方 HU-D04 左踝局部模型 · 固定小腿、无足地接触。原始几何与惯性；PD 控制器为本实验设置。';
}

async function loadModel() {
  if (loading) return;
  loading = true;
  const token = ++generation, teaching = $('model').value === 'teaching';
  destroyModel();
  $('load-cover').hidden = false; $('load').disabled = true; $('model').disabled = true;
  $('load').textContent = '正在加载…';
  $('load-message').textContent = `正在加载本地 MuJoCo WASM 与模型，首次约需下载 ${teaching ? 11 : 14} MB。`;
  let nextEngine, nextRenderer;
  try {
    const [{loadXML}, {AnkleRenderer}] = await Promise.all([import('./mujoco-engine.js'), import('./renderer.js')]);
    let xml, assets = {};
    if (teaching) {
      xml = createTeachingMJCF(); descriptor = null;
    } else {
      descriptor = JSON.parse(await fetchLocal('./limx/descriptor.json'));
      const [source, meshes] = await Promise.all([
        fetchLocal(`./limx/${descriptor.model}`),
        Promise.all(descriptor.assets.map(async name => [name, await fetchLocal(`./limx/${name}`, true)])),
      ]);
      xml = source; assets = Object.fromEntries(meshes);
    }
    $('load-message').textContent = '资源就绪，正在编译闭环模型…';
    nextEngine = await loadXML(xml, {assets});
    if (token !== generation) { nextEngine.dispose(); return; }
    nextRenderer = new AnkleRenderer($('viewport'), nextEngine, {teaching});
    engine = nextEngine; renderer = nextRenderer;
    simulation = new MotorSimulation(engine, teaching ? {
      motorJoints: TEACHING_MODEL.motors, actuatorNames: TEACHING_MODEL.actuators,
      footJoints: [TEACHING_MODEL.foot.roll, TEACHING_MODEL.foot.pitch],
      ...TEACHING_MODEL.controller, targetLimit: .6, gainLimits: PD_LIMITS.teaching,
    } : {
      motorJoints: descriptor.motorJoints, actuatorNames: descriptor.actuators,
      footJoints: [descriptor.footJoints[1], descriptor.footJoints[0]],
      ...descriptor.demoController, torqueLimit: 42, targetLimit: .3, gainLimits: PD_LIMITS.limx,
    });
    configureInputs(teaching);
    $('engine-badge').textContent = `MuJoCo ${engine.version} · 两条闭环约束`;
    $('controls').disabled = false;
    ['camera', 'xray', 'export'].forEach(id => $(id).disabled = false);
    $('xray').setAttribute('aria-pressed', 'true');
    $('load-cover').hidden = true;
    status('已就绪。调节电机目标，或点击「只动 A」后开始仿真。');
    update();
  } catch (error) {
    nextRenderer?.dispose(); nextEngine?.dispose(); engine = null; renderer = null; simulation = null;
    $('load-message').textContent = `加载失败：${error.message}。请确认浏览器支持 WebAssembly 与 WebGL，或重试。`;
    $('engine-badge').textContent = '加载未完成';
    status('模型尚未加载，可重试或阅读文章推导。', true);
  } finally {
    if (token === generation) {
      loading = false; $('load').disabled = false; $('model').disabled = false;
      $('load').textContent = '加载物理实验 ↗';
    }
  }
}

function setTargets(values) {
  try {
    simulation.setTargets(values);
    ['a', 'b'].forEach((name, i) => {
      $(`target-${name}`).value = degrees(values[i]);
      $(`target-${name}-value`).textContent = `${degrees(values[i]).toFixed(1)}°`;
    });
    status(playing ? '目标已更新，观察连杆传动与脚底响应。' : '目标已更新；点击「开始仿真」或「单步」观察传动。');
  } catch (error) { halt(error); }
}

$('load').addEventListener('click', loadModel);
$('model').addEventListener('change', () => { if (engine) loadModel(); });
['a', 'b'].forEach((name, index) => $(`target-${name}`).addEventListener('input', event => {
  const values = [...simulation.targets]; values[index] = Number(event.target.value) * rad; setTargets(values);
}));
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  const value = 10 * rad;
  setTargets(button.dataset.preset === 'same' ? [value, value] : button.dataset.preset === 'opposite' ? [value, -value] : [value, 0]);
}));
$('play').addEventListener('click', () => {
  setPlaying(!playing);
  status(playing ? '物理解算运行中；两个电机施加力矩，被动脚底由闭环机构推动。' : '已暂停，可旋转视角、调整输入或单步观察。');
});
$('step').addEventListener('click', () => {
  setPlaying(false);
  try { update(advancePhysics(Math.round(.02 / engine.timestep)), true); status('已推进 20 ms 仿真时间。'); }
  catch (error) { halt(error); }
});
$('reset').addEventListener('click', () => {
  setPlaying(false);
  simulation.kp = $('model').value === 'teaching' ? 80 : 180;
  simulation.kd = $('model').value === 'teaching' ? 1 : 6;
  history = []; fkSeed = [0, 0]; lastMathTime = -1;
  const state = simulation.reset(); configureInputs($('model').value === 'teaching'); update(state);
  status('已复位：零位目标、默认 PD 参数，外力清零。');
});
['kp', 'kd'].forEach(name => $(name).addEventListener('input', event => {
  simulation[name] = Number(event.target.value);
  $(`${name}-value`).textContent = simulation[name].toFixed(name === 'kd' ? 1 : 0);
}));
$('external-load').addEventListener('input', event => {
  simulation.load = Number(event.target.value);
  $('load-value').textContent = `${simulation.load.toFixed(1)} N·m`;
});
['roll', 'pitch'].forEach(name => $(`desired-${name}`).addEventListener('input', event => {
  $(`desired-${name}-value`).textContent = `${Number(event.target.value).toFixed(1)}°`;
}));
$('apply-ik').addEventListener('click', () => {
  const theta = ['roll', 'pitch'].map(name => Number($(`desired-${name}`).value) * rad);
  const ik = inverseKinematics(theta, {seed: simulation.targets});
  if (!ik.ok || ik.q.some(value => Math.abs(value) > simulation.targetLimit)) {
    status('这个姿态超出当前分支或电机探索范围，请减小期望角度。', true); return;
  }
  setTargets(ik.q);
});
$('camera').addEventListener('click', () => renderer?.resetCamera());
$('xray').addEventListener('click', () => {
  const enabled = $('xray').getAttribute('aria-pressed') !== 'true';
  $('xray').setAttribute('aria-pressed', String(enabled)); renderer?.setXray(enabled);
});
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('viewport').requestFullscreen(); }
  catch { status('浏览器不允许全屏，仍可在当前视图操作。'); }
});
document.addEventListener('fullscreenchange', () => $('fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '全屏');
$('export').addEventListener('click', () => {
  if (!simulation) return;
  if (window.origin === 'null') {
    status('后台预览限制文件下载，请关闭实验后点击「独立打开」导出。'); return;
  }
  const payload = {
    model: descriptor?.id || 'teaching-parallel-ankle', engine: `MuJoCo ${engine.version}`,
    units: {angles: 'rad', torques: 'N*m', closure: 'm', time: 's'},
    convention: {motors: ['A', 'B'], foot: ['roll', 'pitch'], upAxis: 'Z'},
    scope: 'Fixed shank, no ground contact; motor torque driven closed-loop dynamics',
    source: descriptor?.sourceRepository || 'Educational geometry in ankle-model.js',
    sourceCommit: descriptor?.sourceCommit || null,
    controller: {kp: simulation.kp, kd: simulation.kd, torqueLimit: simulation.torqueLimit},
    targets: [...simulation.targets], commandedPitchTorque: simulation.load,
    appliedPitchTorque: engine.data.qfrc_applied[engine.getJoint(simulation.footJoints[1]).dofAddress],
    ...simulation.read(),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = `ankle-${$('model').value}-${Date.now()}.json`;
  document.body.append(a); a.click(); a.remove();
  status('已生成当前仿真数据；角度单位为 rad，包含外力指令与已施加载荷。');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.addEventListener('visibilitychange', schedule);
window.addEventListener('message', event => {
  if (event.source !== parent || parent === window || event.data?.type !== 'mujoco-activity') return;
  parentActive = event.data.active === true; schedule();
});
new IntersectionObserver(entries => {
  visible = entries[0].isIntersecting; schedule();
}).observe(document.querySelector('.experiment'));
const resizeObserver = new ResizeObserver(() => {
  drawPlot();
  if (parent !== window) parent.postMessage({type: 'mujoco-size', height: document.body.scrollHeight}, '*');
});
resizeObserver.observe(document.body);
window.addEventListener('pagehide', event => {
  setPlaying(false);
  if (!event.persisted) { generation++; destroyModel(); resizeObserver.disconnect(); }
});
drawPlot();
if (query.get('autoload') === '1') loadModel();
