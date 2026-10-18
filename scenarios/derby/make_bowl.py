#!/usr/bin/env python3
"""Builds scenarios/derby/bowl-containment.json and bowl-transition.json (P1-M10) from maps/derby-bowl-16.json. Run from the
repo root after `JJ_BLESS=1 cargo test -p jj-procgen --test arena`; the outputs are committed.

bowl-containment: rams at the rim from many angles and speeds, boosted, and airborne, never put a car outside. 36 cars on the
16-car arena: 24 on the floor (every 15 degrees, two rings so their lines interleave, heading 0/25/55 degrees off the
radial, 12..50 m/s, boost on alternate cars, a little steer on some) and 12 airborne (3 m up, flung up at 6..14 m/s, which
is the design envelope in jj_map::arena::limits, outward at 15..45 m/s). Each must stay within the wall's face plus 0.75 m
(`maxRadiusM`: a car pressed to the wall has its origin inside the wall's skin; a car over the lip is metres past it).

bowl-transition: three cars roll up the bank from the floor's flat rim with no throttle at 6, 10 and 15 m/s: each reaches the bank,
leaves the ground for no more than 0.15 s, never tips over (minUpY), and is back down on the floor at the end (not caught; a dip in the field counts as the floor).
"""
import json
import math

m = json.load(open("maps/derby-bowl-16.json"))
bowl = next(f for f in m["features"] if f["kind"] == "bowl")["params"]
floor_r = bowl["floorRadiusMm"] / 1000
wall_r = floor_r + bowl["bankRadiusMm"] / 1000
limit = round(wall_r + 0.75, 2)


def heading(angle_deg, off_deg=0.0):
    """Sim heading (0 = +z, forward = (sin h, cos h)) for the outward direction at `angle_deg`, `off_deg` turned."""
    a = math.radians(angle_deg)
    return math.degrees(math.atan2(math.cos(a), math.sin(a))) + off_deg


def car(r, angle_deg, y, off_deg, speed, up=0.0):
    h = math.radians(heading(angle_deg, off_deg))
    a = math.radians(angle_deg)
    return {
        "pose": {
            "x": round(r * math.cos(a), 3),
            "y": y,
            "z": round(r * math.sin(a), 3),
            "headingDeg": round(math.degrees(h), 3),
        },
        "linvel": [round(speed * math.sin(h), 3), up, round(speed * math.cos(h), 3)],
    }


cars, inputs = [], []
speeds = [12, 24, 36, 50]
offs = [0, 25, -25, 55, -55, 0]
for k in range(24):
    ring = 0.28 if k % 2 == 0 else 0.55
    cars.append(car(floor_r * ring, k * 15 + 3, 0.5, offs[k % 6], speeds[(k // 2) % 4]))
    inputs.append(
        {
            "car": k,
            "fromTick": 0,
            "throttle": 1.0,
            "steer": [0.0, 0.2, -0.2][k % 3],
            "boost": k % 2 == 1,
        }
    )
for j in range(12):
    k = 24 + j
    cars.append(
        car(floor_r * (0.4 if j % 2 == 0 else 0.62), j * 30 + 11, 3.0, 0, [15, 30, 45][j % 3], up=[6, 10, 14][(j // 3) % 3])
    )
    inputs.append({"car": k, "fromTick": 0, "throttle": 1.0, "boost": j % 2 == 0})

containment = {
    "scenario": "bowl-containment",
    "what": "P1-M10: rams at the rim from many angles and speeds, boosted and airborne, never put a car outside the bowl. 24 floor cars (every 15 degrees on two rings, 0/25/55 degrees off the radial, 12..50 m/s, boost on alternate cars) and 12 airborne (3 m up, 6..14 m/s upward, 15..45 m/s outward): each stays within 0.75 m of the wall's face for 7 s, however the pile-up falls.",
    "map": "maps/derby-bowl-16.json",
    "seed": 11,
    "ticks": 840,
    "cars": cars,
    "inputs": inputs,
    "expect": [{"car": i, "metric": "maxRadiusM", "min": 0, "max": limit} for i in range(len(cars))],
}

trans_cars, trans_inputs, trans_expect = [], [], []
for i, (angle, speed) in enumerate([(20, 6), (140, 10), (260, 15)]):
    # From the flat rim (jj_map::arena::limits::FLAT_RIM_M), so the transition is all it meets (P1-M-arena-features).
    trans_cars.append(car(floor_r - 9.0, angle, 0.12, 0, speed))
    trans_expect += [
        {"car": i, "metric": "maxRadiusM", "min": round(floor_r + 0.5, 2), "max": limit},
        {"car": i, "metric": "airtimeS", "min": 0, "max": 0.15},
        {"car": i, "metric": "minUpY", "min": 0.4, "max": 1.001},
        # Back on the floor: a car that rolls back past the rim into one of the field's dips sits up to 1 m low
        # (jj_map::arena::limits::MAX_DIP_CM), never caught up the bank.
        {"car": i, "metric": "height", "min": -1.0, "max": 0.9},
    ]
transition = {
    "scenario": "bowl-transition",
    "what": "P1-M10: driving from the floor up the bank never catches or launches a car. Three cars coast up the bank from the floor's flat rim at 6, 10 and 15 m/s with no throttle: each reaches the bank (past the floor's edge), is airborne for no more than 0.15 s (no launch off the transition), never tips over (the car\'s up axis stays above 0.4: it leans with the bank, no more), and is back down on the floor after 12 s (not caught on the way back; a dip in the field, up to 1 m deep, is floor).",
    "map": "maps/derby-bowl-16.json",
    "seed": 11,
    "ticks": 1440,
    "cars": trans_cars,
    "expect": trans_expect,
}

for name, fx in [("bowl-containment", containment), ("bowl-transition", transition)]:
    with open(f"scenarios/derby/{name}.json", "w") as f:
        json.dump(fx, f, indent=1)
        f.write("\n")
