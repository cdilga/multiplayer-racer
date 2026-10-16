#!/usr/bin/env python3
"""Writes maps/test/loop.json (br-xlvx.6, Loops): a flat closed track whose main straight carries one vertical loop.

The route (plan view, mm): a main straight along +x at z = 0; at the loop's entry E it jogs diagonally to the exit X
(RUN_OUT on along +x, SHIFT to the driver's left, -z), under the loop; then it carries on along +x, turns through a
hairpin, comes back along -x and turns through a second, wider hairpin onto the start of the main straight. The loop
span (E..X) has no gates, no start grid and no recovery anchor. The loop itself is a Loop feature (crates/jj-map/src/looping.rs,
posed at E facing along the road, yaw 0 = +x) with the params in LOOP below; it carries its own deck from E to X.

Usage: python3 tools/maps/loop.py   (then: jj validate maps/test/loop.json)
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STEP = 2500  # route point spacing on the straights, mm
WIDTH = 14000
RUN_IN = 160_000  # main straight before the loop, mm
RUN_OUT = 32_000  # the loop's run-out along the road (A)
SHIFT = 18_000  # the loop's sideways shift (S): the exit deck clears the entry deck
AFTER = 120_000  # straight after the loop
R1 = 45_000  # first hairpin radius
# The ride lets go of a car slower than 9 m/s: it falls off (crates/jj-map/src/looping.rs).
LOOP = {"radiusMm": 8000, "thicknessMm": 400, "barrierHeightMm": 900, "barrierWidthMm": 400, "segments": 48, "minSpeedMms": 9000}

pts = []


def add(x, z):
    pts.append({"x": round(x), "y": 0, "z": round(z), "width": WIDTH, "bank": 0, "surface": "tarmac"})


# Main straight up to E.
for i in range(RUN_IN // STEP + 1):
    add(i * STEP, 0)
entry = len(pts) - 1
ex, ez = RUN_IN, 0
xx, xz = RUN_IN + RUN_OUT, -SHIFT
# Under the loop: E to X in straight steps.
k = max(2, round(math.hypot(RUN_OUT, SHIFT) / STEP))
for i in range(1, k + 1):
    add(ex + (xx - ex) * i / k, ez + (xz - ez) * i / k)
exit_ = len(pts) - 1
# After the loop along +x.
for i in range(1, AFTER // STEP + 1):
    add(xx + i * STEP, xz)
end_x = xx + AFTER
# Hairpin 1: a half circle towards -z.
n1 = round(math.pi * R1 / STEP)
for i in range(1, n1 + 1):
    a = math.pi * i / n1
    add(end_x + R1 * math.sin(a), xz - R1 + R1 * math.cos(a))
back_z = xz - 2 * R1
# Back along -x to x = 0.
for i in range(1, round(end_x / STEP) + 1):
    add(end_x - i * STEP, back_z)
# Hairpin 2: back up to z = 0, closing the loop at the first point.
R2 = -back_z / 2
n2 = round(math.pi * R2 / STEP)
for i in range(1, n2):
    a = math.pi * i / n2
    add(-R2 * math.sin(a), back_z + R2 - R2 * math.cos(a))

n = len(pts)
LOOP.update(entry=entry, exit=exit_)
# Gates every 20 points outside the loop span, one either side of it; the finish on the main straight before the loop.
at = {i for i in range(5, n, 20) if not (entry - 6 <= i <= exit_ + 6)} | {entry - 5, exit_ + 5, 40}
gates = [{"at": i, "finish": i == 40} for i in sorted(at)]
route = {
    "closed": True,
    "points": pts,
    "gates": gates,
    "start": {"at": 30, "length": 60000, "width": 12000, "rowSpacing": 8000, "columnSpacing": 3500},
    "recovery": [{"from": 0, "to": entry - 2}, {"from": exit_ + 2, "to": n - 1}],
    "segments": [
        {"name": "run-in", "span": {"from": 0, "to": entry}},
        {"name": "loop", "span": {"from": entry + 1, "to": exit_}},
        {"name": "back", "span": {"from": exit_ + 1, "to": n - 1}},
    ],
}
xs = [p["x"] for p in pts]
zs = [p["z"] for p in pts]
pad = 40_000
spacing = 10_000
min_x, max_x = min(xs) - pad, max(xs) + pad
min_z, max_z = min(zs) - pad, max(zs) + pad
cols = (max_x - min_x) // spacing + 1
rows = (max_z - min_z) // spacing + 1
m = {
    "header": {
        "version": "jj.map.v1",
        "generator": {"id": "jj.test.loop", "version": "1"},
        "seed": 0,
        "biomes": ["greybox"],
        "bounds": {"minX": min_x, "minZ": min_z, "maxX": min_x + (cols - 1) * spacing, "maxZ": min_z + (rows - 1) * spacing, "killY": -20000},
        "refLapMs": 40000,
        "gameplayHash": None,
    },
    "terrain": {
        "originX": min_x,
        "originZ": min_z,
        "spacing": spacing,
        "cols": cols,
        "rows": rows,
        "heights": [0] * (cols * rows),
        "surfaces": ["tarmac"] * (cols * rows),
    },
    "route": route,
    "features": [
        {"kind": "loop", "pose": {"x": pts[entry]["x"], "y": 0, "z": pts[entry]["z"], "yaw": 0}, "params": LOOP},
    ],
    "dressing": [],
    "props": [],
}
out = ROOT / "maps/test/loop.json"
out.write_text(json.dumps(m, indent=1) + "\n")
print(f"wrote {out.relative_to(ROOT)}: {n} route points, loop entry {entry}, exit {exit_}; params {json.dumps(LOOP)}")
