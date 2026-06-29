# Derby Bowl Transition + Every-Mode Valid-Map Guarantee

> **Status:** v1 design chunk (clean redo, updated with owner decisions 2026-06-29). Two gaps the main feedback pass
> (`docs/plans/feedback-design-pass.md`) named but left undercooked: (1) the **flat-floor → curved-wall
> crease** in the derby bowl (§8.2 only covered the shrink desync, not the join geometry), and (2) the
> **"several modes were COMPLETELY BROKEN — didn't spawn a proper map"** report, which has no guard in
> code today.
>
> **Method (house style):** *Problem (grounded in `file:line`)* → *Options (trade-offs)* →
> *Recommendation* → *Beads* → *Tests*. Builds on §8.0 (one geometry frame + automated debug-render
> gate), §12.3 (invariant/validator layer), §12.4 (in-band `?testMode=1` / `window.game` contract). New
> beads **FB-bowltransition** and **FB-mapvalid-allmodes** sit alongside **FB-geoframe / FB-derbywall /
> FB-checkpt / FB-validator / FB-mapqual**. Owner decision: invalid arenas should be impossible for
> valid shipped specs/seeds; runtime validation is a fail-loud tripwire, not a normal fallback path.

---

## 0. What the code actually does today (verified)

The derby **bowl** ("The Pit" `derby-bowl.json`, "The Coliseum" `derby-coliseum.json`) is assembled
from **four independent pieces that never agree at the rim**:

| Piece | Built by | Shape at the rim (`r=radius`, world Y) |
|---|---|---|
| Visual floor | `TrackFactory._createBowlArena` (`TrackFactory.js:268-305`) | concave-ish `CircleGeometry`; `setZ(-height)`, `height = (r/R)²·concavity·R` (`:285`), then `rotation.x=-π/2` |
| Visual wall | `TrackFactory._createBowlWall` (`TrackFactory.js:664-712`) | open `CylinderGeometry(topR, radius, height)` standing from `y=0` to `y=height` (`:683-696`) |
| Physics floor | `PhysicsSystem.createGroundBody` (`PhysicsSystem.js:171-189`), used for every non-dunes track (`GameHost.js:612-616`) | **flat** cuboid, top at `y≈0.1`, spanning ±100 |
| Physics wall | `PhysicsSystem._createBowlWallBarrier` (`PhysicsSystem.js:516-555`) | 64 thin boxes leaning outward by `slopeDeg`, bottom edge at `y≈0`, starting at `radius` |

Two consequences fall straight out of the math:

1. **The visual floor doesn't match its own physics floor.** After `rotation.x=-π/2`, a vertex's
   `worldY = localZ = -height`, and `height ≥ 0` grows with radius, so the rim sits at
   `worldY = -concavity·R` (`derby-bowl`: `-0.1·40 = -4`; `derby-coliseum`: `-0.08·50 = -4`) while the
   **centre is at `worldY = 0`**. (So the mesh is actually a shallow *dome / raised-centre* shape, not
   the "lower at center, higher at edges" bowl the comment at `:284` claims — the concavity sign is
   inverted; flag, don't trust the comment.) Meanwhile the physics floor cars actually drive on is a
   **flat box at `y≈0`** — players see a dished/funnelled disc and drive on a flat one.
2. **The wall base and the floor rim are at different heights, so there is a vertical lip even
   visually.** The wall cylinder starts at `y=0`; the floor rim sits `concavity·R` (≈4 units) *below*
   it. Where they meet you get a vertical step, and in physics you get a **~60°-from-horizontal dihedral
   edge** (flat floor at 0° abutting a wall leaning 30° from vertical) with **no blend**. A car driving
   outward at speed hits that inside corner; its wheel raycasts must climb a 60° ramp *instantly*, so
   the car bucks/catches/bounces instead of rolling up the bank. This is the "rough crease that catches
   cars" and a direct contributor to §7.1 "boundary too aggressive."

**The dunes arena does *not* have this problem** — and shows the fix. `terrain.js` builds **one** vertex
grid consumed by *both* the visual mesh (`TrackFactory._createDunesArena`, `:312-334`) and the physics
trimesh (`PhysicsSystem.createTerrainBody`, `:198-222`), and its rim is a *smooth quadratic ramp*
(`dunesHeight`, `terrain.js:39-42`). Same grid, smooth by construction. The bowl should adopt the
identical discipline.

**The square arena** (`derby-arena.json`, `_createSquareArena` `:242-262` + `_createSquareBarrier`
`PhysicsSystem.js:457-500`) has a flat floor + **vertical** walls — a 90° crease, cars stop dead. Its
`floorConcavity: 0.05` is silently ignored (the square floor is a flat `PlaneGeometry`). Out of scope
for the fillet below (no slope to blend to) but noted as related boundary-feel work (§7.1 / FB-derbywall).

---

## 1. Smooth flat→bowl transition (FB-bowltransition)

### Problem (grounded)

The join from flat floor to sloped wall is **C0-discontinuous in both the visual mesh and the collider**,
with a vertical step on top of it. Sources: `TrackFactory.js:268-305` + `:664-712` (visual, two disjoint
meshes), `PhysicsSystem.js:171-189` + `:516-555` (physics, flat box + leaning box segments). Nothing
blends floor-slope (0°) into wall-slope (60° from horizontal); nothing makes the two surfaces share a
height at `radius`. The car's raycast suspension sees a step, then an instant ramp. This is the §8.0 bug
class on a surface of revolution: the profile is re-derived three times in three height/sign conventions,
and **nothing renders the combined cross-section to confirm it's continuous.**

### The fix: one radial profile, revolved, feeding both mesh and collider

Adopt the §8.0 geometry-frame discipline for a surface of revolution. Define **one** parametric radial
profile `bowlProfile(r) → y` (the single source of truth — the bowl's analogue of `dunesHeight`), built
from three tangent-continuous pieces:

```
  r ∈ [0, rFlat]          floor      slope 0            (optionally a gentle dish)
  r ∈ [rFlat, rFillet]    fillet arc slope 0 → θwall    circular arc radius Rf, C1 at both joins
  r ∈ [rFillet, rTop]     wall       slope θwall        straight bank up to wallHeight
```

A **circular fillet** of radius `Rf` tangent to the horizontal floor and tangent to the wall line is C1
(tangent-continuous) by construction: the arc centre sits at `(rFlat, Rf)`, sweeping from angle 0 to
`θwall`; `rFillet = rFlat + Rf·sinθwall`, and the wall picks up exactly where the arc slope reaches
`θwall`. `Rf` is the single knob for "how gently it rolls up" (tunable; expose in the F2/debug panel per
principle 8). Crucially the **floor rim and the wall base now share a height** — the lip is gone because
they are one curve.

Then **revolve** that profile around Y at `N` angular × `K` radial stations → one vertex grid. Both
consumers read that grid (the dunes pattern, exactly):

- **Visual:** replace the separate `CircleGeometry` floor + `CylinderGeometry` wall with a single
  revolved `BufferGeometry` (or `LatheGeometry`); `_createBowlArena` returns one mesh, drop `_createBowlWall`
  for the bowl.
- **Collider:** replace the flat ground box + `_createBowlWallBarrier` segments with **one Rapier
  `trimesh`** from the same grid (mirror `createTerrainBody`). Bowl floor stops using `createGroundBody`.

Put the profile + grid builder in a shared module (`resources/bowl.js`, mirroring `terrain.js`), so
"what you see" and "what you collide with" are provably the same vertices — no convention to get wrong,
satisfying §8.0 Part A. `floorConcavity` stays a JSON knob but is **reinterpreted** as the dish depth of
the floor *segment only* (no runaway `r²` term, sign fixed); add `filletRadius` (default e.g. `~0.15·R`)
to the bowl geometry block so the blend is data-driven and A/B-tunable.

### Options

- **D-bt-a — Shared revolved profile (recommended).** One `bowlProfile`/`buildBowlSurface(geometry)` →
  `{vertices, indices}`, consumed by mesh + trimesh. Smooth by construction; kills the desync *and* the
  crease in one move; reuses the proven dunes precedent. Defaults keep `derby-bowl`/`derby-coliseum`
  working.
- **D-bt-b — Keep two meshes, add a fillet ring.** Insert a quarter-torus cove mesh + a ring of angled
  box colliders between floor and wall. Less churn, but *reintroduces* the three-pieces-must-agree
  problem the fillet exists to end — the §8.0 anti-pattern; rejected.
- **D-bt-c — Heightfield collider.** Rapier `heightfield` instead of `trimesh`. Cheaper memory, but a
  grid is a poor fit for a radial dish edge and adds a third geometry path; trimesh already works for
  dunes. Defer.

**Recommendation:** D-bt-a — revolve one profile into both mesh and trimesh, ship the tangent-continuity
invariant + a cross-section debug-render alongside so a future edit can't silently reintroduce the
crease. Sequence after `FB-geoframe`; co-schedule with `FB-derbywall` since both touch the bowl collider.

### Interaction with derby shrink (don't regress FB-derbywall)

The shrink today only scales the wall **mesh** (`DerbySystem.js:377-391`) and shoves cars with an
undamped impulse (`:397-425`) — the FB-derbywall desync. A revolved **trimesh can't be cheaply scaled**,
so do **not** try to shrink the fillet surface. Decouple: the static fillet surface is the *physical*
arena; the shrinking "kill boundary" is a **separate contracting ring** (a thin cylinder collider, or
the dt-scaled inward push promoted to a real elimination boundary per §7.4 derby branch), driven from one
`arenaRadius(t)`. FB-bowltransition owns the static join; FB-derbywall owns the moving boundary. Bead
acceptance includes "shrink boundary still contracts and eliminates correctly over the new surface."

### Beads

| Bead | Title | Depends on | Relates |
|---|---|---|---|
| **FB-bowltransition** | Tangent-continuous floor→wall fillet for bowl arenas: one `bowlProfile`/`buildBowlSurface` revolved grid feeding **both** the visual mesh and the Rapier trimesh collider; `filletRadius`/`floorConcavity` (sign-fixed) as data + F2/debug knob; remove the flat-ground-box + `_createBowlWallBarrier` path for bowls; ship tangent-continuity invariant + cross-section debug-render | FB-geoframe | FB-derbywall (shrink decoupling), §7.1 boundary feel, FB-mapqual |

### Tests (§12.3 geometry invariants + sim + debug-render)

1. **Profile C1 continuity (unit, fails→passes):** sample `bowlProfile`; `dy/dr` continuous across both
   joins (`|slope_left − slope_right| < ε` at `rFlat` and `rFillet`); `dy/dr→0` on the floor side and
   `=tan(θwall)` on the wall side; single-valued (rim height == wall-base height, no step). The crease
   today produces a tangent jump and a ~4u step → **fails**; the fillet passes.
2. **Collider==visual (integration):** the trimesh `{vertices,indices}` are the exact arrays the mesh
   consumes (same-grid invariant, like `tests/integration/track-physics.test.ts`); `|y_mesh − y_collider| ≤ ε`
   along several radii (≈4u desync today → fails; shared profile → passes).
3. **Roll-up sim (§12.2, after FB-runtime):** a car coasting radially outward at `v0` onto the bank rises
   monotonically to wall height with **no vertical-velocity spike** at the join (`max|Δvy| < threshold`
   across the contact window) and **no stopped-against-wall** event, then rides the bank and returns
   (containment holds) — the empirical "rolls up cleanly" gate.
4. **Debug-render (§8.0 Part B):** add the bowl radial profile + fillet cross-section + top-down to the
   golden-seed gallery so a regressed crease is *visible* in CI, not just numeric.

---

## 2. Every gameplay mode × track spawns a valid, drivable host-rendered map (FB-mapvalid-allmodes)

### Problem (grounded) — and the biggest currently-broken risk

There is **no guarantee, and no guard,** that a chosen gameplay-mode × track/arena pair actually produced
a complete **host-rendered** map. This section is about the host world (Local big screen and Remote
authoritative host/viewer source); Local phones remain controllers and do not render the world. Two
failure mechanisms are live in the code:

1. **The track-creation error handler is a silent swallow** (`GameHost.js:635-637`):
   ```js
   } catch (error) {
       console.error('GameHost: Error creating track:', error);   // ← swallowed; no rethrow, no fallback
   }
   ```
   `_createTrack` first nulls `this.track` during cleanup (`:594`). If `trackFactory.create()` then
   throws — a bad/unknown `trackId` hitting `resourceLoader.loadTrack` (404), a generator error — `this.track`
   stays **null**, and the *very next thing the start flow does* is dereference it:
   `this.track.getSpawnPosition(index)` (`GameHost.js:876`). It crashes the start; there is no fallback to
   a known-good arena.

2. **"Success" is unvalidated, so a half-built map runs silently.** `TrackFactory.create` (`:37-94`)
   never checks that `_createTrackSurface` returned a mesh. For an unknown `geometry.type` it
   `console.warn`s and returns `null` (`:143-145`); `_createSplineTrack` returns `null` on missing/mismatched
   edge data (`:377-380`); `createGroundBody`/`createBarrierBodies` return `null`/`[]` when RAPIER isn't
   ready (`PhysicsSystem.js:172, 263`). In all these cases the track object still builds, the **flat ground
   box still gets created** (`GameHost.js:613`), and cars spawn onto a wall-less, surface-less,
   checkpoint-less void — **nothing throws.** This is precisely *"the mode didn't spawn a proper map."*

**Biggest broken risk I can actually point at:** the pairing of the **silent `catch` (GameHost:635-637)**
with the **absence of any post-build validity check** before spawning. Together they guarantee that a
track which throws *or* quietly half-builds will either crash on `this.track` (`:876`) or drop players
into an empty world — with the only signal a console line nobody reads. Every mode is one bad config / bad
seed / unhandled `geometry.type` away from this.

Secondary hole: `_resolveTrackId` (`GameHost.js:959-974`) picks a random derby arena via `Math.random()`
(`:964`) and both branches end `return requested;`, so a typo'd / unreleased id passes through unchecked,
and "every arena" can't be asserted deterministically (a seed-specific procedural break hides). Ties to
FB-seed. Also watch for **hidden substitution**: cross-mode coercions such as "derby requested oval" must
be explicit policy, not fallback-by-another-name. For concrete non-`random` selections, tests should assert
the requested id either exactly equals the built id or the start is blocked with a reason. `random` records
both the requested selector and the resolved concrete arena.

### Design — (a) prove valid construction, (b) fail-loud runtime tripwire, (c) automated mode×track matrix

**(a) Validity must be proven before runtime.** A shipped track spec, generated seed, or selectable arena
is not acceptable unless unit/integration tests prove it constructs a valid world. This is the root fix,
not the runtime guard. The generator/spec layer must make invalid arenas impossible for known-good inputs:
required schema fields, deterministic seed, no null surface path, no empty collider path, closed derby
walls, valid checkpoint graph, and N non-overlapping spawns with ground below them. Spawn validity is more
than "has a position": prove spawn count for N, no modulo reuse, pairwise separation by car footprint, wall
/ void clearance, no initial collider penetration, sane heading, and a downward raycast to the intended
surface. A generated map that fails the validator is a generator bug and fails tests; it is not something
the game should quietly swap away from during normal play.

**(b) `validateArena(track, mode, playerCount)` — runs after build + collider creation, immediately
after `setPhysicsBodies` (`GameHost.js:620`), before any car spawns or state transition.** A pure-ish
check over `track` + `PhysicsSystem.staticBodies`. Returns `{ok, reasons[]}`:

- **Geometry built:** `track.mesh` contains an `isTrackSurface` child with vertices (catches the
  null-surface case at `TrackFactory.js:143/377`).
- **Colliders present:** a ground/terrain body exists; barriers exist for the type — derby ⇒ a closed
  wall body (`barrier_bowl_wall` / `barrier_square_wall`); race ⇒ both edges (oval inner+outer, or
  `spline_left`+`spline_right`).
- **Closed walls (derby):** the barrier loop encloses the centre — angular coverage of wall segments
  spans `2π` with no gap a car can squirt through (cheap radial-bin / max-chord check).
- **Checkpoints (race):** `≥3`, ordered, each on the drivable surface (uses §8.3/FB-checkpt oriented,
  Y-aware checkpoint data once it lands).
- **Spawns valid & on-ground:** `≥ playerCount` spawn slots (or procedurally generated for N, §6.3); no
  modulo reuse; pairwise spacing ≥ car footprint; each spawn inside arena bounds, clear of walls/voids,
  not initially penetrating a collider, with sane heading, and a **downward raycast from the spawn hits a
  collider within a few units** (proves the car lands on ground, not into a void, not floating over a
  desynced dish, not outside the wall). This check catches the §1 bowl flat-floor/void mismatch and ties
  directly to `br-fb-spawncap-qi9`.

**Runtime fail-loud tripwire (never spawn into a broken world).** Replace the silent `catch`:

```
build(trackId) → validateArena()
  ok    → proceed to spawn
  fail  → emit map:invalid {trackId, reasons}; show an on-screen error;
          dump the geometry/debug evidence; HARD STOP this start attempt,
          do NOT enter the spawn loop (no this.track.getSpawnPosition on null/empty).
```

The worst outcome becomes a clear error and a preserved lobby/blocked start, never an empty/half-built
world. This is intentionally **not** a fallback-to-another-map feature: if a selectable map is invalid in
the wild, we want telemetry/logging that makes the defect obvious, not a masked replacement that lets the
root bug linger. The only acceptable "fallback" is operational: do not load the bad map, do not start the
round, and surface actionable error state to the host and logs.

**Telemetry/debug contract.** The fail-loud path emits one structured payload, used by tests and later
observability: `{mode, requestedTrackId, resolvedTrackId, seed, playerCount, reasons[], exceptionHash,
stack, validatorVersion, debugArtifactPaths[], stayedInLobby}`. Tests assert the payload exists and that
`stayedInLobby === true`; visible error text alone is not enough.

**(c) Automated matrix (the missing coverage), split by CI tier.** Keep the owner-approved fast-test
philosophy:

- **Unit/integration normal CI (`npm test`):** the exhaustive gameplay-mode × track matrix, seeded random
  forced through each concrete arena, plus invalid-id/config/loader-404 cases. These tests use schema,
  generator, validator, and headless RAPIER/raycast checks so they are deterministic and fast.
- **One small Playwright E2E normal CI gate:** a representative browser smoke through `?testMode=1` /
  `window.__jjTestResult` that proves the real host start path calls the validator, blocks invalid input,
  keeps the host in lobby, and starts at least one representative race and derby arena with cars on ground.
- **Full browser matrix opt-in/nightly:** every valid gameplay-mode × track cell in Chromium, artifacts on
  failure, not required on every PR unless it proves fast and stable.

The exhaustive input set is:

```
modes  = ['race', 'derby']
tracks = ['procedural', 'oval',
          'derby-bowl', 'derby-arena', 'derby-coliseum', 'derby-dunes',
          'random']        // 'random' forced through each concrete arena, seeded — not Math.random
                           // + the cross-mode coercions and an invalid-id case (proves fail-loud blocks start)
```

For each cell, with N test players joined or simulated, assert via the validator contract (and, for browser
gates, the existing `?testMode=1` + `window.game` / `window.__jjTestResult`, §12.4):

- `validateArena()` returned `ok` for every valid shipping mode×track cell; a crash/empty world fails;
- `window.game.track` exists with a track-surface mesh + the expected collider bodies;
- `window.game.vehicles.size === N`, every car **resting on ground** where browser-tested; most ground
  checks are headless raycasts, not timing-based waits;
- no unexpected console errors, using an explicit allowlist rather than blanket "any warning fails";
- on any failure, save §8.0 **top-down/section debug-render** PNGs as artifacts. Do not make PNG pixel
  comparison a normal CI dependency unless the renderer is deterministic.

This is the direct answer to "several modes were COMPLETELY BROKEN": every valid mode×map is exercised
and must produce a complete, drivable, error-free world or fail the build. Deliberately invalid input is
tested separately and must produce the fail-loud blocked-start path.

### Options

- **M-a — Valid-by-construction + runtime fail-loud tripwire + matrix (recommended).** The full guarantee
  above; reuse the §12.3 track validator (`FB-validator`) as `validateArena`'s geometry half rather than
  a parallel impl. Invalid generated arenas are test failures, not runtime alternatives.
- **M-b — Fallback-to-known-good arena.** Rejected by owner decision: it masks generator/spec defects and
  makes it possible to ship broken arenas unnoticed. The runtime may block start and report telemetry; it
  must not silently replace one map with another as a success path.
- **M-c — Validator only, warn and continue.** Rejected; this still lets a broken map reach players with
  just a log. The point is "never spawn into a broken world."
- **M-d — Author-time JSON schema check.** Validate the track JSONs (spawn count, required blocks,
  geometry params) at build/CI. Good cheap hygiene but can't catch *runtime* build failures (RAPIER not
  ready, collider gap, desynced spawn height) — a complement to M-a, not a replacement.

**Recommendation:** M-a + author-time schema checks. The generator/spec validators are the root proof;
runtime `validateArena` is the safety tripwire; the matrix is the proof it holds for every shipping
mode×map; the JSON schema check is cheap author-time insurance.

### Beads

| Bead | Title | Depends on | Relates |
|---|---|---|---|
| **FB-mapvalid-allmodes** | Per-arena construction and spawn-validity guarantee: schema/generator/unit validators prove valid shipped specs/seeds cannot produce invalid maps; runtime `validateArena` (geometry+colliders+closed-walls/checkpoints+spawn-count/no-overlap/on-ground/no-penetration) replaces the silent `GameHost.js:635-637` catch with a **fail-loud blocked start**, visible error, structured telemetry/logging, and debug-render artifacts; exhaustive mode×track matrix lives in unit/integration CI, with one small Playwright CI gate for the real host start path; invalid ids/configs must error and not enter spawn, not fallback to another map | FB-validator, FB-seed, br-fb-spawncap-qi9 | FB-geoframe (debug-render), FB-derbywall, FB-bowltransition, FB-checkpt |

### Tests

- **Unit/integration (normal CI):** exhaustive valid gameplay-mode × track matrix; `validateArena` returns
  `ok` for each shipping arena and **fails with specific `reasons`** for crafted-broken inputs (null
  surface, empty barriers, wall gap, spawn over a void, `<3` checkpoints in race, invalid id, loader/JSON
  404, bad seed). Spawn-on-ground raycasts, no-overlap, no-penetration, and heading sanity use the
  injected-RAPIER pattern from `track-physics.test.ts`.
- **Playwright (normal CI, one small gate):** representative race + derby valid starts and one invalid
  start through the real host path. Asserts `window.__jjTestResult`, structured telemetry payload,
  preserved lobby/blocked-start state, and no spawn loop on failure.
- **Full browser matrix (opt-in/nightly):** every valid gameplay-mode × track cell yields a valid map +
  cars on ground + no unexpected console errors. Save debug PNGs as artifacts on failure.
- **`_resolveTrackId` unit:** every documented concrete input either builds the same concrete id or fails
  loud if incompatible; unknown ids are rejected/fail-loud before load, never pass through unvalidated and
  never silently substitute another map. `random` records requested selector + resolved concrete arena.
- **Regression:** `derby-bowl` post-FB-bowltransition still validates (no flat-box ground, trimesh
  present, spawns on the filleted surface); `random` forced through all four arenas each validates.

---

## 3. Summary of new beads

| Bead | Owns | Key deps |
|---|---|---|
| **FB-bowltransition** | Tangent-continuous floor→wall fillet, one revolved profile → mesh + trimesh; remove flat-box+segment-wall path; fix inverted concavity sign | FB-geoframe; coexist with FB-derbywall |
| **FB-mapvalid-allmodes** | Valid-by-construction map generation/specs + runtime `validateArena` blocked-start tripwire (replaces silent catch) + mode×track CI matrix; reject unknown `_resolveTrackId` inputs | FB-validator, FB-seed; FB-geoframe debug-render |

---

## 4. File:line anchors

| Concern | Location |
|---|---|
| Bowl visual floor (dome via inverted concavity, no wall blend) | `TrackFactory.js:268-305` (`:285`) |
| Bowl visual wall (separate cylinder, base at `y=0`) | `TrackFactory.js:664-712` (`:683-696`) |
| Bowl **physics floor = flat box at y≈0** (desync; used for `type:'bowl'`) | `GameHost.js:612-616`, `PhysicsSystem.js:171-189` |
| Bowl physics wall ring (flat→~60° crease, no fillet) | `PhysicsSystem.js:516-555` |
| `floorConcavity` rim offset (`derby-bowl 0.1`→~4u, `coliseum 0.08`→~4u) | `derby-bowl.json`, `derby-coliseum.json` |
| Shared-grid precedent to copy (visual+physics from one source) | `terrain.js:28-85`, `PhysicsSystem.js:198-222` |
| **Silent track-build catch (biggest broken risk)** | `GameHost.js:635-637` |
| Null-`this.track` deref right after a swallowed failure | `GameHost.js:876` |
| Builders fail by returning null/[] silently | `TrackFactory.js:143-145, 377-380`; `PhysicsSystem.js:172, 263` |
| `_resolveTrackId` passes unknown ids through / `Math.random` arena pick | `GameHost.js:959-974` (`:964`) |
| Derby shrink desync (mesh scaled, collider not) | `DerbySystem.js:377-391` |

---

## 5. Tight summary

- **Bowl-transition fix.** The bowl is four disjoint pieces that don't meet at the rim: a concave-coded
  `CircleGeometry` floor (`TrackFactory.js:268-305`) and a `CylinderGeometry` wall (`:664-712`) on the
  visual side, and a **flat ground box** (`PhysicsSystem.js:171-189`, via `GameHost.js:612-616`) plus
  outward-leaning box segments (`PhysicsSystem.js:516-555`) on the physics side. After the `-π/2`
  rotation `worldY = -height`, so the floor rim sits `concavity·R` (≈4u) *below* the wall base (and the
  centre is *above* the rim — the concavity sign is inverted vs. the comment). That leaves a vertical lip
  *and* an unblended ~60° dihedral the wheel raycasts must climb instantly — the crease that catches
  cars. Fix: one parametric **radial profile with a circular fillet** (C1-tangent: floor→arc→wall,
  `filletRadius` the single knob) **revolved** into one vertex grid that feeds **both** the visual
  `BufferGeometry` and the Rapier **trimesh** — exactly the same-grid discipline `terrain.js`/dunes
  already proves. Keep the shrinking boundary as a separate contracting ring so it doesn't regress
  FB-derbywall.

- **Every-mode-valid-map guarantee.** Prove valid map construction at the generator/spec layer first:
  schema checks, deterministic seed tests, invariant tests, and `validateArena(track, mode, N)` after build
  and before any car spawns. The validator checks geometry-built, colliders-present, closed walls (derby)
  / ordered checkpoints (race), and spawns that are in-bounds and land on ground (downward raycast). On
  failure, **fail loud and block start**: visible error + telemetry/logging + debug-render dump, with no
  fallback-to-another-map success path and no spawn loop on a null/empty world. Prove it with a CI
  **mode×track matrix** over every valid `_resolveTrackId` option (`procedural, oval,
  derby-bowl/arena/coliseum/dunes, random` — random *seeded/forced*), plus invalid-id/config tests that
  assert the blocked-start path.

- **Biggest currently-broken risk I can actually spot.** The **silent `catch` at `GameHost.js:635-637`**
  combined with **no post-build validity check**. `_createTrack` nulls `this.track` (`:594`), and if
  creation throws (bad track id → `resourceLoader.loadTrack` 404, generator error) the error is swallowed
  and the next line dereferences the now-null `this.track` (`getSpawnPosition`, `:876`). Worse, on quiet
  half-builds — `_createTrackSurface` returning `null` for an unknown `geometry.type` (`TrackFactory.js:143`),
  `_createSplineTrack` returning `null` on bad edges (`:377-380`), or empty barriers — *nothing throws*:
  the flat ground box is still created and players spawn into a wall-less, surface-less void. That is
  exactly "the mode didn't spawn a proper map," and it ships today with no guard. FB-mapvalid-allmodes
  closes it.
