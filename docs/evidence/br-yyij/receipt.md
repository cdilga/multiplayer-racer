# P1-A05 / br-yyij: pin the lifecycle clock for engine assertions

2026-10-12, Mac arm64, Playwright headless Chromium with software GL; eight actual WASM cars joined through the worker's controller test path. This is browser emulation, not physical controllers.

CI 3492, browser (1), job 7895 failed the wheel-loss engine-stop assertion. The test combined a live 120 Hz worker clock with explicit 250-tick and 420-tick steps. On a loaded renderer, wall time could consume the entire respawn hold before the snapshot assertion.

Reproduction: the original test, with CDP 20× CPU throttling and an explicit 6.5 s main-thread stall between wheel damage and the 250-tick step, failed the same ignition=false assertion. Observed ticks advanced from 6226 to 7921: **1695 ticks**, although only **250** were requested. The actual car had one wreck and was already out of its hold. This establishes that the old assertion was inspecting a later lifecycle state. `stalled-before.log` contains the failure and observed facts.

With the test clock held before damage, the same throttle/stall advanced from 2325 to 2575: **exactly 250 ticks**. The real car had one additional wreck and was held; the audio bank exposed ignition=false. The subsequent explicit step observed ignition=true. `stalled-after.log` passes in 40.204 s; the focused unthrottled test passes in 16.317 s (`focused.log`).

The committed test checks the actual wreck counter and hold, then waits for the audio bank's state, retaining both original log assertions. No physics, engine implementation, gameplay timings, or test timeout changed. Fully stalled browser audio scheduling is not newly guaranteed by this test.

Command: `JJ_SERVER_BIN=/tmp/jj-macos-server-w01 node --test --test-name-pattern='A05: a scripted 8-car' web/host/tests/audio.test.mjs` with pinned Node and `AGENT_NAME=CyanBridge JJ_ROLE=solo`.

## CI 3558 follow-up: representative steady update cost

The lifecycle assertion passed in CI 3558/browser(1), job 8104; its cost assertion failed at 2.37 ms. The asserted
value was the bank's cached EMA after four two-car feeds across a profile change, not a steady eight-car measurement.
The original focused test passes locally in 23.403 s, so the runner's timing failure is not claimed as reproduced
on this Mac. The inspected measurement path establishes the mismatched sample.

The revised test feeds eight active engines on successive animation frames, warms up graph construction for 16
snapshots, then records 64 steady EMA samples. It asserts p95 below the same **2 ms** budget and explicitly checks
all eight engines are voiced. Offline rendering and the real worker's wreck/hold/ignition assertions remain intact.
No runtime engine code or test timeout changed.

MacBookPro18,3, macOS arm64, Node 26.10.0, Playwright headless Chromium 151.0.7922.34/software GL, existing local
`web/dist` with the unchanged engine implementation. `steady-cost.json`: eight-engine update p95 .228 ms, maximum
EMA .25 ms; eight engines render offline at 11.3× real time. This is a local browser receipt, not CI or physical hardware
playtest acceptance. `steady-cost.txt` records the focused revised journey passing in 22.430 s.
