#!/usr/bin/env python3
"""Generates the P1-S09 skill-payoff duels (plan §7.3b): `scenarios/duels/yard/duel-yard.json`, one fixture per duel
(`scenarios/duels/<duel>.json`, run by `jj sim`) and its ordering (`scenarios/duels/orderings/<duel>.json`, judged by
`crates/jj-sim/tests/duels.rs`). Run from the repo root; the outputs are committed.

Every duel puts identical Cruz Missiles in the same state on the same segment (cars at one pose stay ghosted against each
other until they part, so they don't touch at the start) with scripted inputs: a plain line, a well-executed technique,
botched ones and mash scripts. The ordering is on the time each car takes to a gate after the segment.

Where the line itself is the point (the wheelie duels, the air control duel) the inputs are the whole script. Where it
isn't (drift, boost), the plain line is the sim's autopilot (a steady, deliberately weak pure-pursuit driver, so every car
holds the same racing line and the duel isolates the technique) and the scripted part is the ACTION stick that rides on
it: the handbrake drift and the boost. The timings were found with seeded random searches over the fixture runner
(`docs/evidence/P1-S09/search-log.md` lists them), then frozen here as literals.
"""
import json
import os
import random

MAP = "scenarios/duels/yard/duel-yard.json"
HZ = 120
TUNED = None  # the committed duels run on the committed profile


def make_yard():
    """The greybox loop with its cones taken away and an infield median added (a duel is about the line, so no cutting the
    corner), keeping its barriers, route, hairpin, jump and kerb."""
    d = json.load(open("maps/greybox-loop.json"))
    d["dressing"] = [x for x in d["dressing"] if x["kitPiece"] != "generic/box-building"]  # nothing to wedge on out in the free ground
    d["dressing"] += [  # a median across the infield and a cap on the hairpin's inside: no cutting the corner
        {"kitPiece": "generic/barrier", "pose": {"x": 117000, "y": 0, "z": 15000, "yaw": 0},
         "params": {"lengthMm": 35000, "heightCm": 300, "thicknessMm": 2000}, "collides": True},
        {"kitPiece": "generic/barrier", "pose": {"x": 151000, "y": 0, "z": 15000, "yaw": 0},
         "params": {"lengthMm": 35000, "heightCm": 300, "thicknessMm": 2000}, "collides": True},
        {"kitPiece": "generic/barrier", "pose": {"x": 169000, "y": 0, "z": 15000, "yaw": 0},
         "params": {"lengthMm": 10000, "heightCm": 300, "thicknessMm": 3000}, "collides": True},
        {"kitPiece": "generic/barrier", "pose": {"x": 169000, "y": 0, "z": 15000, "yaw": 9000},
         "params": {"lengthMm": 10000, "heightCm": 300, "thicknessMm": 3000}, "collides": True},
    ]
    d["props"] = []
    d["header"]["gameplayHash"] = None
    os.makedirs(os.path.dirname(MAP), exist_ok=True)
    json.dump(d, open(MAP, "w"), indent=1)
    open(MAP, "a").write("\n")


def S(sec):
    return None if sec is None else round(sec * HZ)


def span(car, a, b, **kw):
    """A span from a to b seconds (b None: to the end)."""
    d = {"car": car, "fromTick": S(a)}
    if b is not None:
        d["toTick"] = S(b)
    d.update(kw)
    return d


def mash(seed, secs, car, sticks=False):
    """A seeded mash script: every 50 ms the controls land somewhere new (DRIVE anywhere, ACTION drifting or boosting
    a fifth of the time each; or the raw sticks, which is what a wheelie gesture is read from)."""
    rng = random.Random(seed)
    out = []
    for t in range(0, S(secs), 6):
        a = rng.random()
        if sticks:
            act = [0.0, 0.0]
            if a < 0.2:
                act = [-1.0, 0.0]
            elif a < 0.4:
                act = [1.0, 0.0]
            out.append({"car": car, "fromTick": t, "toTick": t + 6, "stick": [round(rng.random() * 2 - 1, 2), round(rng.random() * 2 - 1, 2)], "action": act})
        else:
            out.append({"car": car, "fromTick": t, "toTick": t + 6, "throttle": round(rng.random() * 2 - 1, 2),
                        "steer": round(rng.random() * 2 - 1, 2), "drift": a < 0.2, "boost": 0.2 <= a < 0.4})
    return out


def acts(car, drift=None, boost=None, pad=None):
    """ACTION-only spans: handbrake over `drift=(from, to)` seconds, boost over `boost=(from, to)`. The rest of the
    time the car's neutral (the autopilot supplies DRIVE)."""
    cuts = sorted({0.0, *(x for w in (drift, boost) if w for x in w)})
    out = []
    for a, b in zip(cuts, cuts[1:] + [None]):
        mid = a + 1e-6
        kw = {}
        if drift and drift[0] <= mid < drift[1]:
            kw["drift"] = True
        if boost and boost[0] <= mid < boost[1]:
            kw["boost"] = True
        out.append(span(car, a, b, **kw))
    return out


def write(name, what, seed, secs, cars, labels, inputs, gate, beats, extra=None, expect=None, solo=False):
    """One duel: the fixture and its ordering. `cars` has one entry per label. `solo`: one fixture per label with its car
    alone (<duel>.<label>.json), for duels on a racing line where cars on one line would bump each other."""
    assert len(cars) == len(labels)
    if solo:
        files = []
        for i, label in enumerate(labels):
            fx = {"scenario": f"{name}.{label}", "what": what, "map": MAP, "seed": seed, "ticks": S(secs), "cars": [cars[i]]}
            if extra and extra.get("autopilot") and any(a["car"] == i for a in extra["autopilot"]):
                fx["autopilot"] = [{"tick": 0, "car": 0, "on": True}]
            fx["inputs"] = [dict(x, car=0) for x in inputs if x["car"] == i]
            fx["expect"] = []
            files.append(f"{name}.{label}.json")
            json.dump(fx, open(f"scenarios/duels/{files[-1]}", "w"), indent=1)
            open(f"scenarios/duels/{files[-1]}", "a").write("\n")
        o = {"duel": name, "fixtures": files, "gate": gate, "labels": labels, "beats": beats}
        if TUNED:
            o["set"] = TUNED
        json.dump(o, open(f"scenarios/duels/orderings/{name}.json", "w"), indent=1)
        open(f"scenarios/duels/orderings/{name}.json", "a").write("\n")
        return
    fx = {"scenario": name, "what": what, "map": MAP, "seed": seed, "ticks": S(secs), "cars": cars}
    if extra:
        fx.update(extra)
    fx["inputs"] = inputs
    fx["expect"] = expect or []
    json.dump(fx, open(f"scenarios/duels/{name}.json", "w"), indent=1)
    open(f"scenarios/duels/{name}.json", "a").write("\n")
    o = {"duel": name, "fixture": f"{name}.json", "gate": gate, "labels": labels, "beats": beats}
    if TUNED:
        o["set"] = TUNED
    json.dump(o, open(f"scenarios/duels/orderings/{name}.json", "w"), indent=1)
    open(f"scenarios/duels/orderings/{name}.json", "a").write("\n")


def same(pose, linvel, n):
    return [{"pose": pose, "linvel": linvel} for _ in range(n)]


def beat(faster, slower, by_s, gap=None):
    b = {"faster": faster, "slower": slower, "byS": by_s}
    if gap:
        b["gap"] = gap
    return b


make_yard()

# ----------------------------------------------------------------------------------------------------------------
# Wheelie launch (§7.3 Wheelie, R64): raw sticks through jj-input's source machine, from rest and from 8 m/s.
# ----------------------------------------------------------------------------------------------------------------


WHEELIE_GAP = ("the preload pull brakes a rolling car (and reverses one at rest) for the 0.35 s it takes, and the launch drive "
               "(+15 % for 0.8 s) never repays it; see docs/evidence/P1-S09/search-log.md")


def pull_release(car, hold, then=1.0):
    """DRIVE pulled past full brake for `hold` s, then snapped forward and held (the wheelie gesture)."""
    return [span(car, 0, hold, stick=[0, -1.0]), span(car, hold, None, stick=[0, then])]


def wheelie_launch(name, v0, what, margin_well):
    labels = ["plain", "well", "early", "late", "held", "mash-a", "mash-b"]
    ins = [span(0, 0, None, stick=[0, 1.0])]
    ins += pull_release(1, 0.35)          # the 350 ms the profile asks for, released at once
    ins += pull_release(2, 0.20)          # released too early: no wheelie, and the pull cost the launch
    ins += pull_release(3, 0.90)          # held far too long
    ins += pull_release(4, 1.15)          # held until jj-input cancels the gesture
    ins += mash(21, 7, 5, sticks=True) + mash(22, 7, 6, sticks=True)
    beats = [beat("well", "plain", margin_well, gap=WHEELIE_GAP), beat("plain", "early", 0.0), beat("plain", "late", 0.1),
             beat("plain", "held", 0.1), beat("well", "mash-*", 0.0)]
    write(name, what, 31, 7, same({"x": 10, "y": 0.1, "z": 0, "headingDeg": 90}, [v0, 0, 0], len(labels)), labels, ins,
          {"metric": "travel", "at": 40.0}, beats)


wheelie_launch(
    "wheelie-launch-duel", 0,
    "§7.3b wheelie-launch-duel, from rest (P1-S09). Seven identical Cruz Missiles on the greybox's main straight, time to a gate 40 m on. plain: DRIVE flat out. well: the pull-release gesture (DRIVE pulled past full brake for 0.35 s, then snapped forward): the front lifts and the launch drive is on. early: released after 0.2 s, under the 350 ms the profile asks, so no wheelie and the pull cost time. late and held: pulled for 0.9 s and 1.15 s. mash: two seeded random-stick scripts. Expect: well beats plain (known gap on the shipped profile); plain is no worse than early, and beats late and held; no mash beats well.",
    0.3)
wheelie_launch(
    "wheelie-launch-duel-8", 8,
    "§7.3b wheelie-launch-duel, from 8 m/s (P1-S09). As wheelie-launch-duel, rolling at 8 m/s (the pull's brake costs more here, so the margin is thin).",
    0.03)

# ----------------------------------------------------------------------------------------------------------------
# Air control (§7.3 Air control): launched 3 m up tipped 40 degrees onto its side, 12 m/s forward and 6 m/s up, as the
# feel bank's `air-level`; every car floors it once down. Gate 70 m on.
# ----------------------------------------------------------------------------------------------------------------


def air_control():
    labels = ["plain", "well", "over", "mash-a", "mash-b"]

    def lev(car, a1, d1, a2, d2):
        return [span(car, 0, d1, steer=a1, throttle=0.3), span(car, d1, d1 + d2, steer=a2, throttle=0.3), span(car, d1 + d2, None, throttle=1.0)]
    ins = [span(0, 0, 1.6, throttle=0.3), span(0, 1.6, None, throttle=1.0)]   # no input in the air
    ins += lev(1, 1.0, 0.7, -1.0, 0.4)                                       # steer into the tilt, then stop the roll
    ins += [span(2, 0, 1.4, steer=1.0, throttle=0.3), span(2, 1.4, 1.6, steer=-1.0, throttle=0.3), span(2, 1.6, None, throttle=1.0)]  # held far too long
    ins += mash(51, 7, 3) + mash(52, 7, 4)
    beats = [beat("well", "plain", 0.1), beat("plain", "over", 0.2), beat("well", "mash-*", 0.0)]
    write("air-control-duel",
          "§7.3b air-control-duel (P1-S09), the feel bank's jump: five Cruz Missiles launched 3 m up at 12 m/s forward and 6 m/s up, tipped 40 degrees onto their right side, all flooring it after 1.6 s. plain: no input in the air, lands tipped and loses speed. well: steers into the tilt to roll level, then stops the roll, and lands on its wheels keeping its speed. over: holds the correction far too long and lands worst. mash: two seeded random scripts. Gate: 70 m from the launch.",
          71, 7, same({"x": 10, "y": 3.0, "z": -4, "headingDeg": 90, "rollDeg": 40}, [12, 6, 0], len(labels)), labels, ins,
          {"metric": "travel", "at": 70.0}, beats)


air_control()

# ----------------------------------------------------------------------------------------------------------------
# Autopilot lines: drift and boost ride on the autopilot's racing line (the ACTION stick passes through it).
# ----------------------------------------------------------------------------------------------------------------


def ap(n_driven):
    return {"autopilot": [{"tick": 0, "car": i, "on": True} for i in range(n_driven)]}


def drift_straight_penalty():
    labels = ["plain", "drift-short", "drift-long", "mash-a", "mash-b"]
    ins = [span(0, 0, None, throttle=1.0)]
    for car, (t0, dur) in {1: (0.5, 1.0), 2: (0.5, 2.0)}.items():
        ins.append(span(car, 0, t0, throttle=1.0))
        t, k = t0, 0
        while t < t0 + dur - 1e-9:
            ins.append(span(car, t, min(t + 0.3, t0 + dur), throttle=1.0, steer=0.1 * (1 if k % 2 == 0 else -1), drift=True))
            t += 0.3
            k += 1
        ins.append(span(car, t0 + dur, None, throttle=1.0))
    ins += mash(81, 9, 3) + mash(82, 9, 4)
    beats = [beat("plain", "drift-*", 0.02), beat("plain", "mash-*", 0.0)]
    write("drift-straight-penalty",
          "§7.3b drift-straight-penalty (P1-S09): drifting down a straight is slower than driving it straight. Five Cruz Missiles at 18 m/s on the main straight, time to 150 m on. plain: flat out. drift-short and drift-long: the handbrake held for 1 s and 2 s with the small steering wiggle a driver needs to keep the tail out. mash: two seeded random scripts.",
          81, 9, same({"x": 10, "y": 0.1, "z": 0, "headingDeg": 90}, [18, 0, 0], len(labels)), labels, ins,
          {"metric": "progressM", "at": 150.0, "maxOffsetM": 9.0}, beats)


drift_straight_penalty()


def boost_placement():
    labels = ["plain", "straight", "corner", "mash-a", "mash-b"]
    ins = [] + acts(1, boost=(1.0, 2.4)) + acts(2, boost=(3.5, 4.9)) + mash(91, 14, 3) + mash(92, 14, 4)
    beats = [beat("straight", "corner", 0.5), beat("straight", "plain", 0.5), beat("straight", "mash-*", 0.0)]
    write("boost-placement-duel",
          "§7.3b boost-placement-duel (P1-S09): the same boost spent on the straight beats it spent in the corner. Five Cruz Missiles enter the greybox hairpin at 18 m/s, three on the autopilot's line (the same line for all), the ACTION stick the only difference. plain: no boost. straight: the starting meter (1.4 s of boost) spent on the straight before the corner. corner: the same boost spent through the corner. mash: two seeded random scripts. Gate: 110 m along the route.",
          91, 14, same({"x": 110, "y": 0.1, "z": 0, "headingDeg": 90}, [18, 0, 0], len(labels)), labels, ins,
          {"metric": "progressM", "at": 110.0, "maxOffsetM": 12.0}, beats, extra=ap(3), solo=True)


boost_placement()


def drift_corner():
    labels = ["plain", "straight-boost", "exit-boost", "well", "botched", "mash-a", "mash-b"]
    ins = acts(1, boost=(1.0, 2.5)) + acts(2, boost=(6.86, 8.62)) + acts(3, drift=(4.491, 7.343), boost=(7.362, 9.744))
    ins += acts(4, drift=(1.0, 4.5), boost=(4.5, 6.9)) + mash(101, 14, 5) + mash(102, 14, 6)
    beats = [beat("well", "plain", 0.5), beat("plain", "botched", 0.1), beat("well", "mash-*", 0.0),
             beat("well", "exit-boost", 0.2,
                  gap="the drift's charge buys no time over the same boost spent without drifting (S09 search: in the hairpin the best drift line ties the best boost-only one)")]
    write("drift-corner-duel",
          "§7.3b drift-corner-duel (P1-S09): the greybox hairpin at 18 m/s entry, every car but the mashers on the autopilot's line, the ACTION stick the only difference. plain: nothing. straight-boost: the starting boost spent on the straight. exit-boost: boost spent on the exit. well: the handbrake held through the corner (the drift charges the meter) and the banked boost spent on the exit. botched: the handbrake held from 1.0 s, far too early, which spins it out. Known gap: well beats plain, but exit-boost does as well as well does (the corner's drift adds nothing over the boost it feeds).",
          91, 14, same({"x": 110, "y": 0.1, "z": 0, "headingDeg": 90}, [18, 0, 0], len(labels)), labels, ins,
          {"metric": "progressM", "at": 110.0, "maxOffsetM": 12.0}, beats, extra=ap(5), solo=True)


drift_corner()


def drift_boost_chain():
    labels = ["plain", "grip", "well", "botched", "mash-a", "mash-b"]
    ins = acts(1, boost=(0.0, 1.5))
    ins += [span(2, a, b, **kw) for a, b, kw in [(0, 0.65, {}), (0.65, 1.3, dict(drift=True)), (1.3, 1.56, {}), (1.56, 2.16, dict(drift=True)), (2.16, 2.65, {}), (2.65, 6.47, dict(boost=True)), (6.47, None, {})]]
    ins += acts(3, drift=(0.0, 16.0), boost=(2.65, 6.47)) + mash(111, 16, 4) + mash(112, 16, 5)
    beats = [beat("well", "grip", 0.2), beat("grip", "plain", 0.5), beat("grip", "botched", 0.0), beat("well", "mash-*", 0.0)]
    write("drift-boost-chain",
          "§7.3b drift-boost-chain (P1-S09): the greybox's S-bend (a left then a right) and the straight after it, entered at 18 m/s, every car but the mashers on the autopilot's line. plain: nothing. grip: the starting boost spent (the best place the search found). well: the handbrake through each bend (each drift charges the meter) and the banked boost spent on the straight. botched: the handbrake the whole way with the same boost. Gate: 150 m along the route.",
          111, 16, same({"x": 107.5, "y": 0.1, "z": 30, "headingDeg": 270}, [-18, 0, 0], len(labels)), labels, ins,
          {"metric": "progressM", "at": 150.0, "maxOffsetM": 12.0}, beats, extra=ap(4), solo=True)


drift_boost_chain()
