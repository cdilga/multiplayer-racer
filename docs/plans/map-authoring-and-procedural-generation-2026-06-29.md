# Map Authoring And Procedural Generation Revamp - Planning Draft

> Status: planning-workflow draft v0, created 2026-06-29 after the user-flow database pass.
> Scope: selectable known maps, seeded random maps, hand-authored plus procedural map construction,
> terrain modification vocabulary, derby/race compatibility, late-join map requirements, jump
> placement rules, validation gates, and implementation sequencing.

## 0. Product Decisions Captured Here

These are no longer open assumptions:

1. **Late joins are allowed in every topology, ruleset, and live phase.** A player should be able to
   enter the room during Race, Derby, countdown, combat, finish grace, results, and rematch flow.
   The exact scoring/eligibility policy may vary by phase, but the join flow itself must not be
   blocked just because the match is in progress.
2. **Map choice happens at host setup time.** The host chooses a known map or a random/seeded map
   before starting Race or Derby. The choice resolves to a concrete, immutable `MapInstance` with
   `{ruleset, source, recipeId, seed, generatorVersion, params, resolvedMapId}`.
3. **Random never means unrecorded `Math.random()`.** Random means "generate from a visible seed and
   recipe." The chosen seed must be reproducible, shareable, logged, validated, and included in
   bug reports.
4. **Known maps and procedural maps use the same validation gate.** A hand-authored JSON map and a
   generated map instance must both pass the same "safe to spawn and play" tests.
5. **Derby maps do not have to be literal bowls.** They do need containment, combat pressure,
   readable boundaries, late-join spawns, anti-camping rules, and a shrink/sudden-death story.
6. **The procedural engine is an authoring system, not just a race spline generator.** The long-term
   shape is hand-authored recipes plus seeded procedural layers, with constraints and masks.

## 1. Why This Plan Exists

The current procedural generator is useful but narrow:

- `static/js/resources/ProceduralTrackGenerator.js` only generates a flat closed race spline.
- The "random derby" path in `GameHost._resolveTrackId()` chooses one of four shipped derby maps with
  `Math.random()`, so it is not replayable or seed-testable.
- Ramps exist as map-authored `geometry.ramps`, and dunes use a shared visual/physics height grid,
  but the placement rules and terrain vocabulary are not formalized.
- `docs/plans/gaps/derby-map-reliability.md` correctly covers fail-loud validity and bowl transition
  reliability, but it does not define the broader choose-time catalog, seed, recipe, and authoring
  architecture.

The risk is that agents patch individual symptoms: another derby JSON, another random branch, another
ad hoc ramp list. That will not produce a map system that feels authored, replayable, fair for late
joiners, and rich enough for both Race and Derby.

## 2. Current State Summary

### 2.1 Existing Map Types

Current shipped maps:

| ID | Geometry | Intended ruleset | Notes |
|---|---|---|---|
| `oval` | `oval` | Race | Has 6 spawns and 4 checkpoints. |
| `derby-bowl` | `bowl` | Derby | Visual bowl and physics floor are currently desynced per the reliability plan. |
| `derby-coliseum` | `bowl` | Derby | Same bowl class, larger arena. |
| `derby-arena` | `square` | Derby | Flat square with walls. |
| `derby-dunes` | `dunes` | Derby | Best current example of shared visual/physics terrain grid. |
| `procedural` | generated `spline` | Race | Flat closed race circuit from a random or provided seed. |

### 2.2 Existing Engine Pieces To Preserve

- `TrackFactory` already has a config-driven factory boundary.
- `terrain.js` shows the right pattern: one deterministic vertex grid feeds both render mesh and
  Rapier trimesh.
- `PhysicsSystem` already supports static ramp wedge colliders.
- `GameHost._resolveTrackId()` is the current map resolver, but it needs to become deterministic and
  explicit rather than mode-coercing.
- The user-flow database now requires late joins in live phases, which means map generation must
  support dynamic safe spawn selection, not just fixed start grids.

## 3. Vocabulary And Data Model

Avoid overloading "track" for everything. Use these terms in new Beads and code:

| Term | Meaning |
|---|---|
| `MapCatalogEntry` | Something the host can select: a known map, a random recipe, or a seedable preset. |
| `MapRecipe` | Generator/template definition with constraints, compatible rulesets, defaults, and tunable params. |
| `MapInstance` | Concrete resolved map for one match: catalog entry plus seed plus generated geometry. |
| `TerrainProfile` | Height/shape rules: flat, bowl, dunes, terraced, banked, plateau, pit, basin, hybrid. |
| `FeatureLayer` | Jumps, ramps, pickups, hazards, props, shortcuts, boost pads, spawn pads, landmarks. |
| `SpawnPolicy` | Rules for initial spawns, late-join spawns, respawns, ghost/reconnect placement. |
| `ValidationReport` | Deterministic result proving the instance is playable for ruleset and player count. |
| `SeedSpec` | `{seed, generatorVersion, recipeId, paramsHash}`; enough to reproduce exactly. |

Minimal future shape:

```json
{
  "id": "random-derby-basin",
  "label": "Random Derby Basin",
  "source": "procedural",
  "compatibleRulesets": ["derby"],
  "recipeId": "derby-basin-v1",
  "defaultParams": {
    "arenaSize": "medium",
    "terrainIntensity": "medium",
    "jumpDensity": "medium",
    "weaponDensity": "standard",
    "symmetry": "loose"
  },
  "seedPolicy": {
    "visible": true,
    "editable": true,
    "randomizeButton": true
  },
  "validation": {
    "minPlayers": 1,
    "targetPlayers": 8,
    "lateJoinCapacity": 16
  }
}
```

## 4. Host Choose-Time Flow

The host setup UI should make map selection a first-class step:

1. Host chooses `ruleset`: Race or Derby.
2. Map selector filters by compatible ruleset.
3. Host chooses one of:
   - **Known maps:** shipped, named, previewable, deterministic.
   - **Random preset:** recipe plus generated seed.
   - **Seeded custom:** same recipe, manually entered or pasted seed.
4. UI shows the resolved seed and key tags before start:
   - terrain profile;
   - player count target/capacity;
   - jump density;
   - weapon/pickup density;
   - late-join support;
   - validation status.
5. Start is allowed only after the selected map resolves and validates for `{ruleset, playerCount,
   lateJoinCapacity}`.

Important rule: no hidden coercion. If the host chooses a Race-only map while in Derby, either the UI
prevents that selection or the start flow blocks with a clear incompatibility reason. Do not silently
swap `oval` to a derby arena or `derby-bowl` to `procedural`.

## 5. Late-Join Requirements For Maps

Late joins being always allowed changes map requirements.

### 5.1 Room Join Policy

All phases admit the player to the room:

| Phase | Required behavior |
|---|---|
| Lobby | Normal join. |
| Countdown | Join immediately and spawn if countdown has not locked, or spawn as late entrant on go. |
| Race before first finisher | Spawn as active racer; eligible under normal late-start rules. |
| Race finish grace | Admit to the room, then spectate or queue for the next race; do not spawn into the finalized current race. |
| Race results | Join into results/postgame/rematch flow; active driving resumes next match. |
| Derby combat | Admit to the room as `waiting_next_round`/spectator; active driving resumes at the next round reset. |
| Derby round end/results | Join visible post-round/postgame flow; active driving resumes next round/match unless the host starts immediately. |
| Host loss grace | Join may wait in a reconnect/paused room state if server policy allows it. |

### 5.2 Scoring Is Separate From Admission

"Allowed to join" does not mean "allowed to rewrite the already-earned result."

Race recommendation:

- Before first finisher: late joiner may be fully placed if they complete the race.
- During finish grace: late joiner is admitted to the room and can spectate or queue for the next
  race, but cannot spawn into the current race, displace already finished placements, or extend the
  grace timer.
- After results: join results/rematch state, not the finalized current race.

Derby recommendation:

- Party default: late joiner is admitted to the room as `waiting_next_round`/spectator and is
  registered into `DerbySystem` on the next round reset.
- Future/custom option: the host may later allow current-combat active late entrants with spawn
  shield, visible label, and explicit scoring policy, but that is not the default.
- Results and waiting copy must show the policy clearly; do not hide that a player joined mid-round.

### 5.3 Spawn Policy Requirements

Every map instance must provide or generate:

- enough initial spawns for the target and max player count;
- dynamic late-join/respawn/reconnect spawn candidates beyond the initial grid for early race joins,
  recovery flows, soak tests, and future/custom policies;
- spawn safety scoring: ground raycast hit, no wall penetration, no vehicle overlap, not inside
  active explosion/weapon zone, not on a jump landing, not outside shrink boundary;
- camera/identity affordance so the new player and existing players understand the entrant;
- deterministic replay: given seed and live state snapshot, the selected spawn should be explainable
  and testable.

This means fixed `playerIndex % spawns.length` is not a valid long-term spawn strategy.

## 6. Procedural Engine Architecture

Replace the single-purpose `generateTrackConfig(seed)` with a staged generator:

1. **Resolve catalog entry:** known map or procedural recipe.
2. **Create PRNG streams:** separate deterministic streams for macro layout, terrain, features,
   spawns, pickups, visuals, and debug labels. One system seed, many named substreams.
3. **Generate macro geometry:**
   - Race: closed route graph/centerline, width envelope, checkpoint graph, optional shortcuts.
   - Derby: containment shape, combat zones, boundary profile, shrink/sudden-death compatibility.
4. **Generate terrain:** height/profile layer, banks, bowls, dunes, plateaus, pits, berms, ramps.
5. **Place semantic zones:** spawn zones, late-join zones, pickup zones, danger zones, recovery zones,
   no-build zones, sightline/landmark zones.
6. **Place features:** jumps, ramps, props, barriers, boost pads, weapon/pickup points.
7. **Build render and physics surfaces from the same data.**
8. **Validate:** schema, geometry, colliders, checkpoints, containment, spawn safety, jump safety.
9. **Emit artifact:** `MapInstance` plus `ValidationReport` plus optional debug preview.

The generator output should still be compatible with `TrackFactory`/`Track` at the boundary, but the
generator itself should be recipe-driven and ruleset-aware.

## 7. Terrain Modification Requirements

The engine should support these terrain primitives over time:

| Primitive | Race use | Derby use | Notes |
|---|---|---|---|
| Flat plane | Starter maps, straightaways | Simple arenas | Must still support authored ramps and props. |
| Banked turns | Better racing feel | Outer-ring derby flow | Checkpoint and camera must understand slope. |
| Bowl/basin | Rare race stunt sections | Classic derby convergence | Must use shared visual/physics profile. |
| Dunes/noise | Off-road race variant | Chaotic derby terrain | Deterministic heightfield with safe spawn checks. |
| Terraces/plateaus | Shortcuts, elevation rhythm | King-of-hill pressure, risky overlooks | Needs anti-camping and escape routes. |
| Pits/depressions | Risk/reward shortcuts | Central combat pressure | Avoid unreachable traps; reset rules required. |
| Berms/rims | Track edge readability | Containment without vertical wall feel | Good for non-bowl derby maps. |
| Authored ramps | Stunts, recovery jumps | Re-entry, ambush, crowd moments | Must have approach and landing validation. |

Near-term target: heightfield/trimesh terrain plus discrete ramp colliders. Bridges, tunnels, and
stacked drivable layers are later; they complicate checkpoints, camera, raycasts, and late spawns.

## 8. Derby Shape Requirements Beyond Bowls

A Derby arena does not need to be "entirely bowl shaped." It needs to satisfy combat invariants:

1. **Containment:** cars cannot accidentally leave the playable space.
2. **Convergence:** passive driving eventually brings players back toward conflict or pickups.
3. **Readability:** players understand walls, danger, jumps, safe landings, and shrink boundary.
4. **No permanent safe zones:** no perch, corner, plateau, or wall seam creates a dominant camp.
5. **Recovery:** flipped/stuck cars have reset or terrain affordances that do not hand out free wins.
6. **Late-join safety:** late entrants can spawn without immediate death or unfair ambush.
7. **Shrink/sudden death compatibility:** the boundary or pressure system remains meaningful for the
   specific shape.

Useful non-bowl derby recipes:

- **Rimmed plaza:** mostly flat center, climbable berm/rim, a few inward-facing ramps.
- **Terraced basin:** shallow low center, two or three outer height rings, multiple re-entry ramps.
- **Dunes basin:** noisy floor with a soft raised rim and occasional launch crests.
- **Offset pit:** asymmetric central pit and high-side platforms, with forced escape ramps.
- **Four-lobed arena:** rounded-square containment with inward pockets, but no dead-end corners.
- **Figure-eight bowl:** two combat basins connected by a wide saddle; works only if late spawns and
  shrink pressure cannot strand players in separate lobes.

The design tool should evaluate a derby map with a "combat pressure field": distance to active combat,
pickup gravity, shrink pressure, escape routes, and camping risk. A literal bowl is one way to create
pressure, not the requirement.

## 9. Jump Placement Rules

Jumps are not decoration. They create risk, recovery, spectacle, and route choices. Placement must be
ruleset-aware.

### 9.1 Universal Jump Safety Checks

Every jump needs:

- approach runway long enough for a normal car to line up;
- approach angle within a tunable cone of the intended heading;
- landing zone that is flat or smoothly sloped enough to recover;
- landing zone free of spawn pads, active walls, immediate cliffs, and hard 90-degree barriers;
- no direct launch out of bounds unless a catch wall/rim is validated;
- no forced jump on the only route to finish or stay alive unless the map is explicitly a stunt map;
- camera line of sight for the host view.

### 9.2 Race Jump Placement

Good race jumps:

- after a medium straight, not immediately after a blind hairpin;
- with a safe landing that rejoins the racing line;
- as a shortcut with a visible risk/reward cost;
- before or after checkpoints only when checkpoint volumes are height-aware and cannot be skipped by
  accident;
- away from first-turn pileup zones and initial spawn launch vectors.

Avoid:

- mandatory jumps that casual players cannot clear;
- jumps that let players bypass multiple checkpoints;
- landings that point at a wall before steering recovers;
- back-to-back jumps without recovery space.

### 9.3 Derby Jump Placement

Good derby jumps:

- around the outer ring, pointed inward so players re-enter combat;
- from a high terrace into a central pit with a wide landing;
- as escape ramps out of a basin or pit;
- near pickups as visible high-risk routes;
- positioned so a late joiner is not spawned directly into the landing zone.

Avoid:

- outward-facing launch ramps that throw cars into or over the boundary;
- ramps that create dominant camping platforms;
- ramps whose landings overlap spawn pads or the current shrink boundary;
- jumps that split the arena into unreachable sub-arenas.

## 10. Known Map And Random Map Catalog

The map catalog should expose both authored and generated options:

| Selector | Rulesets | Behavior |
|---|---|---|
| `oval` | Race | Known shipped map. |
| `random-race-circuit` | Race | Seeded race spline/terrain recipe. |
| `random-race-stunt` | Race | Seeded race with controlled jump density. |
| `derby-bowl` | Derby | Known shipped map after bowl profile fix. |
| `derby-arena` | Derby | Known shipped map after square boundary validation. |
| `derby-dunes` | Derby | Known shipped map and reference for shared terrain grid. |
| `random-derby-basin` | Derby | Seeded basin/berm/terrain recipe. |
| `random-derby-plaza` | Derby | Seeded flat/terraced/walled recipe. |
| `random-derby-stunt` | Derby | Seeded derby recipe with higher jump density. |

The current generic `random` selector may stay as a UI shortcut, but internally it should resolve to a
specific recipe and seed, not a one-off hidden branch.

## 11. Validation Gates

Add `validateMapInstance(instance, context)` where context includes:

```json
{
  "ruleset": "race",
  "topology": "local",
  "playerCount": 8,
  "lateJoinCapacity": 16,
  "phase": "prestart"
}
```

Validation must cover:

- schema fields required for the selected ruleset;
- deterministic seed and generator version;
- render surface exists and has vertices;
- physics collider exists and matches visual surface where applicable;
- race checkpoints exist, are ordered, height-aware, and cannot be skipped trivially;
- derby boundary is closed or pressure/elimination boundary is explicit;
- enough initial and late-join spawn candidates exist;
- spawns are on ground, non-overlapping, in bounds, and away from jump landings;
- jumps have valid approach and landing zones;
- pickups/weapons do not spawn inside walls, outside boundaries, or on unreachable terrain;
- remote viewers can reconstruct or receive the same map instance.

For random maps, tests need both fixed golden seeds and fuzzed seed corpora. Fuzz failures should
record `{recipeId, seed, paramsHash, validatorReason}` so the bad instance is reproducible.

## 12. Authoring Tool Requirements

The authoring tool should be built after the validator exists. It should support:

- loading known map JSON;
- selecting a procedural recipe and seed;
- editing constraints, not raw triangles first;
- painting no-build, spawn, pickup, jump, and hazard zones;
- previewing terrain height/profile and route graph;
- placing hand-authored anchors that the generator respects;
- running validation live;
- exporting a map package with `MapInstance`, `ValidationReport`, preview screenshot, and seed spec;
- generating a small matrix of random seeds for the same recipe.

This supports the intended hybrid workflow: hand-craft the important landmarks and constraints, let the
generator fill variation inside those constraints, then validate the result.

## 13. Test Matrix

High-value tests:

| ID | Target |
|---|---|
| `T-MAP-CATALOG-FILTERS-RULESET` | Race selector cannot silently start Derby-only maps and vice versa. |
| `T-RANDOM-MAP-REPRODUCES-SEED` | Same recipe/seed/version produces identical geometry hashes. |
| `T-RANDOM-DERBY-NOT-MATH-RANDOM` | Derby random records recipe and seed; no hidden `Math.random()` choice. |
| `T-MAP-VALIDATES-LATE-SPAWNS` | Map validates initial spawns plus late-join spawn capacity. |
| `T-LATE-JOIN-RACE-FINISH-GRACE-ACTIVE` | Finish-grace late join can enter but cannot extend timer or change locked placements. |
| `T-LATE-JOIN-DERBY-COMBAT-ACTIVE` | Mid-combat derby join spawns with shield/label and follows configured scoring policy. |
| `T-JUMP-APPROACH-LANDING-VALID` | Generated/authored jumps have clear approach and landing zones. |
| `T-DERBY-NONBOWL-COMBAT-PRESSURE` | Non-bowl derby map has containment, no safe camp, and shrink/sudden-death compatibility. |
| `T-MAP-INSTANCE-BUGREPORT-SEED` | Bug report includes map source, recipe, seed, version, params hash, and validation id. |
| `T-REMOTE-VIEWER-SAME-MAP-INSTANCE` | Remote viewer reconstructs or receives the same map instance as host. |

## 14. Implementation Sequence

Recommended order:

1. **Map vocabulary and schema:** `MapCatalogEntry`, `MapRecipe`, `MapInstance`, `SeedSpec`.
2. **Deterministic seed resolver:** remove hidden `Math.random()` from map resolution.
3. **Validation gate:** known maps and current procedural race must pass `validateMapInstance`.
4. **Late-join spawn policy:** replace modulo spawn reuse with generated safe spawn candidates.
5. **Generator refactor:** staged recipe-driven pipeline with named PRNG streams.
6. **Derby procedural recipe v1:** basin/plaza/dunes family with containment and combat pressure.
7. **Jump placer:** approach/landing validator plus ruleset-specific placement policies.
8. **Host selector UI:** known/random/seeded map choice with validation and seed display.
9. **Authoring tool:** constraint/zone editor and export package.
10. **Remote map sync:** ensure `MapInstance` travels through Remote viewer setup.

## 15. Resolved Defaults And Experience Gate

1. Resolved for v1 gates: support 2-32 active players, and test spawn generation/diagnostics to at
   least 64 candidates so future/custom late-join and soak paths have headroom.
2. Resolved scope: ship the full planned late-join surface. The party default remains queued/spectator
   during race finish grace and derby combat, and optional/full-chaos active late-entrant rules ship
   only when guarded by explicit rules, labels, scoring, spawn validation, and playtest evidence.
3. Owner direction for map tuning: optimize for a good experience, not a premature arbitrary choice.
   Host UI should expose curated presets and seed entry first; advanced raw parameters stay in the
   developer authoring/debug tool until playtest evidence earns player-facing controls.
4. V1 terrain primitives, procedural layers in known maps, shortcuts, and randomization ranges are
   outputs of the curated map-experience gate, based on validator output, debug renders, soak metrics,
   and playtest notes.
5. Every shipped preset must state its intended fun: readable chaos, comeback opportunity, stunt
   payoff, derby pressure, beginner-safe racing, or another concrete experience goal.
6. Resolved minimum debug artifact: JSON validator report plus screenshot/top-down debug render,
   with seed, tuning hash, map id/recipe, and failure reasons included.

## 16. Bead Conversion Map

Draft Beads that should be created or polished after this plan is reviewed:

| Bead | Purpose |
|---|---|
| `br-map-catalog-seed-contract` | Define catalog/recipe/instance/seed schema and resolver. |
| `br-map-random-deterministic` | Replace hidden random map selection with visible seeded resolution. |
| `br-map-instance-validator` | Shared validator for known and generated maps. |
| `br-map-late-join-spawns` | Dynamic safe spawn generation for live joins in all modes. |
| `br-procgen-recipe-pipeline` | Refactor procedural generator into staged, ruleset-aware recipes. |
| `br-procgen-derby-recipes` | Derby basin/plaza/dunes procedural recipes. |
| `br-map-jump-placement-policy` | Jump/ramp placement and validation rules. |
| `br-host-map-selector` | Host setup UI for known, random, and seeded maps. |
| `br-map-authoring-tool` | Constraint-based authoring tool with validation/export evidence. |
| `br-around-couch-risk-resolution-3xv.12` | Optional/full-chaos active late-entrant rules. |
| `br-around-couch-risk-resolution-3xv.13` | Curated map-experience gate for presets, terrain primitives, shortcuts, and player-facing randomization. |
