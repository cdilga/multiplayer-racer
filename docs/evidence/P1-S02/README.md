# P1-S02: the host's sim worker (jj-wasm-host)

`crates/jj-wasm-host` puts jj-session + jj-input + jj-sim behind the worker ABI (`jj_protocol::abi`):
`host::Host` is the native-testable core, `HostSim` the wasm-bindgen face, `web/host/src/worker/sim.worker.ts` the
module worker and `client.ts` the main-thread side. `scripts/build-host-wasm.sh` builds the pkg (release:
3,366,140 B `jj_wasm_host_bg.wasm`, 1,135 kB gzipped).

Two layers of tests, both in CI:

- **Native** (`crates/jj-wasm-host/src/host/tests.rs`, 7 tests; the `rust` job): cadence, source parity, hide/resume,
  neutral re-arm, long stall, fault, snapshot layout.
- **Browser** (`web/host/tests/worker.test.mjs`; the `host-worker` job): the release WASM in a real module Web
  Worker in headless Chromium, through `web/host/tests/harness.html`. `browser-run.json` is what the Mac run measured.

Mac run, 2026-10-03: Chromium 151.0.7922.34 (Playwright 1.62.1 headless shell), darwin/arm64. 5/5 pass in 52 s.

## AC1: render cadence never changes the simulation

The native pad script (full throttle 2 s, steer 2 s, coast; a LocalSource sample every 6 ticks), stopped at tick 720.
The renderer holds each snapshot until its next frame and burns main-thread time per frame.

| Render | Work per frame | Frames | Snapshots | Tick | State hash |
|---|---|---|---|---|---|
| 30 Hz | 20 ms | 186 | 403 | 720 | `fe330ab11c007e9ffcc358c287f23e25cc9d81d777af0bdfd3eca835cfbae6a6` |
| 60 Hz | 8 ms | 384 | 711 | 720 | `fe330ab11c007e9ffcc358c287f23e25cc9d81d777af0bdfd3eca835cfbae6a6` |
| 144 Hz | 2 ms | 1020 | 720 | 720 | `fe330ab11c007e9ffcc358c287f23e25cc9d81d777af0bdfd3eca835cfbae6a6` |

The worker's own timer cadence (30/60/144 Hz and an irregular 3 ms) is the native
`render_and_worker_cadence_never_change_the_simulation`.

## AC2: §7.3a source parity

The same driving through the controller wire (Hello, Claim, then state records on the Welcome's source handle)
gives `fe330ab1…e6a6` at tick 720, the LocalSource hash. The phone got its Welcome and a `SeatJoined` event.

## AC3: hide pauses with no catch-up; resume counts down with neutral input

Visibility is **emulated** (`document.visibilityState` plus a dispatched `visibilitychange`, the path
`SimClient.followVisibility` listens on): headless Chromium never hides a page.

- Hidden at tick 245 for 2 s: pause reason `host-hidden`, no ticks.
- Shown: 2,801 ms left on the countdown 200 ms later; the first tick came 3,022 ms after showing; then 121 ticks in the
  next second (real time, not the hidden seconds replayed).
- Re-arm: the pad held full throttle when the page hid and its last samples arrived during the pause; the first tick
  after the countdown (368) drove with throttle 0, and fresh input drove at 1.0 again.

## AC4: starving snapshot buffers never blocks physics or drops events

Thirty phones join (Hello + Claim every 20 ticks) while the pad drives; a fed run against a run whose renderer never
returns a buffer (pool of 3):

| Run | Published | Skipped | 720 ticks took | Event/outbound lines | Hash |
|---|---|---|---|---|---|
| fed | 719 | 0 | 6,130 ms | 61 | `1625252b…a9aca4` |
| starved | 3 | 717 | 6,138 ms | 61 | `1625252b…a9aca4` |

31 `SeatJoined` events and 30 Welcomes; the two runs' event and outbound streams are identical line for line (events
compared one per line, since an `Events` batch's boundaries depend on the worker's cadence).

## AC5: a worker panic is the `fault` pause reason

`debug_panic()` at tick 62: main got `fault` (`RuntimeError: unreachable`), `pauseReasons()` = `["fault"]`, and the
tick stayed at 62. The native `a_fault_stops_the_sim` covers the core.
