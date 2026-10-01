# Triangle optimisation for primitive-built assets

Measured on the Cruze: LOD1 13.2 k → **4.65 k** (2.8×), hero 55 k → 20.8 k, medium 5.7 k → 2.1 k, distant 2.4 k → 1.0 k, with the same parts, pivots and cues.

## Method
1. **Budget per tier first** (write `tools/budgets.json`), including a *dentability* budget: mean paint-edge length ≤ ~½ the smallest dent radius you
   want to read (0.16 / 0.30 / 0.50 / 0.80 m for tiers 0–3). Budgets are gates, not hopes.
2. **Break down by part and material** (`breakdown.mjs`): triangles per part per material kind. Optimise the top three items, then re-measure. Repeat.
3. **One LOD table drives every primitive**: body grid `[nu,nv]`, panel scale `k`, tube `[segments, radial]`, ring points, sphere/cylinder segments,
   rounded-box → flat box, tyre `{seg, profile}`, rim style (`full|flat|disc`), which optional details exist, liner mode, panel offset. LOD is a
   parameter of every primitive, never a decimation pass (decimation erases dents, moves pivots, restores detached doors).
4. **Review the whole ladder visually** after each pass (100 px and 40 px thumbnails + wireframes). Coarse tiers expose smearing and facets.

## Where triangles hide (and the fix)
| Hotspot | Fix |
|---|---|
| Panel liners + edge skirts (~2.3× the skin) | half-resolution liner decimated from the skin, easing to zero thickness at the border, **no skirts**; liners on panels only at LOD0/1 |
| Whole-body mesh at hero density | explicit per-tier grids (44×34 → 9×7); the belt fillet needs ray density, so bunch rays at the flanks instead of raising `nu` everywhere |
| Chrome rings / lens rims / arch beads as tubes | tier tables: all rings at L0, only the recognition-critical frames (grille, bar) at L1, none below; tube radial 3 at low tiers |
| Tyres, springs, nuts, brake discs | tyre profile `smooth → light (6 segs) → ring (4)`; spokes `rounded → flat boxes → single disc`; springs `coil → strut → none`; nuts and discs L0 only |
| Round blobs (fog lamps, mirrors, eyes) | sphere → flat box below a segment threshold |
| Two canvas textures | one **trim atlas** with UV sub-rects; one texture, one material |
| Things the runtime provides | the race-number roundel is an overlay at an anchor, not geometry |
| Shading smear | dirt/AO vertex speckle scaled by tier: on coarse triangles it smears into dark blotches |

## Keep vs cut (rule)
Keep the recognition cues at every tier at the resolution the tier can show them (a slatted bar becomes a dark bar, a projector becomes a dot). Cut sub-pixel
detail first, then hidden detail (behind wheels, inside arches), then secondary trim. Never cut a part or a pivot: node names, pivots and anchors must be
identical across tiers (`lod.nodes_same`, `lod.pivots_same`).

## Coarse-tier gotchas
* Panel offset must grow with coarseness (chord error): 12 → 16 → 28 → 40 mm.
* Bays (dark openings) must be built on **exactly the same grid** as the panel they hide, or coarse chords poke through.
* Wheel tread radius must equal the wheel radius exactly, and segment counts divisible by 4 so a vertex sits at the bottom (the ground-contact gate is ±1 cm).
* Empty groups stand in for dropped detail (e.g. brake hub) so node names match across tiers.

## Runtime
Intact bake (≈60 → ≈20 draws per car), template/instance (24 cars in ~12 ms), pick LOD by projected px with 12 % hysteresis.
Measured from the shipped GLBs, 24 cars at 3840×2160: LOD1 627 draws (1,416 without the fast path), ~10 ms/frame on this Mac.
