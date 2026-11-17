# Self-review br-bhkz.4: the derby arena's jumps and the crossover

Owner, 2026-11-17: "the jumps were really not good enough".

The measurements are in `jumps.md` beside this file (sim only). The stills here are from
`web/tests/journeys/derby-fun-capture.mjs` on 2026-11-17: a local build of the working tree (commit b83f481f plus the
arena generator 4), served by `jj-server`, Playwright Chromium 151 on an Apple Silicon Mac (`JJ_CHROMIUM_GPU=native`,
Metal). Six cars on a six-car bowl, every one on the autopilot (the clock is held); the canvas-only stills are
`__jjRender.peek` with the HUD hidden.

## Looked at

- `arena-from-the-rim.jpg`: the canvas, the whole bowl from above its rim at the start. The crossover sits across the
  middle (a ramp up, a striped deck, a ramp down) with a rock either side of the deck; two more jumps stand off it;
  boxes cover the floor but none sits on a ramp or the deck; the grid is on the flat rim, clear of everything.
- `crossover-flight-above.jpg`: the canvas from 17 m up, a bot (car 1) in the air over the deck between the two rocks,
  its shadow on the deck under it, a second car lining up behind. The gate is wide enough to read as a gap to fly
  through; the ramps' stripes mark the lips.
- `crossover-flight-ahead.jpg`: the canvas from ground level beyond the far ramp: the ramp's face, the deck's edge and
  the two rocks either side, cars cresting the lip. The ramp reads as a real climb (about 1.7 m) next to the cars.
- `tv-1920x1080-grid-crossover-flight.jpg`: TV Grid at the same moment. The flier's own tile (#1) looks down the deck
  from its chase camera with both rocks in frame; nothing in the HUD covers the car.
- `tv-1920x1080-overview-crossover-flight.jpg`: TV Overview at the same moment. The crossover, its rocks and the other
  jumps all read from the Overview; no rock or ramp hides a car or a name label.
- `plan-8.png`, `plan-32.png`: plan views drawn from the height grid by the helper's script (not game renders): the
  crossover through the gate, the jumps either side, the field's edge.

## Defects found and fixed

- The briefed shape (two ramps with the rock in the gap between them) trapped stopped cars on its peaked lips and
  needed about 19 m/s to clear: built as a deck through a gate of two rocks instead (`jumps.md`, "Why the crossover is a
  bridge").
- A car that came down square on a rival's roof damaged only itself and the rival scored: fixed in the hit rules
  (b83f481f).
- The first side-on still of a flight was taken from behind a gate rock: retaken from ahead and from above.

## Remaining defects

- At 12 m/s a car mostly lands short on the crossover's far ramp (one bad landing in six at that speed; it costs a
  quarter of its speed and keeps its wheels).
- In the 8-car bowl a 24 m/s flight off a side jump reaches the bank (it landed OK there).
- The crossover is a deck, not a gap: nobody drops into anything. The rocks are the only jeopardy.
- From its own chase camera a flier sees the deck rush under it rather than a drop; the flight reads best from the
  Overview.

## Not covered

- People driving it: bots only. Whether a person finds the run-up and wants the jump is the playtest's call.
- Arenas for more than six cars in a browser (8, 24, 32 and 1000 are in the tests and the plan views, not captured).
- Roster cars other than the Cruz on the lips.
- The published preview, a real phone or TV, Safari or WebKit.
