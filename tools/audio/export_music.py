#!/usr/bin/env python3
"""Export the score-only music picks as game assets (P1-A02v). Runs on eris.

Each pick is a YuE2 plan-stage score (music_score_plan.py) rendered with instrument SoundFont patches
(render_score.py). Its loop source is pass 2 of a three-pass render plus LOOP_SECONDS of pass 3, so the
crossfade below blends the end of the composition (with its real reverb tail) into the matching head.

Per pick: two-pass loudness normalisation to -18 LUFS / -1.5 dBTP (linear gain), the 3 s loop crossfade,
Ogg/Opus 128 kb/s stereo; then the decoded file is re-measured (integrated loudness, true peak, mono
fold-down, L/R correlation, seam continuity) and its score, MIDI and provenance land in the manifest.

Usage: export_music.py --drafts drafts/music/scoreonly --out exports/music-scoreonly
       music_voice_check.py ... (see tools/audio/README.md), then
       export_music.py --drafts drafts/music/scoreonly --out exports/music-scoreonly --finalise voice.json premaster.json
"""
import argparse
import hashlib
import json
import pathlib

import shutil
import subprocess

import numpy as np

LOOP_SECONDS = 3.0
LUFS, TRUE_PEAK, LRA = -18.0, -1.5, 20.0
# Opus overshoots the PCM true peak by up to ~0.5 dB, so the PCM is normalised with 1 dB of extra headroom and the
# decoded file is what is checked against TRUE_PEAK.
PRE_ENCODE_TP = -2.5
HOME = pathlib.Path.home() / "Work/dev/jammers-audio"
MODEL = "YuE2-3B BF16 GGUF (Serveurperso/YuE2-GGUF @ 64b030e3deb6e8150d2b7c0db641ef5a17eca8a3)"

# Picks by the listening proxies in docs/evidence/P1-A02v/selection.md (form with a chorus and an ending, a
# repeated motif, few empty bars). (asset name, cue, plan seed).
SELECTION = [
    ("lobby", "lobby", 23),
    ("race-1", "race", 53),
    ("race-2", "race", 67),
    ("race-3", "race", 37),
    ("race-4", "race", 41),
    ("results-1", "results", 37),
    ("results-2", "results", 41),
    ("results-3", "results", 23),
]


def run(args, capture=False):
    return subprocess.run(args, check=True, capture_output=capture, text=True)


def loudnorm_json(path, extra="", tp=TRUE_PEAK):
    err = run(["ffmpeg", "-nostdin", "-hide_banner", "-i", str(path), "-af",
               f"{extra}loudnorm=I={LUFS}:TP={tp}:LRA={LRA}:print_format=json", "-f", "null", "-"], capture=True).stderr
    return json.loads(err[err.rindex("{"):err.rindex("}") + 1])


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "2",
         "-ar", "48000", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--drafts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--finalise", nargs=2, metavar=("VOICE_CHECK_JSON", "PREMASTER_VOICE_CHECK_JSON"),
                    help="only write music-manifest.json from tracks.json and the two no-voice reports")
    a = ap.parse_args()
    if a.finalise:
        return finalise(pathlib.Path(a.out), *a.finalise)
    drafts, out = pathlib.Path(a.drafts), pathlib.Path(a.out)
    (out / "scores").mkdir(parents=True, exist_ok=True)
    runtime = run(["git", "-C", str(HOME / "yue2.cpp"), "rev-parse", "HEAD"], capture=True).stdout.strip()
    tracks = []
    for name, cue, seed in SELECTION:
        take = drafts / cue / f"s{seed}"
        req = json.loads((take / "request.json").read_text())
        render = json.loads((take / "render" / "render.json").read_text())
        src = take / "render" / "loop-source.wav"
        m = loudnorm_json(src, tp=PRE_ENCODE_TP)
        norm = (f"loudnorm=I={LUFS}:TP={PRE_ENCODE_TP}:LRA={LRA}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
        graph = (f"[0:a]{norm},aresample=48000,asplit=2[a][b];"
                 f"[a]atrim=start={LOOP_SECONDS},asetpts=PTS-STARTPTS[body];"
                 f"[b]atrim=end={LOOP_SECONDS},asetpts=PTS-STARTPTS[head];"
                 f"[body][head]acrossfade=d={LOOP_SECONDS}:c1=tri:c2=tri[out]")
        dst = out / f"{name}.ogg"
        export_cmd = ["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-filter_complex",
                      graph, "-map", "[out]", "-c:a", "libopus", "-b:a", "128k", "-ar", "48000", str(dst)]
        run(export_cmd)
        # Re-measure what ships.
        after = loudnorm_json(dst)
        mono = loudnorm_json(dst, "pan=mono|c0=0.5*c0+0.5*c1,")
        x = decode(dst)
        corr = float(np.corrcoef(x[:, 0], x[:, 1])[0, 1])
        # Seam: the loop source's tail (pass 3's head, LOOP_SECONDS) against its own head (pass 2's head): the same
        # notes, so a high correlation means the crossfade blends matching material.
        s = decode(src).mean(1)
        n = int(LOOP_SECONDS * 48000)
        seam_corr = float(np.corrcoef(s[-n:], s[:n])[0, 1])
        env = lambda y: np.sqrt(np.mean(np.square(y[: len(y) // 480 * 480].reshape(-1, 480)), axis=1))  # 10 ms RMS
        seam_env = float(np.corrcoef(env(s[-n:]), env(s[:n]))[0, 1])
        wrap_jump = float(abs(x[-1].mean() - x[0].mean()))
        rms = float(np.sqrt(np.mean(np.square(x))))
        shutil.copy(take / "score.abc", out / "scores" / f"{name}.abc")
        shutil.copy(take / "render" / "arrangement.mid", out / "scores" / f"{name}.mid")
        tracks.append({
            "file": dst.name, "sha256": sha(dst), "cue": cue,
            "method": "score-only",
            "source": {"tool": "yue-plan", "stage": "plan", "output": "ABC score (symbolic); YuE2 generated no audio",
                       "model": MODEL, "runtime": f"yue2.cpp @ {runtime}", "plan_seed": seed,
                       "request": req, "plan_command": (take / "plan.log").read_text().splitlines()[0][2:]},
            "score": {"file": f"scores/{name}.abc", "sha256": sha(take / "score.abc"), "key": render["key"],
                      "score_bpm": render["score_bpm"], "bars": render["bars"], "sections": render["sections"]},
            "render": {"renderer": render["renderer"]["fluidsynth"], "midi": f"scores/{name}.mid",
                       "midi_sha256": render["renderer"]["inputs"]["midi_sha256"], "bpm": render["bpm"],
                       "inputs": ["score (ABC) -> arrangement MIDI", "SoundFont FluidR3_GM.sf2"],
                       "soundfont": render["renderer"]["soundfont"],
                       "soundfont_sha256": render["renderer"]["soundfont_sha256"],
                       "patches": render["patches"], "staves": render["staves"],
                       "humanise_seed": render["humanise_seed"],
                       "command": "render_score.py --cue {} --score score.abc --bpm {} --seed {} ; {}".format(
                           cue, render["bpm"], render["humanise_seed"],
                           " ".join(pathlib.Path(c).name if "/" in c else c for c in render["renderer"]["command"])),
                       "export_command": "export_music.py (two-pass loudnorm (dynamic mode, see level.normalisation), 3 s acrossfade tri, libopus 128k)"},
            "loop": {"seconds": round(len(x) / 48000, 3), "composition_seconds": render["composition_seconds"],
                     "crossfade_s": LOOP_SECONDS, "seam_tail_head_correlation": round(seam_corr, 4),
                     "seam_tail_head_envelope_correlation": round(seam_env, 4),
                     "wrap_jump": round(wrap_jump, 5), "rms": round(rms, 4)},
            "level": {"integrated_lufs": float(after["input_i"]), "true_peak_dbtp": float(after["input_tp"]),
                      "mono_fold_lufs": float(mono["input_i"]), "lr_correlation": round(corr, 4),
                      "source_lufs": float(m["input_i"]), "source_true_peak_dbtp": float(m["input_tp"]),
                      "source_lra": float(m["input_lra"]),
                      "normalisation": "ffmpeg loudnorm two-pass; the gain to -18 LUFS exceeds the peak headroom, so "
                                       "loudnorm runs its dynamic mode (true-peak limiting; target LRA 20 is above the "
                                       "source LRA, so no range compression)"},
        })
        print(f"{name:10s} {cue:8s} s{seed:<3d} {len(x)/48000:6.1f}s  I {after['input_i']} TP {after['input_tp']} "
              f"mono {mono['input_i']} corr {corr:.3f} seam {seam_corr:.3f}/env {seam_env:.3f}", flush=True)
        if abs(float(after["input_i"]) - LUFS) > 0.5 or float(after["input_tp"]) > TRUE_PEAK:
            raise SystemExit(f"{name}: level out of spec after encoding")
    (out / "tracks.json").write_text(json.dumps(tracks, indent=2) + "\n")


def finalise(out, check, premaster):
    """Write music-manifest.json: the tracks plus the no-voice check (calibration and every final file)."""
    tracks = json.loads((out / "tracks.json").read_text())
    vc = json.loads(pathlib.Path(check).read_text())
    pre = json.loads(pathlib.Path(premaster).read_text())
    by_name = lambda rep: {pathlib.Path(r["file"]).name if "shipped" not in r["file"] else "shipped/" +
                           pathlib.Path(r["file"]).name: r for r in rep["results"]}
    rs, prs = by_name(vc), {r["file"].split("/scoreonly/")[1].split("/render")[0]: r for r in pre["results"]}
    keep = ("sha256", "max_voice", "max_class", "max_at_s", "max_stem_rel_db", "windows_over", "stem_windows_over",
            "windows", "flagged")
    summary = lambda r: {k: r[k] for k in keep}
    for t in tracks:
        t["voice_check"] = summary(rs[t["file"]])
        t["voice_check"]["premaster_wav"] = summary(prs[f"{t['cue']}/s{t['source']['plan_seed']}"])
        if t["voice_check"]["sha256"] != t["sha256"]:
            raise SystemExit(f"{t['file']}: the no-voice report is for a different file; rerun the check")
        if t["voice_check"]["flagged"] or t["voice_check"]["premaster_wav"]["flagged"]:
            raise SystemExit(f"{t['file']}: the no-voice check flags it")
    shipped = {k.split("/", 1)[1]: summary(v) for k, v in rs.items() if k.startswith("shipped/")}
    if not shipped["lobby.ogg"]["flagged"]:
        raise SystemExit("the detector does not flag the positive control (4a0f761 lobby.ogg): it does not work")
    manifest = {
        "method": "score-only",
        "generator": {"composition": MODEL + ", plan stage only (yue-plan), cot full, empty lyrics",
                      "runtime": tracks[0]["source"]["runtime"], "gpu": "RTX 2080 SUPER (eris)",
                      "renderer": tracks[0]["render"]["renderer"],
                      "soundfont": tracks[0]["render"]["soundfont"],
                      "soundfont_sha256": tracks[0]["render"]["soundfont_sha256"]},
        "licence": "Scores: YuE2 weights are CC BY-NC 4.0 with an additional permission for individual creators to "
                   "monetise outputs; check before any company/commercial release. SoundFont FluidR3_GM: MIT (Frank Wen).",
        "processing": {"loudness_lufs": LUFS, "true_peak_dbtp": TRUE_PEAK, "loop_crossfade_s": LOOP_SECONDS,
                       "codec": "Opus 128 kb/s stereo in Ogg"},
        "no_voice_proof": {
            "primary": "Pipeline: YuE2 ran only its plan stage, which writes an ABC score and no audio; render_score.py "
                       "turns the score into General MIDI (every staff, including the one YuE2 labels Vocal, on an "
                       "instrument patch from an allow-list without GM voice/choir programs) and FluidSynth renders "
                       "that MIDI with FluidR3_GM.sf2. Those two files are the renderer's only inputs.",
            "supplementary": {"method": vc["method"], "threshold": vc["threshold"], "stem_db": vc["stem_db"],
                              "stem_windows": vc["stem_windows"], "window_s": vc["window_s"], "hop_s": vc["hop_s"],
                              "rule": "flag if any window's voice score >= threshold, or the vocals stem is within "
                                      "stem_db of the mix in >= stem_windows windows",
                              "positive_control": {"file": "docs/evidence/P1-A02v/positive-control-lobby-4a0f761.ogg",
                                                   "origin": "assets/audio/music/lobby.ogg @ 4a0f761 (YuE2 acoustic "
                                                             "render; the owner hears vocals in it)",
                                                   **shipped["lobby.ogg"]},
                              "shipped_4a0f761": shipped}},
        "approval": "Agent-verified (owner 2026-10-08: no owner listening gate; a track ships when the pipeline proof "
                    "and the calibrated no-voice check both hold).",
        "tracks": tracks,
    }
    (out / "music-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("manifest written")


if __name__ == "__main__":
    main()
