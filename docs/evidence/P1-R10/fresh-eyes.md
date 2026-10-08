## Reviewer (date 2026-10-08)

Independent fresh-eyes review, judged from the images only (references plus the 11 captures plus identity.json for the measured shares).

## Looked at

- docs/evidence/P1-U05.5/looks/fury-road__tv.jpg: reference; warm orange sky and haze, mesas, red/white kerbs, tyre tracks, W-beam rail with chevron posts, windmill, inked clouds, halftone shadows, outlined cars.
- docs/evidence/P1-U05.5/looks/fury-road__grid_n24.jpg: reference at 24 tiles; same palette in every tile, strong chevrons/rails/kerbs, bunting, cars readable.
- art/ui/accepted/2026-10-07/frames/tv-race-grid.webp: illustrated style frame; blue-teal sky, hot orange earth, dust kicked up, bright saturated cars.
- corner-1tile-tv-1080p.jpg: red car on a dark corner, chevron posts and rail on the outside, domed trees, flat orange plain, pale blue sky.
- corner-4tiles-tv-1080p.jpg: four tiles, cars of several colours, chevrons and rail in 3 of 4 tiles, a clubhouse and water tower in the top-right tile.
- corner-24tiles-tv-1080p.jpg: 24 tiles, many near-identical, tiny rails/chevrons, one tile with a mesa.
- gantry-1tile-tv-1080p.jpg: red car at the start line in a township; no gantry in frame.
- gantry-4tiles-tv-1080p.jpg: the START · FINISH banner is visible in the lower two tiles only; the upper two show houses and wires.
- gantry-24tiles-tv-1080p.jpg: gantry visible in about 12 of 24 tiles, at varying size.
- corner-1tile-laptop-1366.jpg: the 1-tile corner at 1366x768, same content as the TV frame.
- straight-4tiles-laptop-1366.jpg: four tiles on a straight in the township; no chevrons, rails or gantry.
- corner-1tile-phone-915x412.jpg: 1-tile corner, landscape phone; chevrons and rail visible but small.
- straight-2tiles-phone-412x915.jpg: two tiles portrait; no wayfinding piece visible.
- identity-strip-1080p.jpg: top-down row of 8 cars on asphalt, roofs in badge colours, two detached parts lying below cars 7 and 8.
- identity.json: all 8 cars listed, litPixelShare 0.170 to 0.297, passes true.

## Look elements vs reference

| Element | Verdict | Where |
|---|---|---|
| Warm low sun | Absent | No sun, no long warm light or rim light on any frame. Only a peach strip at the horizon. The reference has a clearly warm-lit scene. |
| Teal-blue sky | Ambiguous | The sky is pale cool blue (sky-blue, not teal) fading to a thin peach band. It reads as generic daytime, not "fury road". The accepted frame has a deeper blue-teal sky. |
| Hot orange earth | Present | Rust-orange plain in every frame, flat and a little darker and redder than the reference. |
| Dust haze taking the distance | Absent | The horizon is crisp. Trees and rails 200 m out stay sharp; there is a short gradient band only. The reference fades mesas into orange haze. |
| Faceted low-poly | Ambiguous | Cars are faceted. Trees are smooth domes, and the ground and road are flat with a pixel-block noise texture. Reference trees are visibly faceted icosahedra. |
| 2-3 tone toon ramp | Present | Cars show 2-3 bands; clouds have a two-tone base. Ground and road are flat-lit. |
| Ink outline mainly on the car | Present | Navy outline around cars and clouds; terrain and props mostly un-inked, as ruled. |
| Halftone shadow under the car | Present | Dot-pattern shadow under the car at 1 tile (visible on corner-1tile and gantry-1tile). Barely resolvable at 24 tiles. |
| Inked comic clouds | Present | Cream clouds with navy outline in every frame. They look repeated (same four shapes at the same positions in every tile). |
| Mesas / horizon landmarks | Absent mostly | Only one 24-tile tile (3rd, corner) shows a mesa. The reference has mesas in every tile. |
| Kerbs, tyre tracks, dust kick-up | Absent | The road is plain dark asphalt with cream edge lines. Reference has red/white kerbs and tracks. Some grey smoke puffs appear at 24 tiles. |
| Overall tone match | Absent | These look like a bright generic low-poly game, noticeably flatter and colder than the accepted look. |

## Wayfinding pieces at 1, 4, 24 tiles

| Piece | 1 tile | 4 tiles | 24 tiles |
|---|---|---|---|
| Corner chevron post (yellow board, black chevron) | Visible on corner-1tile-tv (left, 3 boards). The board reads olive/mustard rather than yellow; the chevron is legible at 1080p only at about 40 px. | Visible in 3 of 4 tiles (small, about 20 px). Top-right tile shows two on the right edge. | Present only as 5 to 10 px specks on the left of the tiles. Not legible. Ambiguous. |
| W-beam guard rail (galvanised grey, delineators) | Visible, grey beams with dark delineator posts. Reads as a rail, though thin and low. | Visible, small. | Specks at the horizon; not identifiable as W-beam. Ambiguous. |
| START · FINISH gantry | Absent in gantry-1tile-tv-1080p (camera at the line, banner out of frame; only a billboard edge at the right). Absent in all other 1-tile frames. | Visible in the two lower tiles only; the top two tiles do not show it. Banner text is crisp and legible. | Visible in about 12 of 24 tiles. Banner readable in the larger ones; tiles 3 and 4 crop "JOYSTICK JAMMERS". The rest are small but recognisable. |
| "Checkpoint" graphics | None seen. | None seen. | None seen. |

## Identity check

In the strip, roof colours read true against the badge list: cyan, pink, yellow, mint green, orange, violet, red, teal, in order. They are vivid and distinguishable, with the exception that car 1 (#22c3e6 cyan) and car 8 (#3bd6c6 teal) are close and car 4 (#7bd389) is a paler green. The livery decals (pink/green zigzag, white scribble) add noise but do not hide the base colour. The measured lit shares are 0.17 to 0.30 (car 7 red is lowest at 0.170, car 5 orange highest at 0.297). I can only judge those as a share of the roof and body seen from above. In race views the cars are less true than the strip: the red car's rear goes dark maroon, the orange cars go brown at the rear, and the teal goes dull, because the cars are lit only from the front. A red car under heavy shade would not match #ff3b3b. Blue (not a badge) is a very saturated royal blue. The strip is a top-down parked row on flat light, so it is the best case and it flatters the cars. Identity is not covered by comic effects. The identity gate in the json passes and I agree it is satisfied on the strip, not proven in race lighting.

## Defects

1. docs/evidence/P1-R10/captures/gantry-1tile-tv-1080p.jpg (and gantry-1tile equivalents on laptop/phone): the gantry is not visible at 1 tile, so the "visible at 1 tile" criterion is unmet. The camera starts at the start line and the banner is behind or above the view. Either re-frame a 1-tile capture a few metres before the line or accept it as unmet.
2. corner-1tile-tv-1080p.jpg and every frame: the sky is pale blue, not teal, and there is no warm low sun, so the "Fury road" tone does not match fury-road__tv.jpg.
3. All frames: there is no dust haze. The horizon is crisp at distance (trees, rails, houses), unlike the reference. This is the largest tonal gap.
4. corner-24tiles-tv-1080p.jpg: many tiles are near-identical (tiles 1 and 2, 13 and 14 and others are almost duplicates, same cloud placement). The corner pieces at 24 tiles are 5 to 10 px specks. Wayfinding is not demonstrably visible here.
5. corner-1tile-tv-1080p.jpg: chevron boards read olive/mustard instead of yellow with a black chevron; they look dark and small, unlike the reference's bright yellow.
6. corner-4tiles / corner-24tiles / gantry-4tiles: cars interpenetrate or overlap (red and blue at the gantry-4tiles upper tiles; teal and orange). This damages identity readability in those tiles.
7. All frames: the ground and asphalt carry a visible square-pixel noise texture (blocky tiles) which is neither faceted nor halftone; it reads as low-resolution.
8. All frames: no mesas or horizon landmarks except one tile; no red/white kerbs and no tyre tracks, which the reference has. The world looks empty compared with it.
9. Race-lit cars: rear faces of red/orange/teal cars go dark and desaturated (corner-1tile-tv red rear is near maroon), which weakens "paint stays vivid" outside the flat-lit strip.
10. straight-2tiles-phone-412x915.jpg and straight-4tiles-laptop-1366.jpg: no corner chevrons, rail or gantry in these frames, so they prove nothing about wayfinding.
11. Native device pixels: the phone captures are 915x412 and 412x915 CSS-size images. If the devices have DPR 2 to 3 these are not native device pixels. I cannot confirm from the images; the 1080p and 1366 captures do look native.
12. gantry-24tiles-tv-1080p.jpg tiles 3 and 4 (and 13, 14): the banner is cropped at the left, hiding the "JOYSTICK JAMMERS" side, and covers the upper third of the tile (the road itself is not covered).

## Verdict: FAIL

The wayfinding kit exists and is well made. The chevrons, W-beam rails with delineators and the START · FINISH gantry all read correctly when large enough, the inked clouds, car outlines and halftone shadows are there, and the paint colours are true in the identity strip. But the captures do not match the accepted world look. The sky is generic pale blue with no warm low sun, there is no dust haze, no mesas or landmarks, no kerbs or tracks, and the flat, pixel-noise ground reads as a bright generic low-poly game rather than the hot, hazy Fury Road reference. The gantry is not visible in the 1-tile gantry capture at all, and at 24 tiles the chevrons and rails are unreadable specks, so the "each piece visible at 1, 4 and 24 tiles" criterion is not met for the gantry at 1 tile and is ambiguous for the corner pieces at 24. Race-lit cars also lose some vividness at the rear. A fix needs a warmer grade with haze and a sun, a re-framed 1-tile gantry capture, and 24-tile captures that actually show the pieces.
