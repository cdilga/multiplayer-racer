---
name: jammers-audio
description: Generate and export Joystick Jammers announcements and music. Routes new voice work to the shared Stevo default, preserves original Maya1 batch reproduction, and documents cue checks, mastering and private assets.
---

## Default voice for future work

Owner selection, 26 October 2026: **Stevo Australian Announcer Voice** (`stevo-australian-announcer-v1`) is the default for new voice work. It is the QUALITY FrankenTTS recovery of Aussie Maya1; aliases `stevo` and `aussie-maya1-frankentts-v1` resolve to the same unchanged pack. Explicit alternatives remain selectable: original `aussie-maya1-v1` or `chris-announcer-combined-v1`.

Use the user-local skill `/Users/cdilga/.codex/skills/shared-voice-packs/SKILL.md` and shared private registry `/Users/cdilga/Documents/dev/Voices/voices.json`. Generate new Stevo lines with `python3 /Users/cdilga/Documents/dev/Voices/render-frankentts.py --text "Your line" --out /path/to/fresh.wav`; `--voice` selects a local alternative. Original Maya1 uses its separate renderer. This owner instruction permits the shared local workflow on the Mac or eris. Retain the repo's cue, mastering and export checks. Existing paid Maya1 batches, caches and shipped media keep their actual provenance; the commands below that explicitly name Maya1 reproduce those batches and do not implement Stevo batch generation. No automatic regeneration or asset installation follows from the new default.



# Jammers audio (voice and music on eris)

Everything in `tools/audio/` is documented in `tools/audio/README.md`; this is the working summary for an
agent who has to regenerate something. Historical batch audio is **generated on eris, never in this repo** (R89).
The owner-authorized shared Stevo workflow also runs on the Mac outside the repo. Private references, weights,
clone prompts and non-picked takes stay out of project Git and public exports.

## Original Maya1 batch — owner selection, 25 October 2026

**The existing replacement batch uses `aussie-maya1-v1`.** The owner selected the current live Physical Soccer voice for both games, then requested every Jammers announcement be regenerated. [`tools/audio/maya1-voice.json`](../../../tools/audio/maya1-voice.json) pins the exact fal.ai `fal-ai/maya` prompt, temperature 0.3 and 48 kHz WAV recipe, with a recipe hash and the verified live reference. This is a project recipe ID: Maya1 has no provider voice ID or seed and does not use an owner recording. Keep this batch's original provenance; future voice selection follows the Stevo policy above.

Run `python3 tools/audio/maya1.py --estimate`, then `python3 tools/audio/maya1.py --key-file /secure/path` (or configured `FAL_KEY`). The Mac validates the full cue sheet; generation requests, raw takes, Whisper ASR and Opus mastering run from eris. Only a complete batch passing the ASR/duration/audio screens replaces `assets/audio/voice/`. Requests are cached by exact text + recipe hash and pending IDs resume without a new paid submission. No automatic paid retakes. `--fetch-only` resumes export retrieval; private review lives under `private/voice/maya1-gameplay/review/`.

The saved macOS Keychain service is `fal-api-key`; the renderer reads it into subprocess memory if environment/file credentials are absent. Never print its value. Owner authorized up to **$2 total** for the 25 October gameplay + Jammers/Soccer promo replacement; coordinate one spend owner across sessions. That authorization is not a general future budget.

After all takes are cached, use `--cached-only --review-only` to run ASR/mastering and fetch the private review without credentials, provider submissions or game-asset changes. Flagged batches are fetched for inspection but never installed. Respect an owner media-publication hold independently of a technical screen pass.

With independently recorded Mac ASR, add `--cached-asr-only`: every transcript must match its raw SHA and no CUDA/Whisper model is imported or initialized. The worker refuses missing transcripts rather than using the GPU during a timing CI run. The manifest retains each ASR model/run and any exact aligned group hypothesis span; edited rows are checked separately. This does not turn transcription into listening approval.

`python3 tools/audio/maya1.py --local` uses pinned original Maya1 weights with native FP16 on eris (no quantization), SNAC **1.2.1**, and the same description/temperature. A 2.39-second line rendered in 5.667 seconds with the model fully on GPU. Under shared CI GPU load, CPU weight offload made a 5.55-second welcome take 70.072 seconds. It pauses/restores voxtype only while holding the audio GPU lock. Local backend settings/revisions are separate provenance; do not claim the fal.ai and local outputs are byte-identical. The shared local library `/Users/cdilga/Documents/dev/Voices` includes this recipe, examples and reusable eris runner, with Combined stored separately.

Owner subsequently requested an offline FrankenTTS derivative: `aussie-maya1-frankentts-v1` in that shared library. It is a QUALITY transcript/codec-conditioned ICL voice pack from a fresh20.309-second canonical synthetic Maya1 reference (4,064 codec frames), not a fine-tuned checkpoint. The Mac's `render-frankentts.py` helper generates locally without API spend; fresh tagline/next-round examples pass transcript checks. Voice similarity is not listening-approved. Keep the original Maya1 canonical ID/backend and the derivative distinct; do not substitute this derivative for the already-generated Jammers batch without an owner instruction. References/packs/helpers remain private outside Git.

For the promo, validate its current job with `tools/promo/voice-job.py`, then `python3 tools/audio/maya1.py --job tools/promo/voice-job.json --batch maya1-promo --key-file /secure/path`. Gameplay and promo caches/exports stay separate. The original Qwen pipeline below is historical, not the default; its owner-speaker similarity screen does not apply to prompt-defined Maya1. Maya1 candidates use Whisper word accuracy, duration, raw clipping and decoded Opus targets (−16 LUFS ±1 LU, ≤−1 dBTP). ASR is a sanity check, not a listening approval.

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
  matching `tools/audio/eris-setup-*.sh`; if that cannot fix it, stop and report what is missing. Never switch models unless the owner explicitly selects a replacement, as with Maya1 above.
- **One GPU job at a time** (RTX 2080 SUPER 8 GB). All voice and music jobs take `~/Work/dev/jammers-audio/.gpu.lock`
  (`render_voice.py` and `eris-audio-queue.sh` do it for you). Never run a second Whisper/TTS/music job by hand next to
  one that is running; check `nvidia-smi` first.
- **Music has no voices at all.** Score-only path only (below); the calibrated no-voice check must pass on every file.
- Machine rule (R93): the tree, `br` and Agent Mail live on the Mac; GPU audio work is pinned to eris by hardware.

## Historical Qwen clone workflow (superseded)

The public `render_voice.py` command now routes to Maya1 (`--dry-run` maps to `--estimate`). The commands below require explicit `--legacy-qwen` for historical reproduction; they must never replace the canonical announcer silently.

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

## Regenerate music (score-only: YuE2 plan stage + SoundFont render)

**No voices at all** in music, wordless vocalisations included (owner, 2026-10-08). YuE2's acoustic stage sings even with
empty lyrics, so music comes only from the **plan stage** (`yue-plan`: an ABC score, no audio) rendered by
`tools/audio/render_score.py` as General MIDI through FluidSynth + FluidR3_GM.sf2 (MIT). Every staff, including the one YuE2
labels "Vocal" (its melody notation), plays an allow-listed instrument patch; GM voice/choir programs are refused. Raw
acoustic takes (`music_batch.py`), Demucs stems and "Vocal notes to rests" are diagnostics, never candidates.

Steps (details and commands: `tools/audio/README.md`, "Regenerating the music"): `eris-setup-score-instruments.sh` once;
`eris-music-plan.sh` (stops the voxtype daemon for VRAM, restarts it; 15-45 s a plan); `render_score.py` per take; pick in
`export_music.py` `SELECTION` by listening proxies (a chorus and an ending, a repeated motif, few empty bars); export
(-18 LUFS / -1.5 dBTP, 3 s loop crossfade over matching material, Opus 128 kb/s); run `music_voice_check.py` (Demucs vocals
stem -> AudioSet AST, threshold 0.25, stem within -10 dB of the mix in >= 2 windows) on the 4a0f761 tracks and the new
files; `export_music.py --finalise` writes the manifest and refuses a flagged track or a detector that misses the
positive control (`docs/evidence/P1-A02v/positive-control-lobby-4a0f761.ogg`). CI's `check_music_manifest.py` refuses
any track whose provenance names an acoustic render. No owner listening gate: a track ships when the pipeline proof and
the calibrated no-voice check both hold. The YuE2 weights are CC BY-NC 4.0 with a creator exception: flag it before any
company release.

## Where the evidence goes

`docs/evidence/P1-A01/` holds a copy of `manifest.json`, the audition reel (`audition-reel.ogg`) and its index
(`audition-reel-index.txt`) and `local-receipt.txt`. If a reel would exceed ~20 MB, keep it on eris
(`~/Work/dev/jammers-audio/auditions/p1a01/`) and commit only the index and manifest. Record traps you hit in
`docs/learnings/audio.md`.
