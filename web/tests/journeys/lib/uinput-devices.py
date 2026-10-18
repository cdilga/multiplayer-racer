#!/usr/bin/env python3
"""Virtual keyboards and pads through /dev/uinput (python-evdev), for the input helper's real-device journey (P1-C12.1).

Usage: uinput-devices.py PREFIX KEYBOARDS PADS
Creates KEYBOARDS keyboards named "PREFIX-kbd-N" and PADS pads named "PREFIX-pad-N", prints "ready", then reads one
command per line from stdin:
  key N KEY_W 1|0      a key on keyboard N
  abs N ABS_Y -32768   an axis on pad N (sticks are -32768..32767)
  btn N BTN_START 1|0  a button on pad N
  unplug kbd|pad N     destroy that device
  plug kbd|pad N       create it again (same name)
Only the input helper should read these: run it with --only PREFIX --grab, so the desktop never sees the keys.
"""
import sys

from evdev import AbsInfo, UInput, ecodes as e

prefix, n_kbd, n_pad = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
STICK = AbsInfo(value=0, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)


def keyboard(i):
    return UInput({e.EV_KEY: list(range(1, 89))}, name=f"{prefix}-kbd-{i}", vendor=0x4A4A, product=0x100 + i)


def pad(i):
    caps = {
        e.EV_KEY: [e.BTN_SOUTH, e.BTN_EAST, e.BTN_NORTH, e.BTN_WEST, e.BTN_TL, e.BTN_TR, e.BTN_SELECT, e.BTN_START, e.BTN_MODE],
        e.EV_ABS: [(e.ABS_X, STICK), (e.ABS_Y, STICK), (e.ABS_RX, STICK), (e.ABS_RY, STICK)],
    }
    return UInput(caps, name=f"{prefix}-pad-{i}", vendor=0x4A4A, product=0x200 + i)


devs = {"kbd": {i: keyboard(i) for i in range(1, n_kbd + 1)}, "pad": {i: pad(i) for i in range(1, n_pad + 1)}}
print("ready", flush=True)
for line in sys.stdin:
    p = line.split()
    if not p:
        continue
    try:
        if p[0] == "key":
            d = devs["kbd"][int(p[1])]
            d.write(e.EV_KEY, e.ecodes[p[2]], int(p[3]))
            d.syn()
        elif p[0] in ("abs", "btn"):
            d = devs["pad"][int(p[1])]
            d.write(e.EV_ABS if p[0] == "abs" else e.EV_KEY, e.ecodes[p[2]], int(p[3]))
            d.syn()
        elif p[0] == "unplug":
            devs[p[1]].pop(int(p[2])).close()
        elif p[0] == "plug":
            i = int(p[2])
            devs[p[1]][i] = keyboard(i) if p[1] == "kbd" else pad(i)
        print("ok", flush=True)
    except Exception as err:  # noqa: BLE001 - report and keep serving the journey
        print(f"error {err}", flush=True)
for kind in devs.values():
    for d in kind.values():
        d.close()
