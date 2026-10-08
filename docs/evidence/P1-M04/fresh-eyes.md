## Reviewer
Independent fresh-eyes reviewer (Claude Sonnet 5.5), 2026-10-08. I judged the images before reading anything else (no code, no self-review, no other review, no earlier fresh-eyes file).

## Looked at
- art/references/australia/generated/biome-town.png: wide panorama. Red-dirt plaza, wide pale tarmac junction, General Store and Roadside Inn with corrugated grey roofs and verandahs, signboards, a lattice water tower (two), wooden power poles with sagging lines, green/yellow/red wheelie bins in clusters, mailboxes, a green direction sign and a yellow diamond warning sign, several gum trees, spinifex, distant red rock domes.
- art/references/australia/raw/aus-town-reference.png: photo of a remote outback road. Pinkish road, packed dirt, long low pale-roofed building, corrugated fence, rainwater tank, a roadside shop sign, gum trees, a pole, low horizon.
- street-tv-1080p.jpg: red car behind-view on a straight dark tarmac road with white edge lines. Left and right, one tall false-front shopfront with a verandah and a dark sign panel, plus a low grey-roofed house behind it. Small green mailboxes, one wooden power pole with sagging lines on the right, dome-shaped green trees, a START-FINISH gantry far ahead, more houses in the distance, inked cream clouds, orange horizon gradient, red-orange dirt verge.
- street-tiles-1080p.jpg: four split-screen views of the same street. Near-identical shopfront and house pairs, mailbox, pole, lines. Right-hand tiles are mostly empty red ground with a few houses far off. A yellow commentary strip at the bottom.
- street-laptop-1366.jpg: four tiles. Top-left is the same street. Top-right shows a curve with guard rails, a yellow chevron and a car on the road, with no town at all. Bottom tiles show a few houses with a shopfront in the distance, yellow diamond sign, guard rails.
- street-phone-915x412.jpg: the same straight street composition in a wide, short crop. Shopfronts on both sides, pole, mailboxes, gantry. It reads well.
- street-phone-412x915.jpg: two stacked captures. Top is the straight street with a blue car edge intruding. Bottom is an elevated view of one house with a verandah, a green bin, an orange cone, a power line across the sky and flat red ground with sparse buildings. A car is wrecked or sideways at bottom left.
- junction-sign-tv-1080p.jpg: a curving road with a green "PRINCES HWY / ADELAIDE 380 / MELBOURNE 640" sign with a yellow diamond, a shopfront and house on each side, bins, a mailbox, a dark rectangle on the ground (the side street?), distant trees and guard rails. A brown and grey slab fills the top edge of the frame (a gantry or bridge underside, cut off).
- four-biome-lap-town-tv-1080p.jpg: a straight road with houses on both sides, a yellow kangaroo diamond sign, two green and yellow bins, a power pole with lines, a billboard (blank grey), a large tree cropped at the left with a hard halftone shadow, and a winner caption strip. Distant trees and guard rails.
- plot-town.png: top-down plot. A long east-west straight with orange blocks (houses and shopfronts) in rows on both sides, three white squares (plot only), a grey square, yellow wayfinding dots around the loop, scattered green trees, a few magenta and blue dots. It shows an oval loop with a straight, not a street grid.
- validator-town.txt: 10 seeds, all "ok". 255 houses, 160 shopfronts, 27 side streets, 167 bins out. Seed 0 has 105 gum trees, 28 houses, 9 shopfronts, 4 water towers, 10 poles, 6 mailboxes, 16 bins, signs and wayfinding pieces.

## Elements vs reference
| Element | Status | Where |
|---|---|---|
| Flat wide street, tarmac | present | all frames; dark tarmac with white edge lines |
| Packed dirt verge | present (colour is strong red-orange, not the reference's pinkish dust) | all frames |
| Low corrugated-roof houses | present (grey hipped or gabled roofs; no visible corrugation) | tv, tiles, four-biome, phone-412 bottom |
| Shopfronts | present (one design, a tall false-front sign panel with black slots; no readable text) | tv, tiles, laptop, phone-915 |
| Verandahs | present | on houses and shopfronts in every town frame |
| Power poles and lines | present (a sparse pole or two per frame) | tv, tiles, four-biome, phone |
| Water tower | absent in every frame, though the validator counts 4 | not visible anywhere |
| Mail boxes | present, small green posts | tv, tiles, laptop, junction |
| Wheelie bins (green/yellow/red) | present but only green or green-yellow; no red | four-biome, junction, phone-412 bottom |
| Gum trees | ambiguous (dome-topped lollipop trees, closer to acacia or umbrella trees than gums) | all frames |
| Distant domes / rock formations | absent (flat horizon, only tiny far houses and trees) | all frames |
| Direction sign | present | junction-sign (PRINCES HWY) |
| Warning sign | present | four-biome (kangaroo), laptop and junction (diamond) |
| Junction / side street | ambiguous (a dark rectangle patch in junction-sign; no readable side street in the TV frames) | junction-sign |
| Wheelie bin out or not | ambiguous (bins seen only near the road; "not out" is not visible) | four-biome |
| Signboards with text (General Store, Roadside Inn) | absent (shop panels carry black slots, not words) | tv, tiles |
| Comic style (inked clouds, halftone shadows, flat colour) | present | all frames |

## First-look reading
A person would say "an Australian outback highway with a few old shopfronts and houses along it", or a red-dirt desert road with a row of buildings. They would name the place from the red ground, the low verandah buildings and the power pole. They would not necessarily say "town": it reads as a lightly built roadside strip, not a settlement. The pairs of identical shopfronts look mirrored, copy-pasted and sparse. The reference has a clustered street with signs, tanks, bins and domes.

## Defects
1. Water tower is never visible in any capture. The reference's most distinctive silhouette is missing (all frames).
2. No distant domes or rock formations. The horizon is flat and empty (all frames, especially street-tv-1080p.jpg).
3. Shop panels carry no readable words, so "General Store" is not conveyed. The black slots read as a vent or a generic hoarding (street-tv-1080p.jpg, both sides).
4. The shopfront is a large flat slab. It looks the same on both sides, mirrored, with an almost identical house behind each (street-tv-1080p.jpg).
5. Bin variety is missing: no red bins, and only a couple of green ones are visible. In the TV hero frame no bins are visible at all (street-tv-1080p.jpg).
6. The hero frame shows few town elements: two shopfronts, two mailboxes, one pole. Density is thin against the reference, with large empty red verge on both sides (street-tv-1080p.jpg).
7. Junction-sign-tv-1080p.jpg has a brown and grey slab cutting across the top of the frame, which looks like a gantry or camera clip. The dark patch where the side street should be is unreadable as a junction.
8. Street-tiles-1080p.jpg: the right tiles are mostly empty red ground with a tiny town at the horizon; the town is barely present. Laptop top-right has no town at all.
9. Trees are dome-topped lollipops, not gum trees. The huge cropped tree in four-biome-lap-town-tv-1080p.jpg is a flat green blob with a plain pole trunk, with no white bark or limbs.
10. Blank grey billboard at left in four-biome-lap-town-tv-1080p.jpg and a grey box above the right shopfront in junction-sign-tv-1080p.jpg: unlabelled, unfinished-looking.
11. Roofs are plain grey planes with no corrugation read (all frames).
12. plot-town.png shows a single east-west straight with houses in strips, so the "town" is a corridor, not a place with a plaza. Side streets and junctions are not visible in the in-game frames.
13. Dirt colour is saturated red-orange against the reference's dusty pink and tan, which is a noticeable palette drift (all frames).

## Verdict: FAIL
Against "recognisable against its reference", this does not pass yet. The strong parts are the comic style, the tarmac and red dirt, verandahed low buildings, a power pole with lines, mailboxes, signs, and the START-FINISH gantry, which together read clearly as an outback roadside strip. But a person placing a capture beside biome-town.png would miss the water tower and domes entirely. They would not see the coloured bin clusters, readable shop signs, or any junction or plaza. The hero frame shows two mirrored shopfronts and a lot of empty verge. The playtest scope allows one parametric house and one shopfront, so repetition is acceptable. The reference's silhouette-defining props that are in scope (water tower, bins, signed shopfront, junction) are not visible in the captures, and the validator's counts (4 water towers, 16 bins) do not show up on screen. Make the water tower and a bin cluster visible in the hero frame, give the shopfront readable lettering, and fix the junction capture. Re-review after that.
