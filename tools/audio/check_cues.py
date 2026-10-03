#!/usr/bin/env python3
"""check_cues.py: the loader and guardrail for the announcer cue sheet (P1-A00).

WHY THIS EXISTS
---------------
`tools/audio/cues-playtest1.tsv` is the one shared vocabulary of announcer moments: A01 renders every row
in the owner's cloned voice, A03 fires each moment from its game event and shows its caption. This tool is
the loader both of them go through, and the guardrail that keeps the sheet inside the rules
(Playtest-1 plan P1-A00; master R53/R55/R69; `docs/copy/australianisms.md`; `art/ui/GUIDE.md` §11):

  * 8 columns, in order: moment_id, variant, trigger_event, text, caption, delivery, slang_terms,
    family_friendly. Tab separated, one header row, ASCII only (the TTS and the caption font see this text).
  * moment_id comes from MOMENTS below (the shared list) and trigger_event must be that moment's event.
  * Variant floors (a floor, not a cap): a moment that can fire repeatedly in a round has at least 4
    variants; a once-a-round moment has at least 2. Every variant is numbered 1..N with no gaps and no
    repeated text.
  * Every line has a caption (short, and it must track the speech), a delivery of `hype` or `warm`,
    and a family-friendly flag of `yes`. A blank flag is "unflagged" and is refused.
  * slang_terms lists, by canonical name, every glossary term the line uses (`-` for none). Each must be in
    the glossary table, flagged family friendly, sourced, and really present in the text; a glossary term
    in the text but not listed is refused.
  * No player names (R69): no placeholders such as {name} or <player>, no capitalised word mid-sentence
    other than the allowed few, no name from the curated name list if one exists.
  * No car numbers or colours in Playtest 1 (Q-A5), no digits in speech.
  * No swearing, alcohol or violence words, no put-downs, no Indigenous cultural terms, no brands, none of
    GUIDE §11's "don't say" words, US spellings refused (Australian English).
  * In-race callouts are about 8 words: the hard limit per moment is in MOMENTS.

NO-IMMEDIATE-REPEAT RULE (for A03). Every moment records `no_immediate_repeat: true` in the JSON export:
A03 never plays the same variant of a moment twice in a row, including across rounds. A moment with
exactly one variant is impossible here (the floors are at least 2), so the rule can always be met.

Usage:
    tools/audio/check_cues.py                    validate the real sheet; exit 0, or 1 naming each problem
    tools/audio/check_cues.py SHEET.tsv          validate another sheet
    tools/audio/check_cues.py --rows-only SHEET  row rules only (no required moments or variant floors),
                                                 for fixtures and drafts
    tools/audio/check_cues.py --moments          print the moment table (id, kind, event, floor, fires)
    tools/audio/check_cues.py --json             on success, print the sheet as JSON (moments + cues)
                                                 for A01's render and A03's triggers
    tools/audio/check_cues.py --glossary FILE --names FILE   override the glossary or the name list

As a module (A01's render uses this):
    from check_cues import check_sheet
    result = check_sheet(sheet_path)        # result.problems == [] when the sheet is good
    result.moments["door-off"]["cues"]      # list of {variant, text, caption, delivery, slang_terms}

Exit codes: 0 pass, 1 the sheet breaks a rule (each problem is printed as `file:line: [code] message`),
2 a file could not be read.

A06 adds its derby and item moments by adding entries to MOMENTS and rows to the sheet, and may extend
the glossary; this file is the only place a moment is declared.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DEFAULT_SHEET = HERE / "cues-playtest1.tsv"
DEFAULT_GLOSSARY = REPO / "docs" / "copy" / "australianisms.md"
DEFAULT_NAMES = REPO / "web" / "controller" / "src" / "join" / "names.json"

COLUMNS = [
    "moment_id", "variant", "trigger_event", "text", "caption", "delivery", "slang_terms", "family_friendly",
]
DELIVERIES = {"hype", "warm"}
FLOOR_REPEAT = 4  # a moment that can fire many times in a round
FLOOR_ONCE = 2  # a once-a-round moment
MAX_CAPTION_CHARS = 90
MIN_CAPTION_OVERLAP = 0.6  # share of caption words that also appear in the speech
ALLOWED_CAPS = {"Joystick", "Jammers", "Bondi"}  # capitalised mid-sentence words that are not names


@dataclass(frozen=True)
class Moment:
    id: str
    kind: str  # "once" (once a round or once a room) or "repeat" (can fire many times in a round)
    event: str  # the game event that fires it
    fires: str  # when exactly, for A03
    max_words: int  # hard limit on spoken words
    cooldown_s: float  # advisory default for A03 (TUNE): do not fire this moment again sooner
    priority: int  # advisory for A03 (TUNE): 1 wins; a callout that arrives mid-clip is dropped, not queued

    @property
    def floor(self) -> int:
        return FLOOR_REPEAT if self.kind == "repeat" else FLOOR_ONCE


# The shared moment list. Event names are the cue sheet's names for the director and sim events in
# Playtest-1 plan §4.4 (`Events{batch}`: joins, detaches, wrecks, laps, finishes, results) and §9 (phases);
# A03 maps each one to the real event. DEFAULTs and thresholds below are TUNE.
MOMENTS: dict[str, Moment] = {m.id: m for m in [
    Moment("welcome", "once", "room.opened",
           "The host room is open and audio is unlocked by the first gesture. Once per room.", 18, 0, 3),
    Moment("all-ready", "once", "lobby.all_ready",
           "Every active human seat is Ready, just before Countdown. Not for host Start now.", 12, 0, 3),
    Moment("countdown", "once", "phase.countdown",
           "Countdown phase begins (3-2-1). A03 starts the clip so its last word lands on the race start.",
           10, 0, 1),
    Moment("final-lap", "once", "race.final_lap",
           "The leader starts the last lap. Skipped when the round has fewer than 2 laps.", 10, 0, 2),
    Moment("first-finisher", "once", "race.first_finish",
           "The first car crosses the finish line (the finish window starts).", 10, 0, 2),
    Moment("photo-finish", "once", "race.photo_finish",
           "A second car crosses within 0.5 s of the first, inside the finish window (DEFAULT, TUNE).",
           10, 0, 2),
    Moment("time-up", "once", "race.time_up",
           "The finish window or the deadline closes while at least one car has not finished.", 12, 0, 2),
    Moment("winner", "once", "round.results",
           "Results are revealed (Finalising to Intermission). Generic: the TV shows who won.", 16, 0, 1),
    Moment("next-round", "once", "intermission.next_ready",
           "The next round's map is ready and the intermission auto-start is running.", 14, 0, 3),
    Moment("door-off", "repeat", "part.detached.door",
           "A door part detaches (health 0). Loose does not count.", 10, 6, 3),
    Moment("wheel-off", "repeat", "part.detached.wheel",
           "A wheel part detaches (health 0).", 10, 6, 3),
    Moment("bodywork-off", "repeat", "part.detached.bodywork",
           "The `front` or `back` part detaches (health 0).", 10, 6, 3),
    Moment("big-air", "repeat", "car.air_time",
           "A car's airtime passes 1.2 s while still airborne (the reel threshold, DEFAULT, TUNE).", 10, 10, 3),
    Moment("wreck", "repeat", "car.wrecked",
           "A car is wrecked (2+ wheels detached, flipped past the recovery timeout, or out of bounds).",
           10, 6, 2),
    Moment("lead-change", "repeat", "race.lead_change",
           "A different car takes first place and holds it for 2 s (debounce, DEFAULT, TUNE).", 10, 12, 3),
    Moment("late-joiner", "repeat", "seat.late_join",
           "A seat joins a running round and is placed at the tail (drop-in).", 10, 6, 3),
]}

# ---- rule vocabularies (word lists are deliberately conservative) -------------------------------------------

_NUMBER_WORDS = (r"one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|"
                 r"sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred")
DIGIT_WORDS = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
               "7": "seven", "8": "eight", "9": "nine"}
COLOURS = (r"red|blue|green|yellow|orange|purple|pink|black|white|grey|gray|silver|gold|golden|brown|teal|cyan|"
           r"magenta|violet|crimson|scarlet")
# (code, regex, message)
WORD_RULES = [
    ("banned-word", r"bloody|bugger\w*|bastard\w*|piss\w*|crap\w*|shit\w*|fuck\w*|damn\w*|hell|arse\w*|"
                    r"ass|asshole|bitch\w*|slut\w*|cunt\w*|wank\w*|dick\w*|cock|tits?|boobs?|bollocks|"
                    r"beer|booze|grog|pub|drunk\w*|stoned|kill\w*|murder\w*|suicide|rape\w*|die|died|dies|"
                    r"dying|death",
     "swearing, alcohol, violence or death word"),
    ("banned-word", r"bogan\w*|bludger\w*|hoon\w*|drongo\w*|wowser\w*|sook\w*|spaz\w*|spastic\w*|retard\w*|"
                    r"cripple\w*|psycho\w*|nutter\w*|mental|lunatic\w*|moron\w*|idiot\w*|stupid|dumb|loser\w*",
     "put-down for a kind of person (nothing punching down)"),
    ("indigenous-term", r"walkabout|dreamtime|dreaming|didgeridoo|yidaki|yakka|cooee|corroboree|bunyip|yowie|"
                        r"galah|songlines?",
     "Indigenous cultural term (not for jokes)"),
    ("brand", r"maccas|mcdonald\w*|esky|vegemite|kfc|holden|toyota|bunnings|woolies|coles|coke|pepsi",
     "brand name"),
    ("glossary-dont-say", r"lobby|session|server|vehicle|kart|ride|seat|slot|remote|client|device|admin|heat|"
                          r"level|match",
     "GUIDE §11 'don't say' word; use room / round / number / car / host / controller"),
    ("us-spelling", r"colors?|center\w*|tires?|organi[sz]e\w*|favorite\w*|meters?|realize\w*|license|defense|"
                    r"theater|neighbor\w*|humor|honor|traveled|canceled|labeled|mom",
     "US spelling; use Australian English"),
]
PLACEHOLDER_RE = re.compile(r"[{}<>\[\]]|%[sd]|\$\w|@\w|\bplayer[ _-]?name\b|\b(tbd|todo|xxx|lorem)\b", re.I)
NAME_WORD_RE = re.compile(r"\bnames?\b|\bnamed\b", re.I)


@dataclass
class Problem:
    path: str
    line: int
    code: str
    message: str

    def __str__(self) -> str:
        where = f"{self.path}:{self.line}" if self.line else self.path
        return f"{where}: [{self.code}] {self.message}"


@dataclass
class Term:
    canonical: str
    forms: list[str]
    family_friendly: str
    sensitivity: str
    source: str
    used_in: set[str]
    line: int


@dataclass
class Result:
    sheet: str
    rows: list[dict] = field(default_factory=list)
    problems: list[Problem] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    moments: dict = field(default_factory=dict)
    glossary: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.problems


# ---- helpers -------------------------------------------------------------------------------------------------

def norm(s: str) -> str:
    return s.replace("’", "'").replace("`", "").strip()


def words(s: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9']+", s)


def form_regex(form: str) -> re.Pattern:
    return re.compile(r"(?<![\w'])" + re.escape(norm(form).lower()) + r"(?![\w'])")


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO))
    except ValueError:
        return str(path)


# ---- glossary ------------------------------------------------------------------------------------------------

def load_glossary(path: Path, problems: list[Problem]) -> dict[str, Term]:
    """Read every markdown table whose header has `Term` and `Family-friendly` columns."""
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    terms: dict[str, Term] = {}
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.lstrip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            header = [c.strip().lower() for c in line.strip().strip("|").split("|")]
            j = i + 2
            if "term" in header and "family-friendly" in header:
                col = {name: header.index(name) for name in header}
                while j < len(lines) and lines[j].lstrip().startswith("|"):
                    cells = [c.strip() for c in lines[j].strip().strip("|").split("|")]
                    if len(cells) != len(header):
                        problems.append(Problem(rel(path), j + 1, "glossary",
                                                f"row has {len(cells)} cells, header has {len(header)}"))
                    else:
                        forms = [norm(f) for f in re.split(r"\s+/\s+", cells[col["term"]]) if norm(f)]
                        used = {norm(u).lower() for u in cells[col["used in"]].split(",")} if "used in" in col else set()
                        used.discard("none yet")
                        used.discard("")
                        term = Term(forms[0], forms, cells[col["family-friendly"]].strip().lower(),
                                    cells[col["sensitivity note"]] if "sensitivity note" in col else "x",
                                    cells[col["source"]] if "source" in col else "",
                                    used, j + 1)
                        for need in ("meaning", "where it fits", "sensitivity note", "source"):
                            if need in col and not cells[col[need]].strip():
                                problems.append(Problem(rel(path), j + 1, "glossary-empty",
                                                        f"term '{term.canonical}' has an empty {need} cell"))
                        if term.family_friendly not in ("yes", "no"):
                            problems.append(Problem(rel(path), j + 1, "glossary-flag",
                                                    f"term '{term.canonical}' family-friendly must be yes or no"))
                        if not (re.search(r"ANDC|Macquarie|Green's", term.source)
                                and re.search(r"https?://|australian-words-", term.source)):
                            problems.append(Problem(rel(path), j + 1, "glossary-source",
                                                    f"term '{term.canonical}' needs a source naming ANDC, "
                                                    "Macquarie or Green's with its page"))
                        if term.canonical in terms:
                            problems.append(Problem(rel(path), j + 1, "glossary",
                                                    f"term '{term.canonical}' appears twice"))
                        terms[term.canonical] = term
                    j += 1
            i = j
        else:
            i += 1
    if not terms:
        problems.append(Problem(rel(path), 0, "glossary", "no term table found (needs Term and Family-friendly columns)"))
    return terms


def load_names(path: Path | None) -> list[str]:
    if path is None or not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("names", list(data.values()))
    out = []
    for item in data:
        name = item.get("name") if isinstance(item, dict) else item
        if isinstance(name, str) and len(name.strip()) >= 3:
            out.append(name.strip())
    return out


# ---- row rules -----------------------------------------------------------------------------------------------

def mid_sentence_capitals(s: str) -> list[str]:
    found = []
    for m in re.finditer(r"[A-Za-z][A-Za-z']*", s):
        w = m.group(0)
        if not w[0].isupper() or len(w) < 2 or w in ALLOWED_CAPS or w.startswith("I'"):
            continue
        before = s[: m.start()].rstrip()
        if before == "" or before[-1] in ".!?":
            continue
        found.append(w)
    return found


def check_line_text(label: str, s: str, moment_id: str, is_caption: bool, names: list[str]) -> list[tuple[str, str]]:
    """Content rules shared by speech and caption. Returns (code, message) pairs."""
    out: list[tuple[str, str]] = []
    low = norm(s).lower()
    if any(ord(c) > 126 or (ord(c) < 32) for c in s):
        out.append(("non-ascii", f"{label} must be plain ASCII (straight apostrophes, no dashes or emoji)"))
    if PLACEHOLDER_RE.search(s):
        out.append(("player-name", f"{label} has a placeholder or token ({PLACEHOLDER_RE.search(s).group(0)!r}); "
                                   "no player names (R69)"))
    if NAME_WORD_RE.search(s):
        out.append(("player-name", f"{label} says 'name'; no player names (R69)"))
    for w in mid_sentence_capitals(s):
        out.append(("player-name", f"{label} has capitalised word {w!r} mid-sentence: looks like a name "
                                   f"(allowed: {', '.join(sorted(ALLOWED_CAPS))})"))
    for n in names:
        if re.search(r"(?<![\w'])" + re.escape(n.lower()) + r"(?![\w'])", low):
            out.append(("player-name", f"{label} contains the curated player name {n!r}"))
    # numbers: no digits (spell it), no car numbers; the countdown caption may show 3-2-1
    if re.search(r"\d", s) and not (is_caption and moment_id == "countdown"):
        out.append(("number", f"{label} has digits; no car numbers in Playtest 1 (R55, Q-A5), spell any count out"))
    if re.search(r"#\s*\d", s) or re.search(rf"\b(number|car|player)\s+(\d+|{_NUMBER_WORDS})\b", low):
        out.append(("number", f"{label} calls a car or player by number (Q-A5 keeps this for Full)"))
    if re.search(rf"\b({COLOURS})\b", low):
        out.append(("colour", f"{label} names a colour; no car colours in Playtest 1 (Q-A5)"))
    for code, rx, msg in WORD_RULES:
        m = re.search(rf"\b({rx})\b", low)
        if m:
            out.append((code, f"{label} uses {m.group(1)!r}: {msg}"))
    return out


def check_rows(rows: list[dict], glossary: dict[str, Term], names: list[str], path: str) -> list[Problem]:
    problems: list[Problem] = []

    def add(row: dict, code: str, msg: str) -> None:
        problems.append(Problem(path, row["line"], code, msg))

    for row in rows:
        mid = row["moment_id"]
        moment = MOMENTS.get(mid)
        tag = f"{mid or '(blank)'} v{row['variant']}"
        if moment is None:
            add(row, "moment-unknown", f"{mid!r} is not a declared moment (known: {', '.join(MOMENTS)})")
        elif row["trigger_event"] != moment.event:
            add(row, "event", f"{tag}: trigger_event {row['trigger_event']!r} must be {moment.event!r}")
        if not re.fullmatch(r"[1-9]\d*", row["variant"]):
            add(row, "variant", f"{tag}: variant must be a positive integer")

        text, caption = row["text"], row["caption"]
        if not text.strip():
            add(row, "text-empty", f"{tag}: spoken text is empty")
        if not caption.strip():
            add(row, "missing-caption", f"{tag}: caption is empty (A03 shows a caption for every cue)")
        elif len(caption) > MAX_CAPTION_CHARS:
            add(row, "caption-long", f"{tag}: caption is {len(caption)} characters (max {MAX_CAPTION_CHARS})")
        if text.strip() and caption.strip():
            def norm_words(s: str) -> list[str]:
                return [DIGIT_WORDS.get(w, w) for w in re.findall(r"[a-z0-9']+", s.lower())]
            cw, tw = norm_words(caption), set(norm_words(text))
            if cw and sum(1 for w in cw if w in tw) / len(cw) < MIN_CAPTION_OVERLAP:
                add(row, "caption-mismatch", f"{tag}: caption must track the speech "
                                             f"(under {int(MIN_CAPTION_OVERLAP * 100)}% of its words are spoken)")

        if row["delivery"] not in DELIVERIES:
            add(row, "delivery", f"{tag}: delivery {row['delivery']!r} must be one of {sorted(DELIVERIES)}")

        flag = row["family_friendly"].strip().lower()
        if not flag:
            add(row, "unflagged", f"{tag}: family_friendly is blank; every shipped line must be flagged yes")
        elif flag != "yes":
            add(row, "not-family-friendly", f"{tag}: family_friendly is {flag!r}; only 'yes' lines ship")

        if text.strip():
            for code, msg in check_line_text("text", text, mid, False, names):
                add(row, code, f"{tag}: {msg}")
            if any(len(w) > 1 and w.isupper() and w.isalpha() for w in words(text)):
                add(row, "caps", f"{tag}: all-caps word in speech (the TTS may spell it out)")
            limit = moment.max_words if moment else 16
            if len(words(text)) > limit:
                add(row, "too-long", f"{tag}: {len(words(text))} spoken words, limit {limit} for this moment")
        if caption.strip():
            for code, msg in check_line_text("caption", caption, mid, True, names):
                add(row, code, f"{tag}: {msg}")

        # slang terms: declared, known, flagged, present; and no undeclared glossary term in the text
        slang_cell = row["slang_terms"].strip()
        declared: list[str] = []
        if not slang_cell:
            add(row, "slang-missing", f"{tag}: slang_terms is blank (use '-' for none)")
        elif slang_cell != "-":
            declared = [norm(t) for t in slang_cell.split(";") if norm(t)]
        low = norm(text).lower()
        for t in declared:
            term = glossary.get(t)
            if term is None:
                add(row, "slang-unknown", f"{tag}: {t!r} is not a canonical term in docs/copy/australianisms.md")
                continue
            if term.family_friendly != "yes":
                add(row, "slang-unflagged", f"{tag}: glossary does not flag {t!r} family friendly")
            if not any(form_regex(f).search(low) for f in term.forms):
                add(row, "slang-unused", f"{tag}: slang_terms lists {t!r} but the text does not use it")
        for term in glossary.values():
            if term.canonical not in declared and any(form_regex(f).search(low) for f in term.forms):
                add(row, "slang-undeclared", f"{tag}: text uses glossary term {term.canonical!r} "
                                             "but slang_terms does not list it")
    return problems


# ---- moment rules --------------------------------------------------------------------------------------------

def check_moments(rows: list[dict], path: str, rows_only: bool) -> list[Problem]:
    problems: list[Problem] = []
    by_moment: dict[str, list[dict]] = {}
    for r in rows:
        by_moment.setdefault(r["moment_id"], []).append(r)
    for mid, mrows in by_moment.items():
        seen_variant: dict[str, int] = {}
        seen_text: dict[str, int] = {}
        for r in mrows:
            v = r["variant"]
            if v in seen_variant:
                problems.append(Problem(path, r["line"], "variant",
                                        f"{mid}: variant {v} repeats the one on line {seen_variant[v]}"))
            seen_variant.setdefault(v, r["line"])
            key = re.sub(r"\W+", " ", r["text"].lower()).strip()
            if key and key in seen_text:
                problems.append(Problem(path, r["line"], "duplicate-text",
                                        f"{mid} v{v}: same text as the variant on line {seen_text[key]}"))
            seen_text.setdefault(key, r["line"])
        nums = sorted(int(r["variant"]) for r in mrows if r["variant"].isdigit())
        if nums and nums != list(range(1, len(nums) + 1)) and len(set(nums)) == len(nums):
            problems.append(Problem(path, mrows[0]["line"], "variant",
                                    f"{mid}: variants must be numbered 1..N with no gaps (got {nums})"))
    if not rows_only:
        for m in MOMENTS.values():
            n = len(by_moment.get(m.id, []))
            if n == 0:
                problems.append(Problem(path, 0, "moment-missing",
                                        f"moment {m.id!r} ({m.event}) has no rows; the sheet must cover it"))
            elif n < m.floor:
                problems.append(Problem(path, by_moment[m.id][0]["line"], "variants-short",
                                        f"{m.id}: {n} variant(s), floor is {m.floor} for a {m.kind} moment"))
    return problems


# ---- loading -------------------------------------------------------------------------------------------------

def read_rows(path: Path, problems: list[Problem]) -> list[dict]:
    rel_path = rel(path)
    raw = path.read_text(encoding="utf-8").splitlines()
    rows: list[dict] = []
    header_seen = False
    for i, line in enumerate(raw, start=1):
        if not line.strip():
            continue
        cells = line.split("\t")
        if not header_seen:
            header_seen = True
            if cells != COLUMNS:
                problems.append(Problem(rel_path, i, "header", f"header must be exactly: {chr(9).join(COLUMNS)}"))
                return rows
            continue
        if len(cells) != len(COLUMNS):
            problems.append(Problem(rel_path, i, "fields", f"{len(cells)} tab-separated fields, expected {len(COLUMNS)}"))
            continue
        row = dict(zip(COLUMNS, cells))
        row["line"] = i
        rows.append(row)
    if not header_seen:
        problems.append(Problem(rel_path, 0, "header", "the sheet is empty"))
    return rows


def check_sheet(sheet: Path = DEFAULT_SHEET, glossary_path: Path = DEFAULT_GLOSSARY,
                names_path: Path | None = DEFAULT_NAMES, rows_only: bool = False) -> Result:
    result = Result(sheet=rel(Path(sheet)))
    glossary = load_glossary(Path(glossary_path), result.problems)
    names = load_names(Path(names_path)) if names_path else []
    rows = read_rows(Path(sheet), result.problems)
    result.rows = rows
    result.glossary = glossary
    result.problems += check_rows(rows, glossary, names, result.sheet)
    result.problems += check_moments(rows, result.sheet, rows_only)
    result.problems.sort(key=lambda p: (p.line, p.code))

    # the glossary's "Used in" column should match the sheet (a note, not a failure)
    if not result.problems and not rows_only:
        actual: dict[str, set[str]] = {}
        for r in rows:
            for t in [norm(x) for x in r["slang_terms"].split(";") if norm(x)] if r["slang_terms"] != "-" else []:
                actual.setdefault(t, set()).add(r["moment_id"])
        for t, term in glossary.items():
            if actual.get(t, set()) != term.used_in:
                result.notes.append(f"note: glossary 'Used in' for {t!r} says {sorted(term.used_in)}, "
                                    f"sheet uses it in {sorted(actual.get(t, set()))}")

    for m in MOMENTS.values():
        mrows = sorted((r for r in rows if r["moment_id"] == m.id), key=lambda r: int(r["variant"])
                       if r["variant"].isdigit() else 0)
        result.moments[m.id] = {
            "kind": m.kind, "event": m.event, "fires": m.fires, "min_variants": m.floor,
            "max_words": m.max_words, "cooldown_s": m.cooldown_s, "priority": m.priority,
            "no_immediate_repeat": True,
            "cues": [{"variant": int(r["variant"]) if r["variant"].isdigit() else r["variant"],
                      "text": r["text"], "caption": r["caption"], "delivery": r["delivery"],
                      "slang_terms": [] if r["slang_terms"] == "-" else [norm(t) for t in r["slang_terms"].split(";")]}
                     for r in mrows],
        }
    return result


def print_moments() -> None:
    print(f"{'moment':<16}{'kind':<8}{'floor':<6}{'event':<26}fires")
    for m in MOMENTS.values():
        print(f"{m.id:<16}{m.kind:<8}{m.floor:<6}{m.event:<26}{m.fires}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Validate the announcer cue sheet (P1-A00).")
    ap.add_argument("sheet", nargs="?", default=str(DEFAULT_SHEET))
    ap.add_argument("--glossary", default=str(DEFAULT_GLOSSARY))
    ap.add_argument("--names", default=str(DEFAULT_NAMES), help="JSON list of curated player names, if any")
    ap.add_argument("--rows-only", action="store_true", help="skip required moments and variant floors")
    ap.add_argument("--moments", action="store_true", help="print the moment table and exit")
    ap.add_argument("--json", action="store_true", help="on success, print the sheet as JSON")
    args = ap.parse_args(argv)

    if args.moments:
        print_moments()
        return 0
    try:
        result = check_sheet(Path(args.sheet), Path(args.glossary), Path(args.names), args.rows_only)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"check_cues: cannot read input: {exc}", file=sys.stderr)
        return 2

    if result.problems:
        for p in result.problems:
            print(p, file=sys.stderr)
        print(f"FAIL: {len(result.problems)} problem(s) in {result.sheet}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps({"sheet": result.sheet, "moments": result.moments}, indent=2))
        return 0
    for note in result.notes:
        print(note)
    counts = ", ".join(f"{k}={len(v['cues'])}" for k, v in result.moments.items() if v["cues"])
    scope = "rows only" if args.rows_only else f"{len(MOMENTS)} moments covered"
    print(f"OK: {len(result.rows)} rows in {result.sheet} ({scope}; glossary {len(result.glossary)} terms)")
    print(f"variants: {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
