# P1-A01b receipt: announcer voice audition renders (steps 1-4)

Run 2026-10-05 by the BoldKite bead helper (Claude Sonnet 5.5 sub-agent). Raw audio, references, `.ftvoice` packs and metrics JSON stay in the
gitignored `private/p1a01b/` on the Mac and `~/Work/dev/jammers-audio/private/voice/p1a01b/` on eris. The step-5 full 61-row render was NOT run.

## Machines and versions
- eris: Arch Linux, RTX 2080 SUPER 8 GB. The owner's desktop apps (Brave, ChatGPT, Discord, 1Password) held ~3.5 GB of VRAM for the whole run and
  another user's Blender job briefly more; nothing of theirs was touched. Qwen3-TTS 1.7B (qwen_tts 0.1.1, torch 2.14.1+cu130) bf16 does not fit
  beside that with its codec, so `audition_eris.py load()` keeps the talker in bf16 on the GPU and runs the speech-tokenizer codec on the CPU in
  float32 (same weights; bf16 CPU conv was unusably slow). Whisper large-v3 (faster-whisper 1.2.1) ran as `int8_float16` because float16 did not
  fit: ASR scoring only, not TTS. Every GPU job ran under `.gpu.lock`.
- Mac (macOS 27.0.1): `ftts` 0.1.10 (Qwen3-TTS-12Hz-0.6B-Base int8 `.fttsq`, pulled once with `ftts pull`), CPU only. `fw` was not needed.

## Commands
| Step | Where | Command | Time |
|---|---|---|---|
| 1 prompt-only | eris | `bin/audition_p1a01b.py design` (4 VoiceDesign descriptions C1-C4 x 8 cues, seed 7) | 165 s (32 clips) |
| 2 restyle once | eris | `... ref --cands C2:R1,C3:R2` (VoiceDesign read of the 20-30 s reference text, then Seed-VC F0 `--lift 4` into ref-B timbre) | 176 s; R1 20.5 s, R2 22.0 s |
| 3 eris engine | eris | `... clone` (Qwen3-TTS 1.7B Base bf16, in-context clone of E4F, OWNER, R1, R2 x 8 cues, seed 7) | 668 s (32 clips) |
| 3 enroll | Mac | `ftts enroll refs/<ID>.wav --transcript-file refs/<ID>.txt --mode quality -o ftvoice/<ID>.ftvoice` for E4F, OWNER, R1, R2 | 10-15 s each |
| 3 ftts engine | Mac | `docs/evidence/P1-A01b/render_ftts.py E4F OWNER` and `R1 R2` (`ftts say --voice <pack> "<cue>" out.wav`) | 32 clips, mean 14.1 s, max 24.5 s per cue |
| 4 metrics | eris | `... metrics` (speaker embedding similarity to ref-B) then `... asr` (Whisper WER, ffmpeg ebur128 LUFS, pitch spread) | 450 s + 62 s |
| page | Mac | `make_manifest.py` (AAC players level-matched to -20 LUFS, manifest.json) | |

Counts: 32 VoiceDesign candidate clips; 32 clips on Qwen3 1.7B bf16 (eris); 32 on FrankenTTS 0.6B int8 (Mac); 4 reference recordings scored
(E4F, OWNER, R1, R2) plus the owner's raw `chris-hq.m4a` as a player (loudness only, no transcript). 100 scored clips in `metrics.json`; 101 players.

## Things to know
- Cues: welcome (G'day), countdown, big-air (strewth), whoop-whoop, fair-dinkum, photo-finish, next-round (warm), cheers. "G'day" is respelled "Gidday" for both engines (the pipeline's `TTS_RESPELLINGS`).
- Which descriptions became references: C2 (slow drawl) and C3 (bright nasal) had the best mix of low WER (0.04) and pitch spread (8.3, 7.2 st). That is a metrics-only pick; nobody has listened.
- Owner raw recording: eris `private/voice/chris-hq.m4a` (copied to the Mac private/ dir); ref-B is the cut used as the owner reference. Its transcript is not published on the page.
- Consent: `ftts enroll` was run without `--consent-attest`; the packs record "consent NOT ATTESTED". The skill and A01/A01d evidence record the owner's approval of using the tools but no recording-consent statement, so the flag was not asserted on the owner's behalf. Packs stay private.
- Pitch median is a crude torchaudio tracker and reads high for VoiceDesign clips (~260-330 Hz); use spread as a relative number only.
- Metrics cannot judge "sounds like a broad Australian announcer"; the page says so.
- Publishing: see self-review.md "Remaining defects".
