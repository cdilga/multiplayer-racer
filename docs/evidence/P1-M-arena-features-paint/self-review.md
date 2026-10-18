# Self-review P1-M-arena-features-paint (br-qb0l): arena jumps read as ramps on the TV

**What changed.** Renderer only (`web/host/src/render/map/relief.ts`, wired in `map.ts`). A derby arena's jumps are terrain
relief that the map marks as bare rock; they were painted by the terrain's nearest-sample rule, so a rotated jump was a dark
patch with stair-stepped edges. Now each jump is recovered from the heights as the field built it (`fitJump`: the smallest
box round its rock samples gives the orientation; the axis with the gentler faces is the ramp axis; a line fitted to the
samples on each face gives its foot and crest; the height is the field's 0.1 m snap) and painted in its own frame, so every
paint edge is a straight line: the ramps and table in the race jumps' tan, the side slopes a darker skirt, and the last metre
up to the table at either end an ink lip band (the race jumps' convention, br-gw74.13.1.1.1). Each face is lit by its own
plane's normal and hill-shaded in one flat step against the sun, so a 12 degree ramp facing the sun reads lighter and one
facing away darker from the 60 degree Overview. Mounds and dips keep the floor paint but are lit by the heightfield's smooth
normal, so the toon band edge curves round them instead of flipping facet by facet into a stepped patch. Only the paint and
the shading normals change: each triangle is split along straight lines in its own plane, so the drawn surface is the
sim's. The sim's surface lookup, the maps and the arena goldens are untouched (no Rust change). The fitted jumps are data
(R90): `__jjRender.map().relief` (frame, feet, lips, sides, table, slopes, height); `relief-live.json` has the live room's.
Race tracks keep the nearest-sample paint (the painter is built only for a map with a `bowl`).

Captures: Chromium (Playwright) on eris, GPU (ANGLE/Vulkan, RTX 2080 Super), real jj-server, `host?room&test=live&mode=derby`
with bots and one phone (Davo, 915x412 Playwright mobile emulation, not a real phone) joined through the join page; test pages
use session seed 1, so before and after are the same arena. `m10-*` and `r11-*` are those journeys' own stills.

## Looked at

- `before-tv-overview-8-1920x1080.jpg` (before, TV Overview, 8 cars): the two jumps are dark rotated patches with
  stair-stepped edges; nothing says ramp.
- `before-tv-grid-8-1920x1080.jpg` (before, Davo's chase tile, from P1-M-arena-features): a table-top is a flat dark patch
  with a sawtooth outline.
- `tv-overview-8-1920x1080.jpg`, `tv-overview-8-later-1920x1080.jpg` (after, Overview, 8 cars, 6 s and 14 s in): each jump is
  a straight-edged tan pad with two ink lip bands across it bracketing the table, a lit skirt on the sun side and a dark one on
  the far side; it reads as ramp, lip, table, lip, ramp at whole-bowl scale. The dips are smooth dark ovals, no steps.
- `tv-overview-24-1920x1080.jpg`, `tv-overview-24-later-1920x1080.jpg` (after, Overview, 24 cars): three jumps, all straight
  and bracketed; the plates and the takedown banner sit over them without hiding them.
- `tv-grid-8-t1-1920x1080.jpg` (after, Davo's chase tile, 8 cars): a table-top ahead: the lit tan up-ramp face, the ink lip
  at the crest, the table, and the darker side skirt on the right; straight edges, reads as a ramp from the chase camera.
- `tv-grid-24-1920x1080.jpg`, `tv-grid-24-t6-1920x1080.jpg` (after, Grid, 24 cars): Davo on the bank and in a pile-up; the
  floor reads clean, no stepped patches; nothing broken.
- `r11-derby-grid-6-tiles-1920x1080.jpg` (the r11 journey's Grid after the switch, six chase tiles): tile 2 shows a jump
  across the floor as a tan pad with its lip bands.
- `r11-derby-overview-24-1920x1080.jpg` (the r11 journey's 24-car Overview): jumps bracketed, the island, every car.
- `m10-bowl-8-1920x1080.jpg`, `m10-bowl-32-1920x1080.jpg` (the m10 journey's whole-bowl harness camera on the committed
  arenas, seed 11): every jump painted (two and five), straight-edged with lips, beside the island or spine.
- `before-race-grid-4-1920x1080.jpg`, `race-grid-4-1920x1080.jpg` (a generated race track, Davo's chase tile, before and
  after): identical; the race terrain keeps its nearest-sample paint.
- `bank-shadow-steps-grid-8-1920x1080.jpg` (see Remaining defects).

## Defects found and fixed

- First pass painted by height contours and classified each facet by its slope: the edges were still ragged and the table
  turned into an ink blob (the 1.25 m grid's crease facets mix ramp and table slopes). Replaced with the per-jump frame fit,
  which paints straight lines.
- The fit's cross axis was taken from the other box axis with the opposite sign when the ramp axis was the box's second one:
  a jump's side came out 15 m wide and another jump was left unpainted (seen on the m10 32-car bowl). The cross faces are now
  fitted along the frame's own cross axis, and each foot is held to within a sample spacing of the outermost jump sample.
- A bare-rock sample a fit missed would still draw as a stepped rock patch: rock on the floor outside every fitted jump now
  draws as floor (none do on the committed arenas; the m10 journey asserts every floor rock sample is inside a painted jump).
- Dips and mounds showed as small stair-stepped dark patches in the Overview (the toon ramp's mid band flipping facet by
  facet on their slopes): lit by the heightfield's smooth normals now; they read as smooth ovals.
- `m10-bowl` failed on the current branch before this change ("no rock inside the bowl"): P1-M-arena-features put the
  island inside the bowl by design. Fixed forward: the island (squat rocks wholly inside the floor) is allowed and asserted
  present, every other rock still outside and never over the floor.

## Remaining defects

- The bowl's bank shows a light/dark edge in regular stair steps up its slope (`bank-shadow-steps-grid-8-1920x1080.jpg`, and
  the left and right rims of `tv-overview-8-1920x1080.jpg`); present before this change. Not the terrain paint: smooth ring
  normals on the bowl and sinking the ground under the bank 5 cm both left it unchanged (tried and reverted), so most likely
  the sun's shadow-map texels on the wall's cast shadow. Filed as br-pmam.
- The jump fit reads the heights, not the field's own parameters (the map doesn't carry them): it relies on the field's
  shapes (a box footprint, ramps gentler than sides). A future relief kind of another shape would need its own painter; the
  m10 assertions (slopes, ordering, every rock sample covered) would catch a misfit on the committed arenas.
- The table and ramps share the tan; the table reads by its two lip bands rather than its own colour.

## Not covered

- A real phone and Safari/WebKit; a real TV (the captures are 1920x1080 Chromium screenshots).
- 32 cars live on the TV (the m10 journey's 32-car bowl covers the paint at that size from the harness camera).
- A chase shot of a car mid-air over a jump: the live captures' Davo drives where the scrum takes him; the jump-ahead chase
  view is `tv-grid-8-t1-1920x1080.jpg`.
