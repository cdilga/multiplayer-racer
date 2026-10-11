# P1-W01.3 queue and lifecycle integration

2026-10-11, CyanBridge. Implementation remains in progress; this is not a close receipt for a delivered weapon/buff or the visual parent.

The validated item cards now feed a two-slot FIFO transaction ledger in jj-sim. Physical activation commits before consumption; failures retain the front item and its remaining uses. The ledger keeps causal seat/life, arming and expiry ticks and unbounded effect identities. Respawn clears held items; expiry/round retirement returns effect records and owns no physics debris.

Sim pickups append a journal variant without changing existing indices. Held inventory takes precedence over OI!/cones. The host sends reliable inventory deltas and item events to the correct source wrapper, and ActionResult reports a specific use refusal. The room's data carries inventory. The testing pickupItem command offers a box to a real seated car; observe exposes every queue, effect, event and refusal.

Physical W02/W03 handlers are not implemented yet: the sim refuses activation as Unavailable, keeping the item. The successful-use FIFO shift and effect retirement are verified in the transaction kernel; this does not claim a physical effect in the running game. W04 boxes/stations and W05 HUD/presentation remain outstanding.

Verified:

- RCH eris, native jj-sim item_queue, utility and determinism: 15/15 pass (8 item tests, 4 utility tests, 3 determinism tests). Actual sim pickup/full/refusal/Recover/round-cleanup journals replay to identical hashes. Dynamic debris remains present and falling after round end.
- RCH eris, jj-wasm-host with testing: existing 47/47 library tests pass. New source-routing test 1/1 passes: two hub sources claim normally and Ready into Running; only the first receives its held inventory, two pickup events and Unavailable refusal. A third full-queue offer and duplicate ACTION add no extra transaction; round end sends empty inventory.
- RCH eris cargo check --workspace passes; Clippy for jj-sim, jj-wasm-host/testing and jj-fixture, all targets, -D warnings passes.
- scripts/build-host-wasm.sh release succeeds locally within the Mac target budget. Mac Apple M1 Pro, macOS 27.0.1, Node 26.10.0, Playwright Chromium/SwiftShader: node --test web/tests/journeys/w01-item-queue.test.mjs passes 1/1 in 12.7 seconds. A phone joins through the real jj-server/WebRTC path, skips Help, readies into a race, receives two item ids/events, flicks ACTION and receives the refusal, then sees empty inventory after the real director reaches Intermission.
- The versioned `scenarios/items/queue-refusal.json` and `respawn-queue.json` replay through the shared fixture runner. `cargo test -p jj-fixture --test items`: 2/2 pass on eris, including exact inventory/event/refusal observations and recovery envelopes. `rch exec --job -- cargo run -q --locked -p jj-tools --bin jj -- sim --json scenarios/items/queue-refusal.json scenarios/items/respawn-queue.json`: both scenarios `ok: true`, `replayMatches: true`, remote exit 0. Hashes are `a91975ff27f7f4cee6107eefa753f27331d52ab89cf11cad51951d781cb87af8` and `79adbfd414e8b5f7314e27040345e3bbb25435d7a723745c54322d3728cad575` respectively. The native and browser probes share the item data readout; untouched no-item fixtures retain their output shape.

Logs: /tmp/jj-items-sim-lifecycle-tests.log, /tmp/jj-item-host-wiring-tests.log, /tmp/jj-item-host-source-test.log, /tmp/jj-item-host-workspace-check.log, /tmp/jj-item-host-final-clippy.log, /tmp/jj-item-host-live-wasm-build.log, /tmp/jj-item-live-queue-journey.log.

Fixture/CLI logs: `/tmp/jj-items-fixture-bank.log`, `/tmp/jj-items-cli-bank-no-artifacts.log`.

After adding scheduled fixture offers, the remote **workspace-wide Clippy check, all targets,
with jj-wasm-host/testing and -D warnings, passes** (10:11–10:13 UTC):
`/tmp/jj-item-workspace-final-clippy.log`.

Final compatibility check after the shared item readout and scheduled offers: native libraries on
eris pass **71/71** (jj-fixture 3, jj-map 2, jj-sim 18, jj-wasm-host/testing 48),
including the exhaustive geometry oracle, unchanged mixed-roster golden and source routing.
Log: `/tmp/jj-item-and-cache-native-libraries.log`.

The final local release WASM rebuild passes (`/tmp/jj-items-final-host-wasm.log`), followed by
the real WebRTC/controller journey **1/1 in 12.85 seconds**
(`/tmp/jj-items-final-journey.log`). Its first launch failed before browser setup with ENOEXEC:
RCH had left a Linux jj-server in the Mac target directory. A per-crate native jj-server build
restored the Mach-O binary; the successful run uses its saved copy via JJ_SERVER_BIN. That
failed launch is not behavioral evidence.

CI and the full physical/presentation acceptance are still required before closing P1-W01/P1-W01.3. No participant/effect/debris caps were added; the two held slots are the owner's game rule.

## Successful-use follow-up: W03b

The earlier paragraphs describe the foundation before physical handlers existed.
Sanga now activates physically and consumes the real front item; the unimplemented
boomerang still refuses as Unavailable and preserves its item. The live journey
offers Sanga then boomerang, refuses a third full-queue offer, uses Sanga through
real controller ACTION, checks its exact timer, and checks boomerang refusal and
round cleanup. Final native item_queue is **9/9**, host/testing **48/48**, and native
CLI/full item fixtures pass. Native/WASM item parity plus the real WebRTC journey
and unchanged host roster golden pass **3/3**. Fired Sanga retains its original
owner and natural timer through recovery; held inventory clears. Details and
hardware/commands are in [W03b's receipt](../P1-W03/simulation.md).
This delivers W01.3's successful-use prerequisite; CI and parent presentation
acceptance are still required.


CI 3331 passed the unchanged generator WASM budget but its native run found the
persistent-debris keyword guard treating item card `lifetime_ms` and
`self.items.expire(self.tick)` as debris TTL. The guard now recognizes only the
pure item ledger and that exact typed call for expiry words. Every rigid-body
removal/count-budget ban still scans all sim modules, and its existing minute-long
moving-debris behavior check remains unchanged. The item round-end/debris replay
case also remains mandatory. This scope correction does not authorize timed debris.

The corrected guard passes in the remote native workspace bank on eris (explicit
dev/test opt-level 1): **455 passed, 0 failed, 1 ignored across 77 suites**, exit 0.
The six debris tests, including the source guard and minute-long dynamic persistence
check, all pass. Log: `/tmp/jj-dominance-workspace-bank.log`. This bank tests the item
foundation and Rapier repair before Sanga integration; it does not claim W03 delivered.
