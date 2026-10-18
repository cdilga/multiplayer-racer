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
  - `tradie-ute/iou.json` has the before and after numbers; `tradie-ute/before-br-bwju.8/sheet-lod0.png`, `sheet-lod1.png` and `sheet-lod2.png` are the old sheets.
- `tradie-ute/views.png`, `tradie-ute/lods.png`, `tradie-ute/paints.png`, `tradie-ute/paints-strip.png`.
  - Every side at every LOD, and six paints. The tray and cab take the seat colour; the black canopy sides, bull bar, flares, rack, glass, lamps and tyres keep theirs.
- `tradie-ute/colliders.png`: one hull per part; the mirrors, snorkel and other decoration stay outside the hulls.
- `tradie-ute/damage-strip.png`, `tradie-ute/damage-strip-overview.png`: all ten states; parts swing about their hinges, with dark bays behind the missing panels.
- `tradie-ute/grid-1.png`, `tradie-ute/grid-4.png`, `tradie-ute/grid-24.png` (viewer). At grid-24 the canopy, rack and tall tray lamps tell it apart from the sedans.
- `tradie-ute/host-grid-1.png`, `tradie-ute/host-grid-4.png`, `tradie-ute/host-grid-24.png`.
  - The real host page with every roster car four times. The followed car is not a Ute in any of them; `host-grid-4.png` has a blue Ute's tray lamps and canopy back in the top-right tile. They show the mixed grid draws cleanly, not the Ute up close.

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
