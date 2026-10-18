# P1-V-au-hawk self-review, rounds 2 and 3 (br-bwju.12): the AU Hawk against its sheets, the roster and the recognition bar

**How these images were made.** Playwright Chromium, headless, on eris (`tools/vehicles/fit`, `view`, `evidence` and `recognition`,
software GL; the chase views and `render.json` from web builds through ANGLE/Vulkan on the RTX 2080 Super). Not a TV or phone. Every
image named below was opened and looked at. The bake is this commit's: 2906 / 896 / 600 triangles on the standard 3000 / 900 / 600
budgets (round 3's raised LOD1/LOD2 were measured and reverted).

**The honest summary.** The car is a literal, rounded AU: big swept teardrop lamps (with grey reflector bowls), the oval fish-mouth
grille with its bar and a blank oval badge, round fog lamps, a high round roof, round flanks, corner tail lamps and a boot badge.
Its LOD0 front 3/4 and rear 3/4 views read as an AU Falcon to a minimal vision model most of the time in good windows; LOD1, LOD2,
the side, the top and the in-game chase view don't reliably; and the model's answers on identical images drift from run to run
(33/45 to 12/45). So recognisability is the owner's call (`recognition.md`; the "AU Hawk" row in
docs/playtests/owner-checklists.md section 2).

## Looked at

- `reference-lod0/sheet.png`, `reference-lod1/sheet.png`, `reference-lod2/sheet.png` (with `score.json`): sheet crop, shaded model and
  silhouette diff per view. Weighted IoU LOD0 0.9600 (side 0.963, top 0.976, front 0.916, rear 0.964), LOD1 0.9538, LOD2 0.9533.
  - Red (sheet only) runs down both sides of the front view at every LOD: the sheet's front view is drawn about 9 % wider than its
    plan view, and the model follows the plan.
  - The side view's green (model only) at the boot: the wing was removed and the deck raised (recognition, below).
- `views.png`, `lods.png`, `paints.png`, `paints-strip.png`, `colliders.png`: every side at every LOD, six paints, one hull per part.
  - Body and bumpers take every paint; glass, lamps, grille, badges, black mirrors, silver rims and tyres keep their colour.
  - On the white paint (`#f2f4f8`) the lamps read by their grey reflector bowls; before round 3 the pale lens vanished.
- `damage-strip.png`, `damage-strip-overview.png`: intact, loose and detached for every part; dark bays behind missing panels.
- `grid-1.png`, `grid-4.png`, `grid-24.png` (viewer): six paints, the lamps and tail lamps read at 24 tiles; the badges do not (too small).
- `recognition/lod0-front.png` ... `recognition/lod2-top.png` (21) and `chase/chase-1.png` ... `chase/chase-4.png`: what the model was shown.
- `control-hawk-dash/` (25): the control.
- `side-by-side-front34.png`, `side-by-side-front.png`, `side-by-side-side.png`, `side-by-side-rear34.png`, `au-vs-hawk-dash.png`:
  the AU is the only roster car with no wing, no livery, no bull bar and big pale lamps; it is the roundest body in the roster.
- `hero/hero.png` = `art/ui/brand/renders/picker/au-hawk.png` (the lobby picker picture).
- `render.json`: the host's triangles, draws and frame times at 1 / 4 / 24 tiles, three runs with the round-2 bake ("before") and three with round 3's raised LOD1/LOD2 ("after", since reverted).

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
- Round 3: the thin orange sliver across the LOD0 front-door glass: the side glass was laid on a bilinear patch over a twisted span
  (behind the windscreen base); it now lies on the greenhouse's own two triangles per span (`reference-lod0/shade_side.png`).
- Round 3: pale lamps vanishing on white paint: a mid-grey reflector bowl in each lamp. A blue-grey lens and a dark outline were
  tried first; both turned the front views from Falcon to Mondeo/Focus in their runs.
- Round 3: LOD1 lamps broken into pieces with body showing through: lifted 3 cm (kept after the revert).
- Round 3, reverted: LOD1/LOD2 raised to 1396 / 892 with LOD0's round body; interleaved, LOD1 was named a Falcon 9/35 against 15/35
  at 888 triangles, for +7.1 % host triangles at 24 tiles. Back on 900 / 600; the per-vehicle budget override was removed.

## Remaining defects

- **The automated recognition bar (90 % at every LOD and angle, chase included) is not met** and the measure drifts; the owner's
  verdict decides (`recognition.md`).
- LOD2 has no tumblehome (its flanks are flat) and a coarse grille (`lods.png`, LOD2 3/4); LOD1 keeps the round body at coarser stations.
- Side and top views are rarely named a Falcon.
- The hull is 5.03 m long, 2.04 m wide (round 1: 4.74 x 2.0); the profile's geometry is synced, the tuning untouched.

## Not covered

- A real device, WebKit, a TV; the 24-seat mixed grid in the real host (the grids are the viewer).
- Any recognition model other than `claude-haiku-5-5` at low effort.
