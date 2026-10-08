# Self-review P1-M04 (Town)

Captured with `JJ_CHROMIUM_GPU=1 node web/host/tests/biome-capture.mjs town` on eris: headless Chromium 151 over ANGLE/Vulkan on the
RTX 2080 Super (`capture.json` names the renderer), game commit a8e902f (run `bc-r10-8`), the real host page
(`?test=live&room&res=1&autores=off&recipe=town`, in-world look on), the procgen worker's town track for seed 2, fake
controllers through the real join path, autopilot cars stepped to the chosen place. The street shots pick a straight with
buildings on both sides and a water tower ahead; the junction shot stops 20 m before the rule-placed direction sign.
`four-biome-lap-town-tv-1080p.jpg` and `four-biome-run-in-domes-tv-1080p.jpg` are the town in the real four-biome track
(the second is P1-R10's run-in capture). Validator and plot: `JJ_EVIDENCE_DIR=... cargo test -p jj-procgen --test biomes` on eris.
Reference: the generated town biome reference (`art/references/australia/generated/`). Independent reviews: `fresh-eyes-round2.md` (FAIL, round 2;
round 1's FAIL is in git history) and `fresh-eyes.md` (round 3, PASS).

## Looked at
- `street-tv-1080p.jpg` (1920x1080, 1 player): a straight street with false-front shops (lettered signboards, corrugated verandahs on posts, green dados) on both sides, corrugated-roof houses behind, red- and yellow-lid wheelie bins and mailboxes at the kerb, a pole with sagging wires, clumped gums, the water tower and the race gantry down the street.
- `street-tiles-1080p.jpg` (4 tiles): the street from the lead car; a real crash into a building in another tile (sparks and flash); the gantry from behind it.
- `street-laptop-1366.jpg`, `street-phone-915x412.jpg`, `street-phone-412x915.jpg`: the same street at laptop and phone-host sizes; nothing clipped.
- `junction-sign-tv-1080p.jpg`: the green "A1 PRINCES HWY / ADELAIDE 380 / MELBOURNE 640" direction sign and a kangaroo warning sign at a side street (a flush pad with a give-way line), bins, the water tower behind.
- `four-biome-lap-town-tv-1080p.jpg`: houses both sides, bins, a kangaroo warning sign, poles with wires, the water tower ahead.
- `four-biome-run-in-domes-tv-1080p.jpg`: the run-in through town to the gantry, the Olgas domes on the horizon.
- `plot-town.png` (key: orange houses/shopfronts, grey side streets, white power-line spans at their reach, yellow wayfinding, green trees, magenta signs, blue other incl. water towers): frontage rows on both sides of the straights, none on corners.
- `validator-town.txt`: ten seeds validate; 255 houses, 160 shopfronts, 27 side streets (junctions), 167 yellow-lid bins out (red-lid bins are their own piece).

## Defects found and fixed
- Round 1 review (FAIL): no building in the hero frame (buildings 6-9 m back, a bend). Shopfronts now at the footpath and houses 4.6-6.2 m back, both denser; the capture picks a straight with frontage both sides.
- Houses and shopfronts rebuilt (weatherboard, gable, chimney, lean-to verandah on posts, false front with a lettered board, green dado); the side street is flush with a give-way line; a far dome rule that never placed anything was removed.
- Round 2 review (FAIL: "an outback roadside strip"): corrugation ridges on every roof and verandah; gums are a forked pale trunk under an open crown of clumps; a red-lid general-waste bin (`town/bin-red`, a prop like `generic/bin`) beside the yellow-lid one; the water tower every 110-180 m behind the frontage, and the hero shot prefers a view with one; sign backs carry mounting rails, post clamps and a folded lip (M09's kit); the junction shot moved clear of the start gantry's truss.

## Remaining defects
- Minor, from the passing review: the verge is bare dirt (no tussocks or a distinct packed-dirt strip); shopfronts are identical (playtest scope: one parametric shopfront); the water tower is a plain grey drum; the side-street pad reads as a slab from low angles; the domes show only where the Rocks segment is in view.
- The road colour is the map renderer's dark tarmac, not the reference's pale grey-pink.

## Not covered
- A real TV or phone, WebKit, full-screen toggle and resize (the biome has no layout of its own; the tile grid is R04's).
