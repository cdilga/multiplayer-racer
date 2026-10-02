# Audio tooling (runs on eris)

Generation happens on **eris** (`ssh eris`, RTX 2080 SUPER 8 GB, Arch Linux), never on the Mac and
never in this repo (R89). Workspace: `~/Work/dev/jammers-audio` (`JJ_AUDIO_HOME`). Model weights,
the owner's voice recordings, clone prompts and drafts stay there under `private/` (mode 700).
Only scripts, cue sheets and **approved, exported** clips live in the repo.

| File | What |
|---|---|
| `eris-setup-voice.sh` | Python 3.12 env with CUDA PyTorch, Qwen3-TTS 1.7B Base (voice clone) and faster-whisper large-v3 |
| `eris-setup-music.sh` | System CUDA toolkit, `yue2.cpp` built for CUDA (sm_75) at the qualified revision, YuE2-3B **BF16** + F32 VAE + SheetSage2 F32 |
| `voice_clone.py` | Builds the reusable clone prompt from a reference clip + exact transcript, renders N seeded takes per cue, scores word accuracy (Whisper) and speaker similarity, keeps the best |
| `cues-playtest1-audition.tsv` | Draft audition lines for judging the voice. Final copy waits for the Australianisms pass (R53) and owner approval (R55) |
| `eris-setup-voice-energy.sh` | Adds Qwen3-TTS VoiceDesign to the voice env and Seed-VC (voice conversion) in its own venv, pinned to torch 2.8 |
| `voice_energy.py` | Gives a calm reference an excited delivery: VoiceDesign performs the line, Seed-VC converts it to the owner's timbre (`--vc-mode f0` keeps the pitch contour, `--lift` semitones above the owner), and the converted clip becomes the clone reference. Scores similarity, pitch and Whisper WER |
| `music-cues-playtest1.json`, `music_batch.py` | Music cue sheet and the YuE2 batch renderer (fresh compositions + covers of the 0.1 tracks), with a words screen |
| `export_music.py` | Exports approved takes to `assets/audio/music/` (loudness, loop crossfade, Opus) with a provenance manifest |
| `eris-audio-queue.sh` | Runs voice and music jobs one at a time on the GPU |

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
