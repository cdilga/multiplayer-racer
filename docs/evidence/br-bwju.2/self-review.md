# br-bwju.2 self-review: Tradie Ute

**Model captures** (the bake viewer `tools/vehicles/view`, and `docs/evidence/br-bwju.2/tools/run.mjs`):
- Headless Playwright Chromium, software GL.

**In-game captures:** br-bwju.7 (roster plumbing, closed) made the game select and draw a second vehicle. Its deployed
recapture shows the Ute in a real round:
- Playwright Chromium against `https://jammers-preview.dilger.dev/p/v02-a1f7bf4b/`.
- Recaptured on eris, 2026-10-15.

**Published pages:** captured from the Mac on 2026-10-16 with Playwright Chromium.
- The design site's Vehicles section: https://jammers-preview.dilger.dev/poc/vehicles/
- The Ute's review page: `review.html?v=tradie-ute`

Every image below was opened and looked at.

## Looked at

**The model, from `docs/evidence/br-bwju.2/`:**
- `views.png`, `lods.png`: a dual-cab tray ute from every side. It has a bonnet with hi-vis stripes, a bull bar with a
  light bar, a snorkel up the driver's A-pillar, a roof rack, side steps, a walled tray with a headboard, toolbox and
  swag, and tail lamps.
  - LOD1 drops the steps, rack, load and light bar.
  - LOD2 drops the snorkel, the mirrors become boxes and the tyres are plain octagons.
  - It's still a ute at LOD2.
- `reference-lod0/sheet.png`: the side silhouette against the owner's Triton mesh (IoU 0.757) matches the long bonnet,
  cab and tray steps. The reference's canopy and roof bag aren't modelled, on purpose: the tray is the part that breaks
  off.
- `damage-strip.png`, `damage-strip-overview.png`, ten states:
  - Doors swing out about their front edge; bonnet and tray hang from their top edge.
  - A camber state.
  - Bonnet, door, tray and wheel detached and lying on the ground.
  - A stripped shell with dark bays and the cabin and boot blocks.
- `paints-strip.png`: white plus five player colours. The paint takes the tint; stripes, glass, lamps, bumper and tyres
  keep theirs.
- `grid-1.png`, `grid-4.png`, `grid-24.png`: legible at ~100 px a car. The roof stripes, tray and bull bar read.

**In the game:**
- `docs/evidence/br-bwju.7/deployed-frames/tv-mixed-two-cars-1280x720.jpg`: the Ute as seat #2 (blue) racing beside
  the Cruz in a real round. Cab, tray walls, toolbox, tail lamps and the seat pattern on the paint all read from the
  chase camera, and the roof number "2" shows.
- `docs/evidence/br-bwju.7/deployed-frames/tv-tuning-ute-1280x720.jpg`: the owner tuning panel switched to
  `tradie-ute`, with the Ute driving in both tiles.
- `docs/evidence/br-bwju.7/deployed-frames/tv-mixed-grid-12-1920x1080.jpg`: 12 cars in the overview, Utes among the
  Cruzes, each under its name tag.
- `docs/evidence/br-bwju.7/deployed-frames/phone-picker-ute-844x390.jpg`: the phone's vehicle picker shows
  "TRADIE UTE · WORK HORSE" with its stats bars and a seat-coloured silhouette.

**Published:**
- `vehicles-index.jpg`: the Vehicles section lists Cruz Missile and Tradie Ute, both "Awaiting review", with
  "Turn it here" and "Full review page".
- `ute-review.jpg`: the Ute's page opens on item 1, "Reference against model", with the per-view IoU table and the
  silhouette diff. No page errors.

## Defects found and fixed

1. **LOD1 over budget** (974 > 900 tris) in the first bake. Fixed by dropping the steps, rack and load at LOD1; the
   bake is now 1216 / 870 / 594 against budgets of 1300 / 900 / 600.
2. **The self-review lacked the gate's sections** and said the Ute had never been seen in the host. Rewritten here
   with the in-game frames, which br-bwju.7's plumbing now provides.

## Remaining defects

- **LOD2 tyres are featureless octagons.** At grid-24 size, the LOD2 rear tyre in the yellow and orange columns of
  `grid-24.png` reads as a heavy dark lump below the sill. It's minor at that distance; a hub disc at LOD2 would fix
  it if the owner flags it.
- **The damage strip is small:** ten cars across 2000 px. The labels are legible only in the overview.
- **The hi-vis livery is a quick data-drawn atlas**, not art-directed.

## Not covered

- **Engine sound:** the Cruz's profile retuned by data (lower revs, slow shifts). Nobody has listened to it.
- **The roster's balance across maps** is br-bwju.6.
- **Handling:** the R122 bank (`cargo test -p jj-procgen --test handling_ute`) and `cargo test -p jj-sim --test
  tradie_ute` are in `validation.md` and `handling-bank.txt`. The feel since R127/R128 (launch, arcade handling) is the
  Feel Lab's to judge.
- **Real phones and a real TV:** Playwright Chromium only. The owner's verdict on the review page comes back as bug
  beads.
