# br-8h3u.10 · Vehicle mesh optimisation: survey, measurements, what the bake does now

Owner, playtest 3 (2026-10-24): "there is some serious mesh optimisation that can be done ... we could afford to pack a bit
more detail into the same budget". This is part 1: find where the triangles go and free what can be freed. Part 2 is the
likeness pass that spends it (br-8h3u.11).

Measured on the Mac (Apple Silicon, Node 26.10), 2026-10-24, from each car's `model.js` soups at the committed params.
Scripts: `analyse.mjs` (budget accounting, hidden/inverted faces, coplanar merges, meshoptimizer LODs, the pixel check) and
`twoway.mjs` (faces seen from both sides, with pictures). `analyse.mjs` needs `npm i --no-save meshoptimizer@1.3.0` (not
a repo dependency, see "LODs"). Raw numbers: `report.json`.

## The constraint

The budget is triangles drawn (`vehicle.json` `lods[].maxTris`), and the bake writes flat, non-indexed soups. The usual
GitHub optimisers (meshoptimizer's vertex cache/fetch/quantisation, gltfpack, Draco) shrink bytes and vertex work, not
triangles, so they don't buy detail. Triangles can come from four places: faces nobody can see, coplanar fragments, better
lower LODs, and how the budget is split between parts.

## Findings (LOD0)

| Car | Tris / budget | Wheels | Hidden, dropped | Inverted, flipped | Coplanar merge ceiling |
|---|---|---|---|---|---|
| au-hawk | 2906 / 3000 | 668 (23 %) | 0 | 7 | 78 |
| cruz-missile | 2037 / 2800 | 680 (33 %) | 20 | 0 | 14 |
| hawk-dash | 2459 / 2800 | 668 (27 %) | 13 | 34 | 106 |
| lion-president | 2162 / 2400 | 680 (31 %) | 7 | 29 | 16 |
| tradie-ute | 2080 / 2400 | 752 (36 %) | 40 | 21 | 18 |
| pig-catcher | 2736 / 2800 | 1084 (40 %) | 278 | 0 | 0 |
| postie-bike | 2782 / 2900 | 824 (30 %) | 209 | 0 | 0 |

(Flipped/dropped at the bake's settings; LOD1/LOD2 counts are in the bake output.)

1. **Hidden faces**: triangles a part's own shell hides from every direction. Small on the cars (0-40, at most 2 %),
   real on the bikes (209-278, 8-10 %: spoke and frame ends buried in hubs and tubes). The bake now drops them.
2. **Inverted faces**: front never visible, back visible. A few on four cars; the bake flips them. With front-face
   culling these drew nothing; flipping them changed no pixel in the check views, so it's tidiness, not a visible fix.
3. **Wheels are the biggest budget line**: 23-36 % of every car's LOD0 and 30-40 % of the bikes', about 5x what the same
   wheel costs at LOD1 (120-168 tris for all four). A wheel is a few dozen pixels tall from the chase camera. Cutting
   LOD0 wheels to roughly LOD1 density would free about 350-500 tris per car (15-20 % of budget) for the body, where the
   likeness lives. That is a modelling call for br-8h3u.11, not something an optimiser should do silently.
4. **Coplanar merges**: re-triangulating flat same-colour regions would save up to 106 (hawk-dash) and 78 (au-hawk),
   under 20 on the rest. Not built: the saving is small next to (3), and it needs a careful re-triangulation pass.
5. **One-sided panels**: faces whose back is seen from outside (`twoway.mjs`; red in `twoway-*.png`): lamps,
   window trim strips, the hawk-dash rear panel and splitter, au-hawk's greenhouse edge. Most of these backs show only
   through the open underside or wheel arches, but in a culled render from a 3/4 view 20° below the car hawk-dash shows the
   back of a panel on 1.8 % of its pixels (tradie-ute 1.1 %): small see-through gaps in game today. More visible now flipped cars get
   abandoned (br-8h3u.9). Fix in the model (close the panel or give it a back) during br-8h3u.11.

## LODs: meshoptimizer measured, not adopted

LOD1/LOD2 made from LOD0 by meshoptimizer 1.3.0 (`simplify`, absolute error, one shared error across parts, bisected to
the budget), scored against LOD0 by silhouette IoU and depth error over five orthographic views:

- Welding by position only (colours ignored) it beat every car's hand LODs: LOD2 depth error down ~30 %
  (lion-president 41.5 → 25.7 mm). That version smears colours across swatch borders, so it isn't usable.
- Welding by position + UV (colour borders kept as seams; `Permissive` only when the seams alone exceed the budget):
  **parity**. Better on some, worse on others (hawk-dash LOD1 13.7 → 21.2 mm worse, cruz LOD2 35.1 → 27.8 mm better,
  bikes mixed). The hand LODs stay. Revisit if LOD authoring becomes the bottleneck: generated LODs would let a modeller
  build only LOD0 at parity quality.

## The bake now (tools/vehicles/optimise.mjs)

`orientAndPrune` runs on every part's render mesh at every LOD before the GLB is written. For each triangle it casts rays
from 1024 directions at 31 points (interior, near each edge and corner) against the part's own geometry: front seen →
kept; only back seen → flipped; neither → dropped. A part's own shell is the only occluder, so no damage state (a door
off, a wheel gone) can reveal a dropped face. Collider hulls still come from the full soup, so physics is unchanged.

Verification (`VERIFY=1 node analyse.mjs`): each car's LOD0 with and without the dropped set, rendered back-face-culled
from 64 directions at 384 px. Differing pixels: 0 on five cars, 4 of ~3 M on cruz-missile and 4 of ~1.1 M on
pig-catcher (single edge pixels). Earlier settings with interior-only samples left up to ~6 k differing pixels on
tradie-ute (thin visible strips along edges), which is why the edge samples exist. Direction count: identical pixels from
512 up; 1024 is used because the dropped counts still wobble at 512.

Tests: `tools/vehicles/test/optimise.test.mjs` (a hidden inner box is dropped and the shell kept exactly; defect
injection: an inside-out face is flipped back; separate boxes are untouched); all 50 vehicle tool tests pass;
`bake --check` reproduces every car byte for byte; `cargo test -p jj-contracts` passes (run locally: no RCH worker was
admissible). Cost: the bake check takes ~66 s of CPU for the roster (was a few seconds), so the CI checks lane now runs
the cars in parallel (32 s wall on 8 cores).

## Freed budget for br-8h3u.11 (LOD0, triangles)

| Car | Freed by the bake | Headroom now | Possible from wheels (finding 3) |
|---|---|---|---|
| au-hawk | 0 | 94 | ~500 |
| cruz-missile | 20 | 783 | ~510 |
| hawk-dash | 13 | 354 | ~500 |
| lion-president | 7 | 245 | ~510 |
| tradie-ute | 40 | 360 | ~580 |
| pig-catcher | 278 | 342 | ~950 (spoked wheels) |
| postie-bike | 209 | 327 | ~700 |

Honest summary: the optimiser frees little on the cars and about a tenth of the budget on the bikes. Several cars already
have 250-780 tris of headroom they don't use. The big win is spending the budget differently (wheels → body), which
br-8h3u.11 should do by hand with the likeness score.
