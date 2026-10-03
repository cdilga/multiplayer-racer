# Licence rider decision: franken_tts and franken_whisper (P1-A01d)

- **Date:** 2026-10-04.
- **Question:** `franken_tts` 0.1.10 and `franken_whisper` 0.9.3 are licensed "MIT License (with OpenAI/Anthropic Rider)". The rider grants no rights to Anthropic, OpenAI, their affiliates, or anyone acting on their behalf, and defines "use" to include executing, testing and benchmarking. Claude agents work in this repo.
- **Owner decision:** "It's unequivocally approved." The owner approved use of both tools for this project without reservation, including by agents working for them.
- **Basis:** the owner's own confirmation (no separate written permission from the author is on file in this repo). If the author's written permission exists, add it here.
- **Effect:** the guard in `br-5hg4` / `br-dewq` is removed; agents may run `ftts enroll|say|pull` and `fw transcribe`. `tools/audio/README.md` states the approval.
