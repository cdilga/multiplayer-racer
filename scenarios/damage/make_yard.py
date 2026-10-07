#!/usr/bin/env python3
"""Builds scenarios/damage/yard.json: the greybox loop with its dressing and props replaced by the damage bank's test
objects, standing in the free ground south of the route (z < -12). Run from the repo root; the output is committed.

Objects (cars drive along +x at z = -30 unless a scenario says otherwise):
  wall     a 3 m high, 2 m thick, 14 m long barrier across the lane at x = 40 (face at x = 39), for head-on hits;
  kerb-end a 0.9 m high barrier, 8 m long, lying along x with its west end face at x = 100, offset in z so a car's
           left wheel meets the end face (wheel strike, nothing else of the body in the way).
"""
import json

d = json.load(open("maps/greybox-loop.json"))
d["dressing"] = [
    {
        "kitPiece": "generic/barrier",
        "pose": {"x": 40000, "y": 0, "z": -30000, "yaw": 9000},
        "params": {"lengthMm": 14000, "heightCm": 300, "thicknessMm": 2000},
        "collides": True,
    },
    {
        "kitPiece": "generic/barrier",
        "pose": {"x": 104000, "y": 0, "z": -31180, "yaw": 0},
        "params": {"lengthMm": 8000, "heightCm": 90, "thicknessMm": 440},
        "collides": True,
    },
]
d["props"] = []
d["header"]["gameplayHash"] = None
json.dump(d, open("scenarios/damage/yard.json", "w"), indent=1)
open("scenarios/damage/yard.json", "a").write("\n")
