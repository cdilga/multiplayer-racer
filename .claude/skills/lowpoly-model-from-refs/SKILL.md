---
name: lowpoly-model-from-refs
description: Build a low-poly game vehicle/prop in three.js code from generated reference sheets, driven by a silhouette-IoU score and optimiser, budgeted for 24 players × 24 cameras. Use when adding or redoing a roster model in the polygonal style.
---

# Low-poly model from refs (pixel-driven)

Reference implementation: `spikes/art-pipeline/J-cruze-lowpoly/` (copy it; only `model.js` and the view weights are per-model).

## 1. Generate refs (image gen)
One sheet per detail level, same layout every time: **hero 3/4 front (top-left, large) · top view (right column, nose down) · bottom row front · side (nose left) · rear**.
Plain light-grey studio background, soft shadow, no text/logos/badges. Then one damage-concept sheet.

> Low-poly game asset turnaround sheet, 16:9, light grey seamless background. Same car in every view: large 3/4 front hero top-left, top-down plan view on the
> right (nose at bottom), bottom row front, left side (nose left), rear. *<subject + livery: e.g. bubbly cyan Cruze sedan, magenta/lime/white lightning-bolt
> livery, black nudge bar with 4 cyan LED blocks, UHF whip on the nudge bar, raked wing>*. **<LOD line>**. Flat-shaded facets, clean studio light,
> no text, no logos, no badges, no plates.

LOD lines (generate all four, keep the car identical):
- max: `high-poly, smooth curvature, detailed 8-spoke rims` (style target only; don't build this)
- lod+2: `mid-poly, visible facets, 5-spoke rims`
- lod+1: `low-poly, chunky facets, simple 5-spoke rims` ← build target for LOD0
- lowest: `very low poly, ~300 triangles, octagon wheels, lights as flat decals` ← LOD2

Damage sheet: `same car, stages intact → light dents → bonnet/front gone → doors and a wheel off → shell; detached parts row: front, doors, back, wheel`.

## 2. Loop
1. Edit the panel windows in `refs/extract.mjs` → `node refs/extract.mjs` (masks) → `node refs/measure.mjs` (metres) + read the 10 cm grids.
2. Write `model.js` from measured numbers: tub + greenhouse lofts, arch ellipses, box/prism/slab details, one atlas material.
3. `node serve.mjs 8124` · `node capture.mjs <tag> && python3 compose.py <tag>` → look at the reference | ours | diff sheet. Fix structure by hand.
4. `node calib.mjs` once (perspective distance of the refs), then `node opt.mjs lod1 7` (numbers only; keep the roughness penalty on).
5. Stop at weighted IoU ≈ 0.95 **and** a by-eye pass on cues the metric can't see (lamps, grille, livery, accessories).

## 3. Rules
- Budgets: ≤ 1.3k / 0.9k / 0.6k tris (LOD0/1/2). One material, one code-drawn atlas, paint key (pure-white paint is tinted per player).
- Parts: `core, front, back, door_FL/FR/RL/RR, wheel_*`; states intact → dented (second geometry) → detached; dark bays in core.
- Render one InstancedMesh per part type across all cars (draws per tile constant in N). Re-run `node bench.mjs` for 24×24 numbers.
- Pixels can't judge interior detail and the refs have perspective: never accept a higher score bought with zig-zag curves.
