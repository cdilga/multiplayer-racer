# Spike J — low-poly Cruz Missile, pixel-driven, sized for 24 players × 24 cameras

**Question.** Can a script-built, three.js-primitive car be driven toward the owner's new reference sheets by a pixel metric, at a
triangle budget that holds up when 24 players each have a camera, and with damage simplified to doors / wheels / front / back?

**Answer: yes.** Final model: **1,264 / 890 / 606 tris** (LOD0/1/2; UHF whip now mounted on the nudge bar), one material, one 1024×512 canvas atlas (no texture files).
Silhouette IoU vs the "lod + 1" sheet is **0.947** (weighted; side 0.968, top 0.947, rear 0.931, front 0.909). LOD2 vs the "lowest-lod" sheet is 0.939.
24 cars × 24 chase-camera tiles (worst case, all cars in every tile, no culling) render in **3.6 ms at 1080p and 5.1 ms at 4K** on an M1 Pro,
using one InstancedMesh per part type: **216 draws per frame** vs 3,602 for a plain scene graph.

Reference: `spikes/art-pipeline/{lowest-lod,lod + 1,lod + 2,max lod}.png`, `damage - med-lod.png`. Target tiers per the owner: our LOD0 ≈ "lod + 1",
LOD2 ≈ "lowest-lod"; "max lod" deliberately not pursued. This is a new spike; nothing from H/I is imported (the KB method is reused, the code is not).

## 1. What 24 players actually costs (the multiplier)

Every grid tile is a camera that renders the whole scene, so a packed start grid draws **N cars × N tiles** = 576 car renders at 24 players, not 24.
Two numbers scale differently:

* **Draw calls** with a normal scene graph = tiles × cars × parts → ~3,600/frame here, ~15,000 for the H-kit car (~26 draws/car, estimate, not measured in a grid).
  That is CPU-side and is what kills weaker hosts. With **one InstancedMesh per part type** it is tiles × part-types: 9 per tile (8 parts + ground),
  **constant in the number of players**. Debris stays dynamic: a detached door is the same instance with a physics-driven matrix; a dented part is an
  instance in the "dented" mesh for that part. No caps, no per-hit draws.
* **Triangles** = tiles × visible cars × tris/car. At 878 tris (LOD1) that is 506 k/frame with nothing culled; the H LOD1 (4.65 k) would be ~2.7 M.
  Frustum culling and per-tile LOD will cut this further in real races; the budget has to hold in the start-grid worst case.

Measured (`bench.mjs`, system Chrome/Metal, M1 Pro; ms = CPU submit + GPU finish via a 1-px readback; median of 90 frames):

| cars × tiles | output | LOD | mode | draws/frame | tris/frame | ms median | ms p90 |
|---|---|---|---|---|---|---|---|
| 24×24 | 1080p | 0 | naive | 3,622 | 434k | 10.5 | 14.9 |
| 24×24 | 1080p | 0 | **instanced** | **216** | 721k | **4.0** | 5.2 |
| 24×24 | 1080p | 1 | naive | 3,602 | 297k | 9.9 | 13.8 |
| 24×24 | 1080p | 1 | **instanced** | **216** | 506k | **3.6** | 5.1 |
| 24×24 | 1080p | 2 | instanced | 216 | 310k | 2.7 | 3.7 |
| 24×24 | 4K | 0 | naive | 3,622 | 434k | 12.7 | 15.4 |
| 24×24 | 4K | 1 | **instanced** | **216** | 506k | **5.1** | 6.4 |
| 24×24 | 1080p | 1 | instanced, shadow map per tile | 216 | 506k | 3.5 | 5.4 |
| 48×48 | 1080p | 1 | instanced | 432 | 2.0M | 5.5 | 6.8 |
| 4×4 | 1080p | 0 | instanced | 36 | 20k | 2.7 | 6.1 |

(Naive tris are lower only because per-object frustum culling works there; the instanced bench disables culling to measure the worst case.)
Full table: `out/bench.json`. Screenshot of the 24-tile frame: `out/bench_n24_lod1.png`.

**Recommendations for the renderer (G-PERF input, not decisions):**
1. Instance per part type across all cars from day one; per-player colour via `instanceColor` and a **paint key** (atlas paint is pure white;
   the shader tints only white texels, so glass/lights/livery keep their colours). One material for every car. Implemented in `atlas.js`.
2. Budget cars at **≤ 1.3 k tris (LOD0) / ≤ 0.9 k (LOD1) / ≤ 0.55 k (LOD2)**. At 24 tiles a tile is 384×216 (1080p) and the own car is ~100 px tall,
   which is LOD1 territory; LOD0 is for 1–4 tiles. Thumbnails at 100/40 px: `out/thumbs.png`.
3. Update the shadow map once per frame, not once per tile (`shadowMap.autoUpdate = false`, `needsUpdate` before tile 0). At these
   triangle counts it barely mattered on this Mac, but the per-tile cost grows with scene/prop complexity.
4. Not measured here: a weaker host GPU (integrated laptop), track/props, particles, post-processing. The naive path is CPU-bound
   (3.6 k draws) and should be expected to fall off first on slower CPUs; the instanced path has ~6× headroom on this machine.

## 2. The pixel loop (how the model was driven to the reference)

1. `refs/extract.mjs` cuts side/front/rear/top/hero out of each sheet and segments the car (saturated **or** dark; holes flood-filled so white livery
   and headlights count; morphological opening r = 5 px drops the whip aerial; largest component). → `refs/masks/`.
2. `refs/measure.mjs` turns the masks into metres (L = 4.5 m): roofline/sill per station, plan half-width per station, front/rear half-width per height.
   `out/grid_side.png` / `grid_front.png` (10 cm grid) for reading wheel centres, arch heights and the fascia.
3. `model.js` is built from those numbers (curves `yBot`, `ySh`, `yCr`, `hw`, cabin stations, arch ellipse, details).
4. `app.js` renders the model's silhouette from each view, pushes it through the **same** fill/open/largest pipeline, scales it to the reference
   height (aspect still counts) and scores IoU per view; the bottom 12.5 % is ignored (the reference's contact shadow is indistinguishable from tyre rubber).
   The reference views are perspective renders (front reads ~11 % wider than the top view allows), so the evaluator uses a **perspective camera at
   10 m**, calibrated once (`calib.mjs`), for every view.
5. `opt.mjs` does coordinate descent over ~70 numeric parameters (heights, widths, cabin stations, wheel/arch, spoiler, mirrors), maximising the weighted
   IoU with two regularisers: a pull back to the measured start, and a penalty on *added* curve roughness. Without the roughness term the optimiser
   scored 0.956 by zig-zagging widths to fit one view's perspective (`out/params.it04.json`); with it, 0.947 and smooth. Structure changes stay manual.
6. Every iteration: `capture.mjs <tag>` + `compose.py <tag>` → reference | ours | diff (red = reference only, green = ours only).

| iteration | change | weighted IoU |
|---|---|---|
| it01 | first build from measured numbers | 0.874 |
| it02 | arch ellipse, sloped fascia, curved windscreen, fastback | 0.896 |
| it03 | raked spoiler, perspective eval camera | 0.899 |
| it04 | optimiser, 7 passes, no smoothness (rejected: zig-zag widths) | 0.956 |
| final | optimiser from measured start + smoothness; fascia cues; LOD stations | **0.947** |

**What the metric does not see:** interior features. Headlight/grille size, window shapes and livery placement were judged by eye against the crops.
The reference's per-door windows and B-pillar are replaced by one dark greenhouse band (reads better at tile sizes; KB lesson).

## 3. Model

* Two flat-shaded lofts: a **tub** (6-point half ring: floor, arch lip, side, shoulder, crown) sampled at stations, and a **greenhouse** (4-point ring)
  whose first/last stations collapse onto the tub (windscreen and fastback). Arches lift the lower ring points along an ellipse.
* Details as boxes/prisms/slabs: bull bar with four LED blocks, fog lamps, UHF whip, raked wing with parallelogram endplates, mirrors, diffuser, tail-lamp wrap.
* One `MeshStandardMaterial` (flatShading, vertexColors) with a code-drawn atlas: side livery (planar z,y), bonnet and deck livery (planar x,z),
  16 flat swatches; emissive map in the same layout. Recolour = redraw (`out/paint.png`) or `instanceColor` with the paint key.
* LOD = sampling density + which details exist (`LODS` table); part names and pivots identical at every tier. Ladder: `out/ladder.png`.

| part | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| front (bonnet, wings, fascia, bull bar, whip) | 426 | 228 | 120 |
| back (deck, quarters, tail, wing) | 286 | 206 | 142 |
| core (floor, greenhouse, bays, mirrors) | 176 | 156 | 140 |
| doors (4) | 60 | 48 | 24 |
| wheels (4) | 304 | 240 | 112 |
| **total** | **1,252** | **878** | **538** |

## 4. Damage (simplified per owner)

Parts: `front`, `back`, `door_FL/FR/RL/RR`, `wheel_FL/FR/RL/RR`; everything else is `core`. Each part: **intact → dented → detached**.
* Dented = a second, precomputed geometry per part (`damage.js`: falloff push toward the car, position-hashed jitter so the faceted shell stays closed,
  vertex-colour scuff that only darkens paint). Doors get a mid-door ring at LOD0/1 so a dent has vertices to move.
* Detached = the part leaves with its pivot at its own centre (debris spin); the core already holds dark bays (firewall, rear bulkhead, door openings),
  so a missing part reads as an opening.
* Strip: `out/damage_strip_L0.png`, `_L1.png` (intact → dented → door + wheel off → front clip off → shell). Close-up: `out/dent_ab.png`.
* Not done: physics (Rapier bodies/colliders for debris), loose/hinged intermediate state, wheel-loss handling. The shell with the front and doors
  gone reads as a dark box: interior blocks (seats, engine) would sell it better, at ~40–60 tris, as instanced parts shown only when exposed.

## 5. Known gaps / next steps

* Front view IoU (0.91) is limited by the reference's own perspective: its front is wider than its top view. Don't chase it further.
* Headlights on the sloped fascia are decals 26 mm off the surface; on hard angles they can still clip. A dedicated headlight ring in the tub would be cleaner.
* Not baked to GLB / contract yet (the H-kit `contract.js`/`check_asset` gates are the obvious next step); not tested through `GLTFLoader` or the rig.
* Bench is one machine; repeat on an integrated-GPU laptop before fixing budgets.
* Once the owner approves the look, fold the process into the KB/skill: the extract → measure → build → IoU → optimise loop is model-agnostic
  (only `model.js` and the view weights are per-vehicle).

## Files

`model.js` (build), `atlas.js` (texture + paint key), `damage.js`, `mask.js` (shared silhouette ops), `app.js` + `index.html` (eval/dev page),
`bench.js` + `bench.html` + `bench.mjs` (24×24 grid), `refs/extract.mjs`, `refs/measure.mjs`, `opt.mjs`, `calib.mjs`, `capture.mjs`, `compose.py`,
`evidence.mjs`, `compose_evidence.py`, `params.json` (final), `params.measured.json` (hand-measured start). Run `node serve.mjs 8124` first (binds 127.0.0.1).
