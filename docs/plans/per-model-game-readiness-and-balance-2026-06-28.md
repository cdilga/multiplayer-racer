# Per-Model Game-Readiness & Balance — Plan (2026-06-28)

> **Status:** Phase-1 plan (Jeff Emanuel planning-workflow). Defines the *generic* per-model
> preparation pass **first**, validates every step against online sources, specifies the
> reusable cross-agent skill that encodes it, and lays out the per-model bead structure.
> Bead creation is deliberately gated behind sign-off on the generic pass (per the request).

> **Reading order for an implementer:** §1 (why) → §3 (the generic pass — the canonical
> workflow) → §4 (balance framework) → §5 (the visual QA loop) → §6 (the skill) → §7 (beads).

---

## 1. Goals & Intent

### What we're really trying to accomplish

We have ~27 CC0 car/kart silhouettes (Kenney Car Kit + a couple of Quaternius supplements) plus
14 debris parts and 8 wheels already downloaded into `static/debug-cars/`. Today the game does
**not** load any of them — `VehicleFactory._createVisualMesh()` builds every car from Three.js
primitives (box body, cylinder wheels, sphere lights). The asset spike
(`docs/plans/asset-spike-2026-06-28.md`) already solved *sourcing, recolor architecture,
normalization, the catalog/selection pipeline, and a validation gate*. **This plan is downstream
of that**: it defines the repeatable per-model pass that turns a *normalized, selectable* model
into one that is **good to play and balanced** — correctly rigged, destructible, colored,
physically tuned, and verified by an automated visual loop.

Two outputs, in this order:

1. **A generic, reusable "game model prep" pass** — the canonical workflow (§3), encoded as a
   cross-agent skill (§6) usable by Claude Code, Codex, *and* Copilot, and **entirely generic to
   game model prep**, not Joystick-Jammers-specific. The project supplies a thin *adapter*
   (config + rubric); the skill body contains no JJ assumptions.
2. **One bead per model** (§7) tracking each silhouette through the pass to "ship-ready", plus a
   handful of shared-infrastructure beads. Created only after the generic pass is signed off.

### The "why"

- **Variety must not cost fairness.** The roster is the headline feature of a party game, but a
  truck that auto-wins (or a kart that can't compete) kills the couch. Balance is *asymmetric &
  net-fair* (Mario-Kart-style, §4): distinct feel, similar net win-rate.
- **Per-model work is repetitive and error-prone.** Rigging pivots, collider fit, CoM, suspension
  tuning, debris hookup, recolor, and "does it actually look right from every angle" are the same
  checklist 27 times. Anything done 27 times in a generic way must become a skill, or it rots.
- **Geometry bugs survive because nothing renders the result.** The asset spike's root-cause
  finding for tracks applies here too: orientation/scale/pivot errors hide until a human eyeballs
  them. The fix is an **in-band visual loop** (§5) that renders multi-angle screenshots and
  *interprets* them (hybrid CV gates + vision-LLM rubric) as a hard gate.

### Decisions locked (from kickoff Q&A)

| Decision | Choice |
|---|---|
| Model scope | **Full catalog — every car + kart** (Kenney ~22 + 5 karts + Quaternius supplements), plus debris & wheel sub-assets. |
| Balance target | **Asymmetric, net-fair (Mario-Kart style).** Distinct stats, similar win-rates. |
| Visual QA | **Hybrid: deterministic CV/geometry gates (hard CI fail) + vision-LLM rubric** on multi-angle renders. |
| Skill home | Canonical in-repo `.claude/skills/game-model-prep/`, generic body, **installed (symlink) into `~/.codex/skills/` and `~/.copilot/skills/`** (verified: those are the real per-user skill dirs both agents read), with an `AGENTS.md` pointer for discoverability. |
| Rollout route | **Kenney-first, validation-first, pilot-gated.** Start with cataloged Kenney assets, enforce normalized material roles and `vehicle-model-validation` evidence, and get the first two pilot cars reviewed by the human coordinator before broad catalog fan-out. |

---

## 2. Current state (grounding)

| Thing | Where | Note |
|---|---|---|
| Vehicle visuals | `static/js/resources/VehicleFactory.js:100` `_createVisualMesh` | Primitives only. Wheels tagged `userData.isWheel`/`wheelIndex` and synced by index. No glTF path yet. |
| Vehicle config | `static/assets/vehicles/default.json` | Single file. Exposes the full tunable surface (see below). |
| Physics body | `static/js/systems/PhysicsSystem.js:579` `createVehicleBody` | `DynamicRayCastVehicleController`, per-wheel suspension config, CoM via mass props, wall-slide grip. |
| Damage/destruction | `static/js/systems/DamageSystem.js` | Health, collision damage, `damage:destroyed` event. No debris spawn yet. |
| Debris explosion | `static/js/systems/ParticleSystem.js` | Particle puff on destroy. No *mesh* debris. |
| Asset viewer | `frontend/car-viewer/viewer.js` | Already does: classify+per-mesh material clone recolor, black wheels, emissive lights, neon underglow+bloom, **rig test (spin/steer/suspension bob)**, collider-proxy overlay, explicit forward-axis arrow. **This is the seed of the visual loop.** |
| Models on disk | `static/debug-cars/*.glb` + `manifest.json` | 27 cars/karts, 14 `debris-*`, 8 `wheel-*`. Starter set: hatchback-sports, sedan-sports, truck, race-future, kart-ooli. |
| Asset spike | `docs/plans/asset-spike-2026-06-28.md` | Catalog/manifest contract, normalization gate, recolor, perf gate, bead mapping. **Prerequisite layer.** |
| Validation skill (stub) | `.claude/skills/vehicle-model-validation/SKILL.md` | JJ-specific acceptance gate; currently a TODO scaffold. Will become the *project adapter* that calls the generic skill. |
| Broad car-models bead | `br-modes-remote-play-design-48a.7` | "Car models: proper 3D vehicle models with variety." Too broad to implement as one change; this plan refines it. |

**Tunable surface already in `default.json`** (the balance levers map onto these): `physics.mass`,
`physics.centerOfMass{x,y,z}`, `linearDamping`, `angularDamping`, `friction`, `engine.force`,
`engine.brakeForce`, `steering.{maxAngle,highSpeedReduction,smoothing}`, `wheels.{radius,
suspensionRestLength,positions}`, `suspension.{stiffness,compression,relaxation,maxTravel}`,
`frictionSlip`, `stunt.*`, `wheelie.*`, `stats.{maxHealth,armor,weight}`.

---

## 2.1 Verification log (2026-06-28) — assumptions checked against code/assets

Every verifiable assumption from the walkthrough was checked. Results:

| # | Assumption | Verdict | Evidence |
|---|---|---|---|
| 1 | No glTF loader in game today; must be built | **CONFIRMED** | No `GLTFLoader`/`loadModel`/`.glb` refs in `static/js` or `src`; `ResourceLoader` is JSON-only. |
| 1 | Asset-pipeline prereq beads don't exist | **CONFIRMED** | `br list`: only `br-modes-remote-play-design-48a.*` (.1–.10); no `FB-*`/asset-pipeline beads. `.7` is the broad "Car models" bead. |
| 2 | Blender not installed | **CONFIRMED** | `which blender` → not found. Also `gltf-transform` not installed (use `npx`/devDep); **Playwright IS installed** (`node_modules/.bin/playwright`). |
| 3 | Kenney/Quaternius wheel pivots at hub | **CORRECTED** | Kenney wheels centered on spin plane (GOOD, rig directly); Quaternius fused + origin-pivoted (BAD). See Stage B. |
| 4 | CoM/coverage numbers deferred to impl | **ACCEPTED** (choice) | — |
| 5 | A top-speed cap exists | **REFUTED** | No cap; `engineForce = accel * baseEngineForce` (`PhysicsSystem:817`); speed = force vs `linearDamping`. See Stage D. |
| — | CoM offset actually applies | **CONFIRMED works** | `colliderDesc.setMassProperties(...)` (`:631`) overrides density; explicit CoM honored. |
| — | `setWheelSideFrictionStiffness` unused | **CONFIRMED** | Only `setWheelFrictionSlip` used; `wallSlideGrip` reduces frictionSlip. Side-friction is net-new. |
| 6 | Destruction fires in both modes | **CONFIRMED** | `DamageSystem._onVehicleDestroyed` emits `damage:destroyed` always (`:269`); respawn only if `respawnEnabled` (off in derby). Debris hooks `damage:destroyed`. |
| 7 | Stunt/wheelie charge reusable as hidden boost | **CONFIRMED** | `PhysicsSystem` has `stuntCharge`, `wheelieChargeRate`, `_getEngineBoostMultiplier`, `stuntBoostMultiplier` — config-driven via `default.json:stunt`. |
| 10 | Copilot reads `.github/skills` | **REFUTED** | Copilot reads `~/.copilot/skills/`; Codex reads `~/.codex/skills/`. Both verified to exist with skills. See §6. |
| 11 | Parent epic exists | **CONFIRMED** | `br-modes-remote-play-design-48a` with children `.1`–`.10`; next would be `.11` or a sibling epic. |

Remaining items (#4, #6 TTL/cap, #7 tolerance/budget, #8 karts, #9 vendor) are genuine design
choices, not facts — they stand as assumed pending your call (see §10).

## 3. THE GENERIC PASS (the canonical workflow)

This is the heart of the plan and the body of the skill. It is written **generically** — it talks
about "the model", "the engine adapter", "the rubric", never about Joystick Jammers. Each stage
states: **what**, **why**, **how (validated)**, **automated check**, **gate**.

The pass is a **pipeline with gates**. A model advances only when each stage's gate is green. A
single per-model artifact — `model-prep.json` (the "prep manifest") — accumulates the results of
every stage so the work is resumable and auditable.

```
 INTAKE ─▶ A. Normalize ─▶ B. Rig ─▶ C. Collider+CoM ─▶ D. Balance ─▶ E. Destruct ─▶ F. Color ─▶ G. Visual QA ─▶ H. Accept
            (scale/origin/    (wheel    (fit + mass       (net-fair    (debris +      (paint/    (CV gates +      (project
             axis/materials)   pivots)   properties)       tuning)      TTL/pool)      lights)    LLM rubric)      gate)
```

### Stage A — Intake & Normalization  *(reuses asset-spike pipeline; do not reinvent)*

- **What:** Confirm the GLB parses, recenter origin to AABB center on X/Z with bottom on ground
  (y≈0), uniform-scale the forward (Z) axis to the engine's canonical length, declare the explicit
  forward axis, and stamp material conventions (`paint`, `tyre`, `glass`, `metal`, `light`).
- **Why:** Every later stage assumes a known scale, origin, forward direction, and named material
  slots. The car-viewer proved name/material heuristics are too weak to trust at runtime (Kenney
  shares one material; Quaternius doesn't name the body "body"), so conventions must be *stamped*,
  not guessed.
- **How (validated):**
  - Spec compliance via **Khronos glTF-Validator** (`npm gltf-validator`) — fail on `errors`,
    treat `warnings` (e.g. NPOT textures) as advisory.
    <https://github.com/KhronosGroup/glTF-Validator>
  - Inspection / budgets / optional texture+draco compression via **glTF-Transform**
    (`gltf-transform inspect|validate|optimize`). <https://gltf-transform.dev/cli>
  - Normalization math (recenter + uniform scale) per asset spike §"Concrete pipeline" item 5.
- **Automated check:** validator passes; AABB after scale matches declared length within tolerance;
  bottom-Y near 0; `paint`/`tyre` conventions each resolve to ≥1 mesh.
- **Gate:** glTF-Validator clean + budgets within `budgets.{maxTriangles,maxMaterials,maxTextureSize,maxGlbBytes}`.

### Stage B — Rigging (wheels steer, spin, and flex)

- **What:** Establish a nested-pivot hierarchy per wheel so wheels **roll** (spin), **steer** (front
  only), and **travel** (suspension flex) correctly, with pivots at the hub.
- **Why:** Rotations happen about a node's local origin, not the visual mesh center. If a wheel's
  geometry is offset from its node origin (common when the modeler didn't set origin to the hub),
  rotating the node makes the wheel orbit "on a stick." Steering must be a *parent* of roll, or
  steering tilts the spin axis and the wheel wobbles.
- **How (validated):** canonical hierarchy
  ```
  chassisGroup
    └ suspensionGroup   // position.y  ← suspension travel (per-wheel)
       └ steerGroup     // rotation.y  ← steering (front wheels only)
          └ rollGroup   // rotation.x  ← wheel spin (axle = local X; matches Rapier axle {x:-1,y:0,z:0})
             └ wheelMesh // geometry recentered so hub = (0,0,0)
  ```
  Recenter strategy, in order of preference: (1) fix at authoring time (Blender: set each wheel
  origin to hub, align spin axis to a clean local axis before glTF export); runtime fallbacks
  (2) `new THREE.Box3().setFromObject(mesh).getCenter()` (respects ancestor transforms) →
  position pivot at center, offset mesh by `-center`; (3) `BufferGeometry.center()` on a *clone*
  of shared geometry (note: `center()` only touches geometry, not transformed ancestors).
  Sources: <https://threejs.org/docs/#api/en/core/BufferGeometry.center> ·
  <https://discourse.threejs.org/t/centering-a-gltf-geometry/6841> ·
  glTF node transform `M = T·R·S`, world = root→node product
  (<https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html>).
- **VERIFIED — pivot quality is bimodal (GLB node inspection, 2026-06-28):**
  - **Kenney (sedan, truck, race-future, kart-ooli, …): GOOD.** Each wheel is its own node with a
    named `wheel-front/back-left/right` mesh whose geometry is **centered on the spin plane**
    (geom-center Y=0.000, Z=0.000); the only offset is **along the axle (X ≈ ±0.12)**, which is
    benign for spin (roll is about X) and only a tiny realistic kingpin scrub for steer. So Kenney
    wheels rig **directly, no recentering needed**. (The correct metric is offset *perpendicular to
    the spin axis* = √(y²+z²) ≈ 0, not raw 3D offset.)
  - **Quaternius (`quaternius-truck`): BAD.** Wheel nodes sit at world origin (nodeT=0,0,0) with
    geometry centers >1 unit away, and the two back wheels are **fused into one mesh**
    (`Cop_BackWheels`, X-size 1.55). These cannot spin/steer per-wheel as-is → require an
    authoring-time fix (Blender re-origin + split) or exclusion. Confirms the spike's warning about
    the Poly-Pizza Quaternius ids.
  - **Implication:** per-model rigging effort is **trivial for Kenney, hard for Quaternius**. The
    full-catalog beads should mark Quaternius models as "needs Blender fix" and may defer them.
- **Automated check (CV, from §5):** in the rig test, front wheels visibly yaw under steer input,
  all wheels roll under throttle, body bobs under suspension; **wheel geometry stays within
  tolerance of its spin axis across the animation** (no orbiting). The car-viewer already animates
  exactly this (`viewer.js:312` rig loop) — promote those measurements to assertions.
- **Gate:** 4 wheels resolve with stable indices; front axle identified; **perpendicular-to-spin-axis
  offset < ε** (Kenney passes natively); no orbit detected in rig screenshots.

### Stage C — Collider Fit & Center of Mass

- **What:** Fit the physics collider (rounded cuboid + per-wheel ray vehicle controller) to the
  silhouette, and set an explicit center of mass that is **lower than the chassis center and
  slightly forward**.
- **Why:** CoM is the strongest anti-rollover lever (lower CoM shortens the cornering-force moment
  arm → fewer flips on hard turns/landings). CoM forward → understeer (stable); rearward →
  oversteer (loose). For an arcade party game we want stable-but-lively, so: low + slightly
  forward, tuned per archetype.
- **How (validated):**
  - **VERIFIED — the codebase already does this correctly.** `PhysicsSystem.createVehicleBody`
    (`:631`) calls `colliderDesc.setMassProperties(mass, com, analyticCuboidInertia, identityQuat)`
    on the chassis collider. `setMassProperties` **overrides** the density-derived mass, so the
    `setDensity(4.0)` at `:617` is effectively ignored for mass/CoM purposes and the explicit CoM
    offset *does* take effect. (This is the clean approach; the research's "set density to 0"
    gotcha applies to the `RigidBodyDesc.setAdditionalMassProperties` route, which this code does
    not use.) **So CoM is already a working per-config lever** — Stage C is tuning, not plumbing.
  - One caveat for GLB silhouettes: the inertia at `:626` is the analytic *cuboid* tensor from the
    declared body box, an approximation for non-box shapes — fine for arcade, note it.
  - `mass=0` means *infinite* — always pass positive.
  - Sources: <https://rapier.rs/docs/user_guides/javascript/rigid_body_mass_properties/> ·
    <https://rapier.rs/javascript3d/classes/RigidBodyDesc.html>
  - Collider fit per asset spike: per-silhouette, `visualCoverageMin` (e.g. 0.92), karts/drivers
    may not silently reuse a sedan hitbox.
- **Automated check:** collider-proxy overlay (car-viewer `addBBox`, `viewer.js:171`) coverage ≥
  threshold; CoM marker below chassis center in render; an automated "drop & hard-corner" sim
  shows no rollover under nominal cornering.
- **Gate:** coverage ≥ min; CoM y < 0 (local); rollover sim passes.

### Stage D — Physics Balance Tuning  *(the net-fair pass — see §4 for the framework)*

- **What:** Derive each model's Rapier parameters from its **archetype stat block** (§4) so the
  car feels distinct yet competes fairly: engine force / top speed, acceleration, steering
  authority, grip, suspension feel, weight/knockback.
- **Why:** Distinct silhouettes must read as distinct *to drive* (a truck should feel heavy, a kart
  twitchy) while landing at similar net win-rates. Hand-tuning 27 cars without a framework yields
  chaos; deriving from a shared budget yields fairness by construction.
- **How (validated — Rapier per-wheel tunables):**
  | Lever | API | Arcade range | Effect |
  |---|---|---|---|
  | Drive | `setWheelEngineForce(i, N)` | by mass; negative = reverse | top speed / accel |
  | Brake | `setWheelBrake(i, v)` | ~0–1 (very sensitive) | stopping |
  | Steer | `setWheelSteering(i, rad)` | ±π/4, lerped | turn rate |
  | Susp. stiffness | `setWheelSuspensionStiffness(i,v)` | 15–40 (~24) | ride height hold |
  | Susp. compression | `setWheelSuspensionCompression(i,v)` | ~0.5–4 | damping in |
  | Susp. relaxation | `setWheelSuspensionRelaxation(i,v)` | ~0.5–4, ≥ compression | stop overshoot/bounce |
  | Max travel | `setWheelMaxSuspensionTravel(i,v)` | 0.1–0.5 m | suspension range |
  | Rest length | `setWheelSuspensionRestLength(i,v)` | 0.2–0.8 | natural ride height |
  | Long. grip | `setWheelFrictionSlip(i,v)` | 500–1000+ (Bullet-style large) | forward/brake grip |
  | **Side grip** | `setWheelSideFrictionStiffness(i,v)` | 0.5–1.0 (drift 0.3–0.7) | **lateral grip / drift** — the oversteer knob |
  | Max susp force | `setWheelMaxSuspensionForce(i,v)` | 6k–100k by mass | heavy-car support |
  - **Order of ops (hard rule):** set controls → `updateVehicle(dt)` → `world.step()`. Steering in
    radians. Don't mix with manual `addForceAtPoint` suspension.
  - Sources: <https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html> ·
    three.js example <https://github.com/mrdoob/three.js/blob/dev/examples/physics_rapier_vehicle_controller.html>
    (note: the official example only sets stiffness/restLength/frictionSlip/radius — compression,
    relaxation, and side-friction are *ours* to tune).
  - **VERIFIED — no top-speed cap exists today.** `applyVehicleControls` (`:817`) sets
    `engineForce = acceleration * baseEngineForce`; there is no `maxSpeed`/clamp anywhere. Top
    speed therefore emerges from `engine.force` vs `linearDamping` (drag). So the **Speed** stat
    maps to `engine.force` + `linearDamping` — *and we may want to add an explicit cap* per model
    for predictable tuning. `vc.currentVehicleSpeed()` is available (`:810`) for measuring/capping.
  - **VERIFIED — `setWheelSideFrictionStiffness` is NOT used yet.** Only `setWheelFrictionSlip`
    is set (`:663`, `:803`). Today `wallSlideGrip` works by *reducing `frictionSlip`* on wall
    contact (`:799–803`), which kills longitudinal grip too. Adding `setWheelSideFrictionStiffness`
    is net-new and lets us drop lateral grip *without* killing forward drive — a real upgrade, not
    just a remap.
- **Automated check (sim harness):** headless physics sim measures per-model **top speed**, **0→top
  time** (accel), **time to stop**, **min turn radius**, **suspension settle time**, **rollover
  resistance**, **wall-graze speed retention**. These become objective per-archetype targets.
- **Gate:** measured metrics within the archetype's target band; **Monte-Carlo win-rate spread
  across all models within tolerance** (§4).

### Stage E — Destructibility (parts that explode and persist, then despawn)

- **What:** On destruction, detach pre-authored parts (panels, bumper, doors, wheels — we already
  have 14 `debris-*` GLBs) as physics rigid bodies, kick them with the car's velocity + an
  explosion impulse, let them persist briefly, then fade and despawn via pooling.
- **Why:** A satisfying derby needs the car to *come apart*, not just puff a particle. Debris must
  inherit velocity (or it "pops" and drops straight down) and must be capped/pooled (or 24 cars ×
  N parts tanks the frame).
- **How (validated):** Pattern A — *pre-authored detachable parts* (recommended over runtime
  fracture for cars):
  - On `damage:destroyed`: for each debris part, reparent to scene keeping world transform; create
    `RigidBodyDesc.dynamic().setCcdEnabled(true on small/fast).setCanSleep(true)`; cheap
    `ColliderDesc.cuboid|convexHull` at world transform; transfer car `linvel` + `applyImpulse` /
    `applyTorqueImpulse` for the blast.
  - **Lifecycle:** spawn with TTL → simulate (auto-sleeps when settled, then nearly free) → after
    3–6 s fade `material.opacity` (`transparent:true`) → `world.removeRigidBody(body)` (auto-removes
    colliders) → **return mesh+slot to a pool**.
  - **Performance:** cap concurrent debris (e.g. 30–60, FIFO recycle oldest); pooling is the
    headline win (avoids WASM alloc/GC churn); prefer cuboid/ball/convexHull over trimesh; consider
    `InstancedMesh`/`BatchedMesh`; CCD only on small fast fragments.
  - **Gotchas:** `removeRigidBody` invalidates the handle — null refs, never revive a removed WASM
    object (pool the *data/slot*, recreate the desc); per-instance opacity isn't supported on shared
    materials (fade via scale/shader for InstancedMesh).
  - Runtime fracture (Pattern B) is available via three's `ConvexObjectBreaker`
    (`three/addons/misc/ConvexObjectBreaker.js`, `subdivideByImpact`) feeding Rapier convexHull
    colliders — kept as a *future* option for non-authored objects, not v1.
  - Sources: <https://rapier.rs/docs/user_guides/javascript/rigid_bodies/> ·
    <https://threejs.org/examples/physics_ammo_break.html> ·
    <https://threejs.org/docs/pages/ConvexObjectBreaker.html>
- **Per-model mapping:** declare which `debris-*` parts each silhouette sheds and from where
  (e.g. truck sheds `debris-plate-*` + `debris-bumper`; karts shed `debris-tire` + `debris-bolt`).
- **Automated check:** destruction screenshot sequence shows ≥N distinct debris bodies that move
  away from the wreck (velocity inherited) and are gone after TTL; debris-body count never exceeds
  the cap in a 24-car derby sim.
- **Gate:** debris spawns, inherits velocity, despawns; pool cap respected; no perf regression.

### Stage F — Coloring & On-Brand Look

- **What:** Apply the per-player **paint slot** to the `paint` material(s), force `tyre` to neutral
  black, keep `glass`/`metal`/`light` neutral, add emissive head/tail lights + neon underglow, and
  mount the roof number.
- **Why:** Player identity (color + number) must be unmistakable from the couch camera; the look
  must match the neon/glass/pill design brief. Per-car PointLights are a bad trade at 24–60 cars —
  use emissive meshes instead.
- **How (validated against car-viewer, which already does this):**
  - Recolor: clone `paint` material per car, `material.color.set(playerColor)` (Quaternius) or
    override the `body` mesh material with a flat emissive `MeshStandardMaterial` (Kenney shared
    atlas — flat swatches, no detail lost). `viewer.js:137 applyMaterials` is the reference.
  - Lights: emissive spheres/meshes + optional faint additive cone for orientation
    (`viewer.js:91 buildFX`), **no per-car PointLight in the GLB path**.
  - Roof number: parented roof quad (cheap, deterministic, top-down readable) — defer
    `DecalGeometry` to later liveries.
- **Automated check (CV):** sampled body pixels match target hue within ΔE tolerance; tyres remain
  near-black after recolor; number quad inside AABB and above roof, legible at camera distance.
- **Gate:** paint coverage ≥ threshold; tyre neutral; number readable.

### Stage G — Visual QA Loop (the in-band "interpret what we see" step)  → see §5

- **What:** Render the prepared model from a fixed set of angles (turntable + diagnostic poses:
  steer-left/right, mid-suspension, mid-destruction) and **interpret** the renders with a hybrid of
  deterministic CV gates and a vision-LLM rubric.
- **Gate:** all CV gates green **and** LLM rubric verdict `pass` (JSON), or a human override is
  recorded.

### Stage H — Acceptance

- **What:** The project's `vehicle-model-validation` skill runs as the final, project-specific
  gate (it calls the generic skill's checks plus JJ rules: catalog entry valid, physics manifest
  present, E2E smoke renders the car on host with correct color/number, no 4-car perf regression).
- **Gate:** validation skill passes; `model-prep.json` marked `accepted`; bead closeable.

---

## 4. Balance Framework — asymmetric, net-fair (Mario-Kart style)

### Principle

"Balanced" ≠ "identical." We want every car **viable** and **distinct**, clustering tightly in
real lap/derby performance — a small meta is fine, dominance is not. (Source: MK8DX in-game stats;
asymmetric-game-design / automated-balancing literature.)

### Stat schema (per model, in the prep manifest)

Store **fine-grained integer stats** (e.g. 0–20), render coarse bars to players:

| Visible stat | Drives (Rapier) |
|---|---|
| **Speed** | `engine.force` ceiling / top-speed cap |
| **Acceleration** | `engine.force` ramp + mass |
| **Weight** | `mass` / `setAdditionalMassProperties` (knockback, bump authority) |
| **Handling** | `steering.maxAngle` + `setWheelSideFrictionStiffness` |
| **Traction** | `setWheelFrictionSlip` + `suspension` damping |

Plus a **hidden boost stat** (where competitive differentiation really lives — mirrors MK's
mini-turbo): ties into the existing `stunt`/`wheelie` charge system (`default.json:stunt.*`). Top
players optimize the hidden stat, not the visible bars.

### Rules (replicating what makes MK net-fair)

1. **Shared point budget** with **inverse coupling**: Speed↑ ⇒ Weight↑, Accel/Handling↓. A truck
   spends its budget on Speed+Weight; a kart on Accel+Handling. Net competitiveness stays close.
2. **Weight is multi-valued** internally (standstill mass / max-speed mass / boost mass) — affects
   bump & knockback, not pure time-trial.
3. **Map silhouette → archetype**: hatch=balanced, muscle/sedan-sports=speed, truck/garbage/
   firetruck=heavy, race/race-future=accel+handling, kart=twitchy-light, tractor=gimmick-heavy.
4. **Derive Rapier params from stats** via a documented transfer function (in the skill), so tuning
   edits stats (designer-facing) and the engine params fall out (machine-facing).
5. **Validate by simulation**: Monte-Carlo many headless races/derbies across all models; flatten
   outliers until per-model win-rate spread is within tolerance (e.g. ±X%). Then confirm by
   playtest.

Sources: <https://www.mariowiki.com/Mario_Kart_8_Deluxe_in-game_statistics> ·
<https://www.gameskinny.com/tips/hit-that-purple-spark-beginners-guide-to-hidden-stats-in-mario-kart-8-deluxe/> ·
IEEE "Automated balancing of asymmetric games" <https://ieeexplore.ieee.org/document/7860432> ·
<https://game-wisdom.com/critical/asymmetrical-game-design>

---

## 5. The Visual QA Loop (hybrid CV + LLM)

The car-viewer (`frontend/car-viewer/viewer.js`) is the interactive seed. The loop **headless-izes
and automates** it. Three layers, run in order; the first two are hard gates, the third is a
rubric judge.

### Layer 1 — Spec & budget gates (deterministic, hard fail)
- **Khronos glTF-Validator** (errors fail). **glTF-Transform inspect** for tri/material/texture/
  draw-call budgets. <https://github.com/KhronosGroup/glTF-Validator> · <https://gltf-transform.dev/cli>

### Layer 2 — Geometry/CV gates (deterministic, hard fail)
Computed from the model + fixed-camera renders:
- AABB after scale ≈ declared length; bottom-Y ≈ 0 (ground contact).
- 4 wheels resolve; **wheel pivot ≈ hub** across the rig animation (no orbiting).
- Collider coverage ≥ `visualCoverageMin`; CoM below chassis center; rollover sim passes.
- Paint hue match (ΔE) on sampled body pixels; tyres near-black; left/right **symmetry** check.
- Roof number inside AABB, above roof, legible size at camera distance.
- Destruction: ≥N debris bodies, velocity inherited, gone after TTL; pool cap respected.

### Layer 3 — Vision-LLM rubric judge (calibrated)
- **Render harness:** prefer **custom headless three.js + Playwright/Puppeteer** over
  `screenshot-glb`/`model-viewer`, because we must render with *our* shaders/bloom/tone-mapping for
  parity (model-viewer uses its own lighting). Fixed deterministic cameras → reproducible, diffable
  PNGs. Headless Chrome WebGL in CI needs `--no-sandbox --use-gl=swiftshader|angle`.
  <https://github.com/bldrs-ai/headless-three> · <https://github.com/Shopify/screenshot-glb> ·
  <https://modelviewer.dev/docs/>
- **Angles/poses:** 8-frame turntable + diagnostics (front, rear, top-down — the actual game
  camera, steer-left, steer-right, mid-suspension, post-destruction).
- **Rubric (forced JSON, binary-ish checklist):** e.g. `wheels_present_and_grounded`,
  `upright_not_inverted`, `single_coherent_vehicle`, `no_black_or_inverted_faces`,
  `color_matches_manifest`, `number_legible`, `reads_as_<archetype>`, `on_brand_neon`. Each →
  `{pass: bool, confidence, note}`; overall `verdict`.
- **Calibration:** before trusting Layer 3 as a gate, run it on a human-labeled sample and confirm
  agreement; rubric-guided beats rubric-free, but vision-LLMs are noisy on fine geometric defects —
  hence Layers 1–2 own the measurements, Layer 3 owns "does it look right."
- **Multi-agent:** the rubric judge is model-agnostic (Claude vision via harness, Codex, or
  Copilot) — the skill defines the prompt + JSON schema, not the vendor.

> **Standing principle (from the asset spike, generalized):** every geometry/transform ships with
> *both* an invariant assertion *and* a line in the debug render. This converts "forgot to check"
> from a recurring bug into an impossible one.

---

## 6. The Generic Skill: `game-model-prep`

### Shape

- **Location:** `.claude/skills/game-model-prep/` (in-repo for now), **generic body** — no JJ
  names, paths, or assumptions inside `SKILL.md`. Resources under `scripts/`, `references/`,
  `assets/`.
- **Inputs (project adapter):** the skill consumes a small adapter the *project* provides:
  - `engine-adapter` — how to load/normalize/spawn/sim a model in *this* engine (here: a thin
    wrapper over `VehicleFactory`, `PhysicsSystem`, the car-viewer render harness).
  - `rubric.json` — the project's visual rubric + thresholds (ΔE, coverage, budgets, archetype
    list).
  - `catalog`/`prep-manifest` paths.
- **Outputs:** an updated per-model `model-prep.json`, rendered QA PNGs, a pass/fail report.
- **Structure (workflow-based):** Overview → Decision tree (new model? re-tune? re-rig?) →
  Stage A…H runbooks (mirroring §3) → the balance transfer-function reference → the visual-loop
  runbook + rubric schema → troubleshooting (the validated gotchas).
- **`scripts/`:** `validate-gltf.mjs` (wraps Khronos), `inspect-budgets.mjs` (glTF-Transform),
  `render-turntable.mjs` (headless three.js + Playwright), `cv-checks.mjs` (geometry/symmetry/
  coverage/ΔE), `sim-metrics.mjs` (headless physics metrics), `balance-montecarlo.mjs` (win-rate
  spread). All engine-specifics behind the adapter interface.
- **`references/`:** the Rapier tunable table + ranges, the wheel-pivot hierarchy, the
  destructibility lifecycle, the balance framework, the rubric — i.e. the validated knowledge from
  §3–§5, generically phrased.

### Cross-agent distribution (Claude + Codex + Copilot)

The skill is authored once; three thin entrypoints make it discoverable to each agent:

| Agent | Entrypoint | Mechanism |
|---|---|---|
| **Claude Code** | `.claude/skills/game-model-prep/SKILL.md` | Native skill discovery. |
| **Codex** | `~/.codex/skills/game-model-prep/` (verified dir) | Symlink/install from the canonical copy. `~/.codex/skills/` already holds `skill-development`, `example-skill`, etc. `AGENTS.md` also gets a pointer + "when to use". |
| **Copilot** | `~/.copilot/skills/game-model-prep/` (verified dir) | Symlink/install from the canonical copy. `~/.copilot/skills/` already holds `looping-video`, `cass`, `suno-sounds`, etc. — **not** `.github/skills` (that was a wrong assumption). |

> **Single source of truth:** the canonical SKILL.md lives in `.claude/skills/game-model-prep/`.
> An `install.sh` (or npm script) symlinks it into `~/.codex/skills/` and `~/.copilot/skills/` so
> all three agents share one file with no drift. `AGENTS.md` only *links*. Because the per-user
> dirs are outside the repo, the install step is per-machine (document it in the skill README).

### Relationship to `vehicle-model-validation`

`vehicle-model-validation` stays **project-specific**: it is the JJ *acceptance gate* (Stage H). It
fills in its TODO scaffold to *invoke* the generic skill's checks plus JJ rules (catalog/manifest/
E2E/perf). Generic = the workflow; project skill = the gate + adapter.

---

## 7. Bead Structure (proposed — created on sign-off)

**New epic:** `Per-model game-readiness & balance` (refines / depends on
`br-modes-remote-play-design-48a.7`, and on the asset-spike catalog/normalization/loader beads).

### Shared-infrastructure beads (must land before per-model beads)
1. **`gmp-skill`** — author the generic `game-model-prep` skill (body + scripts + references) and
   the 3 cross-agent entrypoints + sync check. *(Encodes §3–§6.)*
2. **`gmp-adapter`** — the JJ engine adapter (VehicleFactory glTF path consumed, PhysicsSystem
   spawn/sim hooks, headless render harness from car-viewer) + `rubric.json`.
3. **`gmp-render-harness`** — headless three.js + Playwright multi-angle/turntable renderer with
   our shaders; deterministic cameras; CI-safe WebGL.
4. **`gmp-cv-gates`** — `cv-checks.mjs` (coverage, symmetry, pivot/orbit, ΔE, ground contact,
   number legibility) wired as hard gates.
5. **`gmp-llm-rubric`** — vision-LLM rubric judge (prompt + JSON schema) + calibration harness.
6. **`gmp-sim-metrics`** — headless physics metrics (top speed, accel, turn radius, settle,
   rollover, wall-graze).
7. **`gmp-balance-framework`** — stat schema, silhouette→archetype map, transfer function, and
   `balance-montecarlo.mjs` win-rate gate.
8. **`gmp-destruct-system`** — generic detachable-debris + TTL + pooling system in DamageSystem
   (so per-model beads only *declare* which parts shed).
9. **`gmp-prep-manifest`** — `model-prep.json` schema + the stage-gate runner that advances a model
   through A…H and records results.

### Per-model beads (one per silhouette — **full catalog**)
For each of the ~27 cars/karts: a child bead `gmp-model-<name>` that runs the model through the
pass and records the prep manifest. Acceptance per model = all of §3 gates green + Stage H pass.
Karts/tractors flagged for **bespoke collider + CoM** (driver head, odd silhouette). Suggested
ordering: starter set first (hatchback-sports, sedan-sports, truck, race-future, kart-ooli) to
prove the pipeline end-to-end, then fan out across the rest grouped by archetype.

- **Cars (~22):** sedan, sedan-sports, hatchback-sports, suv, suv-luxury, taxi, police, ambulance,
  firetruck, garbage-truck, delivery, delivery-flat, truck, truck-flat, van, race, race-future,
  tractor, tractor-police, tractor-shovel, (+ Quaternius: quaternius-police, quaternius-truck).
- **Karts (5):** kart-oobi, kart-oodi, kart-ooli, kart-oopi, kart-oozi.

### Per-model acceptance (definition of done)
A model is done when: glTF clean & within budget; rigged (steer/spin/flex, no orbit); collider
fits with low CoM, no rollover; balanced to its archetype band and within the Monte-Carlo win-rate
spread; sheds debris that inherits velocity and despawns; recolored on-brand with a legible number;
**all CV gates green and the LLM rubric verdict `pass`**; `vehicle-model-validation` passes; renders
on host in a 4-car E2E with no perf regression.

---

## 8. Test Strategy

- **Unit/determinism:** normalization math, transfer function, prep-manifest stage runner.
- **Per-model CV + sim gates:** run in CI for each accepted model (fast, headless).
- **Visual snapshots:** Playwright turntable PNGs per model (the diffable record).
- **Balance regression:** Monte-Carlo win-rate spread asserted under tolerance whenever stats change.
- **E2E:** 4-car flow renders GLB cars; no regression vs primitive baseline.
- **No per-frame logging** (CLAUDE.md / CI guard) — use counters/overlay/screenshots.

---

## 9. Sequencing

```
Sign off generic pass (this doc)
   └─▶ gmp-skill + gmp-adapter + gmp-render-harness     (the loop must exist first)
        └─▶ gmp-cv-gates + gmp-llm-rubric + gmp-sim-metrics + gmp-prep-manifest
             └─▶ gmp-balance-framework + gmp-destruct-system
                  └─▶ gmp-model-<starter set> (prove end-to-end)
                       └─▶ gmp-model-<rest>, grouped by archetype (fan out, fungible agents)
```

Depends on the asset-spike pipeline (catalog/manifest, normalization, glTF loader in
VehicleFactory). If those beads don't exist yet, create them from the asset spike's bead mapping
first (or fold the loader into `gmp-adapter`).

---

## 10. Open questions / human decisions

1. **Render parity vs. cost:** custom headless three.js (our shaders, more setup) vs. `screenshot-glb`
   (faster, but model-viewer's lighting ≠ ours). Plan assumes custom for parity — confirm.
2. **Win-rate tolerance:** what spread counts as "balanced" (±5%? ±10%)? Sets the Monte-Carlo gate.
3. **Hidden boost stat depth:** reuse the existing stunt/wheelie charge as the MK-mini-turbo analog,
   or add a dedicated drift-boost? Plan assumes reuse.
4. **Kart/tractor scope:** ship them as full archetypes now, or gate as gimmick/unlock later? Plan
   includes them in the full-catalog beads but flags bespoke collider/CoM work.
5. **Debris source:** map the 14 `debris-*` parts per silhouette by hand, or auto-shed largest
   `paint` panels? Plan assumes hand-mapped declarations per model.
6. **Vision-LLM vendor for the gate** in CI (Claude API vs. local vs. Copilot) — affects cost/keys.

---

## 11. Citations (validated 2026-06-28)

- Rapier vehicle controller: <https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html>,
  three.js example, <https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md>
  (`setWheelSideFrictionStiffness` confirmed, v0.11.2+).
- Mass properties / CoM: <https://rapier.rs/docs/user_guides/javascript/rigid_body_mass_properties/>,
  <https://rapier.rs/javascript3d/classes/RigidBodyDesc.html>.
- Wheel rigging: <https://threejs.org/docs/#api/en/core/BufferGeometry.center>,
  <https://discourse.threejs.org/t/centering-a-gltf-geometry/6841>,
  <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html>.
- Destructibility: <https://rapier.rs/docs/user_guides/javascript/rigid_bodies/>,
  <https://threejs.org/examples/physics_ammo_break.html>,
  <https://threejs.org/docs/pages/ConvexObjectBreaker.html>.
- Balance: <https://www.mariowiki.com/Mario_Kart_8_Deluxe_in-game_statistics>,
  <https://ieeexplore.ieee.org/document/7860432>, <https://game-wisdom.com/critical/asymmetrical-game-design>.
- Visual QA tooling: <https://github.com/KhronosGroup/glTF-Validator>, <https://gltf-transform.dev/cli>,
  <https://github.com/Shopify/screenshot-glb>, <https://modelviewer.dev/docs/>,
  <https://github.com/bldrs-ai/headless-three>.
  *(Vision-LLM-judge academic agreement figures: treat as needs-verification before citing as fact.)*
```
