# Self-review P1-M09 (sign kit)

Captured with `node web/host/tests/signs-capture.mjs` (the real kit, Chromium headless software GL via Playwright; not a
device, not WebKit, not the game's toon/outline pipeline: flat vertex-colour materials). The smallest realistic tile is
192x108 (100 players at 1920x1080, from `layout()` in `web/host/src/layout/grid.ts`). "Panel fills 85%" is a close
approach; the "far" sheet (panel 40% of the tile) is the honest lower bound.

## What "legible at the smallest tile" means here
Smallest tile 192x108 (100 players at 1920x1080). A sign is about to be passed when its panel is 85% of the tile height
(92 px). With the near chase camera's 60 degree vertical FOV that is a distance of 1.02 x the panel height from the camera:
warning 1.7 m, direction 1.4-1.6 m, tourist 1.2 m. The legend cap height there must be at least 6 px
(`signs.test.mjs`, and the Rust validator's `MIN_CAP_FRACTION` 0.065 of panel height). Measured cap heights (px):
bloody-big-jumps 7.7, jumps-crest 8.2, stuart-hwy 10.5/12.9/9.4, junction 10.5/12.6/11.7, red-centre 8.6/8.8/8.3,
lookout 20, rest-area 17.8, big-red-rock 22.9. Note: a real player passes a roadside sign at several metres, where the
same sign is 3-4x smaller on screen; that is a placement/scale question for M04, and the "far" sheet shows it.

## Looked at
- `smallest-tile-192x108.jpg` / `-x3.jpg` (1x evidence, 3x nearest-neighbour enlargement to read it): all 12 signs, panel 85% of tile. Pictograms, shield, brown legends read; warning text legend (7 px caps) and direction rows (about 8 px) are readable but small.
- `smallest-tile-far-192x108.jpg` / `-x3.jpg`: panel 40% of tile. Pictograms and tourist legends still read; warning text legend and direction rows do not (not legible).
- `mid-tile-274x216.jpg` / `-x2.jpg` (32 players): all legible, nothing clipped.
- `large-480x360.jpg`: full detail; checked border, lettering, arrows, shield, post mounting.
- `posts-in-world.jpg`: perspective, lit, on ground: posts and mounting heights read as real roadside signs.

## Defects found and fixed
- Kangaroo pictogram was a rotated blob, then a thin dinosaur; redrawn three times as an upright animal with ears, forelimb, thigh, foot, tail.
- Shield text ("B83") overflowed the shield; widened the shield and fitted the text to it.
- Direction rows were set at different heights; now one shared height set by the widest row (`rowHeight`).
- "JUMPS" legend touched the diamond border; legend chord now computed at the row's outer edge.
- Steep-descent wedge touched the border; pictogram scale reduced (found by the in-border vertex test).
- Unsealed-road surface line was fragmentary; now one continuous rough line.
- Text-only warning legend enlarged (tighter margin and line pitch).

- Round 2 (coordinator): direction panels now grow taller per row (`directionHeight`) instead of shrinking text; letter spacing tightened and legend margin reduced; the validator's length bound now comes from the fitted cap height. Warning text legends are at the limit of what a diamond allows (about 7.7 px at the smallest tile); a larger gain needs fewer or shorter words.

## Remaining defects
- Legibility at 40% panel size: the warning text legend and 2-3 row direction signs are unreadable; sign placement (M04) should put them where the car passes close, or rely on the pictogram signs for far reads.
- The kangaroo is a crude silhouette (recognisable, not elegant).
- Route shield colours (blue, white border) and the pictograms are drawn from memory of the conventions; no Commons image was copied or compared side by side, so fidelity is unverified (sidecars say "original").
- Not seen under the game's real material (toon ramp, outlines, halftone): flat `MeshBasic`/Lambert only.
- No bead filed for these yet; the owner/parent can cut them.

## Not covered
- Phones, WebKit, resize/full-screen: the signs are renderer geometry with no layout, so only tile sizes were captured.
- In-game placement on a map (M04 owns it) and the sim collider of a placed sign.
