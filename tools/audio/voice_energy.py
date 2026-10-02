#!/usr/bin/env python3
"""Experiments: an excited announcer in the owner's timbre, from a calm reference recording. Runs on eris.

The Qwen3-TTS Base clone copies delivery as well as timbre from its reference, so a calm recording gives
a calm announcer. These variants move the source of the *delivery* while keeping the owner's *timbre*:

  E1 xvec    Base clone from the speaker embedding only (no in-context codes), so prosody isn't anchored
             to the calm clip.
  E2 design  VoiceDesign from a text instruction (high-energy announcer). Not the owner's voice; the
             energy source for E3/E4.
  E3 vc      E2 converted to the owner's timbre with Seed-VC (keeps E2's delivery).
  E4 exref   Base in-context clone from an *excited reference*: a VoiceDesign paragraph converted to the
             owner's timbre (E3 applied to a 20 s read), so every future line inherits energy + timbre.

Outputs under <out>/ with a metrics JSON (speaker similarity to the owner, Whisper WER, pitch spread as an
energy proxy) and a comparison reel per line: calm baseline, E1, E2, E3, E4.
"""
import argparse
import gc
import json
import pathlib
import re
import subprocess

import numpy as np
import soundfile as sf
import torch
import torchaudio.functional as F

HOME = pathlib.Path.home() / "Work/dev/jammers-audio"
SEEDVC = HOME / "seed-vc"
# Runs Seed-VC's inference.py with torchaudio.save routed through soundfile: on eris torchaudio 2.8's own
# backend writes the 36-byte WAV header and then segfaults, leaving no audio.
SEEDVC_SOUNDFILE_SAVE = """
import runpy, sys
import soundfile, torchaudio
torchaudio.save = lambda path, wav, sr, **kw: soundfile.write(path, wav.detach().cpu().numpy().T, sr)
sys.argv = ["inference.py"] + sys.argv[1:]
runpy.run_path("inference.py", run_name="__main__")
"""
LINES = {  # a subset of cues-playtest1-audition.tsv, so the calm A renders are a direct baseline
    "welcome": "G'day and welcome to Joystick Jammers! Grab a controller and make a spectacular mess!",
    "countdown": "Three! Two! One! Go, go, go!",
    "final-lap": "Final lap! Hold on to your doors, legends!",
    "photo-finish": "It's a photo finish! What a ripper of a race!",
}
PARAGRAPH = ("And they're off! What a start from number seven, flat out into the first corner! Oh, he's sideways, "
             "he's sideways, and he holds it! Unbelievable! Here comes the pack, doors flying everywhere, "
             "this is absolutely bonkers! What a race!")


def words(t):
    return re.findall(r"[a-z0-9']+", t.lower())


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / max(1, len(r))


def load(path, sr=None):
    a, s = sf.read(str(path), dtype="float32", always_2d=True)
    a = torch.from_numpy(a.mean(axis=1))
    if sr and s != sr:
        a, s = F.resample(a, s, sr), sr
    return a, s


def pitch_stats(path):
    a, s = load(path, 16000)
    f0 = F.detect_pitch_frequency(a.unsqueeze(0), s, frame_time=0.02, win_length=30).squeeze(0).numpy()
    f0 = f0[(f0 > 60) & (f0 < 500)]
    if len(f0) < 5:
        return {"median_hz": None, "spread_semitones": None}
    st = 12 * np.log2(f0 / np.median(f0))
    return {"median_hz": round(float(np.median(f0)), 1), "spread_semitones": round(float(np.percentile(st, 90) - np.percentile(st, 10)), 2)}


def pitch_words(median_hz):
    if median_hz is None:
        return "a mid-pitched"
    if median_hz < 125:
        return "a deep, low-pitched"
    if median_hz < 175:
        return "a medium-low"
    if median_hz < 220:
        return "a medium"
    return "a bright, higher-pitched"


def free():
    gc.collect()
    torch.cuda.empty_cache()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner-ref", default=str(HOME / "private/voice/ref-B.wav"))
    ap.add_argument("--owner-ref-text", default=str(HOME / "private/voice/ref-B.txt"))
    ap.add_argument("--baseline-dir", default=str(HOME / "private/voice/renders/A/best"))
    ap.add_argument("--out", default=str(HOME / "private/voice/energy"))
    ap.add_argument("--seeds", type=int, nargs="+", default=[7, 8])
    ap.add_argument("--vc-mode", choices=["flat", "f0"], default="flat",
                    help="flat: Seed-VC speech model, which re-pitches into the owner's normal register; f0: the\n"
                         "F0-conditioned model keeping the source contour, centred --lift semitones above the owner")
    ap.add_argument("--lift", type=int, default=4, help="semitones above the owner's median pitch (f0 mode)")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    sfx = "" if a.vc_mode == "flat" else "f"  # f0-mode outputs go to e3f/e4f so both modes can be compared
    for sub in ("e1", "e2", f"e3{sfx}", f"e4{sfx}", "ref"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    owner_pitch = pitch_stats(a.owner_ref)
    instruct = (f"An Australian motorsport announcer with {pitch_words(owner_pitch['median_hz'])} voice, calling a "
                "thrilling live race: very high energy, hyped and shouting with excitement, fast pace, big pitch "
                "swings and punchy emphasis, like the final lap of a grand prix.")
    log = {"owner_pitch": owner_pitch, "instruct": instruct, "takes": []}
    print("owner pitch", owner_pitch, flush=True)

    from qwen_tts import Qwen3TTSModel

    # E2 (+ the paragraph for E4): VoiceDesign. Existing renders are kept, so a rerun resumes.
    todo = [(name, text, seed, out / ("ref" if name == "paragraph" else "e2") / f"{name}.s{seed}.wav")
            for name, text in list(LINES.items()) + [("paragraph", PARAGRAPH)]
            for seed in (a.seeds if name != "paragraph" else a.seeds[:1])]
    todo = [t for t in todo if not t[3].exists()]
    if todo:
        vd = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", device_map="cuda:0",
                                           dtype=torch.bfloat16, attn_implementation="sdpa")
        for name, text, seed, path in todo:
            torch.manual_seed(seed)
            cap = int((2.0 + 0.6 * len(words(text))) * 12.5 * 1.3) + 24
            wavs, sr = vd.generate_voice_design(text=text, instruct=instruct, language="English", max_new_tokens=cap)
            sf.write(path, np.asarray(wavs[0], dtype=np.float32), sr)
            print("e2", path.name, flush=True)
        del vd
        free()

    # E3: Seed-VC each designed line (and the paragraph) into the owner's timbre.
    def vc(src, dst_dir, final_name=None):
        final = pathlib.Path(dst_dir) / (final_name or src.name)
        if final.exists() and final.stat().st_size > 1024:  # a bare header means an earlier failed save
            return final
        # Seed-VC names its output after the source up to the first dot, and can segfault on interpreter
        # exit after writing it: stage a dot-free copy and judge success by the output file, not the exit code.
        stage = out / "_vc_stage"
        stage.mkdir(exist_ok=True)
        staged = stage / (src.stem.replace(".", "_") + ".wav")
        staged.write_bytes(src.read_bytes())
        for old in stage.glob("vc_*.wav"):
            old.unlink()
        rc = subprocess.run([str(SEEDVC / ".venv/bin/python"), "-c", SEEDVC_SOUNDFILE_SAVE, "--source", str(staged),
                             "--target", a.owner_ref, "--output", str(stage), "--diffusion-steps", "30",
                             "--length-adjust", "1.0", "--inference-cfg-rate", "0.7", "--fp16", "True", *mode_flags],
                            cwd=SEEDVC).returncode
        produced = list(stage.glob(f"vc_{staged.stem}_*.wav"))
        if not produced:
            raise RuntimeError(f"Seed-VC produced nothing for {src} (exit {rc})")
        produced[0].rename(final)
        return final

    mode_flags = ["--f0-condition", "False"] if a.vc_mode == "flat" else [
        "--f0-condition", "True", "--auto-f0-adjust", "True", "--semi-tone-shift", str(a.lift)]
    for src in sorted((out / "e2").glob("*.wav")):
        print(f"e3{sfx}", vc(src, out / f"e3{sfx}").name, flush=True)
    exref = vc(sorted((out / "ref").glob("paragraph.s*.wav"))[0], out / "ref", f"excited-ref{sfx}.wav")
    (out / "ref" / "excited-ref.txt").write_text(PARAGRAPH + "\n")

    # E1 and E4: Base clone from the owner's embedding only, and from the excited reference in context.
    base = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0",
                                         dtype=torch.bfloat16, attn_implementation="sdpa")
    owner_text = pathlib.Path(a.owner_ref_text).read_text().strip()
    p_xvec = base.create_voice_clone_prompt(ref_audio=a.owner_ref, ref_text=owner_text, x_vector_only_mode=True)
    p_exref = base.create_voice_clone_prompt(ref_audio=str(exref), ref_text=PARAGRAPH)
    for label, prompt in (("e1", p_xvec), (f"e4{sfx}", p_exref)):
        for name, text in LINES.items():
            for seed in a.seeds:
                if (out / label / f"{name}.s{seed}.wav").exists():
                    continue
                torch.manual_seed(seed)
                cap = int((2.0 + 0.6 * len(words(text))) * 12.5 * 1.3) + 24
                wavs, sr = base.generate_voice_clone(text=text, language="English", voice_clone_prompt=prompt,
                                                     max_new_tokens=cap)
                path = out / label / f"{name}.s{seed}.wav"
                sf.write(path, np.asarray(wavs[0], dtype=np.float32), sr)
                print(label, path.name, flush=True)

    # Speaker similarity to the owner (embedding of the first 8 s).
    def emb(path):
        audio, s = sf.read(str(path), dtype="float32")
        audio = audio[: int(8 * s)]
        item = base.create_voice_clone_prompt(ref_audio=(audio, s), x_vector_only_mode=True)[0]
        return item.ref_spk_embedding.float().flatten().cpu()

    owner_emb = emb(a.owner_ref)
    rows = []
    for label in sorted(d.name for d in out.glob("e*") if d.is_dir()):
        for path in sorted((out / label).glob("*.wav")):
            rows.append({"variant": label, "file": str(path), "line": path.name.split(".s")[0],
                         "speaker_sim": round(float(torch.nn.functional.cosine_similarity(emb(path), owner_emb, dim=0)), 4),
                         **pitch_stats(path)})
    for name in LINES:
        base_path = pathlib.Path(a.baseline_dir) / f"{name}.wav"
        if base_path.exists():
            rows.append({"variant": "calm", "file": str(base_path), "line": name,
                         "speaker_sim": round(float(torch.nn.functional.cosine_similarity(emb(base_path), owner_emb, dim=0)), 4),
                         **pitch_stats(base_path)})
    del base
    free()

    from faster_whisper import WhisperModel

    asr = WhisperModel("large-v3", device="cuda", compute_type="float16")
    for row in rows:
        a16, _ = load(row["file"], 16000)
        segs, _ = asr.transcribe(a16.numpy(), language="en", beam_size=5)
        row["heard"] = " ".join(s.text.strip() for s in segs)
        row["wer"] = round(wer(LINES[row["line"]], row["heard"]), 3)
    log["takes"] = rows
    (out / "metrics.json").write_text(json.dumps(log, indent=2))
    for r in sorted(rows, key=lambda r: (r["line"], r["variant"])):
        print(f"{r['line']:13s} {r['variant']:5s} sim {r['speaker_sim']:.3f} pitch-spread {r['spread_semitones']} wer {r['wer']}  {pathlib.Path(r['file']).name}")


if __name__ == "__main__":
    main()
