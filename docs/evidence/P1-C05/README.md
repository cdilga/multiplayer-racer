# P1-C05: host pads and keyboard sources

Pads and key clusters on the host are players. `web/host/src/input/local.ts` samples them and sends
`LocalSource{source, axes, buttons, seq}`. The worker interprets every source with the same jj-input path as a phone.

**Claim-by-press:** a source sends nothing until it's first pressed, so a plugged-in pad or an idle keyboard makes no
seat.

**Pads** (standard mapping):
- Left stick is DRIVE and right stick is ACTION, with a 0.12 radial deadzone.
- View/Select is Identify, Start is READY, and holding both for 2 s leaves the seat.
- Unplugging sends one `LOCAL_UNAVAILABLE` sample, then silence.

**Key clusters** come from data (`web/host/src/input/clusters.json`):
- A is WASD + TFGH with Identify Q and READY E; B is IJKL + arrows with Identify U and READY O.
- Steering is rate-shaped to full lock in 1/6 s.
- Cluster keys are ignored while Ctrl, ⌘ or Alt is down, so host chords such as Ctrl/⌘+Shift+B never steer.

**The input drawer** (`drawer.ts`) lists every source as playing, press to join, or unplugged, plus each cluster's key
legend. It's the plain version until the TV mocks (R07) style it.

The worker (`crates/jj-wasm-host/src/host.rs`):
- **Buttons:** Identify and Leave go through the seat reducer. After leaving and letting go, a press claims the same
  seat again. READY waits for the round director (G01).
- **Dropout rule (R45, §9), source-blind:** a source silent or gone for 2 s hands its car to the autopilot, and the
  room never pauses. Fresh deliberate input takes it back through the autopilot's handback blend. G03 adds idle,
  menus and the journeys.
- **Host-applied input age:** the main thread stamps each sample on a shared clock (`performance.timeOrigin + now`).
  The worker records the age when the tick that applies the sample steps, and `SimClient.inputStats()` gives
  p50/p95/p99 per source.

## Acceptance (Mac run, 2026-10-03; CI runs `web/host/tests/input.test.mjs` in the `web` job)

Chromium 151.0.7922.34 (Playwright headless), darwin/arm64. The Gamepad API is **emulated** (`navigator.getGamepads`
and `gamepadconnected`/`gamepaddisconnected` events); the keys are real key events.

| AC | Result |
|---|---|
| Two pads + two key clusters claim four seats, each drives only its own car | Two plugged-in pads claim nothing until pressed. Then four seats (`local:100`, `local:101`, `local:1`, `local:2`). After 2.5 s: pad 1 (stick up) 13.3 m/s straight; pad 2 (up and right) 7.5 m/s, turned 80°; keys A (W) 13.3 m/s straight; keys B (K + J) −3.5 m/s, reversing and turned. The drawer shows all four playing. |
| Unplugging one pad neutralises and hands only its seat to the autopilot | The pad's car was on the autopilot 2,024 ms after unplugging (the 2 s dropout); the other three cars weren't. |
| Its input age appears in the receipt format | `receipt.json` (`jj.input-receipt.v1`) has one row per source with host-applied input age. Each source shows p50 5.2, p95 10.3, p99 10.5–10.6 ms, and the unplugged pad's row has `unplugged: true, autopilotAfterMs: 2024`. |

The ages are the main-thread-to-tick-boundary path: up to one 120 Hz tick of wait plus the 16 ms poll's sampling.
Native host tests:
- `host_pads_claim_on_press_drop_out_to_the_autopilot_and_come_back`
- `a_host_pad_identifies_leaves_and_claims_its_seat_again`

N08 owns the network receipts; this row format is what it collects for local sources ("the unplugged-pad row").
