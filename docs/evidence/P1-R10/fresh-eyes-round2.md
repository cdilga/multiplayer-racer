## Reviewer (date 2026-10-08)

Independent fresh-eyes visual reviewer. Judged from the images only. I did not read code, self-review.md or fresh-eyes-round1.md.

## Looked at

- fury-road__tv.jpg (ref): warm sky to peach haze, orange earth, sandy road with red/white kerbs, grey W-beam rail with delineators, yellow chevron posts, inked clouds, halftone shadows, thick navy car outlines.
- fury-road__grid_n24.jpg (ref): the same look at 24 tiles. Rails and chevrons read as small grey/yellow marks.
- tv-race-grid.webp (ref): illustrated target, painterly, bright blue sky, bunting, dusty roads.
- corner-1tile-tv-1080p: red car on a dark road in a bend. Chevron signs plus rails on the outside. Big grey water tower at top right. Inked clouds.
- corner-4tiles-tv-1080p: four tiles, cars in a pack with puffs of dust. Chevrons and rails are small but present in each tile.
- corner-24tiles-tv-1080p: 24 tiles. Chevrons are visible as small yellow squares in the first tiles. The start-finish banner appears in the tiles in the second and fourth rows. A "lead has changed hands" ticker covers one tile's cars.
- gantry-1tile-tv-1080p: NO gantry in frame. A village street, houses, power lines, a bin, a roo sign.
- gantry-ahead-1tile-tv-1080p: the banner is tiny at the far end of the street. "START · FINISH" is barely readable, but it reads as a banner.
- gantry-4tiles-tv-1080p: the bottom two tiles show the full banner, truss legs and a chequer line. The top two tiles show no gantry.
- gantry-24tiles-tv-1080p: the banner is recognisable in about 12 tiles. Large in some, small in others, with legible text only at the larger ones.
- corner-1tile-laptop-1366: matches the TV frame, scaled.
- straight-4tiles-laptop-1366: four tiles on a village street. No wayfinding pieces are visible apart from a tiny far chevron.
- corner-1tile-phone-915x412: a wide strip. Chevron, rail and tower present.
- straight-2tiles-phone-412x915: two tiles on a street. Chevrons are tiny at the far left. No rail or gantry.
- identity-strip-1080p: FILE NOT FOUND on disk (deleted in the working tree). I could not view it. Only identity.json was read.

## Look elements vs reference (table: element | present/absent/ambiguous | where)

| element | status | where |
|---|---|---|
| Warm low sun, long shadows | present (modest) | Shadows fall right and toward camera, with halftone dithering. Not as long or dramatic as the ref. |
| Blue sky warming to dusty haze | present | All frames. Haze is a clean gradient, less hazy than the ref, and the horizon line is hard. |
| Hot orange earth | present | All frames. Flat with a faint tile speckle, with no scrub or rocks like the ref. |
| Faceted low-poly | present | Trees, cars, buildings. |
| 2-3 tone toon ramp | ambiguous | Cars show flat facets and the clouds show 2 tones. Terrain and buildings read as smooth shaded, with no visible banding. |
| Ink outline mainly around the car outside | present | A thin navy outline around the cars, tidy. It is thinner than the ref's heavy line, and absent from the scenery apart from the clouds. |
| Halftone shadow under car | present | Under every car, visible at 1, 4 and 24 tiles. |
| Inked comic clouds | present | All frames. The same 4-5 clouds at identical positions in every tile, which looks copy-pasted at 24 tiles. |
| Road/kerb tone | differs from ref | The road is dark charcoal asphalt with a thin cream edge line. The ref has sandy road with red/white kerbs. It does not break the acceptance list but is the biggest visible departure. |
| Comic effects not covering identity or road | present | One ticker banner covers a car group in a single 24-tile tile (gantry... corner-24 row 4, col 3). It is a HUD event line, so minor. |

## Wayfinding pieces at 1, 4, 24 tiles (table)

| piece | 1 tile | 4 tiles | 24 tiles |
|---|---|---|---|
| Corner chevron post (yellow board, black chevron) | Clear in corner-1tile (chevron legible), also in laptop and phone frames. Absent in the straights. | Visible in each corner tile, small. Chevron shape is still discernible. | Visible as yellow squares in the top-left tiles. The chevron glyph is not discernible. It reads as a yellow sign. |
| W-beam guard rail (galvanised grey, delineators) | Present, grey and boxy, on the outside of the bend. Reads more blue-grey than galvanised. The delineators are tiny dark posts and do not read as delineators. | Present, small. | Ambiguous. Light grey dashes at the horizon only, and the W profile is lost. |
| Start/finish banner gantry | gantry-1tile frame: ABSENT (the camera is not at the line, no banner). gantry-ahead: present and tiny (~110 px wide on 1920), text barely legible. | Present in the two bottom tiles, with large legible text, truss legs and a chequer line. Absent in the top two. | Present in about half the tiles and recognisable. Large in some tiles, tiny in others. |
| "Checkpoint" graphics | none seen | none seen | none seen |

## Identity check

The requested identity-strip-1080p.jpg is not in the captures directory, so I could not judge lit paint vs badge colours visually. identity.json lists lit-pixel shares of 0.174 to 0.323 for the 8 cars with `passes: true`. This is a measurement and I could not confirm it against the picture. The lowest shares, car 1 (cyan #22c3e6, 0.174) and car 7 (red #ff3b3b, 0.183), are the least covered. In the race frames the paint reads vivid and true: red, royal blue, orange, teal, yellow, pink, purple, green, maroon, sky blue, white. The black and maroon cars read darker than a "vivid" palette would suggest, but these are not among the eight listed badges. The decals (green/pink zig-zag) are visible on the rears.

## Defects (numbered, file + location; mark each blocking or minor)

1. BLOCKING (evidence): docs/evidence/P1-R10/captures/identity-strip-1080p.jpg does not exist. The identity acceptance cannot be checked visually. Only the JSON numbers exist.
2. BLOCKING (evidence): gantry-1tile-tv-1080p.jpg does not show the gantry. The camera is not under the banner, as the brief says it is. The shot shows a village street only. The 1-tile gantry evidence is therefore only gantry-ahead, where the banner is tiny.
3. Minor: gantry-ahead-1tile-tv-1080p.jpg, centre. The banner is about 110 px wide, so "START · FINISH" is barely legible even at 1 tile.
4. Minor: corner-24tiles-tv-1080p.jpg and gantry-24tiles. The guard rail is not recognisable at 24 tiles (grey dashes). The chevron is a yellow square without a legible glyph.
5. Minor: straight-4tiles-laptop-1366.jpg and straight-2tiles-phone-412x915.jpg. These show no wayfinding piece clearly (a tiny far chevron). The pieces are therefore not demonstrated at those tile counts and sizes.
6. Minor: all frames. The road is dark asphalt and has no red/white kerbs, whereas the Fury Road ref has a sandy road with kerbs. The terrain has no scrub or rock and no visible toon banding.
7. Minor: all frames. The clouds are identical in every tile (the same 4-5, at the same spots). The haze at the horizon is a hard line, less dusty than the ref.
8. Minor: corner-1tile / corner-4tiles / phone frame, top right. A flat grey water tower leg and tank crowd the corner. It covers sky only, not the road.
9. Minor: corner-24tiles-tv-1080p.jpg, row 4 col 3. The "LEAD HAS CHANGED HANDS" ticker covers a car group. This is an HUD event line, and a user-visible overlay on identity for a short time.

## Verdict: FAIL

The look itself holds. The sky gradient, hot orange earth, faceted low-poly objects, inked clouds, thin outline on the car and halftone car shadow are all present at 1, 4 and 24 tiles, and at native pixels. Chevron posts and the start/finish banner are recognisable at the tile sizes captured. No "Checkpoint" graphics appear. The shortfalls are in the evidence set, not the look: the identity strip image that I was asked to review is missing from disk, so the paint/identity requirement rests on JSON only, and the "camera under the banner" 1-tile gantry frame does not show a gantry. The guard rail and chevron glyphs are also not legible at 24 tiles, and the road is much darker and less dusty than the accepted Fury Road frames. If identity-strip-1080p.jpg is restored and checked, and gantry-1tile is re-shot under the banner, I expect PASS, with the minor defects above left in place.
