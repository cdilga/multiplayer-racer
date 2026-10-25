#!/usr/bin/env python3
"""Canonical Maya1 batch: validate on the Mac, render/audit privately on eris.

python3 tools/audio/maya1.py --estimate
python3 tools/audio/maya1.py --key-file /secure/fal-key
python3 tools/audio/maya1.py --fetch-only

No automatic paid retries. Pending request IDs survive restarts. The local key
is piped over SSH, never put in argv, a job file, or the repository. A GPU lock
protects Whisper. Exports are fetched only when every row passes the screens.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import urllib.request

HERE = Path(__file__).resolve().parent
REMOTE = "Work/dev/jammers-audio"
# Orthographic variants only: these are the same spoken word. Preserve the raw
# ASR transcript alongside the score; never alias a different word or brand.
ASR_SPELLINGS = {"neighborhood":"neighbourhood"}


def score_wer(reference, hypothesis):
    import voice_screens as screens
    def canonical(text):
        for spelling, replacement in ASR_SPELLINGS.items():
            text = re.sub(r"\b" + spelling + r"\b", replacement, text, flags=re.IGNORECASE)
        return text
    return screens.wer(canonical(reference), canonical(hypothesis))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(obj, indent=2) + "\n")
    temp.replace(path)


def identity(path):
    data = json.loads(path.read_text())
    actual = digest(json.dumps(data["recipe"], sort_keys=True, separators=(",", ":")).encode())
    if actual != data["recipe_sha256"]:
        raise ValueError("Voice recipe changed without updating its identity hash")
    return data


def cache_key(row, voice):
    return digest(json.dumps({"text": row["text"], "recipe": voice["recipe_sha256"]}, sort_keys=True).encode())


def credential(args):
    value = os.environ.get("FAL_KEY", "")
    if not value and args.key_file:
        text = Path(args.key_file).expanduser().read_text()
        lines = [s.strip() for s in text.splitlines() if s.strip() and not s.lstrip().startswith("#")]
        line = next((s for s in lines if re.match(r"(?:export\s+)?FAL_KEY\s*=", s)), lines[0] if len(lines) == 1 else "")
        value = line.split("=", 1)[1] if re.match(r"(?:export\s+)?FAL_KEY\s*=", line) else line
    if not value and sys.platform == "darwin":
        saved = subprocess.run(["security", "find-generic-password", "-s", "fal-api-key", "-w"],
                               capture_output=True, text=True)
        if saved.returncode == 0:
            value = saved.stdout.strip()
    value = value.strip().strip("\"'")
    if not value:
        raise ValueError("FAL_KEY missing: configure environment or --key-file (never paste it into chat)")
    return value


def request(url, key, body=None):
    headers = {"Authorization": "Key " + key, "Content-Type": "application/json", "User-Agent": "jammers-maya1/1"}
    req = urllib.request.Request(url, None if body is None else json.dumps(body).encode(), headers)
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.load(response)


def generate(row, voice, key, rawdir):
    token = cache_key(row, voice)
    folder = rawdir / row["id"] / token
    folder.mkdir(parents=True, exist_ok=True)
    raw, pending = folder / "raw.wav", folder / "request.json"
    if raw.exists():
        return raw
    if pending.exists():
        sub = json.loads(pending.read_text())
    else:
        recipe = voice["recipe"]
        payload = {k: v for k, v in recipe.items() if k != "endpoint"}
        payload["text"] = row["text"]  # no inherited Qwen respellings
        sub = request("https://queue.fal.run/" + recipe["endpoint"], key, payload)
        write(pending, {k: sub[k] for k in ("request_id", "status_url", "response_url")})
    deadline = time.monotonic() + 7200
    while time.monotonic() < deadline:
        state = request(sub["status_url"], key)
        if state.get("status") == "COMPLETED":
            result = request(sub["response_url"], key)
            # Record completion before download: an interrupted download is resumed
            # by fetching the same completed request, never by paying again.
            write(folder / "result.json", result)
            with urllib.request.urlopen(result["audio"]["url"], timeout=180) as response:
                temp = raw.with_suffix(".part")
                temp.write_bytes(response.read())
                temp.replace(raw)
            print("generated", row["id"], flush=True)
            return raw
        if state.get("status") not in ("IN_QUEUE", "IN_PROGRESS"):
            raise RuntimeError("Unexpected provider status for " + row["id"])
        time.sleep(5)
    raise RuntimeError("Queue timeout; rerun to resume existing requests")


def cached_paths(rows, voice, rawdir):
    paths = [rawdir / row["id"] / cache_key(row, voice) / "raw.wav" for row in rows]
    missing = [row["id"] for row, path in zip(rows, paths) if not path.is_file()]
    if missing:
        raise ValueError("Cached-only audit is missing takes: " + ", ".join(missing))
    return paths


def worker(args):
    import fcntl
    import numpy as np
    import soundfile as sf
    from voice_render_eris import export_clip, measure_loudness, trim_silence
    import voice_screens as screens

    voice = identity(args.config)
    job = json.loads(args.job.read_text())
    base = Path.home() / REMOTE
    rawdir = base / "private/voice/maya1" / args.batch
    out = base / "exports" / args.batch
    out.mkdir(parents=True, exist_ok=True)
    key = "" if args.local or args.cached_only else sys.stdin.read().strip()
    rows = [dict(r, tts_text=r["text"]) for r in job["rows"]]
    ids = [r["id"] for r in rows]
    if not ids or len(set(ids)) != len(ids) or any(not re.fullmatch(r"[a-z0-9-]+", i) for i in ids):
        raise ValueError("Empty, duplicate or unsafe cue IDs")
    backend = {"name":"fal.ai", "endpoint":voice["recipe"]["endpoint"]}
    if args.cached_only:
        raws = cached_paths(rows, voice, rawdir)
    elif args.local:
        from maya1_local import render
        raws, backend = render(rows, voice, rawdir)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            raws = list(pool.map(lambda r: generate(r, voice, key, rawdir), rows))
    # GPU use is only ASR: Maya1 itself runs on fal.ai.
    heard, asr_models = {}, set()
    with (base / ".gpu.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        os.environ.setdefault("HF_HOME", str(base / "hf-cache"))
        from faster_whisper import WhisperModel
        # ctranslate2 needs CUDA12 libraries; torch in this shared venv uses
        # CUDA13, so importing torch alone does not expose the matching SONAMEs.
        import ctypes
        libroot = Path(sys.prefix) / "lib/python3.12/site-packages/nvidia"
        for lib in [libroot/"cublas/lib/libcublasLt.so.12", libroot/"cublas/lib/libcublas.so.12",
                    libroot/"cudnn/lib/libcudnn.so.9"]:
            if lib.exists():
                ctypes.CDLL(str(lib), mode=ctypes.RTLD_GLOBAL)
        asr = None
        for row, raw in zip(rows, raws):
            record = raw.with_name("asr.json")
            sha = digest(raw.read_bytes())
            if record.exists() and (cached := json.loads(record.read_text())).get("raw_sha256") == sha:
                heard[row["id"]] = cached["text"]
                asr_models.add(cached["model"])
                continue
            if asr is None:
                asr = WhisperModel("large-v3", device="cuda", compute_type="float16")
            # Match the existing Qwen audit path: ffmpeg -> 16k float samples.
            # This avoids PyAV/faster-whisper metadata_errors version mismatch.
            pcm = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(raw), "-ar", "16000", "-ac", "1", "-f", "f32le", "-"])
            segs, _ = asr.transcribe(np.frombuffer(pcm, dtype=np.float32), language="en", beam_size=5, condition_on_previous_text=False)
            transcript = " ".join(s.text.strip() for s in segs)
            model = "faster-whisper large-v3 float16 beam5"
            write(record, {"text": transcript, "raw_sha256": sha, "model": model})
            asr_models.add(model)
            heard[row["id"]] = transcript
            print("transcribed", row["id"], flush=True)
        del asr
    exported = []
    reel, index, offset = [], [], 0.0
    for row, raw in zip(rows, raws):
        audio, sr = sf.read(raw, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        duration = len(audio) / sr
        raw_i, raw_tp = measure_loudness(raw)
        words = len(screens.words(row["text"]))
        lo, hi = 0.4 + .15 * words, 2.0 + .6 * words
        wer = score_wer(row["text"], heard[row["id"]])
        master = raw.with_name("master.wav")
        sf.write(master, trim_silence(audio, sr), sr, subtype="PCM_24")
        target = out / (row["id"] + ".ogg")
        metrics = export_clip(master, target, None)
        checks = {"wer": wer == 0, "duration": lo <= duration <= hi,
                  "raw_loudness": raw_i is not None and raw_i >= -45 and raw_tp is not None and raw_tp <= 0,
                  "export_loudness": metrics["lufs"] is not None and abs(metrics["lufs"] + 16) <= 1,
                  "export_true_peak": metrics["true_peak_dbtp"] is not None and metrics["true_peak_dbtp"] <= -1}
        final, final_sr = sf.read(target, dtype="float32")
        if final_sr != 48000 or final.ndim != 1 or not np.any(final):
            raise ValueError("Invalid decoded export: " + row["id"])
        item = dict(row, moment=row.get("moment_id"), canonical_voice_id=voice["canonical_voice_id"],
                    file=target.name, sha256=digest(target.read_bytes()), bytes=target.stat().st_size,
                    seconds=round(len(final) / final_sr, 3), raw_sha256=digest(raw.read_bytes()),
                    raw_seconds=round(duration, 3), raw_lufs=raw_i, raw_true_peak_dbtp=raw_tp,
                    heard=heard[row["id"]], asr=json.loads(raw.with_name("asr.json").read_text()), wer=round(wer, 4), export=metrics,
                    screens=checks, **{"pass": all(checks.values())})
        exported.append(item)
        index.append({"start_s":round(offset,3), "id":row["id"], "text":row["text"]})
        reel.extend([final, np.zeros(24000, dtype=np.float32)])
        offset += len(final) / 48000 + .5
        print(row["id"], "PASS" if item["pass"] else "FLAGGED", checks, flush=True)
    sf.write(out / "audition-reel.wav", np.concatenate(reel), 48000, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(out / "audition-reel.wav"), "-c:a", "libopus", "-b:a", "64k", str(out / "audition-reel.ogg")], check=True)
    write(out / "audition-index.json", index)
    manifest = {"canonical_voice_id":voice["canonical_voice_id"], "voice":voice,
                "generated_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "sheet":job["sheet"], "model":{"name":"Maya1", "backend":backend},
                "asr":{"models":sorted(asr_models), "note":"automated sanity check, not listening approval"},
                "asr_spelling_normalization":ASR_SPELLINGS,
                "speaker_similarity":"not applicable: Maya1 is prompt-defined, not an owner clone",
                "summary":{"rows":len(rows), "pass":sum(r["pass"] for r in exported),
                           "fail":sum(not r["pass"] for r in exported), "failing_rows":[r["id"] for r in exported if not r["pass"]]},
                "cost_usd_estimate":0 if args.local else round(sum(r["raw_seconds"] for r in exported)*.002, 4), "rows":exported}
    write(out / "manifest.json", manifest)
    return 0 if manifest["summary"]["fail"] == 0 else 4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file")
    parser.add_argument("--config", type=Path, default=HERE / "maya1-voice.json")
    parser.add_argument("--job", type=Path)
    parser.add_argument("--batch", default="maya1-gameplay")
    parser.add_argument("--estimate", action="store_true")
    parser.add_argument("--fetch-only", action="store_true")
    parser.add_argument("--cached-only", action="store_true", help="audit existing fal.ai raw takes; no key or paid requests")
    parser.add_argument("--review-only", action="store_true", help="fetch review exports without replacing game assets")
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--local", action="store_true", help="non-quantized Maya1 on eris; no API key or spend")
    args = parser.parse_args()
    if args.local and args.cached_only:
        parser.error("--cached-only audits the fal.ai cache; do not combine with --local")
    if not re.fullmatch(r"[a-z0-9-]+", args.batch):
        parser.error("Unsafe batch name")
    if args.worker:
        return worker(args)
    voice = identity(args.config)
    from check_cues import check_sheet, DEFAULT_SHEET
    if args.job:
        job = json.loads(args.job.read_text())
        sheet = HERE.parents[1] / job["sheet"]["path"]
        checked = check_sheet(sheet, rows_only=True)
        if digest(sheet.read_bytes()) != job["sheet"]["sha256"] or [r["text"] for r in checked.rows] != [r["text"] for r in job["rows"]]:
            raise ValueError("Job differs from its validated sheet")
    else:
        checked = check_sheet(DEFAULT_SHEET)
        job = {"sheet":{"path":"tools/audio/cues-playtest1.tsv", "sha256":digest(DEFAULT_SHEET.read_bytes()), "rows":len(checked.rows)},
               "rows":[dict(r, id=f'{r["moment_id"]}-{r["variant"]}') for r in checked.rows]}
    if checked.problems:
        raise ValueError("Cue sheet failed validation: " + str(checked.problems))
    estimate = sum(len(r["text"]) for r in job["rows"]) / 13 * .002
    print(f'{len(job["rows"])} lines; {voice["canonical_voice_id"]}; estimated ${estimate:.2f} at $0.002/generated second')
    if args.estimate:
        return 0
    root = HERE.parents[1]
    local = root / "private/voice" / args.batch
    local.mkdir(parents=True, exist_ok=True)
    write(local / "job.json", job)
    remote_dir = f"{REMOTE}/jobs/{args.batch}"
    ssh = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "eris"]
    if not args.fetch_only:
        key = "" if args.local or args.cached_only else credential(args)
        subprocess.run([*ssh, "mkdir -p " + shlex.quote(remote_dir)], check=True)
        subprocess.run(["rsync", "-a", str(local / "job.json"), str(args.config), str(Path(__file__)),
                        str(HERE / "voice_render_eris.py"), str(HERE / "voice_screens.py"), "eris:" + remote_dir + "/"], check=True)
        if args.local:
            subprocess.run(["rsync", "-a", str(HERE / "maya1_local.py"), str(HERE / "maya1-local-run.sh"), "eris:" + remote_dir + "/"], check=True)
        cmd = f"~/{REMOTE}/.venv/bin/python ~/{remote_dir}/maya1.py --worker --batch {args.batch} --job ~/{remote_dir}/job.json --config ~/{remote_dir}/{args.config.name}"
        if args.local:
            cmd = f"bash ~/{remote_dir}/maya1-local-run.sh ~/{remote_dir}/maya1.py --worker --batch {args.batch} --job ~/{remote_dir}/job.json --config ~/{remote_dir}/{args.config.name} --local"
        if args.cached_only:
            cmd += " --cached-only"
        cuda12 = "/home/cdilga/Work/dev/jammers-audio/.venv/lib/python3.12/site-packages/nvidia"
        cmd = f"env LD_LIBRARY_PATH={cuda12}/cublas/lib:{cuda12}/cudnn/lib " + cmd
        result = subprocess.run([*ssh, cmd], input=key, text=True)
        if result.returncode not in (0, 4):
            print("Generation/audit incomplete; existing game assets unchanged. Private results remain on eris.", file=sys.stderr)
            return result.returncode
    subprocess.run(["rsync", "-a", f"eris:{REMOTE}/exports/{args.batch}/", str(local / "review") + "/"], check=True)
    manifest = json.loads((local / "review/manifest.json").read_text())
    if manifest["voice"]["recipe_sha256"] != voice["recipe_sha256"] or manifest["sheet"] != job["sheet"]:
        raise ValueError("Refusing installation: wrong recipe/sheet; inspect private review")
    expected = [r["id"] for r in job["rows"]]
    if [r["id"] for r in manifest["rows"]] != expected:
        raise ValueError("Refusing incomplete batch")
    for row in manifest["rows"]:
        file = local / "review" / row["file"]
        if digest(file.read_bytes()) != row["sha256"]:
            raise ValueError("Export hash mismatch")
    if args.review_only:
        print("Private review only:", local / "review", manifest["summary"])
        return 4 if manifest["summary"]["fail"] else 0
    if manifest["summary"]["fail"]:
        raise ValueError("Refusing installation: flagged rows; inspect private review")
    import shutil
    output = root / "assets/audio/voice"
    for row in manifest["rows"]:
        shutil.copyfile(local / "review" / row["file"], output / row["file"])
    name = "promo-manifest.json" if args.job else "manifest.json"
    shutil.copyfile(local / "review/manifest.json", output / name)
    print("Installed", len(expected), "Maya1 clips; private review:", local / "review")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Network bodies and URLs may contain credentials: report only type.
        if isinstance(error, (ValueError, FileNotFoundError)):
            sys.exit(str(error))
        sys.exit("Maya1 failed (" + type(error).__name__ + "); existing requests are resumable")
