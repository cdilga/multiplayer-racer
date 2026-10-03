# P1-C05.2: steering wheels and pedals as a controller source

Date 2026-10-04, GentlePike. Bead `br-p1-c052-wheel-rgw` (owner R109(b), later work, not Playtest 1). Closes on green
Gitea CI (`ev:ci`).

A steering wheel with pedals is a host player like a pad or a key cluster (P1-C05), through the same compact input
path (R80):

- **The mapping is data** (`web/host/src/input/wheel.ts`). A profile maps the wheel onto the same two sticks as a pad:
  - DRIVE x is the steering axis;
  - DRIVE y is accelerator minus brake, each pedal normalised from its rest to its full travel with a small deadzone;
  - buttons make the ACTION stick (boost right, drift left, OI! up, cone down) plus Identify and READY.

  The worker, jj-input and the sim see a wheel exactly as a pad: no new message, no per-source caps.
- **Shipped profiles** (`web/host/src/input/wheels.json`, `jj.wheel-profiles.v1`) match the USB vendor and product
  ids in the Gamepad id.
  - It ships one profile, the Logitech G29/G920 in separate-pedals mode. Its axis layout is cited in the data and it
    is marked **verified: false**.
  - Wheel layouts vary by model, driver and pedal mode, and none could be checked on hardware here.
  - The drawer shows its live steering and pedals with **Looks right** (saved as confirmed for that device) and
    **Calibrate**.
- **Calibration** (the input drawer's **Map as a wheel**, or Recalibrate) maps any wheel in a few prompts:
  - centre;
  - full left, then full right (the steering axis and its direction);
  - each pedal fully pressed (the axis that moved most, with its rest and full values);
  - then a button for boost, drift, OI!, cone, Identify and READY, each skippable.

  The profile is saved for that device (`localStorage` `jj.wheelProfiles.v1`, keyed by its Gamepad id) and wins over
  a shipped one.
- **No phantom seats or stuck brakes.**
  - A non-standard device that rests with an axis far off centre (pedals at +1) and has no profile sends nothing and
    shows **needs mapping**. As a pad it would claim a seat with the brake on.
  - While a device calibrates, its seat gets neutral input.
  - The press that finishes calibrating isn't a join: everything has to be let go first.
- **Measured input:** the worker's input stats now carry the samples sent and the mean encoded `LocalSource` bytes per
  sample beside the host-applied input age.

## Acceptance (Mac run, 2026-10-04; CI runs `web/host/tests/wheel.test.mjs` in the `web` job)

Chromium 151 (Playwright headless), darwin/arm64. The Gamepad API is **emulated**: these are simulated wheels on the
real host build and join path, not a physical wheel.

| AC | Result |
|---|---|
| A wheel with pedals joins as a source, steering and accel/brake map via profile data | A wheel with the G29's ids maps at once to the shipped profile (`Logitech G29 / G920`, unconfirmed). Its accelerator claims a seat and drives (over 4 m/s in 2 s); **Looks right** saves it confirmed. The calibrated wheel (below) joins on its first press. With the accelerator at 80% and steering a third right, it reached about 10 m/s and turned about 43° in 2.5 s; the brake then slowed it by more than 3 m/s |
| An unknown wheel can be mapped through a calibration screen and the profile is saved | `Fancy Wheel Pro (Vendor: 1234 Product: abcd)` (steering on axis 0, brake on 1, accelerator on 2, clutch on 3, pedals resting at +1) shows **needs mapping** and claims no seat. The drawer's prompts found steering 0, accelerator 2 and brake 1, with rest +1 and full −1, and buttons boost 5, drift 4, Identify 8 and READY 9 (OI! and cone skipped). The profile was saved; after a reload the same device is a wheel at once, confirmed |
| Input age and bytes measured; fixture-testable with a recorded wheel trace (R90) | `receipt.json` (`jj.input-receipt.v1`), per wheel: host-applied input age p50 5.8 / 6.0, p95 11.7 / 12.2, p99 12.9 / 12.4 ms; 11.9 and 10.1 encoded bytes per sample (`LocalSource`); 246 and 140 samples. The live run's wheel, as the host mapped it, is in `wheel-trace.json` (50 ms samples), and `wheel-trace.fixture.json` is the same as fixture stick spans. That fixture is `scenarios/introspection/wheel-trace.json` in the scenario bank: through jj-input and the sim it turns 39° before the brake (live: 43°), reaches 9.7 m/s (live: about 10) and replays to the same hash |

## Known gaps

- **No physical wheel was tested.** The shipped G29/G920 profile's layout comes from public descriptions and Chromium's
  HID axis order, and is unconfirmed until someone presses **Looks right** on a real one (the Q02 checklist can carry
  it). Calibration doesn't depend on it.
- Force feedback: not in the Gamepad API's standard surface; later, if the API allows (as the bead says).
- The drawer is the plain version until the TV mocks style it (R07).
