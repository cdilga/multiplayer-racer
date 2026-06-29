# Asset and Tooling Readiness Gates - Planning Draft (2026-06-29)

> Status: planning-workflow draft v0. This document exists because several useful Beads were
> captured before their surrounding plan had been written. Treat the current Beads as provisional
> issue captures until this plan has had at least one serious review/refinement pass and the Beads
> have been polished against the final plan.

> Scope: vehicle QA tooling, material/texture/light acceptance, first-two-car manual playtest
> governance, race/derby map authoring, local weapon testing, evidence artifacts, dependency
> sequencing, and test gates.

> Architecture reminder from `AGENTS.md`: in Local mode the host renders the full 3D world. Phones
> and keyboards are controllers and show only light HUD. Remote mode is the exception where each
> participant may render their own viewer and must degrade gracefully. All render/perf gates below
> therefore focus first on the host path.

## 1. Why This Plan Exists

The project has made fast progress on three related fronts:

1. A large vehicle/model pipeline exists on paper and in provisional Beads.
2. The `/car-viewer` debug editor already proves important visual QA ideas.
3. New planning needs were captured for map authoring and local weapon testing.

The risk is that agents now see implementation-looking Beads and start coding before the tool and
gate architecture is coherent. That would recreate the exact failure mode the planning workflow is
meant to prevent: implementation work scattered across large files, with acceptance depending on
human memory rather than a self-contained plan.

This document consolidates the intent into one planning artifact:

- what problem each tool solves;
- which existing code and plans it must reuse;
- what evidence has to be produced before work is accepted;
- which tasks are foundational versus later rollout;
- which Beads should exist after conversion, and which existing Beads are only provisional.

## 2. Current State

### 2.1 Vehicle Assets And QA

Relevant existing planning:

- `docs/plans/asset-spike-2026-06-28.md`
- `docs/plans/per-model-game-readiness-and-balance-2026-06-28.md`
- `docs/plans/feedback-design-pass.md` section 11.5 / asset pipeline notes
- `.claude/skills/game-model-prep/SKILL.md`
- `.claude/skills/vehicle-model-validation/SKILL.md`

Relevant code/assets:

- `frontend/car-viewer/viewer.js`
- `frontend/car-viewer/index.html`
- `static/debug-cars/*.glb`
- `static/debug-cars/manifest.json`
- `static/assets/vehicles/default.json`
- `static/js/resources/VehicleFactory.js`
- `static/js/systems/PhysicsSystem.js`
- `static/js/systems/DamageSystem.js`

The `/car-viewer` tool already does more than a throwaway viewer:

- loads the debug GLB manifest;
- uses `GLTFLoader`;
- classifies material roles from mesh/material names;
- clones materials per mesh so recolor separation can be tested;
- supports naive recolor versus classified recolor;
- forces wheel materials dark when enabled;
- adds emissive head/tail light geometry and ground light cones;
- adds underglow, roof number, nametag, wireframe, bounding box, and collider proxy;
- includes a rig preview with wheel spin, front-wheel steer, and suspension bob;
- exposes a debug hook through `window.__v`.

The model pipeline already says normalized selectable vehicles should expose `paint`, `tyre`,
`glass`, `metal`, and `light` conventions. It also says production runtime should not depend on
best-effort source-pack naming. The gap is that the new material/texture/light acceptance rules and
the `/car-viewer` evidence workflow need to be written into one plan and then reflected into final
Beads.

### 2.2 Map Reliability And Authoring

Relevant existing planning:

- `docs/plans/gaps/derby-map-reliability.md`
- `docs/plans/feedback-design-pass.md` geometry and map validation sections
- `docs/plans/architecture-findings-and-hardening-2026-06-29.md` determinism and run context

Relevant code:

- `static/js/GameHost.js`
- `static/js/resources/TrackFactory.js`
- `static/js/resources/ProceduralTrackGenerator.js`
- `static/js/entities/Track.js`
- `static/js/systems/PhysicsSystem.js`
- `static/assets/tracks/*.json`

Known issues already captured in planning/Beads:

- track creation can fail or half-build without a proper fail-loud path;
- `_resolveTrackId` and random arena selection need deterministic behavior;
- several modes can end up in invalid or empty worlds;
- race checkpoints need orientation and height awareness;
- spawn generation has a modulo cap;
- derby bowl wall/floor joins and shrink-wall physics need reliability work.

The map authoring tool should not be built before the validator layer exists. Otherwise it becomes
a pretty JSON editor that can still export broken maps.

### 2.3 Weapons And Pickups

Relevant existing planning:

- `docs/plans/gaps/pickups-props-debris-assets.md`
- `docs/plans/feedback-design-pass.md` weapons, debris, and asset sections

Relevant code:

- `static/js/systems/WeaponSystem.js`
- `server/app.py` weapon socket handlers
- `static/css/player.css` weapon HUD/control styles

Current `WeaponSystem` already has a useful behavioral boundary:

- pickup spawn and collection events;
- inventory;
- projectile, deployable, buff, hitscan, AOE, zone, and continuous weapon behavior;
- events such as `weapon:spawned`, `weapon:pickup`, `weapon:fired`, `weapon:hit`,
  `weapon:explosion`, `weapon:buffApplied`, and `weapon:continuousStart`.

The missing developer workflow is a deterministic local lab that exercises this real code without
creating a full multiplayer room, joining phones, or driving a full match just to test one weapon.

### 2.4 Provisional Beads Already Captured

These Beads currently exist and should be treated as provisional captures until this plan is
reviewed and final Beads are polished:

- `br-map-authoring-tool-j3i`
- `br-weapon-test-lab-zas`
- `br-modes-remote-play-design-48a.11.37`
- `br-modes-remote-play-design-48a.11.38`
- `br-modes-remote-play-design-48a.11.39`

The vehicle model graph also already contains the broader per-model prep lineage under
`br-modes-remote-play-design-48a.11`.

## 3. Planning Decisions

### 3.1 Tooling Is Part Of Acceptance, Not A Nice-To-Have

The debug/editor tools are not side projects. They are how agents create evidence that a change is
ready:

- `/car-viewer` produces vehicle visual QA evidence;
- the map authoring tool produces map validation evidence and reproducible export packages;
- the weapon lab produces deterministic weapon behavior and VFX evidence.

Each tool must have a clear relationship to production code. A tool that reimplements the game in a
parallel fake path is not acceptable.

### 3.2 Runtime Heuristics Must Not Hide Bad Assets

For vehicles, a selectable model should enter the production catalog only after normalization has
made material roles, wheel nodes, scale, origin, forward axis, light surfaces, number mount, and
collider metadata explicit. Runtime may have debug fallbacks for inspection, but production should
not silently guess its way around bad source assets.

For maps, the authoring tool may help a designer fix invalid JSON, but the game must not spawn
players into a broken world. Invalid maps fail loudly and preserve the host/lobby rather than
falling into a void.

For weapons, the lab must reuse real `WeaponSystem` behavior and event contracts. It should not
bless a fake local implementation that then diverges from match behavior.

### 3.3 Evidence Must Be Attached To Bead Completion

The final Beads should require named artifacts, not vague "looked good" claims. Useful artifacts:

- screenshots from `/car-viewer`;
- screenshots from actual host/render harness paths;
- `model-prep.json` stage records;
- material role maps and texture/material budgets;
- map JSON/seed/debug package/validator report;
- weapon lab scenario JSON, event summary, and screenshots;
- relevant `npm test`, `npm run build`, browser smoke, or E2E output.

### 3.4 Human Review Gates Are Explicit Governance

The first two imported cars need a human gate because subjective vehicle quality is currently the
highest-risk unknown:

- the models may technically pass but still look wrong;
- recolor may be "correct" but ugly or unreadable;
- lights may be present but disorienting;
- vehicle feel may be usable in metrics but bad in play.

The first-two gate is not a courtesy review. It is a stop sign. Broad per-model rollout waits for
`cdilga` to personally playtest and approve the first two pilot vehicles.

## 4. Workstream A - Vehicle QA Editor And Evidence Workflow

### 4.1 Goal

Promote `/car-viewer` from "nice debug page" to the formal vehicle QA surface used before closing
model import, visual polish, material, color, light, rig, and selection work.

### 4.2 User Workflow

Agent workflow:

1. Open `/car-viewer`.
2. Load a raw `static/debug-cars` model.
3. Inspect mesh count, triangle count, original material count, classified material groups, size,
   wheel separability, light group, and collider proxy.
4. Toggle naive recolor and classified recolor to expose whether normalization is needed.
5. Toggle black wheels, headlights, light cone, underglow, roof number, nametag, wireframe, bounding
   box, rotate, and rig preview.
6. Flip the explicit forward axis if needed and capture evidence when lights/front orientation are
   wrong.
7. Compare the raw model to the normalized production catalog entry.
8. Export or capture screenshots and diagnostics.
9. Use failures to fix normalization/authoring metadata, not runtime heuristics.

Human workflow:

1. Open the same tool for the first two pilot cars.
2. Review material separation, paint colors, wheels, glass, lights, number, name, and silhouette.
3. Compare against actual host render/playtest before approving broad rollout.

### 4.3 Tool Requirements

The QA editor should support:

- raw debug-car manifest loading;
- production vehicle catalog loading;
- side-by-side raw versus normalized comparison or a clear switch between them;
- material role display using the production roles: `paint`, `tyre`, `glass`, `metal`, `light`;
- original material/texture counts and normalized material/texture counts;
- at least two paint color swatches used for validation;
- default, dark/neon, and host-like lighting presets;
- headlights/tail lights on/off;
- proof that lights move with suspension/body rig state;
- explicit forward-axis indicator;
- roof number and nametag readability;
- wireframe and collider proxy;
- screenshot/export button for evidence.

### 4.4 Non-Goals

- Do not make `/car-viewer` the player-facing picker.
- Do not let the player-facing picker accept arbitrary file paths.
- Do not add CDN dependencies.
- Do not use per-car runtime `PointLight`s as the default selectable vehicle lighting path.

### 4.5 Acceptance Evidence

A model evidence bundle should include:

- vehicle id and source asset path;
- normalized catalog id and manifest path;
- material role map;
- texture/material/triangle budgets;
- default color screenshot;
- two player-color screenshots;
- tyres/wheels after recolor;
- glass/metal/light neutrality after recolor;
- headlights/tail lights orientation proof;
- rig preview screenshot or generated frames;
- collider proxy fit screenshot;
- relevant validation/test output.

## 5. Workstream B - Vehicle Material, Texture, And Light Acceptance

### 5.1 Goal

Make material/texture/light quality a hard acceptance gate rather than an informal visual note.

### 5.2 Gate Rules

A selectable vehicle cannot pass if:

- `paint` resolves to no mesh/material;
- recoloring `paint` also recolors tyres, glass, metal, or lights;
- tyres are not black/dark neutral after recolor;
- glass becomes unreadable or too similar to paint;
- headlights/tail lights are absent without an explicit acceptable substitute;
- front/rear light orientation is wrong;
- lights detach from the body during suspension/rig preview;
- lights are blinding or disappear in host-like dark/neon lighting;
- embedded GLB cameras or runtime lights are present in selectable vehicles;
- texture size, material count, GLB size, or draw-call implications exceed budget;
- baked lighting or a one-material atlas blocks clean recolor and no normalization fix exists.

### 5.3 Normalization Contract

Every selectable GLB should have:

- explicit `paint`, `tyre`, `glass`, `metal`, and `light` material role declarations;
- stable wheel nodes with wheel indices;
- explicit forward axis;
- scale and ground/origin metadata;
- collider-fit metadata;
- roof-number mount metadata;
- light mount/material metadata when source light meshes are insufficient;
- proof that the production loader can apply the metadata without guessing.

### 5.4 Relationship To `model-prep.json`

`model-prep.json` should record:

- source asset and normalized asset hash/path;
- validator version;
- material role map;
- texture/material budgets;
- recolor screenshots/artifact paths;
- light orientation/readability results;
- rig preview results;
- collider/CoM/balance/destruction results from the broader model-prep pass;
- final Stage H status from `vehicle-model-validation`.

The material/light section must be visible as its own pass/fail area, not buried in a generic
"visual QA passed" line.

## 6. Workstream C - First-Two-Car Manual Playtest Gate

### 6.1 Goal

Stop broad model rollout after two pilot vehicles until the human coordinator has personally
confirmed the whole workflow produces cars that look and feel good.

### 6.2 Default Pilot Pair

Default pilot pair:

- `hatchback-sports`
- `sedan-sports`

These currently map to:

- `br-modes-remote-play-design-48a.11.10`
- `br-modes-remote-play-design-48a.11.11`

The human coordinator can explicitly choose a different first-two pair. If that happens, the plan
and Bead dependencies should be updated before implementation starts.

### 6.3 Human Review Workflow

For each pilot car:

1. Review the raw and normalized asset in `/car-viewer`.
2. Review the selectable picker/customization path.
3. Review host render in at least one race context.
4. Review host render in at least one derby context if derby is available.
5. Drive the car enough to judge basic feel, readability, lights, recolor, number/name, and
   silhouette.
6. Read the Stage H evidence bundle.
7. Post explicit PASS or blockers.

### 6.4 Gate Closure Rule

The manual gate can close only if `cdilga` explicitly records:

- vehicle ids reviewed;
- contexts played;
- PASS for broad rollout, or blockers;
- any required follow-up beads.

Agents must not close this gate based on:

- their own screenshots;
- automated tests;
- passing `vehicle-model-validation`;
- a generic "looks good";
- absence of reported complaints.

## 7. Workstream D - Race/Derby Map Authoring Tool

### 7.1 Goal

Build a local/developer-facing map authoring tool for both Race and Derby modes that exports only
valid, reproducible, host-renderable map definitions.

### 7.2 Dependency On Map Validation

This tool depends on the map validity work. The authoring tool should call the same validation logic
used by the host start path and tests. If the validator does not exist yet, build the validator first.

Minimum required validator concepts:

- geometry surface exists;
- colliders exist;
- derby walls/bounds are closed;
- race checkpoints exist, are ordered, and have orientation/height constraints;
- spawn count supports player count without modulo reuse;
- spawns are separated, in bounds, not penetrating, and have ground below;
- pickup/prop/debris zones do not overlap invalid terrain or spawn positions;
- random/procedural seeds are deterministic and replayable.

### 7.3 Race Authoring Workflow

The race authoring view should support:

- load existing `static/assets/tracks/*.json`;
- create new procedural seed/config;
- edit centerline/spline/oval parameters where available;
- show racing line and track width;
- edit checkpoints as oriented gates with height bands;
- edit spawn grid/packing and headings;
- edit barriers/curbs/edge normals;
- edit pickup zones;
- edit props/debris zones if that work has landed;
- run validator;
- export JSON plus seed and debug report;
- launch or hand off into host smoke test with the exported map.

### 7.4 Derby Authoring Workflow

The derby authoring view should support:

- load existing derby arenas;
- edit bowl/coliseum/dunes/square-style parameters;
- preview bowl profile, floor/wall transition, shrink boundary, and valid bounds;
- edit spawn packing and headings;
- edit weapon/pickup zones;
- edit default debris/obstacle placement if debris work has landed;
- visualize wall normals, collider contours, out-of-bounds, and shrink-wall path;
- run validator;
- export JSON plus seed and debug report;
- launch or hand off into a host derby smoke test.

### 7.5 Visual Overlays

The map tool should visualize:

- surface mesh;
- physics colliders;
- spawn footprints and car clearance radius;
- checkpoint planes and order;
- wall normals and barrier segments;
- closed-boundary gaps;
- raycast hits from spawns;
- pickup/weapon zones;
- prop/debris zones;
- validation failures with clickable/focusable details.

### 7.6 Non-Goals

- Do not create a public UGC map sharing system in v1.
- Do not let exported maps bypass schema/validator checks.
- Do not require phones/controllers to use the authoring tool.
- Do not create a second renderer unrelated to the host map rendering path if the host render path can
  be reused.

### 7.7 Acceptance Evidence

Map tool evidence should include:

- one exported race map;
- one exported derby arena;
- validator report for each;
- screenshot of overlays for each;
- JSON/seed round-trip proof;
- host-path smoke test output for each exported map.

## 8. Workstream E - Local Weapon Test Lab

### 8.1 Goal

Create a standalone local weapon lab that tests the real weapon code deterministically without a
normal multiplayer room or phone controller.

### 8.2 Core Design

The weapon lab should:

- run as a dev-only route such as `/weapon-lab`, or an equivalent local harness;
- load the real weapon definitions;
- exercise real `WeaponSystem` behavior and event emission;
- provide a minimal flat arena or validated test arena;
- spawn scripted source and target vehicles;
- allow weapon selection/grant/pickup/fire/reset;
- support slow motion and single-step update;
- show scenario state and emitted event summaries.

### 8.3 Weapon Coverage

The lab must cover:

- projectile weapons;
- deployable mines;
- boost/buff weapons;
- shield behavior;
- hitscan weapons;
- AOE/EMP/stun behavior;
- zone/oil slick behavior;
- continuous/flamethrower behavior;
- pickup marker visuals;
- world object visuals such as mines, missiles, zones, and shields where implemented.

### 8.4 Debug State

The lab should show:

- active weapon inventory;
- cooldown/lifetime/arm timers;
- projectile path;
- hit radius/cone;
- target health/damage;
- stun/buff/shield timers;
- zone friction state;
- emitted events;
- deterministic seed/tick;
- reset/scenario id.

### 8.5 Tests

Automated tests should cover representative behavior for:

- projectile hit/miss;
- deployable trigger/arm/lifetime;
- buff duration and expiry;
- shield preventing damage;
- hitscan target selection;
- AOE/stun radius;
- zone friction effect;
- continuous tick damage;
- event emission summary.

The lab should also provide a local manual visual path for pickup/weapon model polish.

### 8.6 Non-Goals

- Do not require a room code.
- Do not require a phone client.
- Do not fake the weapon rules in a separate implementation.
- Do not log per-frame spam to the console.

## 9. Cross-Cutting Architecture Requirements

### 9.1 Determinism

The map tool and weapon lab should align with the architecture hardening plan:

- deterministic seeds;
- explicit run context;
- no untracked `Math.random()` in test scenarios;
- scenario ids and exportable replay inputs;
- repeatable validation failures.

### 9.2 Evidence Artifacts

Every tool should produce artifacts that can be attached or referenced in Beads:

- JSON config;
- seed/scenario id;
- screenshots;
- validation summaries;
- event summaries;
- test output;
- version/build metadata where available.

### 9.3 Host/Controller Boundary

All visual QA, map authoring, and weapon lab render work is host/developer tooling. Local phones are
not required to render the world. Phone/controller changes are limited to where appearance choices or
weapon HUD state need to be validated through the normal controller path.

### 9.4 No Broad Runtime Guessing

Normalization and validation should happen before runtime. Production runtime should consume explicit
catalog/manifests and fail safely on invalid data.

## 10. Implementation Sequencing

This is the recommended implementation order after the plan is refined and Beads are polished.

### Phase 0 - Plan And Bead Readiness

1. Review this plan at least once.
2. Integrate accepted revisions into this markdown file.
3. Convert or revise provisional Beads so each final Bead is self-contained.
4. Run `bv --robot-triage` and `br dep cycles --blocking-only --json`.

### Phase 1 - Vehicle Foundations

1. Vehicle catalog/schema and validator.
2. GLB loader/VehicleFactory adapter.
3. `/car-viewer` production-catalog inspection path.
4. Headless render harness.
5. Deterministic material/geometry gates.
6. Material/texture/light acceptance gate.
7. Prep-manifest runner integration.

### Phase 2 - Pilot Vehicle Rollout

1. Normalize/import `hatchback-sports`.
2. Normalize/import `sedan-sports`.
3. Run validation skill and evidence bundle for both.
4. Human manual playtest gate.
5. Only then continue broad per-model rollout.

### Phase 3 - Map Validation Before Authoring

1. Implement or complete `validateArena`.
2. Fix fail-loud host start behavior.
3. Cover every mode x map in tests.
4. Fix checkpoint/spawn/bowl/shrink-wall blockers as needed.
5. Build map authoring tool on top of the validator.

### Phase 4 - Weapon Lab Before Weapon/Asset Polish

1. Extract enough `WeaponSystem` seams for local deterministic harnessing.
2. Build weapon lab route/harness.
3. Add scenario tests for core weapon categories.
4. Use the lab to validate pickup/weapon model work.

### Phase 5 - Expansion And Polish

1. Broader vehicle roster.
2. Pickup/weapon models.
3. Debris and props.
4. Perf gates for host at 4/24/60 cars and weapon/debris stress.
5. Remote viewer degradation checks where relevant.

## 11. Draft Bead Conversion Map

These are the Beads that should exist after review. Some already exist provisionally and should be
updated rather than duplicated.

### 11.1 Vehicle Tooling And Gates

- Vehicle catalog/schema and validator.
- GLB loader and VehicleFactory adapter.
- `/car-viewer` production-catalog QA mode.
- `/car-viewer` screenshot/diagnostic export.
- Headless render harness seeded from `/car-viewer`.
- Deterministic CV/geometry gates.
- Vehicle material/texture/light acceptance gate.
- Prep-manifest runner with material/light evidence.
- First-two-car manual playtest gate.

### 11.2 Pilot Vehicles

- `hatchback-sports` model readiness.
- `sedan-sports` model readiness.
- Human gate close/fail follow-up.

### 11.3 Map Tooling

- Map validator core.
- Host fail-loud invalid-map path.
- Mode x map validation matrix.
- Race map authoring tool.
- Derby arena authoring tool.
- Map export/import round-trip tests.
- Authoring screenshot/debug package export.

### 11.4 Weapon Tooling

- Weapon lab harness seam.
- Weapon lab UI/route.
- Weapon scenario schema and deterministic seed.
- Representative weapon category tests.
- Pickup/weapon visual QA through lab.

## 12. Readiness Checklist Before Implementation Swarm

Do not start broad implementation until:

- this plan has been reviewed/refined;
- final Beads are self-contained and dependency-aware;
- the provisional Beads have been reconciled or replaced;
- no blocking dependency cycles exist;
- the first implementation pick from `bv --robot-triage` matches the plan sequence;
- Agent Mail thread(s) announce the final plan and Bead state;
- file reservations are narrow and ready for each implementation bead.

## 13. Open Questions

1. Should the first two pilot vehicles remain `hatchback-sports` and `sedan-sports`, or should one
   heavy vehicle be included to exercise a wider physics/material range?
2. Should the map authoring tool be one route with Race/Derby tabs, or separate `/map-lab` and
   `/arena-lab` routes?
3. Should the weapon lab use a full Three/Rapier host scene from the start, or begin with a
   headless deterministic harness plus a visual route after the behavior seams are stable?
4. Should `/car-viewer` export JSON diagnostics directly, or should a Playwright script capture and
   attach the evidence bundle?
5. What is the minimum human review artifact for the first-two-car gate: Beads comment only, Agent
   Mail thread note, or both?

## 14. Plan Review Prompt

Use this plan as the artifact for the next planning-workflow pass. Suggested review prompt:

```text
Carefully review this entire plan for me and come up with your best revisions in terms of better
architecture, new features, changed features, etc. to make it better, more robust/reliable, more
performant, more compelling/useful, etc. For each proposed change, give me your detailed analysis
and rationale/justification for why it would make the project better along with the git-diff style
change versus the original plan shown below:

<paste this complete plan>
```

After revisions are accepted, integrate them into this file, then convert/polish Beads.
