# br-bwju.3 self-review: Hawk Dash and Lion President

**How these images were made:** Playwright Chromium, headless, software GL, on the Mac (Apple M1 Pro), 2026-10-16. Built from this
commit's bakes. The tools:
- `tools/vehicles/fit` for the reference comparisons;
- `tools/vehicles/view` for the turntables, LODs, paints and colliders;
- `tools/vehicles/evidence` for the damage strips, paint strips and grid tiles;
- the design site's own Vehicles pages (`art/ui/poc/vehicles/`), served from the repo.

These are not the host renderer, a real TV or a real phone. Every image named below was opened and looked at.

## Looked at

**Hawk Dash** (`hawk-dash/`):
- `hawk-dash/reference-lod0/sheet.png`, `hawk-dash/reference-lod2/sheet.png`: per view, the reference crop, the shaded model and the silhouette diff.
  - Weighted IoU: 0.964 at LOD0, 0.956 at LOD2.
  - Long, low sedan; long bonnet with the bulge and vents.
  - Front: the hexagonal grille and swept lamps.
  - Rear: wrap-around tails and quad exhausts.
- `hawk-dash/views.png`, `hawk-dash/lods.png`: every side at all three LODs.
  - The twin stripes cross the bonnet, roof, boot and the nose and tail faces.
  - The side "C" stripe reads.
  - LOD2 keeps the stripes, grille and tails.
- `hawk-dash/paints.png`, `hawk-dash/paints-strip.png`: white plus seat colours. Tyres, glass and lamps stay neutral.
- `hawk-dash/damage-strip.png`, `hawk-dash/damage-strip-overview.png`: all ten states, with dark bays behind missing panels.
- `hawk-dash/colliders.png`: one convex hull per part, close to the body.
- `hawk-dash/grid-1.png`, `hawk-dash/grid-4.png`, `hawk-dash/grid-24.png`: a striped V8 sedan at every size.

**Lion President** (`lion-president/`):
- `lion-president/reference-lod0/sheet.png`, `lion-president/reference-lod2/sheet.png`: weighted IoU 0.935 at LOD0, 0.941 at LOD2.
  - Black roof, bonnet nostrils, fang lamps, the split lower grille and air curtains.
  - The tall wing on posts, and the full-width tail lamp on a black band.
- `lion-president/views.png`, `lion-president/lods.png`, `lion-president/paints.png`, `lion-president/paints-strip.png`, `lion-president/damage-strip.png`, `lion-president/damage-strip-overview.png`, `lion-president/colliders.png`, `lion-president/grid-1.png`,
  `lion-president/grid-4.png`, `lion-president/grid-24.png`: the same set as the Hawk's.
  - At grid-24 the Lion is told apart from the Hawk by its wing, black roof and tail band.

**The design site** (served from the repo at `art/ui/poc/vehicles/`, no page errors):
- `vehicles-index.jpg`: four cars: Hawk Dash and Lion President (2026-10-16, Awaiting review), then Cruz Missile and Tradie Ute. "Turn it" spins the Hawk at 1140 tris, 11 draws.
- `hawk-review.jpg`, `lion-review.jpg`: all seven items. Item 7, the spec twin, shows the two cars side by side with the shared spec.

## Defects found and fixed

1. **Hawk headlamps stood up as "horns" above the bonnet.** The fitted nose slope is only about 7 cm tall, and the lamps had been placed
   on it. Lamps, upper slot and grille now sit on the nose face, sized to the nose width.
2. **Hawk corner lamp slots and grille were wider than the narrowed nose.** They are now sized relative to it.
3. **Door seams stood off the body.** On both cars they ran above the side wall (and down into the front arch), reading as poles. They now
   stop at the flat side wall.
4. **The Lion read as a low coupe with a stubby wing.** The optimiser had traded height for IoU. Fixed by:
   - raising the body 6 cm and re-fitting;
   - setting the wing back near the reference's height (it costs 0.007 IoU);
   - adding penalties to `opt.mjs` for an overhanging greenhouse and a sunken crown.
5. **The bake crashed on any car without the Cruz's bull bar** (`tools/vehicles/bake.mjs`, collider filter). Fixed.

## Remaining defects

- **Stripes and pinstripes are fringed.** The paint key's filtered edges are untinted grey: at grid-24 the Hawk's black stripes read
  light grey, and the Lion's gold pinstripe reads cream. This is renderer-wide (the Cruz's slashes show it too) and is filed as
  **br-vhtm**, with the fix (a premultiplied paint mask).
- **The Lion's silhouette IoU is 0.935, short of the ~0.95 target.**
  - The reference's lower front is boxier and wider than the shared lofted body allows.
  - The tall wing is kept for identity.
- **Lion details:** the calipers read as small red squares, and LOD2's flat scoop decals are partly clipped by the faceted bonnet.
- **Hawk nose:** its centre sits 10 cm below its corners (the beak between the lamps). It reads as intended, but it isn't in the reference.
- **The review pages' boilerplate** calls the reference "the owner's reference sheet". These sheets were generated; each page's note says so.

## Not covered

- **The host renderer in a real round.** Roster plumbing (br-bwju.7) draws any roster car. The roster's mixed-host hash and the
  `v-roster-mixed` journey run in CI on this commit, but I didn't capture these two cars in a live round.
- **Rust roster tests run only in CI.** These are `jj-sim` `tests/roster.rs` (build and drive every car from its own profile) and the
  `jj-wasm-host` mixed-roster hash. The shared tree holds another worker's uncommitted profile-schema change (R136 handling), so a local
  build tests their schema, not HEAD's.
- **Handling feel.** The V8 spec (rear drive, 1700 kg) is a first cut. Feel is the R136 handling work's to judge, and R123's balance
  measures speed and launch per car on real maps (br-bwju.6).
- **Engine sounds.** The V8 profiles pass the validator. Nobody has listened to them.
- **Real phones and a real TV.** Playwright Chromium only. Owner verdicts on the review pages come back as bug beads.
