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

## 2026-10-04 · Engine synth start/stop traps (P1-A04c)

- **Engine synth: a sequence the voice plays by itself must not lean on derived state** (P1-A04c). The stop holds the
  oscillators on the rpm at the cut and moves pitch on `detune`; with no `speed` passed, the road layers derived speed
  from that frozen rpm, so a car handed back in gear hummed at -62 dB after "silence" until the next `set()`. Road speed
  is only derived while the engine runs; transitions that happen with no `set()` (off after a stop) must leave the same
  targets as the phase before. Reproduce real-time-only leftovers with a loop of page runs, then mute one layer at a time:
  if *any* mute clears it, the cause is a stale target (the mute re-applies), not that layer.
- **Engine synth: hash only single-layer renders.** Chromium sums a node's inputs in no fixed order, so a render with
  several live layers (including layers muted at t=0 that are still gliding out) differs in the last float32 bit run to
  run. Compare multi-layer renders by max difference (< 1e-6, -120 dBFS), as R1/R3/SL3 do.

## 2026-10-06 · A clipped clone reference leaks its missing words into every take (P1-A01b)

- **The reference audio must end where its transcript ends, on a word boundary.** The owner's Aussie hype reference was
  cut at exactly 23.0 s, mid-word ("and the wheelie..."), but its transcript ran on to "...bin is airborne". Qwen3-TTS
  in-context cloning continues from the prompt, so every one of the 52 hype takes opened with "is airborne" (WER 0.2-0.6,
  52/52 failing). Fix: trim in a pause (Whisper word timestamps), 30 ms fade, 0.35 s silence, cut the transcript to
  match. The uncut file stays beside it on eris as `hype-uncut-23s.wav`.
- **Read the `heard` field before blaming the accent.** A shared leading phrase across every failing take is a reference
  problem; scattered spelling misses ("Cooey", "Good day") are Whisper folds.
- **Longer references raise the peak:** with the 23-25 s Aussie references, the 1.7B bf16 render runs out of memory on
  some takes even with only desktop apps (~1.5 GiB) on the card. The worker skips those seeds and tries more.
- **Transcribe a slang-heavy reference twice.** Unprimed Whisper turned the warm reference's "hard yakka", "sparrow's
  fart" and "number 8 wire" into "hard jackets", "Barrett's fight" and "number 8 wine". A second pass primed with the
  expected slang fixes those; where the two passes disagree, keep the unprimed reading, because priming pulls toward the
  prompt. The raw transcript stays on eris as `warm-whisper-raw.txt`.
