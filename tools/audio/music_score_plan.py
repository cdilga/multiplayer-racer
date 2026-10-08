#!/usr/bin/env python3
"""Compose Playtest-1 music scores with YuE2's plan stage only (P1-A02v). Runs on eris.

`yue-plan` runs the first autoregressive stage of YuE2-3B and writes an ABC score: symbolic notes and
chord symbols, no acoustic tokens, no audio. Lyrics are empty and cot is "full" (YuE2 composes the
whole arrangement). The score is then rendered with instrument SoundFonts by render_score.py; nothing
YuE2 sings can reach a track because YuE2 never produces audio in this path.

Usage (on eris, from $JJ_AUDIO_HOME):
  flock .gpu.lock .venv/bin/python bin/music_score_plan.py --cues bin/music-cues-scoreonly.json \
      --out drafts/music/scoreonly [--seeds 11 23 37 ...] [--only race]
Each take lands in <out>/<cue>/s<seed>/ with request.json, score.abc and plan.log. Finished takes are kept.
"""
import argparse
import json
import pathlib
import subprocess
import time

HOME = pathlib.Path.home() / "Work/dev/jammers-audio"
RT = HOME / "yue2.cpp"
MODEL = RT / "models/YuE2-3B-BF16.gguf"
PLAN = RT / "build-cuda/yue-plan"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cues", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seeds", type=int, nargs="+")
    ap.add_argument("--only", nargs="+")
    ap.add_argument("--max-seq", type=int, default=6144)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    for cue in json.loads(pathlib.Path(a.cues).read_text()):
        if a.only and cue["id"] not in a.only:
            continue
        for seed in a.seeds or cue["seeds"]:
            d = out / cue["id"] / f"s{seed}"
            d.mkdir(parents=True, exist_ok=True)
            if (d / "score.abc").is_file() and (d / "score.abc").stat().st_size > 0:
                continue
            req = {"style": cue["style"], "lyrics": "", "abc": "", "cot": "full",
                   "duration": cue["duration"], "lm_seed": seed}
            (d / "request.json").write_text(json.dumps(req, indent=2) + "\n")
            cmd = [str(PLAN), "--model", str(MODEL), "--request", str(d / "request.json"),
                   "--out", str(d / "score.abc"), "--lm-seed", str(seed), "--max-seq", str(a.max_seq)]
            t0 = time.time()
            with open(d / "plan.log", "w") as log:
                log.write("$ " + " ".join(cmd) + "\n")
                log.flush()
                rc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT).returncode
            print(f"{cue['id']:8s} seed {seed:4d} rc {rc} {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
