#!/usr/bin/env python3
"""Writes maps/test/surface-strips.json (P1-S03a `surface-deltas`): the greybox with the ground along its main straight
(x 0..160 m, z -20..20 m) cut into four 40 m strips: tarmac, packed dirt, gravel, rock. Cars on each strip run the
same input, so the grip multipliers show up side by side. The route and everything else stay the greybox's.

Usage: python3 tools/maps/surface_strips.py   (then: jj validate maps/test/surface-strips.json)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STRIPS = [(0, 40, "tarmac"), (40, 80, "packed-dirt"), (80, 120, "gravel"), (120, 160, "rock")]
Z_HALF = 20

m = json.loads((ROOT / "maps/greybox-loop.json").read_text())
t = m["terrain"]
spacing = t["spacing"] / 1000
for row in range(t["rows"]):
    z = t["originZ"] / 1000 + row * spacing
    if abs(z) > Z_HALF:
        continue
    for col in range(t["cols"]):
        x = t["originX"] / 1000 + col * spacing
        for lo, hi, surface in STRIPS:
            if lo <= x < hi:
                t["surfaces"][row * t["cols"] + col] = surface
m["header"]["generator"] = {"id": "jj.test.surface-strips", "version": "1"}
out = ROOT / "maps/test/surface-strips.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(m, indent=1) + "\n")
print(f"wrote {out.relative_to(ROOT)}")
