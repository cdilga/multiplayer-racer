#!/usr/bin/env python3
"""Export owner-approved YuE2 music drafts as game assets (P1-A02). Runs on eris.

For each selected take: two-pass loudness normalisation (-18 LUFS integrated, -1.5 dBTP), a loop
seam made by crossfading the last LOOP_SECONDS into the opening (so playback that wraps from the end
lands on matching material), Ogg/Opus 128 kb/s stereo, plus a provenance manifest. Loop quality is
still an ear check: the crossfade hides a seam, it doesn't find a musical loop point.

Usage: export_music.py --batch drafts/music/batch1 --out exports/music
"""
import argparse
import json
import pathlib
import subprocess

LOOP_SECONDS = 3.0
LUFS, TRUE_PEAK, LRA = -18.0, -1.5, 11.0

# Owner verdict 2026-10-02: likes most; lobby-cover-s11 rejected; lobby-fresh-s23 "best lobby track by far";
# remaining picks delegated to the agent. Two takes were auto-rejected for audible words.
SELECTION = [
    ("lobby", "lobby", "fresh", 23),
    ("race-1", "race", "fresh", 11),
    ("race-2", "race", "fresh", 23),
    ("race-3", "race", "cover", 11),
    ("race-4", "race", "cover", 23),
    ("results-1", "results", "fresh", 11),
    ("results-2", "results", "cover", 11),
    ("results-3", "results", "cover", 23),
]


def run(args, capture=False):
    return subprocess.run(args, check=True, capture_output=capture, text=True)


def measure(path):
    out = run(["ffmpeg", "-nostdin", "-hide_banner", "-i", str(path), "-af",
               f"loudnorm=I={LUFS}:TP={TRUE_PEAK}:LRA={LRA}:print_format=json", "-f", "null", "-"], capture=True)
    text = out.stderr
    return json.loads(text[text.rindex("{"):text.rindex("}") + 1])


def duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture=True)
    return float(out.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    batch, out = pathlib.Path(a.batch), pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    screened = json.loads((batch / "manifest.json").read_text())
    screens = {(c["id"], t["kind"], t["seed"]): t.get("screen", {}) for c in screened["cues"] for t in c["takes"]}
    runtime = run(["git", "-C", str(pathlib.Path.home() / "Work/dev/jammers-audio/yue2.cpp"), "rev-parse", "HEAD"],
                  capture=True).stdout.strip()
    manifest = {"generator": {"model": "YuE2-3B BF16 GGUF + YuE2-Vae F32 (Serveurperso/YuE2-GGUF @ 64b030e3)",
                              "runtime": f"yue2.cpp @ {runtime}", "gpu": "RTX 2080 SUPER (eris)"},
                "licence": "YuE2 weights: CC BY-NC 4.0 with an additional permission for individual creators to "
                           "monetise outputs. Check before any company/commercial release.",
                "processing": {"loudness_lufs": LUFS, "true_peak_dbtp": TRUE_PEAK, "loop_crossfade_s": LOOP_SECONDS,
                               "codec": "Opus 128 kb/s stereo in Ogg"},
                "approval": "owner 2026-10-02 (lobby-fresh-s23 explicitly; others delegated)",
                "tracks": []}
    for name, cue, kind, seed in SELECTION:
        src = batch / cue / f"{kind}.s{seed}.wav"
        req = json.loads((batch / cue / f"{kind}.s{seed}.request.json").read_text())
        m = measure(src)
        dur = duration(src)
        norm = (f"loudnorm=I={LUFS}:TP={TRUE_PEAK}:LRA={LRA}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
        graph = (f"[0:a]{norm},aresample=48000,asplit=2[a][b];"
                 f"[a]atrim=start={LOOP_SECONDS},asetpts=PTS-STARTPTS[body];"
                 f"[b]atrim=end={LOOP_SECONDS},asetpts=PTS-STARTPTS[head];"
                 f"[body][head]acrossfade=d={LOOP_SECONDS}:c1=tri:c2=tri[out]")
        dst = out / f"{name}.ogg"
        run(["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-filter_complex", graph,
             "-map", "[out]", "-c:a", "libopus", "-b:a", "128k", "-ar", "48000", str(dst)])
        manifest["tracks"].append({
            "file": dst.name, "cue": cue, "source_take": f"{cue}/{kind}.s{seed}", "kind": kind,
            "style": req["style"], "lm_seed": req["lm_seed"], "seed": req["seed"], "steps": req["steps"],
            "score_source": "0.1 track transcribed by SheetSage2 F32" if kind == "cover" else "composed by YuE2 (cot full)",
            "words_screen": "clean" if not screens.get((cue, kind, seed), {}).get("rejected") else "REJECTED",
            "source_seconds": round(dur, 1), "loop_seconds": round(dur - LOOP_SECONDS, 1),
            "measured_input_lufs": float(m["input_i"])})
        print("exported", dst.name)
    (out / "music-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("manifest written")


if __name__ == "__main__":
    main()
