# P1-U05.6: motion reel, Reduced visibly different from Full

The owner's POC round 2 item POC2-15 (`docs/playtests/poc-2026-10-03-round2.md`): in the autoplay, Full and Reduced
motion were indistinguishable. Live at `https://jammers-preview.dilger.dev/poc/motion/side.html` (side by side) and
`/poc/motion/?autoplay=both` (Full, then Reduced, looping).

**Machine and browser:** Apple M1 Pro, Chromium 151 from Playwright with the GPU flags. Re-run with
`node art/ui/poc/motion/side-check.mjs`, which writes `side-report.json`, `side/` and `side-by-side.webm`, and with
`JJ_EVIDENCE_DIR=docs/evidence/P1-U05.6/motion node art/ui/poc/motion/record.mjs`, which writes `motion/`.

## What changed

| Item | What | Why |
|---|---|---|
| Reduced drops the flashes | No exposure flash anywhere in Reduced: not on the countdown, not on Identify, not on the TV mock, the phone or the reel. Round 1's Reduced held a 60% wash, which was still a flash and looked much like Full. The Identify border now holds thick for the pulse instead of blinking. The meaning stays: the number swaps on each beat, "Cooee #N" shows without scale, and the car is outlined | POC2-15: drop flashes, shake and large translations, keep the meaning. Shake, scaling and slides were already gone in Reduced |
| Labelled | A flag on the stage itself, "Full motion" in saffron or "Reduced motion" in teal, not only the switch in the bar | Which version is playing is never in doubt |
| Side by side | `side.html` plays the live reel twice, Full on the left and Reduced on the right, started on the same frame and looping. Durations come from the same tokens, so each transition lines up | Compare without switching |
| Autoplay | `?autoplay=both` alternates Full and Reduced, flagged. The POC index now links "Motion: Full beside Reduced" and "Motion reel (Full, then Reduced)" | The difference shows without touching anything |

## Acceptance

| AC | Result |
|---|---|
| POC2-15: Full and Reduced visibly different in the autoplay, labelled, with a side-by-side view | `side-report.json` samples both sides every frame through 26 s of the reel. The countdown exposure flash peaks at **1.00 in Full and 0 in Reduced**, and the countdown number scales up to **1.34 in Full and stays 1.00 in Reduced**. The Identify flash peaks at **0.99 in Full and 0 in Reduced**, and the Identify label scales up to 1.11 in Full and stays 1.00 in Reduced. Matched stills: `side/countdown-flash.jpg`, `side/identify-flash.jpg`. Video: `side-by-side.webm`. The re-recorded reel (`motion/reel.webm`, `motion/reel-reduced.webm`) keeps every motion within tolerance of its token duration (`motion/timeline.json`), with the flag on every still |

No page errors.

## Known gaps

- The reduced-motion choice is the OS setting or `?reduced=1`; the game's own settings toggle (the phone's settings
  sheet) comes with the real controller.
