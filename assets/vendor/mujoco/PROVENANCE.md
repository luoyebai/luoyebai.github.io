# MuJoCo browser runtime

These files are the unmodified **single-threaded** runtime from Google DeepMind's
official [`@mujoco/mujoco`](https://www.npmjs.com/package/@mujoco/mujoco) npm package,
version **3.14.0**, retrieved on 2026-10-02.

- Source: <https://github.com/google-deepmind/mujoco/tree/3.14.0/wasm>
- Package: <https://registry.npmjs.org/@mujoco/mujoco/-/mujoco-3.14.0.tgz>
- Package integrity (verified before extraction):
  `sha512-WPUYidu4Fx8+uM4hQv80SOA0ifpWGrsNJguKs8JBV8SCTxjKQ2/rqsh880nUH0/Vwa8vuefghvCQkkoed3bkUg==`
- License: Apache-2.0. `LICENSE` is the unmodified license from the same
  upstream release: <https://raw.githubusercontent.com/google-deepmind/mujoco/3.14.0/LICENSE>.
- `package.json` is preserved from that package. Its upstream `README.md` and
  `mujoco.d.ts` are retained in the local `_staging/vendor-mujoco-reference/`
  development archive and are not shipped to the public site.
- The multi-threaded build, source maps and package archive are deliberately omitted.

SHA-256 checksums:

| File | SHA-256 |
| --- | --- |
| `mujoco.js` | `bc6980e4bc5ee5f809a6cabde0743798637e113d333f9e85124714d42be1ccae` |
| `mujoco.wasm` | `2d380f1070a556c3003b4a7c7c10c98a5f61db4e91815de1075ec478e9487e76` |
| `LICENSE` | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |

The default build needs no `SharedArrayBuffer`, workers or cross-origin isolation
headers, so it can run on GitHub Pages. The ankle tool dynamically imports this
runtime only after the reader opens the simulation; other blog pages do not load
these assets. The WASM is approximately 10.3 MB before HTTP compression.

The local adapter in `assets/tools/ankle/mujoco-engine.js` compiles MJCF using
`MjModel.from_xml_string`, allocates `MjData`, writes actuator controls and calls
the real `mj_step` integrator. Rendering reads MuJoCo's world transforms. It does
not substitute scripted motion for the physics engine. `mj_forward` is used for
initialization and refreshing transforms after integration, never as a replacement
for dynamics. Each model/data/VFS handle is explicitly freed.
