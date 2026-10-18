# P1-C10 · Practice scene for newcomers: evidence

Build: v0.2-revamp at 78211e29 plus this bead's change, built in a scratch copy on eris (Linux x64); browser runs are
Playwright Chromium 151 headless with the GPU flag (`JJ_CHROMIUM_GPU=1`). Emulated phones, not the owner's devices.

## Design (and why)

- **Worker:** each practising seat gets its own `Sim` on the room's start map (the greybox loop) inside the host worker
  (`crates/jj-wasm-host/src/host/practice.rs`), stepped once per host tick *after* the round's sim. Nothing it does reaches
  the round: its car, events, laps and damage stay in that world (its own score namespace). A seat per world, not one shared
  practice world: a shared world would keep a departed practiser's car as an invisible obstacle (the sim never removes cars)
  and would let practisers collide with each other.
- **Protocol:** `ControllerCmd::Practice{on}` and `HostCmd::Practice{on}` (CMD_VERSION 7, goldens re-blessed). Sent before
  `Claim` (the join screen's *Practise first*), it applies to the seat the claim gets, so the newcomer never drops into the
  round first. A not-yet-seated phone hears the room's phase (`RoomState` without `you`) so the join card can offer it.
- **Join the race** (`Practice{on:false}`): the practice world goes, the seat's input state starts fresh, and the seat gets a
  round car through the same `car_wanted` path a late claim uses (`drop_in_as`, the tail), as a late entrant (R63). A racer
  who picks Practice from Help keeps its round car on the autopilot and takes it back with its next deliberate input.
  The next round's countdown (and the Lobby) end practice: practisers are on the grid with everyone.
- **Renderer:** one renderer, one scene. A practice car is a snapshot car record (id `0x40000000 + seat`, flag bit 9, its
  position moved onto a practice course 20 km from the round, 3 km per slot); the course's props come in a snapshot
  trailer (flags bit 1). `web/host/src/round/practice/` draws a course per slot (map, props, plain) and gives the chase
  cameras its ground and obstacles. Tiles follow car ids (they used ids as snapshot indices, which only held while ids were
  0..n). Practice cars are left out of the shadow box's centre and the arena Overview's framing. Every tile camera's far plane
  is 2 km, so a tile sees only its own course.
- **Shadows:** practice tiles draw after the round's tiles, each after moving the sun's shadow box over its car and redrawing
  the shadow map (one extra shadow pass per practising tile, culled to the practice course; the round's tiles keep the
  frame's one shared pass). Measured: +46 draw calls at 1280x720 with one practising tile (385 → 431), frames still at vsync.
- **Results reel:** practice cars never reach the round's highlights: the recorder (`web/host/src/reel/recorder.ts`,
  `roundOnly`) drops practice car records from every frame it keeps or measures for `air`, and practice actors from every
  event and identity; a practising racer's reel identity is its round car. Bug clips and the session record carry no car
  data from the page (clips are the round sim's journal, which never held the practice world), so nothing to exclude there.

## Cost (`journey-run.json`, native measurement below)

| measure | value |
|---|---|
| Native, release, one practice world step (greybox, one car) | **97 µs per tick** (1.2 % of the 8.33 ms tick) |
| Native, release, the host's whole tick with 4 racing + 1 practice world | 299 µs per tick |
| Browser worker, held clock, ms per tick (step + snapshot + messaging, median of 3) | round only 2.67 · with practice 2.51 · after join (5 racing) 2.54: inside the noise |
| Draw calls at 1280x720, 4 racers + QR tile → + practice tile → after join (5 round tiles) | 268 → 385 → 340 before practice shadows; 268 → 431 → 344 with them (journey-run.json) |
| Frame time (vsync-capped headless) | 16.6-16.7 ms in all three |

Native: `cargo test --release -p jj-wasm-host --lib practice_cost -- --ignored --nocapture` on eris (Linux x64).

## The round never sees it

- `practice::tests::a_newcomer_practises_while_four_race_then_joins_at_the_tail_and_the_round_never_notices`: two identical
  rooms with four racers; in A a newcomer practises (Practice first, steer, drive, brake, the C06 prompts to step 2) then
  joins; in B the same newcomer just claims at the join tick. The round's full-state hash is equal in both rooms at every
  tick, through practice, the join and 600 ticks after. (It caught a real bug: a practice sample two seconds old read as a
  dropout and handed the new round car to the autopilot; Join the race now starts the seat's input fresh, like a new joiner.)
- `web/tests/journeys/c10-practice.test.mjs` test 1: in the real host page, a bug clip saved after the join replays natively
  (`jj sim --replay`, `practice.replay.json`) through 4 checkpoint hashes, some taken while the newcomer practised, to the
  browser's own hash (`journey-run.json` `clip`).

## Files

- `journey-run.json`: the journey's measurements and outcomes; `practice.replay.json`: the native replay report.
- `captures/`: TV and phone captures (webp from the journey's PNGs); `self-review.md`: the visual self-review.
