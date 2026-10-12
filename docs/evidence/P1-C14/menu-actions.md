# Reliable paused Controllers actions — br-799j

Based on 518c795f plus the committed repair. Solo Mac Playwright Chromium/WebKit, loopback real jj-server/WebRTC; emulated Gamepad API, real keyboard and pointer events. Rust commands invoked through RCH, which selected local per-crate fallback for the Darwin target. No physical pad/device claim.

- `rch exec -- cargo test -p jj-wasm-host`: 49/49 pass, including paused command admission/resume sample discard, new seat after Leave/Add, and no active car retained by a left seat.
- `rch exec -- cargo test -p jj-session -p jj-protocol`: green, including final Sit out choice winning before a tick without cancelling Leave.
- `npm --prefix web run typecheck`: green.
- Rebuilt testing and production host WASM before journeys.
- Real owner journeys in Chromium/WebKit and JN5: 3/3 pass. JN5 grew to twelve and shrank to two through Lobby/Countdown/Running/Intermission; five late joins p95 271 ms locally. Owner journey also verifies chooser, keyboard/pad Ready, catch-up default/copy, manual Recover retaining damage, intact wreck respawn and persistent dynamic remains, paused Leave/Add and unplugged-device Remove.
- 80 local screenshots (see actual file list in the supplemental review) inspected in `../br-f1di/local-controls-final/self-review.md`; screenshot count is defined by that list.

Logs: `../br-f1di/local-controls-final/`. Full remote workspace check attempted with `RCH_REQUIRE_REMOTE=1`: refused with exit103 because one worker is under storage pressure and the other is busy with this project's procgen suite. No local workspace-wide check ran. Full containing CI and deployed visual review still required before close; owner's couch taste check remains a separate gate.
