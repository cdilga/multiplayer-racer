# Self-review P1-M04 (Town), third pass after the fresh-eyes FAIL

Captured with `JJ_CHROMIUM_GPU=1 node web/host/tests/biome-capture.mjs town` on eris: headless Chromium 151 over ANGLE/Vulkan on
the RTX 2080 Super (`capture.json` names the renderer), game commit a32f959, the real host page (`?test=live&room&res=1&autores=off&recipe=town`,
in-world look on: R10 landed), the procgen worker's town track for seed 2, fake controllers through the real join path, autopilot
cars stepped until the lead car reaches the chosen place. The street shots pick a straight with buildings on both sides ahead; the
junction shot stops 25 m before the rule-placed direction sign. `four-biome-lap-town-tv-1080p.jpg` is the town in the real
four-biome track (`biome-capture.mjs playtest`). Validator and plot: `JJ_EVIDENCE_DIR=... cargo test -p jj-procgen --test biomes` on eris.
Reference: `art/references/australia/generated/biome-town.png`. The independent review is `fresh-eyes.md`.

## Looked at
- `street-tv-1080p.jpg` (1920x1080, 1 player): a straight street; false-front shopfronts with lettered signboards and verandahs on posts on both sides, gable-roofed weatherboard houses behind, mailboxes at the kerb, a power pole with sagging wires on the right, gums, the race gantry down the street. Reads as a country town main street.
- `street-tiles-1080p.jpg` (4 tiles): the lead car's tile is the street; the others are further back on the lap (corner chevrons and rail); bins and houses in the lower tiles.
- `street-laptop-1366.jpg` (1366x768): the same street; nothing clipped.
- `street-phone-915x412.jpg`, `street-phone-412x915.jpg` (phone as host): the street reads at phone size, both orientations.
- `junction-sign-tv-1080p.jpg`: the green "PRINCES HWY / ADELAIDE 380 / MELBOURNE 640" direction sign and a yellow kangaroo warning sign at a side street (now a flush pad with a give-way line), shopfronts both sides, bins. The finish gantry's truss passes over the camera at the top edge here (the start is just behind).
- `four-biome-lap-town-tv-1080p.jpg`: in the real four-biome lap: houses with verandahs both sides, green/yellow wheelie bins at the kerb, a kangaroo warning sign, two poles with wires, a billboard frame.
- `plot-town.png` (key: orange houses/shopfronts, grey side streets, white power-line spans and posts at their reach, yellow wayfinding, green trees, magenta signs, blue other): frontage rows along both sides of the straights, none on corners.
- `validator-town.txt`: ten seeds validate; over them 255 houses, 160 shopfronts, 27 side streets (junctions), 167 bins out.

## Defects found and fixed
- The fresh-eyes FAIL's hero frame had no building: buildings stood 6-9 m back and the capture aimed at a bend. Shopfronts now stand at the footpath (3-4 m), houses 4.6-6.2 m with a front yard, both denser; the capture picks a straight with frontage on both sides.
- Houses were boxes under a gable: now weatherboard walls on stumps with board lines, a corrugated gable with ridge cap and fascia, a chimney, a separate lean-to verandah roof on four posts, framed windows and a green door. Shopfronts: a green dado, a false front with a lettered signboard, big framed shop windows, a verandah over the footpath.
- The side street was a 300 mm dark slab: it's 120 mm, the road's tarmac colour, with a give-way line across its mouth.
- Bins stood far back: now at the kerb (2.6-3.6 m), and more of them. The water tower is placed by rule behind the frontage.
- A far "distant domes" rule placed nothing (map bounds are the route plus 60 m) and was removed.
- Poles moved to the kerb line so they read with the frontage.

## Remaining defects
- **Independent review (`fresh-eyes.md`): FAIL** ("an outback roadside strip with a few verandahed buildings", not a town). Open from it: no water tower in any frame (the validator places them, the captures miss them); no bin cluster in the hero frame and no red bins; shop lettering unreadable (word blocks, by design, but it doesn't read as a sign); verge mostly empty; gums read as lollipops; roofs show no corrugation; sign backs read as blank grey billboards; the gantry truss clips the top of the junction frame; the earth is redder than the reference's dusty pink. These keep AC1 open.
- Distant domes: not in the town's own frames. On the four-biome lap the Rocks segment's domes are the only ones; this capture didn't catch one on the horizon.
- The road is the shared dark tarmac (the map renderer's), not the reference's pale grey-pink; the verge is the ground colour, not a distinct packed-dirt strip.
- Every building is one of two parametric shapes in one colour scheme (playtest scope: size is the only variation).

## Not covered
- A real TV or phone, WebKit, full-screen toggle and resize (the biome has no layout of its own; the tile grid is R04's).
