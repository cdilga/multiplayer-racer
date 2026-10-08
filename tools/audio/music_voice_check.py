#!/usr/bin/env python3
"""Supplementary no-voice check for music (P1-A02v). Runs on eris.

Two stages per file:
  1. Demucs (htdemucs) splits the mix and keeps its "vocals" stem: anything voice-like in the music ends
     up there, along with whatever lead instrument Demucs confuses for a voice.
  2. An AudioSet classifier (Audio Spectrogram Transformer, MIT/ast-finetuned-audioset-10-10-0.4593) scores
     overlapping windows of that stem; a window's voice score is the highest probability among the AudioSet
     human-voice classes (singing of every kind, choir, humming, chant, speech, ...). Windows where the stem
     is near silent (more than STEM_GATE_DB below the mix) score 0.

A file is flagged when any window's voice score reaches --threshold, or when the vocals stem carries real
level (at least --stem-db relative to the mix) in --stem-windows or more windows: Demucs puts sung parts
there at -4..-8 dB in the shipped YuE2 tracks, while instrumental renders leave it near -15 dB or below. The threshold is calibrated on known
positives (the YuE2 acoustic tracks shipped in 4a0f761; the owner hears vocals in lobby.ogg) and must flag
them while passing the instrumental renders. Demucs is a detector here only: its stems never become music.
The primary no-voice proof is the pipeline (render_score.py renders MIDI through instrument SoundFonts only).

Usage: music_voice_check.py --threshold 0.25 [--stem-db -10 --stem-windows 2] --out scores.json FILE...
"""
import argparse
import json
import pathlib
import sys

import numpy as np

AST_ID = "MIT/ast-finetuned-audioset-10-10-0.4593"
DEMUCS_MODEL = "htdemucs"
VOICE_WORDS = ("singing", "choir", "humming", "yodel", "chant", "mantra", "a capella", "vocal music", "rapping",
               "speech", "speaking", "conversation", "narration", "babbling", "whispering", "shout", "yell",
               "screaming", "beatboxing", "lullaby")
NOT_VOICE = {"Singing bowl"}  # an instrument that shares the word
WINDOW_S, HOP_S, STEM_GATE_DB = 5.0, 2.5, -30.0


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(np.square(x))) + 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--threshold", type=float, required=True)
    ap.add_argument("--stem-db", type=float, default=-10.0)
    ap.add_argument("--stem-windows", type=int, default=2)
    ap.add_argument("--out")
    ap.add_argument("--device", default="cpu")
    a = ap.parse_args()
    import librosa
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    from transformers import ASTFeatureExtractor, ASTForAudioClassification

    sep = get_model(DEMUCS_MODEL).to(a.device).eval()
    fe = ASTFeatureExtractor.from_pretrained(AST_ID)
    ast = ASTForAudioClassification.from_pretrained(AST_ID).to(a.device).eval()
    labels = ast.config.id2label
    voice = sorted(i for i, name in labels.items()
                   if any(w in name.lower() for w in VOICE_WORDS) and name not in NOT_VOICE)
    results = []
    for f in a.files:
        audio, sr = sf.read(str(f), dtype="float32", always_2d=True)
        audio = audio.T
        if audio.shape[0] == 1:
            audio = np.repeat(audio, 2, axis=0)
        if sr != sep.samplerate:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=sep.samplerate)
        wav = torch.from_numpy(audio)
        ref = wav.mean(0)
        norm = (wav - ref.mean()) / (ref.std() + 1e-8)
        with torch.no_grad():
            stems = apply_model(sep, norm[None].to(a.device), device=a.device, progress=False)[0]
        stems = (stems * (ref.std() + 1e-8) + ref.mean()).cpu().numpy()
        vocals = stems[sep.sources.index("vocals")].mean(0)
        mix = audio.mean(0)
        v16 = librosa.resample(vocals, orig_sr=sep.samplerate, target_sr=16000)
        m16 = librosa.resample(mix, orig_sr=sep.samplerate, target_sr=16000)
        win, hop = int(WINDOW_S * 16000), int(HOP_S * 16000)
        windows = []
        for s in range(0, max(1, len(v16) - win + 1), hop):
            seg, mseg = v16[s:s + win], m16[s:s + win]
            rel = float(rms_db(seg) - rms_db(mseg))
            if rel < STEM_GATE_DB:
                windows.append({"t": round(s / 16000, 1), "stem_rel_db": round(rel, 1), "voice": 0.0, "class": "gated"})
                continue
            inputs = fe(seg, sampling_rate=16000, return_tensors="pt").to(a.device)
            with torch.no_grad():
                probs = torch.sigmoid(ast(**inputs).logits)[0]
            vp, vi = max((float(probs[i]), i) for i in voice)
            windows.append({"t": round(s / 16000, 1), "stem_rel_db": round(rel, 1), "voice": round(vp, 4),
                            "class": labels[vi]})
        top = max(windows, key=lambda w: w["voice"])
        loud = sum(w["stem_rel_db"] >= a.stem_db for w in windows)
        over = sum(w["voice"] >= a.threshold for w in windows)
        r = {"file": str(f), "sha256": __import__("hashlib").sha256(pathlib.Path(f).read_bytes()).hexdigest(),
             "max_voice": top["voice"], "max_class": top["class"], "max_at_s": top["t"],
             "stem_rel_db_at_max": top["stem_rel_db"], "max_stem_rel_db": max(w["stem_rel_db"] for w in windows),
             "windows_over": over, "stem_windows_over": loud, "windows": len(windows),
             "flagged": over > 0 or loud >= a.stem_windows, "per_window": windows}
        results.append(r)
        print(f"{'FLAG' if r['flagged'] else 'pass'} {r['max_voice']:.3f} {r['max_class']:22s} @{r['max_at_s']:5.1f}s "
              f"stem max {r['max_stem_rel_db']:6.1f} dB ({loud} loud)  {over}/{r['windows']}  {f}", flush=True)
    report = {"method": f"Demucs {DEMUCS_MODEL} vocals stem -> {AST_ID} AudioSet voice classes, per window",
              "voice_classes": [labels[i] for i in voice], "window_s": WINDOW_S, "hop_s": HOP_S,
              "stem_gate_db": STEM_GATE_DB, "threshold": a.threshold, "stem_db": a.stem_db,
              "stem_windows": a.stem_windows, "results": results}
    if a.out:
        pathlib.Path(a.out).write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
