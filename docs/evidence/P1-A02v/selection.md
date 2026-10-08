# P1-A02v selection: listening proxies per candidate

All 18 plan-stage scores were rendered (`render_score.py`) and checked by the no-voice detector (all passed, max voice
score 0.155, max vocals-stem level −15.1 dB vs the mix). Picks use proxies an agent can measure: the score's form (a
chorus to carry the motif and an outro to end on), motif repetition (share of lead bars whose exact rhythm and pitches
recur), and few bars where neither melody staff plays. `yue-plan` writes whole songs regardless of `duration`, so loops
run 2.5–5 min.

| cue | seed | length | bars | lead bars | Ins bars | empty | motif rep | form | pick |
|---|---|---|---|---|---|---|---|---|---|
| lobby | 11 | 169 s | 67 | 36 | — | 10 | 0.97 | int-ver-cho ×3-out | |
| lobby | **23** | 207 s | 82 | 32 | — | 2 | 1.00 | int-ver-cho-int ×2-out | **lobby** (same composition as the owner's favourite 4a0f761 take) |
| lobby | 37 | 147 s | 58 | 24 | — | 10 | 1.00 | int-ver-cho-int-ver-cho-out | |
| lobby | 41 | 136 s | 54 | 34 | — | 4 | 0.76 | int-ver-cho-ver-pre-cho-out | |
| race | 11 | 300 s | 175 | 42 | 130 | 3 | 0.81 | no chorus | |
| race | 23 | 305 s | 178 | 0 | 170 | 8 | 0.00 | int-int (no melody staff) | |
| race | **37** | 254 s | 148 | 45 | 99 | 7 | 0.80 | int-ver-cho-int-ver-cho-int-cho-int | **race-3** |
| race | **41** | 291 s | 170 | 76 | 101 | 13 | 0.86 | int-ver-cho-int-ver-cho-int | **race-4** |
| race | **53** | 226 s | 132 | 68 | 75 | 6 | 0.91 | int-ver-pre-cho-int ×2-out | **race-1** |
| race | **67** | 233 s | 136 | 66 | 62 | 12 | 0.95 | int-ver-pre-cho-int ×2-out | **race-2** |
| race | 79 | 245 s | 143 | 32 | 110 | 3 | 0.84 | one chorus | |
| race | 97 | 201 s | 117 | 15 | 94 | 8 | 0.40 | weak motif | |
| results | 11 | 109 s | 57 | 16 | 30 | 11 | 0.94 | sparse melody | |
| results | **23** | 253 s | 132 | 110 | 50 | 3 | 0.96 | int-ver-pre-cho ×2-out | **results-3** |
| results | **37** | 146 s | 76 | 50 | 29 | 1 | 0.96 | int-ver-cho ×3-int-out | **results-1** |
| results | **41** | 198 s | 103 | 67 | 34 | 4 | 0.90 | …-int-bridge-cho-out | **results-2** |
| results | 53 | 244 s | 127 | 72 | 52 | 5 | 0.78 | int-ver-cho-int ×2-cho-out | |
| results | 67 | 154 s | 80 | 57 | 15 | 8 | 1.00 | no outro | |

Arrangement per cue (`render_score.py` `PALETTES`): lobby — clean electric guitar lead, Rhodes counter and off-beat comp,
warm pad, fingered bass, laid-back swung kit at 95 BPM; race — saw lead an octave up, overdriven guitar counter, polysynth
eighth stabs, synth-bass eighth pulse, four-on-the-floor electronic kit with fills every 8 bars at 140 BPM; results —
brass-section lead, square-lead counter, synth-brass stabs, synth strings, power kit with snare pickups every 4 bars at
125 BPM. Section energy scales velocities (intro/outro softer, chorus full) and a crash marks each section start.
