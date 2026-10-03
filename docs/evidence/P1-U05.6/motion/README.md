# P1-U05 motion reel (evidence)

The live reel is `art/ui/poc/motion/index.html` (serve `node art/ui/lib/serve.mjs`, open `/poc/motion/`). It is built on U02's TV mocks
(`../tv/world.js`, `../tv/grid.js`, `../shared/tokens.js`, `../tv/tv.css`), so every timing is real, not a video edit. Every duration, easing,
repeat and stagger is read from `art/ui/tokens.json` (`tokens.motion`) at runtime; the full and reduced variants come from each named motion's
`reduced` entry. `?reduced=1` (or the on-screen Full / Reduced switch, or the OS `prefers-reduced-motion` setting) plays the reduced variants; `?autoplay=1`
plays the reel on load; keys: P play, 1-6 one transition, R toggle reduced. A script drives it with `window.__reel = { ready, play(name), playAll(), timeline }`.

Recorded by `art/ui/poc/motion/record.mjs` on Apple M1 Pro (MacBookPro18,3), macOS 27.0.1, Chromium 151.0.7922.34 (Playwright 1.62.1, channel chromium, headless, --use-angle=metal), GPU backend ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version).
Videos: reel.webm 5.97 MB, reel-reduced.webm 5.05 MB. Stills (20 full, 18 reduced): `stills/`. Raw numbers: `timeline.json`. Commands and output: `local-receipt.txt`.
A 16:9 TV stage (1749x984, so TV px are scaled by 0.911) sits under a 96 px annotation bar that names each transition, its token duration and the durations just measured;
the bar is reel furniture, not TV UI.

## What plays (in order)

| Step | Transition | What you see | Reduced version |
|---|---|---|---|
| a | Countdown (countdown-beat) | 3, 2, 1, GO as one full-screen overlay (R99), one beat (1000 ms) each: each number punches in (scale 1.4 to 1) and fades while a high-exposure flash attacks and decays behind it; cars hold on the grid until GO | No flash; numbers swap on the beat, no scale or fade |
| b | Join (sticker-in + reflow) | #6 joins a five-tile race: its tile scales 0.6 to 1 with overshoot (HUD cluster settles 4 degrees) while the second row re-divides from 3+2 to 3+3 tiles with the standard easing | Tile fades in over 120 ms (no scale); tiles cut to their new cells (0 ms) |
| c | Identify (identify-pulse) | On the pre-race grid (cars side by side), 3 x 500 ms: "Cooee #6" over a transparent high-exposure flash in #6's colour (R99; fast attack, decaying over the pulse), its tile border thickens and its badge scales up, and the car outlined in every tile it is on screen in (U02's `setOutlines`, drawn as a bright rim). The shared reference for the TV and the controller | No flash and no blinking: the thick border holds for the pulse, the label shows without scale, outline shows |
| d | Wreck and respawn (wreck-shake) | WRECKED! sticker and a 300 ms shake on #6's tile only, "Back in 3, 2, 1", then the respawn cuts (the car's slot is rebuilt and its chase camera starts on it, so there is no swoop) | No shake (0 ms), WRECKED! fades in, same 3 s count, same cut |
| e | Phase changes | race to lobby, lobby to countdown (3, 2, 1, GO again), countdown to race (the GO beat), race to results. Chrome exits over `fast` (120 ms), then the new chrome enters as a toast (200 ms, 16 px slide + fade) | Exit 120 ms, enter fades only (120 ms, no slide) |
| f | Results reveal (results-reveal) | The three podium cards drop in from the top, staggered 150 ms, 900 ms each (1200 ms total), sticker easing | Cards fade in together over 200 ms |

Between transitions the reel cuts to the state the next one needs: (c) Identify cuts to a fresh pre-race grid (cars side by side, frozen), and (d) starts the race from that grid without a countdown beat.
Re-run with `node art/ui/poc/motion/record.mjs` (about 3 minutes; `--stills-only` or `--video-only` to skip a pass).
Pacing between transitions (lead-ins, holds) uses `durationsMs.reveal`, `countdownBeat` and `podium`, so even the gaps come from tokens.

## Measured against the tokens, full motion

19/19 within tolerance.

| Step | Motion | Token source | Token (ms) | Measured (ms) | Delta (ms) | Result |
|---|---|---|---:|---:|---:|---|
| a countdown | beat 3 | `motion.named.countdown-beat.durationMs` | 1000 | 1001.6 | +1.6 | pass |
| a countdown | beat 2 | `motion.named.countdown-beat.durationMs` | 1000 | 1008.6 | +8.6 | pass |
| a countdown | beat 1 | `motion.named.countdown-beat.durationMs` | 1000 | 1008.7 | +8.7 | pass |
| a countdown | beat GO! | `motion.named.countdown-beat.durationMs` | 1000 | 1000.0 | +0.0 | pass |
| b join | reflow | `motion.named.reflow.durationMs` | 320 | 326.5 | +6.5 | pass |
| b join | sticker-in tile | `motion.named.sticker-in.durationMs` | 320 | 326.5 | +6.5 | pass |
| c identify | identify-pulse | `motion.named.identify-pulse.durationMs x repeat` | 1500 | 1508.4 | +8.4 | pass |
| d wreck + respawn | wreck-shake | `motion.named.wreck-shake.durationMs` | 300 | 300.1 | +0.1 | pass |
| d wreck + respawn | sticker-in word | `motion.named.sticker-in.durationMs` | 320 | 325.4 | +5.4 | pass |
| d wreck + respawn | back-in 3·2·1 | `3 x motion.durationsMs.countdownBeat` | 3000 | 3000.2 | +0.2 | pass |
| d wreck + respawn | respawn-cut | `a cut (0 ms)` | 0 | 0.0 | +0.0 | pass |
| e phase changes | phase race → lobby | `motion.durationsMs.fast + motion.named.toast.durationMs` | 320 | 324.7 | +4.7 | pass |
| e phase changes | phase lobby → countdown | `motion.durationsMs.fast + motion.named.toast.durationMs` | 320 | 325.0 | +5.0 | pass |
| e phase changes | beat 3 (countdown phase) | `motion.named.countdown-beat.durationMs` | 1000 | 1001.5 | +1.5 | pass |
| e phase changes | beat 2 (countdown phase) | `motion.named.countdown-beat.durationMs` | 1000 | 1007.9 | +7.9 | pass |
| e phase changes | beat 1 (countdown phase) | `motion.named.countdown-beat.durationMs` | 1000 | 1000.3 | +0.3 | pass |
| e phase changes | beat GO! (countdown to race) | `motion.named.countdown-beat.durationMs` | 1000 | 1008.0 | +8.0 | pass |
| e phase changes | phase race → results | `motion.durationsMs.fast + motion.named.toast.durationMs` | 320 | 324.4 | +4.4 | pass |
| f results reveal | results-reveal | `motion.named.results-reveal.durationMs` | 1200 | 1200.0 | +0.0 | pass |

## Measured against the tokens, reduced motion

19/19 within tolerance.

| Step | Motion | Token source | Token (ms) | Measured (ms) | Delta (ms) | Result |
|---|---|---|---:|---:|---:|---|
| a countdown | beat 3 | `motion.named.countdown-beat.reduced.durationMs` | 1000 | 1008.6 | +8.6 | pass |
| a countdown | beat 2 | `motion.named.countdown-beat.reduced.durationMs` | 1000 | 1001.6 | +1.6 | pass |
| a countdown | beat 1 | `motion.named.countdown-beat.reduced.durationMs` | 1000 | 1000.0 | +0.0 | pass |
| a countdown | beat GO! | `motion.named.countdown-beat.reduced.durationMs` | 1000 | 1000.3 | +0.3 | pass |
| b join | reflow | `motion.named.reflow.reduced.durationMs` | 0 | 0.0 | +0.0 | pass |
| b join | sticker-in tile | `motion.named.sticker-in.reduced.durationMs` | 120 | 123.8 | +3.8 | pass |
| c identify | identify-pulse | `motion.named.identify-pulse.reduced.durationMs x repeat` | 1500 | 1507.3 | +7.3 | pass |
| d wreck + respawn | wreck-shake | `motion.named.wreck-shake.reduced.durationMs` | 0 | 0.0 | +0.0 | pass |
| d wreck + respawn | sticker-in word | `motion.named.sticker-in.reduced.durationMs` | 120 | 124.0 | +4.0 | pass |
| d wreck + respawn | back-in 3·2·1 | `3 x motion.durationsMs.countdownBeat` | 3000 | 3000.0 | +0.0 | pass |
| d wreck + respawn | respawn-cut | `a cut (0 ms)` | 0 | 0.0 | +0.0 | pass |
| e phase changes | phase race → lobby | `motion.durationsMs.fast + motion.named.toast.reduced.durationMs` | 240 | 241.7 | +1.7 | pass |
| e phase changes | phase lobby → countdown | `motion.durationsMs.fast + motion.named.toast.reduced.durationMs` | 240 | 242.5 | +2.5 | pass |
| e phase changes | beat 3 (countdown phase) | `motion.named.countdown-beat.reduced.durationMs` | 1000 | 1000.3 | +0.3 | pass |
| e phase changes | beat 2 (countdown phase) | `motion.named.countdown-beat.reduced.durationMs` | 1000 | 1001.1 | +1.1 | pass |
| e phase changes | beat 1 (countdown phase) | `motion.named.countdown-beat.reduced.durationMs` | 1000 | 1008.2 | +8.2 | pass |
| e phase changes | beat GO! (countdown to race) | `motion.named.countdown-beat.reduced.durationMs` | 1000 | 1000.0 | +0.0 | pass |
| e phase changes | phase race → results | `motion.durationsMs.fast + motion.named.toast.reduced.durationMs` | 240 | 242.1 | +2.1 | pass |
| f results reveal | results-reveal | `motion.named.results-reveal.reduced.durationMs` | 200 | 200.4 | +0.4 | pass |

Tolerance: pass if within +-50 ms or one frame at 60 Hz (16.7 ms), whichever is larger. Method: each motion is a tween on one rAF clock;
start is the first frame it is applied and end the first frame at or after start + duration, so a reading carries up to one frame of quantisation (this Mac's
headless Chromium runs rAF at about 120 Hz). Countdown beats also pass on beat-to-beat period; the Identify pulse also passes on each 500 ms cycle (see `timeline.json`).
`tokens.json` is read twice: by the page (to drive the motion) and by `record.mjs` (to recompute the expected value), and the two must agree.

## Reduced-motion switches (checked by record.mjs)

- ok: default (no flag, OS prefers full motion): reduced = false
- ok: on-screen switch -> Reduced: reduced = true
- ok: on-screen switch shows Reduced as the active option = reduced
- ok: on-screen switch -> Full: reduced = false
- ok: ?reduced=1: reduced = true
- ok: OS prefers-reduced-motion: reduce: reduced = true
- ok: OS reduce but ?reduced=0 (explicit override): reduced = false
- ok: ?autoplay=1 starts the reel: playing = true

## Known gaps and what U02/U01 could change

- **Hook for U02:** `../tv/main.js` is a page, not a module (no exports), so the tile, lobby and results markup is rebuilt in `reel.js` with U02's class names. Exporting
  `gridScene`, `seatInfo` and the lobby / results builders (behind a guard so importing does not start the page) would remove that duplication. The world also has no
  per-seat wreck / respawn call; the reel cuts the respawn by rebuilding the last seat's car slot (`setCars(n-1)` then `setCars(n)`), which puts the car back on the grid with a
  fresh chase camera. A `world.respawn(seat)` that resets the camera would let any seat respawn where it crashed.
- **Token gaps (U01):** the 150 ms stagger, the 0.6 to 1 and 1.4 to 1 scales, the 4 degree settle and the 16 px slide only exist in the `does` prose, so `reel.js` parses them
  (and records a warning if the wording changes). Sub-timings that tokens do not give are composed from `durationsMs`: the countdown punch-in is `base`, its fade is `slow`,
  the "Back in" ticks are `countdownBeat`, the phase exit is `fast`, and the phase enter is the `toast` motion.
- **Identify outline:** U02's `setOutlines` draws an inverted hull in the seat colour, which on a car painted that colour is a faint fringe. The reel wraps `renderer.render` to find the (private) hull group and lighten and thicken it (a `setOutlines(seats, { tint, scale })` option would replace that wrapper). The cut to a pre-race grid for (c) exists because late joiners and respawned cars start behind the pack, where no other tile's camera looks.
- **Seat colour 7 is ink:** its tile ring is ink on the ink gutters and its outline hull is ink, so the Identify pulse and outline are nearly invisible for #7 (and #19, #31...). The reel identifies #6 (pink) for that reason; U01/U02 should decide how seat 7 (and every 12th seat after it) reads on the gutters.
- **Sticker-in on a GL tile:** the 3D viewport scales with overshoot but cannot rotate, so the 4 degree settle is applied to the HUD cluster only.
- **Toast** (a named motion) is used as the phase-change enter; U02 has no standalone toast component, so none is shown on its own.
- **Controller flash:** the Identify motion also flashes the controller; the TV reel cannot show the phone.
- **Video:** Playwright records VP8 at its fixed bitrate and 25 fps, so fine detail softens; the stills are the sharp reference.
