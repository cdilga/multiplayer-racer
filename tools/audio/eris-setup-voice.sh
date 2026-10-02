#!/usr/bin/env bash
# Set up the GPU voice toolchain on eris (RTX 2080 SUPER, 8 GB): a Python 3.12 env with CUDA
# PyTorch, Qwen3-TTS (1.7B Base, voice cloning) and faster-whisper (large-v3) for transcription and
# ASR checks. Idempotent. Weights and private voice data live under $JJ_AUDIO_HOME, never in the repo.
set -euo pipefail

JJ_AUDIO_HOME="${JJ_AUDIO_HOME:-$HOME/Work/dev/jammers-audio}"
VENV="$JJ_AUDIO_HOME/.venv"
export HF_HOME="${HF_HOME:-$JJ_AUDIO_HOME/hf-cache}"
mkdir -p "$JJ_AUDIO_HOME/private/voice" "$HF_HOME"

uv() { mise x uv@latest -- uv "$@"; }

if [[ ! -x "$VENV/bin/python" ]]; then
  uv venv --python 3.12 "$VENV"
fi
# PyTorch wheels bundle their CUDA runtime, so no system toolkit is needed. qwen-tts pulls the
# default (CUDA 13.0) torch from PyPI, so install it first and then force torch + torchaudio from
# the matching CUDA 13.0 index; mismatched builds fail at import. flash-attn doesn't support the
# 2080's Turing GPU, so attention runs on PyTorch SDPA.
uv pip install --python "$VENV/bin/python" -U qwen-tts faster-whisper soundfile numpy \
  "huggingface_hub[hf_xet]"
# Note: faster-whisper 1.2.1 passes metadata_errors= to av.open, which PyAV 15+ removed, so the
# scripts decode audio with soundfile + torchaudio and pass arrays to Whisper instead.
uv pip install --python "$VENV/bin/python" --reinstall --index-url https://download.pytorch.org/whl/cu130 \
  torch torchaudio

"$VENV/bin/python" - <<'PY'
import torch
assert torch.cuda.is_available(), "CUDA not visible to PyTorch"
print("torch", torch.__version__, "cuda", torch.version.cuda, torch.cuda.get_device_name(0),
      "capability", torch.cuda.get_device_capability(0))
PY

"$VENV/bin/python" - <<'PY'
from huggingface_hub import snapshot_download
for repo in ("Qwen/Qwen3-TTS-12Hz-1.7B-Base", "Qwen/Qwen3-TTS-Tokenizer-12Hz",
             "Systran/faster-whisper-large-v3"):
    path = snapshot_download(repo)
    print("ready", repo, path)
PY

"$VENV/bin/python" -c "import qwen_tts, faster_whisper; print('qwen_tts', getattr(qwen_tts, '__version__', '?'), 'faster_whisper', faster_whisper.__version__)"
echo "voice toolchain ready in $JJ_AUDIO_HOME"
