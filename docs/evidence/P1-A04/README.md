# P1-A04 evidence: engine synth prototype

What was built: a procedural Web Audio engine voice (`web/shared/audio/engine-synth/`), the Cruz Missile's
profile as data (`assets/audio/engine/cruz-missile.json`, contract `web/shared/audio/engine-synth/profile.schema.json`)
and the design-review gallery (`art/ui/poc/audio/engine/index.html`). Rerun everything with
`node art/ui/poc/audio/engine/check.mjs` (about 2.5 minutes; `--quick` skips the CPU benchmark).

| File | What it is |
|---|---|
| `scripted-lap.wav` | The 38 s scripted lap rendered through one voice (OfflineAudioContext, 48 kHz, then 24 kHz mono 16-bit, 1.8 MB). Listen to it without opening the page. |
| `lap-spectrogram.png` | The same render, 0 to 3 kHz. The comb of harmonics is the firing note following rpm; the drops are the gear changes; the block at 15 to 18 s is the powerslide squeal. |
| `gallery.png`, `gallery-phone.png` | The page at 1280 px and 390 px wide, mid-lap (gravel, boost, loosened body). |
| `cpu.json` | Per-voice CPU cost, all runs and the method. |
| `checks.json` | Every check's result and measured values (layer levels, determinism, pitch tracking). |
| `local-receipt.txt` | The commands run and their output. |

## Per-voice CPU cost

Machine: Apple M1 Pro (8 cores, 16 GiB), macOS 27.0.1, Chromium 151.0.7922.34 (Playwright 1.62.1, new headless,
channel `chromium`), Node 26.10.0, 48 kHz. Another agent's Chromium was running at the same time (load average
3.5), so treat each figure as good to roughly 10%.

Method: `OfflineAudioContext` renders as fast as one thread allows, so the time `startRendering()` takes is the
audio-thread cost. N voices (1, 8, 24, 32; samples of N, not limits), each with its own seed, median of 5 runs.
"Static" holds one state for 10 s with the empty-graph time subtracted. "Lap" drives every voice through the 38 s
scripted lap with a `set()` per voice every 20 ms, as a game would; the same render with 0 voices (suspend and
promise overhead) is subtracted, then the measured main-thread time of the `set()` callbacks.

**Milliseconds of audio-thread time per second of audio, per voice** (divide by 10 for percent of one core in real time):

| Voices | Idle (neutral, nothing live) | Cruise (3500 rpm, half throttle, tarmac) | Every layer live | Scripted lap |
|---:|---:|---:|---:|---:|
| 1 | 2.45 | 3.21 | 6.89 | 5.61 |
| 8 | 2.56 | 3.47 | 7.00 | 5.52 |
| 24 | 2.63 | 3.60 | 7.09 | 6.63 |
| 32 | 2.65 | 3.58 | 7.20 | 5.91 |

So a voice costs 0.25 to 0.72 % of one core, flat in the voice count; 32 voices on the lap is about 19 % of one
core. A `set()` call costs 1.7 to 3.5 microseconds of main-thread time per voice. A WebKit (Playwright build, not
Safari, not a device) render of the same lap has the same level and no NaN (check W1); no timings were taken there.

Where it goes: scratch micro-benchmarks (not committed) put Chromium at about 0.4 to 0.5 ms/s per biquad filter,
0.2 ms/s per oscillator and 0.06 ms/s per gain, and a voice has 3 to 10 live filters depending on which layers are
active. Layers with
nothing to say are disconnected, which is why idle is a third of the worst case. Options if P1-A05 needs it cheaper,
none taken here: bake the fixed-band noise (rattle, pops, whoosh) into the shared noise buffers, drop layers on
distant cars through `setLayerEnabled`, or move the voice to an AudioWorklet or WASM.

## Determinism

`renderLapOffline` is deterministic for the same input curve and seed: nothing uses `Math.random`, the noise is
generated from fixed seeds, and control steps run at fixed suspend points. Two renders differ by at most 1.2e-7
(-138 dBFS, one float32 bit) because Chromium sums a node's inputs in no fixed order and three or more layers are
live together; any single layer is bit-identical (checks R1, R1b, R3). The check therefore compares to -120 dBFS, not
bit for bit, and the WAV bytes can differ by a least-significant bit between runs.

## Known limits and judgement calls

- **Tuned by measurement, not by ear.** The author (an agent) has no speakers. Layer levels, pitch tracking and
  the shape of the lap are verified from renders (checks L1 to L12, the spectrogram); how it *sounds* is for the
  design review. The likeliest complaint is that the firing note is too clean: it is perfectly periodic with no
  cycle-to-cycle jitter, so only the noise layers and the idle lope roughen it.
- **The lap is authored, not recorded.** `lap.json` is driver controls integrated through a point-mass car by
  `make-lap.mjs`; P1-A05 should replace it with a recording from the sim.
- **Serve the repo root.** The page reads `art/ui/tokens.json`, `art/ui/fonts/` and `assets/audio/engine/` by
  relative path, so any static server rooted at the repo (or a copy keeping those paths) works; opening the file
  with `file://` does not (module and fetch restrictions).
- **Nominal level.** One voice sits near -20 dBFS RMS on the lap, with peaks near -4.5 dBFS (and -1.7 dBFS with every
  layer maxed). P1-A05 owns the mix across cars.
- **Gear 0 means standing still.** Surface rumble and tyre squeal scale with speed; a state with no `speed` derives it
  from rpm and gear, so neutral is silent on the road layers. `set()` merges, so a `speed` once given sticks until
  `speed: undefined` is passed.
- **Type-checked in its own tsconfig.** `web/tsconfig.json` does not include `shared/audio`, so `npm --prefix web run
  build` does not compile the module; `web/shared/audio/engine-synth/tsconfig.json` does (strict, check S4). P1-A05
  should add `shared/audio` to the web tsconfig include when it imports the module.
