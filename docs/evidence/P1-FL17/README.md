# P1-FL17 (br-bbki.17): thumb-to-screen latency, stage by stage (R134)

## What is measured

`web/tests/journeys/fl17-latency.test.mjs` runs the real host (`/host?drive&test=live`) and a real phone controller from
one build, served by jj-server, joined through the real path over WebRTC. CDP touch events move the phone's drive stick
300 times at about 30 Hz. One state batch is stamped along the whole path on one clock (`performance.timeOrigin + now`;
both pages run in one browser on one machine), and the stamps are joined by the batch's wrapping seq:

| Stage | From → to | Where stamped |
|---|---|---|
| touchToSend | the touch event's own `timeStamp` → the batch handed to the data channel | `sticks.ts`, `session.ts flush` |
| network | sent → off the data channel on the host's main thread | `net/bridge.ts` (`arrivedAt`) |
| mainToWorker | main thread → the sim worker | `worker/core.ts` (`receivedAt`) |
| workerToTick | in the worker → applied at a 120 Hz tick boundary | `core.ts applied()` (`appliedAt`, tick) |
| tickToDrawn | applied → the first frame drawn at or past that tick | `render/world.ts tickTrace` |
| total | touch → drawn | |

`renderLagTicks` is how far each drawn tick trails the newest snapshot. Probes: `__jjController.latency()`,
`__jjTest.netStamps()`, `__jjRender.tickTrace(on)`. `JJ_LATENCY_OUT=<file>` writes the receipt, which lists the five
slowest touches by their place in the run.

## Budget (committed: `web/tests/journeys/lib/latency-budget.json`)

- **hostSideGpu, the budget**, gated with a real GPU (`JJ_CHROMIUM_GPU=1`). fl17 is on the CI GPU list, so it runs on
  eris on every push:
  - mainToWorker p99 ≤ 8 ms.
  - workerToTick p99 ≤ 16.7 ms: two ticks, one boundary plus the worker's 2 ms loop.
  - renderLagTicks p99 ≤ 5.
  - tickToDrawn p99 ≤ 60 ms.
- **hostSide, a regression bound for CI's software-rendered browser lanes**: mainToWorker p99 ≤ 25, workerToTick
  p99 ≤ 35.
  - A loaded runner draws at 7-30 fps and starves the main thread and the worker. Run 5000: frame p99 133 ms,
    mainToWorker p99 8.6, workerToTick p99 18.1, which failed a tight bound there.
  - That measures the runner, not the game. The bound is about three times the budget, so it still catches an added
    queue or a lost tick boundary.
- **wholePath, the target for a real run on the owner's LAN, reported but not gated**: touchToSend 4/34, network 10/40,
  mainToWorker 2/8, workerToTick 7/14, tickToDrawn 40/60, total 75/120 (p50/p99 ms).

## Runs (labelled honestly)

All runs are **Playwright Chromium, headless, host and phone as two contexts in one browser on one machine**. "LAN" is
loopback WebRTC (host candidates on 127.0.0.1), not Wi-Fi; "TURN" is a local coturn 4.7.0 container on 127.0.0.1 with
`ice=relay` forced on both pages, so it measures the relay hop's processing, not a WAN path. No real phone, no real
Wi-Fi: those wait for the owner's couch test. Network references from real paths are P1-N08's qualify numbers
(cloudflare-443 RTT p50 19 / p99 37 ms, coturn-lan 16.5/34.5, wifi 38/71), which are references, not this bead's
measurements.

### Before (`before-eris-gpu.json`): eris, RTX 2080 SUPER, driver 610.57.04, `JJ_CHROMIUM_GPU=1`, build 46a0668f

| p50 / p99 ms | touchToSend | network | mainToWorker | workerToTick | tickToDrawn | total | renderLag (ticks) |
|---|---|---|---|---|---|---|---|
| LAN | 18.5 / 37.7 | 0.6 / 3.4 | 0.0 / 1.4 | 3.9 / 9.3 | 26.9 / 67.8 | 56.5 / 104.5 | 3 / 7.5 |
| TURN | 19.3 / 38.3 | 0.5 / 5.3 | 0.1 / 1.2 | 4.2 / 9.4 | 35.1 / 38.4 | 60.7 / 80.8 | 2.7 / 3 |

The LAN run's p99 render lag (7.5 ticks) coincided with the CI GPU workflow running on the same machine; none of the
four later GPU runs repeat it (below).

**The largest stage the game controls was touchToSend**: p50 ~19 ms, p99 ~38 ms, for a stick that is only a few lines
of code. Chromium delivers `pointermove` aligned to the next animation frame (up to ~17 ms after the touch), then the
session waited for its 8 ms poll before sampling and sending. tickToDrawn is larger at the p50, but most of it is the
renderer's deliberate 3-tick (25 ms) interpolation delay, which br-gw74.14 set to stop judder (see "Next lever").

### The reduction (286a650a, 24a3e37f)

- `sticks.ts`: the stick also listens to `pointerrawupdate` where the browser has it (Chromium, secure contexts), which
  is not held for the frame. `pointermove` still counts (Safari, synthetic events); a move seen twice lands on the same
  point.
- `session.ts setSticks`: a stick change samples and flushes immediately. The jj-input scheduler still paces sends
  (16 ms between changes, 50 ms refresh), and the 8 ms poll still covers refreshes and changes held by the gate. The
  jj-input gesture detectors are time-based (`now_ms`), so sampling at input rate doesn't change what they detect.

### After (`after-ci-gpu.json`): the CI GPU workflow on eris (same machine and GPU), four pushes

| p50 / p99 ms, LAN | touchToSend | network | workerToTick | tickToDrawn | total | renderLag (ticks) |
|---|---|---|---|---|---|---|
| run 4972 (611000ac) | 0.9 / 31.6 | 0.5 / 2.5 | 3.7 / 8.8 | 35.7 / 39.8 | 43.8 / 65.3 | 2.5 / 2.7 |
| run 4981 (6cb685db) | 0.9 / 29.4 | 0.4 / 2.2 | 4.0 / 8.6 | 26.4 / 43.3 | 37.3 / 65.2 | 2.9 / 3.4 |
| run 4987 (10fc5268) | 1.6 / 19.1 | 0.7 / 8.3 | 4.1 / 9.5 | 34.8 / 38.7 | 42.8 / 66.6 | 2.7 / 3.1 |
| run 4989 (2401e3c9) | 1.7 / 32.3 | 0.9 / 8.0 | 4.6 / 10.0 | 37.2 / 41.0 | 44.2 / 77.7 | 2.4 / 3.4 |

touchToSend p50 went from 18.5 to 0.9-1.7 ms. The total p50 went from 56.5 to 37-44 ms and the p99 from 104.5 to
65-78 ms. The p99 that's left (~30 ms) is a touch arriving while the scheduler's 16 ms change gate is closed: it waits
for the gate, then the next poll. The Mac (Apple GPU, 120 Hz, `JJ_CHROMIUM_GPU=native`) agrees: touchToSend 0.6 / 9.6,
total p50 ~33 ms.

**TURN after: not yet re-run.** eris.sh refuses while eris's clone holds someone's untracked debug test. The change
is entirely on the controller, before the network stage, so the TURN path gains the same touchToSend drop; the
re-run is recorded here when it lands.

## Next lever (not taken here)

- **The render delay**: tickToDrawn ~27-37 ms p50 is `DELAY_TICKS = 3` (25 ms) plus up to one frame. renderLagTicks
  p99 stays at ~3 ticks on a GPU, so 2 ticks may hold. That's a judder risk (br-gw74.14), and it should be judged with
  `interp-clock` and a camera capture, not by this probe alone.
- **The send gate's p99**: when the 16 ms gate holds a change, a timer at the gate's opening, instead of the next 8 ms
  poll, would trim ~4 ms. That's in jj-input's scheduler.
