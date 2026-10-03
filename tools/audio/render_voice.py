#!/usr/bin/env python3
"""render_voice.py: regenerate the announcer voice from the cue sheet with ONE command (P1-A01).

    tools/audio/render_voice.py --sheet tools/audio/cues-playtest1.tsv

What it does, in order:
  1. Runs A00's `check_sheet` on the sheet. A sheet that breaks a rule is REFUSED (exit 1, each problem
     printed as `file:line: [code] message`) and nothing is sent to eris.
  2. Syncs the scripts (voice_render_eris.py, voice_screens.py, voice_clone.py, voice_energy.py) and the job
     (the validated rows) to eris, and runs the worker there under the GPU lock (one GPU job at a time):
     clone prompts built once and reused, N seeded takes per row, Whisper WER + speaker similarity +
     loudness screens, the pick rule, Ogg/Opus export at -16 LUFS / -1 dBTP, manifest.json, audition reel.
     Renders are cached on eris by (text, reference, seed, model, dtype), so a rerun only renders what changed.
  3. Copies the picked clips + manifest.json back to assets/audio/voice/, and the reel, its index and a copy of
     manifest.json to docs/evidence/P1-A01/ (the reel stays on eris if it is over --reel-max-mb).
  4. Prints the per-screen pass counts and every failing row. Exit 0 when every row passes every screen,
     4 when a row still fails after the extra seeds (the owner's ear, or a repair bead, takes it from there).

Private references, clone prompts, weights and all non-picked takes stay on eris (R89); only the exports and
the manifest come back. Needs `ssh eris` working non-interactively.

Options: --candidates N (8), --extra N, --max-candidates N, --only moment[,moment] (re-render just those;
other rows keep their cached takes), --m4a-twin (AAC twin for Apple hosts), --dry-run (validate and show the
plan), --fetch-only (copy the latest results back without rendering), --force (run even if the GPU is busy).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
from check_cues import DEFAULT_SHEET, check_sheet  # noqa: E402
import voice_screens  # noqa: E402

REMOTE_HOME = "Work/dev/jammers-audio"  # relative to ~ on eris (JJ_AUDIO_HOME)
SYNC_FILES = ["voice_render_eris.py", "voice_screens.py", "voice_clone.py", "voice_energy.py"]
DEFAULT_OUT = REPO / "assets/audio/voice"
DEFAULT_EVIDENCE = REPO / "docs/evidence/P1-A01"


def rel(p: Path) -> str:
    try:
        return str(p.resolve().relative_to(REPO))
    except ValueError:
        return str(p)


def build_job(result, sheet: Path) -> dict:
    """The validated rows, in sheet order, in the shape the eris worker reads."""
    rows = []
    for r in result.rows:
        row = {"id": f"{r['moment_id']}-{r['variant']}", "moment_id": r["moment_id"], "variant": int(r["variant"]),
               "text": r["text"], "delivery": r["delivery"], "trigger_event": r["trigger_event"]}
        spoken = voice_screens.tts_text(r["text"])
        if spoken != r["text"]:
            row["tts_text"] = spoken  # what the TTS is told to say; the screens still score the sheet's text
        rows.append(row)
    return {"sheet": {"path": rel(sheet), "sha256": hashlib.sha256(sheet.read_bytes()).hexdigest(), "rows": len(rows)},
            "rows": rows}


def ssh(host: str, command: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", host, command],
                          check=check, text=True, capture_output=capture)


def worker_command(args, only: str | None) -> str:
    """The shell command (for sh) that runs the eris worker under the shared GPU lock."""
    parts = [".venv/bin/python", "bin/voice_render_eris.py", "--job", "jobs/p1a01-job.json", "--candidates", str(args.candidates),
             "--extra", str(args.extra), "--max-candidates", str(args.max_candidates)]
    if only:
        parts += ["--only", only]
    if args.m4a_twin:
        parts.append("--m4a-twin")
    env = "env HF_HOME=$PWD/hf-cache PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True"
    # flock: voice and music jobs share one lock, so the 8 GB GPU only ever runs one of them
    return f"flock -w 7200 .gpu.lock {env} " + " ".join(shlex.quote(p) for p in parts)


def sh(host: str, script: str, capture: bool = True, check: bool = True) -> subprocess.CompletedProcess:
    """Run a POSIX sh script on eris (whatever the login shell is)."""
    return ssh(host, "sh -c " + shlex.quote(script), check=check, capture=capture)


def start_detached(host: str, args, only: str | None) -> None:
    """Start the worker on eris detached from this ssh session (an hour-long job must survive a dropped
    connection or a sleeping laptop); its log is logs/p1a01.log and its exit code logs/p1a01.exit."""
    inner = f"{worker_command(args, only)} > logs/p1a01.log 2>&1; echo $? > logs/p1a01.exit"
    sh(host, f"cd ~/{REMOTE_HOME} && mkdir -p jobs logs && rm -f logs/p1a01.exit && "
             f"(setsid nohup sh -c {shlex.quote(inner)} > /dev/null 2>&1 < /dev/null &)")


NOISE = ("pad_token_id", "flash-attn", "Fetching ", "********")


def follow(host: str, poll_s: float = 15.0) -> int:
    """Stream the worker's log until it writes its exit code; returns that code. Survives ssh hiccups."""
    offset, failures = 0, 0
    while True:
        script = (f"cd ~/{REMOTE_HOME}; n=$(stat -c %s logs/p1a01.log 2>/dev/null || echo 0); echo @@SIZE@@$n; "
                  f"tail -c +{offset + 1} logs/p1a01.log 2>/dev/null | head -c $((n - {offset})); echo; "
                  f"echo @@EXIT@@$(cat logs/p1a01.exit 2>/dev/null)")
        try:
            out = sh(host, script).stdout
            failures = 0
        except subprocess.CalledProcessError:
            failures += 1
            if failures > 40:
                print("render_voice: lost contact with eris; the worker keeps running there (re-run with --fetch-only later)", file=sys.stderr)
                return 3
            time.sleep(poll_s)
            continue
        head, _, rest = out.partition("@@SIZE@@")
        size_s, _, body = rest.partition("\n")
        body, _, tail = body.rpartition("@@EXIT@@")
        offset = int(size_s) if size_s.strip().isdigit() else offset
        for line in body.splitlines():
            if line.strip() and not any(n in line for n in NOISE):
                print(line, flush=True)
        code = tail.strip()
        if code != "":
            return int(code)
        time.sleep(poll_s)


def fetch(host: str, out: Path, evidence: Path, reel_max_mb: float) -> None:
    out.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)
    subprocess.run(["rsync", "-a", "--delete", "--include=*.ogg", "--include=*.m4a", "--include=manifest.json", "--exclude=*",
                    f"{host}:{REMOTE_HOME}/exports/voice/", f"{out}/"], check=True)
    subprocess.run(["rsync", "-a", f"{host}:{REMOTE_HOME}/auditions/p1a01/audition-reel-index.txt", f"{evidence}/"], check=True)
    shutil.copyfile(out / "manifest.json", evidence / "manifest.json")  # the bead's evidence copy; assets/ keeps the one A03 reads
    size = ssh(host, f"stat -c %s ~/{REMOTE_HOME}/auditions/p1a01/audition-reel.ogg", capture=True).stdout.strip()
    mb = int(size) / 1e6
    if mb <= reel_max_mb:
        subprocess.run(["rsync", "-a", f"{host}:{REMOTE_HOME}/auditions/p1a01/audition-reel.ogg", f"{evidence}/"], check=True)
        print(f"fetched reel {mb:.2f} MB -> {rel(evidence)}/audition-reel.ogg")
    else:
        print(f"reel is {mb:.1f} MB (> {reel_max_mb} MB): kept on {host}:{REMOTE_HOME}/auditions/p1a01/audition-reel.ogg; index fetched")


def summarise(out: Path) -> int:
    manifest = json.loads((out / "manifest.json").read_text())
    for e in manifest["rows"]:
        if e.get("file"):
            local = out / e["file"]
            if not local.exists() or hashlib.sha256(local.read_bytes()).hexdigest() != e["sha256"]:
                print(f"MISMATCH: {e['file']} does not match the manifest checksum", file=sys.stderr)
                return 5
    s = manifest["summary"]
    print(f"\n{s['pass']}/{s['rows']} rows pass every screen "
          f"(model {manifest['model']['name']} {manifest['model']['dtype']}; excited reference "
          f"{manifest['references']['excited']['selection']['chosen']})")
    for name, n in s["screen_pass_counts"].items():
        print(f"  {name:16s} {n}/{s['rows']}")
    if s["failing_rows"]:
        print("failing rows: " + ", ".join(s["failing_rows"]))
        return 4
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sheet", default=str(DEFAULT_SHEET))
    ap.add_argument("--candidates", type=int, default=8, help="seeded takes per row (at least 3)")
    ap.add_argument("--extra", type=int, default=4, help="more seeds for a row that has no passing take")
    ap.add_argument("--max-candidates", type=int, default=16)
    ap.add_argument("--only", help="comma-separated moment ids to (re)render")
    ap.add_argument("--m4a-twin", action="store_true", help="also write an AAC .m4a twin (Apple hosts, if A03 finds Opus fails there)")
    ap.add_argument("--host", default="eris")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="where the clips + manifest.json land")
    ap.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="where the reel + index land")
    ap.add_argument("--reel-max-mb", type=float, default=20.0)
    ap.add_argument("--dry-run", action="store_true", help="validate the sheet and print the plan; touch nothing")
    ap.add_argument("--fetch-only", action="store_true", help="copy the latest results from eris; do not render")
    ap.add_argument("--force", action="store_true", help="run even if something else is using the GPU")
    args = ap.parse_args(argv)
    if args.candidates < 3:
        ap.error("--candidates must be at least 3")

    sheet = Path(args.sheet).resolve()
    try:
        result = check_sheet(sheet)
    except OSError as exc:
        print(f"render_voice: cannot read the sheet: {exc}", file=sys.stderr)
        return 2
    if result.problems:
        for p in result.problems:
            print(p, file=sys.stderr)
        print(f"REFUSED: {len(result.problems)} problem(s) in {result.sheet}; nothing was sent to {args.host}", file=sys.stderr)
        return 1

    job = build_job(result, sheet)
    only = args.only
    if only:
        unknown = set(only.split(",")) - {r["moment_id"] for r in job["rows"]}
        if unknown:
            print(f"render_voice: --only names moments not in the sheet: {sorted(unknown)}", file=sys.stderr)
            return 2
    hype = sum(1 for r in job["rows"] if r["delivery"] == "hype")
    print(f"sheet OK: {len(job['rows'])} rows ({hype} hype, {len(job['rows']) - hype} warm), "
          f"{args.candidates} takes each (+{args.extra} per failing row up to {args.max_candidates})")
    if args.dry_run:
        print("dry run: nothing sent")
        return 0

    out, evidence = Path(args.out), Path(args.evidence)
    if not args.fetch_only:
        try:
            ssh(args.host, "true", capture=True)
        except subprocess.CalledProcessError as exc:
            print(f"render_voice: cannot ssh to {args.host}: {exc.stderr or exc}", file=sys.stderr)
            return 3
        used = ssh(args.host, "nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits", capture=True).stdout.strip()
        if used.isdigit() and int(used) > 1500 and not args.force:
            print(f"render_voice: the GPU on {args.host} is in use ({used} MiB); wait for it or pass --force", file=sys.stderr)
            return 3
        with tempfile.TemporaryDirectory() as d:
            jobfile = Path(d) / "p1a01-job.json"
            jobfile.write_text(json.dumps(job, indent=1))
            subprocess.run(["rsync", "-a", *[str(HERE / f) for f in SYNC_FILES], f"{args.host}:{REMOTE_HOME}/bin/"], check=True)
            sh(args.host, f"mkdir -p ~/{REMOTE_HOME}/jobs")
            subprocess.run(["rsync", "-a", str(jobfile), f"{args.host}:{REMOTE_HOME}/jobs/"], check=True)
        print(f"== rendering on {args.host} (detached; log {REMOTE_HOME}/logs/p1a01.log) ...", flush=True)
        start_detached(args.host, args, only)
        rc = follow(args.host)
        if rc != 0:
            print(f"render_voice: the worker on {args.host} failed (exit {rc}); re-run to resume from its cache", file=sys.stderr)
            return 3
    fetch(args.host, out, evidence, args.reel_max_mb)
    return summarise(out)


if __name__ == "__main__":
    sys.exit(main())
