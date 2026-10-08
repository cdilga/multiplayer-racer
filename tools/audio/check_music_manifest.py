#!/usr/bin/env python3
"""Validate assets/audio/music/music-manifest.json (P1-A02v). Runs in CI's checks lane, stdlib only.

Music has no voices at all (owner, 2026-10-08), so every track must come from the score-only path: YuE2's plan
stage writes an ABC score, render_score.py renders it as MIDI through instrument SoundFont patches. Refused:
  - a track whose method isn't score-only, or whose provenance names an acoustic render (yue-synth, the
    acoustic/NAR/VAE stage, a cover or fresh acoustic take, Demucs or other separation, vocal-rest edits);
  - renderer inputs other than the MIDI arrangement and the SoundFont, or a GM voice/choir patch;
  - a missing or changed score/MIDI file, an Ogg on disk with no track (or a track with no Ogg);
  - level, loop or mono figures out of spec;
  - a no-voice check that flags a track, is for a different file, or no longer flags the positive control
    (the 4a0f761 lobby.ogg, committed as docs/evidence/P1-A02v/positive-control-lobby-4a0f761.ogg).
The detector itself (Demucs + AudioSet AST) runs on eris (tools/audio/music_voice_check.py); CI checks its
recorded verdicts against the files' hashes.

Usage: check_music_manifest.py [MANIFEST]   (default assets/audio/music/music-manifest.json)
"""
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT = ROOT / "assets/audio/music/music-manifest.json"
ACOUSTIC = re.compile(r"yue-synth|acoustic|\bnar\b|\bvae\b|demucs|separat|vocal[\w -]{0,30}rests?|\bstems?\b|source_take|"
                      r"words_screen|\bcover\b|sheetsage|yue-transcribe", re.I)
VOICE_PROGRAMS = {52, 53, 54, 85, 91}
CUES = {"lobby": 1, "race": 4, "results": 3}


def file_sha(path):
    """sha256 of a file, or the oid of its Git LFS pointer when the object isn't checked out (CI's checks lane)."""
    data = path.read_bytes()
    if data.startswith(b"version https://git-lfs.github.com/spec/v1"):
        m = re.search(rb"oid sha256:([0-9a-f]{64})", data)
        return m.group(1).decode() if m else None
    return hashlib.sha256(data).hexdigest()


def check(manifest_path, data=None):
    """Return a list of problems; `data` replaces the manifest's JSON (tests), files still resolve beside it."""
    errs = []
    mp = pathlib.Path(manifest_path)
    base = mp.parent
    m = data if data is not None else json.loads(mp.read_text())
    if m.get("method") != "score-only":
        errs.append("manifest: method must be score-only")
    proof = m.get("no_voice_proof", {})
    sup = proof.get("supplementary", {})
    pc = sup.get("positive_control", {})
    if not proof.get("primary"):
        errs.append("manifest: no_voice_proof.primary (the pipeline proof) is missing")
    if not pc.get("flagged"):
        errs.append("no-voice check: the positive control is not flagged, so the detector proves nothing")
    pc_file = ROOT / pc.get("file", "missing")
    if not pc_file.is_file() or file_sha(pc_file) != pc.get("sha256"):
        errs.append(f"no-voice check: positive control {pc.get('file')} is missing or changed")
    counts = {}
    names = set()
    for t in m.get("tracks", []):
        name = t.get("file", "?")
        names.add(name)
        where = f"{name}:"
        counts[t.get("cue")] = counts.get(t.get("cue"), 0) + 1
        if t.get("method") != "score-only":
            errs.append(f"{where} method is {t.get('method')!r}, not score-only")
        src, ren = t.get("source", {}), t.get("render", {})
        if src.get("tool") != "yue-plan" or src.get("stage") != "plan":
            errs.append(f"{where} source must be the YuE2 plan stage (tool yue-plan)")
        hit = ACOUSTIC.search(json.dumps({k: v for k, v in t.items() if k not in ("voice_check", "level", "loop")}))
        if hit:
            errs.append(f"{where} provenance names an acoustic render ({hit.group(0)!r})")
        req = src.get("request", {})
        if req.get("lyrics") != "" or req.get("cot") != "full":
            errs.append(f"{where} the plan request must have empty lyrics and cot full")
        if ren.get("inputs") != ["score (ABC) -> arrangement MIDI", "SoundFont FluidR3_GM.sf2"]:
            errs.append(f"{where} renderer inputs must be the MIDI arrangement and the SoundFont only")
        for part, patch in ren.get("patches", {}).items():
            if part != "drums" and patch.get("program") in VOICE_PROGRAMS:
                errs.append(f"{where} {part} uses voice/choir program {patch.get('program')}")
        sc = t.get("score", {})
        p = base / sc.get("file", "missing")
        if not p.is_file() or file_sha(p) != sc.get("sha256"):
            errs.append(f"{where} score {sc.get('file')} is missing or changed")
        mid = base / ren.get("midi", "missing")
        if not mid.is_file() or file_sha(mid) != ren.get("midi_sha256"):
            errs.append(f"{where} MIDI {ren.get('midi')} is missing or changed")
        ogg = base / name
        if not ogg.is_file() or file_sha(ogg) != t.get("sha256"):
            errs.append(f"{where} audio is missing or its sha256 differs from the manifest")
        vc = t.get("voice_check", {})
        if vc.get("sha256") != t.get("sha256"):
            errs.append(f"{where} the no-voice check was run on a different file")
        if vc.get("flagged") is not False or vc.get("premaster_wav", {}).get("flagged") is not False:
            errs.append(f"{where} the no-voice check flags it (or never ran)")
        lv, lp = t.get("level", {}), t.get("loop", {})
        if not (abs(lv.get("integrated_lufs", 0) + 18) <= 0.5 and lv.get("true_peak_dbtp", 0) <= -1.5):
            errs.append(f"{where} level {lv.get('integrated_lufs')} LUFS / {lv.get('true_peak_dbtp')} dBTP is out of spec")
        if not (lv.get("lr_correlation", -1) >= 0.3 and lv.get("integrated_lufs", 0) - lv.get("mono_fold_lufs", -99) <= 6):
            errs.append(f"{where} not mono-safe")
        if lp.get("crossfade_s") != 3.0 or lp.get("seam_tail_head_envelope_correlation", 0) < 0.95:
            errs.append(f"{where} loop seam out of spec")
    if counts != CUES:
        errs.append(f"manifest: cue counts {counts} != {CUES}")
    on_disk = {p.name for p in base.glob("*.ogg")}
    if on_disk != names:
        errs.append(f"manifest: Ogg files {sorted(on_disk ^ names)} are on disk without a track or vice versa")
    return errs


def main():
    errs = check(sys.argv[1] if len(sys.argv) > 1 else DEFAULT)
    for e in errs:
        print("music manifest:", e)
    if not errs:
        print("music manifest: ok (score-only, no acoustic provenance, no-voice check calibrated)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
