# P1-A02v receipt: score-only music with no voices (br-4py3)

Agent BrownCreek, 2026-10-08. Hardware: eris (Arch/Omarchy, RTX 2080 SUPER 8 GB), workspace `~/Work/dev/jammers-audio`.
Tools: yue2.cpp @ ea07706f4958a9594f4ef1dd185e5ce1b5ab1175, YuE2-3B BF16 GGUF (Serveurperso/YuE2-GGUF @ 64b030e3),
FluidSynth 2.6.1 (conda-forge), FluidR3_GM.sf2 sha256 74594e8f…1bc1cb0 (MIT, Frank Wen; Debian fluid-soundfont-gm
3.1-5.3), Demucs 4.0.1 htdemucs + MIT/ast-finetuned-audioset-10-10-0.4593 (detector only).

The owner hears a wordless vocal in the 4a0f761 music (YuE2 acoustic renders). The eight tracks are replaced by YuE2
plan-stage scores rendered through instrument SoundFont patches. Owner (2026-10-08, via the coordinator): no listening
gate; a track ships when (1) the pipeline proof and (2) a calibrated no-voice check both hold.

## 1. Composition: YuE2 plan stage only

`tools/audio/eris-music-plan.sh` → `music_score_plan.py` (cues and seeds: `tools/audio/music-cues-scoreonly.json`):
lobby 4 seeds, race 8, results 6; style tags as in 4a0f761's fresh takes; `lyrics: ""`, `cot: "full"`. Every run:

```
$ yue2.cpp/build-cuda/yue-plan --model yue2.cpp/models/YuE2-3B-BF16.gguf --request <cue>/s<seed>/request.json \
      --out <cue>/s<seed>/score.abc --lm-seed <seed> --max-seq 6144
lobby seed 11 rc 0 17s · 23 rc 0 20s · 37 rc 0 15s · 41 rc 0 14s
race  seed 11 rc 0 41s · 23 rc 0 46s · 37 rc 0 35s · 41 rc 0 39s · 53 rc 0 27s · 67 rc 0 29s · 79 rc 0 38s · 97 rc 0 33s
results seed 11 rc 0 13s · 23 rc 0 33s · 37 rc 0 15s · 41 rc 0 24s · 53 rc 0 27s · 67 rc 0 16s
[Plan] Prefix 64 tokens, score 1907 tokens, seed 23 -> drafts/music/scoreonly/lobby/s23/score.abc   (e.g.)
```

`yue-plan` runs the autoregressive stage up to the end of the score and stops: no semantic codes, no NAR, no VAE, no
audio file. Lobby seed 23's score is byte-identical to the score inside 4a0f761's `lobby/fresh.s23` (the owner's
favourite composition), now played by instruments.

## 2. Render: MIDI + SoundFont only (the primary no-voice proof)

`render_score.py --cue <cue> --score score.abc --out render --bpm <95|140|125> --seed <seed>` parses the ABC, arranges it
as General MIDI and runs:

```
fluidsynth -n -i -q -r 48000 -g 0.5 -R 1 -C 1 -O s24 -T wav -F render-3pass.wav FluidR3_GM.sf2 arrangement.mid
```

- The arrangement MIDIs are committed (`assets/audio/music/scores/*.mid`). Their only events: note on/off, CC
  (7 volume, 10 pan, 91 reverb), program change, tempo, track name, end of track. Programs used: lobby 27 clean
  electric guitar (the "Vocal" melody staff), 4 Rhodes (counter + comp), 89 warm pad, 33 fingered bass, drum kit 0;
  race 81 saw lead, 29 overdriven guitar, 90 polysynth, 89 warm pad, 38 synth bass, kit 24 electronic; results 61 brass
  section, 80 square lead, 62 synth brass, 50 synth strings, 38 synth bass, kit 16 power. GM 52/53/54/85/91 (choir,
  voice oohs, synth voice, voice lead, choir pad) are refused by the renderer and by CI.
- **Files FluidSynth opened** (strace via conda-forge, render of race-1 = race/s53, libraries and ALSA/Pulse config
  omitted): `FluidR3_GM.sf2`, `arrangement.mid`, the output WAV, `/dev/urandom`, `/etc/machine-id`, the Pulse cookie and
  socket dir, `/dev/snd/control*`, `/dev/shm/pulse-shm-*` (audio-driver probing; `-n -i` with `-F` writes the file, no
  playback). No other audio file was read. The traced re-render is bit-identical to the shipped render's source
  (sha256 20a91574…4d70be1 both).
- `export_music.py` then reads only that render (`loop-source.wav`: pass 2 of 3 + 3 s of pass 3) for loudness, the
  3 s crossfade and Opus.

## 3. Supplementary no-voice check, calibrated (`tools/audio/music_voice_check.py`)

Demucs htdemucs splits each file; AudioSet AST scores 5 s windows (2.5 s hop) of the **vocals stem** against every
AudioSet human-voice class (singing, choir, humming, chant, speech, lullaby, … ; "Singing bowl" excluded). Windows where
the stem is > 30 dB below the mix score 0. **Flag** when any window scores ≥ 0.25, or the stem is within −10 dB of the
mix in ≥ 2 windows. (AST on the full mix gave the vocal lobby only 0.09, so the stem stage is what makes it work.)

```
$ music_voice_check.py --device cuda --threshold 0.25 --out voice-check.json calib/shipped-4a0f761/*.ogg exports/music-scoreonly/*.ogg
```

Calibration on the 4a0f761 files (positive control = lobby.ogg, committed here as `positive-control-lobby-4a0f761.ogg`,
sha256 5e15c728…a1bcb1226):

| 4a0f761 file | max voice score (class) | max stem vs mix dB | stem-loud windows | verdict |
|---|---|---|---|---|
| **lobby.ogg** | **0.447 (Lullaby)** | **−4.3** | **15/33** | **FLAG** |
| race-1.ogg | 0.239 (Mantra) | −4.2 | 14/33 | FLAG |
| race-2.ogg | 0.347 (Speech) | −7.2 | 4/33 | FLAG |
| race-3.ogg | 0.0 | −52.3 | 0/33 | pass |
| race-4.ogg | 0.043 (Speech) | −25.1 | 0/33 | pass |
| results-1.ogg | 0.319 (Mantra) | −3.8 | 17/21 | FLAG |
| results-2.ogg | 0.047 (Speech) | −21.6 | 0/21 | pass |
| results-3.ogg | 0.0 | −38.1 | 0/21 | pass |

The four YuE2 *fresh* takes flag; the four *covers* (re-performances of the 0.1 tracks' transcribed scores) don't. The
detector can't say whether the owner hears voice in those four too; they're replaced anyway. Across three runs the
positive control scored 0.427–0.465 (Demucs's random shift), always with 14–15 stem-loud windows.

New tracks: the shipped Ogg and the WAV premaster (`loop-source.wav`) of each. All pass:

| file | cue | plan seed | key | bars | loop s | LUFS | dBTP | stereo − mono-fold dB | L/R corr | seam env corr | voice / stem dB (Ogg) | voice / stem dB (WAV) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lobby.ogg | lobby | 23 | C | 82 | 207.2 | −17.97 | −2.16 | 3.36 | 0.904 | 0.992 | 0.0 / −58.4 | 0.058 / −15.1 |
| race-1.ogg | race | 53 | E | 132 | 226.3 | −17.96 | −1.96 | 5.05 | 0.474 | 0.995 | 0.0 / −55.9 | 0.065 / −26.1 |
| race-2.ogg | race | 67 | Fm | 136 | 233.1 | −17.97 | −2.21 | 5.36 | 0.417 | 0.984 | 0.0 / −57.1 | 0.059 / −26.4 |
| race-3.ogg | race | 37 | Em | 148 | 253.7 | −17.97 | −2.10 | 5.19 | 0.441 | 0.993 | 0.011 / −20.5 | 0.065 / −19.0 |
| race-4.ogg | race | 41 | Em | 170 | 291.4 | −17.98 | −2.18 | 5.35 | 0.401 | 0.995 | 0.0 / −56.5 | 0.054 / −25.4 |
| results-1.ogg | results | 37 | C | 76 | 145.9 | −17.99 | −2.22 | 3.73 | 0.709 | 0.997 | 0.0 / −60.3 | 0.111 / −20.1 |
| results-2.ogg | results | 41 | F | 103 | 197.8 | −17.99 | −2.33 | 3.74 | 0.708 | 0.999 | 0.0 / −58.7 | 0.060 / −19.0 |
| results-3.ogg | results | 23 | D | 132 | 253.4 | −17.98 | −2.22 | 3.79 | 0.691 | 1.000 | 0.0 / −59.4 | 0.097 / −18.2 |

Margins: the worst new track scores 0.111 against the control's 0.447 (threshold 0.25), and its stem peaks at −15.1 dB
or lower against the control's −4.3 (threshold −10 dB). Raw reports: `voice-check.json`, `voice-check-premaster.json`,
`voice-check.txt`.

## 4. Loop, level, mono

- Loop: the MIDI holds the composition three times; pass 2 + 3 s of pass 3 is cut, so the 3 s triangular crossfade
  blends the next pass's head (with the previous pass's real reverb tail) into the same head. Seam envelope correlation
  (10 ms RMS, tail vs head) 0.984–1.000.
- Level: two-pass `loudnorm` (dynamic mode: the renders' ~16 dB crest factor needs true-peak limiting for −18 LUFS),
  PCM to −2.5 dBTP for Opus headroom; decoded Ogg −17.96…−17.99 LUFS, −1.96…−2.33 dBTP (spec −18 / ≤ −1.5).
- Mono-safe: L/R correlation 0.40–0.90 (no anti-phase), mono fold-down 3.4–5.4 dB under the stereo loudness (3 dB is
  the equal-channel baseline; race's chorus/pad width adds ~2 dB). CI holds correlation ≥ 0.3 and the fold ≤ 6 dB.
- AudioSet tags of the full mixes (`audioset-tags.json`): lobby → keyboard / electric piano / guitar; race and results
  → video game music, soundtrack, theme music.

## 5. CI

`scripts/ci/checks.sh` → "Music is score-only with no voice": `tools/audio/check_music_manifest.py` (every track
`method: score-only`, `source.tool: yue-plan`, renderer inputs exactly MIDI + SoundFont, no voice patch, score/MIDI/Ogg
hashes match (LFS pointer oids in the checks lane), no provenance naming yue-synth, an acoustic/NAR/VAE stage, a cover
or fresh acoustic take, Demucs, separation, stems or vocal rests; the no-voice result is for that exact file and unflagged;
the positive control's committed file matches and is flagged; level, loop and mono in spec) and its 11 tests
(`test_check_music_manifest.py`). Local run: `checks: ok 1s Music is score-only with no voice …`, 11 tests OK.
