# P1-G05 evidence

- `native-calibration.txt`: `crates/jj-sim/tests/crashes.rs` on the sim alone. The three staged collisions of
  `scenarios/crashes/jn4-crashes.json` take parts loose and then off (side swipe: car 0 `door_FL` and car 1 `door_RR`
  loose; T-bone into car 1: its `door_RR` detaches, car 2's `front` goes loose; head-on, car 2 against car 3: car 2's
  loose `front` detaches, car 3's goes loose); every piece of debris is a dynamic body; every car drives away; the
  journal replays to the same full-state hash.
- `test-hooks.patch`: the two test hooks the browser journey needs, outside the gameplay lane's paths (`git apply`):
  the test surface's `place` command (`crates/jj-wasm-host/src/host/testing.rs`, a journaled `place_car`, so clips replay it)
  and `__jjRender.tilesSee` (`web/host/src/render/world.ts`, `web/host/src/main.ts`: which of some world points each
  tile's camera has in view, for "the debris is visible in the tile of the car it came off").
- The journey is `web/tests/journeys/jn4-crashes.test.mjs`. It writes `browser-run.json`, `crashes.jjclip`,
  `crashes.replay.json` and `captures/` here when it runs on eris:
  `scripts/remote/eris.sh --run g05 'scripts/build-host-wasm.sh && JJ_BIN=target/debug/jj node --test web/tests/journeys/jn4-crashes.test.mjs'`
  (after the patch is applied and committed).
