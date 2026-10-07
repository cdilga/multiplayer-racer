## Reviewer

Fresh-eyes Sonnet reviewer, not the builder. Date 2026-10-07. Images were opened and judged before the builder's self-review.md was read.

## Looked at

- `track-tv-1080p.jpg`: pale graded-dirt road with cream edge lines curving through red earth; many spinifex tufts and desert-oak umbrellas (dark trunks, grey-green flat crowns) from near to the horizon, a yellow diamond warning sign (sloped "dip" pictogram), rail and posts on the far bend. Reads as outback dirt; the road stands out well. Vegetation is evenly spread and there is clear verge by the route.
- `track-tiles-1080p.jpg`: four tiles, bunched cars; lower tiles have a yellow-orange trapezoid pad and yellow/black wedge on the road plus a brown puddle-like shape. The sign is tiny in the distance.
- `track-laptop-1366.jpg`: the same at laptop size; trees and tufts still read, but the yellow wedge and pad sit awkwardly on the road.
- `readability-1080p.png`: dirt road meeting dark bitumen ahead, close-up rail, tufts, a shed at far right. Debug strip at bottom-right reads "960x540 auto-lowered ... frame budget missed" (renderer quality was lowered in this capture).
- `readability-small-tile.png`: 640x360 version; the road is still clearly visible against the ground; the HUD debug strip overlaps the bottom edge and is garbled.
- `plot-outback-dirt.png`: a dense field of small dots (spinifex) and larger squares (trees), a clear verge around the lap.
- `readability.json`: road RGB (234,186,129) vs ground (172,82,45), deltaE about 40.9 (1080p) and 40.4 (small tile).
- `validator-and-autopilot-dirt.txt`: ten seeds ok; autopilot 3 laps unaided on 3 seeds (0 recoveries, 0 wrecks).
- Reference `biome-outback-dirt-and-bitumen.png`: red earth packed with round spinifex tussocks, bare dark-trunk trees, wheel-rutted track, domes on the horizon, overcast sky.

## Verdict

PASS against the playtest-scope promise: a winding graded track, two vegetation species (spinifex and an oak) clear of the route, a driveable normal line (autopilot laps on three seeds with no recoveries), and the dirt is measurably readable against the ground (deltaE about 40). The 1080p TV frame is clean and uncluttered, and vegetation is not on the road. It is flatter and emptier than the reference: no wheel ruts, no domes, a sparse tussock carpet, clean cartoon-blue sky, and the road is a flat tan ribbon. The "tile" captures are marred by marker pads and bunched cars.

## Defects

1. `track-tiles-1080p.jpg` and `track-laptop-1366.jpg`, lower tiles: yellow trapezoid pad, yellow/black wedge and a brown blob on the road look like debug markers and clutter the lead area; the wedge overlaps the cars.
2. `readability-1080p.png`, bottom-right strip: "auto-lowered ... frame budget missed" means the capture itself ran at degraded quality (960x540); this evidence is not a clean 1080p render, and the self-review calls it 1080p.
3. `readability-small-tile.png`: HUD text overlaps the car's bottom edge and is garbled.
4. All captures: road is a flat tan ribbon with no wheel ruts, edge wear or texture; the reference's rutted track is not reproduced.
5. No distant domes or horizon feature; the skyline is a flat line, and the sky is a plain blue gradient.
6. `track-tv-1080p.jpg`, sign on the right: the warning pictogram is too small to read at TV distance; guide sign never appears in the dirt captures.
7. Tree crowns are very flat and uniform; trunks are black sticks; repeated identical shapes look like copies.
8. Only one tree species is visible plus one tussock; fine for scope but the vegetation reads sparse next to the reference's carpet.

## Disagreements with the self-review

- It reports the 1080p readability capture as 1920x1080; the on-screen debug strip says it was auto-lowered to 960x540 with the frame budget missed, so the numbers come from a degraded render (the colour distance is probably still valid, but it should be stated).
- It records the yellow/black pads as a one-line "remaining defect"; they visibly clutter the road in all four lower-tile frames.
- It says the autopilot "laps three seeds"; I accept this from the text file, but no image evidence of a lap (such as a trace) is committed.
- I agree on the missing ruts and domes.
