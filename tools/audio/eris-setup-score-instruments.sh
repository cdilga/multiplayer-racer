#!/usr/bin/env bash
# Set up the score-only music renderer on eris (P1-A02v), no sudo needed: FluidSynth from conda-forge in a
# micromamba prefix, the FluidR3_GM SoundFont (MIT, Frank Wen) from Debian's fluid-soundfont-gm package pinned by
# hash, and the no-voice detector's Python deps (Demucs 4.0.1 without its deps, which the voice venv already has).
# Idempotent. Everything lives under $JJ_AUDIO_HOME/tools/score-instruments, never in the repo.
set -euo pipefail

JJ_AUDIO_HOME="${JJ_AUDIO_HOME:-$HOME/Work/dev/jammers-audio}"
DIR="$JJ_AUDIO_HOME/tools/score-instruments"
DEB_URL="http://deb.debian.org/debian/pool/main/f/fluid-soundfont/fluid-soundfont-gm_3.1-5.3_all.deb"
DEB_SHA="6f531493ac4e4d9772fd96b2488ea1790af81c196135fbdd25997da0781fc60e"
SF_SHA="74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0"
mkdir -p "$DIR/sf" "$DIR/dl"
cd "$DIR"

if [[ ! -x bin/micromamba ]]; then
  curl -fsSL https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj bin/micromamba
fi
if [[ ! -x env/bin/fluidsynth ]]; then
  MAMBA_ROOT_PREFIX="$DIR/mamba" bin/micromamba create -y -p "$DIR/env" -c conda-forge "fluidsynth=2.6.1"
fi
env/bin/fluidsynth --version | head -1

if [[ ! -f sf/FluidR3_GM.sf2 ]]; then
  curl -fsSL -o dl/fluid.deb "$DEB_URL"
  echo "$DEB_SHA  dl/fluid.deb" | sha256sum -c -
  (cd dl && bsdtar -xf fluid.deb && bsdtar -xf data.tar.*)
  mv dl/usr/share/sounds/sf2/FluidR3_GM.sf2 sf/
  cp dl/usr/share/doc/fluid-soundfont-gm/copyright sf/FluidR3_GM.copyright
fi
echo "$SF_SHA  sf/FluidR3_GM.sf2" | sha256sum -c -

# The no-voice detector (music_voice_check.py): Demucs + AudioSet AST in the existing voice venv.
UV="$(ls "$HOME"/.local/share/mise/installs/uv/latest/*/uv 2>/dev/null || command -v uv)"  # the mise shim needs a global uv
"$UV" pip install --python "$JJ_AUDIO_HOME/.venv/bin/python" --no-deps demucs==4.0.1 julius einops openunmix lameenc \
  dora-search omegaconf "antlr4-python3-runtime==4.9.3" retrying treetable submitit cloudpickle
"$JJ_AUDIO_HOME/.venv/bin/python" -c "import demucs.pretrained, transformers; print('detector deps ok')"
echo "score instruments ready in $DIR"
