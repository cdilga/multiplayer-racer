# P1-V-au-hawk self-review, round 2 (br-bwju.12): the rebuilt AU Hawk against its new sheets, the roster and the recognition bar

**How these images were made.** Playwright Chromium, headless, on eris (`tools/vehicles/fit`, `view`, `evidence` and `recognition`,
software GL; the chase views from a web build of this commit through ANGLE/Vulkan on the RTX 2080 Super). Not a TV or phone. Every
image named below was opened and looked at. The bake is bd5b41dd's (2586 / 888 / 596 triangles).

**The honest summary.** The car is now a literal, rounded AU: big swept teardrop lamps, the oval fish-mouth grille with its bar and a
blank oval badge, a high round roof, round flanks, corner tail lamps and a boot badge. At LOD0 a minimal vision model names it an AU
Falcon from the front, both front 3/4s, the rear 3/4 and the rear (14 of 15 calls across three runs). At LOD1, LOD2 and in the
chase view it is named a Falcon in roughly half the views or fewer, and from the side and top rarely (`recognition.md`). The
recognition bar is met at LOD0 and NOT met at LOD1, LOD2 or in the chase view.

## Looked at

- `reference-lod0/sheet.png`, `reference-lod1/sheet.png`, `reference-lod2/sheet.png` (with `score.json`): sheet crop, shaded model and
  silhouette diff per view. Weighted IoU LOD0 0.9602 (side 0.963, top 0.976, front 0.916, rear 0.966), LOD1 0.9545, LOD2 0.9535.
  - Red (sheet only) runs down both sides of the front view at every LOD: the sheet's front view is drawn about 9 % wider than its
    plan view, and the model follows the plan.
  - The side view's green (model only) at the boot: the wing was removed and the deck raised (recognition, below).
- `views.png`, `lods.png`, `paints.png`, `paints-strip.png`, `colliders.png`: every side at every LOD, six paints, one hull per part.
  - Body and bumpers take every paint; glass, lamps, grille, badges, black mirrors, silver rims and tyres keep their colour.
  - On the white paint the pale lamps nearly vanish into the body (`paints.png`, `#f2f4f8`).
- `damage-strip.png`, `damage-strip-overview.png`: intact, loose and detached for every part; dark bays behind missing panels.
- `grid-1.png`, `grid-4.png`, `grid-24.png` (viewer): six paints, the lamps and tail lamps read at 24 tiles; the badges do not (too small).
- `recognition/lod0-front.png` ... `recognition/lod2-top.png` (21) and `chase/chase-1.png` ... `chase/chase-4.png`: what the model was shown.
- `control-hawk-dash/` (25): the control.
- `side-by-side-front34.png`, `side-by-side-front.png`, `side-by-side-side.png`, `side-by-side-rear34.png`, `au-vs-hawk-dash.png`:
  the AU is the only roster car with no wing, no livery, no bull bar and big pale lamps; it is the roundest body in the roster.
- `hero/hero.png` = `art/ui/brand/renders/picker/au-hawk.png` (the lobby picker picture).

## Defects found and fixed

- The recognition camera cut the 5 m car's nose off at 3/4 views (`recognition/` round-2 first pass): `view.js` now fits each car's
  box to the frame (the control re-rendered with it).
- Headlamp decals were speckled with body showing through (cells sinking on the curved corner) and had black flecks from a dark rim
  decal under them: the rim decal is gone and the lamps lift 2.4 cm.
- A top-projected lamp tail dropped long shards down the guard's side: top decals now keep only upward-facing skin.
- A black square in the rear-door glass at LOD0 (a planar pane sinking through the non-planar greenhouse quad): panes are cut at mid-span
  and mid-height at LOD0, and lifted further at LOD1.
- The sheet's wing on posts read as a ute's tray and tailgate, and the WRX's wing (recognition): removed; the boot deck raised.
- The pivot test failed at LOD2 (the flank without the belly point was 3 cm narrower than LOD0's door skin): the flank top keeps the
  full width at LOD2. 47 of 47 tools/vehicles tests pass.
- LOD1/LOD2 over budget after the lamp and fog changes: coarser tail-lamp cells, six-sided wheels and no mid-door ring at LOD1, no fog
  lamps at LOD2.

## Remaining defects

- **Recognition at LOD1, LOD2 and in the chase view is under the 90 % bar** (`recognition.md`); the measured cause is the body's
  roundness, which needs about 1400 / 900 triangles at LOD1 / LOD2 (owner's call on the budgets).
- Side and top views are rarely named a Falcon (`recognition/lod0-side.png`, `recognition/lod0-top.png`).
- A thin orange sliver crosses the front-door glass near the A pillar at LOD0 (`reference-lod0/sheet.png`, shaded side).
- LOD1 headlamps are blockier than LOD0's, with a stepped tail over the guard (`lods.png`, LOD1 3/4).
- Pale lamps on the white paint (`paints.png`).
- The hull grew with the body: 5.03 m long, 2.04 m wide (was 4.74 x 2.0); the profile's geometry is synced, the tuning untouched.

## Not covered

- A real device, WebKit, a TV; the 24-seat mixed grid in the real host (the grids are the viewer).
- Any recognition model other than `claude-haiku-5-5` at low effort.
- `cargo test -p jj-sim --test feel` fails on `roster-burnout-au-hawk declares no baselines`: the tuning commit's fixture (e25caa44),
  independent of the geometry; handed back to the tuning work.
