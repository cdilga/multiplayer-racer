# br-bwju.5 self-review: Postie Bike and Pig Catcher

**How these images were made:** Playwright Chromium, headless, software GL, on the Mac (Apple M1 Pro), 2026-10-16. Built from this
commit's bakes. The tools:
- `tools/vehicles/fit` for the reference comparisons;
- `tools/vehicles/view` for the turntables, LODs, paints and colliders;
- `tools/vehicles/evidence` for the damage strips (its new bike sequence), paint strips and grid tiles;
- the design site's own Vehicles pages (`art/ui/poc/vehicles/`), served from the repo.

These are not the host renderer, a real TV or a real phone. Every image named below was opened and looked at.

## Looked at

**Postie Bike** (`postie-bike/`):
- `postie-bike/reference-lod0/sheet.png`: weighted IoU 0.813 (side 0.829, top 0.900, front 0.701, rear 0.706).
  - It reads as the reference: leg shield, front carrier with the mail tub, two postal-red panniers stacked with parcels, round
    mirrors, and the rider in a white open-face helmet and hi-vis vest.
- `postie-bike/reference-lod2/sheet.png`: 0.674. The reference's spoked wheels on the lowest sheet aren't filled in its mask, so the
  model's solid octagon wheels count as extra (side 0.534).
- `postie-bike/views.png`, `postie-bike/lods.png`: all sides at three LODs. LOD2 keeps the mail tub, a parcel a side and the panniers.
- `postie-bike/paints.png`, `postie-bike/paints-strip.png`: the leg shield, side covers and mudguards take the seat colour. The
  panniers, vest and parcels keep theirs, so it reads as a postie in any colour.
- `postie-bike/damage-strip.png`, `postie-bike/damage-strip-overview.png`: ten states, with the rider loose and thrown, front and back
  hanging, and a wheel off.
- `postie-bike/colliders.png`: one convex proxy per part.
- `postie-bike/grid-1.png`, `postie-bike/grid-4.png`, `postie-bike/grid-24.png`: red panniers and the orange vest read even at
  grid-24.

**Pig Catcher** (`pig-catcher/`):
- `pig-catcher/reference-lod0/sheet.png`: 0.843 (side 0.906, top 0.831, front 0.805, rear 0.739).
  - A tall trail bike on long forks, with the beaked mudguard, a black light bar with two spots, the sack and rope on the rack, and
    the rider on the pegs in a green MX helmet.
- `pig-catcher/reference-lod2/sheet.png`: 0.827.
- `pig-catcher/views.png`, `pig-catcher/lods.png`, `pig-catcher/paints.png`, `pig-catcher/paints-strip.png`,
  `pig-catcher/damage-strip.png`, `pig-catcher/damage-strip-overview.png`, `pig-catcher/colliders.png`, `pig-catcher/grid-1.png`,
  `pig-catcher/grid-4.png`, `pig-catcher/grid-24.png`: the same set.
  - Next to the Postie it's told apart by its height, its narrow side-on shape and the rider standing up.

**The design site** (served from the repo, no page errors):
- `vehicles-index.jpg`: six vehicles, the two bikes first (2026-10-16, Awaiting review).
- `postie-review.jpg`, `pig-review.jpg`: every Vehicles-contract item.
  - Item 3 lists the bike parts: front, back, rider, wheel_F and wheel_R with their hinges.
  - Item 7 says they're not spec twins.

## Defects found and fixed

1. **The bike masks were wrong at first.** The car rules dropped the white helmet, silver racks and parcels. The 5 px opening and
   "largest component" cut off the front wheel and fork, and the car's view windows cut the bike sheets in the wrong places. Fixed with
   per-car settings in `refs/sheets.json` (`segment.bright`, `open`, `keep` and the windows), read by both the extractor and the fit
   page.
2. **The Postie's LOD1 tyres dipped 2 cm below the ground.** A 10-sided tyre has no flat facing straight down. `jj validate` caught it
   (origin-ground). The kit now refuses side counts that aren't multiples of 4.
3. **The Postie's LOD2 back hinge sat above the part.** LOD2 had no parcels, so the panniers' top dropped below the hinge line measured
   at LOD0. LOD2 now keeps a parcel a side and drops the exhaust and grips instead.
4. **LOD2's front basket was a solid grey block.** It's now just the mail tub.
5. **The panniers were first raised clear of the rear wheel.** The reference has them over the top of it; set back.
6. **The renderer would have drawn a bike's rear wheel mirrored and at the front wheel's size.** It treated `wheel_R` as a car's right
   wheel. Only a car's paired wheels now share a type.
7. **The Pig Catcher's optimiser lifted the rider's hip above the pivot rule's lower half.** Set back near the measured height.
8. **The review check demanded doors.** A bike's damage groups are front, back, rider and wheels.

## Remaining defects

- **Bike silhouette IoU** is 0.81 (Postie) and 0.84 (Pig Catcher), short of the cars' ~0.95.
  - Thin forks, frames and arms make the masks ambiguous.
  - The front and rear views are the weakest.
- **Postie:** the leg shield reads as a thin raked plank from the side, and the exhaust sits low like a skid.
- **Pig Catcher:**
  - the engine is a plain box;
  - the side shroud plates cross the fork line as an "X";
  - the beak mudguard is a single slab;
  - the rope coil hides behind the sack in most 3/4 views;
  - LOD2's spots are 4-gons.
- **The paint-key fringe (br-vhtm)** shows on the bikes' swatch edges too, less than on the striped cars.
- **The kit's rider torso has a fixed width.** The Pig Catcher adds its own shoulder yoke.

## Not covered

- **The bikes aren't roster rows yet, so they can't be picked or driven.** Their profiles exist, synced from the bakes and tuned from
  the two-wheel fixture with gains rescaled to these bodies. But the shared tree holds the R136 handling schema change uncommitted, so
  the sim tests that every roster vehicle runs can't be run honestly here: the R122 handling bank, the fun launch/speed test and the
  mixed roster. The roster rows and those tests follow when it lands, and this bead stays open until then.
- **Engine sounds:** the two profiles pass the validator. Nobody has listened to them.
- **The host renderer in a real round**, real phones and a real TV: Playwright Chromium only.
