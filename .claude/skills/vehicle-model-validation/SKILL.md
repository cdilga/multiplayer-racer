---
name: vehicle-model-validation
description: Validate Joystick Jammers vehicle model imports, replacements, and asset-normalization work before calling them done. Use when adding or changing car/vehicle GLB assets, vehicle manifests/catalog entries, recolor/material conventions, wheel rigging, collider fit, model previews, asset viewer behavior, or any bead involving FB-assetcatalog, FB-assetnorm, FB-assets, FB-carselect, vehicle selection, or car model visual polish.
---

# Vehicle Model Validation

Use this skill as the final gate for any vehicle model import or normalization task. It is separate
from gameplay tuning: the question is not "does the car drive well?" but "is this model import
production-ready for the game to render, identify, recolor, rig, validate, and debug?"

Do not mark a model task done without visual evidence, test/check output, and a written pass/fail
summary against the active requirements.

## Relationship to `game-model-prep` (the generic skill)

This skill is the **Joystick Jammers acceptance gate (Stage H)** and project adapter for the
engine-generic `game-model-prep` skill (`.claude/skills/game-model-prep/`). Run `game-model-prep`
for the *workflow* (normalize → rig → collider/CoM → balance → destruct → color → visual QA); run
*this* for JJ wiring and the final gate before a per-model bead can close. The per-model plan is
`docs/plans/per-model-game-readiness-and-balance-2026-06-28.md`.

### Verified codebase facts (2026-06-28) — build on these
- **No glTF loader yet.** `VehicleFactory._createVisualMesh` (`VehicleFactory.js:100`) is primitives
  only; `ResourceLoader` is JSON-only. First adapter task = a glTF path (wheels stay tagged
  `userData.isWheel`/`wheelIndex`, synced by index).
- **CoM already works** — `PhysicsSystem.createVehicleBody:631` `colliderDesc.setMassProperties(...)`
  overrides `setDensity(4.0)`; `physics.centerOfMass` is honored (tuning, not plumbing).
- **No top-speed cap** — `applyVehicleControls:817` = `accel * engine.force` vs `linearDamping`;
  `vc.currentVehicleSpeed()` available if you add a cap.
- **`setWheelSideFrictionStiffness` unused** — only `frictionSlip` is set; adding side-friction is
  net-new (cleaner wall-slide than today's `wallSlideGrip`).
- **Destruction fires in both modes** — `DamageSystem:269` always emits `damage:destroyed`; hook debris there.
- **Rigging is bimodal** — Kenney passes natively
  (`node .claude/skills/game-model-prep/scripts/inspect-wheel-pivots.mjs <glb>` → exit 0); Quaternius
  Poly-Pizza models fuse/mis-pivot wheels (exit 1) → Blender fix or defer.
- **Tooling:** Playwright installed; Blender + gltf-transform not (use `npx` for gltf-transform/validator).

## First: Derive Current Requirements

Before validating, read the current project context instead of assuming a fixed checklist:

1. Read `AGENTS.md` for architecture/perf constraints.
2. Read `docs/plans/asset-spike-2026-06-28.md`, especially the second-pass vehicle-selection
   pipeline.
3. Read `docs/plans/feedback-design-pass.md` §11.5 and the bead table rows for `FB-assetcatalog`,
   `FB-assetnorm`, `FB-assets`, `FB-carselect`, and `FB-instperf`.
4. Inspect the changed files: vehicle GLBs, vehicle manifests/catalog entries, normalization scripts,
   `VehicleFactory`, `ResourceLoader`, `frontend/car-viewer`, and tests touched by the task.
5. Identify which states the current model is expected to support from the active plan/code. Do not
   invent scope, but do not ignore required states because the user did not name them.

Typical current requirements include:

- normalized materials: `paint`, `tyre`, `glass`, `metal`, `light`
- stable wheel nodes: `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`
- declared forward axis, scale, ground offset, roof-number mount, and collider-fit metadata
- emissive headlights/taillights and under-glow when the current asset bead includes them
- visual support for steer/spin wheels, suspension travel, wheelie/airborne/landing readability,
  damageable lights, and player color/number identity when those systems are in scope

## Validation Pipeline

### 1. Source and Catalog Gate

Confirm the model is a cataloged local asset, not an ad hoc file:

- GLB path is under `static/assets/vehicles/`.
- `vehicles/catalog.json` or the current equivalent references the model by ID.
- The player-facing payload uses sanitized appearance fields such as `vehicleId`, `color`, `number`,
  and `skinId`; it must not send arbitrary asset URLs.
- License/source is recorded in the planning note or manifest when the asset is imported.
- The primitive fallback path still exists for CI/headless use.

### 2. Geometry and Scale Gate

Check the model after normalization, not just the raw downloaded GLB:

- glTF parses cleanly as GLB/glTF 2.0.
- Triangle count, material count, texture size, and file size are within the manifest budget.
- AABB dimensions after manifest scale match the intended physics body within tolerance.
- Bottom Y/ground contact is sane after normalization.
- Forward axis is declared and verified with lights, heading marker, or debug cone.
- No embedded cameras, animations, or point lights ship in v1 selectable vehicles unless the active
  plan explicitly allows them.

Technique that has worked here: use an oriented collider/debug proxy in the viewer, not only an
axis-aligned bounding box. The current screenshot-style failure to catch includes collider/visual
mismatch around karts, driver heads, and protruding wheels.

### 3. Material and Recolor Gate

Reject "single-color whole model" results. The current failure mode is a car where body, wheels, and
trim all inherit the same flat color.

Required checks:

- `paint` tints to the player color.
- `tyre` stays black/neutral when `paint` changes.
- `glass`, `metal`, and `light` stay readable and distinct.
- Headlights/taillights use emissive materials or added emissive geometry, not per-car point lights
  for the normal multiplayer path.
- Bloom/under-glow, if present, follows player color without washing the whole model.

Techniques shown successful in this project:

- clone materials per mesh before tinting so shared pack materials do not recolor wheels and glass
- normalize raw pack semantics offline to `paint`/`tyre`/`glass`/`metal`/`light`
- keep a dominant-material fallback only for debug tools, not as the production contract
- force tyres/wheels to black or dark neutral after body tinting

### 4. Rigging and State Gate

Validate the visual rig required by the current game state pipeline:

- four wheel meshes resolve and have stable indices
- front axle is identifiable
- wheel pivots are close enough to wheel centers for spin and steer
- wheel spin, front-wheel steering, and suspension bob are visually plausible in the model viewer
- body effects, light cones, under-glow, and number plates remain attached during suspension/wheelie
  preview states
- roof number mount remains readable from the expected camera angles
- if damageable lights are in scope, light parts can be individually targeted/hidden/dimmed without
  recoloring the whole car

Do not require skeletal animation for v1 vehicle selection unless the active bead explicitly asks for
rigged avatars or animated drivers. If the model includes a driver, validate collider fit and color
separation, but keep full avatar rigging as a separate plan.

### 5. Visual Evidence Gate

Every model import needs screenshots before it is called done. Save or link evidence from the actual
viewer/game path, not only a DCC viewport.

Minimum evidence:

- neutral/default color
- bright player color recolor
- wheel/tyre-black proof after recolor
- front/side/rear or orbit views
- top-down or high-angle view showing roof number/readability
- collider/debug proxy overlay
- rig/state preview: wheel spin, front steer, and suspension bob when supported
- any known problematic state from the task, such as wheelie, light damage, boost under-glow, or
  camera-facing identity marker

Prefer Playwright screenshots or reproducible browser screenshots. If a human screenshot is used,
state how it was produced and which commit/files it corresponds to.

### 6. Automated Checks Gate

Run the relevant checks for the files touched. Choose the narrowest checks that actually validate the
change, then broaden if risk is higher.

Expected checks for model imports:

- asset validator or equivalent script for catalog/manifest/model contract
- unit/integration tests for catalog loading or manifest parsing when present
- `npm run build` if browser code, loaders, or viewer code changed
- Playwright/visual smoke for the model viewer or in-game host path when rendering changed
- perf smoke for 4/24/60 cars only when the change touches batching, materials, lights, or loader
  behavior

If a planned validator does not exist yet, say that explicitly and replace it with a manual inspection
plus a concrete follow-up bead. Do not pretend a screenshot is an automated check.

## Done Report Format

Use this structure in the final note for any vehicle model validation:

```markdown
Vehicle Model Validation: PASS/FAIL

Model/catalog IDs:
Changed files:

Requirement source:
- docs/plans/...
- code/manifests inspected...

Visual evidence:
- screenshot/path: what it proves
- screenshot/path: what it proves

Checks run:
- command: result

Findings:
- PASS/FAIL material separation
- PASS/FAIL wheel rig/state preview
- PASS/FAIL collider fit
- PASS/FAIL scale/origin/forward axis
- PASS/FAIL identity/readability

Remaining blockers before done:
- none / list exact blockers
```

Only report `PASS` when there are no blockers against the active model-import scope.
