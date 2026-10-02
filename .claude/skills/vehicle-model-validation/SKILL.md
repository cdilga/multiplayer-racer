---
name: vehicle-model-validation
description: Acceptance gate for Joystick Jammers 0.2 vehicle models (code-built per R81). Use before calling any vehicle model, LOD, damage-part, paint/identity, contract sidecar, loader or in-game vehicle-rendering task done, including the Cruz Missile and any later roster car.
---

# Vehicle Model Validation (0.2)

The final gate for vehicle model work. It answers "is this car production-ready for the game to
render, identify, damage, load and simulate?", not "does it drive well?" (that's G-FEEL). Don't
call a vehicle task done without visual evidence, check output and a written PASS/FAIL report.

0.1's GLB-pack import pipeline (`static/assets/vehicles/`, `VehicleFactory`, per-mesh material
cloning) was deleted from this branch. It's readable at `git show v0.1-final:<path>` as history
only. Don't rebuild it.

## First: derive the active requirements

Read, in this order, and only then validate:

1. `docs/policies/owner-direction-2026-09-29.md`: R81 (code-built, faceted at every tier, lean
   triangle budget) and R86 (damage = intact → loose → detached; no denting).
2. `docs/plans/v0.2-playtest-1-plan.md` §6 (vehicle and damage contract) for the Playtest-1 car,
   and `docs/plans/v0.2-revamp-plan-2026-09-28.md` §12.3–§12.5 for the general contract.
3. The modelling method: `.claude/skills/lowpoly-model-from-refs/`. Reference implementation and
   evidence: `spikes/art-pipeline/J-cruze-lowpoly/REPORT.md`.
4. The changed files: model script + params, atlas, sidecar, baked GLB, loader/renderer code and
   tests touched by the task.

Don't invent scope, and don't skip a state the active plan requires just because the task didn't
name it.

## Gates

### 1. Source and contract
- The model comes from its **model script + parameter file + reference sheets** (R81), not a
  hand-edited mesh. Re-running the script reproduces the shipped geometry byte-for-byte.
- Baked output (GLB + `*.asset.json` sidecar) passes the contract validator with no waivers.
- Units are metres, one documented forward axis, **origin on the ground between the axles**.
- Part IDs are exactly the active set (Playtest 1: `core`, `front`, `back`, `door_FL/FR/RL/RR`,
  `wheel_FL/FR/RL/RR`), identical at every LOD, each with pivot/hinge, mass fraction and collider
  proxy. **Mass fractions sum to 1 ± 0.01** (Spike C found 0.92).
- Required anchors: `cam_fp`, `cam_tp_target`, `com`, roof-number mount, L-plate mounts.
- No real badges, logos or trademarked names in geometry, atlas or names.

### 2. Geometry and budget
- Faceted/polygonal look at every tier; no smooth shading creeping in.
- Triangles per LOD are within the qualified budget (starting point from Spike J:
  ≤ ~1.3k / 0.9k / 0.6k). Report each part's count.
- Silhouette IoU against the reference sheets meets the skill's target (~0.95 weighted), with the
  by-eye cue pass recorded (lamps, grille, livery, accessories).
- Mesh hygiene: finite values, valid indices, no zero-area triangles.

### 3. Paint, identity and draw cost
- **One material for all cars.** Player colour comes from `instanceColor` through the atlas
  **paint key** (pure-white texels tint; glass, lamps and livery keep their colours). Per-car
  material clones fail this gate.
- Instanced rendering: one InstancedMesh per part type across all cars, so draws per tile stay
  constant as N grows. Report draws/frame for 24 cars × 24 tiles (Spike J: 216).
- Roof number legible in the smallest reference tile (24 tiles at 1080p, car ~100 px tall).
- Tyres stay dark/neutral under every player colour.

### 4. Damage states (R86)
- Each part shows **intact → loose → detached**. Loose is a visible hang/wobble about the part's
  hinge while still attached. Detached becomes a dynamic body with its own collider and mass,
  inheriting velocity, and stays on the track for the round (R58: no TTL, cap, static conversion).
- A missing part reads as a dark opening (the core holds dark bays); no see-through holes into
  the void.
- Wheel loss is visible and the car stays recoverable (limp/wreck rule in the Playtest-1 plan).

### 5. Physics fit
- Collider proxies are convex/cuboid/capsule, never render-mesh trimesh. The cabin proxy is
  genuinely rounded (Spike C: a "round" proxy that was really a box).
- Loads into `jj-sim` (native) and settles: no NaN, no ground penetration, ride height within the
  profile's band. Flip recovery is handled by the sim's assist, not assumed from the shape.

### 6. Visual evidence (from the real loader and renderer, not a DCC viewport)
Minimum set: default colour; two bright player colours; tyre-neutral proof; front/side/rear/top
and 3/4; LOD ladder at its switch sizes; damage strip intact → loose → each part detached; 1, 4
and 24-tile grid captures with own-car identity visible; collider overlay. Use reproducible
Playwright captures and say which commit they came from.

### 7. Automated checks
Run the narrowest checks that prove the change, then broaden with risk: contract validator,
model-script reproducibility, `jj-sim` load/settle scenario, renderer capture test, and the N×N
instancing bench when materials/batching/loader changed. If a check doesn't exist yet, say so
and name the bead that adds it. A screenshot is not an automated check.

## Done report

```markdown
Vehicle Model Validation: PASS/FAIL

Vehicle/part IDs:            Commit:
Changed files:
Requirement source: (policy rulings, plan sections)

Visual evidence:
- path: what it proves

Checks run:
- command: result

Findings:
- PASS/FAIL contract + reproducibility
- PASS/FAIL budget + silhouette
- PASS/FAIL paint key / one material / draws per tile
- PASS/FAIL damage states (intact → loose → detached, dark openings)
- PASS/FAIL physics fit (mass sum, origin, rounded proxy, settle)
- PASS/FAIL identity/readability at the smallest tile

Remaining blockers:
- none / exact list
```

Only report PASS when nothing blocks the active scope.

## Relationship to other skills
- `lowpoly-model-from-refs`: the canonical **build** method (R81). This skill is its gate.
- `game-model-prep`: engine-generic background (rigging, collider fit, visual QA rubric). Its
  debris-lifetime section defers to project policy; JJ debris persists (R58/R66).
- `threejs-primitive-modelling`: Spike H/I method, reference only for vehicles since R81.
