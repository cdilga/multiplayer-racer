---
name: jammers-audio
description: How to regenerate Joystick Jammers 0.2 audio on eris, the GPU box. The announcer voice (the owner's cloned voice, Qwen3-TTS 1.7B, from A00's cue sheet) and the instrumental music (YuE2), with the automatic screens, the loudness targets, the export rules and what may enter the repo. Use when a cue line changes, a voice clip is rejected, a repair bead asks for new takes, you add a moment or music cue, or you need to touch tools/audio/ or assets/audio/.
---

# Jammers audio (voice and music on eris)

Everything in `tools/audio/` is documented in `tools/audio/README.md`; this is the working summary for an
agent who has to regenerate something. Audio is **generated on eris, never in this repo** (R89). The Mac holds
scripts, the cue sheet, exports and evidence; eris holds weights, the owner's recordings, clone prompts and every
non-picked take.

## Rules that bind you

- **Never commit** model weights, the owner's recordings or references, clone prompts, or private renders. Only
  `assets/audio/voice/*.ogg` (and `.m4a` twins) + `manifest.json`, `assets/audio/music/`, scripts, cue sheets and
  `docs/evidence/` receipts. Ogg/m4a under `assets/` and evidence reels are Git LFS (`.gitattributes`); after a push
  run `git lfs push --all <remote> <branch>`.
- **Copy comes from A00's sheet** (`tools/audio/cues-playtest1.tsv`, loader `tools/audio/check_cues.py`). Edit lines
  there, not in the render script. **No player names are spoken** (R69); a name, a digit in speech, a swear word or an
  unlisted Australianism makes the loader refuse the sheet. Run `tools/audio/check_cues.py` after editing it.
- **Owner approval is not a gate.** The best-scoring take that passes the screens is the candidate; the owner judges at
  a playtest, and a rejected cue becomes a repair bead (re-render that moment with new seeds).
- **Highest precision that fits, no quantised fallbacks.** Qwen3-TTS 1.7B Base runs in bfloat16 (its native precision;
  float32 does not fit 8 GB). YuE2 runs BF16 with an F32 VAE. If a model or dependency is missing on eris, run the
  matching `tools/audio/eris-setup-*.sh`; if that cannot fix it, stop and report what is missing. Never switch models.
- **One GPU job at a time** (RTX 2080 SUPER 8 GB). All voice and music jobs take `~/Work/dev/jammers-audio/.gpu.lock`
  (`render_voice.py` and `eris-audio-queue.sh` do it for you). Never run a second Whisper/TTS/music job by hand next to
  one that is running; check `nvidia-smi` first.
- **Music is instrumental.** Screen every candidate with Whisper for words and reject any with voice.
- Machine rule (R93): the tree, `br` and Agent Mail live on the Mac; GPU audio work is pinned to eris by hardware.

## Regenerate the announcer voice (one command)

```
tools/audio/render_voice.py --sheet tools/audio/cues-playtest1.tsv        # all rows; ~40 min the first time
tools/audio/render_voice.py --only wreck,door-off                          # a repair: just those moments
tools/audio/render_voice.py --dry-run                                      # validate the sheet, show the plan
tools/audio/render_voice.py --fetch-only                                   # copy the latest results from eris
tools/audio/render_voice.py --m4a-twin                                     # AAC twins, only if A03 finds Opus fails on Safari/iOS
```

It first calls A00's `check_sheet`: a sheet that breaks a rule is **refused** (exit 1) before anything reaches eris.
Then it syncs scripts + the validated rows to `~/Work/dev/jammers-audio`, starts the worker there detached (log
`logs/p1a01.log`; a dropped ssh does not kill it), follows the log, and copies back the picked clips and
`manifest.json` to `assets/audio/voice/<moment_id>-<variant>.ogg` and the reel + index to `docs/evidence/P1-A01/`.
Everything on eris is cached by (text, reference, seed, model, dtype): a rerun renders only what changed, and a
changed line re-renders only its row. Exit 0: all rows pass; 4: some row still fails; 3: eris/worker trouble.

What happens on eris (`voice_render_eris.py`): clone prompts are built once per reference and reused;
**`hype` rows clone the excited reference** (E4f: VoiceDesign performance converted by Seed-VC F0 mode `--lift 4`, in the
owner's timbre) and **`warm` rows the owner's own reference**; N seeded takes per row (default 8, seeds 1000+k);
Whisper large-v3 scores word accuracy, Qwen speaker embeddings score similarity to the owner, ffmpeg ebur128 scores
loudness; rows with no passing take get +4 seeds up to 16; the pick rule chooses; the pick is exported.

### The screens (`tools/audio/voice_screens.py`, recorded with pass/fail in `manifest.json`)

| Screen | Threshold |
|---|---|
| Word accuracy | Whisper WER vs the row's text = 0 after digit, homophone ("door's"="doors", "all ready"="already") and ASR-spelling normalisation (one wrong word fails) |
| Speaker similarity | >= 0.93 cosine to the owner reference (owner timbre scores 0.96-0.99; VoiceDesign alone 0.87-0.90) |
| Duration | 0.4 + 0.15/word to 2.0 + 0.6/word seconds (refuses runaway and truncated takes) |
| Raw loudness | measurable (>= -45 LUFS) and unclipped |
| Export loudness | decoded Opus within 1 LU of **-16 LUFS** integrated |
| Export true peak | <= **-1 dBTP** |

Pick rule: among passing takes, highest `0.6*(1-WER) + 0.4*similarity` (+ up to 0.1 for hype rows' pitch lift over the
owner); ties to the lower seed. ASR respellings of slang (a take that says "strewth" and Whisper writes "struth") go in
`ASR_ALIASES` in `voice_screens.py` only after you have listened; the table is recorded in the manifest. If the TTS
itself garbles a word (it garbles a line-initial "G'day"), add a `TTS_RESPELLINGS` entry (currently G'day -> Gidday): the
TTS is told the respelling, the screens still score the sheet's text, and the row records `tts_text`. Check a respelling
with several seeds before adopting it; "Gday" and "Guh-day" read worse than "Gidday".

### Export format

Ogg/Opus, mono, 48 kHz, 48 kbps VBR, silence trimmed (60 ms lead, 160 ms tail), normalised to -16 LUFS / -1 dBTP and
re-measured after decoding. `manifest.json` per row: moment, variant, text, file, sha256, chosen seed, every take's
WER/similarity/LUFS/true peak/pitch lift/score, the screens with thresholds and pass/fail, the model name and dtype, the
references used, the excited-reference selection evidence.

### References and transcripts

Owner reference: `private/voice/ref-B.wav` (+ `ref-B.txt`) on eris; excited reference:
`private/voice/energy/ref/excited-reff.wav` (+ `excited-ref.txt`). A new owner reference needs a FrankenWhisper
transcript (on the Mac: `fw transcribe --input REF.wav --backend whisper-cpp --model ~/.cache/franken_whisper_models/ggml-large-v3.bin
--language en --no-diarize --no-persist`); check the tail for end-of-clip hallucinations and cut the reference to the
cleanest stretch. A Qwen clone copies the reference's **delivery** as well as its timbre: a calm reference gives a calm
announcer. To build a new excited reference use `tools/audio/voice_energy.py --vc-mode f0 --lift 4` on eris (Seed-VC's
default speech model flattens the pitch; its torchaudio.save segfaults, so the script routes the save through soundfile).

### Adding or changing moments

Moments are declared once, in `check_cues.py` `MOMENTS` (A06 adds derby and item moments there and in the sheet). Add the
rows to the sheet, run `tools/audio/check_cues.py`, then `render_voice.py --only <moment>`. The loader's variant floors are
4 for a moment that can fire repeatedly in a round and 2 for a once-a-round moment.

## Regenerate music (YuE2, instrumental)

Setup once: `tools/audio/eris-setup-music.sh` (CUDA toolkit, `yue2.cpp` built for sm_75 at the qualified revision, YuE2-3B
BF16 + F32 VAE + SheetSage2 F32). Cues: `tools/audio/music-cues-playtest1.json`. Batch on eris (from `~/Work/dev/jammers-audio`):

```
flock .gpu.lock .venv/bin/python bin/music_batch.py --cues bin/music-cues-playtest1.json --refs refs --out drafts/music/batch1
```

`music_batch.py` renders fresh compositions and covers of the 0.1 tracks, then screens every take with Whisper for words
and marks vocals rejected. Export the approved picks with `export_music.py` (two-pass loudness to -18 LUFS / -1.5 dBTP, a
3 s loop crossfade, Opus 128 kb/s stereo, provenance manifest) into `assets/audio/music/`; the selection list in that
script is the owner-approved one (P1-A02). The YuE2 weights are CC BY-NC 4.0 with a creator exception: flag it before any
company release. Loop quality is still an ear check.

## Where the evidence goes

`docs/evidence/P1-A01/` holds a copy of `manifest.json`, the audition reel (`audition-reel.ogg`) and its index
(`audition-reel-index.txt`) and `local-receipt.txt`. If a reel would exceed ~20 MB, keep it on eris
(`~/Work/dev/jammers-audio/auditions/p1a01/`) and commit only the index and manifest. Record traps you hit in
`docs/learnings/audio.md`.
