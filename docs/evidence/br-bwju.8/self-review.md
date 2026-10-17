# br-bwju.8 self-review: Tradie Ute, the owner's Triton (canopy, real rack, dual cab)

Owner review, 2026-10-11: "keep the rear canopy and the actual roof rack, and dual cab. It's close though! But it looks just a
little too generic right now."

## How it was captured

- **Machine and browser:** MacBookPro18,3, Playwright Chromium headless with software GL. These are the bake viewer
  (`tools/vehicles/view`) and `docs/evidence/br-bwju.8/tools/run.mjs`, not the host renderer. No in-game pass yet: the car is
  drawn by the same instanced path br-bwju.7 proved for br-bwju.2's model.
- **References:**
  - The owner's seven photos (triton-reference.zip on eris). They stay private because they show the number plate and the house.
  - The owner's Triton mesh.
  - The side photo's outline, hand-traced on a 25 px grid; it is the only part of the photos in the repo.
- **Review page:** captured from a local server, giving `ute-review.jpg`.

## Looked at

- **The photos, all seven (private).** They show:
  - A black flat-top aluminium canopy over a flat steel tray, wider than the cab. Its upper door spans the length; two lower doors
    each have a round lock. There are checker-plate under-tray boxes and mud flaps.
  - A black platform rack with a wind deflector over the windscreen, and a rolled Darche-style awning on the left (in the nose-left
    photos).
  - The MQ front: a chrome-slatted trapezoid grille, chrome sweeps under swept headlights, and a tall blunt bonnet.
  - A black steel bull bar with a hoop, a light bar, round fog lamp holes and a yellow winch hook.
  - A snorkel on the right A-pillar (in the nose-right photos), a lift, black wheels with a machined lip, and checker-plate side
    steps.
- **`views.png`** (front, rear, both sides, top and both three-quarters), with each cue above where the bead names it:
  - The canopy is `back`.
  - The rack, deflector and awning are `core`.
  - The grille, sweeps, headlights and bull bar are `front`.
  - The snorkel is `core`, on -X (right).
  - The checker-plate boxes are the back's flanks in the atlas.
  - The dual cab's four doors are unchanged.
- **`lods.png`:**
  - LOD1 keeps the canopy, the grille slats and the awning, with the rack as one platform.
  - LOD2 keeps the canopy and the rack platform.
  - The wheels are silver hexagons on black tyres.
- **`reference-photo/sheet.png`:** LOD0's side against the photo outline, IoU 0.717.
  - The tray, canopy and rack line up.
  - The remaining red is the photo's taller cab glass and snorkel, plus perspective.
  - The remaining green is the caricature's lower sills.
- **`reference-lod0/sheet.png`:** against the Triton mesh, weighted 0.759 (side 0.738, top 0.804, front and rear 0.742). The canopy
  block now matches the mesh's canopy (br-bwju.2 left it out). The front and rear green is the roster's deliberate extra width.
- **`damage-strip.png`, `damage-strip-overview.png`:** "back (tray) detached" now drops the tray and canopy together. Doors swing on
  their front edges, and there are dark bays.
- **`paints.png`, `paints-strip.png`:** white plus five player colours on the body and canopy lid. The canopy sides, tray, bar,
  rack, glass, lamps and tyres keep their colours.
- **`grid-1.png`, `grid-4.png`, `grid-24.png`:**
  - At 24 tiles every car's seat colour reads from the chase cam.
  - In grid-1, the canopy doors, locks, checker-plate boxes, snorkel, steps and silver-lipped wheels all read.
- **`ute-review.jpg`:** the review page.
  - Item 1 shows the mesh compare table and sheet, with the photo sheet behind "The reference sheet itself".
  - Item 2's turntable opens on the new front: grille slats, bull bar, light bar, fog lamps, plate, winch hook.
  - The LOD table passes: 1250 / 828 / 592 of 1300 / 900 / 600, 11 draws.
  - No page errors.

## Defects found and fixed

1. **The snorkel was put on the wrong side,** then put back. I first read the nose-right side photo as the car's left. Seen from its
   left side, a car's nose points left, so that photo is the right side and the snorkel sits on the driver's (right) A-pillar, as
   br-bwju.2 had it. The awning is on the left (the nose-left photos).
2. **The nose was a low sedan wedge, the main cause of "generic".** The bonnet's front sat below the top of the wheels, against the
   photo's tall blunt MQ front. The bonnet line was raised 0.30 m at the nose and the body lifted 8 cm over the wheels.
   - That moved the IoU against the photo outline from 0.678 to 0.717.
3. **The grille slid onto the bonnet slope** when the nose rose, so it read as a thin strip. It now sits on the fascia below the
   bonnet edge, as the MQ's tall trapezoid with its chrome sweeps.
4. **The canopy was shorter than the photo's,** whose canopy is as tall as the rack. Raised to 2.04 m.
5. **The wheels read as silver stars** (pentagon on pentagon). They are now flat discs: a silver lip ring under a black centre. That
   is also cheaper, at 67 rather than 76 tris a wheel.
6. **LOD2's wheels were solid black lumps,** worse than br-bwju.2's remaining defect. They now carry a silver hexagon.
7. **From the chase cam the Ute read as a black box.** The canopy hid the seat colour (grid-24). The canopy's lid now carries the
   seat colour; the sides and rear stay black like the owner's.
8. **The hi-vis livery wasn't the owner's car.** Removed: the paint is plain, and the hi-vis bumper corners are now black.
9. **Detail pass, 2026-10-17 (BrownHill).** Each plain panel now carries the owner's Triton's own detail. Every addition is
   atlas or UV only, so the triangles stay 1250 / 828 / 592 and the bake is reproducible (`bake.mjs --check`).
   - **Canopy sides:** the upper doors' T-handles and gas struts, a louvred vent, the drip rail, chrome corner protectors, and
     amber (front) and red (rear) reflectors.
   - **Canopy back:** a rear door with a tinted window, a T-handle and a third brake light (emissive). It has its own atlas
     region; it used to be a flat black swatch.
   - **Canopy lid:** the seat colour with tie-down rails along its edges. It has its own atlas region and is pure white
     elsewhere, so the tint survives the mipmaps (thin ribs I tried first blended the white away and the lid went untinted at
     a distance: `paints.png`, `grid-24.png`).
   - **Cab sides:** door handles, the chrome shoulder line, the J-line down the cab's back and along the sill, the black
     rocker, and the front guard's repeater.
   - **Bonnet:** washer jets and the cowl vent.
   - **Tray:** taller combination lamps.
   - **Owner's correction:** I tried a hi-vis livery and bonnet stripes against the Cruz's livery density, then dropped them
     when the owner clarified that the "filler" was the picker's silhouettes (br-bwju.10). The paint stays plain, as on their car.
   - `ute-before-after-views.png`: the 2026-10-16 bake above, this one below.

## Remaining defects

- **The J-line isn't modelled.** The owner's car has a tray body, so the factory tub's J-line sweep isn't on it; the photos show a
  straight cab back. Recorded as not applicable rather than added.
- **The roof bag** in some photos isn't modelled. It's a load, not the car.
- **The canopy lid in the seat colour departs from the photos,** chosen for identity (R108). It's the owner's call on the review
  page.
- **The roof number shows only between the rack's end slats.** The rack covers the rest of the roof.

## Not covered

- **The host renderer and a real TV.** These are viewer captures; the in-game draw path is unchanged since br-bwju.7.
- **The owner's look on the review page** is AC4 (ev:owner), and comes back as bug beads.
- **Handling feel.** The profile is synced and jj-sim's Ute tests pass (validation.md); feel is the Feel Lab's.
