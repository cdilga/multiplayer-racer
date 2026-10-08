## Reviewer (date 2026-10-08)

Independent fresh-eyes visual review, judged from the images only. I read no code, self-review or other review files.

## Looked at

- docs/evidence/P1-U05.5/looks/fury-road__tv.jpg: reference. Orange earth, dusty-haze sky, inked clouds, mesas, red/white kerbs, rail and chevron posts, halftone shadows, outlined cars.
- docs/evidence/P1-U05.5/looks/fury-road__grid_n24.jpg: reference. 24-tile grid, cars outlined, bunting, rail, kerbs.
- art/ui/accepted/2026-10-07/frames/tv-race-grid.webp: accepted mood frame. Illustrated, so tone and palette only.
- corner-1tile-tv-1080p.jpg: red car on a corner. Chevron posts, W-beam rail, a water tower at right, inked clouds, halftone shadow.
- corner-4tiles-tv-1080p.jpg: four tiles. Chevrons and rail small but visible. Spark and smoke puffs over cars.
- corner-24tiles-tv-1080p.jpg: 24 tiles at 320x270. Chevron boards and rail visible in the corner-approach tiles.
- gantry-1tile-tv-1080p.jpg: run-in down a straight to a distant START · FINISH gantry. Shopfronts, power poles, red rock domes.
- gantry-4tiles-tv-1080p.jpg: gantry fills the bottom tiles. The top two tiles show no gantry.
- gantry-24tiles-tv-1080p.jpg: gantry recognisable in about 14 of 24 tiles, some cropped by camera proximity.
- corner-1tile-laptop-1366.jpg: same corner at 1366x768. Chevrons and rail clearer.
- straight-4tiles-laptop-1366.jpg: houses, water tower, power pole, bins, a diamond warning sign.
- corner-1tile-phone-915x412.jpg: wide phone. Look holds.
- straight-2tiles-phone-412x915.jpg: tall phone, two stacked tiles. Look holds.
- identity-strip-1080p.jpg and identity.json: 8 parked cars from above. All lit shares 0.17 to 0.32, all >= 0.03, passes true.

## Look elements vs reference

| Element | Status | Where |
|---|---|---|
| Warm low sun, long shadows | Present | Shadows are long and fall to the right in all frames. The sky and earth are warm. |
| Blue sky warming to dusty haze at the horizon | Present | Blue at the top fading to peach at the horizon in every frame. The ground/sky seam is a hard line with no distant haze layer or mesas. |
| Hot orange earth | Present | Saturated orange-red earth. A little flatter and redder than the reference. |
| Faceted low-poly | Present | Trees, cars, rock domes and gantry truss are faceted. The earth is a flat tinted plane. |
| 2-3 tone toon ramp | Present, weak on cars | Cars show roughly 2-3 flat tones. Rear faces and the red body's lower half go dark maroon. |
| Ink outline mainly around the car exterior | Present | Navy outline on the car silhouettes. Clouds and the water tower are also inked. Terrain and buildings are not. |
| Halftone shadow under the car | Present | Dithered shadow beside and under the car in 1-tile and 4-tile frames. At 24 tiles it is not visible at tile size. |
| Inked comic clouds | Present | Cream clouds with navy outline in every frame. |
| Vivid true paint | Present | Reds, oranges, teals, blues and purples are saturated. See the identity check. |
| Comic effects not covering identity or the road | Mostly present | The puff clusters in corner-4tiles tile 1 and tile 3 partly cover the rear of an orange car. |
| Sparse reference extras (mesas, bunting, kerbs, windmill) | Absent here | Belong to biome and map beads, not this pass. Not counted against it. |

## Wayfinding pieces at 1, 4, 24 tiles

| Piece | 1 tile | 4 tiles | 24 tiles |
|---|---|---|---|
| Corner chevron posts (yellow board, black chevron) | Present. Clear black chevron on yellow in corner-1tile, and 3 or more posts down the bend. | Present. Yellow boards with chevron visible in all four corner tiles. | Present. Yellow boards visible in the corner-approach tiles (rows 1 and 3 of the corner grid). The chevron glyph is a dark mark and recognisable as a sign. |
| W-beam guard rail (galvanised grey, delineators) | Present as a W-beam rail on posts. Colour is a bluish-grey rather than shiny galvanised. Delineators are ambiguous. | Present as thin grey runs. Delineators not discernible. | Present as grey dashes beside the posts in the corner tiles. Reads as a rail. Delineators not discernible. |
| Finish gantry "START · FINISH" | Present in gantry-1tile. About 220 px wide at the far end of the straight. Banner, checker end and truss legs recognisable, text just legible. | Present in the bottom two tiles at full size with a legible banner. Absent in the top two tiles (not in view). | Present in about 14 of 24 tiles. Recognisable as a banner gantry with checker end even in small tiles. Some tiles crop it. |
| No "Checkpoint" graphics | Pass | Pass | Pass |

## Identity check

The strip shows 8 cars from above. Paint is distinct and true to each badge: cyan, pink, yellow, green, orange, purple, red and teal. The roof and body panels carry the badge colour.

identity.json lists lit-pixel share per car: 0.174, 0.247, 0.278, 0.224, 0.323, 0.256, 0.183, 0.251. The minimum is 0.174 against a 0.03 threshold, and the file records passes true.

Red (#ff3b3b) and cyan (#22c3e6) are the lowest shares. Both are still clearly readable by eye. Orange, cyan and teal are close in hue at 24-tile size but remain separable.

In-race, the red car's lower rear goes to a dark maroon in the 1-tile and 1366 frames. It is still recognisably red.

## Defects

1. Minor. corner-4tiles-tv-1080p.jpg, tiles top-left and bottom-left: the spark and smoke puff cluster covers most of an orange car's rear and part of a teal car's rear. It does not hide the road ahead, but it does briefly obscure identity.
2. Minor. corner-1tile-tv-1080p.jpg and corner-1tile-laptop-1366.jpg, right edge: the water tower's flat grey leg and tank take roughly a tenth of the right edge. It reads as unlit grey with no toon banding and no outline, unlike the other props.
3. Minor. All frames: the horizon is a hard seam between earth and sky with no dusty haze band over distant ground. It is less hazy than fury-road__tv.jpg. This does not break the palette.
4. Minor. corner and gantry captures: the guard-rail delineators are not discernible at any tile count. They may be too small or absent. The rail is also a muted blue-grey, not galvanised silver.
5. Minor. gantry-4tiles-tv-1080p.jpg top tiles and the matching gantry-24 tiles: no gantry in view, so the piece appears in only half the 4-tile capture. The bottom two tiles satisfy it.
6. Minor. gantry-4tiles and gantry-24 frames: start-grid cars interpenetrate (red/blue and orange/teal overlap). This is a grid or physics matter, not the look pass.
7. Minor. All captures: a 1 to 2 px pale border on the frame edges. Cosmetic only. It could be a capture artefact.
8. Minor. corner and gantry frames: the road is very dark flat grey with a bright cream edge line. Against the warm reference it is the least harmonised element. Road surface belongs to the map beads, so I note it without scoring it.

## Verdict: PASS

The captures at 1, 4 and 24 tiles match the accepted Fury Road look in the elements the acceptance lists: a warm low sun with long halftone-dithered shadows, a blue-to-peach haze sky, hot orange earth, faceted low-poly props, 2-3 tone cars with a navy outline, and inked comic clouds. Paint is vivid and true, and the identity strip passes at a minimum share of 0.174 against 0.03. The chevron posts, the W-beam rail and the START · FINISH gantry are each visible at 1, 4 and 24 tiles at a recognisable level, and no "Checkpoint" graphic appears. Captures are at native sizes (1920x1080, 1366x768, 915x412, 412x915). The defects are minor: puffs over one car's rear, a flat unshaded water tower, a hard horizon seam, indiscernible rail delineators, and a gantry that is out of view in half the 4-tile capture. None breaks the acceptance, so I give PASS.
