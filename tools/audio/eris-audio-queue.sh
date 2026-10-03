#!/bin/sh
# Runs on eris: voice renders (refs A and B), then the music batch, strictly one GPU job at a time.
cd "$HOME/Work/dev/jammers-audio" || exit 1
# One GPU job at a time: render_voice.py's worker takes the same lock, so a queue and a voice render never overlap.
exec 9>.gpu.lock
flock 9
export HF_HOME="$PWD/hf-cache" PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
PY=.venv/bin/python
for R in A B; do
  echo "== voice $R $(date)"
  $PY bin/voice_clone.py --ref-wav private/voice/ref-$R.wav --ref-text-file private/voice/ref-$R.txt \
    --cues bin/cues-playtest1-audition.tsv --out private/voice/renders/$R --candidates 4 || echo "voice $R failed"
done
echo "== music $(date)"
$PY bin/music_batch.py --cues bin/music-cues-playtest1.json --refs refs --out drafts/music/batch1 || echo "music failed"
echo "== queue done $(date)"
