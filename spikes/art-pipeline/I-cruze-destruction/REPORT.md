# Spike I — damage-ready Cruz Missile, Three.js primitives only (2026-10-02)

**Question:** can the primitive pipeline from spike H become a production vehicle-asset architecture? That means intact beauty,
convincing deformation, closed detachable parts, cavities, persistent dynamic wrecks, materially cheaper LODs and a runtime
quality bias, all without one surface doing four jobs.

**Answer: yes, with caveats listed in §7.** The contract is `CONTRACT.md`; the evidence is in `out/`. Scope was the car only (owner
instruction mid-task): the wheelie bin and the skill/destructibility docs were **not** touched. Nothing is committed.

| Evidence | File |
|---|---|
| Decision-standard shots (intact, badly crushed, missing door+bonnet, door upside down, wreck pile) | `out/sheet_decision.png` |
| Every detachable part: on car (intact / max deform / loose / removed) + detached (outside, inside, edge-on, top, flipped) | `out/sheet_parts.png` |
| The brief's explicit failure checks (door both faces up, bonnet upside down, bumper from behind, FL / roof crush, FL + door, retained damage, cavities, wheel off, complete wreck) | `out/sheet_checks.png` |
| Swap identity, intact vs assembly, 4 LODs × 3 views | `out/sheet_swap.png` |
| LOD pairs at their switch sizes, pixel-exact | `out/sheet_ladder.png` |
| Gates (38/38) | `out/gates.json` |
| Benchmarks | `out/bench.json` |
| Destruction field | `out/tiles/field_*.png` |

## 1. What was wrong with H, and the fix

H's visible mesh was the beauty mesh, the CPU dent target, the debris mesh and sometimes the convex-hull source, all at once. It
compensated with a dented hidden "bay" behind each panel. Here those jobs are four separate representations:

1. An intact fast path.
2. A damage-ready assembly of closed shells over a chassis with real openings.
3. Morph channels baked from designed space-warps.
4. Authored physics proxies.

Runtime vertex editing is gone, and so is collider hulling from render vertices.

## 2. Techniques that carried the result

* **Exact openings.** `clipOut` cuts the body mesh along each panel's convex outline: Sutherland–Hodgman in the outline's 2D
  projection, attributes interpolated. Boundary edges are then *trimmed* to the outline, because clipping leaves T-junctions and
  one long edge can run from outside to inside. The jamb walls are extruded from those edges, so walls and skin share vertices and
  the result is watertight.
* **Flat cavity backs.** Door walls project straight in to a far wall at |x| = 0.5 m (the sill becomes a floor, the roof rail a
  ceiling). Lid walls drop to a floor set from the lid's lowest edge. Bumpers get a recess straight back along the axis. An
  earlier version offset along the curved normal, which folded at the roof rail and leaked light at the sill.
* **Warps, not vertex pokes.** Each channel is d(x,y,z). Applying the same smooth warp to every attached surface keeps nested
  surfaces nested while det(I+∇d) > 0. Panel dents are mostly shears (det = 1 exactly). Normals use the cofactor of the Jacobian,
  so the morph normals are exact.
* **Coarse LODs cheat honestly.** Below about 190 px, coarse triangles straddling cut lines made shards, and a cut-and-jamb
  opening can't be seen at that size anyway. So:
  * L2/L3 use an uncut body (z-stations placed on every cut line).
  * Each opening is a dark patch on its panel's own grid, inside the panel thickness.
  * Panel dents are scaled to 25 % so they can't sink into the solid body; the scuff colour keeps full strength.
* **Draw calls.** Four material slots instead of fourteen kinds. Intact cars are 8 draws (H: ~20, ~75 in parts). Shards are one
  growable InstancedMesh. Sleeping wrecks re-bake their current deformed state into 4 meshes and unbake on any further damage.

## 3. Gates (`node gates.mjs`, ~3 s, no browser) — 38/38 pass

| Gate | What it proves |
|---|---|
| `build.probes` | No surface probe fell back to the origin (the source of "spikes") |
| `mesh.hygiene` | Indices valid, all values finite, no zero-area triangles |
| `shell.closed` | Every door, lid, bumper and lamp has outer + inner + rim and thickness > 0 |
| `warp.injective` | Worst det(I+∇d) is 0.38 (all zones at once). Rear-bumper dent was 0.002 before the fix: a 9 cm shove on a 10 cm tail cap |
| `shell.thickness_under_damage` | At full damage the outer skin stays outside, with separation ≥ 0.35× declared thickness |
| `cavity.clearance` | Fully dented doors clear the seats; bumpers clear the crash bars |
| `panels.not_buried` | Two-sided parity raycasts from every inner-skin vertex at full dent find nothing buried inside a seat, engine, bar or jamb. This caught a spare wheel longer than the boot well, a rear recess running under the boot, and a deck triangle the boot cut had missed |
| `openings.no_see_through` | 8,245 rays entering the bare openings all hit chassis geometry, on all four LODs |
| `lod.budget` / `lod.ratio` / `draws.intact` | Triangle bands, ≥ 2× per rung, 8 intact draws |
| `lod.semantics_identical` | Ids, pivots, channels, colliders, masses and anchors are identical on all LODs |
| `rig.pivots_on_hinges`, `mass.accounting` | As named |
| `physics.authored_proxies` | No collider comes from render vertices |
| `warp.above_ground` | Nothing goes below y = 0 at full damage |

## 4. Numbers (Apple M1 Pro, ANGLE/Metal, system Chrome; relative only)

**One car**

| LOD | Intact tris / verts | Assembly tris / verts | Draws intact → assembly (incl. shadow pass) | Template bytes (incl. morphs) | Build + morph bake |
|---|---|---|---|---|---|
| L0 | 14,066 / 14,519 | 20,870 / 27,250 | 16 → 74 | 6.8 MB | 163 + 118 ms |
| L1 | 4,667 / 5,868 | 7,383 / 11,885 | 16 → 74 | 2.9 MB | 55 + 49 ms |
| L2 | 1,788 / 1,865 | 2,292 / 2,441 | 16 → 72 | 0.6 MB | 25 + 11 ms |
| L3 | 704 / 837 | 1,352 / 1,705 | 16 → 72 | 0.4 MB | 16 + 8 ms |

H for comparison: L0 20.8k, L1 4.65k, L2 2.1k, L3 1.0k, about 20 draws intact. Template bytes are shared by every car; only the
paint and lamp materials are per car.

**24 pristine cars, overview camera**

| Resolution | Mode | Draw calls | Triangles (incl. shadow pass) | LOD histogram |
|---|---|---|---|---|
| 1080p | auto, bias 0 | 231 | 81k | 7× L1, 17× L2 |
| 1080p | auto, bias 1 | 231 | 43k | |
| 1080p | auto, bias 2 | 231 | 21k | all L3 |
| 1080p | forced L0 / L1 | 231 | 426k / 141k | |
| 4K | auto, bias 0 | 231 | 141k | all L1 |

At 4K, bias 1 gives 81k and bias 2 gives 43k. H drew **627** calls for the same cohort at 4K/L1. CPU submit is 2.6–3.2 ms
mean in every row: this GPU isn't stressed by any of these, so the triangle and draw reductions are what will matter on weaker
hosts. That still needs measuring on one (§7).

**Destruction field, 1080p, physics stepping included**

The scene: 16 active cars driving laps, 10 wrecks from a real pile-up plus scripted collision episodes, 34 detached parts and 520
shards. That's 60 dynamic bodies (43 asleep) and 237 colliders.

| Bias | Draw calls | Triangles | Render submit | Sim step |
|---|---|---|---|---|
| 0 | 275 | 160k | 2.45 ms | 0.93 ms |
| 1 | 259 | 55k | 2.58 ms | 1.03 ms |
| 2 | 259 | 37k | 2.38 ms | 0.98 ms |

Frame pacing is p50 16.7 ms, p95 ~18 ms (vsync-bound). Before shard instancing and the wreck re-bake the same field took **1,258**
calls and 4.2 ms. The governor test (synthetic 1 ms budget) walked the bias 0 → 2.5 in 5 s, and all 60 bodies were still
present and dynamic afterwards.

## 5. LOD ladder: what each rung keeps and drops

* **L0:** smooth tyres, full alloys, every chrome ring, domed lenses with projector, handles, seat/wheel interior, full engine bay.
* **L1:** keeps the full part hierarchy, closed panels, cut openings with cavities, grille/bar rings, 5-spoke flat alloys, projector
  disc. Drops handles, lens rims, secondary rings, and mirror/sphere/body density (body 18×14).
* **L2:** uncut body (z-stations on the cut lines), panel shells still in the intact mesh (keeps the swap exact), dark opening
  patches, disc wheels, no rings, flat lenses.
* **L3:** uncut body only (no shells in the intact mesh), 8-sided tyre prisms with painted hub caps, one quad per lamp feature,
  crude cavity boxes.

The pairs at their switch sizes are in `sheet_ladder.png` (520/190/120/70/40 px, intact and damaged).

## 6. What should carry into the Blender comparison

1. **Use this contract (`CONTRACT.md`), not this code.** Same part ids, channel names, layers, collider descriptors and LOD
   semantics, so the two pipelines are compared on output.
2. **Closed shells and real cavities are non-negotiable.** The gates are tool-agnostic and should run on both:
   * closed shells,
   * see-through rays,
   * buried-panel parity,
   * Jacobian injectivity of morphs (sampled as displacement fields),
   * thickness under damage,
   * swap pixel identity.
3. **Zone morphs must be shared across neighbouring parts.** Blender needs the zone shape keys authored on every part they touch,
   or neighbours will intersect. A procedural warp gets this for free; Blender would need a driver or lattice per zone.
4. **Coarse LODs need their own cheats** (uncut body + opening patches). Decimation won't produce them.
5. **Measure draws as hard as triangles.** The four-slot material scheme and the wreck re-bake were the big wins.

## 7. Risks, gaps, not done

* **Not tested:**
  * a weaker or phone host (every render number here is on an M1 Pro);
  * Firefox/Safari, and the WebGPU renderer the plan recommends;
  * the Rust/native Rapier sim;
  * GLB export of morph targets plus the custom `pbr`/`emit` attributes (no bake step was written for I);
  * per-view LOD selection for split screens (`selectLod` is pure, but the driver here is single-view).
* **Physics is a stand-in.** It's an arcade impulse driver on wheel balls, not the raycast vehicle. Damage comes from scripted
  collision episodes (`Sim.hit`); contact-force-driven damage isn't wired. Loose hinges are visual springs, not joints.
* **Visual issues still showing:**
  * H's A-pillar fold and jagged rear-door glass bottom (pre-existing).
  * The smashed-glass crack pattern is screen-space and swims as the camera moves.
  * L3's swap shows the door shells appearing (0.25 % of pixels; doors are about 8 px tall at that size).
  * Swap seams at L0/L1 are ≤ 0.12 % of pixels, at the shut lines.
* **Memory:** morph data dominates template size (6.8 MB at L0, all 13 channels with position, normal and colour). Halving it with
  half-floats or dropping colour morphs at L0 is easy if it matters.
* **Dents:** one designed dent per panel, no arbitrary locations, as the brief asked.
* **Scope:** the wheelie bin and the stale TTL/FIFO/cap guidance in `.claude/skills/game-model-prep/{SKILL.md, references/destructibility.md,
  references/visual-qa-and-rubric.md}` were deliberately left for a follow-up. Those docs still contradict the owner policy.

## 8. Reproduce

```
node spikes/art-pipeline/I-cruze-destruction/serve.mjs &            # 127.0.0.1:8123, repo root, no-cache
cd spikes/art-pipeline/I-cruze-destruction
node gates.mjs                                                      # 38 gates, ~3 s, no browser
node capture.mjs && python3 compose.py all                          # all evidence tiles + sheets (~10 min)
node bench.mjs                                                      # out/bench.json (~8 min)
open http://127.0.0.1:8123/spikes/art-pipeline/I-cruze-destruction/index.html   # drag to orbit; window.__demo is the API
```
