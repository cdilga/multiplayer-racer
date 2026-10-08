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

## 2026-10-08 · Score-only music, no voices (P1-A02v)

- **YuE2's acoustic stage sings even with empty lyrics and "instrumental" in the style.** A words screen (Whisper) passes
  wordless singing. Music now comes only from `yue-plan` (the plan stage: an ABC score, no audio) rendered through
  FluidSynth + FluidR3_GM (`render_score.py`); `music_batch.py`'s acoustic takes are diagnostics, never candidates, and
  `check_music_manifest.py` refuses any track whose provenance names them.
- **`yue-plan` ignores `duration`.** It writes the whole song (2-5 min at our tempos, intro to outro). Plans take 15-45 s
  on the 2080 SUPER. The BF16 model plus a 6144-token KV cache doesn't fit next to voxtype's 1.5 GB of VRAM, so
  `eris-music-plan.sh` stops that user service for the batch and always restarts it.
- **Same seed, same score.** `lobby` plan seed 23 is byte-identical to the score inside the 4a0f761 acoustic take
  `lobby/fresh.s23` (the owner's favourite composition), so a liked acoustic take's composition can be kept and re-rendered.
- **YuE2's ABC subset:** `L:1/16` or `1/32`, `M:4/4`, `K:` major and minor (incl. `D#m`), `V: Vocal` / `V: Ins`
  interleaved per phrase, `"chord"` symbols on the Vocal staff, `Z<n>` multi-bar rests, `-` ties, `^`/`=` accidentals,
  `% section` comments. A staff can be empty for the whole song (race s23 has no Vocal notes).
- **A seamless loop from a MIDI render:** put the composition in the MIDI three times and cut pass 2 plus 3 s of pass 3; the
  3 s crossfade then blends matching material and the seam carries the real reverb tail (envelope correlation >= 0.98).
- **FluidR3 renders have a ~16 dB crest factor,** so linear gain to -18 LUFS overshoots -1.5 dBTP and `loudnorm` runs its
  dynamic mode (true-peak limiting). Opus adds up to ~0.6 dB of true peak, so the PCM is normalised to -2.5 dBTP.
- **The no-voice detector:** AudioSet AST on the full mix barely reacts to YuE2's buried singing (4a0f761 lobby: 0.09).
  Demucs's vocals stem, then AST on that stem, separates them: that lobby scores 0.43-0.47 (Lullaby/Singing classes) with
  15 windows of stem within -10 dB of the mix; the score renders stay <= 0.16 and <= -14.6 dB. "Singing bowl" is excluded
  (an instrument). Demucs's random shift moves scores by a few hundredths between runs. Demucs leaves the vocals stem near
  -55 dB on the Opus renders but -15..-26 dB on their WAV premasters; both pass, and the manifest records both.
