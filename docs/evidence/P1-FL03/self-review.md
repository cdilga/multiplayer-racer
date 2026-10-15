# Self-review P1-FL03

## What it is

The Feel Lab tab of the owner tuning menu (`?tune`, absent from production builds): a handling preset chooser (Off, Kart,
Rally, Hooligan, each with its one-line `what`), five trade-off sliders (Power, Grip <-> slide, Air control, Launch,
Boost economy; 0.5x to 2x on a log scale, 1x in the middle, effective values under each), and A/B slots with a live
A | B toggle. Everything is applied to every roster vehicle through the panel's own `tune-vehicle:` and `tune:` commands,
so it is journalled and ends up in Export patch. Code: `web/host/src/tuning/lab.ts`, mounted from `panel.ts`.
Scene loading is P1-FL03.1 (br-bbki.19), not here.

## Tests

`node --test web/tests/journeys/fl03-feel-lab.test.mjs` (Playwright Chromium on the Mac, real host room, two controllers on
autopilot, flat `greybox-loop`): flag off, no lab and no tuning chunk; at 1280x720 and 1920x1080, Off -> Kart -> Rally,
Power and Grip sliders, A/B save and flips, each read back from the sim for every vehicle, cars keep moving, patch
validated with `jj vehicle tune --check` for the selected and the other vehicle, back to Off at 1x leaves an empty patch.
`pt1-tuning.test.mjs` still passes (5/5).

## Looked at

- `lab-kart-1280x720.jpg`: laptop, Kart chosen, sliders at 1x; preset list readable, chosen row highlighted, effective
  values shown.
- `lab-sliders-1280x720.jpg`: laptop, Rally, Power 1.52x (readout 34861.5 / 1212570), "3 changed" in the footer.
- `lab-ab-1280x720.jpg`: laptop, scrolled to the A/B block: A holds "rally, power 1.52x, grip 0.71x", B holds "Off, grip
  0.71x"; B active in both the slot and the toggle; status line names what was saved.
- `lab-kart-1920x1080.jpg`: TV size, Kart chosen, all five sliders visible, effective values under each.
- `lab-sliders-1920x1080.jpg`, `lab-flipped-1920x1080.jpg`: TV size after moving sliders and flipping back to A; slot A
  highlighted, grip readout shows the scaled Rally grips, Export patch and footer clear of the lab.
- `lab-ab-1920x1080.jpg`: TV size, Off chosen: grip slider greyed with its "pick a preset first" note, "No changes".
- `lab-flipped-1280x720.jpg`: laptop, flipped back to A: slot A highlighted, status "Applied to 2 vehicles: rally, power
  1.52x, grip 0.71x", "3 changed".

## Defects found and fixed

- A value typed or sent back at its shipped number stayed in the patch (the sim's f32 reads 0.4 as 0.4000000059604645):
  the panel now compares numbers as f32, so returning every lab control to 1x leaves an empty patch.
- The Off preset has no `handling` section on the shipped profiles: `null` for a section the profile lacks counts as
  the default, so Off stays out of the patch; the panel's stale `handling.*` readings are dropped on refresh.
- The vehicle selector in the header did not follow the lab's own vehicle switches; it does now.
- The first journey draft failed its flag-off check on the page path (`fl03lab`) and on f32 noise: the matcher is on
  asset names, comparisons are approximate.

## Remaining defects

- At 1280x720 the panel header wraps ("Owner tuning" over two lines) because of the vehicle selector; pre-existing, cosmetic.
- Effective-value readouts are monospace and wrap mid-name on long lines (e.g. "max engine power w"); readable, not pretty.
- With Off chosen the greyed grip slider still shows its remembered multiplier (0.71x); it returns when a preset is chosen.
- The A/B slot summary abbreviates sliders by first word ("power 1.52x").

## Not covered

- No WebKit or touch run: the Feel Lab is a host-side owner tool on a laptop or TV browser.
- Driving feel itself (whether Kart/Rally/Hooligan are good) is for the owner's playtest; the journey proves the values
  reach the sim and the cars keep moving, not that they feel right.
- Journal replay (AC3) reuses the existing `tune:` UI-command journal and is not re-asserted by a new replay test here.
