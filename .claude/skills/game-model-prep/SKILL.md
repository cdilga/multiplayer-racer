---
name: game-model-prep
description: >
  Prepare a 3D vehicle/character model so it is GOOD TO PLAY and BALANCED in a real-time
  game built on Three.js + a ray-cast vehicle physics engine (e.g. Rapier). Runs a gated
  pipeline — normalize, rig (wheels spin/steer/flex), fit collider + center of mass, tune
  physics/balance, wire destructible debris, recolor, and verify with an automated visual
  loop (deterministic CV gates + a vision-LLM rubric). Use this whenever you add, replace,
  re-rig, re-tune, or balance a car/kart/vehicle model, set up destructible parts, debug
  "wheels orbit / car flips / model looks wrong from some angle", or stand up automated
  model QA. ENGINE-GENERIC: all project specifics come from a project adapter + rubric, not
  from this skill. (Not specific to any one game.)
---

# Game Model Prep

## Overview

This skill encodes a **repeatable, gated pipeline** for turning an imported 3D vehicle model
into one that plays well and is fairly balanced. It is generic: it talks about *the model*,
*the engine adapter*, and *the rubric*. A project supplies a thin **adapter** (how to
load/normalize/spawn/sim/render a model in that engine) and a **`rubric.json`** (thresholds,
archetype list, budgets). The skill never hardcodes engine paths or game rules.

Run the stages in order. A model advances only when each stage's **gate** is green. All results
accumulate in a single per-model **`model-prep.json`** (schema in `assets/model-prep.schema.json`)
so work is resumable and auditable.

```
INTAKE ─▶ A Normalize ─▶ B Rig ─▶ C Collider+CoM ─▶ D Balance ─▶ E Destruct ─▶ F Color ─▶ G Visual QA ─▶ H Accept
```

## When to use / Decision tree

- **New model added** → run A→H.
- **Re-tuning feel/balance only** → D (+ re-run G, H).
- **"Wheels orbit / wobble"** → B (see `references/wheel-rigging.md`).
- **"Car flips / rolls on corners"** → C (center of mass) then D (side friction).
- **"Car won't slide along walls / stops dead"** → D (`setWheelSideFrictionStiffness`).
- **"Parts don't explode / debris drops straight down / frame drops in a brawl"** → E.
- **"Looks wrong from some angle / wrong color"** → G (visual loop).

## The adapter contract (what the project must provide)

The skill calls these; the project implements them (engine-specific):

- `loadModel(path) -> sceneGraph` — load + cache a GLB/glTF.
- `normalize(model, opts) -> {scale, originOffset, forwardAxis}` — recenter, scale to canonical length.
- `spawn(modelId, params) -> handle` — create a drivable instance (visual + physics).
- `simStep(handle, controls, dt)` / `measure(handle) -> metrics` — headless physics for Stage D.
- `render(modelId, camera, pose) -> PNG` — render with the PROJECT's shaders (parity matters).
- `rubric` — the project's `rubric.json` (thresholds, archetypes, budgets).

Keep all engine specifics behind these. If the project has no glTF loader yet, building one is
its first adapter task — this skill assumes `loadModel` exists.

---

## Stage A — Normalize  (gate: spec + budgets)

- **Do:** parse the GLB; recenter origin to AABB center on the lateral/longitudinal axes with the
  bottom on the ground (y≈0); uniform-scale the forward axis to the engine's canonical length;
  declare the **explicit forward axis** (never guess it silently); stamp material conventions
  (`paint`, `tyre`, `glass`, `metal`, `light`).
- **Validate:** Khronos **glTF-Validator** (fail on `errors`; warnings advisory) and
  **glTF-Transform** `inspect` for tri/material/texture/draw-call budgets. See
  `scripts/validate-and-budgets.md`.
- **Gate:** validator clean; within `rubric.budgets.*`; AABB after scale ≈ declared length;
  bottom-Y ≈ 0; `paint`/`tyre` conventions each resolve to ≥1 mesh.
- **Why "stamp, not guess":** source packs are inconsistent (some share one material across body
  and wheels; some don't name the body "body"). Stamp conventions once (ideally offline in a DCC
  tool) so the runtime never heuristically guesses.

## Stage B — Rig: wheels spin, steer, and flex  (gate: no orbit)

Use the **nested-pivot hierarchy** — the order is load-bearing:

```
chassisGroup
  └ suspensionGroup   // position.y  ← suspension travel (per wheel)
     └ steerGroup     // rotation.y  ← steering (front wheels only)
        └ rollGroup   // rotation.x  ← wheel spin (axle = local X)
           └ wheelMesh // geometry centered on the spin axis
```

- **Steer MUST parent roll**, or steering tilts the spin axis and the wheel wobbles.
- **The metric that matters is offset *perpendicular to the spin axis* = √(y²+z²)**, not raw 3D
  offset. A wheel may sit offset *along its axle* (X) and still spin true. Use
  `scripts/inspect-wheel-pivots.mjs` to measure this per model.
- If perpendicular offset is non-trivial, fix in this order: (1) author-time (set wheel origin to
  hub, align spin axis to a clean local axis before glTF export — needs a DCC tool); (2) runtime
  `Box3.setFromObject(mesh).getCenter()` → position a pivot there, offset mesh by `-center`;
  (3) `BufferGeometry.center()` on a *clone* of shared geometry.
- Fused wheels (both rear wheels in one mesh) or wheels pivoted at world origin → cannot rig
  per-wheel; require an author-time split or exclusion. Flag, don't paper over.
- **Gate:** N wheels resolve with stable indices; front axle identified; perpendicular offset < ε;
  rig animation shows roll + steer + bob with no orbiting.

Details + validated sources: `references/wheel-rigging.md`.

## Stage C — Collider fit & Center of Mass  (gate: fit + no rollover)

- **Do:** fit the physics collider (rounded cuboid recommended — glances off walls) to the
  silhouette; set CoM **below the chassis center and slightly forward**.
- **Why:** lower CoM is the strongest anti-rollover lever; forward CoM → understeer (stable),
  rearward → oversteer (loose). Arcade target: low + slightly forward, per archetype.
- **Gotcha (engine-dependent):** setting an explicit CoM only "sticks" if it isn't diluted by
  geometric-center mass. Either set the collider's mass properties explicitly (mass + CoM +
  inertia), or zero the collider density and use the body's additional-mass-properties API. Verify
  which path the adapter uses; don't set both inconsistently.
- **Gate:** collider visual-coverage ≥ `rubric.collider.visualCoverageMin`; CoM below center;
  an automated drop + hard-corner sim shows no rollover at nominal cornering.

## Stage D — Balance tuning  (gate: archetype band + win-rate spread)

Derive engine params from the model's **archetype stat block** (see `references/balance-net-fair.md`).
Per-wheel ray-cast vehicle tunables and arcade ranges (see `references/rapier-vehicle-tunables.md`):
suspension stiffness / compression / relaxation / maxTravel / restLength, longitudinal friction
slip, **side friction stiffness** (the lateral-grip / drift knob — distinct from longitudinal),
engine force, brake, steering (radians). **Order of ops:** set controls → `updateVehicle(dt)` →
`world.step()`. Don't mix with manual per-frame suspension forces.

- **Measure (headless sim via adapter):** top speed, 0→top time, time-to-stop, min turn radius,
  suspension settle time, rollover resistance, wall-graze speed retention.
- **Gate:** metrics within the archetype's target band; **Monte-Carlo win-rate spread across all
  models within `rubric.balance.winRateTolerance`**.

## Stage E — Destructibility  (gate: debris spawns, inherits velocity, despawns, capped)

Pattern A (recommended for vehicles): **pre-authored detachable parts**.

- On destruction: reparent each declared debris part to the scene (keep world transform); create a
  dynamic rigid body + cheap cuboid/convexHull collider at that transform; **transfer the vehicle's
  velocity** + apply an explosion impulse/torque (or parts "pop" and drop straight down).
- **Lifecycle:** spawn with TTL → simulate (let bodies sleep when settled — nearly free) → after
  the TTL fade opacity (`transparent:true`) → remove body (auto-removes its colliders) → **return
  mesh + slot to a pool**.
- **Performance:** cap concurrent debris (FIFO recycle oldest); pooling is the headline win
  (avoids physics-WASM alloc/GC churn); prefer cuboid/ball/convexHull over trimesh; CCD only on
  small/fast fragments. Never revive a removed physics handle — pool the *slot/data*, recreate it.
- **Gate:** ≥N debris bodies move away from the wreck and are gone after TTL; body count never
  exceeds the cap in a worst-case brawl sim. Details: `references/destructibility.md`.

## Stage F — Color & on-brand look  (gate: paint coverage, neutral tyres, legible number)

- Clone the `paint` material per instance and set the player color; force `tyre` neutral; keep
  `glass`/`metal`/`light` neutral; use **emissive meshes** for head/tail lights and any glow
  (avoid per-instance real lights at scale); mount the identity number (a parented quad is cheap
  and top-down-readable; defer projected decals to richer liveries).
- **Gate:** sampled body pixels match target hue within `rubric.color.deltaE`; tyres near-neutral
  after recolor; number inside AABB, above the roof, legible at camera distance.

## Stage G — Visual QA loop  (gate: CV green + rubric verdict pass)

Three layers, in order (Layers 1–2 hard-fail, Layer 3 is the judge):

1. **Spec & budgets** — glTF-Validator + glTF-Transform (same as Stage A).
2. **Geometry / CV gates** (deterministic): AABB vs declared length; ground contact; wheel
   perpendicular-offset / no-orbit across the rig animation; collider coverage; CoM below center;
   paint ΔE; left/right symmetry; number legibility; destruction debris count/velocity.
3. **Vision-LLM rubric judge** on multi-angle renders: 8-frame turntable + diagnostics (front,
   rear, **top-down = the gameplay camera**, steer-L, steer-R, mid-suspension, post-destruction).
   The judge returns the **forced-JSON rubric** in `assets/rubric.template.json`. Calibrate against
   a human-labeled sample before trusting it as a gate; Layers 1–2 own measurements, Layer 3 owns
   "does it look right / on-brand". Render with the PROJECT's shaders (`adapter.render`) for parity.

See `references/visual-qa-and-rubric.md`. **Standing principle:** every geometry/transform ships
with *both* an invariant assertion *and* a line in the debug render — so a silent error is impossible.

## Stage H — Accept

The project's acceptance gate runs (its own validation skill / CI): catalog entry valid, manifest
present, an E2E smoke renders the model in-game with correct color/number, no perf regression. On
pass, mark `model-prep.json` `accepted`.

---

## Resources

- `references/rapier-vehicle-tunables.md` — per-wheel tunables, arcade ranges, order-of-ops, sources.
- `references/wheel-rigging.md` — pivot hierarchy, recenter strategies, the perpendicular-offset metric.
- `references/destructibility.md` — detachable-parts lifecycle, pooling, gotchas.
- `references/balance-net-fair.md` — stat schema, point budget, archetype map, transfer function, Monte-Carlo.
- `references/visual-qa-and-rubric.md` — render harness options, CV checks, rubric calibration.
- `scripts/inspect-wheel-pivots.mjs` — generic GLB wheel-pivot inspector (perpendicular-offset metric).
- `scripts/validate-and-budgets.md` — runbook for glTF-Validator + glTF-Transform.
- `assets/model-prep.schema.json` — the per-model prep-manifest schema.
- `assets/rubric.template.json` — the project-fills rubric (thresholds, archetypes, budgets).
- `install.sh` — symlink this skill into `~/.codex/skills/` and `~/.copilot/skills/`.
