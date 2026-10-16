# P1-FL07 self-review: air control and landing tiers (br-bbki.7, R129)

## How it was captured

- **Where:** `scripts/remote/eris.sh --run ws-fl07f` at 4aa3fbb0, after `scripts/build-host-wasm.sh`.
  - A local real jj-server and `web/tests/journeys/fl07-landing.test.mjs` with `JJ_CAPTURE_DIR`.
  - Playwright Chromium and WebKit (WebKit is not Safari), 1920×1080, software GL, no connected phone.
- **What:** the committed fixtures `scenarios/lab/air-pitch-{neutral,down,up,crash}.json` on the Feel Lab's canyon leap.
  - They are frame-stepped in the real worker and renderer.
  - Each is captured on the first frame after the sim judged the landing, from the chase camera and from a side orbit (`&orbit=75`).
- **The journey asserts:**
  - each tier as the WASM sim judged it;
  - that the TV received the matching callout;
  - that the callout is up over car 0 (none for OK).
- **Result:** 2/2 (Chromium, WebKit).

## Looked at

- **`captures/chromium-air-pitch-down-chase-1920x1080.jpg`** (good landing):
  - "CLEAN LANDING! BOOST" in a large teal panel over the car, readable at TV distance.
  - The car is level on the run-out with all four wheels down, the canyon road ahead.
- **`captures/chromium-air-pitch-up-chase-1920x1080.jpg`** (bad landing):
  - "HARD LANDING!" in orange.
  - The car comes down nose high: its roof, number and bonnet face the camera as it lands tail first.
- **`captures/webkit-air-pitch-crash-chase-1920x1080.jpg`** (crash):
  - "STACKED IT!" in red, white text.
  - The car is nose-first on the rim, nearly vertical. The fixture checks it is upright on four wheels 1.5 s later.
- **`captures/chromium-air-pitch-neutral-chase-1920x1080.jpg`** (OK): no callout, as designed. The car lands slightly nose high.
- **`captures/chromium-air-pitch-down-side-1920x1080.jpg`:** side on, the clean landing's car is level with all four wheels on the road.
- **The other side shots and the WebKit set:** the same frames; nothing different to note.

## Defects found and fixed

1. **No callout at all in fixture mode.** The `Landed` event was keyed by seat, and a loaded fixture (or a bot) has none.
   - The event now carries the car (`SimEvent::Landed { car, seat, .. }`, ABI 5).
   - The TV calls out every car's landing.
2. **The callout had expired before the capture.** It lives 1.6 s of wall time, and six 1080p software-GL frames outlasted it.
   - The journey now renders one frame straight after the landing.
   - In real time the callout shows for its full 1.6 s.

## Remaining defects

- **Side shots have no callout in frame.** The callout floats 4.4 m above the car, the launch callouts' height, so the close side orbit (8 m from the car) frames only the car.
  - That orbit is the capture tool's, not a game camera; the chase tiles show it.
- **Overlays in the captures.** The host's test-mode overlays (the Keys & Pads panel, the "Join at" pill and the welcome banner) share the frame. They belong to the test host, not this bead.

## Not covered

- **A real TV and a phone.** These are frame-stepped captures; no phone was connected. The phone shows nothing for a landing yet (R129 asks for the TV callout).
- **The feel.** Whether the latch, the 0.15 s delay and the bands play well is the Feel Lab's (owner) call; the values are in `assets/profiles/air.json` for ?tune.
- **?tune.** The air profile isn't wired into the tuning panel yet. `Sim::set_air_profile` exists for it.
