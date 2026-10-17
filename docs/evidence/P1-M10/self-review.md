# P1-M10: the derby bowl in the real host

**Checks.** `web/tests/journeys/m10-bowl.test.mjs` loads the 8- and 32-car arenas (maps/derby-bowl-8.json and
maps/derby-bowl-32.json, the generator's output) in the real host. It places every car through the start grid, steps 2 s
and looks from the host's fixed overview camera (a harness camera; R11's Grid/Overview switch is its own bead). It asserts:
- every car is upright inside the bowl and in frame;
- at least one rock is in frame;
- no rock stands inside the bowl;
- no rock's top projects over the floor.

It passes on eris at 4cbf25f1 in Chromium, both SwiftShader and GPU (ANGLE Vulkan). The containment, transition, 8/16/32
validation and WASM byte-identity criteria are `crates/jj-procgen/tests/arena.rs`, `wasm_parity.rs` and
`scenarios/derby/bowl-containment.json` and `bowl-transition.json`, which pass in CI's rust lanes.

**Fixed while looking** (world.ts, map/map.ts):
- With cars on the field, the overview framed the cars alone. At 8 cars that's the floor, with no rock in sight. It now
  frames a derby bowl out to its nearest rock, at any car count (R107).
- A bowl's ring route (the line the bots drive) was drawn on the floor as a road, with white edge lines and a chequered
  start line (`before-overview-32-cars-1920x1080.jpg`). A derby floor has no road; the route still drives the bots.

## Looked at

- `overview-8-cars-1920x1080.jpg`: the bowl from the overview at 8 cars.
  - The banked wall and pale lip read as a quarry bowl, and the floor is clear and plain.
  - The rocks' domes ring it on every side, standing outside the lip. The near ones stand in front of the outer wall,
    never over the floor.
  - The 8 cars sit packed in two rows on one side (the arena's start grid), with their number badges beside them.
- `overview-32-cars-1920x1080.jpg`: 32 cars in an arc round the floor, all inside, with rocks round the whole bowl. There's
  no shrinking wall or closing mechanism, and none in the code.
- `before-overview-32-cars-1920x1080.jpg` (before the fixes): the camera framed the cars' arc only (no rocks), and the
  route ribbon and start line were on the floor.

## Defects found and fixed

- No rocks in frame at 8 cars; the route drawn as a road with a start line on the bowl floor.

## Remaining defects

- The domes' long shadows fall across the floor at this sun angle. They're shadows, not occlusion, but they darken a
  third of the floor.
- The arena's start grid packs 8 cars into two rows on one side, and their badges overlap. A derby start would read better
  spread round the floor (for P1-G06, which starts derby rounds).
- At 32 cars the overview's number badges overlap where cars bunch.

## Not covered

- Phones (the bowl is a TV view); a derby round in a room (P1-G06); WebKit captures; a real TV.
