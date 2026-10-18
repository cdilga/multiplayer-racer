# Self-review P1-M-arena-features (br-0v6i): derby arenas get jumps, relief and an island

**What was built.** The generated derby arena (`crates/jj-procgen/src/arena/`, GENERATOR_VERSION 3) now has a *field*
inside the spawn ring (`arena/field.rs`): table-top jumps and kickers set roughly tangential round the middle, broad
mounds and shallow dips in the heightfield (1.25 m cells in an arena, so a lip is one crease), and a squat solid red rock
island (`rocks/dome`, 1.6-2.5 m tall) or, on bigger floors, a spine of three. The floor grows by 8 m for it (at least
31 m). `jj_map::arena` keeps the floor flat for 10 m in from the bank and holds the relief inside it (rise <= 2 m, dip <=
1 m, slope <= 0.6); the arena check lets solid rock stand only inside the field, squat, and floods the floor round it.
The derby bots steer round the island (`autopilot::Obstacle::detour`). Per-seed numbers: `arenas.txt`.

Captures: Chromium (Playwright) on eris, GPU (ANGLE/Vulkan, RTX 2080 Super), real jj-server, `host?room&test=live&mode=derby`.
The live ones have one phone (Davo, 915x412 Playwright mobile emulation, not a real phone) joined through the join page
and the rest bots on the autopilot; the `r11-*` ones are the `r11-overview` journey's own stills (synthetic controllers).

## Looked at

- `tv-overview-8-1920x1080.jpg` (TV, Overview, 8 cars, 6 s in): every car and plate in frame; the island reads as a round
  banded rock in the middle; the two table-tops read as darker rock patches; a takedown banner over two cars.
- `tv-overview-8-later-1920x1080.jpg` (TV, Overview, 8 cars, 18 s in): the frame pulls back to the whole bowl as the
  field spreads; cars on the bank and the floor all visible, none hidden by the island.
- `tv-grid-8-1920x1080.jpg` (TV, Grid, 8 cars, Davo's tile): the island dome beside Davo at car height (a ram target, lower
  than a car's roof line from the chase camera), a table-top as a raised dark patch ahead, bots on the bank.
- `tv-overview-24-1920x1080.jpg`, `tv-overview-24-later-1920x1080.jpg` (TV, Overview, 24 cars): 24 cars and plates in frame
  (a pile-up on the bank), the island and three jumps visible on the floor; the later one has a car in the air (`flying`
  1 in the probe).
- `tv-grid-24-1920x1080.jpg` (TV, Grid, 24 cars, Davo's tile): Davo riding the bank wall after a ram; nothing broken.
- `phone-derby-8-915x412.jpg`, `phone-derby-24-later-915x412.jpg` (phone, landscape, in the derby): the controller in the
  round (place, points and clock), Direct link, nothing clipped; the arena changes nothing on the phone.
- `r11-derby-overview-8-1920x1080.jpg`, `r11-derby-overview-24-1920x1080.jpg` (the journey's spread scene on the new
  arenas): all cars in frame, the island in the middle, jumps beside the cars.
- `r11-derby-grid-after-switch-1920x1080.jpg` (Grid after the mid-round switch): six chase tiles, the island visible from
  tile 2.

## Defects found and fixed

- A 0.7 m mound 4 m across high-centred a stopped car (two wheels in the air), and a peaked kicker did the same: mounds
  and dips are now broad (crest curvature <= 0.1/m) and kickers have a short deck; `nothing_in_the_field_traps_a_stopped_car`
  drops a car on every crease, crest, dip and beside every rock (480 placements, all drive off).
- Bots landed table-tops at 26-28 degrees (bad): a neutral car lands at the lip's pitch, so a 15 degree kick onto an 11
  degree down-ramp is past the OK band. Table-tops are now 12 up / 8 down; the fixture's bots land OK (13-14 degrees).
- The fixture's rival waited inside the bot's flight and was landed on; it now waits 20 m past the jump.

## Remaining defects

- The jumps' rock paint follows the terrain's nearest-sample rule (the sim's surface lookup), so on the TV a rotated
  table-top reads as a dark patch with stair-stepped edges, and from the Overview its slopes barely shade. It reads as
  "something there" but not obviously as a ramp. A smooth-edged paint or lip bands for arena relief is renderer work:
  filed as br-qb0l (P1-M-arena-features-paint).
- The Overview's unused ground is 0.555 (8 cars) and 0.544 (24 cars), against the provisional 0.35 target (before:
  0.582 and 0.562). The arena is still round; an oval (wider than deep) plan would meet it and is not done here.
- The 24-car top band overflows with names (pre-existing, P1-R11's band, not this bead's).

## Not covered

- A real phone and Safari/WebKit: the phone is Playwright Chromium mobile emulation. Portrait was not captured (the
  controller is landscape-first and portrait shows the rotate coach; the arena doesn't touch the controller).
- 32 cars live on the TV (the generator, validator and trap tests cover 32; the live captures are 8 and 24, the acceptance's
  Overview counts).
