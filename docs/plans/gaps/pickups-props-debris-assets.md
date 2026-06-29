# Gap — Non-Car Assets: Pickups, Weapons, Track Props & Destruction Debris

> **Status:** v1 — gap-fill for the asset theme. Closes the open half of To-Do item **7 ("actual game
> assets")** that the main pass left under-specified. Extends `feedback-design-pass.md` §11.5 (Theme H),
> the `asset-spike-2026-06-28.md` pipeline, and the owner's damage notes in `GAME_IMPROVEMENT_IDEAS.md`
> (lines 73–74). **Method (Jeff Emanuel workflow, matching the parent plan):** front-load reasoning,
> ground every claim in `file:line`, give *Options → Recommendation* per item, make each item testable,
> derive beads.
>
> **Scope.** §11.5 designed the **car** pipeline thoroughly (catalog, normalization, GLTF loader, paint,
> selection — `FB-assetcatalog`/`FB-assetnorm`/`FB-assets`/`FB-carselect`). This doc fills the **other**
> art the game spawns and that §11.5 deferred: **destruction debris** (the owner's headline "all 4
> wheels come off"), **weapon/pickup models**, and **track props/decoration**. It deliberately *reuses*
> the car pipeline's contracts — CC0 library meshes, the `FB-assetcatalog`/`FB-assetnorm` normalization
> gate, the validation gate, AI-for-2D-only, flag-gated/parallel — and stays **off the gameplay critical
> path**.

---

## 0. Why this is a real gap (grounded)

The car pipeline is well-designed, but everything *else* the world spawns is programmer-art primitives:

- **Destruction.** On death `Vehicle._triggerExplosion()` (`Vehicle.js:198-238`) just hides the chassis
  (`this.mesh.visible = false`, `:202`) and spawns **30 ad-hoc orange/yellow `SphereGeometry` particles**
  (`:218-227`). Nothing detaches. The owner explicitly wants the opposite: *"Damage should send little
  wheels (hard objects that can be hit and also cause other cars to flip on them) and parts of the car
  model exploding outwards… ideally at least all 4 wheels come off"* (`GAME_IMPROVEMENT_IDEAS.md:74`).
  Today there is **no physical debris** and **no detached-wheel hazard** at all.
- **Pickups.** `WeaponSystem._createPickupMesh()` (`WeaponSystem.js:628-648`) returns a single glowing
  `BoxGeometry(2,2,2)` tinted by `weapon.ui.color` — *every weapon looks identical* except color. The
  weapon identity that *does* exist is **emoji icons** in the defs (`icon: '🚀'` missile `:137`, `💣`
  mine `:165`, `🔥` boost `:190`, oil `:212`, `⚡` railgun/EMP `:233/272`, `🛡️` shield `:253`,
  flamethrower `:291`) — never rendered in 3D. Eight weapon types (`WEAPON_TYPES`, `:19-30`), one box.
- **Track props.** There are **none**. Tracks/arenas are spline ribbons + barrier builders
  (`TrackFactory.js`, `ProceduralTrackGenerator.js`); no cones, no scenery, no decoration. The arenas
  read as empty neon bowls.
- **The assets are already on disk.** The spike's Kenney Car Kit download includes the full debris +
  prop set, staged at `static/debug-cars/` and catalogued in `static/debug-cars/manifest.json`
  (group `"Debris (damage parts)"` lines 116–184; group `"Props"` lines 205–219; group `"Wheels"`
  231–268). So this is, like the car work, **mostly a loader/system problem, not a sourcing problem.**

**Staged CC0 GLBs we can use immediately** (all Kenney Car Kit, CC0, ~flat-shaded arcade, share the
12 KB `colormap` atlas):

| Purpose | Staged GLBs (`static/debug-cars/`) |
|---|---|
| **Detached wheels** (the headline hazard) | `wheel-default.glb`, `wheel-dark.glb`, `wheel-racing.glb` (+ `debris-tire.glb`) |
| **Body panel debris** | `debris-bumper.glb`, `debris-door.glb`, `debris-door-window.glb`, `debris-spoiler-a.glb`, `debris-spoiler-b.glb`, `debris-plate-a.glb`, `debris-plate-b.glb`, `debris-plate-small-a.glb`, `debris-plate-small-b.glb` |
| **Mechanical debris** (small, sparks-y) | `debris-drivetrain.glb`, `debris-drivetrain-axle.glb`, `debris-bolt.glb`, `debris-nut.glb` |
| **Track props** | `cone.glb`, `cone-flat.glb`, `box.glb` |

The Racing Kit / Racing Pack (same CC0 family, noted in the spike survey) adds barriers, tyre stacks,
start gantries, signage if we want more props later — same pipeline, no new licensing.

---

## 1. Destruction debris (item 7 + `GAME_IMPROVEMENT_IDEAS.md:73-74`)

**Problem (grounded).** Death is a fake puff of spheres (`Vehicle.js:218-238`); the owner wants real
parts — **especially all four wheels** — to detach and fly outward as **physical hazards** that can
"cause other cars to flip." Two hard sub-problems: (a) turning a destroy event into detached physics
bodies with the right impulses, and (b) doing it for *N* simultaneous cars without tanking the host
renderer/physics. Two integration seams already exist to hang this on: `DamageSystem` emits
**`damage:destroyed`** (`DamageSystem.js:269-272`) on death, and the per-part light-damage bead
**`FB-lightdamage`** (§13) already establishes a *part-level* hit model (headlights break at the light's
position). Debris is the same idea generalized: parts come off at *their* position.

### Options

- **D1a — Keep the sphere puff (status quo).** Zero work, but ignores the owner's explicit ask and adds
  no gameplay (no hazard). Rejected.
- **D1b — Pure particle "shards" (textured billboards/quads).** Cheap, no physics; cosmetic only. Fails
  the "hard objects that flip other cars" requirement. Use only as the **degraded** tier (§1.3).
- **D1c — Detached GLB debris as Rapier dynamic bodies (recommended).** On `damage:destroyed`, swap the
  intact chassis for a small set of **detached debris pieces** — the **4 wheels** + 2–4 body panels —
  each a `THREE` mesh (cloned from the staged Kenney debris GLBs) backed by a short-lived Rapier
  **dynamic** rigid body (`RigidBodyDesc.dynamic()`, as the chassis uses at `PhysicsSystem.js:586`),
  seeded with an outward + upward impulse and spin. Wheels get a **rolling collider** (ball/short
  cylinder) so they keep rolling and *do* collide with other cars; panels get cheap convex/cuboid
  colliders. This is exactly the owner's spec and matches the established "CC0 mesh + Rapier body"
  pattern. The cost — N×~6 dynamic bodies at once — is the real risk, handled by §1.3.
- **D1d — Hybrid (recommended pairing).** D1c for the **wheels + 1–2 hero panels** (they're the hazard
  and the readable "it came apart" beat), plus a **bloom-boosted spark/smoke burst** from the existing
  `ParticleSystem` (`createExplosion`, `ParticleSystem.js:184`; presets `:28-90`) for the rest of the
  visual fireball. Best look-per-body: few physical pieces, lots of cheap particles.

### Recommendation

**D1d.** On `damage:destroyed`: detach the **4 wheels as rolling dynamic hazards** (the owner's
must-have) + **2 body panels** as dynamic debris + a particle burst for the fireball. Replace the
ad-hoc sphere loop in `Vehicle._triggerExplosion()` with an event the **debris system** owns, so
`Vehicle` stays a thin entity and the physics lives in a system (architecture vision: extract systems,
EventBus over direct refs).

**Mechanism (concrete).**
1. **New `DebrisSystem`** (`static/js/systems/DebrisSystem.js`) subscribes to `damage:destroyed`. It
   reads the dying vehicle's transform, velocity, and **its normalized wheel nodes** (`userData.isWheel`
   / `wheelIndex` — already tagged by `VehicleFactory`, see `Vehicle.js:128-134` and the `FB-assetnorm`
   `wheel_fl/fr/rl/rr` convention) so the four detached wheels spawn at the *actual* wheel world
   positions, not guesses.
2. For each piece: take a **pooled** debris mesh (clone of the staged Kenney GLB) + a pooled Rapier
   dynamic body; set its transform to the part's current world pose; apply an impulse =
   `outwardRadial * burst + up * lift + inheritedChassisVelocity` with random spin
   (`applyImpulseAtPoint`, already used at `PhysicsSystem.js:917`). Wheels: rolling ball/cylinder
   collider, higher restitution (they roll and bounce off cars). Panels: cuboid collider.
3. **Persist on the field as live hazards (owner decision — core derby fun, NOT a transient burst).**
   Detached pieces **stay in the world for the rest of the round** (or until the budget evicts them,
   §1.3). They keep their dynamic bodies and **keep colliding with and shoving cars** — a car that
   drives into a loose wheel gets bumped/flipped, and a wheel that gets shoved rolls onward. After their
   initial fling, fast-moving pieces are allowed to **settle and let Rapier sleep them** (cheap when
   idle) but they remain collidable and **re-wake on contact** — so an arena fills with carnage as the
   round goes on. Pieces are removed only by (a) round end / arena reset, or (b) the eviction policy when
   the cap is hit (§1.3). No fixed per-piece TTL despawn. (A short opacity-fade is reserved for *evicted*
   pieces only, so culls don't pop.)
4. **Per-part damage reuse.** Generalize `FB-lightdamage`'s part-hit hook: a strong localized hit can
   detach the *nearest* panel/wheel **before** death (progressive disassembly), reusing the same
   pooled-piece spawn path. Death just detaches whatever's left. Pre-death detached parts persist too.

**Debris contract (extends `FB-assetnorm`).** The car-normalization pass already stamps material
conventions + wheel nodes; extend it to emit a tiny **debris manifest** per silhouette:
`{ wheels: [nodeName×4], panels: ["debris-bumper","debris-spoiler-a", …], detachMounts: [localXYZ] }`,
plus a normalized debris-piece catalog (scale to game units, centered pivots, `paint`/`tyre` material
tags so a detached wheel is still black and a detached panel still carries the player's paint color).
This keeps debris **on the same catalog/validation rails** as cars — no runtime name-guessing.

### 1.3 Full debris lifecycle (owner decision — "ensure the lot is captured")

Debris is a **persistent field that accumulates over a round**, with one budget governing the whole
lifecycle. The four phases:

1. **Default spawn (arena start).** Each arena seeds **a few debris/obstacle pieces on the field from the
   get-go** so there's carnage potential *before* any car dies. Default **6–10 pieces per arena** (a mix
   of loose wheels + smashable boxes + panels), scaled by arena size and player count
   (`clamp(6, round(players * 0.75), 12)`). **Placement is data-driven**, not random-on-track: a
   `debrisSpawn[]` block in the arena JSON (`static/assets/tracks/derby-*.json`) lists `{ asset, pos,
   rot }`; procedural tracks scatter on the `FB-geoframe` normal offset, **off the racing line** and
   away from car spawn slots (no spawn-camping a car onto a wheel). These count against the budget from
   t=0.
2. **Destruction adds more.** Every `damage:destroyed` adds the dying car's 4 wheels + 2 panels (§1
   D1d), so the field grows as the round progresses — exactly the intended escalating carnage.
3. **Persistence as hazards.** All pieces keep dynamic bodies, keep colliding/shoving, sleep when idle,
   re-wake on contact (§1 mechanism point 3). They live until round end / arena reset, or until evicted.
4. **Eviction under budget.** When the field would exceed the cap, the **oldest, least-active** pieces
   are culled to make room for fresh carnage (policy in §1.4). Round end clears everything back to the
   pool.

### 1.4 Performance & budget (the biggest risk) — accumulating budget + eviction

A *persistent* field changes the perf model from "N simultaneous bodies" to "**bodies accumulated over a
whole round**" — strictly harder, since debris no longer self-expires. The budget must therefore be an
**accumulation cap with an eviction policy**, not a transient spike limit (parent plan principle 6, ties
to `FB-perf`/`FB-instperf`):

- **Global debris budget** (`maxActiveDebrisBodies`, e.g. 96 on host-class) covers **default-spawned +
  destruction-spawned** debris together — one pool, one cap, measured across the round, not per-event.
- **Eviction policy when the cap is hit (the key addition):** cull the **oldest + least-active** pieces
  first — score each piece by `age` and recent motion (sleeping/idle a long time = lowest value), evict
  lowest-value first, with a **short opacity-fade** so culls don't pop. **Wheels are evicted last**
  (`wheels-last` priority) because they're the prime hazard; sleeping panels go first. This keeps the
  field "fresh carnage near the action" while bounding cost. New debris that can't fit even after
  eviction degrades to **D1b cosmetic shards** (no body) — wheels still get a body before panels.
- **Pooling is mandatory** (geometry + body reuse), mirroring `ParticleSystem.geometryPool`
  (`ParticleSystem.js:108-109`). Pre-warm at match start; never allocate per-death; evicted pieces
  return to the pool for reuse. Round end / arena reset drains the whole field back to the pool.
- **Sleep accounting.** Idle slept bodies are cheap but still count against the cap (they're still
  colliders); the eviction score uses sleep-time so a long-slept piece is the first culled when space is
  needed — accumulation is bounded by the cap regardless of how long the round runs.
- **Shared materials per piece type** (paint instances cloned only where player color matters — feeds
  the §14 #11 / `FB-instperf` instancing decision; detached wheels share one black `tyre` material).
- **Degrade tiers** under the `FB-perf` ladder: full (persistent wheels+panels+particles) → lower cap +
  wheels-only persist (panels go cosmetic) → particles only → sphere-puff fallback (headless CI / weak
  hosts still pass). The cap itself is a degradation knob: weaker hosts get a smaller `maxActiveDebris`.

---

## 2. Weapon & pickup models (item 7)

**Problem (grounded).** All 8 weapon pickups render as the *same* tinted box (`WeaponSystem.js:628-648`);
the only per-weapon identity is an **emoji** never shown in 3D (`:137-291`). Projectiles/zones are
similarly thin. Pickups must read instantly from the high/overhead camera at party scale, on-brand neon.

### Options

- **W1a — Better primitives + color (status quo+).** Distinct primitive per weapon (cone, sphere,
  torus…) tinted by `ui.color`. Cheap, but still programmer-art and weak at distance.
- **W1b — AI-2D billboard glyph on a neon pedestal (recommended for the *pickup marker*).** Render each
  pickup as a **constant-screen-size billboard `Sprite`** (the same `sizeAttenuation:false` technique
  the debug viewer proved for nametags, §5.4) showing an **AI-generated transparent weapon glyph**
  (FLUX-LayerDiffuse / `gpt-image-1` transparent, the §11.5 AI-for-2D lane) over a small spinning neon
  ring/pedestal mesh + under-glow. Reads from any angle, scales on a TV, dirt-cheap, perfectly on-brand,
  and the glyph *is* the weapon identity already designed (the emoji set maps 1:1 to a glyph sheet).
- **W1c — Low-poly 3D weapon meshes.** A handful of small CC0/AI-static meshes (missile, mine, oil drum,
  EMP coil…) loaded via the resource pipeline. Higher fidelity, but per-weapon modeling/sourcing work
  and weaker at distance than a billboard. Best for **projectiles/world objects you see up close**, not
  the floating marker.
- **W1d — Reuse staged props for the physical weapons.** `box.glb` already exists → a tumbling **mine**
  is a small dark box with a pulsing emissive; the oil-slick **drop** can reuse a small drum; the
  detached-wheel debris (§1) doubles as a thrown hazard. Zero new sourcing.

### Recommendation

**W1b for the floating *pickup marker* (one system, all 8 weapons, AI-2D glyph) + W1c/W1d for the few
*world objects* that need a mesh** (mine on the ground, oil drum, missile projectile). Concretely:

- **Pickup marker:** replace `_createPickupMesh()`'s box with a small data-driven prefab —
  `neon pedestal mesh + billboard glyph sprite + under-glow disc`, glyph chosen by `weapon.id` from an
  **AI-generated transparent glyph atlas** (`static/assets/weapons/glyphs.png`, baked at prep time, **no
  runtime AI**). Pedestal tinted by `weapon.ui.color` (`:632`). This is a self-contained swap inside
  WeaponSystem.
- **World objects:** mine = `box.glb` clone (dark, pulsing emissive — its idle effect is already defined
  `:181`); oil-slick zone = a flat decal quad (its `zone` is already defined `:225`); missile projectile
  = a tiny low-poly cone/capsule mesh + bloom trail. These load via the **same `ResourceLoader.loadModel`
  / GLTF path `FB-assets` adds for cars** — one loader, cached templates, cloned per spawn.
- **Catalog them** in a small **`weapons/asset-catalog.json`** (glyph id, pedestal color, world-mesh
  path, scale) parallel to `vehicles/catalog.json` — same contract, so the validator gate covers them.

This keeps 3D meshes only where they earn it, leans on the AI-2D lane §11.5 already blessed, and adds no
gameplay-critical-path dependency (the pickup *logic* is unchanged; only its mesh factory swaps).

---

## 3. Track props & decoration (item 7)

**Problem (grounded).** Tracks/arenas have **no props** — just the spline ribbon and barrier builders.
They read as empty. The owner wants the world to feel built; the brief wants on-brand neon.

### Options

- **P1a — Cones & barriers from staged props (recommended baseline).** `cone.glb` / `cone-flat.glb` /
  `box.glb` are staged. Place **cones** as chicane/apex markers and **boxes** as smashable clutter
  (light dynamic bodies — they can reuse the §1 debris pool path: hit a box, it tumbles). Cones can be
  **knock-overable** (cheap dynamic body) for arcade juice. Barriers/tyre-stacks/gantries come from the
  Kenney **Racing Kit** (same CC0 family) when we want more.
- **P1b — Data-driven prop placement per track/arena.** Add an optional `props[]` block to the
  track/arena JSON (`static/assets/tracks/derby-*.json` and the procedural generator) — `{ asset, pos,
  rot, scale, dynamic? }`. Procedural tracks place cones along the computed centerline frame (reuse the
  §8.0 `{tangent,normal,up}` frame from `FB-geoframe` — props ride the normal offset, no new orientation
  math). Arenas hand-place via JSON.
- **P1c — Neon scenery / skybox dressing (AI-2D).** Background billboards, neon signage, crowd stands,
  skybox — the **AI-2D lane** (the spike calls these "loose-constraint static props, drop in"). Pure
  decoration, no collision, behind a flag.

### Recommendation

**P1a + P1b now (cones/boxes from staged props, placed via track/arena JSON, reusing the geometry frame
and the debris pool for knock-overs), P1c later as AI-2D dressing.** Props load via the same
`ResourceLoader.loadModel` GLTF path + catalog/validator gate as everything else. Knock-over physics is
*free*: it's the §1 dynamic-body + pool machinery applied to a prop instead of a detached wheel.

---

## 4. Pipeline reuse (the whole point)

This gap adds **no new pipeline** — it rides the car pipeline's rails (§11.5, asset spike second pass):

| Car-pipeline asset | This gap reuses it for |
|---|---|
| **`FB-assetcatalog`** catalog/manifest contract, catalog-IDs-only | a `weapons/asset-catalog.json` + a debris/prop manifest; no arbitrary asset paths |
| **`FB-assetnorm`** offline normalization (scale/origin/material tags) | normalize debris pieces, props, weapon world-meshes to game units + `paint`/`tyre`/`metal` tags + a per-silhouette **debris manifest** (wheels + panels + detach mounts) |
| **`FB-assets`** `ResourceLoader.loadModel` GLTF path + cached templates + clone-per-spawn | load debris/prop/weapon GLBs through the **same** loader + pool clones |
| **AI-for-2D-only** | weapon glyph atlas, neon signage/skybox — never 3D meshes for these |
| **Validation gate** (`scripts/validate-vehicle-assets.mjs` + `vehicle-model-validation` skill) | extend to debris/prop/weapon catalogs: poly ≤ budget, parses glTF 2.0, scale/origin sane, no embedded lights |
| **Flag-gated / parallel / off critical path** | all three systems ship behind a flag; primitive box pickup + sphere-puff death remain the fallback so CI stays fast/offline |

---

## 5. Beads (new FB-* — dependency-ordered, with test layer)

> Same table shape as `feedback-design-pass.md` §13. These slot **after** the car-pipeline beads
> (`FB-assetcatalog`, `FB-assetnorm`, `FB-assets`) because they reuse the catalog contract, the
> normalization gate, and the GLTF loader. Each closes with the `vehicle-model-validation` skill PASS
> (the skill explicitly covers asset-normalization work) + the §6 tests.

| Bead | Theme | Title | Depends on | Test layer |
|---|---|---|---|---|
| **FB-debrisnorm** | H | **Extend `FB-assetnorm` to non-car assets:** normalize staged Kenney debris (`debris-*`, `wheel-*`), props (`cone`, `cone-flat`, `box`), and weapon world-meshes to game-unit scale, centered pivots, `paint`/`tyre`/`metal` material tags; emit a **per-silhouette debris manifest** (4 wheel nodes + 2–4 panel pieces + detach-mount offsets) and a **debris/prop catalog** | FB-assetcatalog, FB-assetnorm | asset gate + skill PASS |
| **FB-debris** | H/G | **`DebrisSystem`:** on `damage:destroyed`, detach **4 wheels (rolling dynamic-body hazards) + 2 panels** with outward+up impulse & spin; **persist on the field as live hazards** (collide/shove cars, sleep-when-idle, re-wake on contact) **for the round** — no per-piece TTL despawn; **pooled** geometry+bodies; replaces the `Vehicle.js:218-238` sphere loop with an event; pairs with `ParticleSystem` burst; generalizes `FB-lightdamage` to **progressive per-part detach** | FB-debrisnorm, FB-assets, FB-lightdamage | unit (4 wheels detach + impulse sign), persistent-collide-and-shove, debris-perf, visual |
| **FB-debrisdefault** | H/D | **Default arena debris (carnage from t=0):** `debrisSpawn[]` block in arena JSON + procedural scatter on the `FB-geoframe` normal offset, **off racing line / clear of car spawns**; `clamp(6, round(players*0.75), 12)` pieces; counts against the budget from start | FB-debris, FB-geoframe | default-spawn-present, E2E (clear of spawns) |
| **FB-debrisperf** | — | **Accumulating debris budget + eviction:** `maxActiveDebrisBodies` covers default+destruction debris **across the round**; **eviction = oldest+least-active first, wheels-last**, fade-on-cull, evicted→pool; sleep-aware scoring; cap is a degradation knob (full→wheels-only→particles→sphere-puff); wire into `FB-perf`/`FB-instperf` | FB-debris, FB-debrisdefault, FB-perf | budget-eviction, 12.6 perf, soak |
| **FB-weaponart** | H | **Weapon/pickup models:** swap the box marker (`WeaponSystem.js:628`) for `neon pedestal + AI-2D billboard glyph + under-glow`; AI-baked transparent **glyph atlas** (no runtime AI); world-meshes (mine=`box.glb`, oil drum, missile projectile) via `ResourceLoader.loadModel`; `weapons/asset-catalog.json` | FB-assets, FB-debrisnorm | asset-load smoke, visual, E2E (pickup still collectible) |
| **FB-trackprops** | H/D | **Track props/decoration:** cones/boxes from staged props placed via optional `props[]` in track/arena JSON, procedural placement on the `FB-geoframe` normal offset; knock-over via the `FB-debris` dynamic-body pool; AI-2D neon scenery/skybox behind a flag | FB-debris, FB-geoframe, FB-assets | asset-load smoke, visual, E2E (prop collides/knocks over) |

---

## 6. Tests (the §12 layers that gate done-ness)

Reuse the existing harness layers (§12.1 asset-load smoke, §12.4 visual, §12.6 perf/soak); add:

- **Asset-load smoke** (extends the car asset gate): every debris/prop/weapon GLB **loads via the
  resource pipeline**, parses glTF 2.0, sits within poly/material/texture **budget**, normalizes to the
  declared scale/origin (bottom-Y≈0), has **no embedded lights/cameras**. Blocks wrong-scale/too-heavy
  assets, exactly like the car validator.
- **Debris correctness (unit, headless via `FB-runtime`/`SimVehicleAdapter`):** fire `damage:destroyed`
  on a vehicle → assert **exactly 4 wheel pieces detach** at the four wheel-node world positions, each
  gets a dynamic body with a **net-outward + upward impulse** (sign/centroid check, not vibes), and
  spins.
- **Persistent-debris-collides-and-shoves (unit/sim):** after a destruction, step the world to let
  pieces settle, then drive a car into a settled wheel → assert the car's velocity is **deflected/shoved**
  (and the wheel re-wakes and moves), proving persistent pieces remain live hazards — *not* despawned.
  Assert pieces **survive past any old TTL window** (still present after ≫ `debrisTtl` seconds) and only
  leave on round reset.
- **Default-spawn-present (E2E/sim):** at arena start, **before any car is destroyed**, assert
  `clamp(6, …, 12)` debris pieces exist on the field, each a live collidable body, **clear of every car
  spawn slot and off the racing line** (no car spawns onto a piece).
- **Budget-eviction (unit/sim):** drive debris count past `maxActiveDebrisBodies` (mass destructions +
  default spawn) → assert the cap **holds across the round** (count never exceeds it), the **oldest +
  least-active** pieces are evicted first with **wheels evicted last**, evicted bodies **return to the
  pool** (reused, not leaked), and overflow spawns degrade to cosmetic shards.
- **Debris perf at N cars (§12.6 gate):** trigger **24 and 60 simultaneous destructions** on the host-
  class target *and* let debris accumulate over a full simulated round; assert active dynamic-body count
  stays ≤ `maxActiveDebrisBodies` (eviction + degradation kick in), steady-state FPS / frame-time p95
  within budget, and **no measurable regression in the 4-car E2E flow**. Soak: the 32-controller chaos
  test with a derby wipe and a long round (accumulation bound holds).
- **Visual snapshot (§12.4):** Playwright screenshot of a death — assert **4 wheels visibly off the
  body** and debris dispersed (the owner's acceptance: *"all 4 wheels come off"*); pickup markers show
  the correct per-weapon glyph at overhead camera distance and read at 4K; cones/boxes render and a
  rammed cone is displaced.
- **Skill gate:** `.claude/skills/vehicle-model-validation/SKILL.md` PASS report (screenshots, rig/state
  preview for the detached-wheel rig, collider overlay, check output) attached to `FB-debrisnorm`,
  `FB-debris`, `FB-weaponart`, `FB-trackprops` before close — same evidence bar as car models.

---

## 7. Open questions (for §14-style human call)

1. **Wheel litter in derby.** **Resolved (owner):** debris **persists** as a growing hazard field for
   the round, bounded by the §1.4 accumulating cap + eviction. Remaining tuning: exact
   `maxActiveDebrisBodies` and default-spawn count per arena (settle in the `FB-debrisperf` measurement).
2. **Weapon world-mesh fidelity.** Ship pickups as **billboard glyphs only** (cheapest, recommended), or
   also model up-close projectiles now (missile/mine meshes)? Default: glyph markers now, projectile
   meshes as a fast-follow.
3. **AI-2D glyph vs. icon font.** The 8 emoji already read fine; an AI glyph atlas is on-brand but adds a
   prep step. Could ship emoji-on-sprite v1, AI atlas v2.
4. **Prop density / collision cost.** How many knock-over props before they compete with debris for the
   dynamic-body budget? Resolve in the `FB-debrisperf` measurement, share the budget.
