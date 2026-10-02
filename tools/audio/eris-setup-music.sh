#!/usr/bin/env bash
# Set up the GPU music toolchain on eris: system CUDA toolkit, yue2.cpp built for CUDA (RTX 2080
# SUPER = sm_75) and the highest-precision YuE2 weights available (BF16 LM, F32 VAE and SheetSage2).
# Idempotent. Weights live under $JJ_AUDIO_HOME, never in the repo. Needs passwordless sudo once
# (pacman). The runtime revision is the one already qualified for this model family.
set -euo pipefail

JJ_AUDIO_HOME="${JJ_AUDIO_HOME:-$HOME/Work/dev/jammers-audio}"
RUNTIME="$JJ_AUDIO_HOME/yue2.cpp"
RUNTIME_COMMIT="ea07706f4958a9594f4ef1dd185e5ce1b5ab1175"
WEIGHTS_REPO="Serveurperso/YuE2-GGUF"
WEIGHTS_REVISION="64b030e3deb6e8150d2b7c0db641ef5a17eca8a3"
export HF_HOME="${HF_HOME:-$JJ_AUDIO_HOME/hf-cache}"

if ! command -v nvcc >/dev/null 2>&1 && [[ ! -x /opt/cuda/bin/nvcc ]]; then
  sudo -n pacman -S --needed --noconfirm cuda
fi
export PATH="/opt/cuda/bin:$PATH"
nvcc --version | tail -1

if [[ ! -d "$RUNTIME/.git" ]]; then
  git clone --recurse-submodules https://github.com/ServeurpersoCom/yue2.cpp.git "$RUNTIME"
fi
if [[ "$(git -C "$RUNTIME" rev-parse HEAD)" != "$RUNTIME_COMMIT" ]]; then
  git -C "$RUNTIME" fetch --depth 1 origin "$RUNTIME_COMMIT"
  git -C "$RUNTIME" checkout --detach "$RUNTIME_COMMIT"
fi
git -C "$RUNTIME" submodule update --init --recursive --depth 1

(cd "$RUNTIME" && cmake -S . -B build-cuda -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=75 \
   -DCMAKE_BUILD_TYPE=Release && cmake --build build-cuda --config Release -j "$(nproc)")
ls -la "$RUNTIME/build-cuda/bin" 2>/dev/null || find "$RUNTIME/build-cuda" -maxdepth 2 -type f -name 'yue-*' -perm -u+x

"$JJ_AUDIO_HOME/.venv/bin/python" - "$WEIGHTS_REPO" "$WEIGHTS_REVISION" "$RUNTIME/models" <<'PY'
import sys
from huggingface_hub import hf_hub_download
repo, rev, dest = sys.argv[1:4]
for name in ("YuE2-3B-BF16.gguf", "YuE2-Vae-F32.gguf", "SheetSage2-F32.gguf", "LICENSE", "README.md"):
    print("ready", hf_hub_download(repo, name, revision=rev, local_dir=dest))
PY
echo "music toolchain ready in $RUNTIME"
