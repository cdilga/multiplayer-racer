# Self-review P1-M04 (Town)

Captured with `node web/host/tests/biome-capture.mjs town`: the real host page (test build, `?test=live&room&recipe=town`),
the procgen worker's town track for seed 2 swapped in at the Countdown, fake controllers through the real controller path,
the cars on the test surface's autopilot and the sim stepped until the lead car is at point 36-37 of the town (a bit past
the start); headed Google Chrome. Reference: `art/references/australia/generated/biome-town.png`.

## Looked at
- `street-tv-1080p.jpg` (1920x1080, one player): the car on a left-hand bend of dark tarmac with cream edge lines, red-earth
  ground, a row of W-beam rail sections and yellow-banded posts along the outside of the bend, a grey water tower and about
  nine gum trees (grey trunks, green domes) on the skyline. No building, mailbox or sign is in this frame.
- `street-tiles-1080p.jpg` (1080p, four tiles; the cars run bunched together and bump): a tan shopfront with dark windows
  at the left edge, a house with a grey roof in the lower tiles, a small green mailbox, a dark side-street stub joining the
  road on the right, and in the lower tiles the green "PRINCES HWY / ADELAIDE / MELBOURNE" direction sign with a yellow
  diamond warning sign beside it; rail and posts on the bend, trees and the water tower beyond.
- `street-laptop-1366.jpg` (1366x768, four tiles): the same scene at laptop size; the shopfront, mailbox, junction stub and
  the direction sign are all readable; nothing clipped.
- `plot-town.png`: the whole lap top-down: rows of houses and shopfronts (orange squares) along the long straights on both
  sides, side streets joining, gum trees across the plain, chevron posts on the corners only.
- `validator-town.txt`: ten seeds through `jj_procgen::validate::check`, with the piece tallies.
- Against the reference: the street, low buildings facing it, mailbox, junction with a direction sign, gum trees and water
  tower are there. The reference's power poles with wires, bins at the shopfronts, verandahs and the dense frontage are
  thinner here (poles and bins exist in the data but aren't in these frames).

## Defects found and fixed
- The first capture script drove the cars open-loop and they left the road; captures now step autopilot cars to a named place.
- The side-street stub shimmered (z-fighting with the ground); it is now a 300 mm pad whose base sits at the lowest ground under it.
- The road edge stepped at the grid's spacing on diagonals; the map renderer now draws the road as a ribbon that follows the ground.
- A junction sign could be lost when a building was in its spot; signs now try nearby spots and the other side.

## Remaining defects
- No building is in the 1080p one-player frame: the buildings are on the straights, this frame is on the first bend.
- The house's roof-pitch parameter is data only (one kit id has one geometry); width, depth and height do vary.
- Poles have no crossarm or wires; houses are boxes under a gable; the verandah is a slab and two posts.
- The cars bunch and bump at the start of the autopilot run (they start in a grid and take the same line).

## Not covered
- Phones, a resize/full-screen toggle pass, WebKit, and a fresh-eyes review by someone other than me.
