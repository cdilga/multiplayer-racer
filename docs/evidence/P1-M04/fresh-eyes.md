## Reviewer

Fresh-eyes Sonnet reviewer, not the builder. Date 2026-10-07. Images were opened and judged before the builder's self-review.md was read.

## Looked at

- `street-tv-1080p.jpg`: one car on a dark tarmac bend with cream edge lines on flat red earth; W-beam rail and yellow-banded posts on the outside, a grey water tower and about nine umbrella-shaped gum trees on the skyline. No building, sign, bin, mailbox or pole anywhere. A reader would call this "outback highway", not "town". The "Join at 127.0.0.1:..." pill floats top right, the bottom strip is dark-on-dark and unreadable.
- `street-tiles-1080p.jpg`: four tiles, two pairs of bunched, overlapping cars. A tan shopfront (very low-res, dithered window texture) clipped at left, a grey-roof house, a tiny green mailbox, a dark side-street pad at right, and in the lower tiles a green "PRINCES H.. / ADELAIDE / MELBOURNE" sign with a yellow diamond, cut by the tile edge. Cars fill the tile and hide the road.
- `street-laptop-1366.jpg`: same as above at 1366x768. Shopfront at left is a flat tan slab; sign text is cut at the right edge ("PRINCES Hw", "38"); bottom strip text unreadable.
- `plot-town.png`: top-down map. Orange squares for houses in rows along the straights, a large grey square (water tower or lot?), yellow chevron posts, green gum dots. Shows a road lap with building rows, but it is a debug plot, not a render.
- `validator-town.txt`: ten seeds "ok"; piece tallies (houses, shopfronts, side streets, bins out) listed; no failures.
- Reference `art/references/australia/generated/biome-town.png` (for comparison): corrugated-roof houses and shopfronts with verandahs and painted signs, power poles with wires, water tower, green/yellow/red bins, mailboxes, pink-grey road with tyre tracks, Olgas domes far off.

## Verdict

FAIL against "recognisable against its reference". The validator evidence is fine (10 seeds ok), but the visual captures do not show a town. The hero 1080p TV frame, the one a host would see on the TV, contains no building at all; it reads as the outback bitumen biome. The multi-tile captures show one low-detail shopfront and one house at the screen edge, partly hidden behind cars. There are no power poles with wires, no bins, no verandah worth the name, no painted shopfront signage, and no distant domes. Nothing in a single frame shows the "town street with frontage on both sides" that the reference and the plot promise. At TV distance the buildings are tan slabs on tan-red ground with little contrast and a dithered, shimmering texture. The kit may be correct in data (the plot shows rows of buildings) but the capture was taken at the wrong place, and the evidence does not prove the promise. A re-capture on the straight, with the camera facing frontage, is needed.

## Defects

1. `street-tv-1080p.jpg`, whole frame: no town content (no building, bin, mailbox, pole or sign). The bead's required capture does not show the biome.
2. `street-tiles-1080p.jpg`, upper-left tile left edge and lower-left tile: buildings sit at the image edge, cropped, and the shopfront face has dithered/shimmering window texture; low contrast against the earth.
3. `street-tiles-1080p.jpg` and `street-laptop-1366.jpg`, right edge of lower tiles: the direction sign is cut by the tile, so the text "PRINCES H..." is not fully readable; the yellow warning diamond is sliced off.
4. All three jpgs, bottom-centre strip and bottom-right strip: dark text on dark panel, unreadable (a debug HUD that should be hidden or legible).
5. Missing vs reference and bead contract: no power poles with wires (poles exist per validator but never appear in frames), no wheelie bins visible, no verandah/roof detail, no distant domes; the street surface is plain dark tarmac, not the pink-grey road of the reference.
6. All tile captures: the two cars in each tile are bunched and overlapping, covering the road and obscuring the scene; this is autopilot start behaviour, not a good evidence frame.
7. `plot-town.png`: it is a legend-less debug plot; large grey square is unexplained and no colour key is given.
8. Look/palette: the sky is a flat light blue with no horizon haze and the earth is a saturated flat orange-red, far from the reference's muted dusty palette (flat-look caveat applies, but still reads cartoonish rather than "town").

## Disagreements with the self-review

- The self-review says the town "is there" (street, buildings facing it, mailbox, junction with sign, trees, water tower). In the TV frame none of that exists but the tower and trees, and in the tile frames the buildings are a sliver at the edge. I judge "recognisable" as not met; the self-review concedes only that poles and bins are "thinner".
- It lists "no building in the 1080p frame" under remaining defects as minor. For a biome bead whose required capture is that frame, it is the main defect.
- "Nothing clipped" (laptop frame): the buildings and sign are clipped by tile edges.
- It says a fresh-eyes review was not covered; this file is that review, with a different verdict from the builder's implied pass.
