#!/usr/bin/env python3
"""voice_render_eris.py: the GPU half of tools/audio/render_voice.py (P1-A01). Runs on eris only.

Takes a job (the validated cue-sheet rows, written by render_voice.py after A00's check_sheet passes) and:

  render   builds each Qwen3-TTS 1.7B Base clone prompt ONCE (speaker embedding + in-context codec tokens;
           cached under private/voice/p1a01/prompts/, reused by every line and every later run) and renders N
           seeded takes per row. `hype` rows clone the excited reference, `warm` rows the owner's own. Scores
           speaker similarity (vs the owner reference) and pitch while the TTS model is loaded.
  asr      Whisper large-v3 (faster-whisper) transcribes every take -> WER vs the row's spoken text; checks the
           reference transcripts the same way; measures raw loudness (ffmpeg ebur128: integrated LUFS, true peak).
  finish   applies the screens and the pick rule (voice_screens.py), trims the picked take's silence,
           normalises to one loudness target, encodes Ogg/Opus, re-measures the decoded file, writes
           manifest.json and the audition reel + index.

`--phase all` (default) runs render -> asr in separate processes (each frees the 8 GB GPU on exit), adds more
seeds for any row that has no passing take (up to --max-candidates), then finish. Everything is cached by a
key over (text, reference, seed, model, dtype), so a rerun only renders what changed. Private inputs and
renders stay under $JJ_AUDIO_HOME/private; only exports/voice/*.ogg + manifest.json are meant to leave eris.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import time

import numpy as np
import soundfile as sf

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import voice_screens as S  # noqa: E402

HOME = pathlib.Path(os.environ.get("JJ_AUDIO_HOME", pathlib.Path.home() / "Work/dev/jammers-audio"))
os.environ.setdefault("HF_HOME", str(HOME / "hf-cache"))
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
LANGUAGE = "English"
SEED_BASE = 1000
WORK = HOME / "private/voice/p1a01"
VOICE = HOME / "private/voice"
OPUS_KBPS = 48
OPUS_RATE = 48000


def sha(data: bytes, n: int = 12) -> str:
    return hashlib.sha256(data).hexdigest()[:n]


def file_sha(path: pathlib.Path, n: int = 64) -> str:
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()[:n]


def write_json(path: pathlib.Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2))
    tmp.replace(path)


def read_json(path: pathlib.Path, default=None):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except (OSError, json.JSONDecodeError):
        return default


# ---- references -----------------------------------------------------------------------------------------------

def refs(args) -> dict:
    """The two clone references: the owner's own recording and the excited reference (the owner's performed announcer take, Aussie reading)."""
    return {
        "owner": {"id": "owner-ref-aussie-warm", "wav": pathlib.Path(args.owner_ref), "text_file": pathlib.Path(args.owner_ref_text)},
        "excited": {"id": "excited-ref-aussie-hype", "wav": pathlib.Path(args.excited_ref),
                    "text_file": pathlib.Path(args.excited_ref_text)},
    }


def ref_key(ref: dict) -> str:
    return sha(ref["wav"].read_bytes() + b"\0" + ref["text_file"].read_text().strip().encode(), 16)


def ref_for(delivery: str) -> str:
    return "excited" if delivery == "hype" else "owner"


# ---- takes on disk ----------------------------------------------------------------------------------------------

def take_paths(row_id: str, seed: int) -> tuple[pathlib.Path, pathlib.Path]:
    return WORK / "takes" / f"{row_id}.s{seed}.wav", WORK / "takes" / f"{row_id}.s{seed}.json"


def take_key(row: dict, seed: int, rkey: str, dtype_arg: str) -> str:
    return sha(json.dumps([row.get("tts_text", row["text"]), rkey, seed, MODEL_ID, dtype_arg, LANGUAGE]).encode(), 16)


def seeds_for(count: int) -> list[int]:
    return [SEED_BASE + k for k in range(count)]


def load_take(row: dict, seed: int, rkeys: dict, dtype_arg: str) -> dict | None:
    wav, meta = take_paths(row["id"], seed)
    d = read_json(meta)
    if d and wav.exists() and d.get("key") == take_key(row, seed, rkeys[ref_for(row["delivery"])], dtype_arg):
        return d
    return None


def save_take(row: dict, seed: int, d: dict) -> None:
    write_json(take_paths(row["id"], seed)[1], d)


# ---- phase: render ----------------------------------------------------------------------------------------------

def phase_render(job: dict, wanted: dict, args) -> None:
    rkeys = {name: ref_key(r) for name, r in refs(args).items()}
    todo = [(row, seed) for row in job["rows"] if row["id"] in job["active"] for seed in seeds_for(wanted[row["id"]])
            if load_take(row, seed, rkeys, args.dtype) is None]
    if not todo:
        print("render: every take is cached", flush=True)
        return

    import torch
    from voice_clone import load_model, spk_embedding
    from voice_energy import pitch_stats

    t0 = time.time()
    model, dtype = load_model(args.dtype)
    print(f"render: loaded {MODEL_ID} as {dtype} in {time.time() - t0:.0f}s; {len(todo)} takes to render", flush=True)
    info = read_json(WORK / "render-info.json", {})
    info.update({"model": MODEL_ID, "dtype": dtype, "dtype_arg": args.dtype, "prompts": info.get("prompts", {})})

    prompts = {}
    for name in sorted({ref_for(row["delivery"]) for row, _ in todo} | {"owner"}):
        r = refs(args)[name]
        text = r["text_file"].read_text().strip()
        pfile = WORK / "prompts" / f"{name}-{ref_key(r)[:12]}-{MODEL_ID.split('/')[-1]}-{dtype}.pt"
        source = "cached"
        prompt = None
        if pfile.exists():
            try:
                prompt = torch.load(pfile, map_location="cuda:0", weights_only=False)
            except Exception as exc:  # a stale pickle from another library version: rebuild
                print(f"render: cached prompt {pfile.name} unreadable ({exc!r}); rebuilding", flush=True)
        if prompt is None:
            prompt = model.create_voice_clone_prompt(ref_audio=str(r["wav"]), ref_text=text)
            pfile.parent.mkdir(parents=True, exist_ok=True)
            torch.save(prompt, pfile)
            source = "built"
        prompts[name] = prompt
        info["prompts"][name] = {"source": source, "file": pfile.name, "reference": r["id"]}
        print(f"render: clone prompt {name} ({r['id']}): {source}", flush=True)

    ow_audio, ow_sr = sf.read(str(refs(args)["owner"]["wav"]))
    owner_emb = spk_embedding(model, ow_audio, ow_sr)

    done = 0
    for row, seed in todo:
        name = ref_for(row["delivery"])
        n_words = len(S.words(row["text"]))
        # The checkpoint's default max_new_tokens (8192, ~11 minutes) lets a take that never emits end-of-speech
        # run on and exhaust the GPU: cap at ~1.3x the longest plausible length (voice_clone.py's rule).
        cap = int((2.0 + 0.6 * n_words) * 12.5 * 1.3) + 24
        wav, _ = take_paths(row["id"], seed)
        wav.parent.mkdir(parents=True, exist_ok=True)
        audio, sr = None, None
        for attempt in (1, 2):
            try:
                torch.manual_seed(seed)
                wavs, sr = model.generate_voice_clone(text=row.get("tts_text", row["text"]), language=LANGUAGE,
                                                      voice_clone_prompt=prompts[name], max_new_tokens=cap)
                audio = np.asarray(wavs[0], dtype=np.float32)
                break
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
        if audio is None:
            print(f"render: {row['id']} seed {seed}: out of memory twice, skipped", flush=True)
            continue
        sf.write(wav, audio, sr)
        try:
            emb = spk_embedding(model, audio, sr)
            sim = float(torch.nn.functional.cosine_similarity(emb, owner_emb, dim=0))
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            sim = 0.0
        ps = pitch_stats(wav)
        save_take(row, seed, {
            "key": take_key(row, seed, rkeys[name], args.dtype), "id": row["id"], "seed": seed, "reference": name,
            "dtype": dtype, "sample_rate": sr, "seconds": round(len(audio) / sr, 3), "speaker_sim": round(sim, 4),
            "median_hz": ps["median_hz"], "spread_semitones": ps["spread_semitones"]})
        done += 1
        if done % 10 == 0:
            torch.cuda.empty_cache()
            print(f"render: {done}/{len(todo)} takes ({time.time() - t0:.0f}s)", flush=True)
    write_json(WORK / "render-info.json", info)
    print(f"render: {done} takes in {time.time() - t0:.0f}s", flush=True)


# ---- loudness ---------------------------------------------------------------------------------------------------

def measure_loudness(path: pathlib.Path) -> tuple[float | None, float | None]:
    """Integrated LUFS and true peak (dBTP) of an audio file, via ffmpeg's ebur128 (BS.1770, 4x oversampled peak)."""
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    tail = p.stderr.rsplit("Summary:", 1)[-1]
    i = re.search(r"I:\s*(-?[\d.]+|-inf)\s*LUFS", tail)
    tp = re.search(r"Peak:\s*(-?[\d.]+|-inf)\s*dBFS", tail)

    def num(m):
        return None if not m or m.group(1) == "-inf" else float(m.group(1))

    return num(i), num(tp)


# ---- phase: asr -------------------------------------------------------------------------------------------------

def phase_asr(job: dict, wanted: dict, args) -> None:
    rkeys = {name: ref_key(r) for name, r in refs(args).items()}
    rows = {row["id"]: row for row in job["rows"]}
    need_asr = [(row, seed, d) for row in job["rows"] for seed in seeds_for(wanted[row["id"]])
                if (d := load_take(row, seed, rkeys, args.dtype)) is not None and "heard" not in d]
    check_path = WORK / "ref-check.json"
    check = read_json(check_path, {})
    need_refs = {n: r for n, r in refs(args).items() if check.get(n, {}).get("key") != ref_key(r)}

    if need_asr or need_refs:
        import torch
        from faster_whisper import WhisperModel
        from voice_clone import load_16k
        from voice_energy import pitch_stats

        t0 = time.time()
        asr = WhisperModel("large-v3", device="cuda", compute_type="float16")

        def hear(path):
            segs, _ = asr.transcribe(load_16k(path), language="en", beam_size=5, condition_on_previous_text=False)
            return " ".join(s.text.strip() for s in segs)

        for name, r in need_refs.items():
            heard = hear(r["wav"])
            text = r["text_file"].read_text().strip()
            check[name] = {"key": ref_key(r), "reference": r["id"], "heard": heard, "wer_vs_stored_transcript": round(S.wer(text, heard), 3),
                           "seconds": round(sf.info(str(r["wav"])).duration, 2), **pitch_stats(r["wav"])}
            print(f"asr: reference {r['id']}: wer vs stored transcript {check[name]['wer_vs_stored_transcript']}", flush=True)
        write_json(check_path, check)
        for n, (row, seed, d) in enumerate(need_asr, 1):
            d["heard"] = hear(take_paths(row["id"], seed)[0])
            d["wer"] = round(S.wer(row["text"], d["heard"]), 3)
            save_take(row, seed, d)
            if n % 25 == 0:
                print(f"asr: {n}/{len(need_asr)} takes ({time.time() - t0:.0f}s)", flush=True)
        del asr
        torch.cuda.empty_cache()
        print(f"asr: {len(need_asr)} takes in {time.time() - t0:.0f}s", flush=True)
    else:
        print("asr: every take and reference is already transcribed", flush=True)

    n_loud = 0
    for row in rows.values():
        for seed in seeds_for(wanted[row["id"]]):
            d = load_take(row, seed, rkeys, args.dtype)
            if d is not None and "raw_lufs" not in d:
                d["raw_lufs"], d["raw_true_peak_dbtp"] = measure_loudness(take_paths(row["id"], seed)[0])
                save_take(row, seed, d)
                n_loud += 1
    print(f"asr: loudness measured on {n_loud} takes", flush=True)


# ---- orchestration helpers (no torch) ---------------------------------------------------------------------------

def row_takes(row: dict, count: int, rkeys: dict, dtype_arg: str, owner_median: float | None) -> list[dict]:
    out = []
    for seed in seeds_for(count):
        d = load_take(row, seed, rkeys, dtype_arg)
        if d is None:
            continue
        t = dict(d)
        t["lift_st"] = S.lift_semitones(t.get("median_hz"), owner_median)
        if "heard" in t:  # recomputed from the transcript, so a change to the screens' ASR aliases needs no new ASR pass
            t["wer"] = round(S.wer(row["text"], t["heard"]), 3)
        out.append(t)
    return out


def owner_median_hz() -> float | None:
    return (read_json(WORK / "ref-check.json", {}).get("owner") or {}).get("median_hz")


def run_phase(phase: str, args, wanted_path: pathlib.Path) -> None:
    argv = [sys.executable, str(pathlib.Path(__file__).resolve()), *args.passthrough, "--phase", phase, "--wanted", str(wanted_path)]
    rc = subprocess.run(argv).returncode
    if rc != 0:
        raise SystemExit(f"phase {phase} failed (exit {rc})")


def phase_all(job: dict, args) -> None:
    rkeys = {name: ref_key(r) for name, r in refs(args).items()}
    wanted = {row["id"]: args.candidates for row in job["rows"]}
    wanted_path = WORK / "wanted.json"
    rnd = 0
    while True:
        write_json(wanted_path, wanted)
        print(f"== round {rnd}: {sum(wanted.values())} takes wanted for {len(wanted)} rows", flush=True)
        run_phase("render", args, wanted_path)
        run_phase("asr", args, wanted_path)
        grow = []
        for row in job["rows"]:
            if row["id"] not in job["active"]:
                continue
            takes = row_takes(row, wanted[row["id"]], rkeys, args.dtype, owner_median_hz())
            best, ok = S.pick_best(takes, row["text"], row["delivery"])
            if not ok and wanted[row["id"]] + args.extra <= args.max_candidates:
                grow.append(row["id"])
        if not grow:
            break
        for rid in grow:
            wanted[rid] += args.extra
        rnd += 1
        print(f"== {len(grow)} rows have no passing take yet: +{args.extra} seeds each: {', '.join(grow)}", flush=True)
    write_json(wanted_path, wanted)
    run_phase("finish", args, wanted_path)


# ---- phase: finish (CPU) ----------------------------------------------------------------------------------------

def trim_silence(audio: np.ndarray, sr: int, floor_db: float = -42.0, pre_s: float = 0.06, post_s: float = 0.16) -> np.ndarray:
    """Cut leading/trailing silence (10 ms RMS frames more than floor_db below the loudest), keep a short pad."""
    hop = max(1, int(0.01 * sr))
    n = len(audio) // hop
    if n == 0:
        return audio
    env = np.sqrt((audio[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    if env.max() <= 0:
        return audio
    idx = np.nonzero(env > env.max() * 10 ** (floor_db / 20))[0]
    a = max(0, int(idx[0]) * hop - int(pre_s * sr))
    b = min(len(audio), (int(idx[-1]) + 1) * hop + int(post_s * sr))
    out = audio[a:b].astype(np.float32).copy()
    fi, fo = min(len(out), int(0.005 * sr)), min(len(out), int(0.03 * sr))
    out[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32)
    out[-fo:] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)
    return out


def encode(master: pathlib.Path, out: pathlib.Path, gain_db: float, limit: float, codec: str) -> None:
    chain = f"aresample={OPUS_RATE},volume={gain_db:.3f}dB,alimiter=limit={limit:.4f}:attack=2:release=30:level=0"
    codec_args = (["-c:a", "libopus", "-b:a", f"{OPUS_KBPS}k", "-vbr", "on", "-application", "audio", "-compression_level", "10"]
                  if codec == "opus" else ["-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart"])
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(master), "-af", chain, "-ac", "1", *codec_args, str(out)],
                   check=True)


def export_clip(master: pathlib.Path, out: pathlib.Path, m4a: pathlib.Path | None) -> dict:
    """Normalise to TARGET_LUFS / TARGET_TRUE_PEAK, encode Ogg/Opus, then re-measure the DECODED file and correct."""
    target, tp_max = S.TARGET_LUFS, S.TARGET_TRUE_PEAK_DBTP
    raw_i, raw_tp = measure_loudness(master)
    gain = target - raw_i
    limit = 0.82  # -1.7 dBFS sample ceiling: leaves room for inter-sample and Opus overshoot
    lufs = tp = None
    iters = 0
    for iters in range(1, 9):
        encode(master, out, gain, limit, "opus")
        lufs, tp = measure_loudness(out)
        if lufs is None or tp is None:
            break
        err = target - lufs
        tp_bad = tp > tp_max - 0.05
        if abs(err) <= 0.15 and not tp_bad:
            break
        if tp_bad:
            limit *= 0.94
        if abs(err) > 0.15:
            gain += err
    if m4a is not None:
        encode(master, m4a, gain, limit, "aac")
    return {"lufs": lufs, "true_peak_dbtp": tp, "gain_db": round(gain, 2), "limiter_ceiling": round(limit, 3),
            "master_lufs": raw_i, "master_true_peak_dbtp": raw_tp, "iterations": iters}


def decode_f32(path: pathlib.Path, rate: int = OPUS_RATE) -> np.ndarray:
    p = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(rate), "-"],
                       capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32)


def mmss(t: float) -> str:
    return f"{int(t // 60):02d}:{t % 60:04.1f}"


def choose_excited_reference() -> dict:
    """Evidence for which excited reference the hype rows clone: the experiment metrics (voice_energy.py -> metrics.json)."""
    return {"chosen": "aussie-hype", "evidence": "the owner's own performed announcer take (Aussie reading, 2026-10-06); no experiment needed"}
    m = read_json(VOICE / "energy/metrics.json")
    if not m:
        return {"chosen": "e4f", "evidence": "metrics.json not found"}
    owner_hz = (m.get("owner_pitch") or {}).get("median_hz")
    out = {}
    for variant in ("e4f", "e4"):
        rows = [t for t in m["takes"] if t["variant"] == variant]
        if not rows:
            continue
        lifts = [S.lift_semitones(t["median_hz"], owner_hz) for t in rows if t.get("median_hz")]
        out[variant] = {"takes": len(rows), "mean_speaker_sim": round(float(np.mean([t["speaker_sim"] for t in rows])), 4),
                        "mean_wer": round(float(np.mean([t["wer"] for t in rows])), 3),
                        "takes_with_wer_0": sum(1 for t in rows if t["wer"] == 0),
                        "mean_pitch_lift_st": round(float(np.mean(lifts)), 2) if lifts else None}
    eligible = {k: v for k, v in out.items() if v["mean_wer"] == 0 and (v["mean_pitch_lift_st"] or 0) >= 2.0}
    chosen = max(eligible, key=lambda k: eligible[k]["mean_speaker_sim"]) if eligible else "e4f"
    return {"chosen": chosen,
            "rule": "zero WER on every experiment take, at least +2 semitones median pitch over the owner (it must sound excited), then best mean speaker similarity",
            "candidates": out, "owner_median_hz": owner_hz}


def lift_stats(rows: list[dict]) -> dict:
    """Median pitch of the picked takes, in semitones over the owner's (an energy proxy), per delivery."""
    out = {}
    for delivery in ("hype", "warm"):
        v = [t["lift_st"] for e in rows if e["delivery"] == delivery for t in e.get("takes", []) if t["picked"] and t["lift_st"] is not None]
        out[delivery] = ({"rows": len(v), "min": round(min(v), 2), "median": round(float(np.median(v)), 2), "max": round(max(v), 2)} if v else None)
    return out


def phase_finish(job: dict, wanted: dict, args) -> None:
    rkeys = {name: ref_key(r) for name, r in refs(args).items()}
    omed = owner_median_hz()
    check = read_json(WORK / "ref-check.json", {})
    info = read_json(WORK / "render-info.json", {})
    out_dir = pathlib.Path(args.export_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (WORK / "masters").mkdir(parents=True, exist_ok=True)
    reel_dir = HOME / "auditions/p1a01"
    reel_dir.mkdir(parents=True, exist_ok=True)
    expect = {f"{row['id']}.ogg" for row in job["rows"]}
    for stale in out_dir.glob("*.ogg"):
        if stale.name not in expect:
            stale.unlink()

    manifest_rows = []
    dtype_used = info.get("dtype")
    for row in job["rows"]:
        takes = row_takes(row, wanted[row["id"]], rkeys, args.dtype, omed)
        best, ok = S.pick_best(takes, row["text"], row["delivery"])
        entry = {"id": row["id"], "moment": row["moment_id"], "variant": row["variant"], "delivery": row["delivery"],
                 "text": row["text"], "reference": refs(args)[ref_for(row["delivery"])]["id"]}
        if row.get("tts_text", row["text"]) != row["text"]:
            entry["tts_text"] = row["tts_text"]
        if best is None:
            entry.update({"file": None, "pass": False, "takes": []})
            manifest_rows.append(entry)
            continue
        dtype_used = dtype_used or best.get("dtype")
        master = WORK / "masters" / f"{row['id']}.wav"
        audio, sr = sf.read(str(take_paths(row["id"], best["seed"])[0]), dtype="float32")
        sf.write(master, trim_silence(audio, sr), sr, subtype="FLOAT")
        ogg = out_dir / f"{row['id']}.ogg"
        m4a = out_dir / f"{row['id']}.m4a" if args.m4a_twin else None
        ex = export_clip(master, ogg, m4a)
        ex_screens = S.screen_export(ex["lufs"], ex["true_peak_dbtp"])
        dur = sf.info(str(ogg)).duration
        entry.update({
            "file": ogg.name, "bytes": ogg.stat().st_size, "sha256": file_sha(ogg), "seconds": round(dur, 3),
            "seed": best["seed"], "candidates": len(takes), "take_screens_pass": ok,
            "screens": {**best["screens"], "export": ex_screens},
            "export": {k: v for k, v in ex.items()}, "pass": bool(ok and ex_screens["pass"]),
            "takes": [{"seed": t["seed"], "picked": t["seed"] == best["seed"], "wer": t.get("wer"), "heard": t.get("heard"),
                       "speaker_sim": t.get("speaker_sim"), "lufs": t.get("raw_lufs"), "true_peak_dbtp": t.get("raw_true_peak_dbtp"),
                       "seconds": t.get("seconds"), "median_hz": t.get("median_hz"), "lift_st": None if t.get("lift_st") is None else round(t["lift_st"], 2),
                       "score": t["score"], "pass": t["screens"]["pass"],
                       "failed": [k for k, v in t["screens"].items() if k != "pass" and not v["pass"]]} for t in takes]})
        if args.m4a_twin:
            entry["file_m4a"] = m4a.name
        manifest_rows.append(entry)
        print(f"finish: {row['id']:16s} seed {best['seed']} wer {best.get('wer')} sim {best.get('speaker_sim')} "
              f"{ex['lufs']:.1f} LUFS {ex['true_peak_dbtp']:.1f} dBTP {'PASS' if entry['pass'] else 'FAIL'}", flush=True)

    # the audition reel: every picked clip in sheet order, a short gap between variants, a longer one between moments
    sr_reel = OPUS_RATE
    pieces, lines, t = [np.zeros(int(0.3 * sr_reel), dtype=np.float32)], [], 0.3
    last_moment = None
    for entry in manifest_rows:
        if not entry.get("file"):
            continue
        if last_moment is not None:
            gap = 0.5 if entry["moment"] == last_moment else 1.2
            pieces.append(np.zeros(int(gap * sr_reel), dtype=np.float32))
            t += gap
        clip = decode_f32(out_dir / entry["file"])
        pt = next(x for x in entry["takes"] if x["picked"])
        lines.append(f"{mmss(t)}  {entry['id']:16s} {entry['delivery']:5s} seed {entry['seed']}  wer {pt['wer']}  "
                     f"sim {pt['speaker_sim']}  {'ok  ' if entry['pass'] else 'FAIL'}  \"{entry['text']}\"")
        pieces.append(clip)
        t += len(clip) / sr_reel
        last_moment = entry["moment"]
    reel_wav = reel_dir / "reel.wav"
    sf.write(reel_wav, np.concatenate(pieces), sr_reel, subtype="FLOAT")
    reel = reel_dir / "audition-reel.ogg"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(reel_wav), "-c:a", "libopus", "-b:a", "64k",
                    "-vbr", "on", "-application", "audio", str(reel)], check=True)
    header = [
        "Audition reel (P1-A01): every picked announcer clip in cue-sheet order, in the owner's cloned voice.",
        f"Gap: 0.5 s between variants of a moment, 1.2 s between moments. Total {mmss(t)}. {len(lines)} clips.",
        "hype rows clone the excited reference (owner's Aussie announcer take); warm rows the owner's own. wer = word error vs the line (0 = word-perfect);",
        "sim = speaker similarity to the owner's reference. These are candidates: the owner's ear overrides any pick.", ""]
    (reel_dir / "audition-reel-index.txt").write_text("\n".join(header + lines) + "\n")

    n_rows = len(manifest_rows)
    passing = sum(1 for e in manifest_rows if e["pass"])
    by_screen = {}
    for name in ("wer", "speaker_sim", "duration", "raw_loudness"):
        by_screen[name] = sum(1 for e in manifest_rows if e.get("screens", {}).get(name, {}).get("pass"))
    by_screen["export_loudness"] = sum(1 for e in manifest_rows if e.get("screens", {}).get("export", {}).get("lufs", {}).get("pass"))
    by_screen["export_true_peak"] = sum(1 for e in manifest_rows if e.get("screens", {}).get("export", {}).get("true_peak", {}).get("pass"))
    manifest = {
        "bead": "P1-A01",
        "generated_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sheet": job["sheet"],
        "model": {"name": MODEL_ID, "dtype": dtype_used,
                  "dtype_note": ("the checkpoint ships in bfloat16, so bfloat16 is its full precision; float32 would need ~7.7 GB of "
                                 "weights and does not fit the 8 GB RTX 2080 SUPER"),
                  "device": "RTX 2080 SUPER 8 GB (eris)", "language": LANGUAGE, "seeds": f"{SEED_BASE}+k, one torch.manual_seed per take",
                  "clone_prompts": info.get("prompts", {}),
                  "asr": "faster-whisper large-v3, float16, beam 5", "speaker_similarity": "cosine of Qwen3-TTS speaker embeddings (first 8 s) vs the owner reference",
                  "loudness": "ffmpeg ebur128 (ITU-R BS.1770 integrated LUFS, 4x-oversampled true peak)"},
        "references": {
            "owner": {"id": "owner-ref-aussie-warm", "use": "warm rows; speaker-similarity target for every row",
                      "sha256_12": ref_key(refs(args)["owner"])[:12], **{k: v for k, v in (check.get("owner") or {}).items() if k in ("seconds", "median_hz", "wer_vs_stored_transcript")},
                      "transcript": "FrankenWhisper (fw transcribe, whisper.cpp backend, ggml-large-v3) on the Mac; the stored transcript matches it, "
                                    "and faster-whisper large-v3 on eris agrees at the WER shown (the text and audio stay private)"},
            "excited": {"id": "excited-ref-aussie-hype", "use": "hype rows",
                        "pipeline": "the owner's own performed announcer take from the Big Aussie Accent - True Blue Version reading (2026-10-06); no voice conversion",
                        "sha256_12": ref_key(refs(args)["excited"])[:12], "text": pathlib.Path(args.excited_ref_text).read_text().strip(),
                        **{k: v for k, v in (check.get("excited") or {}).items() if k in ("seconds", "median_hz", "wer_vs_stored_transcript")},
                        "selection": choose_excited_reference()},
            "by_delivery": {"hype": "excited", "warm": "owner"}},
        "export": {"container": "Ogg/Opus", "codec": "libopus", "bitrate_kbps": OPUS_KBPS, "sample_rate": OPUS_RATE, "channels": 1,
                   "target_lufs": S.TARGET_LUFS, "target_true_peak_dbtp": S.TARGET_TRUE_PEAK_DBTP,
                   "process": "trim silence (-42 dB rel. peak; 60 ms lead, 160 ms tail, 30 ms fade-out) -> gain to target + sample-peak limiter -> libopus -> decode and re-measure, iterate",
                   "m4a_twin": bool(args.m4a_twin)},
        "screens": S.screen_summary(),
        "candidates_per_row": {"requested": args.candidates, "max": args.max_candidates,
                               "rendered_min": min(len(e["takes"]) for e in manifest_rows), "rendered_max": max(len(e["takes"]) for e in manifest_rows)},
        "summary": {"rows": n_rows, "pass": passing, "fail": n_rows - passing, "screen_pass_counts": by_screen,
                    "failing_rows": [e["id"] for e in manifest_rows if not e["pass"]],
                    "picked_pitch_lift_st": lift_stats(manifest_rows),
                    "reel": {"file": "audition-reel.ogg", "seconds": round(t, 1), "bytes": reel.stat().st_size}},
        "rows": manifest_rows,
    }
    write_json(out_dir / "manifest.json", manifest)
    print(f"finish: {passing}/{n_rows} rows pass every screen; reel {reel.stat().st_size / 1e6:.2f} MB, {mmss(t)}", flush=True)
    print("finish: screen pass counts", json.dumps(by_screen), flush=True)


# ---- main -------------------------------------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--job", required=True, help="job JSON written by render_voice.py")
    ap.add_argument("--phase", choices=["all", "render", "asr", "finish"], default="all")
    ap.add_argument("--wanted", help="(internal) JSON of takes wanted per row id")
    ap.add_argument("--candidates", type=int, default=8, help="seeded takes per row in the first round (>= 3)")
    ap.add_argument("--extra", type=int, default=4, help="more seeds for a row with no passing take")
    ap.add_argument("--max-candidates", type=int, default=16, help="stop adding seeds at this many takes per row")
    ap.add_argument("--dtype", choices=["auto", "bf16", "fp32", "fp16"], default="auto")
    ap.add_argument("--only", help="comma-separated moment ids to (re)render; other rows keep their cached takes")
    ap.add_argument("--owner-ref", default=str(VOICE / "aussie/warm.wav"))
    ap.add_argument("--owner-ref-text", default=str(VOICE / "aussie/warm.txt"))
    ap.add_argument("--excited-ref", default=str(VOICE / "aussie/hype.wav"))
    ap.add_argument("--excited-ref-text", default=str(VOICE / "aussie/hype.txt"))
    ap.add_argument("--export-dir", default=str(HOME / "exports/voice"))
    ap.add_argument("--m4a-twin", action="store_true", help="also write an AAC .m4a twin from the same master (Apple hosts)")
    args = ap.parse_args()
    args.passthrough = [a for a in sys.argv[1:]]
    # strip --phase/--wanted so orchestrated children get their own
    cleaned, skip = [], False
    for a in args.passthrough:
        if skip:
            skip = False
            continue
        if a in ("--phase", "--wanted"):
            skip = True
            continue
        cleaned.append(a)
    args.passthrough = cleaned

    if args.candidates < 3:
        ap.error("--candidates must be at least 3")
    job = json.loads(pathlib.Path(args.job).read_text())
    only = set(args.only.split(",")) if args.only else None
    if only:
        unknown = only - {r["moment_id"] for r in job["rows"]}
        if unknown:
            ap.error(f"--only names unknown moments: {sorted(unknown)}")
    job["active"] = [r["id"] for r in job["rows"] if only is None or r["moment_id"] in only]
    WORK.mkdir(parents=True, exist_ok=True)
    wanted = read_json(pathlib.Path(args.wanted)) if args.wanted else None

    if args.phase == "all":
        phase_all(job, args)
        return 0
    if wanted is None:
        wanted = {row["id"]: args.candidates for row in job["rows"]}
    if args.phase == "render":
        phase_render(job, wanted, args)
    elif args.phase == "asr":
        phase_asr(job, wanted, args)
    else:
        phase_finish(job, wanted, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
