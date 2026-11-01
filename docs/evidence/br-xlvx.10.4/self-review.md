# Self-review br-xlvx.10.4 (crossings on the TV)

Captured with `web/tests/journeys/lib/crossing-capture.mjs` (by hand, Playwright Chromium on the Mac, a local build served
by `jj-server`, `jj` release from the same tree, GENERATOR_VERSION 35), 2026-11-01. Both maps are laid by the generator
itself (`jj procgen --preset speedway`): the first speedway seed with a bridge crossing (seed 4) and with an overpass
leap (seed 0). The test surface's keys-and-pads drawer is hidden for the captures; everything else is the host as a TV
shows it. Numbers are in `capture.json`.

## Looked at
- `overview-bridge-1920x1080.jpg`, `overview-bridge-1366x768.jpg`: the empty course's whole-map overview of seed 4. The
  figure-eight-like crossing reads as one road over the other at the middle; both roads are full width.
- `overview-leap-1920x1080.jpg`, `overview-leap-1366x768.jpg`: seed 0's overview. The leap's kicker and the break in the
  upper road over the lower road read at the top right of the lap.
- `bridge-side-1920x1080.jpg`, `bridge-side-1366x768.jpg`: side-on at the moment the two cars meet (0.1 m apart in plan,
  6.5 m apart in height): the red Cruz on the deck, the white one on the lower road under it, the piers between.
- `bridge-deck-chase-*.jpg`: the deck car's own chase camera on the bridge; the lower road shows at the bottom left.
- `bridge-lower-chase-*.jpg`: the lower car's chase camera passing under: the deck's underside fills the top of the frame
  (dark, unlit) while the road ahead stays clear.
- `leap-side-*.jpg`: the leaper mid-flight, 12.5 m above the car on the lower road, the kicker's embankment in front.
- `leap-chase-*.jpg`, `leap-grid-*.jpg`: the leaper's chase camera in flight and the two-tile grid (leaper left, the car
  on the lower road right).
- `sight-bridge-deck-10s-1920x1080.jpg`, `sight-bridge-lower-road-10s-1920x1080.jpg`, `sight-leap-10s-1920x1080.jpg`: a
  car 10 s (250 m at 25 m/s) before each crossing, from its chase camera.

## Defects found and fixed
- Loop 1: the test surface's keys-and-pads drawer covered the left third of every capture; the tool hides it (it is a dev
  panel, not part of a room's TV).
- Loop 1: the bridge cars never met (closest 18 m apart): the tool timed them from each span's middle, not where the two
  levels cross, and gave them different throttles. It now starts both 40 m before the actual crossing point at the same
  speed and throttle.

## Remaining defects
- Sight 10 s out (`capture.json` `sight`, frustum only): the bridge is in the lower road's chase frame at 10, 7 and 4 s,
  but from its deck approach only at 4 s (a long left-hander hides it); the leap is in frame at 7 and 4 s, not 10. A
  crossing round a bend can't be seen 10 s out from its own position: it needs signposting on the approach.
  br-xlvx.10.5.
- From the leaper's chase camera alone a leap over another road doesn't read as one (the air camera holds the car's
  normal screen position, and the lower road is out of shot below); the side-on and the grid tile of the car beneath do
  show it. Taste call for the owner; not filed.
- The deck's underside is a flat dark band from the lower car's chase camera. Taste call; not filed.

## Not covered
- WebKit and real TVs: Chromium only, 1920x1080 and 1366x768.
- Phone-size hosts: crossings are a TV/laptop surface here; the controller is unchanged.
- The sight check is a frustum test (no occlusion ray); the captures were looked at for hills in the way.
