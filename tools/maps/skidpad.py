#!/usr/bin/env python3
"""Writes maps/test/skidpad.json (P1-FL04 handling bank): a flat, empty 1 km square of tarmac, so a car can hold a
steady corner at 30 m/s (a 100 m+ radius) without leaving the ground class or meeting a barrier. The route stays the
greybox's (spawns and progress need one); its features, dressing and props are dropped.

Usage: python3 tools/maps/skidpad.py   (then: jj validate maps/test/skidpad.json)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HALF_MM = 500_000
SPACING_MM = 10_000

m = json.loads((ROOT / "maps/greybox-loop.json").read_text())
n = 2 * HALF_MM // SPACING_MM + 1
m["terrain"].update(
    originX=-HALF_MM,
    originZ=-HALF_MM,
    spacing=SPACING_MM,
    cols=n,
    rows=n,
    heights=[0] * (n * n),
    surfaces=["tarmac"] * (n * n),
)
m["features"], m["dressing"], m["props"] = [], [], []
m["header"]["generator"] = {"id": "jj.test.skidpad", "version": "1"}
m["header"]["bounds"].update(minX=-HALF_MM, minZ=-HALF_MM, maxX=HALF_MM, maxZ=HALF_MM)
out = ROOT / "maps/test/skidpad.json"
out.write_text(json.dumps(m, indent=1) + "\n")
print(f"wrote {out.relative_to(ROOT)}")
