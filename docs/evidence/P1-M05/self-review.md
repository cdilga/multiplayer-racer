# Self-review P1-M05 (Rocks, the Olgas)

Captured with `node web/host/tests/biome-capture.mjs rocks` (real host page, `&recipe=rocks`, seed 2; autopilot cars stepped to
the middle of the rocks stretch, point 158; headed Chrome). Reference: `art/references/australia/generated/biome-rocks-olgas.png`
(`-incorrect-signs.png` is the negative example).

## Looked at
- `domes-tv-1080p.jpg` (1920x1080): a light graded-dirt road with cream edge lines winding between tall banded red towers (four
  to five of them, the nearest cut by the frame edge), shadows on the red ground, spinifex and a green flowering shrub with pink
  dots, rail and posts on the far bend, a faint purple feature pad far down the road.
- `domes-tiles-1080p.jpg` (four tiles): the same towers from four cars; the lower tiles show a pale-yellow rectangle on the
  road (the core's feature marker) and the cars bumping each other.
- `domes-laptop-1366.jpg` (1366x768, four tiles): same scene at laptop size; a yellow feature marker and a black-and-yellow
  marker piece on the road in the lower tiles.
- `plot-rocks.png`: top-down: towers (dark red squares, some very large) on both sides of the road, smaller stacks near it.
- `validator-rocks.txt`: ten seeds validate; dome heights differ per seed; the jumps and crests are the core's.
- Against the reference: tall banded red towers beside a dirt road, spinifex and flowering shrubs. The reference's ledges,
  boulder piles and rock-walled ramp are only the smaller dome rule here; the yellow/purple pads are the core's feature markers.

## Defects found and fixed
- The first rocks capture showed no dome: towers were too sparse; now every 26 to 60 m, with a stack rule every 10 to 26 m.
- Domes hovered where the ground fell away; a big piece now stands on the lowest ground under it, sunk 0.3 m.
- A jump with no steep-descent warning (the sign's spot was on a corner or blocked): signs now try nearby spots and the other side.
- The packed-dirt road read poorly against the ground: graded dirt is now `#e0b684` against `#a4502e` earth (dirt readability: see P1-M06).

## Remaining defects
- A tower is stacked frustums in four reds: smooth bands, no ledges or fractured slabs; none on the skyline (pieces must lie
  inside the map's bounds).
- The jump ramp is the core's marker pad and the ramp's heightfield, not a rock ramp with stone walls.
- Dome heights vary per seed through the dressing stream, as the contract says; there is no other height parameter.

## Not covered
- Phones, a resize/full-screen toggle pass, WebKit, and a fresh-eyes review by someone other than me.
