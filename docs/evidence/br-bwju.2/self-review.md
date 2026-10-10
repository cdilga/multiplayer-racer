# br-bwju.2 self-review: Tradie Ute

Captures: headless Playwright Chromium 151 (software GL), the bake viewer (`tools/vehicles/view`) and
`docs/evidence/br-bwju.2/tools` (`run.mjs`). Not the host renderer: the host draws exactly one hard-wired vehicle today.
Every image below was opened and looked at.

## What I looked at, and what I changed

- `views.png`, `lods.png`: reads as a dual-cab tray ute from every side: bonnet with hi-vis stripes, bull bar with light bar,
  snorkel up the driver's A-pillar, roof rack, side steps, tray with walls, headboard, toolbox and a rolled swag, tail lamps.
  LOD1 loses steps, rack, load and the light bar; LOD2 loses the snorkel, mirrors become boxes and tyres are 8-gons. It stays
  recognisable as a ute at LOD2. Changed after the first look: the LOD1 budget (974 > 900) by dropping steps, rack and load there.
- `reference-lod0/sheet.png`: against the owner's Triton mesh the side silhouette (IoU 0.757) matches the long bonnet,
  cab and tray steps. The reference's roof bag and canopy stand out (red) and the model's wider stance and tyres stand out (green).
  Left as is: it is a caricature, and the canopy would hide the tray, which is the part the game breaks off.
- `damage-strip.png`, `damage-strip-overview.png`: doors swing out about the front edge, bonnet and tray hang from their top edge,
  detached bonnet, door, tray and wheel lie on the ground, the stripped shell shows dark bays and the cabin and boot blocks.
  Weak point: the strip is small (ten cars across 2000 px); labels are legible only in the overview. Not worth a rework.
- `paints-strip.png`: white plus five player colours: paint takes the tint, the hi-vis stripes, glass, lamps, bumper and tyres keep
  their colour. The tray's inside and roof take the tint too.
- `grid-1.png`, `grid-4.png`, `grid-24.png`: legible at 100 px per car: the roof stripes, tray and bull bar read.
  The roof number is not drawn by the viewer, so its legibility between the rack rails is untested.

## Honest gaps

- Not seen in the real host renderer, the lobby picker or a round: the game cannot select or draw a second vehicle yet.
- The hi-vis livery is a quick data-drawn atlas, not art-directed.
- Engine sound is the Cruz's profile retuned by data (lower revs, slow shifts); nobody has listened to it.

## Roster plumbing (not done: larger than a few hundred lines)

Added (data and a constructor only): `assets/profiles/tradie-ute.json`, `VehicleProfile::tradie_ute()` in
`crates/jj-sim/src/profile.rs`, `assets/audio/engine/tradie-ute.json` and its manifest line (plus the regenerated POC mirror).
`web/shared/src/roster.json` is untouched on purpose: a lobby row for a car the round cannot drive would be a lie. What the game needs:

1. `jj-sim`: `Sim::new` takes one `VehicleProfile` for every car. Per-car profiles (a profile per `CarId`, chosen from the seat's `Pick{vehicle}`),
   which touches spawn, the wheel order, damage-part records and the snapshot.
2. `jj-wasm-host` `host.rs`: `profile: VehicleProfile::cruz()` is one field for the whole host; it needs a vehicle id to profile table
   (the compiled-in JSONs) and the pick carried into the world build.
3. `jj-protocol`: the snapshot's car record needs a vehicle id (or index) so the renderer knows which model each car is.
4. `web/host/src/render/vehicles/vehicles.ts` and `synthetic.ts` import the Cruz sidecar and GLBs statically; they need a per-vehicle
   model registry with one instanced set per vehicle, and `PART_IDS` per vehicle.
5. `web/host/src/audio/engine.ts` `DEFAULT_PROFILE`, `web/host/src/tuning/panel.ts` `PROFILE_FILE` pin the Cruz.
6. `web/shared/src/roster.json` row (id `tradie-ute`, art, stats) and a car-sheet image (`web/controller/src/app/carsheet.ts`).

## Checks that exist

`node tools/vehicles/bake.mjs --check art/vehicles/tradie-ute`, `jj validate` on the sidecar and the profile,
`node --test tools/vehicles/test/` (16), `cargo test -p jj-sim --test tradie_ute` (4),
`cargo test -p jj-procgen --test handling_ute` (2: the R122 bank on the ute), `node tools/vehicles/review/check.mjs`.
