# Self-review P1-A04c

Engine synth rework: no turbo on the Cruz Missile (POC1-01), engine start and stop (POC1-02). Page:
`art/ui/poc/audio/engine/`. Captured with `node art/ui/lib/live-check.mjs --local --viewports
412x915,915x412,375x667,1366x768,1920x1080 --fullscreen /poc/audio/engine/` (Playwright Chromium, Mac M1 Pro) and the
screenshots `check.mjs` takes mid-lap and in the lab. Chromium emulation, not the owner's phone or TV.

## Looked at
- `phone-412-engine-off.jpg`, 412x915, engine off: Start engine primary, status "Engine off", Boost slider disabled with
  its no-turbo note, nothing clipped.
- `phone-412-spectrum-idle.jpg`, 412x915, before audio starts: the scope draws its scale and says "Start the engine to see
  its spectrum"; the Starter layer row and the Boost row ("Not fitted: the Cruz Missile has no turbo").
- 412x915 dash (not committed, same capture): 0 rpm, 0 km/h, 0 Hz with the engine off.
- 412x915 sound lab (same capture): rows stack name/value/reset, control full width, note; nothing cut off.
- `landscape-915-top.jpg`, 915x412: single column, transport and sliders readable.
- 375x667, 1366x768, 1920x1080 and each after the resize/full-screen reload: no overflow, no failed requests, no errors.
- `desktop-1280-lap-no-turbo.jpg`, 1280x900 mid-lap (gravel): status "Engine running", Stop engine / Stop lap, the lap
  bar and story, Boost reads 0% with the note while the lap drives.
- `lab-boost-not-fitted.png` / `lab-boost-fitted.png`: the lab's Boost section on the Cruz ("Not fitted", rows say "not
  fitted", no controls) and after pressing it ("Fitted ●", values from the Hay Hauler, rows marked modified).
- Start and stop as sound: `start.wav`, `stop.wav`, `scripted-lap.wav` (opens with the start, ends with the stop),
  `lap-spectrogram.png`; phases and rpm in `ignition-trace.json`.

## Defects found and fixed
- Loop 1: live-check flagged the spectrum canvas as one flat colour before audio starts (a blank panel). It now draws its
  decade lines and floor with a caption until the engine runs.
- Loop 1: the lap progress line showed an empty bar and "0.0 / 0.0 s" before any lap (`hidden` was overridden by
  `display: grid`; present since A04). Fixed with `.lap-line[hidden]`.
- Loop 1: the dash read 900 rpm and 6 km/h with the engine off. It now shows the rpm the voice is sounding (0 off; the
  crank, flare and spool-down move the tach during start and stop) and 0 km/h when the engine isn't driving.
- Loop 1: on a 412 phone the lab rows overflowed: value column, reset buttons and the section border cut off and the
  sliders squashed (A04b layout). Rows now stack below 640 px; Profile-section rows got side padding.
- Loop 2: mid-lap the disabled Boost slider read 90% (the lap's boost series) on a car with no turbo. It shows 0%.
- Loop 2: the not-fitted Boost rows still showed the previous car's numbers. Absent rows now hide their controls.
- Loop 2: the evidence screenshot for the lab's turbo toggle showed the top of the page, not the lab. Replaced with
  screenshots of the Boost section itself.
- Heard, not seen: a -62 dB road hum after the lap's stop (the voice derived road speed from its frozen spool-down rpm).
  Fixed in the synth; B9b now passes on every run (it had failed on 4 of 6 runs).

## Remaining defects
- None seen. Taste calls are the owner's: starter pitch/length, flare height and stop length are profile data
  (`ignition` section) and editable live in the lab.

## Not covered
- Real devices (owner's phone, TV): emulation only. The owner listens on the live POC.
- WebKit for the new start/stop: W1 renders the first 10 s of the lap (which now includes the start) in Playwright's
  WebKit; the page checks ran in Chromium only.
