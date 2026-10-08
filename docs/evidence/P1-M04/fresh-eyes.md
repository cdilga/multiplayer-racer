## Reviewer (date 2026-10-08; you judged images before reading anything else)

Independent reviewer, judged from the images only (the two references, the nine frames, the plot and the validator text). No code, self-review or other review file was opened.

## Looked at

- biome-town.png (reference): wide panoramic outback street. Low weatherboard buildings with grey corrugated roofs and verandahs, "GENERAL STORE" and "ROADSIDE INN" signboards, green/yellow/red wheelie bins clustered at the fronts, mailboxes on posts, timber power poles with sagging lines, two water towers, scattered gums, red-rock domes on the horizon, pale grey road with red dirt verges, a yellow diamond sign and a green direction sign.
- aus-town-reference.png (raw): real photo. Flat red-dirt town, a long low white-roofed building, a water tank, a few gums, a lamp post, a general-store sign, a straight road. Mostly empty space.
- street-tv-1080p.jpg: dead-straight dark tarmac road with white edge lines, one red car. Left and right, a tall-fronted shopfront with a word-block signboard, a verandah with a blue-grey corrugated awning and white posts, and a low house with a verandah beside it. Green wheelie bins with red lids and a mailbox on posts in the foreground. A timber power pole at right with three lines sweeping off to the corner. Gum-tree clusters on both sides. More houses and shopfronts recede to a START-FINISH gantry. A water tower stub shows behind the gantry. Red-orange dirt ground, inked clouds, an orange-to-blue sky gradient, halftone shadows.
- street-tiles-1080p.jpg: four tiles of the same street. Top left and bottom left: shopfronts on both sides, a pole and lines, bins and mailboxes. Top right: a curve with yellow chevron signs and guard rail, a gum tree, no buildings. Bottom right: the gantry up close flanked by two low houses. A caption strip reads "THE LEAD HAS CHANGED HANDS! FAIR DINKUM THRILLER!".
- street-laptop-1366.jpg: the same four tiles at 1366 wide. All the elements stay legible and the caption strip is clear.
- street-phone-915x412.jpg: the hero composition at landscape phone size. Both shopfronts, houses, bins, mailboxes, the pole and the gantry are visible. The shopfront signboards are small but still read as signboards.
- street-phone-412x915.jpg: two stacked portrait views. The upper view shows a shopfront and verandah on the right, a pole, a bin and a mailbox, with the cars large in the foreground. The lower view shows a long receding street and the gantry. The town reads, but the cars fill the lower half.
- junction-sign-tv-1080p.jpg: a curving road in open desert. A green direction sign "A1 PRINCES HWY / ADELAIDE 380 / MELBOURNE 640" with a shield sits at right beside a yellow diamond kangaroo warning sign. Yellow-lidded bins, a grey blank water tower on legs, a dark flat slab (side-street stub) beside the road, a verandah at left, chevrons and guard rail far off, gums.
- four-biome-lap-town-tv-1080p.jpg: the town in the real track. A row of houses with verandahs on the left, a house and a shopfront on the right, a water tower in the middle distance, poles, lines, a kangaroo sign, bins and distant gums. The road bends away.
- four-biome-run-in-domes-tv-1080p.jpg: a straight run-in with a shopfront and houses on both sides, the gantry, a water tower behind it, poles and lines, and large red banded domes on the right horizon.
- plot-town.png: top-down plot. A loop track with a long straight along the top. Orange house and shopfront blocks line the straight and sit in a cluster at the lower left and along the lower return. White power-line spans are large rectangles over the straight. A grey block at the right. Yellow wayfinding dots on the bends. Green trees scattered everywhere. A few magenta and blue specks.
- validator-town.txt: 10 of 10 seeds ok, 255 houses, 160 shopfronts, 27 side streets, 167 bins out. The seed-0 piece list includes town/house, shopfront, power-pole, power-line, water-tower, mailbox, bin-red, gum-tree, side-street, and signs/crest, junction and kangaroo.

## Elements vs reference

| Element | Status | Where |
|---|---|---|
| Flat wide street, tarmac | Present | All frames. The road is dark charcoal, not the reference's pale grey, which is the map renderer's concern. |
| Packed-dirt verge | Ambiguous | The verge is the same red dirt as the whole ground plane, with no distinct verge strip. Reads as outback, not as a verge. |
| Low corrugated-roof houses | Present | Hero, lap, run-in. Hip roofs with ridged grey sheeting. |
| Shopfront with signboard | Present | Hero left and right, tiles. A word-block signboard on a tall parapet front, by design. |
| Verandahs with posts | Present | Hero, phone, junction frame. White posts and a corrugated awning. |
| Power poles and lines | Present | Hero right, tiles, lap, run-in. A strong match to the reference. |
| Water tower | Present, weak | Junction frame, lap, run-in. A plain grey box on legs with no conical roof. Distant only. |
| Mailboxes | Present | Hero, tiles. Small green boxes on posts, tiny but readable. |
| Wheelie bins, green | Present | Hero, tiles, phone. |
| Wheelie bins, yellow | Present | Junction and lap frames (yellow lids). |
| Wheelie bins, red | Ambiguous | Seen only as red lids on green bodies in the hero. No red-bodied bin is seen, though the validator lists bin-red. |
| Gum trees | Present | All frames. Lollipop clusters with pale trunks, a good low-poly gum reading. |
| Distant domes | Present, one frame only | Run-in frame, right horizon. Absent from the hero, tiles, lap and junction frames. |
| Direction sign | Present | Junction frame, green "A1 PRINCES HWY" sign. |
| Warning sign | Present | Kangaroo diamond (junction, lap), chevrons (tiles). |
| Junction or side street | Ambiguous | Junction frame, a flat dark slab by the road. It reads as a floating slab, not clearly a street. |
| Clustered town density | Weak | The reference packs buildings and bins in tight clusters. Here, buildings are spaced along the road with empty red ground between. |
| Ground cover (tussocks, flowers) | Absent | The reference has dry grass and pink shrubs. Here the ground is bare. |

## First-look reading

"A dusty red-dirt outback town on a straight highway: tin-roof shops with verandahs, power poles, green wheelie bins, gum trees, with a race start-finish gantry." The Australian outback reading is immediate. The sparseness reads as a small remote town, which fits the raw photo.

## Defects

1. Shopfronts are visibly identical. The two flanking the hero are the same building mirrored, and the same front repeats in the tiles, lap and run-in. Minor (one parametric shopfront is the playtest scope), but it is the most noticeable repetition.
2. The water tower is a blank grey box on stilts with no tank profile or roof. In junction-sign-tv-1080p.jpg (centre right) it reads as a billboard. Minor.
3. Domes appear in only one frame (four-biome-run-in-domes-tv-1080p.jpg). The hero street and the lap frames show an empty horizon of trees. The reference has landmarks on the skyline. Minor.
4. The town is sparse and bare. There are no tussocks or shrubs, and the verge is not distinguishable from the ground plane, so the "packed dirt verge" is not visible as a surface. Minor.
5. The red bin is only a red lid on a green body, so the "green/yellow/red" bin set is not fully visible in the town frames. Minor.
6. The side-street stub in junction-sign-tv-1080p.jpg (right, beside the sign) is a flat dark rectangle with a dash. It floats and does not read as a street. Minor.
7. The halftone shadow pattern lands on the front of the left shopfront and its awning (street-tv-1080p.jpg, left) as a blue-grey lattice. It looks like noise or chain-link on the verandah roof. Minor.
8. plot-town.png: the power-line spans are large white rectangles that obscure the street and the junction layout. The plot is hard to use as a layout check, and no side streets are readable in it despite 27 across the seeds. Minor (a debug artefact, not an in-game defect).
9. street-phone-412x915.jpg: the cars take the lower half of the frame and a shopfront is cropped at the right. This is a legibility issue only in this layout. Minor.

None of these blocks recognisability.

## Verdict: PASS

Against "recognisable against its reference", the frames hold. Set beside biome-town.png, every key element is present and identifiable: low corrugated-roof buildings with verandahs, a signboarded shopfront, power poles with sagging lines, wheelie bins, mailboxes, gum trees, a water tower, domes (in one frame), a direction sign and a warning sign, on a flat straight street with red dirt around it. The comic low-poly treatment (flat colour, inked clouds, halftone shadows) is consistent and is not a realism failure. The weaknesses are density and variety (identical shopfronts, bare ground, weak water tower, domes missing from most frames), which make it a thinner, plainer version of the reference rather than a different place. The remaining defects are minor.
