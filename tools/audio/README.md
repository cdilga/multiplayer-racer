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

Transcripts of the owner's reference come from **FrankenWhisper** (`fw`) with the full Whisper
large-v3 model (`fw transcribe --model ~/.cache/franken_whisper_models/ggml-large-v3.bin`); check the
tail for end-of-clip hallucinations and cut the reference to the cleanest stretch.

Quality policy: highest precision that fits the GPU (fp32 TTS when it fits, BF16 music weights, no
quantised fallbacks), several seeded takes per line, automatic screening, then the owner's ears.
Music must be instrumental: screen every candidate for words and reject any with voice.
