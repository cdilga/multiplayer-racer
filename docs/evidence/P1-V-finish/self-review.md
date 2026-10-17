# P1-V-finish self-review (br-bwju.11): Lion President

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
