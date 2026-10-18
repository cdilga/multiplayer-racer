# Cruz Missile

**How these images were made.** Playwright Chromium, headless, on eris, at commit d322454e (the bakes in this commit), with the same tools as the Lion President and Hawk Dash:
- `tools/vehicles/fit` for the reference comparisons;
- `tools/vehicles/view` for the turntables, LODs, paints, colliders and the before/after ladders;
- `tools/vehicles/evidence` for the damage strips, paint strip and viewer grids;
- the real host page (synthetic mixed grid, ANGLE/Vulkan on eris's RTX 2080 Super) for `host-grid-*.png` and `render.json`.

Sheets and ladders were composed on the Mac. These are not a real TV or phone. Every image named below was opened and looked at. All of them are in `cruz-missile/`.

## Looked at

- `cruz-missile/ladder-lod0.png`, `cruz-missile/ladder-lod1.png`, `cruz-missile/ladder-lod2.png`.
  - The sheet crop, then the P1-V02 bake (before), then this bake (after).
  - Views: front, front 3/4, side, rear 3/4, rear and top. The sheet has no rear 3/4 view, so that row has no reference.
  - The raw sheets are `cruz-missile/ladder-before-raw.png` and `cruz-missile/ladder-after-raw.png`.
- `cruz-missile/reference-lod0/sheet.png`, `cruz-missile/reference-lod1/sheet.png`, `cruz-missile/reference-lod2/sheet.png`.
  - Per view: the reference crop, the shaded model and the silhouette diff, with the IoU numbers.
  - `cruz-missile/iou.json` has the before and after numbers; `cruz-missile/before-br-bwju.3/sheet-lod0.png`, `sheet-lod1.png` and `sheet-lod2.png` are the old sheets.
- `cruz-missile/views.png`, `cruz-missile/lods.png`, `cruz-missile/paints.png`, `cruz-missile/paints-strip.png`.
  - Every side at every LOD, and six paints. Tyres, glass, lamps, rims, the pink and lime bolts and the black trim keep their colours under every paint; on the dark navy paint the black trim is faint, as it would be on a real car.
- `cruz-missile/colliders.png`: one hull per part. They are the P1-V02 hulls, unchanged; the whip and mirrors sit outside them.
- `cruz-missile/damage-strip.png`, `cruz-missile/damage-strip-overview.png`: all ten states; parts swing about their hinges, with dark bays behind missing panels.
- `cruz-missile/grid-1.png`, `cruz-missile/grid-4.png`, `cruz-missile/grid-24.png` (viewer). At grid-24 the pink and lime bolts and the wing still tell it apart.
- `cruz-missile/host-grid-1.png`, `cruz-missile/host-grid-4.png`, `cruz-missile/host-grid-24.png`.
  - The real host page with every roster car four times. Tile 1 follows a Cruz from behind: tail lamps, badge, wing, diffuser with the triangle, hex exhaust and pink corners; the seat's stripe pattern overlays the body. Tile 2 of the four-tile capture has another Cruz beside a Tradie Ute.

**What the model now shows that it didn't.** Compare the before and after columns of `cruz-missile/ladder-lod0.png`:

| Part | Before | Now |
|---|---|---|
| Cabin | One dark wedge of glass round the greenhouse | Painted A and C pillars and roof, black-framed side glass in two door panes with a black B pillar, lighter glass; the roof carries the sheet's lime and pink bolts |
| Livery | Slashes copied by eye, thin | Traced off the sheet: the side bolts, the white flash on the door, the bonnet, roof and boot bolts, and the wing endplates' bolts |
| Wheels | Pentagon discs on 12-sided tyres | 16-sided tyres; dark barrel, rim lip, five tapered spokes and a hub |
| Headlamps | Pale slits | Large angular lamps in dark brows, wrapping onto the wings |
| Grille | One flat dark slot | A black trapezoid grille with two mesh bars and the round badge |
| Nudge bar | Vertical posts, a top rail, small LED boxes | Slanted posts to a bottom rail, a top rail with struts to the nose, four cyan LED blocks at the sheet's spacing |
| Lower front | Pink corner slivers, a thin splitter | Square black fog housings with hex lamps; pink bumper wedges on the bar; a deeper black splitter |
| Aerial | A stalk on the bar | The whip on the right wing: a six-ring spring coil, then the whip leaning back with a red tip |
| Sides | Door seams only | Door handles with dark pockets, a black sill, body-colour angular mirrors on stalks |
| Tail | Two red rectangles | Angular two-part lamps (red, dark inner wedge) wrapping onto the quarters; a boot badge |
| Diffuser | A flat black strip | A black diffuser with two fins, a red reverse-light triangle, a hex chrome exhaust and pink L-shaped corners |
| Wing | A plain plate with pink endplates | The same blade, with the sheet's bolts on the endplates |

At LOD1 and LOD2:
- Both keep the traced livery, framed glass (LOD2 as one glazed band), the lamps, LED strip, tail lamps and triangle.
- LOD1 keeps the grille, nudge bar with LEDs, fog lamps, wedges, whip (a plain rod), flat 5-spoke rims and the hex exhaust.
- LOD2 has a flat black plate with one lit LED strip instead of the bar, 8-sided tyres with a pentagon decal, and a plain wing plate.

**Silhouette IoU (weighted):**

| LOD | Before | After |
|---|---|---|
| LOD0 | 0.9422 | 0.9494 |
| LOD1 | 0.941 | 0.946 |
| LOD2 | 0.9327 | 0.9335 |

Per view at LOD0:

| View | Before | After |
|---|---|---|
| Side | 0.960 | 0.9687 |
| Top | 0.9501 | 0.954 |
| Front | 0.9016 | 0.8981 |
| Rear | 0.9195 | 0.9398 |

**Triangles:**
- LOD0: 1264 to 2037. Its qualified budget rose from 1300 to 3000, and the Cruz asks for 2800.
- LOD1: 890 to 895.
- LOD2: 594 to 511.

**Host render cost** (`render.json`; 24 synthetic cars, four of them Cruz, 1920x1080):
- 1 tile: 81,610 to 87,794 triangles per frame. That is +6,184: each of the four LOD0 Cruzes has 773 more triangles (2,037 against 1,264), and the scene draws each in two passes.
- 4 tiles: 106,768 to 106,868 (+100). The tiles are drawn at LOD1 and LOD2.
- 24 tiles: 533,848 to 534,348 (+500).
- Draw calls are unchanged: 90, 228 and 1,148.

## Defects found and fixed

1. **A window pane drew in body colour from one side.** Corners clamped onto the glass edge made the first three points of the polygon collinear, so its facing flipped. `Soup.face` now takes the polygon's Newell normal.
2. **The lamp wraps stood off the body as thin fins.** The rear quarter curves quickly; one flat quad cut through it. Wraps are now three slices that follow the skin at LOD0.
3. **The pink L corners hung outside the body at the tail.** They are now inside the narrower lower tail.
4. **The headlamps stuck out past the narrower optimised nose.** Slope details are clamped to the body's width at their depth.
5. **A rebuilt visual changed the Cruz's physics.** The hull is the bake's own convex hulls, and the new body changed flip-recover, air-level, air-pitch-crash and two-wheels-off in the scenario bank. The bake now takes the collision points from `colliders.json` (the P1-V02 hulls), so the bank is as at HEAD.
6. **The door handles moved the door's pivot.** A 3 cm handle pushed the door's outer skin past the tolerance at LOD0 only. The handle is now 1.6 cm thick.
7. **LOD1 came to 911 triangles with the sliced wraps.** The slices are LOD0 only; LOD1 is 895.
8. **The old Cruz bake test compared the bake with Spike J's bounds and counts.** That no longer holds for a rebuilt body, so it now checks the nodes, one material, wheels on the ground and the sidecar's budgets.

## Remaining defects

- **The wheels are too big for the sheet.** The sheet's tyres are about 0.36 m in radius; the model keeps the sim's 0.4 m wheel_radius and 0.85 m track.
- **The nose is narrower than the sheet's.** The optimiser fitted the side and top views and narrowed the nose, so front-view IoU is 0.0035 below before (the weighted score still rises by 0.007). The front 3/4 view reads sportier than the sheet's broad nose.
- **The headlamps and their wraps read as a flat white or cream patch.** The sheet's lamps are warm and shaded; the model's `head` swatch is a single bright colour and the wrap shows as a pale slab at the fender in the side view.
- **The livery edges are soft.** The side atlas is about 160 px per metre, and the traced bolts are simplified polygons.
- **The sheet's bonnet creases, grille mesh and mirror shapes are only hinted at.** The mesh is two bars, not a hex pattern.
- **The roof bolts end at the glass.** In the sheet's top view they run on a little further than the model's roof.
- **The physics hull still includes the old mirrors and wing as they were**, not the new shapes. It is frozen on purpose (defect 5).
- **The scenario bank's off-road-climb fails**, as it already did at HEAD.

## Not covered

- **A Cruz-only close-up in a live round.** The host captures are the synthetic mixed grid (tile 1 does follow a Cruz).
- **Rust behaviour tests beyond the scenario bank:** jj-sim roster and jj-procgen handling tests run on CI.
- **`tools/vehicles/review/check.mjs` and `build.mjs --check`** need the spikes' evidence tree; CI runs them on the evidence commit.
- **Real phones and a real TV.**
- **The owner's verdict on recognisability.**
