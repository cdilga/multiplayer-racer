# Audio tooling (runs on eris)

> **Licence rider:** `franken_tts` and `franken_whisper` (`ftts`, `fw`) are MIT with an OpenAI/Anthropic rider. The owner confirmed on 2026-10-04 that their use, including by agents, is approved without reservation; agents may run them. Keep the author's permission, if any, in `docs/evidence/P1-A01d/permission.md`.

Generation happens on **eris** (`ssh eris`, RTX 2080 SUPER 8 GB, Arch Linux), never on the Mac and
never in this repo (R89). Workspace: `~/Work/dev/jammers-audio` (`JJ_AUDIO_HOME`). Model weights,
the owner's voice recordings, clone prompts and drafts stay there under `private/` (mode 700).
Only scripts, cue sheets and **approved, exported** clips live in the repo.

| File | What |
|---|---|
| `eris-setup-voice.sh` | Python 3.12 env with CUDA PyTorch, Qwen3-TTS 1.7B Base (voice clone) and faster-whisper large-v3 |
| `eris-setup-music.sh` | System CUDA toolkit, `yue2.cpp` built for CUDA (sm_75) at the qualified revision, YuE2-3B **BF16** + F32 VAE + SheetSage2 F32 |
| `voice_clone.py` | Builds the reusable clone prompt from a reference clip + exact transcript, renders N seeded takes per cue, scores word accuracy (Whisper) and speaker similarity, keeps the best |
| `render_voice.py` | **The one command for the announcer voice** (P1-A01): `tools/audio/render_voice.py --sheet tools/audio/cues-playtest1.tsv`. Refuses a sheet A00's `check_sheet` rejects, drives the eris worker, copies the picked clips + `manifest.json` to `assets/audio/voice/` and the reel + index to `docs/evidence/P1-A01/` |
| `voice_render_eris.py` | The eris half: clone prompts built once and cached, N seeded takes per row, Whisper WER + speaker similarity + loudness screens, the pick rule, Ogg/Opus export at -16 LUFS / -1 dBTP, `manifest.json`, audition reel. Cached by (text, reference, seed, model, dtype) |
| `voice_screens.py` | The screens, their thresholds and the pick rule (pure Python; unit-tested on the Mac). `manifest.json` records them |
| `test_render_voice.py` | Tests for the above: the render command refuses a bad sheet, the screens and the pick rule |
| `cues-playtest1-audition.tsv` | Draft audition lines for judging the voice. Final copy waits for the Australianisms pass (R53) and owner approval (R55) |
| `eris-setup-voice-energy.sh` | Adds Qwen3-TTS VoiceDesign to the voice env and Seed-VC (voice conversion) in its own venv, pinned to torch 2.8 |
| `voice_energy.py` | Gives a calm reference an excited delivery: VoiceDesign performs the line, Seed-VC converts it to the owner's timbre (`--vc-mode f0` keeps the pitch contour, `--lift` semitones above the owner), and the converted clip becomes the clone reference. Scores similarity, pitch and Whisper WER |
| `music-cues-playtest1.json`, `music_batch.py` | Music cue sheet and the YuE2 batch renderer (fresh compositions + covers of the 0.1 tracks), with a words screen |
| `export_music.py` | Exports approved takes to `assets/audio/music/` (loudness, loop crossfade, Opus) with a provenance manifest |
| `eris-audio-queue.sh` | Runs voice and music jobs one at a time on the GPU (takes `~/Work/dev/jammers-audio/.gpu.lock`, the same lock `render_voice.py` takes) |

A Qwen clone copies the reference's **delivery** as well as its timbre: a calm recording gives a calm
announcer. Seed-VC's default speech model re-pitches into the target's normal register and flattens
excitement; use its F0-conditioned mode. Its `torchaudio.save` segfaults on eris after writing only
the header, so `voice_energy.py` routes the save through soundfile.

Transcripts of the owner's reference come from **FrankenWhisper** (`fw`) with the full Whisper
large-v3 model (`fw transcribe --model ~/.cache/franken_whisper_models/ggml-large-v3.bin`); check the
tail for end-of-clip hallucinations and cut the reference to the cleanest stretch.

Quality policy: highest precision that fits the GPU (fp32 TTS when it fits, BF16 music weights, no
quantised fallbacks), several seeded takes per line, automatic screening, then the owner's ears.
Music must be instrumental: screen every candidate for words and reject any with voice.

## Regenerating the announcer voice (P1-A01)

```
tools/audio/render_voice.py --sheet tools/audio/cues-playtest1.tsv     # all rows, 8 seeded takes each
tools/audio/render_voice.py --only door-off,wreck                       # re-render just those moments
tools/audio/render_voice.py --dry-run                                   # validate the sheet, show the plan
tools/audio/render_voice.py --fetch-only                                # copy the latest results back
tools/audio/render_voice.py --m4a-twin                                  # also write AAC twins (Apple hosts; A03 asks for them)
```

The command runs A00's `check_sheet` first (a sheet that breaks a rule is refused with exit 1 and nothing is sent to
eris), syncs the scripts and the validated rows to eris, and starts the worker there **detached** (log
`~/Work/dev/jammers-audio/logs/p1a01.log`) under the shared GPU lock, so a dropped connection doesn't kill an hour-long
job; the command follows the log and re-running resumes from the cache. Exit 0: every row passes every screen; 4: some
row still fails after the extra seeds (read `manifest.json` `summary.failing_rows`); 3: eris/GPU/worker trouble.

What the worker does, per run:

1. **References.** `hype` rows clone the **excited** reference (`private/voice/energy/ref/excited-reff.wav`, the E4f
   candidate: VoiceDesign performance converted by Seed-VC's F0-conditioned mode, `--lift 4`); `warm` rows clone the
   owner's own recording (`private/voice/ref-B.wav`). The transcripts come from FrankenWhisper (`fw`, whisper.cpp, full
   `ggml-large-v3`, run on the Mac) and are cross-checked with faster-whisper large-v3 on eris (WER vs the stored text
   goes into `manifest.json`). The excited reference is chosen from the experiment metrics (`private/voice/energy/metrics.json`)
   by a stated rule and the comparison is recorded in the manifest.
2. **Clone prompts** (speaker embedding + in-context codec tokens) are built once per reference and cached under
   `private/voice/p1a01/prompts/`; every line and every later run reuses them.
3. **Takes.** N seeded takes per row (seeds 1000+k) with Qwen3-TTS 1.7B Base in **bfloat16**, the checkpoint's native
   precision. float32 does not fit the 8 GB card (the load runs out of memory at 1.16 GiB over; probed 2026-10-03).
   Generation is capped per line (the checkpoint default runs about 11 minutes).
4. **Screens** (`voice_screens.py`; thresholds and pass/fail are in `manifest.json`): WER 0 after digit, homophone
   and ASR-spelling normalisation (one wrong word fails; "door's"="doors", "all ready"="already", Whisper's "struth"
   and "gidday" for "strewth"/"g'day" are folded, nothing else), speaker similarity >= 0.93 against the owner reference, a duration window
   (refuses runaway and truncated takes), raw loudness measurable and unclipped, and on the exported Opus: integrated
   loudness within 1 LU of **-16 LUFS** and true peak <= **-1 dBTP** (ffmpeg ebur128). A row with no passing take gets
   4 more seeds, up to 16.
   **Pronunciation fix:** Qwen3-TTS garbles a line-initial "G'day" ("gay day", "day"; 1 pass in 16 takes on
   `late-joiner-4`), so the job tells it "Gidday" (`TTS_RESPELLINGS` in `voice_screens.py`); Whisper writes the result
   as "G'day" and WER is still scored against the sheet's text. The row's `tts_text` records the respelling. "Gday" and
   "Guh-day" were tried and read as "G-day"/"God day".
5. **Pick.** The best score among passing takes: `0.6*(1-WER) + 0.4*similarity`, plus up to 0.1 for hype rows' pitch lift
   over the owner (an energy proxy). The owner's ear overrides any pick.
6. **Export.** Trim silence, gain to -16 LUFS with a sample-peak limiter, Ogg/Opus 48 kbps mono 48 kHz, decode and
   re-measure, iterate. Files are `assets/audio/voice/<moment_id>-<variant>.ogg` (Git LFS).
7. **Reel.** One Opus file with every picked clip in sheet order (0.5 s between variants, 1.2 s between moments) and a
   timestamped index, under `docs/evidence/P1-A01/`.

Rules: no player names (R69), copy only from A00's sheet, the owner's recordings, references, clone prompts and
non-picked takes never leave eris (R89), only exports + manifest are committed. Owner approval is not a gate.
