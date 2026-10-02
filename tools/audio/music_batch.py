#!/usr/bin/env python3
"""Generate Playtest-1 music candidates with YuE2 (BF16) on eris and screen them for vocals.

Two candidate kinds per cue, all instrumental (empty lyrics):
  * cover: the 0.1 track's score, transcribed by SheetSage2 (F32), re-performed with its style tags
    (keeps the original vibe, R13);
  * fresh: YuE2 composes from the style tags, with an optional outback-festival twist.
Every take is screened with Whisper large-v3 for words; anything with likely speech/vocals is
marked rejected. The owner still listens before anything is approved (P1-A02).

Usage (on eris, from $JJ_AUDIO_HOME):
  .venv/bin/python bin/music_batch.py --cues bin/music-cues.json --refs refs/ --out drafts/music/batch1
"""
import argparse
import json
import pathlib
import subprocess
import time

HOME = pathlib.Path.home() / "Work/dev/jammers-audio"
RT = HOME / "yue2.cpp"
MODEL = RT / "models/YuE2-3B-BF16.gguf"
VAE = RT / "models/YuE2-Vae-F32.gguf"
SHEETSAGE = RT / "models/SheetSage2-F32.gguf"
BIN = RT / "build-cuda"


def run(cmd, log):
    t0 = time.time()
    with open(log, "a") as f:
        f.write("$ " + " ".join(map(str, cmd)) + "\n")
        f.flush()
        rc = subprocess.run(list(map(str, cmd)), stdout=f, stderr=subprocess.STDOUT).returncode
    return rc, round(time.time() - t0, 1)



def load_16k(path):
    """Decode audio for Whisper without PyAV (faster-whisper's av.open breaks on PyAV 15+)."""
    import soundfile as _sf
    import torch as _torch
    import torchaudio.functional as _F

    audio, sr = _sf.read(str(path), dtype="float32", always_2d=True)
    mono = _torch.from_numpy(audio.mean(axis=1))
    if sr != 16000:
        mono = _F.resample(mono, sr, 16000)
    return mono.numpy()

def screen(asr, path):
    segs, info = asr.transcribe(load_16k(path), language="en", vad_filter=True, beam_size=5)
    words, speechy = [], 0.0
    for s in segs:
        if s.no_speech_prob < 0.5 and s.avg_logprob > -1.0 and len(s.text.split()) >= 2:
            words.append(s.text.strip())
            speechy += s.end - s.start
    return {"suspect_words": words, "suspect_seconds": round(speechy, 1), "rejected": bool(words)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cues", required=True)
    ap.add_argument("--refs", required=True, help="dir with the 0.1 reference tracks")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seeds", type=int, nargs="+", default=[11, 23])
    ap.add_argument("--steps", type=int, default=32)
    ap.add_argument("--max-seq", type=int, default=8192)
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    log = out / "run.log"
    cues = json.loads(pathlib.Path(args.cues).read_text())
    manifest = {"model": str(MODEL.name), "vae": str(VAE.name), "steps": args.steps, "cues": []}

    from faster_whisper import WhisperModel

    for cue in cues:
        cdir = out / cue["id"]
        cdir.mkdir(exist_ok=True)
        entry = {"id": cue["id"], "takes": []}
        score = ""
        ref = pathlib.Path(args.refs) / cue["ref"]
        if ref.exists() and not (cdir / "ref-score.abc").exists():
            rc, secs = run([BIN / "yue-transcribe", "--model", SHEETSAGE, "--audio", ref, "--out", cdir / "ref-score.abc"], log)
            entry["transcribe"] = {"rc": rc, "seconds": secs}
        if (cdir / "ref-score.abc").exists():
            score = (cdir / "ref-score.abc").read_text()
        kinds = []
        if score:
            kinds.append(("cover", {"style": cue["style"], "abc": score}))
        kinds.append(("fresh", {"style": cue.get("fresh_style", cue["style"]), "abc": ""}))
        for kind, extra in kinds:
            for seed in args.seeds:
                req = {"style": extra["style"], "lyrics": "", "abc": extra["abc"], "cot": "full",
                       "duration": cue["duration"], "lm_seed": seed, "seed": seed, "steps": args.steps,
                       "output_format": "wav24"}
                rpath = cdir / f"{kind}.s{seed}.request.json"
                rpath.write_text(json.dumps(req, indent=2))
                wav = cdir / f"{kind}.s{seed}.wav"
                if wav.exists() and wav.stat().st_size > 0:  # resume: keep finished takes
                    entry["takes"].append({"kind": kind, "seed": seed, "rc": 0, "seconds": 0, "file": str(wav)})
                    continue
                rc, secs = run([BIN / "yue-synth", "--model", MODEL, "--vae", VAE, "--request", rpath,
                                "--out", wav, "--max-seq", args.max_seq, "--score", cdir / f"{kind}.s{seed}.abc",
                                "--tokens", cdir / f"{kind}.s{seed}.tokens.csv"], log)
                entry["takes"].append({"kind": kind, "seed": seed, "rc": rc, "seconds": secs, "file": str(wav)})
                print(f"{cue['id']:10s} {kind:5s} seed {seed} rc {rc} {secs}s", flush=True)

        asr = WhisperModel("large-v3", device="cuda", compute_type="float16")
        for take in entry["takes"]:
            if take["rc"] == 0 and pathlib.Path(take["file"]).exists():
                take["screen"] = screen(asr, take["file"])
        del asr
        manifest["cues"].append(entry)
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("done", out)


if __name__ == "__main__":
    main()
