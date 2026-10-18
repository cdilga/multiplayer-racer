# P1-V-au-hawk self-review (br-bwju.12, part 1): the AU Hawk against its contact sheet and against every roster car

**How these images were made.** Playwright Chromium, headless, on eris (`tools/vehicles/fit`, `view`, `evidence` and the new `recognition` tools, software GL; the chase views from the real host page through ANGLE/Vulkan on the RTX 2080 Super). Not a TV or phone. Every image named below was opened and looked at. The bake is the one committed with this file (2612 / 876 / 574 triangles).

**The honest summary.** The model is a clean, contract-valid, silhouette-accurate roster car (IoU about 0.95 at every LOD) with an AU-style face. It does not read as an AU Falcon to a small unprompted vision model (0 of 25, `recognition.md`), and next to its own reference sheet it is visibly cruder: the sheet's rounded flanks and smooth bonnet become slab doors and a faceted nose. The recognition item and the "bubbly" look are NOT met; the rest of part 1 is.

## Looked at

- `reference-lod0/sheet.png`, `reference-lod1/sheet.png`, `reference-lod2/sheet.png`: per view, the sheet crop, the shaded model and the silhouette diff, with the IoU numbers (`score.json` beside each).
  - LOD0 0.9489 (side 0.956, top 0.943, front 0.925, rear 0.967); LOD1 0.9468; LOD2 0.9450.
  - The diff shows the model matching the outline everywhere except the front view's lamp pods and mirrors (red = sheet only).
- `views.png`, `lods.png`, `paints.png`, `paints-strip.png`, `colliders.png`.
  - Every side at every LOD, six paints, one convex hull per part.
  - Body, pods, bumpers, mirrors and spoiler take every paint; glass, lamps, rims and tyres keep their colour.
- `damage-strip.png`, `damage-strip-overview.png`: all ten states, parts swing on their hinge lines with dark bays behind missing panels.
- `grid-1.png`, `grid-4.png`, `grid-24.png` (viewer): the car at the three tile sizes.
- `recognition/lod0-front.png` ... `recognition/lod2-top.png` (21 renders) and `chase/chase-1.png` ... `chase/chase-4.png` (the in-game chase view): the images the vision model was shown.
  - The chase views are rear views (the camera is behind the car): in the host's comic look the car shows its wrap tail lamps, the chrome bar, the spoiler and two tail pipes.
- `control-hawk-dash/` (the same 25 views of the Hawk Dash): the control.
- `side-by-side-front34.png`, `side-by-side-front.png`, `side-by-side-side.png`, `side-by-side-rear34.png`: all seven roster cars, same camera and same orange.
- `au-vs-hawk-dash.png`: the AU and the Hawk Dash it must not be mistaken for, four views each.
- `../../../art/ui/brand/renders/picker/au-hawk.png`: the lobby picker picture (`tools/vehicles/view/capture.mjs --sheet hero`).

## What tells the AU apart

- **Against every roster car** (`side-by-side-front34.png`, `side-by-side-side.png`): it is the only one with no livery, no wing and no bull bar; a plain body-colour sedan with a tall greenhouse, a bonnet dome and a lip spoiler. The Cruz Missile has its paint-slash livery and big wing, the Lion President a black roof and a wing, the Tradie Ute a canopy and rack, the two bikes riders.
- **Face** (`recognition/lod0-front.png`, `views.png` LOD0 front): a lamp pod on each guard with a big and a small round lamp, a wide black slatted grille between them, white indicator rectangles at the bumper ends and a plain black lower intake. The Hawk Dash has a hexagonal grille, swept narrow lamps, bonnet vents and twin stripes (`au-vs-hawk-dash.png`).
- **Rear** (`recognition/lod0-rear.png`, `chase/chase-2.png`): wide wrap tail lamps with a white reverse section joined by a chrome bar, a small body-colour lip spoiler, two small tail pipes. The Hawk Dash has angular lamps, a big wing and quad pipes.
- **Wheels and stance**: silver five-spoke rims against the Hawk Dash's black ones, and a 0.365 m sim wheel under a taller body (the Hawk Dash's is 0.40 m).

## Defects found and fixed

- Headlamp decals were speckled with holes and, on the first pass, needles stuck out of the nose corners: the lamps are now real caps on half-ellipsoid pods (`recognition/lod0-front-left.png` is clean), bays moved inside the shoulder.
- Black slivers along the shoulder (the bay walls poking through the shoulder chamfer): fixed (`views.png` shows none).
- The spoiler floated above the boot and the pods' rims poked outside the guards: both pulled in.
- Pivot test failure (the bonnet dome ran behind the front cut line): fixed, 47 of 47 tools/vehicles tests pass.
- LOD1 and LOD2 were over budget after adding lamp detail: coarser decal cells, lamp rings and indicators only at LOD0.

## Remaining defects

- **Not recognised as an AU Falcon** by the unprompted model (`recognition.md`): 0 of 25; named a Holden Commodore in most. This is the owner's first acceptance bar and it is open.
- **Not bubbly enough**: compare `reference-lod0/sheet.png` (smooth, rounded, a real bonnet crease) with the shaded model beside it (faceted, slab doors, a pointed nose). The generated sheet is a better car than the 3000-triangle build; a rounder body needs more lofts or a higher LOD0.
- Lamp pods read as lumps at 3/4 views (`recognition/lod0-front-left.png`): the lamps are small beside the sheet's.
- A faint orange spur at the front-left pod in rear 3/4 views (`recognition/lod0-rear-left.png`).
- LOD2 drops the second lamp, slats, indicators and chrome bar (`lods.png`); the grille is a dark block.
- Side and top views carry no make cue at all (`recognition/lod0-side.png`, `recognition/lod0-top.png`).
- The body-colour mirrors and the roof number need a check at 24 tiles in the host (`grid-24.png` is the viewer, not the host).

## Not covered

- Part 2 of br-bwju.12: the burnout and doughnut tuning, the speed 5-10 % under the Cruz, the measured scenarios, the engine sound (`assets/audio/engine/au-hawk.json`; until then the car uses the Cruz Missile's engine voice). The profile is the Hawk Dash's tuning with this car's geometry.
- The real host with the AU in a 24-seat mixed grid and on a phone or TV: only the one-tile chase (`chase/`) was captured there.
- The AU on a real device, in WebKit, or through the lobby picker in a live room (the picker image exists, the picker itself was not opened).
- Any recognition model other than `claude-haiku-5-5` at low effort.
