import * as THREE from '../../vendor/three/three.module.min.js';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';

const MOTOR_A = 0xf0a35b;
const MOTOR_B = 0x59d6d1;
const FOOT = 0xe4eaf0;

/** Build from MuJoCo's compiled, centered mesh, not the original STL frame. */
function compiledMeshGeometry(model, id) {
  const faceStart = model.mesh_faceadr[id];
  const faceCount = model.mesh_facenum[id];
  const vertexStart = model.mesh_vertadr[id];
  const normalStart = model.mesh_normaladr[id];
  const normalCount = model.mesh_normalnum[id];
  const positions = new Float32Array(faceCount * 9);
  const normals = normalCount > 0 ? new Float32Array(faceCount * 9) : null;
  const vertices = model.mesh_vert;
  const faces = model.mesh_face;
  const sourceNormals = model.mesh_normal;
  const faceNormals = model.mesh_facenormal;
  for (let face = 0; face < faceCount; face++) {
    for (let corner = 0; corner < 3; corner++) {
      const entry = (faceStart + face) * 3 + corner;
      const vertex = (vertexStart + faces[entry]) * 3;
      const output = face * 9 + corner * 3;
      positions.set(vertices.subarray(vertex, vertex + 3), output);
      if (normals) {
        const normal = (normalStart + faceNormals[entry]) * 3;
        normals.set(sourceNormals.subarray(normal, normal + 3), output);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function primitiveGeometry(type, size) {
  if (type === 2) return new THREE.SphereGeometry(size[0], 24, 16);
  if (type === 3) return new THREE.CapsuleGeometry(size[0], 2 * size[1], 6, 20).rotateX(Math.PI / 2);
  if (type === 4) return new THREE.SphereGeometry(1, 24, 16).scale(...size);
  if (type === 5) return new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 28).rotateX(Math.PI / 2);
  if (type === 6) return new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2);
  if (type === 0) return new THREE.PlaneGeometry((size[0] || 1) * 2, (size[1] || 1) * 2);
  return null;
}

function appearance(name) {
  if (/left_A_|(?:crank_geom|rod_geom|rotor)_1$/.test(name)) return { color: MOTOR_A, role: 'motor' };
  if (/left_B_|(?:crank_geom|rod_geom|rotor)_2$/.test(name)) return { color: MOTOR_B, role: 'motor' };
  if (/left_ankle_roll|foot_plate/.test(name)) return { color: FOOT, role: 'foot' };
  if (/left_knee|fixed_shin|motor_bracket/.test(name)) return { color: 0x8d9caa, role: 'fixed' };
  return { color: 0xa9b6c5, role: 'joint' };
}

export class AnkleRenderer {
  constructor(viewport, engine, { teaching = false } = {}) {
    this.viewport = viewport;
    this.engine = engine;
    this.teaching = teaching;
    this.disposed = false;
    this.xray = true;
    this.meshes = [];
    this.labels = [];
    this.resources = new Set();
    this.meshGeometries = new Map();
    this.projected = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.setAttribute('aria-label', '三维并联脚踝：拖动旋转，滚轮缩放，方向键平移');
    this.renderer.domElement.setAttribute('tabindex', '0');
    viewport.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(39, 1, .005, 10);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.minDistance = .22;
    this.controls.maxDistance = 1.8;
    this.controls.minPolarAngle = .08;
    this.controls.maxPolarAngle = Math.PI * .88;
    this.controls.panSpeed = .65;
    this.controls.rotateSpeed = .65;
    this.controls.zoomSpeed = .8;
    this.controls.listenToKeyEvents(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xe4f2ff, 0x485168, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(.6, -.8, 1.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xd0e3ff, 1.8);
    rim.position.set(-.6, .4, .7);
    this.scene.add(rim);

    this._createStage();
    this._createModel();
    this._createLabels();
    this._controlsChange = () => this.render();
    this.controls.addEventListener('change', this._controlsChange);
    this._resize = () => this.resize();
    this.resizeObserver = new ResizeObserver(this._resize);
    this.resizeObserver.observe(viewport);
    this.themeObserver = new MutationObserver(() => { this._theme(); this.render(); });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    this._theme();
    this.resetCamera();
    this.resize();
  }

  _own(resource) { this.resources.add(resource); return resource; }

  _createStage() {
    const floor = this.teaching ? -.075 : .015;
    this.grid = new THREE.GridHelper(.85, 34, 0x506379, 0x2e3f52);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = floor;
    this.grid.material.transparent = true;
    this.grid.material.opacity = .3;
    this.grid.material.depthWrite = false;
    this._own(this.grid.geometry);
    this._own(this.grid.material);
    this.scene.add(this.grid);

    const pedestal = new THREE.Mesh(
      this._own(new THREE.CircleGeometry(.33, 64)),
      this._own(new THREE.MeshBasicMaterial({ color: 0x6686a5, transparent: true, opacity: .055, depthWrite: false })),
    );
    pedestal.position.z = floor - .0005;
    this.scene.add(pedestal);

    const origin = new THREE.Vector3(-.17, -.15, floor + .002);
    const axisColors = [0xcc766b, 0x76b89b, 0x779dc9];
    for (let i = 0; i < 3; i++) {
      const axis = new THREE.Vector3();
      axis.setComponent(i, 1);
      const arrow = new THREE.ArrowHelper(axis, origin, .075, axisColors[i], .012, .006);
      arrow.traverse(node => {
        if (node.geometry) this._own(node.geometry);
        if (node.material) this._own(node.material);
      });
      this.scene.add(arrow);
    }
  }

  _createModel() {
    const model = this.engine.model;
    for (let id = 0; id < model.ngeom; id++) {
      const name = this.engine.module.mj_id2name(model, 5, id) || `geom_${id}`;
      const type = model.geom_type[id];
      let geometry;
      if (type === 7) {
        const meshId = model.geom_dataid[id];
        if (!this.meshGeometries.has(meshId)) this.meshGeometries.set(meshId, this._own(compiledMeshGeometry(model, meshId)));
        geometry = this.meshGeometries.get(meshId);
      } else {
        geometry = primitiveGeometry(type, Array.from(model.geom_size.subarray(id * 3, id * 3 + 3)));
        if (geometry) this._own(geometry);
      }
      if (!geometry) continue;
      const style = appearance(name);
      const material = this._own(new THREE.MeshStandardMaterial({
        color: style.color,
        metalness: style.role === 'motor' ? .3 : .18,
        roughness: style.role === 'motor' ? .42 : .5,
        side: THREE.DoubleSide,
      }));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.meshes.push({ id, mesh, role: style.role });
    }
    this._applyXray();
  }

  _createLabels() {
    this.labelContainer = this.viewport.querySelector('#point-labels') || this.viewport.querySelector('.point-labels');
    if (!this.labelContainer) {
      this.labelContainer = document.createElement('div');
      this.labelContainer.className = 'point-labels';
      this.viewport.append(this.labelContainer);
      this.ownsLabelContainer = true;
    }
    const definitions = this.teaching ? [
      { text: '电机 A', joint: 'motor_1', color: MOTOR_A },
      { text: '电机 B', joint: 'motor_2', color: MOTOR_B },
      { text: '被动脚板', body: 'foot', local: [.06, -.04, -.02], color: FOOT },
    ] : [
      { text: '电机 A', joint: 'left_A_achilles_joint', color: MOTOR_A },
      { text: '电机 B', joint: 'left_B_achilles_joint', color: MOTOR_B },
      { text: '被动脚板', body: 'left_ankle_roll_link', local: [.06, -.025, -.04], color: FOOT },
    ];
    for (const definition of definitions) {
      const type = definition.joint ? 3 : 1;
      const id = this.engine.module.mj_name2id(this.engine.model, type, definition.joint || definition.body);
      if (id < 0) continue;
      const element = document.createElement('span');
      element.textContent = definition.text;
      element.style.color = `#${definition.color.toString(16).padStart(6, '0')}`;
      this.labelContainer.append(element);
      const marker = new THREE.Mesh(
        this._own(new THREE.SphereGeometry(.0038, 12, 8)),
        this._own(new THREE.MeshBasicMaterial({ color: definition.color, depthTest: false })),
      );
      marker.renderOrder = 20;
      this.scene.add(marker);
      this.labels.push({ ...definition, id, element, marker, point: new THREE.Vector3() });
    }
  }

  _theme() {
    const light = document.documentElement.dataset.mode === 'light';
    this.scene.background = new THREE.Color(light ? 0xdce4ee : 0x121b26);
    this.grid.material.opacity = light ? .27 : .3;
    this.renderer.toneMappingExposure = light ? 1 : 1.1;
  }

  _applyXray() {
    for (const { mesh, role } of this.meshes) {
      if (role !== 'fixed') continue;
      mesh.material.transparent = this.xray;
      mesh.material.opacity = this.xray ? .13 : 1;
      mesh.material.depthWrite = !this.xray;
      mesh.material.needsUpdate = true;
      mesh.renderOrder = this.xray ? 5 : 0;
    }
  }

  setXray(enabled) {
    if (this.disposed) return;
    this.xray = Boolean(enabled);
    this._applyXray();
    this.render();
  }

  resetCamera() {
    if (this.disposed) return;
    this.controls.target.set(...(this.teaching ? [.02, 0, .14] : [.015, 0, .25]));
    this.camera.position.set(...(this.teaching ? [.48, -.62, .34] : [.65, -.85, .50]));
    this.controls.update();
    this.render();
  }

  resize() {
    if (this.disposed) return;
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (width < 1 || height < 1) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this.disposed || this.engine.disposed || !this.width || !this.height) return;
    const data = this.engine.data;
    const positions = data.geom_xpos;
    const matrices = data.geom_xmat;
    for (const { id, mesh } of this.meshes) {
      const p = id * 3;
      const r = id * 9;
      mesh.matrix.set(
        matrices[r], matrices[r + 1], matrices[r + 2], positions[p],
        matrices[r + 3], matrices[r + 4], matrices[r + 5], positions[p + 1],
        matrices[r + 6], matrices[r + 7], matrices[r + 8], positions[p + 2],
        0, 0, 0, 1,
      );
      mesh.matrixWorldNeedsUpdate = true;
    }
    this.camera.updateMatrixWorld();
    for (const label of this.labels) {
      const p = label.id * 3;
      if (label.joint) label.point.fromArray(data.xanchor, p);
      else {
        const r = label.id * 9;
        const m = data.xmat;
        const [x, y, z] = label.local;
        label.point.set(
          data.xpos[p] + m[r] * x + m[r + 1] * y + m[r + 2] * z,
          data.xpos[p + 1] + m[r + 3] * x + m[r + 4] * y + m[r + 5] * z,
          data.xpos[p + 2] + m[r + 6] * x + m[r + 7] * y + m[r + 8] * z,
        );
      }
      label.marker.position.copy(label.point);
      this.projected.copy(label.point).project(this.camera);
      const visible = this.projected.z > -1 && this.projected.z < 1 && Math.abs(this.projected.x) < 1 && Math.abs(this.projected.y) < 1;
      label.element.hidden = !visible;
      label.element.style.left = `${(this.projected.x * .5 + .5) * this.width}px`;
      label.element.style.top = `${(-this.projected.y * .5 + .5) * this.height}px`;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.themeObserver.disconnect();
    this.controls.removeEventListener('change', this._controlsChange);
    this.controls.dispose();
    for (const label of this.labels) label.element.remove();
    if (this.ownsLabelContainer) this.labelContainer.remove();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
