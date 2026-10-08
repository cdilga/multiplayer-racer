#!/usr/bin/env bash
# Run the score-only plan batch on eris (P1-A02v): music_score_plan.py under the shared GPU lock. The BF16 model
# (4.1 GB) plus its KV cache doesn't fit next to the desktop's voxtype dictation daemon (1.5 GB VRAM), so the
# daemon is stopped for the batch and always restarted. Plans take ~15-45 s each.
#   ssh eris 'nohup setsid ~/Work/dev/jammers-audio/bin/eris-music-plan.sh [--only race --seeds 11 23] \
#       > ~/Work/dev/jammers-audio/logs/scoreonly-plan.log 2>&1 < /dev/null &'
cd "${JJ_AUDIO_HOME:-$HOME/Work/dev/jammers-audio}"
trap 'systemctl --user start voxtype.service' EXIT
systemctl --user stop voxtype.service 2>/dev/null
sleep 2
flock .gpu.lock .venv/bin/python bin/music_score_plan.py --cues bin/music-cues-scoreonly.json --out drafts/music/scoreonly "$@"
echo PLAN-DONE
