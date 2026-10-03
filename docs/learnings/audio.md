# Audio (eris voice and music) learnings (append-only)

## 2026-10-03 · Voice render traps found building render_voice.py (P1-A01)

- **float32 does not fit.** Qwen3-TTS 1.7B Base ships in bfloat16; loading it as float32 on the 8 GB RTX 2080 SUPER
  runs out of memory (it asks for 1.16 GiB with 0.6 GiB free). bfloat16 *is* the checkpoint's full precision, so it is the
  "highest precision that fits". Generation peaks near 6.7 GiB, so nothing else may share the GPU.
- **Whisper after TTS in one process can OOM** (ctranslate2 does not see torch's cache). The worker runs `render`, `asr`
  and `finish` as separate processes so each frees the card on exit.
- **The slang screen needs a normaliser, not a looser threshold.** At WER 0, 7 of 61 rows failed only because Whisper
  spells slang or homophones its own way ("Struth" for "strewth", "Doors off" for "Door's off", "Already" for "All ready").
  `voice_screens.py` folds exactly those and records them in the manifest; WER is recomputed from the stored transcript, so a
  new fold needs no new ASR pass.
- **Qwen3-TTS garbles a line-initial "G'day"** (heard as "gay day", "day", "J-J-J"; some takes run on to the 10 s cap).
  Telling it "Gidday" fixes it (3 of 8 takes pass; Whisper writes "G'day"). "Gday" is heard as "G-Day" (8 of 8 takes, so a letter-name G) and
  "Guh-day" as "God day": a TTS respelling is a render input, the sheet stays canonical.
- **Warm takes come out about 9 dB quieter** than hype takes (raw about -30 LUFS against about -21), so they need +11 to
  +17 dB at export (hype +2 to +10). Loudness is normalised at export; judge by the exported files, not the raw takes.
- **An hour-long ssh dies with the laptop.** `render_voice.py` starts the worker detached on eris (`logs/p1a01.log`,
  `logs/p1a01.exit`) and follows the log; re-running resumes from the take cache.
- **dcg/zsh:** an `echo =====` in zsh is a command substitution error; the Mac guard blocks `rm -rf` outside /tmp and
  `python -c`. Use script files and `rm -f` on single files.
