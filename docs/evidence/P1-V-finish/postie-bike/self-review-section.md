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
  - `postie-bike/iou.json` has the before and after numbers; `postie-bike/before-br-bwju.5/sheet-lod0.png`, `sheet-lod1.png` and `sheet-lod2.png` are the old sheets.
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
