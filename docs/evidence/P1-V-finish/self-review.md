# P1-V-finish self-review (br-bwju.11): Lion President, Hawk Dash

**How these images were made.** Playwright Chromium, headless, on eris, at commit 54a30978 (the bakes in this commit):
- `tools/vehicles/fit` for the reference comparisons;
- `tools/vehicles/view` for the turntables, LODs, paints, colliders and the before/after ladders;
- `tools/vehicles/evidence` for the damage strips, paint strip and viewer grids;
- the real host page (synthetic mixed grid, ANGLE/Vulkan on eris's RTX 2080 Super) for `host-grid-*.png` and `render.json`.

These are not a real TV or phone. Every image named below was opened and looked at. All of them are in `lion-president/`.

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
