# LimX HU_D04_01 left parallel ankle

This is an excerpt of the **official LimX Dynamics closed-loop humanoid model**,
not a reconstruction of a Unitree G1 mechanism. It contains the two physical
A/B ankle motor hinges, two passive rod ball joints, passive foot pitch/roll
hinges, and two MuJoCo `connect` equality constraints.

The official [parallel-joint mapping guide](https://github.com/limxdynamics/humanoid-rl-deploy-python/blob/main/doc/parallel_joint_mapping_en.md)
explains why the physical A/B motors are actuated while pitch/roll are passive.

## Source and license

- Repository: [limxdynamics/humanoid-description](https://github.com/limxdynamics/humanoid-description)
- Fixed commit: `80fbd2d650c43c38916979c2a6eab7a4c79e38de`
- [Source MJCF](https://github.com/limxdynamics/humanoid-description/blob/80fbd2d650c43c38916979c2a6eab7a4c79e38de/HU_D04_description/xml/HU_D04_01.xml)
- [Source mesh directory](https://github.com/limxdynamics/humanoid-description/tree/80fbd2d650c43c38916979c2a6eab7a4c79e38de/HU_D04_description/meshes/HU_D04_01)
- [Source LICENSE](https://github.com/limxdynamics/humanoid-description/blob/80fbd2d650c43c38916979c2a6eab7a4c79e38de/LICENSE)

The source repository uses **Apache-2.0**. A complete copy is included in `LICENSE`.
The seven STL files are unmodified copies. `limx-left-ankle.xml` is a modified
excerpt and includes an explicit modification notice. LimX Dynamics does not
endorse this blog or the derived experiment.

## Changes from the full robot

The excerpt fixes `left_knee_link` in the world at `(0,0,0.48)` m and removes its
knee joint, the rest of the robot, floor, contact proxy geoms and tiny contact
marker bodies. It retains the ankle body's original geometry, relative poses,
inertial values, joint ranges, motor armatures, damping, both passive ball joints,
both `connect` definitions, and both torque-motor actuator definitions.

The simulation uses a 1 ms timestep, implicit-fast integration, Newton solver,
60 iterations, and normal gravity `(0,0,-9.81)`. It is an isolated ankle mechanism
demonstration; it does not reproduce whole-body loading, foot-ground contact or
the manufacturer's motor control firmware. The original numeric motor range is
preserved as model metadata, not presented as a measured hardware performance guarantee.

## Controls and coordinates

See `descriptor.json` for machine-readable names and ranges. Lengths are metres,
angles radians, and the scene is Z-up. The fixed shank is at Z=0.48 m; the
coincident pitch/roll pivot is at Z=0.095 m in the neutral pose. The foot points
roughly along +X.

| Role | Joint | Axis | Limits (rad) |
| --- | --- | --- | --- |
| Motor A | left_A_achilles_joint | X | −1.184 to +0.91 |
| Motor B | left_B_achilles_joint | X | −0.91 to +1.184 |
| Passive pitch | left_ankle_pitch_joint | Y | −1.012 to +0.611 |
| Passive roll | left_ankle_roll_joint | X | −0.436 to +0.436 |
| Passive rod A | left_A_achilles_rod_joint | ball | unlimited |
| Passive rod B | left_B_achilles_rod_joint | ball | unlimited |

Actuators `ankle_A_left` and `ankle_B_left` are the original torque motors with
gear 1 and control ranges `[-42,42]`. Their `data.ctrl` values are **torques**, not
target angles. A browser angle target must go through an explicit PD controller
on the two A/B motor joints, clamp torque, and advance with `mj_step`. Do not
directly animate foot pitch/roll or overwrite rod poses; they must follow through
the equality solver. Initial `qpos0` has zero motor and foot hinge angles and
identity ball quaternions. Zero motor torque does not hold against gravity.

The two constraints connect the rod tips to these foot-local points:

- `A_achilles_connect_L`: `(-0.035, +0.033, 0.0045)`
- `B_achilles_connect_L`: `(-0.035, -0.033, 0.0045)`

Do not assume the full rectangular product of the motor-joint limits is a usable
closed-loop workspace. Begin with small motor targets and inspect joint-limit
and equality residuals when exploring combinations.

The blog's demonstration controller uses `kp=180`, `kd=6`, updates every 1 ms,
and restricts angle targets to `[-0.3,0.3]` rad. These gains and this smaller
exploration range are blog choices, not LimX firmware settings. A local MuJoCo
3.14 WASM check stepped the zero target, the four ±0.3-rad corners, the four
single-motor ±0.3-rad targets, and three ±0.15-rad combinations for 3 seconds each.
Across those 12 cases, sampled maximum connect residual was 0.106 mm, final
residual stayed below 0.010 mm, and final motor target error below 0.0004 rad.
This is a software regression check, not physical robot calibration.

## Rendering

Rendering compiled MuJoCo `mesh_vert` / `mesh_face` data with the corresponding
`data.geom_xpos` / `data.geom_xmat` is appropriate. MuJoCo compiles mesh data into
a centered frame, so do not replace compiled vertices with original STL vertices
without correcting for that frame. See the official
[mesh reference](https://mujoco.readthedocs.io/en/stable/XMLreference.html#asset-mesh).

## Asset inventory and hashes

Download only on opening the simulation. The seven meshes total 2,935,388 bytes.

| Original mesh | Bytes | SHA-256 |
| --- | ---: | --- |
| left_knee_link.STL | 1,394,184 | `6eddc5871da1b6a5eec838580e85fa5ed4fb675df681f1494ee9984f1db4ea09` |
| left_ankle_pitch_link.STL | 60,784 | `56330a050041b7c7c1c12a34dce06e93be4c684f68c85668413ce65ff4b24f51` |
| left_ankle_roll_link.STL | 1,225,384 | `d1c9a577c09018a8ba5bf06ae1af58f6692cb0a022c2b847348de4e7a0e1441c` |
| left_A_achilles_link.STL | 116,284 | `a68bfa9322492dc3d0c701dadddb3fc520485571c54b33dfab23ef2adb1c57fc` |
| left_A_achilles_rod_link.STL | 9,684 | `5c484e5dadb99115782ef6d60d9c46e5270d07064908b421792084e480d192cf` |
| left_B_achilles_link.STL | 116,284 | `247994cb3ccd572b0c78c95dfb4edf96fab7cbad7c8b3d93b444706b2a1f15cc` |
| left_B_achilles_rod_link.STL | 12,784 | `766d28e6a1112df8e9f55e401d207ecde8c1e7ab3d1882c5a6df56fd2495fc65` |
