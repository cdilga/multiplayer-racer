# Audio learnings (append-only)

## 2026-10-07 · The host's runtime audio (P1-A03, A05, A07)

Code: `web/host/src/audio/` (`mix`, `announcer`, `music`, `director`, `engine`, `sfx/`), one `mountAudio(client)` line in
`web/host/src/main.ts` after `world.attach`, and `web/controller/src/app/sound.ts`. Tests: `web/host/tests/audio.test.mjs`.

- **Audio taps the three feeds by wrapping, last.** `mountAudio` wraps `client.onSnapshot`, `onEvents` and `onRoom` after the
  page has set its own (the page's runs first, audio second, an audio error never reaches it). Mount it after `world.attach`
  (which sets `onSnapshot`); anything assigned to those three handlers *after* `mountAudio` replaces the tap.
- **The log is the surface.** Every cue, music change, effect and engine on/off is logged at its trigger (`window.__jjAudio.log()`)
  with `played` (could it be heard) and the mix state; a blocked or muted context logs the same triggers and plays nothing.
  Cues log synchronously: decode and playback follow, so log order is event order.
- **A welcome cue fires at mount.** The worker's first room view arrives with the page, and `welcome` (room.opened) plays; the
  announcer is then busy for its clip's length. Scripted tests either clear the log and feed a virtual `at` far ahead, or wait.
- **Virtual time for scripted rounds.** `say`, `feedEvents` and `feedRoom` take an `at` (ms) that stands in for the clock in the
  cooldown and busy checks; the clip-length timers still run in real time. Give each moment's script its own base.
- **No immediate repeat** is per moment (the last variant of that moment is excluded; a seeded PRNG picks the rest), so a
  scripted round repeats exactly. A moment with one variant repeats it.
- **Ogg/Opus decodes in Chromium and in WebKit 26.5 (macOS, Playwright)**: all 78 shipped clips (70 voice, 8 music). Chromium once
  failed `race-4.ogg` in a single run and passed on every rerun (and ffmpeg decodes it clean), so the decode check retries once and
  records `retried`. No AAC twin ships (`m4a_twin: false`); `srcFor` would pick one by `canPlayType('audio/ogg; codecs=opus')`. The
  iOS Simulator lane (F08) was not run for clips.
- **Headless Chromium ignores the autoplay policy flag for blocking** (contexts run either way), so "blocked" is a test hook:
  `?audio=blocked` makes the mix refuse a context (`state: blocked`), the same path as a real denial (a suspended context).
- **Engine input from the snapshot.** The car record's reserved word is now the applied throttle (f32) and `flags` bits 6–7 are the
  ground class (0 tarmac, 1 dirt, 2 gravel). rpm and gear come from the package's drivetrain (speed + throttle). A car with no input
  for 250 ms has throttle 0 (the sim's stale rule), so scripted tests keep re-sending the stick (`untilFact` steps, or a timer).
- **Engines on/off.** On in Countdown, Running and Finalising (and always in free drive and with no room view), off in the lobby
  and intermission; a wreck (the `Wrecked` event, then the car's `held` flag) stops the engine and the end of the hold starts it
  again with the A04c cranking. Held test pages (`?test`, no stepping) have a Lobby room view, so engines are off there.
- **Budget.** Voices are ranked by speed, local players' own cars always voiced; the budget grows and shrinks around a steady
  update cost (EMA, voice builds excluded, they cost ~1.5 ms each once). Measured (headless Chromium, software, Mac): 8 engines render
  23× real time offline, 16 at 12×; steady update 0.1 ms per snapshot. A presentation budget, never a gameplay limit.
- **Effects are all procedural** (R89): `sfx/synth.ts` recipes over a seeded noise bank, rendered offline for the receipts (peak,
  RMS, tail). Impact intensity is `log10(impulse / 400) / log10(30)`; a nudge past the threshold (~1 kN·s) is ~0.2, a head-on
  at 15 m/s (~17 kN·s) ~0.9. At most 14 effects sound at once; past that the quietest is dropped.
- **Gaps by design:** scrapes (needs a contact-scrape event; episodes need closing speed ≥ 4 m/s), the `big-air` moment
  (`car.air_time` has no sim event; landings are detected from the snapshot's vertical speed), per-vehicle engine profiles
  (every car is the Cruz Missile; `engines.profileOf` is the seam), spatial panning.
