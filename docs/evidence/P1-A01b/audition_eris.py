#!/usr/bin/env python3
"""P1-A01b audition renders. Runs on eris only (R89), from ~/Work/dev/jammers-audio, under .gpu.lock.

  design   VoiceDesign candidates: 4 prompt-only descriptions x the 8 audition cues  -> p1a01b/cand/<id>/<cue>.wav
  ref      restyle-once references: VoiceDesign read of REF_TEXT in a chosen candidate's voice, then Seed-VC
           F0 mode (--lift 4, as E4f) into the owner's timbre (ref-B)                  -> p1a01b/refs/<id>.wav/.txt
  clone    Qwen3-TTS 1.7B Base bf16 in-context clone of each reference x the 8 cues     -> p1a01b/clone/<ref>/<cue>.wav
  metrics  speaker similarity to the owner, Whisper large-v3 WER, pitch spread, loudness -> p1a01b/metrics.json
Reuses the screens' text normalisation (voice_screens.py) and pitch/VC helpers (voice_energy.py).
"""
import argparse, gc, json, pathlib, re, subprocess, sys, time
import numpy as np, soundfile as sf, torch

HOME = pathlib.Path.home() / "Work/dev/jammers-audio"
sys.path.insert(0, str(HOME / "bin"))
import voice_screens as S  # noqa: E402
import voice_energy as E  # noqa: E402

OUT = HOME / "private/voice/p1a01b"
OWNER = HOME / "private/voice/ref-B.wav"
OWNER_TXT = HOME / "private/voice/ref-B.txt"
E4F = HOME / "private/voice/energy/ref/excited-reff.wav"
E4F_TXT = HOME / "private/voice/energy/ref/excited-ref.txt"
SEED = 7

CUES = {  # same 8 for every clip: hype and warm, strewth, g'day, whoop whoop, fair dinkum, cheers
    "welcome": "G'day and welcome to Joystick Jammers! Grab a controller and make a spectacular mess!",
    "countdown": "Three! Two! One! Go, go, go!",
    "big-air": "Look at that air! Strewth!",
    "whoop-whoop": "He's gone out past whoop whoop, legends!",
    "fair-dinkum": "Fair dinkum, that was a ripper of a lap!",
    "photo-finish": "It's a photo finish! What a ripper of a race!",
    "next-round": "Next track's loading. Same again? Too right!",
    "cheers": "That's the round, mates. Cheers for playing!",
}
CANDS = {
    "C1": ("Fast ocker", "A male Australian motorsport announcer with a strong, broad ocker accent and a nasal twang, medium pitch, "
           "fast pace, shouting with excitement, punchy stress on every key word, like a V8 Supercars commentator on the last lap."),
    "C2": ("Slow drawl", "A male Australian race caller with a very broad, lazy drawl and a deep, low pitch, nasal, slow and amused, "
           "exaggerated stretched vowels, excited but never hurried, like an outback pub storyteller calling a demolition derby."),
    "C3": ("Bright nasal", "A male Australian showman with a bright, higher-pitched, very nasal broad accent, fast and breathless, "
           "cheeky and over-the-top excited, like a kids' TV host announcing a monster-truck show."),
    "C4": ("Booming gravel", "A male Australian stadium announcer with a gravelly, booming voice, mid-low pitch, slightly nasal, broad accent, "
           "medium pace with big dramatic emphasis and long drawn-out words, like the grand final announcer at the footy."),
}
REF_TEXT = ("Please call Stella. Ask her to bring these things with her from the store: six spoons of fresh snow peas, five thick slabs "
            "of blue cheese, and maybe a snack for her brother Bob. And they're off! What a start, flat out into the first corner! "
            "Oh, she's sideways, she's sideways, and she holds it! Fair dinkum, what a ripper!")


def load(name, **kw):
    """eris's desktop apps hold ~3.5 GB of the 8 GB card, so the 4.3 GB model does not fit with its codec: the talker
    (bf16) stays on the GPU and the speech-tokenizer codec runs on the CPU (same weights, float32 because CPU bf16 conv is far too slow)."""
    from qwen_tts import Qwen3TTSModel
    from qwen_tts.inference import qwen3_tts_tokenizer as T
    orig = T.Qwen3TTSTokenizer.from_pretrained
    def cpu_codec(path, *a, **k):  # the codec loads straight onto the CPU in float32, never touching the GPU
        k["device_map"] = "cpu"; k["dtype"] = torch.float32; return orig(path, *a, **k)
    T.Qwen3TTSTokenizer.from_pretrained = staticmethod(cpu_codec)
    torch.set_num_threads(12)
    m = Qwen3TTSModel.from_pretrained(name, device_map="cuda:0", **kw)
    return m


def free():
    gc.collect(); torch.cuda.empty_cache()


def cap(text):
    return int((2.0 + 0.6 * len(S.words(text))) * 12.5 * 1.3) + 24


def design(args):
    from qwen_tts import Qwen3TTSModel
    vd = load("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", dtype=torch.bfloat16, attn_implementation="sdpa")
    for cid, (_, instruct) in CANDS.items():
        d = OUT / "cand" / cid; d.mkdir(parents=True, exist_ok=True)
        for cue, text in CUES.items():
            p = d / f"{cue}.wav"
            if p.exists(): continue
            torch.manual_seed(SEED)
            w, sr = vd.generate_voice_design(text=S.tts_text(text), instruct=instruct, language="English", max_new_tokens=cap(text))
            sf.write(p, np.asarray(w[0], dtype=np.float32), sr); print("design", cid, cue, flush=True)
    (OUT / "candidates.json").write_text(json.dumps({k: {"name": v[0], "instruct": v[1]} for k, v in CANDS.items()}, indent=2))


def ref(args):
    # args.cands: "C1:R1,C3:R2" maps a candidate description to a reference id
    from qwen_tts import Qwen3TTSModel
    (OUT / "refs").mkdir(parents=True, exist_ok=True); (OUT / "_vc").mkdir(exist_ok=True)
    pairs = [x.split(":") for x in args.cands.split(",")]
    vd = load("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", dtype=torch.bfloat16, attn_implementation="sdpa")
    for cid, rid in pairs:
        raw = OUT / "_vc" / f"{rid}_design.wav"
        if not raw.exists():
            torch.manual_seed(SEED)
            w, sr = vd.generate_voice_design(text=REF_TEXT, instruct=CANDS[cid][1], language="English", max_new_tokens=cap(REF_TEXT) + 200)
            sf.write(raw, np.asarray(w[0], dtype=np.float32), sr); print("ref design", rid, len(w[0]) / sr, "s", flush=True)
    del vd; free()
    for cid, rid in pairs:
        raw = OUT / "_vc" / f"{rid}_design.wav"
        stage = OUT / "_vc" / rid; stage.mkdir(exist_ok=True)
        for old in stage.glob("vc_*.wav"): old.unlink()
        rc = subprocess.run([str(E.SEEDVC / ".venv/bin/python"), "-c", E.SEEDVC_SOUNDFILE_SAVE, "--source", str(raw), "--target", str(OWNER),
                             "--output", str(stage), "--diffusion-steps", "30", "--length-adjust", "1.0", "--inference-cfg-rate", "0.7",
                             "--fp16", "True", "--f0-condition", "True", "--auto-f0-adjust", "True", "--semi-tone-shift", "4"], cwd=E.SEEDVC).returncode
        got = list(stage.glob("vc_*.wav"))
        if not got: raise RuntimeError(f"seed-vc made nothing for {rid} (exit {rc})")
        # 24 kHz mono, trim edge silence only
        a, sr = sf.read(str(got[0]), dtype="float32", always_2d=True); a = a.mean(axis=1)
        keep = np.where(np.abs(a) > 0.01)[0]; a = a[max(0, keep[0] - int(0.1 * sr)): keep[-1] + int(0.2 * sr)]
        sf.write(OUT / "refs" / f"{rid}.wav", a, sr); (OUT / "refs" / f"{rid}.txt").write_text(REF_TEXT + "\n")
        print("ref", rid, "from", cid, f"{len(a) / sr:.1f}s", flush=True)
    (OUT / "refs" / "map.json").write_text(json.dumps({rid: cid for cid, rid in pairs}))


def refs_all():
    import shutil
    (OUT / "refs").mkdir(parents=True, exist_ok=True)
    for rid, src, txt in (("E4F", E4F, E4F_TXT), ("OWNER", OWNER, OWNER_TXT)):  # the current excited ref and the owner's own, as-is
        if not (OUT / "refs" / f"{rid}.wav").exists():
            shutil.copy(src, OUT / "refs" / f"{rid}.wav"); (OUT / "refs" / f"{rid}.txt").write_text(txt.read_text())
    r = {rid: (OUT / "refs" / f"{rid}.wav", (OUT / "refs" / f"{rid}.txt").read_text().strip()) for rid in ("E4F", "OWNER")}
    for p in sorted((OUT / "refs").glob("R*.wav")): r[p.stem] = (p, p.with_suffix(".txt").read_text().strip())
    return r


def clone(args):
    from qwen_tts import Qwen3TTSModel
    base = load("Qwen/Qwen3-TTS-12Hz-1.7B-Base", dtype=torch.bfloat16, attn_implementation="sdpa")
    for rid, (path, txt) in refs_all().items():
        prompt = base.create_voice_clone_prompt(ref_audio=str(path), ref_text=txt)
        d = OUT / "clone" / rid; d.mkdir(parents=True, exist_ok=True)
        for cue, text in CUES.items():
            p = d / f"{cue}.wav"
            if p.exists(): continue
            torch.manual_seed(SEED)
            w, sr = base.generate_voice_clone(text=S.tts_text(text), language="English", voice_clone_prompt=prompt, max_new_tokens=cap(text))
            sf.write(p, np.asarray(w[0], dtype=np.float32), sr); print("clone", rid, cue, flush=True)


def loudness(path):
    r = subprocess.run(["ffmpeg", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", r); tp = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", r)
    return (float(i[-1]) if i else None, float(tp[-1]) if tp else None)


def metrics(args):
    clips = []  # (group, engine, ref, cue, path, text)
    for cid in CANDS:
        for cue, t in CUES.items(): clips.append(("cand", "voicedesign-1.7B", cid, cue, OUT / "cand" / cid / f"{cue}.wav", t))
    for rid in refs_all():
        for cue, t in CUES.items():
            clips.append(("ref", "qwen3-1.7B-bf16-eris", rid, cue, OUT / "clone" / rid / f"{cue}.wav", t))
            clips.append(("ref", "ftts-0.6B-int8-mac", rid, cue, OUT / "ftts" / rid / f"{cue}.wav", t))
    for rid, (path, txt) in refs_all().items():
        clips.append(("reference", "recording", rid, "reference", path, txt))
    clips = [c for c in clips if c[4].exists()]
    from qwen_tts import Qwen3TTSModel
    base = load("Qwen/Qwen3-TTS-12Hz-1.7B-Base", dtype=torch.bfloat16, attn_implementation="sdpa")

    def emb(path):
        a, s = sf.read(str(path), dtype="float32"); a = a if a.ndim == 1 else a.mean(axis=1); a = a[: int(8 * s)]
        return base.create_voice_clone_prompt(ref_audio=(a, s), x_vector_only_mode=True)[0].ref_spk_embedding.float().flatten().cpu()
    oe = emb(OWNER); rows = []
    for g, eng, rid, cue, path, text in clips:
        rows.append({"group": g, "engine": eng, "ref": rid, "cue": cue, "file": str(path.relative_to(OUT)), "text": text,
                     "speaker_sim": round(float(torch.nn.functional.cosine_similarity(emb(path), oe, dim=0)), 4), **E.pitch_stats(path)})
    (OUT / "metrics_sim.json").write_text(json.dumps(rows, indent=1))
    # Whisper is the separate `asr` phase: the 8 GB card has 3.5 GB held by desktop apps, so it needs a fresh process


def asr_phase(args):
    rows = json.loads((OUT / "metrics_sim.json").read_text())
    from faster_whisper import WhisperModel
    asr = WhisperModel("large-v3", device="cuda", compute_type="int8_float16")  # float16 large-v3 does not fit beside the desktop apps' 3.5 GB; ASR scoring only
    for r in rows:
        a16, _ = E.load(OUT / r["file"], 16000)
        segs, _ = asr.transcribe(a16.numpy(), language="en", beam_size=5)
        r["heard"] = " ".join(s.text.strip() for s in segs); r["wer"] = round(S.wer(r["text"], r["heard"]), 3)
        r["lufs"], r["peak_dbfs"] = loudness(OUT / r["file"])
        info = sf.info(str(OUT / r["file"])); r["seconds"] = round(info.duration, 2)
    (OUT / "metrics.json").write_text(json.dumps(rows, indent=1)); print("metrics", len(rows), "clips", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("phase", choices=["design", "ref", "clone", "metrics", "asr"]); ap.add_argument("--cands", default="")
    a = ap.parse_args(); OUT.mkdir(parents=True, exist_ok=True); t = time.time()
    {"design": design, "ref": ref, "clone": clone, "metrics": metrics, "asr": asr_phase}[a.phase](a)
    print(f"phase {a.phase} done in {time.time() - t:.0f}s", flush=True)
