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
- The map's `reserved` lists are keys no cluster may use: the clip chord's key (B) and the host UI keys (Escape, Tab,
  Enter, Space, Backquote, F1–F12). `web/host/tests/clusters.test.mjs` checks them, and that no key is in two clusters.

**The input drawer** (`drawer.ts`) lists every source as playing, sitting out, left, press to join, or unplugged, with
**Sit out**/**Return** and **Leave** buttons for each seated source, plus each cluster's key legend. It's the plain
version until the TV mocks (R07) style it.

The worker (`crates/jj-wasm-host/src/host.rs`):
- **Buttons:** Identify, Leave and Sit out (`LOCAL_SIT_OUT`, the drawer's toggle) go through the seat reducer, so they
  land at a tick boundary. Identify becomes `SimEvent::Identify{seat}` for the renderer's flash; the reducer rate-limits
  it (3 s, joining flashes too). A seat that leaves stays listed, Left, with its number and standings. After letting
  go, the same source's next press is a new player with a new seat (endpoint `local:<id>#2`, then `#3`…). READY waits
  for the round director (G01).
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
| Unplugging one pad neutralises and hands only its seat to the autopilot | The pad's car was on the autopilot 2,108 ms after unplugging (the 2 s dropout); the other three cars weren't. |
| Its input age appears in the receipt format | `receipt.json` (`jj.input-receipt.v1`) has one row per source with host-applied input age. Per source: p50 4.8–5.8, p95 10.8–11.9, p99 12.4 ms; the unplugged pad's row has `unplugged: true, autopilotAfterMs: 2108`. |
| The key-cluster map is data; no cluster uses the bug-clip chord or host UI keys | `clusters.test.mjs`: every cluster has ten distinct keys, no key is in two clusters, and none is in `reserved.bugClip` or `reserved.hostUi`. |
| Identify for that seat only; the drawer shows each cluster's keys | Joining flashed each of the four seats once (`joinFlashes` 1–4). Past the 3 s limit, keys A's Q then pad 2's View flashed exactly seats 1 and 4 (`identifyFlashes` [1, 4] in `seats.json`). The legend reads "Keys A: drive WASD, action TFGH, Identify Q, READY E" and "Keys B: drive IJKL, action UpLeftDownRight, Identify U, READY O". |
| A pad leaves with the hold chord, keys sit out from the drawer, standings kept, the same pad claims a new seat | Pad 2 held View + Start: Left after 2,031 ms, still listed as seat 4 (number 4), the other three Active. Nothing joined while it kept holding; after letting go and pushing the stick it became seat 5 (`local:101#2`, Active) with seat 4 still Left. Keys B's drawer **Sit out** made seat 2 SittingOut (button now reads Return, others Active), and **Return** made it Active again. The tick boundary is the seat reducer's: the worker applies every button at a step (native test below). |

The ages are the main-thread-to-tick-boundary path: up to one 120 Hz tick of wait plus the 16 ms poll's sampling.
Native host tests:
- `host_pads_claim_on_press_drop_out_to_the_autopilot_and_come_back`
- `a_host_pad_identifies_sits_out_leaves_and_joins_again_as_a_new_seat` (Identify events per seat, Sit out, Leave and
  the new seat, stepped tick by tick)

N08 owns the network receipts; this row format is what it collects for local sources ("the unplugged-pad row").
