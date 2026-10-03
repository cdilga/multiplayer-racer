#!/usr/bin/env python3
"""voice_screens.py: the automatic screens and the pick rule for announcer takes (P1-A01).

Pure Python (no torch, no numpy): `voice_render_eris.py` imports it on eris, `test_voice_screens.py` on the
Mac, so the thresholds and the pick rule live in exactly one place and are recorded in manifest.json.

THE SCREENS (a take must pass all of them to be a candidate)
  wer          Whisper large-v3 transcript vs the row's spoken text, word error rate. A wrong word makes a
               callout unusable, so the bar is WER <= WER_MAX (0.0 after the digit, homophone and ASR-spelling
               normalisation in `words`; one wrong or missing word fails).
  speaker_sim  Cosine between the take's and the owner reference's Qwen3-TTS speaker embeddings
               (first 8 s of each). The owner's timbre sits at 0.96-0.99; VoiceDesign output that is not
               the owner scores 0.87-0.90 (commit 1ac11a2), so SPEAKER_SIM_MIN = 0.93 separates them.
  duration     Seconds within [DURATION_MIN_BASE + DURATION_MIN_PER_WORD * words,
               DURATION_MAX_BASE + DURATION_MAX_PER_WORD * words]: refuses runaway generations and
               truncated takes.
  raw_loudness The raw take is measurable (integrated >= RAW_LUFS_MIN) and unclipped
               (true peak <= RAW_TRUE_PEAK_MAX_DBTP).
  export       The exported Ogg/Opus, decoded again, sits within LUFS_TOLERANCE_LU of TARGET_LUFS and its true
               peak is <= TARGET_TRUE_PEAK_DBTP. (Row-level; the pick happens before export.)

THE PICK RULE
  Among takes that pass the take screens, the highest `score`; if none passes, the highest score overall and
  the row is reported as failing (the worker then renders more seeds). Ties go to the lower seed.

      score = 0.6 * (1 - min(wer, 1)) + 0.4 * speaker_sim + (0.1 * clip(lift_st / 8, 0, 1) if hype)

  where lift_st is the take's median pitch in semitones above the owner's (an energy proxy; hype rows only).
  The first two terms are voice_clone.py's rule (words first, then voice match); the third prefers the
  more excited of two otherwise-equal hype takes. The owner's ear overrides any pick.
"""

from __future__ import annotations

import math
import re

TARGET_LUFS = -16.0
TARGET_TRUE_PEAK_DBTP = -1.0

THRESHOLDS = {
    "wer_max": 0.0,
    "speaker_sim_min": 0.93,
    "duration_min_base_s": 0.4,
    "duration_min_per_word_s": 0.15,
    "duration_max_base_s": 2.0,
    "duration_max_per_word_s": 0.6,
    "raw_lufs_min": -45.0,
    "raw_true_peak_max_dbtp": 0.0,
    "export_lufs_target": TARGET_LUFS,
    "export_lufs_tolerance_lu": 1.0,
    "export_true_peak_max_dbtp": TARGET_TRUE_PEAK_DBTP,
}

SCORE_WEIGHTS = {"words": 0.6, "speaker_sim": 0.4, "hype_energy": 0.1, "energy_full_lift_st": 8.0}

_DIGITS = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
           "7": "seven", "8": "eight", "9": "nine", "10": "ten"}

# Spellings Whisper gives to words it has no canonical spelling for (Australian slang), mapped to the sheet's
# spelling. The take says the word right; Whisper just has no agreed way to write it. Add an entry only for a
# genuine respelling (never a different word); the table is recorded in manifest.json.
ASR_ALIASES: dict[str, str] = {"struth": "strewth", "gidday": "g'day"}

# Differences the ear cannot hear, folded on BOTH sides before WER: a possessive/contraction 's and a plural s sound the
# same ("Door's off" vs "Doors off"), and "all ready" is "already" aloud. Recorded in manifest.json.
HOMOPHONE_RULES = ["trailing 's -> s (door's = doors)", "'all ready' -> 'already'"]

# How the TTS is TOLD to say a sheet word that it garbles as written (the sheet stays canonical; WER is still scored
# against the sheet's text). Applied by render_voice.py when it builds the job; recorded per row as `tts_text`.
TTS_RESPELLINGS: dict[str, str] = {"G'day": "Gidday"}  # Qwen3-TTS drops or garbles a line-initial "G'day" (it said "gay day",
# "day"); "Gidday" is the accepted alternative spelling, and Whisper writes the result as "G'day" (see tools/audio/README.md)


def words(text: str) -> list[str]:
    """Lower-case word tokens, apostrophes kept, digits spelt out, homophones and ASR respellings folded."""
    t = text.lower().replace("’", "'")
    t = re.sub(r"\ball ready\b", "already", t)
    out = []
    for w in re.findall(r"[a-z0-9']+", t):
        w = _DIGITS.get(w, w)
        w = re.sub(r"'s$", "s", w)
        out.append(ASR_ALIASES.get(w, w))
    return out


def tts_text(text: str) -> str:
    """The text handed to the TTS: the sheet's line with any TTS_RESPELLINGS applied (whole words only)."""
    for src, dst in TTS_RESPELLINGS.items():
        text = re.sub(rf"(?<![A-Za-z']){re.escape(src)}(?![A-Za-z'])", dst, text)
    return text


def wer(reference: str, hypothesis: str) -> float:
    r, h = words(reference), words(hypothesis)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / max(1, len(r))


def duration_bounds(text: str) -> tuple[float, float]:
    n = len(words(text))
    t = THRESHOLDS
    return (t["duration_min_base_s"] + t["duration_min_per_word_s"] * n,
            t["duration_max_base_s"] + t["duration_max_per_word_s"] * n)


def lift_semitones(median_hz: float | None, owner_median_hz: float | None) -> float | None:
    if not median_hz or not owner_median_hz:
        return None
    return 12.0 * math.log2(median_hz / owner_median_hz)


def screen_take(take: dict, text: str) -> dict:
    """Per-screen result for one take: {name: {"value", "threshold", "pass"}} plus "pass" for all of them.

    `take` carries wer, speaker_sim, seconds, raw_lufs, raw_true_peak_dbtp (a missing measurement fails
    its screen: an unmeasured take is not a candidate).
    """
    t = THRESHOLDS
    lo, hi = duration_bounds(text)
    secs = take.get("seconds")
    raw_i, raw_tp = take.get("raw_lufs"), take.get("raw_true_peak_dbtp")
    res = {
        "wer": {"value": take.get("wer"), "threshold": f"<= {t['wer_max']}",
                "pass": take.get("wer") is not None and take["wer"] <= t["wer_max"]},
        "speaker_sim": {"value": take.get("speaker_sim"), "threshold": f">= {t['speaker_sim_min']}",
                        "pass": take.get("speaker_sim") is not None and take["speaker_sim"] >= t["speaker_sim_min"]},
        "duration": {"value": secs, "threshold": f"{lo:.2f}..{hi:.2f} s",
                     "pass": secs is not None and lo <= secs <= hi},
        "raw_loudness": {"value": {"lufs": raw_i, "true_peak_dbtp": raw_tp},
                         "threshold": f"LUFS >= {t['raw_lufs_min']}, true peak <= {t['raw_true_peak_max_dbtp']} dBTP",
                         "pass": raw_i is not None and raw_tp is not None and raw_i >= t["raw_lufs_min"]
                         and raw_tp <= t["raw_true_peak_max_dbtp"]},
    }
    res["pass"] = all(v["pass"] for v in res.values())
    return res


def screen_export(lufs: float | None, true_peak_dbtp: float | None) -> dict:
    t = THRESHOLDS
    ok_i = lufs is not None and abs(lufs - t["export_lufs_target"]) <= t["export_lufs_tolerance_lu"]
    ok_tp = true_peak_dbtp is not None and true_peak_dbtp <= t["export_true_peak_max_dbtp"]
    return {"lufs": {"value": lufs, "threshold": f"{t['export_lufs_target']} +/- {t['export_lufs_tolerance_lu']} LU",
                     "pass": ok_i},
            "true_peak": {"value": true_peak_dbtp, "threshold": f"<= {t['export_true_peak_max_dbtp']} dBTP",
                          "pass": ok_tp},
            "pass": ok_i and ok_tp}


def score(take: dict, delivery: str) -> float:
    w = SCORE_WEIGHTS
    wer_v = take.get("wer")
    s = w["words"] * (1.0 - min(1.0 if wer_v is None else wer_v, 1.0)) + w["speaker_sim"] * max(take.get("speaker_sim") or 0.0, 0.0)
    if delivery == "hype":
        lift = take.get("lift_st")
        if lift is not None:
            s += w["hype_energy"] * min(max(lift / w["energy_full_lift_st"], 0.0), 1.0)
    return round(s, 4)


def pick_best(takes: list[dict], text: str, delivery: str) -> tuple[dict | None, bool]:
    """Return (best take, True if it passes every take screen). Each take gets `screens` and `score` set."""
    for tk in takes:
        tk["screens"] = screen_take(tk, text)
        tk["score"] = score(tk, delivery)
    if not takes:
        return None, False
    passing = [tk for tk in takes if tk["screens"]["pass"]]
    pool = passing or takes
    best = max(pool, key=lambda tk: (tk["score"], -tk["seed"]))
    return best, bool(passing)


def screen_summary() -> dict:
    """What manifest.json records under `screens`: thresholds, rule text, weights."""
    return {"thresholds": THRESHOLDS, "score_weights": SCORE_WEIGHTS, "asr_aliases": ASR_ALIASES,
            "homophone_rules": HOMOPHONE_RULES, "tts_respellings": TTS_RESPELLINGS,
            "pick_rule": ("Among takes passing the wer, speaker_sim, duration and raw_loudness screens, the highest "
                          "score = 0.6*(1-min(wer,1)) + 0.4*speaker_sim (+ 0.1*clip(lift_st/8,0,1) for hype rows); "
                          "ties to the lower seed. If no take passes, the row fails and the best score overall is "
                          "kept for the record. The export screen (decoded Opus LUFS and true peak) is checked on "
                          "the picked take.")}
