# Self-review br-dim.10 (P1-U03: controller indicators must not look tappable)

The phone controller's pod (boost meter, cone, front slot) on `art/ui/poc/phone/index.html#race`. Captured by
`JJ_EVIDENCE_DIR=docs/evidence/br-dim.10 node art/ui/poc/phone/check.mjs` (Playwright Chromium and WebKit with mobile
emulation, three phones, portrait and landscape; all 432 layout runs, 18 multi-touch runs and the new indicator runs
pass; `check-report.json` → `indicators`) and a capture of the stick held right and down. Emulation, not the owner's
Android phone. WebKit is Playwright's build, not Safari.

## Looked at
- `race-frames.jpg`: every device, portrait and landscape: the pod is flat inset wells with "Boost →", "↓ Rear",
  "↑ Front"; Identify, camera, recover and menu keep the raised button look beside it.
- `race_stick-cooldown-frames.jpg`: the cone recharging (fill inside the well, "Cone in 3 s").
- `pod-zoom-race-and-cooldown.jpg`: close up, landscape pod at rest and portrait pod in cooldown.
- `pod-lit-landscape.jpg`: 932x430, action stick held right (boost meter ringed in saffron), then down (cone well and
  "↓ Rear" lit).
- `pod-lit-portrait.jpg`: 412x915, the same two states.

## Defects found and fixed
- Before: the boost meter, cone and item slot had the paper outline rings of the buttons and read as tappable. Now
  inset wells with no border, outline or drop shadow; `pointer-events: none`; `role=img` with labels naming the stick
  direction; not focusable. The check proves it per indicator in both engines (border 0, outline none, no non-inset
  shadow, not focusable, a real touchscreen tap on each sends no input and moves no stick).
- The stick now visibly drives them: right lights the boost meter, up the front slot, down the cone, cleared on
  release (checked in both engines at 932x430 and 412x915).
- Loop 2: in landscape "BOOST →" wrapped onto two lines in the 150 px pod; the label stays on one line and the meter
  narrows instead.
- Loop 2: the empty front slot's dashed inner ring could still read as an outline; removed (the dimmed icon says empty).

## Remaining defects
- None seen. The boost lit state is a saffron ring round an already saffron meter, so it's quieter than the cone's;
  the owner judges taste at G-DESIGN.

## Not covered
- The owner's phone (Android Brave): emulation only. The deployed preview is checked after the push.
