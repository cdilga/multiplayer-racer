# P1-A05 / br-yyij: pin the lifecycle clock for engine assertions

2026-10-12, Mac arm64, Playwright headless Chromium with software GL; eight actual WASM cars joined through the worker's controller test path. This is browser emulation, not physical controllers.

CI 3492, browser (1), job 7895 failed the wheel-loss engine-stop assertion. The test combined a live 120 Hz worker clock with explicit 250-tick and 420-tick steps. On a loaded renderer, wall time could consume the entire respawn hold before the snapshot assertion.

Reproduction: the original test, with CDP 20× CPU throttling and an explicit 6.5 s main-thread stall between wheel damage and the 250-tick step, failed the same ignition=false assertion. Observed ticks advanced from 6226 to 7921: **1695 ticks**, although only **250** were requested. The actual car had one wreck and was already out of its hold. This establishes that the old assertion was inspecting a later lifecycle state. `stalled-before.log` contains the failure and observed facts.

With the test clock held before damage, the same throttle/stall advanced from 2325 to 2575: **exactly 250 ticks**. The real car had one additional wreck and was held; the audio bank exposed ignition=false. The subsequent explicit step observed ignition=true. `stalled-after.log` passes in 40.204 s; the focused unthrottled test passes in 16.317 s (`focused.log`).

The committed test checks the actual wreck counter and hold, then waits for the audio bank's state, retaining both original log assertions. No physics, engine implementation, gameplay timings, or test timeout changed. Fully stalled browser audio scheduling is not newly guaranteed by this test.

Command: `JJ_SERVER_BIN=/tmp/jj-macos-server-w01 node --test --test-name-pattern='A05: a scripted 8-car' web/host/tests/audio.test.mjs` with pinned Node and `AGENT_NAME=CyanBridge JJ_ROLE=solo`.
