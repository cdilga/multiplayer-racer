# P1-V-finish self-review (br-bwju.11): every roster car against its contact sheet (Lion President, Hawk Dash, Cruz Missile, Tradie Ute, Pig Catcher, Postie Bike)

**How these images were made.** Playwright Chromium, headless, on eris, at commit 54a30978 (the bakes in this commit):
- `tools/vehicles/fit` for the reference comparisons;
- `tools/vehicles/view` for the turntables, LODs, paints, colliders and the before/after ladders;
- `tools/vehicles/evidence` for the damage strips, paint strip and viewer grids;
- the real host page (synthetic mixed grid, ANGLE/Vulkan on eris's RTX 2080 Super) for `host-grid-*.png` and `render.json`.

These are not a real TV or phone. Every image named below was opened and looked at. All of them are in `lion-president/`.


**Every roster car together (AC5):** `postie-bike/host-grid-24.png` is the real host page at 1920x1080 with 24 seats
across the whole rebuilt roster: Cruz Missile, Tradie Ute, Hawk Dash, Lion President, Pig Catcher and Postie Bike. Each
car's own section below has its ladders, IoU, render cost and validation. The Postie Bike was rebuilt last, so this grid
shows every car's new model.
- Its plates crowd at 24 tiles; decluttering them is P1-R07's.
- The bikes read small at this size; they are the Pig Catcher's and Postie Bike's open defects.
## Looked at

- `lion-president/ladder-lod0.png`, `lion-president/ladder-lod1.png`, `lion-president/ladder-lod2.png`.
  - The sheet crop, then the br-bwju.3 bake (before), then this bake (after).
  - Views: front, front 3/4, side, rear 3/4, rear and top, all in the sheet's red.
  - The sheet has no rear 3/4 view, so that row has no reference.
  - The raw sheets are `lion-president/ladder-before-raw.png` and `lion-president/ladder-after-raw.png`.
- `lion-president/reference-lod0/sheet.png`, `lion-president/reference-lod1/sheet.png`, `lion-president/reference-lod2/sheet.png`.
  - Per view: the reference crop, the shaded model and the silhouette diff, with the IoU numbers.
  - `lion-president/iou.json` has the before and after numbers.
  - `lion-president/before-br-bwju.3/sheet-lod0.png` and `lion-president/before-br-bwju.3/sheet-lod2.png` are the old sheets.
- `lion-president/views.png`, `lion-president/lods.png`, `lion-president/paints.png`, `lion-president/paints-strip.png`.
  - Every side at every LOD, and six paints.
  - Tyres, glass, lamps, the black roof and the swoosh keep their colours under every paint.
- `lion-president/colliders.png`: one hull per part, and the aerial and mirrors stay outside the hulls.
- `lion-president/damage-strip.png`, `lion-president/damage-strip-overview.png`.
  - All ten states.
  - Parts swing about their hinges, and there are dark bays behind the missing panels.
- `lion-president/grid-1.png`, `lion-president/grid-4.png`, `lion-president/grid-24.png` (viewer).
  - At grid-24 the wing, the black roof and the tail bar still tell it apart.
- `lion-president/host-grid-1.png`, `lion-president/host-grid-4.png`, `lion-president/host-grid-24.png`.
  - The real host page with every roster car four times.
  - The followed car isn't always a Lion, so these show the mixed grid draws cleanly, not the Lion up close.

**What the model now shows that it didn't.** Compare the before and after columns of `lion-president/ladder-lod0.png`:

| Part | Before | Now |
|---|---|---|
| Cabin | One grey glass wedge | A sedan cabin: painted A and C pillars, black-framed glass in three panes, a black B pillar, a narrower black roof and a shark fin |
| Wheels | Pentagon discs | 16-sided tyres; 5-spoke dark rims in a dark barrel with a hex hub; red calipers that stay put while the wheel turns |
| Arches | None | Widebody flares standing out over the tyres |
| Headlamps | Small pale lamps | Large fanged lamps: a dark housing, a yellow chevron and lower bar, and two fangs, wrapping onto the wings |
| Front | A split grille | A barred upper grille; a black lower bumper with a forward band; slatted intakes either side; four yellow LED blocks; a black splitter with a painted lip |
| Bonnet | Flat black nostrils | Raised body-colour scoops with black mouths, and a whip aerial on the right wing |
| Livery | A straight pinstripe | The sheet's swoosh: it starts at the lamp, sweeps over the front wing and thickens towards the tail, with gold lines above and below |
| Wing | A wing on two posts | Swan-neck posts with an N brace, and tall endplates |
| Tail lamps | A slim lamp | A full-width bar: red outline, dark core, pointed ends and wraps |
| Diffuser | Plain | A diffuser with fins and four larger chrome pipes, with dark bores, in two pairs |
| Mirrors and doors | — | Mirrors on stalks; door handles |

At LOD1 and LOD2:
- Both keep the lamps, LEDs, tail bar, swoosh and window frames.
- LOD1 keeps the flares and flat 5-spoke rims.
- LOD2 keeps the flares and flat 5-spoke rims, and has the body-colour scoops as decals.

**Silhouette IoU (weighted):**

| LOD | Before | After |
|---|---|---|
| LOD0 | 0.9349 | 0.9452 |
| LOD1 | 0.933 | 0.9413 |
| LOD2 | 0.9406 | 0.9464 |

Per view at LOD0:

| View | Before | After |
|---|---|---|
| Side | 0.9485 | 0.9643 |
| Top | 0.9219 | 0.928 |
| Front | 0.9214 | 0.9206 |
| Rear | 0.9382 | 0.9532 |

**Triangles:**
- LOD0: 1278 to 2162. Its qualified budget rose from 1300 to 3000, and the Lion asks for 2400.
- LOD1: 890 to 892.
- LOD2: 526 to 594.

**Host render cost** (`render.json`; 24 synthetic cars, four of them Lions, 1920x1080):
- 1 tile: 86,222 to 96,830 triangles per frame. That is +3,536 for the four LOD0 Lions in each of three passes.
- 4 tiles: 190,256 to 190,328. The tiles are drawn at LOD1.
- 24 tiles: 1,036,296 to 1,036,688.
- Draw calls are unchanged: 136, 412 and 2252.

## Defects found and fixed

1. **The windscreen was a narrow triangle.** The collapsed windscreen-base ring pulled its top edge in by half. The ring now lies flat at full width.
2. **The side glass cut through the greenhouse.** Window polygons that spanned several cabin stations sank into the surface. They are now clipped at every station.
3. **The flares were invisible.** They hid behind the tyres, which stand 0.995 m out. The flare lip now always clears the tyre, and the visual tyre is 0.26 m wide instead of 0.31; the sim's wheel is unchanged.
4. **The scoop mouths were slivers.** The inset maths moved each corner 82% of the way to the centre instead of 16%.
5. **The aerial would have become a collision surface.** So would the fin, the calipers and the mirror heads. The model now marks them as decoration, and the bake leaves them out of the colliders. The hull is ±0.99 m, not ±1.09 m.
6. **LOD1 came to 968 triangles, over its 900 budget.** LOD1 now draws flat rims with no inner tyre cap, no bumper band box and no skirts, which brings it to 892.
7. **A lower nose cost front-view IoU.** It pushed the evaluator's front bounding box down, so it was reverted.

## Remaining defects

- **The wheels are too big for the sheet.** The sheet's tyres are about 0.34 m in radius; the model keeps the sim's 0.43 m wheel_radius and 0.84 m track. Changing them is a handling change for both spec twins.
  - This is also most of the top-view gap: the tyres and flares set the car's width.
- **The nose is narrower and lower than the sheet's broad, flat front face.** Widening it cost IoU in every view I tried.
  - The front 3/4 view reads sportier than the sheet's boxy sedan nose.
- **LOD0 front-view IoU is 0.0008 below before.** The weighted score still rises by 0.010.
- **The swoosh's pinstripes read cream** through the paint key's filtered edges (br-vhtm, renderer-wide).
- **LOD2's flat spokes read as a dark star** at viewer sizes. At the tile sizes where LOD2 draws, they read as a rim.
- **Not every cue reaches the host render.** The fit page shows the pinstripes and the slat detail better than the host does. The host's ink outlines thicken the small parts.

## Not covered

- **A Lion-only close-up in a live round.** The host captures are the synthetic mixed grid.
- **Rust behaviour tests on the new hull** (jj-sim roster, jj-procgen handling): CI runs them on this commit. The RCH worker's cargo registry cache was broken during the session.
- **Real phones and a real TV.**
- **The owner's verdict on recognisability.**
- **The other roster cars.** The bead continues with the Hawk Dash and the rest.

# Hawk Dash

**How these images were made.** Playwright Chromium, headless, on eris, at commit 09a3e725 (the bakes in this commit), with the same tools as the Lion President above; the host captures and `render.json` are the real host page's synthetic mixed grid. Sheets and ladders composed on the Mac. These are not a real TV or phone. Every image named below was opened and looked at. All of them are in `hawk-dash/`.

## Looked at

- `hawk-dash/ladder-lod0.png`, `hawk-dash/ladder-lod1.png`, `hawk-dash/ladder-lod2.png`.
  - The sheet crop, then the br-bwju.3 bake (before), then this bake (after), in the sheet's blue.
  - Views: front, front 3/4, side, rear 3/4, rear and top. The sheet has no rear 3/4 view.
  - The raw sheets are `hawk-dash/ladder-before-raw.png` and `hawk-dash/ladder-after-raw.png`.
- `hawk-dash/reference-lod0/sheet.png`, `hawk-dash/reference-lod1/sheet.png`, `hawk-dash/reference-lod2/sheet.png`.
  - Per view: the reference crop, the shaded model and the silhouette diff, with the IoU numbers.
  - `hawk-dash/iou.json` has the before and after numbers; `hawk-dash/before-br-bwju.3/sheet-lod0.png` and `hawk-dash/before-br-bwju.3/sheet-lod2.png` are the old sheets.
- `hawk-dash/views.png`, `hawk-dash/lods.png`, `hawk-dash/paints.png`, `hawk-dash/paints-strip.png`.
  - Every side at every LOD, and six paints. Tyres, glass, lamps, stripes and the C graphic keep their colours under every paint; on the dark navy paint the black stripes are faint, as they would be on a real car.
- `hawk-dash/colliders.png`: one hull per part; the mirrors stay outside the hulls.
- `hawk-dash/damage-strip.png`, `hawk-dash/damage-strip-overview.png`: all ten states; parts swing about their hinges, with dark bays behind missing panels.
- `hawk-dash/grid-1.png`, `hawk-dash/grid-4.png`, `hawk-dash/grid-24.png` (viewer). At grid-24 the stripes, the C graphic and the tail lamps still tell it apart from the Lion.
- `hawk-dash/host-grid-1.png`, `hawk-dash/host-grid-4.png`, `hawk-dash/host-grid-24.png`.
  - The real host page with every roster car four times. The followed car in tile 1 is a Cruz; in `hawk-dash/host-grid-4.png` the bottom-left tile follows an orange Hawk from behind (stripes, tail lamps, wing, pipes) and the bottom-right tile has another beside a teal car.

**What the model now shows that it didn't.** Compare the before and after columns of `hawk-dash/ladder-lod0.png`:

| Part | Before | Now |
|---|---|---|
| Cabin | One dark wedge, the roof dark too | Painted A and C pillars, black-framed side glass in three panes (front door, rear door, quarter), a black B pillar; the roof painted, carrying the twin stripes; lighter glass |
| Wheels | 12-sided tyres with a pentagon disc | 16-sided tyres; dark 5-spoke rims with a rim lip, a dark barrel and a hub |
| Arches | None | Widebody flares with a black lip, standing clear of the tyres |
| Headlamps | Small slits on the nose face | Swept lamps from the grille's end round the corner onto the wing (they show in the top view, as on the sheet) |
| Grille | A thin slot above a hexagon | A black hexagonal upper grille between the lamps, framed in trim |
| Lower front | A hexagonal grille, white corner bars | A big lower intake with mesh bars; vertical LED slots in black surrounds; a wide black splitter |
| Bonnet | Two black boxes | A narrower power bulge and two louvred vents (four louvres each) |
| Stripes | Bonnet and boot only, ending at the edges | Nose to tail: down the nose past the grille, over the bonnet, roof and boot, down the tail to the diffuser |
| Side graphic | A thin L | The sheet's C: a broad leg behind the front arch, a band along the sill, a kick over the rear arch to the tail lamp, and its pinstripe |
| Wing | A tall wing on two posts | A body-colour blade on short black posts with turned-down tips |
| Tail lamps | Red rectangles | Angular lamps with a red outline and a smoked centre, wrapping onto the quarters |
| Exhausts | Two hexagonal stubs a side | A black diffuser with fins and four chrome pipes with dark bores, in two pairs |
| Mirrors and doors | Small boxes | Big black mirrors on stalks; door handles; side skirts |

At LOD1 and LOD2:
- Both keep the lamps, stripes nose to tail, C graphic, tail lamps, grille and intake, wing, and the painted roof.
- LOD1 keeps the framed side glass, the flares, the LED slots and flat 5-spoke rims.
- LOD2 has one glazed band, flat 5-spoke rims and flat pipes, and no flares.

**Silhouette IoU (weighted):**

| LOD | Before | After |
|---|---|---|
| LOD0 | 0.9638 | 0.9633 |
| LOD1 | 0.9604 (CPU) | 0.9609 |
| LOD2 | 0.9555 | 0.9505 |

Per view at LOD0:

| View | Before | After |
|---|---|---|
| Side | 0.9762 | 0.9792 |
| Top | 0.9529 | 0.9530 |
| Front | 0.9481 | 0.9335 |
| Rear | 0.9684 | 0.9713 |

The old body already fitted its outline; this rebuild is about what's inside it. The front score falls because the nose now has the sheet's flat fascia, which the evaluator's 8° front camera reads as taller and narrower. By eye the front is far closer (`hawk-dash/ladder-lod0.png`, `hawk-dash/reference-lod0/sheet.png`), so the by-eye pass wins there.

**Triangles:**
- LOD0: 1140 to 2459. It asks 2800 of the qualified 3000.
- LOD1: 872 to 896.
- LOD2: 512 to 596.

**Host render cost** (`hawk-dash/render.json`; 24 synthetic cars, four of them Hawks, 1920x1080, old Hawk GLBs routed in for "before"):
- 1 tile: 64,418 to 74,970 triangles per frame (+10,552: the four LOD0 Hawks, about 2,640 more each, in two passes).
- 4 tiles: 105,288 to 105,768. The tiles draw LOD1.
- 24 tiles: 526,448 to 528,848.
- Draw calls are unchanged: 90, 228 and 1148; 44 draws per tile.
- These totals are lower than the Lion's above because the host changed between the two runs; compare before and after within one car.

## Defects found and fixed

1. **The fascia didn't fit on the nose.** The fitted nose had its centre crown 10 cm below its corners (a V-shaped top), so a flat grille or lamp cut into it. The nose top is now flat at 0.78 m, and the fascia is projected onto the body rather than drawn on one plane.
2. **Projected decals sank into the curved corners** (fragmented lamps, tail lamps drawn as broken pieces). LOD0 cuts them into 6 cm cells; LOD1 and LOD2, which can't afford cells, lift them 2-2.5 cm off the surface.
3. **The LED slots spread over the corner** as white blocks in the 3/4 view. They moved in to the nose's flat face.
4. **The C graphic's leg hid under the front flare.** It moved back behind the arch, matching its place relative to the wheel on the sheet.
5. **The pinstripe's paint gap read as a white line.** At 1.2 cm, every texel in it was a filtered blend of the paint key and black, so none was tinted. It is now 3.5 cm.
6. **The diffuser was wider than the fitted tail** and stuck out at the sides; the tail lamps wrapped too far. Both were rescaled to the optimiser's narrower tail.
7. **LOD2's three-segment flares read as flaps.** LOD2 has no flares.
8. **LOD1 came to 948 triangles, over its 900 budget.** 8-sided tyres, no bay boxes and coarser lamp cells bring it to 896.
9. **The front flare reached behind the front cut line onto the door**, so LOD0's front pivot sat 9 cm behind LOD2's front edge (tools/vehicles/test/pivots.test.mjs failed). The flares now stop at the cut lines.
10. **The mirrors would have widened the hull** to ±1.08 m. They are decoration now, as are the wing tips; the hull is ±0.995 m.

## Remaining defects

- **The wheels are too big for the sheet.** The sheet's tyres are about 0.35 m in radius; the model keeps the sim's 0.40 m and 0.84 m track (the owner's call: no handling change).
- **The stripes' and C graphic's edges read light grey** in the viewer and on the host, most at small sizes (br-vhtm, renderer-wide). On the sheet they are crisp black on blue.
- **The front view is taller and narrower than the sheet's** in the evaluator (front IoU 0.948 to 0.934), and the lamps sit a little lower in the face than the sheet's.
- **The lower intake's honeycomb is three bars,** and the boot lid's panel line and the bonnet's crease lines are not modelled.
- **LOD2's stripes break on the tail's top chamfer,** where its coarse surface curves away from the decal.
- **The diffuser hangs a few centimetres below the tail** and reads as a black skirt from low rear angles.

## Not covered

- **A Hawk-only close-up in a live round.** The host captures are the synthetic mixed grid.
- **The jj-sim roster tests on the new hull:** CI runs them. The jj-procgen handling test passed through RCH, including the Hawk.
- **Real phones and a real TV.**
- **The owner's verdict on recognisability.**
- **The Cruz Missile, Tradie Ute, Pig Catcher and Postie Bike.** The bead continues with them.

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
  - `cruz-missile/iou.json` has the before and after numbers; `cruz-missile/before-br-bwju.3/sheet-lod0.png`, `cruz-missile/before-br-bwju.3/sheet-lod1.png` and `cruz-missile/before-br-bwju.3/sheet-lod2.png` are the old sheets.
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

# Tradie Ute

**How these images were made.** Playwright Chromium, headless, on eris, at commit 48a28076 (the bakes in that commit), with the same tools as the Lion President and Hawk Dash; the host captures and `render.json` are the real host page's synthetic mixed grid. Sheets and ladders composed on the Mac. These are not a real TV or phone. Every image named below was opened and looked at. All of them are in `tradie-ute/`.

**The Ute had no contact sheet.** It was built from the owner's Triton photos (br-bwju.8), so there was nothing to match. Two Muse Image sheets were generated first (`art/vehicles/tradie-ute/refs/`: the Cruz's layout as the example, the br-bwju.8 render as the content example, a written brief in `refs/prompts/`; ledger `art/ui/frames/ledger.jsonl`), the third of three candidates chosen for keeping the canopy, rack, bull bar, flares and snorkel. The "before" numbers are the br-bwju.8 bake scored against these new sheets.

## Looked at

- `tradie-ute/ladder-lod0.png`, `tradie-ute/ladder-lod1.png`, `tradie-ute/ladder-lod2.png`.
  - The sheet crop, then the br-bwju.8 bake (before), then this bake (after), painted the sheet's cyan.
  - Views: front, front 3/4, side, rear 3/4, rear and top. The sheet has no rear 3/4 view.
  - The raw sheets are `tradie-ute/ladder-before-raw.png` and `tradie-ute/ladder-after-raw.png`.
- `tradie-ute/reference-lod0/sheet.png`, `tradie-ute/reference-lod1/sheet.png`, `tradie-ute/reference-lod2/sheet.png`.
  - Per view: the reference crop, the shaded model and the silhouette diff, with the IoU numbers.
  - `tradie-ute/iou.json` has the before and after numbers; `tradie-ute/before-br-bwju.8/sheet-lod0.png`, `tradie-ute/before-br-bwju.8/sheet-lod1.png` and `tradie-ute/before-br-bwju.8/sheet-lod2.png` are the old sheets.
- `tradie-ute/views.png`, `tradie-ute/lods.png`, `tradie-ute/paints.png`, `tradie-ute/paints-strip.png`.
  - Every side at every LOD, and six paints. The tray and cab take the seat colour; the black canopy sides, bull bar, flares, rack, glass, lamps and tyres keep theirs.
- `tradie-ute/colliders.png`: one hull per part; the mirrors, snorkel and other decoration stay outside the hulls.
- `tradie-ute/damage-strip.png`, `tradie-ute/damage-strip-overview.png`: all ten states; parts swing about their hinges, with dark bays behind the missing panels.
- `tradie-ute/grid-1.png`, `tradie-ute/grid-4.png`, `tradie-ute/grid-24.png` (viewer). At grid-24 the canopy, rack and tall tray lamps tell it apart from the sedans.
- `tradie-ute/host-grid-1.png`, `tradie-ute/host-grid-4.png`, `tradie-ute/host-grid-24.png`.
  - The real host page with every roster car four times. The followed car is not a Ute in any of them; `tradie-ute/host-grid-4.png` has a blue Ute's tray lamps and canopy back in the top-right tile. They show the mixed grid draws cleanly, not the Ute up close.

**What the model now shows that it didn't.** Compare the before and after columns of `tradie-ute/ladder-lod0.png`:

| Part | Before | Now |
|---|---|---|
| Wheels | Black 12-sided discs with a silver ring | 16-sided tyres; a dark barrel; 8 silver spokes and a hub; the rim lip stays put while the wheel turns |
| Arches | A cut in the body | Widebody flares with a black lip standing over the tyres |
| Cab glass | One dark block | Painted A, B and C pillars; black-framed glass in three panes (front door, rear door, quarter) |
| Bonnet | Flat, two jets | A raised scoop with a black mouth and two louvre vents |
| Grille | Dark trapezoid with thin chrome slats | A chrome shield with seven dark slots, framed by a chrome header, under bigger swept lamps |
| Nose | A low slope | Taller and blunter, as the sheet's |
| Tray | Black frame with checker-plate boxes | Painted tray in the seat colour under the canopy |
| Tail | Small amber/white/red blocks on a black face | Tall red lamp bars up each corner with an amber foot, a painted tailgate, a black step bumper with two reversing lamps, a plate and the tow ball |
| Mirrors | Boxes on the door | Black mirror heads on stalks, kept out of the colliders |

Kept from br-bwju.8: the canopy and its hardware, the platform rack with deflector and awning, the snorkel, the bull bar with light bar, fog lamps, plate and winch hook, the J-line and shoulder line.

At LOD1 and LOD2:
- Both keep the framed glass, the flares, the scoop, the tall tray lamps and the painted tray.
- LOD1 keeps flat 5-spoke rims and the platform rack; LOD2 has hexagonal tyres with a decal hub, a simple rack and a flat grille.

**Silhouette IoU (weighted):**

| LOD | Before | After |
|---|---|---|
| LOD0 | 0.8729 | 0.9024 |
| LOD1 | 0.8725 | 0.9018 |
| LOD2 | 0.8847 | 0.9162 |

Per view at LOD0:

| View | Before | After |
|---|---|---|
| Side | 0.8509 | 0.8669 |
| Top | 0.9389 | 0.9650 |
| Front | 0.8330 | 0.8898 |
| Rear | 0.8395 | 0.8843 |

**Triangles** (the bake's counts, interior blocks excluded):
- LOD0: 1250 (br-bwju.8 bake, as baked) to 2080. Its qualified budget rose from 1300 to 3000, and the Ute asks for 2400.
- LOD1: 828 to 878.
- LOD2: 592 to 596.

**Host render cost** (`render.json`; 24 synthetic cars, four of them Utes, 1920x1080):
- 1 tile: 74,970 to 81,610 triangles per frame. The four LOD0 Utes' scene triangles go from 5,000 to 8,320 (three passes).
- 4 tiles: 105,768 to 106,768. The tiles are drawn at LOD1.
- 24 tiles: 528,848 to 533,848.
- Draw calls are unchanged: 90, 228 and 1148.

## Defects found and fixed

1. **The tail-lamp wrap stuck out.** A lamp face wrapped onto the tray's side floated off the corner as a red slab. It is gone; the corner lamp is flat on the tailgate.
2. **The side views were cut off.** The viewer's side and top frame (5.2 m) was shorter than the ute (5.6 m). `tools/vehicles/view` now takes `--ortho`, and every ute sheet uses 3.0.
3. **LOD1 came to 950 triangles and LOD2 to 618.** LOD1 now has fewer flare and arch samples and 5 spokes; LOD2 has hexagonal tyres and no plate or reversing lamps.
4. **LOD2's flares were spikes.** Three samples made a tent; four make an arch.
5. **The hull is narrower.** The mirrors and other decoration no longer go into the colliders: +-1.19 m, not +-1.29 m.
6. **The tray was still black.** The tray's side skin sampled the atlas's black under-tray rectangle and checker boxes behind the cab. They are removed from the atlas, so the tray takes the seat colour.

## Remaining defects

- **The sheet's tyres are bigger than the sim's.** The sheet's wheels fill the arches; the model keeps the sim's 0.43 m wheel_radius and 0.88 m track. Changing them is a handling change.
- **Side IoU is 0.867.** The sheet's nose is taller and its sill higher than the model's; the optimiser's limit and the hand heights I set got it no further. The canopy is also 0.1 m too wide in the rear view.
- **The grille reads as a grey block in the front view** at viewer sizes (the dark slots are narrow); at the host's tile sizes it reads as a pale shield.
- **The sheet's fog lamps are big round lamps**; the model's are small squares.
- **LOD1 and LOD2 drop the full rack, the snorkel's bends and the scoop's vents.**
- **Weighted LOD0 IoU 0.902 is short of the skill's ~0.95.**
- **The picker render (`art/ui/brand/renders/picker/tradie-ute.png`) is the old model's** until `tools/vehicles/view/capture.mjs --heroes` is run.
- **The sheet's canopy has struts and chrome frame corners** that the model carries only as atlas paint.

## Not covered

- **A Ute-only close-up in a live round.** The host captures are the synthetic mixed grid.
- **jj-sim roster/handling banks and jj-procgen** beyond `tradie_ute` tests: CI runs them on these commits.
- **Real phones and a real TV.**
- **The owner's verdict on recognisability.**
- **Re-deriving the owner's Triton photos' silhouette comparison** (br-bwju.8's 0.717 against a photo outline): superseded by the sheet comparisons above, not re-run.

# Pig Catcher

**How these images were made.** Playwright Chromium, headless, on eris, at the bakes in commit 3f1d0400, with the same tools as the other cars; the host captures and `render.json` are the real host page's synthetic mixed grid. Sheets and ladders composed on the Mac. These are not a real TV or phone. Every image named below was opened and looked at. All of them are in `pig-catcher/`.

**Method.** The Pig Catcher already had its two sheets (`art/vehicles/pig-catcher/refs/`), so none were generated. `model.js` was rewritten on the bike kit with lofted bodies, plates, decor ranges the colliders skip, and detail gates per LOD; `opt.mjs` (hubs, tyre width and fork pinned, now honoured for bikes) tuned the numbers between hand fixes. "Before" is the br-bwju.5 bake scored against the same sheets.

## Looked at

- `pig-catcher/ladder-lod0.png`, `pig-catcher/ladder-lod1.png`, `pig-catcher/ladder-lod2.png`: the sheet crop, the br-bwju.5 bake (before), this bake (after), painted the sheet's yellow, in front, front 3/4, side, rear 3/4, rear and top (the sheet has no rear 3/4). Raw sheets: `pig-catcher/ladder-before-raw.png`, `pig-catcher/ladder-after-raw.png`.
- `pig-catcher/reference-lod0/sheet.png`, `pig-catcher/reference-lod1/sheet.png`, `pig-catcher/reference-lod2/sheet.png`: reference crop, shaded model and silhouette diff per view; `iou.json` has the numbers; `before-br-bwju.5/` the old sheets.
- `pig-catcher/views.png`, `pig-catcher/lods.png`, `pig-catcher/paints.png`, `pig-catcher/paints-strip.png`: every side at every LOD and six paints. The plastics, tank and mudguards take the seat colour; the guards, crash bar, rack, rope, sack, rider and tyres keep theirs.
- `pig-catcher/colliders.png`: one hull per part; the hand guards stay outside the hulls.
- `pig-catcher/damage-strip.png`, `pig-catcher/damage-strip-overview.png`: all ten states (front and back loose or detached, rider thrown, wheel off, stripped frame).
- `pig-catcher/grid-1.png`, `pig-catcher/grid-4.png`, `pig-catcher/grid-24.png` (viewer) and `pig-catcher/host-grid-1.png`, `pig-catcher/host-grid-4.png`, `pig-catcher/host-grid-24.png`: the real host page with every roster car four times. Bikes are small in it; the blue Pig Catcher in `pig-catcher/host-grid-1.png` shows spoked wheels, the rope and sack.

## What the model now shows that it didn't

| Part | Before | Now |
|---|---|---|
| Tank and shrouds | A thin box and two sticks | A lofted tank and radiator shrouds as one yellow mass, with a pointed lower front spike |
| Wheels | 12-sided black discs with a grey face | 20-facet tyres with 20 tread blocks, a rim ring, 16 wire spokes, hub, front brake disc, rear sprocket |
| Front end | Box plate, two plain lamps | Number plate with a headlamp, a crash bar carrying two octagon spotlights, beaked mudguard on stays, forks with gaiters |
| Bars | A bar with thin guards | Grips, levers and wide black hand guards |
| Rear | A plank rack, plain prism rope | A railed rack with legs, a banded rope coil, a hessian sack with neck and tie, tail lamp on a lofted mudguard |
| Exhaust | A grey tube | A dark silencer with two silver wraps and a silver tip, header pipes |
| Engine and frame | One grey box | Cases, clutch covers, cylinder head, skid plate, cradle and subframe, swingarm both sides, chain, shock |
| Rider | Blocky, narrow | Thicker arms, jeans, boots with soles, gloves, helmet with peak, goggle frame and chin bar |

At LOD1 and LOD2: LOD1 keeps the loft shapes, guards, spotlight lenses on the housing caps and the rack rails; LOD2 has octagon wheels with a dark flat face, a single guard bar, and simple boxes.

**Silhouette IoU (weighted; side 0.4, top 0.3, front 0.15, rear 0.15):**

| LOD | Before | After |
|---|---|---|
| LOD0 | 0.8432 | 0.8371 |
| LOD1 | 0.8375 | 0.8261 |
| LOD2 | 0.8270 | 0.7985 |

LOD0 per view: side 0.906 to 0.894, top 0.831 to 0.827, front 0.805 to 0.777, rear 0.739 to 0.765.

**Triangles:** LOD0 1056 to 2736 (qualified 3000, vehicle.json asks 2800); LOD1 900 to 884; LOD2 592 to 588.

**Host render cost** (`render.json`; 24 synthetic cars, four Pig Catchers, 1920x1080):
- 1 tile: 87,794 to 101,234 triangles per frame; the four LOD0 bikes' scene triangles 4,224 to 10,944.
- 4 tiles: 106,868 to 106,548. 24 tiles: 534,348 to 532,748 (LOD1 and LOD2 are slightly smaller than before).
- Draw calls unchanged: 90, 228 and 1148.

## Defects found and fixed

1. **Spokes were invisible.** They sat inside the solid tyre; they now stand on the tyre's faces.
2. **Pivots differed per LOD.** The front clamp (LOD1 and LOD2) and the rack legs (LOD0) set different hinge edges; both are now consistent at every LOD, so the pivot tests pass.
3. **LOD1 was 1604 and LOD2 836 triangles.** Gated down to 884 and 588.
4. **A flat yellow plate hung in front of the fork** (the number plate reached down to the mudguard); its bottom is now at 1.16 m.
5. **Hand guards stuck out of the top view and were angled the wrong way;** now flat plates just ahead of the bars, shortened.
6. **The side panel and the sack hung too low and too tall;** raised and trimmed.
7. **The optimiser pinched the forks into one blob;** forks are pinned and `opt.mjs` now honours `pinned` for bikes.

## Remaining defects

- **Weighted IoU is below the old bake at every LOD** (0.837 at LOD0) and well short of the skill's ~0.95. The sheet's gains are detail, not outline; thin parts (guards, crash bar, spokes, lug dashes) cost pixels, and the sim's pinned wheels and the sheet's perspective cap the fit. Front 0.777 is the weakest view.
- **LOD2 front and rear IoU fell** (0.70 and 0.69): legs and shoulders are single limbs.
- **The sheet's engine is more complex** (cooling fins, a silver header sweep, a rear shock spring) than the model's boxes.
- **Fork gaiters and the front brake line are simplified;** the rope coil is smooth bands, not rope.
- **The picker render (`art/ui/brand/renders/picker/pig-catcher.png`) is the old model's** until `tools/vehicles/view/capture.mjs --heroes` is run.
- **The bike is tiny in host captures;** nothing close-up in a live round was captured.

## Not covered

- **A Pig Catcher close-up in a live round.** The host captures are the synthetic mixed grid.
- **jj-sim handling banks and jj-procgen** beyond the `bikes`, `roster` and pig `handling` tests; CI runs the rest.
- **Real phones and a real TV.**
- **The owner's verdict on recognisability.**

# Postie Bike

**How these images were made.** Playwright Chromium, headless, on eris, at commit ed68cce1 (the bakes in this commit), with the same tools as the other cars:
- `tools/vehicles/fit` for the reference comparisons;
- `tools/vehicles/view` for the turntables, LODs, paints, colliders and the before/after ladders;
- `tools/vehicles/evidence` for the damage strips, paint strip and viewer grids;
- the real host page (synthetic mixed grid, ANGLE/Vulkan on eris's RTX 2080 Super) for `host-grid-*.png` and `render.json`.

Sheets and ladders were composed on the Mac. These are not a real TV or phone. Every image named below was opened and looked at. All of them are in `postie-bike/`.

## Looked at

- `postie-bike/ladder-lod0.png`, `postie-bike/ladder-lod1.png`, `postie-bike/ladder-lod2.png`.
  - The sheet crop, then the br-bwju.5 bake (before), then this bake (after), in the viewer's cyan.
  - Views: front, front 3/4, side, rear 3/4, rear and top. The sheet has no rear 3/4 view, so that row has no reference.
  - The raw sheets are `postie-bike/ladder-before-raw.png` and `postie-bike/ladder-after-raw.png`.
- `postie-bike/reference-lod0/sheet.png`, `postie-bike/reference-lod1/sheet.png`, `postie-bike/reference-lod2/sheet.png`.
  - Per view: the reference crop, the shaded model and the silhouette diff, with the IoU numbers.
  - `postie-bike/iou.json` has the before and after numbers; `postie-bike/before-br-bwju.5/sheet-lod0.png`, `postie-bike/before-br-bwju.5/sheet-lod1.png` and `postie-bike/before-br-bwju.5/sheet-lod2.png` are the old sheets.
- `postie-bike/views.png`, `postie-bike/lods.png`, `postie-bike/paints.png`, `postie-bike/paints-strip.png`.
  - Every side at every LOD, and six paints. The shield, floor, body, mudguards and tail block take the seat colour; the postal-red panniers, hi-vis vest, parcels, tyres, chrome and lamps keep theirs.
- `postie-bike/colliders.png`: one hull per part. They are the br-bwju.5 hulls, unchanged; the wider panniers, bars, mirrors and helmet sit outside them.
- `postie-bike/damage-strip.png`, `postie-bike/damage-strip-overview.png`: all ten states; front, back and rider swing about their hinges, a wheel and the rider come off. The viewer draws the bike small in these two strips.
- `postie-bike/grid-1.png`, `postie-bike/grid-4.png`, `postie-bike/grid-24.png` (viewer).
- `postie-bike/host-grid-1.png`, `postie-bike/host-grid-4.png`, `postie-bike/host-grid-24.png`.
  - The real host page with every roster car four times. Tile 1 follows a Postie from behind (panniers with parcels, rail, tail lens, twin mufflers, mirrors); the four-tile capture follows four Posties.

**What the model now shows that it didn't.** Compare the before and after columns of `postie-bike/ladder-lod0.png`:

| Part | Before | Now |
|---|---|---|
| Leg shield and floor | A thin raked wedge and a flat grey floor | A bent shield with bowed facets that flares to the floor, a chunky floor wedge in body paint with rubber pads under the boots |
| Wheels | 12-sided tyres with thin silver spokes | 24-sided lugged tyres, open on both sides, with four black diameters (eight spokes) and a grey hub |
| Fork and lamp | A bare fork and a small cylinder | Silver upper sleeves over black lowers; an octagon lamp with a silver rim and cream lens on the head tube |
| Bars | A straight bar with tiny round mirrors | Swept silver bars, black grips, octagon mirrors with pale glass on stalks, as wide as the sheet's |
| Front mudguard | A thin arc | A faceted arc with side skirts that stand out past the tyre |
| Carrier | A box on a plate | A silver wire frame (top and bottom loops, four posts, stays) round a red mail tub with a lighter lip and three tilted parcels |
| Panniers | Two solid red boxes | Open-top boxes with a lighter lid ring, a dark cavity and four tilted parcels with tape strips and label marks |
| Tail | A small lamp box and a mudguard | A rounded silver grab rail, a tail block in body paint with a red brake cap and a hex lens, a plate bracket and a flicked mudguard tail |
| Exhaust | One floating muffler | Twin hex mufflers with header pipes, dark bores and rear shocks |
| Rider | A dark visor, a plain vest, stick limbs | A faceted white helmet with a grey lower ring, a face behind a clear visor frame, a hi-vis vest with bands and stripes, puffy blue sleeves, skin forearms, black gloves, navy shorts and tall boots on the pads |

At LOD1 and LOD2:
- Both keep the paint-key body, the panniers with a parcel on each, the carrier tub, the rider and the twin mufflers (6-sided).
- LOD1 has a plain 12-sided tyre with a hub, the carrier's top rail, mirrors, one parcel in the basket and two per pannier.
- LOD2 has a 12-sided tyre, a single lamp prism, no mirrors or rail, and a single flat-lit rider.

**Silhouette IoU (weighted), the same masks and camera on both sides** (see below):

| LOD | Before | After |
|---|---|---|
| LOD0 | 0.7999 | 0.8576 |
| LOD1 | 0.7502 | 0.8446 |
| LOD2 | 0.685 | 0.7838 |

Per view at LOD0:

| View | Before | After |
|---|---|---|
| Side | 0.7571 | 0.8495 |
| Top | 0.8866 | 0.8456 |
| Front | 0.7931 | 0.8683 |
| Rear | 0.7473 | 0.8928 |

Under the old masks and the Cruz camera the br-bwju.5 bake scored 0.8126 / 0.7605 / 0.6742 at LOD0 / 1 / 2.

**Triangles:**
- LOD0: 1180 to 2782 (qualified budget 3000; the Postie asks for 2900).
- LOD1: 882 to 894.
- LOD2: 568 to 586.

**Host render cost** (`render.json`; 24 synthetic cars, four of them Posties, 1920x1080):
- 1 tile: 101,234 to 114,050 triangles per frame. That is +12,816: each of the four LOD0 Posties has 1,602 more triangles (2,782 against 1,180), and the scene draws each in two passes.
- 4 tiles: 106,548 to 106,788 (+240). The tiles are drawn at LOD1 and LOD2.
- 24 tiles: 532,748 to 533,948 (+1,200).
- Draw calls are unchanged: 90, 228 and 1,148.

## Defects found and fixed

1. **The mask had no helmet top.** The white helmet on the grey backdrop fell below the segmenter's threshold, so every "before" number was against a rider with the top of his head cut off. `refs/sheets.json` now patches the helmet in with ellipses (`extract.mjs`).
2. **The evaluator's camera was the Cruz's.** The sheet is a level, far render; the 10 m camera with an 8 degree look-down stretched the model's height and under-scored front and rear. `sheets.json` now sets `camD` 30 and `tilt` 0 (front 0.70 to 0.84, rear 0.77 to 0.83 on the same model).
3. **The mudguards hid inside the tyres.** They were narrower than the tyre, so the solid LOD1 and LOD2 tyres swallowed their skirts. They stand out past the tyre now.
4. **The front part's top moved at LOD2.** A 4-sided lamp has no vertex at the top, so the front's hinge line (its top edge) dropped 3 cm below LOD0's. LOD2 is one 6-sided prism at the same height.
5. **The optimiser flattened the look.** It shrank the carrier to a shallow tray, thinned the rail and the muffler and moved the muffler up; those four were put back by hand (the carrier a little shallower than the sheet's).

## Remaining defects

- **The weighted IoU is 0.858, short of the ~0.95 target.** Thin parts (wire carrier, rail, mirror stalks, spokes) are dropped from both masks, the optimiser trades the plan view for side and rear, and the sheet's own proportions (wider bars and panniers, a bigger head) differ from the sim's bike.
- **The top view is worse than before** (0.887 to 0.846): the sheet's plan is perspective-stretched at the rear and front, and the new model is wider at the rail and arms.
- **The wheels are the sim's** (0.4 m front, 0.36 m rear); the sheet's tyres are about 0.37 m.
- **The rider's face is a flat skin block** behind a visor frame; the sheet's visor is a clear shield over the whole face.
- **The sheet's carrier sits higher and shallower in the mask** than the model's deep wire frame; the model keeps the deep frame because the sheet's picture shows it.
- **The damage strips draw the bike small** (the viewer frames cars, not bikes).
- **The scenario bank's off-road-climb fails**, as it already did at HEAD.

## Not covered

- **A Postie-only close-up in a live round.** The host captures are the synthetic mixed grid (tile 1 and the four-tile capture do follow Posties).
- **Rust behaviour tests beyond the scenario bank and the jj-sim roster and bikes tests** (run on CI).
- **`tools/vehicles/review/check.mjs` and `build.mjs --check`** need the spikes' evidence tree; CI runs them on the evidence commit.
- **Real phones and a real TV.**
- **The owner's verdict on recognisability.**
