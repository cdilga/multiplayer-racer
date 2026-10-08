#!/usr/bin/env python3
"""Render a YuE2 ABC score with instrument SoundFont patches (P1-A02v). Runs on eris.

Inputs, and the only inputs: the ABC score YuE2's plan stage wrote (symbolic notes and chord symbols) and
one instrument SoundFont. The score is parsed here, arranged as General MIDI (melody staves, a chord comp,
a pad, a bass line and drums, all from the score's notes, chord symbols and sections) and rendered by
FluidSynth. No YuE2 acoustic tokens, no generated audio and no voice preset can enter: every staff,
including the one YuE2 labels "Vocal" (its melody notation), plays an instrument patch from an allow-list
that excludes every GM voice/choir program.

The MIDI holds the composition three times back to back; render 2 of 3 is cut out at the composition's
exact length plus LOOP_SECONDS, so the loop's seam carries the real reverb tail and the start of the next
pass (export_music.py then crossfades that tail into the head).

Usage: render_score.py --cue race --score drafts/.../score.abc --out drafts/.../render [--bpm 140]
"""
import argparse
import hashlib
import json
import pathlib
import random
import re
import struct
import subprocess
from fractions import Fraction as Fr

HOME = pathlib.Path.home() / "Work/dev/jammers-audio"
INSTR = HOME / "tools/score-instruments"
FLUIDSYNTH = INSTR / "env/bin/fluidsynth"
SOUNDFONT = INSTR / "sf/FluidR3_GM.sf2"
SOUNDFONT_SHA256 = "74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0"
LOOP_SECONDS = 3.0
TPQ = 480
PASSES = 3

# GM programs (0-based) an arrangement may use. Every voice-like program is absent: 52 Choir Aahs, 53 Voice
# Oohs, 54 Synth Voice, 85 Lead 6 (voice), 91 Pad 4 (choir), and the FX/atmosphere patches 96-103.
ALLOWED_PROGRAMS = {4: "Electric Piano 1 (Rhodes)", 24: "Nylon Guitar", 25: "Steel Guitar", 27: "Clean Electric Guitar",
                    29: "Overdriven Guitar", 33: "Fingered Bass", 38: "Synth Bass 1", 39: "Synth Bass 2",
                    48: "String Ensemble", 50: "Synth Strings 1", 56: "Trumpet", 61: "Brass Section",
                    62: "Synth Brass 1", 80: "Square Lead", 81: "Saw Lead", 89: "Warm Pad", 90: "Polysynth Pad",
                    11: "Vibraphone"}
VOICE_PROGRAMS = {52, 53, 54, 85, 91}
DRUM_KITS = {0: "Standard", 16: "Power", 24: "Electronic", 25: "TR-808"}

# Per cue: which patch plays each part, the comp/bass/drum feel, mix levels (CC7) and pans (CC10).
PALETTES = {
    "lobby": {"lead": 27, "counter": 4, "comp": 4, "pad": 89, "bass": 33, "kit": 0, "feel": "lofi",
              "level": {"lead": 92, "counter": 80, "comp": 70, "pad": 52, "bass": 100, "drums": 92},
              "pan": {"lead": 54, "counter": 76, "comp": 40, "pad": 64, "bass": 64}},
    "race": {"lead": 81, "counter": 29, "comp": 90, "pad": 89, "bass": 38, "kit": 24, "feel": "drive",
             "level": {"lead": 88, "counter": 82, "comp": 64, "pad": 50, "bass": 98, "drums": 104},
             "pan": {"lead": 64, "counter": 84, "comp": 44, "pad": 64, "bass": 64}},
    "results": {"lead": 61, "counter": 80, "comp": 62, "pad": 50, "bass": 38, "kit": 16, "feel": "fanfare",
                "level": {"lead": 96, "counter": 70, "comp": 70, "pad": 56, "bass": 96, "drums": 100},
                "pan": {"lead": 60, "counter": 80, "comp": 44, "pad": 64, "bass": 64}},
}
SECTION_ENERGY = {"intro": 0.72, "verse": 0.85, "pre-chorus": 0.92, "chorus": 1.0, "bridge": 0.86,
                  "interlude": 0.8, "outro": 0.74}

# ---------------------------------------------------------------------------------------------- ABC parsing
NAT = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_ORDER, FLAT_ORDER = "FCGDAEB", "BEADGCF"
# Signature of the major key on each pitch class (the common spelling: F# over Gb, Db over C#).
MAJOR_FIFTHS_BY_PC = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1}
QUALITIES = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11), "m7": (0, 3, 7, 10),
             "m7b5": (0, 3, 6, 10), "dim": (0, 3, 6), "dim7": (0, 3, 6, 9), "aug": (0, 4, 8), "sus4": (0, 5, 7),
             "sus2": (0, 2, 7), "7sus4": (0, 5, 7, 10), "6": (0, 4, 7, 9), "m6": (0, 3, 7, 9), "add9": (0, 4, 7, 14),
             "9": (0, 4, 7, 10, 14), "m9": (0, 3, 7, 10, 14), "maj9": (0, 4, 7, 11, 14), "mmaj7": (0, 3, 7, 11)}


def key_accidentals(key):
    m = re.fullmatch(r"([A-G][#b]?)(m|min|maj)?", key.strip())
    if not m:
        raise ValueError(f"unsupported key {key!r}")
    tonic, mode = m.group(1), m.group(2) or ""
    pc = (NAT[tonic[0]] + tonic.count("#") - tonic.count("b")) % 12
    if mode in ("m", "min"):
        pc = (pc + 3) % 12
    n = MAJOR_FIFTHS_BY_PC[pc]
    if "#" in tonic and n < 0:  # a sharp-spelled tonic (D#m, G#m, C#) keeps a sharp signature
        n += 12
    acc = {}
    for letter in (SHARP_ORDER[:n] if n > 0 else FLAT_ORDER[:-n]):
        acc[letter] = 1 if n > 0 else -1
    return acc


class Voice:
    def __init__(self):
        self.t = Fr(0)
        self.notes = []      # [onset_beats, midi, dur_beats]
        self.chords = []     # (onset_beats, symbol)
        self.bar_acc = {}
        self.tie = None


def parse_abc(text):
    head = {}
    voices, sections = {}, []
    cur = None
    body = False
    unit = Fr(1, 8)
    bar = Fr(4)
    pending_section = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("%"):
            pending_section = line.lstrip("% ").strip().lower()
            continue
        m = re.match(r"^([A-Za-z]):\s*(.*)$", line)
        if m and m.group(1) != "V" and not body:
            head[m.group(1)] = m.group(2)
            if m.group(1) == "L":
                unit = Fr(m.group(2))
            elif m.group(1) == "M":
                a, b = m.group(2).split("/")
                bar = Fr(int(a) * 4, int(b))
            elif m.group(1) == "K":
                body = True
            continue
        if line.startswith("V:"):
            name = line[2:].strip().split()[0]
            if body:
                cur = voices.setdefault(name, Voice())
                if pending_section and name == "Vocal":
                    sections.append((cur.t, pending_section))
                    pending_section = None
            continue
        if cur is None:
            continue
        parse_line(line, cur, unit, bar, key_accidentals(head.get("K", "C")))
    bpm = float(re.search(r"=\s*([\d.]+)", head.get("Q", "1/4=120")).group(1))
    length = max(v.t for v in voices.values())
    return {"head": head, "voices": voices, "sections": sections, "bpm": bpm, "bar": bar, "length": length}


TOKEN = re.compile(r'"([^"]*)"|(\^\^|\^|__|_|=)?([A-Ga-g])([,\']*)(\d*)(/\d*)?(-?)|([zx])(\d*)(/\d*)?|Z(\d*)|(\|)|(\s+)|(.)')


def dur(num, frac):
    d = Fr(int(num)) if num else Fr(1)
    if frac:
        den = frac[1:]
        d /= int(den) if den else 2
    return d


def parse_line(line, v, unit, bar, keyacc):
    beat_per_unit = unit * 4
    for m in TOKEN.finditer(line):
        chord, acc, letter, octs, num, frac, tie, rest, rnum, rfrac, mrest, barline, ws, other = m.groups()
        if chord is not None:
            v.chords.append((v.t, chord))
        elif letter:
            base = 60 + NAT[letter.upper()] + (12 if letter.islower() else 0)
            base += 12 * octs.count("'") - 12 * octs.count(",")
            if acc:
                shift = {"^": 1, "^^": 2, "_": -1, "__": -2, "=": 0}[acc]
                v.bar_acc[(letter.upper(), base)] = shift
            shift = v.bar_acc.get((letter.upper(), base), keyacc.get(letter.upper(), 0))
            pitch = base + shift
            d = dur(num, frac) * beat_per_unit
            if v.tie is not None and v.tie[1] == pitch:
                v.tie[2] += d
                note = v.tie
            else:
                note = [v.t, pitch, d]
                v.notes.append(note)
            v.tie = note if tie else None
            v.t += d
        elif rest:
            v.t += dur(rnum, rfrac) * beat_per_unit
            v.tie = None
        elif mrest is not None:
            v.t += bar * (int(mrest) if mrest else 1)
            v.tie = None
        elif barline:
            v.bar_acc = {}
        elif other and other not in ":[]":
            raise ValueError(f"unsupported ABC symbol {other!r} in {line!r}")


def parse_chord(sym):
    m = re.fullmatch(r"([A-G])([#b]?)(.*?)(?:/([A-G][#b]?))?", sym)
    if not m:
        raise ValueError(f"unsupported chord {sym!r}")
    q = m.group(3)
    if q not in QUALITIES:
        q = "m" if q.startswith("m") and not q.startswith("maj") else ""
    root = (NAT[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)) % 12
    bass = root
    if m.group(4):
        b = m.group(4)
        bass = (NAT[b[0]] + b.count("#") - b.count("b")) % 12
    return root, bass, QUALITIES[q]


# ---------------------------------------------------------------------------------------------- arrangement
def section_at(sections, t):
    name = "verse"
    for s_t, s_name in sections:
        if s_t <= t:
            name = s_name
    return name


def energy(sections, t):
    name = section_at(sections, t)
    for k, e in SECTION_ENERGY.items():
        if name.startswith(k):
            return e
    return 0.85


def arrange(score, cue, seed):
    """Return {part: [(onset_beats, pitch, dur_beats, velocity)]} for one pass of the composition."""
    p = PALETTES[cue]
    rng = random.Random(seed)
    secs = score["sections"]
    vocal, ins = score["voices"].get("Vocal", Voice()), score["voices"].get("Ins", Voice())
    length, bar = score["length"], score["bar"]
    parts = {k: [] for k in ("lead", "counter", "comp", "pad", "bass", "drums")}

    def vel(base, t, spread=6):
        return max(30, min(124, round(base * energy(secs, t)) + rng.randint(-spread, spread)))

    def fit(pitch, lo, hi):
        while pitch < lo:
            pitch += 12
        while pitch > hi:
            pitch -= 12
        return pitch

    for t, n, d in vocal.notes:
        parts["lead"].append((t, fit(n + (12 if cue == "race" else 0), 55, 91), d * Fr(19, 20), vel(100, t)))
    for t, n, d in ins.notes:
        parts["counter"].append((t, fit(n, 48, 84), d * Fr(9, 10), vel(84, t)))

    chords = sorted(vocal.chords + ins.chords)
    if not chords:
        raise ValueError("score has no chord symbols")
    spans = []
    for i, (t, sym) in enumerate(chords):
        end = chords[i + 1][0] if i + 1 < len(chords) else length
        if end > t:
            spans.append((t, end, *parse_chord(sym)))
    for t0, t1, root, bassnote, iv in spans:
        tones = [fit(57 + ((root - 9) % 12), 52, 64) + x for x in iv[:4]]
        parts["pad"] += [(t0, n, t1 - t0, vel(58, t0, 3)) for n in tones[:3]]
        b = t0
        while b < t1:
            beat_in_bar = (b % bar)
            seg = min(t1 - b, Fr(1))
            e = energy(secs, b)
            if p["feel"] == "lofi":
                if beat_in_bar in (Fr(1, 2), Fr(5, 2)) or (beat_in_bar == Fr(3, 2) and e >= 0.85):
                    parts["comp"] += [(b, n, Fr(3, 4), vel(66, b)) for n in tones]
                bass_hits = [(Fr(0), Fr(3, 2)), (Fr(3, 2), Fr(1, 2))] if beat_in_bar in (0, 2) else []
            elif p["feel"] == "drive":
                parts["comp"] += [(b + x, n, Fr(1, 4), vel(60 if x else 70, b)) for x in (Fr(0), Fr(1, 2))
                                  for n in tones if e >= 0.8]
                bass_hits = [(Fr(0), Fr(3, 8)), (Fr(1, 2), Fr(3, 8))]
            else:  # fanfare
                if beat_in_bar == 0 or (beat_in_bar == 2 and e >= 0.9):
                    parts["comp"] += [(b, n, Fr(1, 2), vel(84, b)) for n in tones]
                bass_hits = [(Fr(0), Fr(1, 2)), (Fr(1, 2), Fr(1, 4))] if e >= 0.85 else [(Fr(0), Fr(7, 8))]
            for off, d in bass_hits:
                if off < seg:
                    pc = bassnote if (p["feel"] != "drive" or off == 0 or rng.random() < 0.7) else root
                    octave = 12 if (p["feel"] == "drive" and off and rng.random() < 0.35) else 0
                    parts["bass"].append((b + off, 36 + pc + octave - (12 if pc > 7 else 0), d, vel(96, b)))
            b += seg

    bars = int(length / bar)
    sec_starts = {round(t / bar) for t, _ in secs}
    for i in range(bars):
        t0 = bar * i
        e = energy(secs, t0)
        name = section_at(secs, t0)
        hits = []
        if p["feel"] == "lofi":
            hits += [(0, 36, 92), (Fr(5, 2), 36, 78), (1, 38, 74), (3, 38, 76)]
            hits += [(Fr(x, 2) + (Fr(1, 12) if x % 2 else 0), 42, 46 if x % 2 else 56) for x in range(8)]
            if name.startswith(("intro", "outro")):
                hits = [h for h in hits if h[1] != 38]
        elif p["feel"] == "drive":
            hits += [(x, 36, 104) for x in range(4)] + [(1, 38, 98), (3, 38, 100)]
            hits += [(Fr(x, 2), 42 if x % 2 == 0 else 46, 60) for x in range(8)]
            if e < 0.8:
                hits = [h for h in hits if h[1] in (36, 42)]
            if (i + 1) % 8 == 0 and e >= 0.85:
                hits += [(3 + Fr(x, 4), 38 if x % 2 else 45, 80 + 6 * x) for x in range(4)]
        else:
            hits += [(0, 36, 104), (2, 36, 96), (1, 38, 96), (3, 38, 100)]
            hits += [(Fr(x, 2), 42, 58) for x in range(8)]
            if (i + 1) % 4 == 0:
                hits += [(3 + Fr(x, 4), 38, 70 + 8 * x) for x in range(4)]
        if i in sec_starts or i == 0:
            hits.append((0, 49, 100))
        for off, note, v in hits:
            parts["drums"].append((t0 + Fr(off), note, Fr(1, 8), vel(v, t0, 5)))
    return parts


# ---------------------------------------------------------------------------------------------- MIDI
def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.insert(0, 0x80 | (n & 0x7F))
        n >>= 7
    return bytes(out)


def mtrk(events):
    events.sort(key=lambda e: (e[0], e[1]))
    data, last = bytearray(), 0
    for t, _, msg in events:
        data += vlq(t - last) + msg
        last = t
    data += b"\x00\xff\x2f\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + data


def write_midi(path, score, parts, cue, bpm):
    p = PALETTES[cue]
    ticks = lambda beats: round(beats * TPQ)
    one = score["length"]
    tempo = [(0, 0, b"\xff\x51\x03" + round(60_000_000 / bpm).to_bytes(3, "big"))]
    tracks = [mtrk(tempo + [(ticks(one * PASSES), 9, b"\xff\x01\x00")])]
    channels = {"lead": 0, "counter": 1, "comp": 2, "pad": 3, "bass": 4, "drums": 9}
    programs = {}
    for part, ch in channels.items():
        prog = p["kit"] if part == "drums" else p[part]
        if part != "drums" and (prog not in ALLOWED_PROGRAMS or prog in VOICE_PROGRAMS):
            raise ValueError(f"{part}: program {prog} is not an allowed instrument patch")
        programs[part] = prog
        level = p["level"][part]
        ev = [(0, 0, bytes([0xC0 | ch, prog])), (0, 0, bytes([0xB0 | ch, 7, level])),
              (0, 0, bytes([0xB0 | ch, 10, p["pan"].get(part, 64)])),
              (0, 0, bytes([0xB0 | ch, 91, 30 if part != "bass" else 8]))]
        for k in range(PASSES):
            base = one * k
            for t, n, d, v in parts[part]:
                s, e = ticks(base + t), ticks(base + t + d)
                ev.append((s, 2, bytes([0x90 | ch, n, v])))
                ev.append((max(e, s + 1), 1, bytes([0x80 | ch, n, 0])))
        tracks.append(mtrk(ev))
    path.write_bytes(b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), TPQ) + b"".join(tracks))
    return programs


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cue", required=True, choices=PALETTES)
    ap.add_argument("--score", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bpm", type=float, help="tempo for the cue's job (default: the score's Q:)")
    ap.add_argument("--seed", type=int, default=0, help="humanising seed (velocities, bass passing notes)")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if sha(SOUNDFONT) != SOUNDFONT_SHA256:
        raise SystemExit("SoundFont hash mismatch")
    text = pathlib.Path(a.score).read_text()
    score = parse_abc(text)
    bpm = a.bpm or score["bpm"]
    parts = arrange(score, a.cue, a.seed)
    mid = out / "arrangement.mid"
    programs = write_midi(mid, score, parts, a.cue, bpm)
    wav3 = out / "render-3pass.wav"
    cmd = [str(FLUIDSYNTH), "-n", "-i", "-q", "-r", "48000", "-g", "0.5", "-R", "1", "-C", "1", "-O", "s24", "-T", "wav",
           "-F", str(wav3), str(SOUNDFONT), str(mid)]
    subprocess.run(cmd, check=True)
    one_s = float(score["length"]) * 60 / bpm
    seg = out / "loop-source.wav"  # pass 2 plus LOOP_SECONDS of pass 3
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav3), "-af",
                    f"atrim=start={one_s:.6f}:end={2 * one_s + LOOP_SECONDS:.6f},asetpts=PTS-STARTPTS",
                    "-c:a", "pcm_s24le", str(seg)], check=True)
    info = {"cue": a.cue, "score": str(a.score), "score_sha256": sha(a.score), "score_bpm": score["bpm"], "bpm": bpm,
            "key": score["head"].get("K"), "bars": float(score["length"] / score["bar"]),
            "composition_seconds": round(one_s, 3), "sections": [[float(t / score["bar"]), n] for t, n in score["sections"]],
            "notes": {k: len(v) for k, v in parts.items()},
            "staves": {"Vocal": "lead (YuE2's melody staff, played by an instrument)", "Ins": "counter"},
            "patches": {k: {"program": v, "name": DRUM_KITS[v] + " drum kit" if k == "drums" else ALLOWED_PROGRAMS[v]}
                        for k, v in programs.items()},
            "renderer": {"fluidsynth": subprocess.run([str(FLUIDSYNTH), "--version"], capture_output=True,
                                                      text=True).stdout.splitlines()[0],
                         "soundfont": "FluidR3_GM.sf2 (Frank Wen, MIT; Debian fluid-soundfont-gm 3.1-5.3)",
                         "soundfont_sha256": SOUNDFONT_SHA256, "command": cmd,
                         "inputs": {"midi": str(mid), "midi_sha256": sha(mid), "soundfont": str(SOUNDFONT)}},
            "humanise_seed": a.seed, "loop_source": str(seg)}
    (out / "render.json").write_text(json.dumps(info, indent=2) + "\n")
    print(f"{a.cue} {a.score}: {info['bars']:.0f} bars, {one_s:.1f}s at {bpm} BPM -> {seg}")


if __name__ == "__main__":
    main()
