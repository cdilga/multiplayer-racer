# br-8h3u.18 self-review: lap lines and the missed-gate UI

Journey: `web/tests/journeys/lap-lines.test.mjs` (3 tests, pass, 48.8 s). Hardware: eris, headless Chromium (Playwright),
ANGLE/Vulkan on an RTX 2080 Super (`JJ_CHROMIUM_GPU=render`), 1920x1080 viewport, real `jj-server`, debug build of `jj`.
Track: `outback-dirt`, track seed 2 (1529 m lap, one fork, one infield cut; room seed 1 + preparation 1). Cars are driven by
the test surface's `place` command (kinematic lines from the lap audit's own construction), not by a human or a phone.

## Looked at

- `branch-car-in-the-fork.jpg`: two-tile TV. Ava (left, red) is on the fork's grey gravel branch in lap 1; Bree (right, blue)
  is a lap-length behind on the road. Both read "Lap 1/3". No missed-gate UI anywhere.
- `wide-car-off-the-road.jpg`: Ava (left) on the road, lap 2/3; Bree (right) running wide out in open ground, nowhere near
  the road ribbon (the line goes up to 53 m off centre), also lap 2/3, still counting.
- `both-finished.jpg`: the results screen after the race: Ava 2:44.23 and Bree 2:53.38, both finished three laps (lap times
  are asserted from the room view: `finished` and three `lapMs` each). No missed-gate marks were shown (asserted empty).
- `cut-1-on-the-road.jpg`: the cut run, just before the car leaves the road: nothing flagged, normal HUD.
- `cut-2-missed-gate-on-the-tv.jpg`: the moment the host told the car it missed a gate, after it rejoined the road past the
  infield cut: the orange "MISSED GATE! GO BACK" label over the car, and an orange-and-ink chevron.
- `cut-3-driving-on.jpg`: 240 ticks later (about 70 m on): label and chevron still there, as intended (cleared only by taking
  the gate).
- `cut-4-beacon-in-a-second-tile.jpg`: a second player parked on the road 35 m before the skipped gate. Her tile (right) shows
  the beacon: a tall translucent column and a ring on the road in the cut car's red paint, and the small "MISSED GATE" label
  far off. Ava's tile (left) shows the label and the chevron. This is the beacon/arrow/text capture on the TV tiles.

## Defects found and fixed

- None in the shipped code. In the journey itself: `place` is a teleport that makes the race forget the car's last position
  (`Race::placed`), so placing every tick never crosses a gate. The driver now places a car and lets it fly 8 ticks at line
  speed, re-placing 6 points on (2 ticks of overlap), so no stretch of the line goes unwatched.

## Remaining defects

- The chevron does not read as "over the car" from the chase camera. It lies flat 3 m over the car's origin
  (`ARROW_LIFT` in `web/host/src/render/missed-gate.ts`), which is about the camera's own height, so it projects onto the
  horizon in the middle of the screen (`cut-2`, `cut-3`) rather than hovering above the car's roof. The words carry the
  message and the beacon is clear, but the arrow's direction is hard to read from there. Not changed: outside this helper's scope.
- The phone banner is not captured (see below).

## Not covered

- The phone's "MISSED GATE" banner: the journey's controllers are synthetic (hello/claim/ready frames through
  `__jjTest.input`), with no controller page, so the HUD `missed` bearing is only exercised natively. Needs a real controller
  page on a WebRTC connection (another journey).
- Overview camera: it is for derby arenas only (the button is disabled on a track), so the beacon is shown from a second
  player's tile instead.
- Other seeds and families, pits and layered roads (the audit covers those natively; this track has no loop, bridge or crossing,
  and the wide line is held to the road beside its set piece's pit); WebKit; a real device; physics-driven driving (the cars
  are placed along the lines, the race rules judge them).
- Line geometry is a port of `lap_audit.rs` and `jj_map::fork::path_of` (the branch's Hermite curve, linear height), not a
  call into them, so a change there needs the port updated.
