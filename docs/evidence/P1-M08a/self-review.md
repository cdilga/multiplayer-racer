# Self-review P1-M08a

Captured with `node web/host/tests/prepare-capture.mjs` (real host page, `?test=live&room`, test build, fake controllers
through the real controller path, headed Google Chrome with the system GPU). The track is the procgen worker's four-biome
lap for seed 2 (preparation 1; the ladder's second course draw), swapped in at the Countdown.

## Looked at
- `tv-1080p-4-tiles.jpg` (1920x1080, four players): all four tiles race the generated track: tarmac with a white edge line,
  the finish chequer under Driver 4, W-beam guard rail sections and yellow-banded chevron posts along the outside of a
  corner (tiles 1-3), box buildings and cones beyond. HUDs (position, lap, boost) in the right places.
- `tv-1080p-1-player.jpg` (1920x1080, one player): single full-screen view, the GO banner still up at capture time, a corner
  with rail and posts beyond the car, the route's edge line.
- `laptop-1366-4-tiles.jpg` (1366x768, four players): the same four-tile layout at laptop size; nothing clipped or overlapping.
- `browser-run.json` / `capture.json`: the six browser test outcomes and the seeds, plans and preparation readout per capture.

## Defects found and fixed
- The first generated map would not render at all: the renderer had no kit module for the `wayfinding/*` pieces, the stage
  threw, and the round fell back to the Lobby. Stand-in registry entries and geometry added (they fit the collider bounds).
- The stand-in chevron board and rail posts stuck out of their collider bounds and failed the kit's 3 % bounds test; now they fit.
- An early capture caught the grid overlay mid-layout (tile HUDs offset, an old frame): the capture waits for the layout to
  settle. Not the preparation's doing, but worth knowing: the overlay lags a layout change by a moment.

## Remaining defects
- Every biome looks the same here (sand ground, generic boxes and posts): the biome kits (M04-M07) and R10's look pass own that.
- The road's edge steps on diagonals (tile 2): the known grid saw-tooth; the road ribbon is a host map-renderer follow-up.
- No GPU upload/shader warm-up before `MapReady` (see learnings).
- `map.test.mjs` "the greybox renders with distinguishable surfaces" fails on a plain `web/dist` host page (delta E 0): the page
  now opens the real room, whose Lobby is opaque (G01), so the canvas isn't visible. Not caused by this bead; that test
  needs to open a page that draws the map (`?synthetic&map`).

## Not covered
- Phones: nothing here is a controller surface. No resize/full-screen toggle pass.
- A real room with real WebRTC controllers: the captures use the test surface's fake controllers.
- The "failure -> Retry/Lobby" screen itself (the round screens are another helper's): the tests assert the room settles in
  the Lobby with the seat kept and nothing loaded.
