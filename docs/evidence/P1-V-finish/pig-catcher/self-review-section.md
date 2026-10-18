# Pig Catcher

**How these images were made.** Playwright Chromium, headless, on eris, at the bakes in commit 3f1d0400, with the same tools as the other cars; the host captures and `render.json` are the real host page's synthetic mixed grid. Sheets and ladders composed on the Mac. These are not a real TV or phone. Every image named below was opened and looked at. All of them are in `pig-catcher/`.

**Method.** The Pig Catcher already had its two sheets (`art/vehicles/pig-catcher/refs/`), so none were generated. `model.js` was rewritten on the bike kit with lofted bodies, plates, decor ranges the colliders skip, and detail gates per LOD; `opt.mjs` (hubs, tyre width and fork pinned, now honoured for bikes) tuned the numbers between hand fixes. "Before" is the br-bwju.5 bake scored against the same sheets.

## Looked at

- `pig-catcher/ladder-lod0.png`, `pig-catcher/ladder-lod1.png`, `pig-catcher/ladder-lod2.png`: the sheet crop, the br-bwju.5 bake (before), this bake (after), painted the sheet's yellow, in front, front 3/4, side, rear 3/4, rear and top (the sheet has no rear 3/4). Raw sheets: `ladder-before-raw.png`, `ladder-after-raw.png`.
- `pig-catcher/reference-lod0/sheet.png`, `reference-lod1/sheet.png`, `reference-lod2/sheet.png`: reference crop, shaded model and silhouette diff per view; `iou.json` has the numbers; `before-br-bwju.5/` the old sheets.
- `pig-catcher/views.png`, `pig-catcher/lods.png`, `pig-catcher/paints.png`, `pig-catcher/paints-strip.png`: every side at every LOD and six paints. The plastics, tank and mudguards take the seat colour; the guards, crash bar, rack, rope, sack, rider and tyres keep theirs.
- `pig-catcher/colliders.png`: one hull per part; the hand guards stay outside the hulls.
- `pig-catcher/damage-strip.png`, `pig-catcher/damage-strip-overview.png`: all ten states (front and back loose or detached, rider thrown, wheel off, stripped frame).
- `pig-catcher/grid-1.png`, `grid-4.png`, `grid-24.png` (viewer) and `pig-catcher/host-grid-1.png`, `host-grid-4.png`, `host-grid-24.png`: the real host page with every roster car four times. Bikes are small in it; the blue Pig Catcher in `host-grid-1.png` shows spoked wheels, the rope and sack.

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
