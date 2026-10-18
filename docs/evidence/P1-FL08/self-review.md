# P1-FL08 (br-bbki.8): the start-line lab scene

**What was built.**

- **The scene** `start-line` in `assets/lab/scenes.json`: an outback-bitumen oval built by the real generator with
  300 m straights and 45 m bends. It has the start/finish gantry and the full grid, and nothing else.
  - `maps/lab/start-line.json` is the map.
  - The Feel Lab's scene picker offers it like the other `maps/lab/` scenes.
- **Lab runs can carry more of the fixture** (`Run.fixture` in `crates/jj-procgen/src/lab.rs`):
  - keys that replace the run's own, such as a full grid (`cars: []`, `grid: N`), a `race` with its countdown, stick
    `inputs` and `autopilot` for every car;
  - `expect` rows that name their own car.
- **Runs (jj fixtures):**
  - `scenarios/lab/start-line-launch.json`: eight cars on the grid, with the countdown holding them until GO at
    tick 360.
    - Car 0 snaps early (tick 300): a false start, launch forfeited (`wheelieDriveS` 0).
    - Car 1 pulls through the countdown and snaps at GO: the perfect launch (`wheelieDriveS` 0.79).
    - The other six are on the autopilot.
    - Nobody moves before GO (every car under 0.2 m/s at tick 359).
    - 1.5 s after GO, car 1 is 39 m down the straight against 10-11 m for everyone else (envelope 30-48 against 7-15).
  - `scenarios/lab/start-line-lap.json`: a grid of four on the autopilot holds through the countdown, then every car
    finishes one lap with no wreck.
- **Bug found and fixed: the countdown didn't hold an autopiloted car.** The sim's autopilot replaced the host's grid hold
  with its own controls, and the host never held its bots. Bots (the carnage bowl's twelve) and autopiloted seats
  drove off before GO.
  - In the sim (`Sim::step`), the grid hold now wins over the autopilot.
  - The host holds its bots with the grid (`RoundState.bot_cars`).
  - The fixture runner holds every car in a countdown, not only stick-driven ones.

**Checks.**

- `jj sim` on both fixtures: pass, and the replay matches. jj-procgen `lab` passes 4/4 (the committed map and fixtures
  are a fresh build).
- jj-wasm-host passes 63/63 with `--features testing`.
  - `bots_join_a_derby_round_on_the_autopilot_and_score` now asserts nobody rolls before GO (under 0.5 m/s).
  - The mixed-roster hash is re-blessed (`scenarios/roster/mixed-host.json`): it was already red at HEAD, because the
    roster grew (the AU Hawk) and the br-bwju.11 rebakes changed it, so the hash wasn't moved by this change.
- jj-fixture tests pass, and clippy is clean (jj-fixture, jj-sim, jj-wasm-host incl. testing, jj-procgen).
- Journey `web/tests/journeys/fl08-start-line.test.mjs`, run in the real worker and renderer on eris (Chromium with GPU,
  and WebKit; 2/2):
  - the grid of eight is held from tick 120 to GO (under 0.3 m);
  - car 1 gains more than twice anyone else's distance by tick 540.
- Not passing: the scenario bank (`every_scenario_in_the_bank_passes`) and the lab-scenes journey, both on
  `off-road-climb`. That was already failing at HEAD before this change (the Tradie Ute ends 2.6 m up the bank, not
  5 m), and is being fixed separately (br-bbki.12). The new start-line runs pass in the bank.

## Looked at

- `chromium-grid-chase-1920x1080.jpg`: the chase camera on the grid at tick 359. Two cars (#1 and #2, roof numbers) sit
  under the START · FINISH gantry on the chequered line, held. The open straight runs ahead to the far bend.
- `chromium-grid-overview-1920x1080.jpg`: the whole oval from above, with all eight plates (#1-#8) bunched on the grid at
  the right-hand end of the near straight.
- `chromium-launch-chase-1920x1080.jpg`: half a second after GO, car #2 is alone down the straight, passing under the
  gantry (the dark band at the top), with the Stuart Hwy sign beside the road. No other car is in shot.
- `chromium-straight-overview-1920x1080.jpg`: 1.5 s after GO, #2 is clear ahead along the near straight. The other seven
  are still bunched by the line.
- `chromium-straight-chase-1920x1080.jpg`: #2 down the long straight, the far bend's rock cuttings and the barrier
  boxes ahead.

## Defects found and fixed

- **Grid didn't hold autopiloted cars**: the countdown hold didn't apply to them (see above). Fixed in the sim, the host
  and the fixture runner.
- **Journey timed out waiting for models**: it waited for all eight cars' models to report loaded, which they never do
  in the test page. It waits for car 0's now (every car is the Cruz).

## Remaining defects

- The host test page's Keys & Pads panel covers the top left of every capture. It's the test page's lobby UI, not the
  scene.
- A fixture car with no seat is plated "#1 Bot" (the carnage bowl's naming). On the test page that includes the lab
  driver's own car.
- Overview plates on a held grid of eight overlap each other.

## Not covered

- The Feel Lab's picker loading the scene into a live round with phones, and the countdown's audio. The scene loads
  like the other lab scenes, through the same path the carnage bowl's live run used.
- A real TV, and the phone's launch gesture on a device (the owner's Q02 checklist).
