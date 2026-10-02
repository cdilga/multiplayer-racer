#!/usr/bin/env bash
# Tooling for "make the cloned announcer excited" experiments on eris:
#  * Qwen3-TTS 1.7B VoiceDesign (style from a text instruction) in the existing TTS venv;
#  * Seed-VC (zero-shot voice conversion: keeps the source's delivery, swaps in the target's
#    timbre) in its OWN venv so its pins can't break the TTS environment.
# Idempotent. Weights stay under $JJ_AUDIO_HOME.
set -euo pipefail

JJ_AUDIO_HOME="${JJ_AUDIO_HOME:-$HOME/Work/dev/jammers-audio}"
export HF_HOME="${HF_HOME:-$JJ_AUDIO_HOME/hf-cache}"
uv() { mise x uv@latest -- uv "$@"; }

"$JJ_AUDIO_HOME/.venv/bin/python" -c "
from huggingface_hub import snapshot_download
print('ready', snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign'))"

SEEDVC="$JJ_AUDIO_HOME/seed-vc"
if [[ ! -d "$SEEDVC/.git" ]]; then
  git clone --depth 1 https://github.com/Plachtaa/seed-vc.git "$SEEDVC"
fi
git -C "$SEEDVC" log -1 --format='seed-vc revision %H %cs'
if [[ ! -x "$SEEDVC/.venv/bin/python" ]]; then
  uv venv --python 3.10 "$SEEDVC/.venv"
fi
uv pip install --python "$SEEDVC/.venv/bin/python" --index-url https://download.pytorch.org/whl/cu128 torch torchaudio
grep -viE '^(torch|torchaudio)([=<> ]|$)' "$SEEDVC/requirements.txt" > "$SEEDVC/requirements.no-torch.txt"
uv pip install --python "$SEEDVC/.venv/bin/python" -r "$SEEDVC/requirements.no-torch.txt"
"$SEEDVC/.venv/bin/python" -c "import torch; print('seed-vc torch', torch.__version__, torch.cuda.is_available())"
echo "voice-energy tooling ready"
