#!/usr/bin/env python3
"""Render the 8 audition cues for each enrolled .ftvoice with ftts say (Mac, CPU, 0.6B int8). Usage: render_ftts.py REF [REF...]
Reads private/p1a01b/ftvoice/<REF>.ftvoice, writes private/p1a01b/ftts/<REF>/<cue>.wav and ftts/timings.json."""
import json, pathlib, re, subprocess, sys, time
root = pathlib.Path(__file__).resolve().parents[3] / "private/p1a01b"
cues = json.loads((pathlib.Path(__file__).parent / "cues.json").read_text())
timings = json.loads((root / "ftts/timings.json").read_text()) if (root / "ftts/timings.json").exists() else {}
for ref in sys.argv[1:]:
    d = root / "ftts" / ref; d.mkdir(parents=True, exist_ok=True)
    for cue, text in cues.items():
        out = d / f"{cue}.wav"
        if out.exists(): continue
        text = re.sub(r"(?<![A-Za-z'])G'day(?![A-Za-z'])", "Gidday", text)  # the same TTS respelling the eris pipeline uses
        t = time.time()
        subprocess.run(["ftts", "say", "--voice", str(root / f"ftvoice/{ref}.ftvoice"), text, str(out)], check=True, capture_output=True)
        timings[f"{ref}/{cue}"] = round(time.time() - t, 1)
        print(ref, cue, timings[f"{ref}/{cue}"], "s", flush=True)
(root / "ftts/timings.json").write_text(json.dumps(timings, indent=1))
