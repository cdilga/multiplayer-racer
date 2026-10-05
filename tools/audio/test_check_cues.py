#!/usr/bin/env python3
"""Tests for check_cues.py (P1-A00): the loader accepts the real sheet and refuses a sheet that breaks a rule.

Run:  python3 tools/audio/test_check_cues.py

Three fixture sheets in tools/audio/fixtures/cues/ are run through the command line (exit code and the problem
code it names), each differing from ok-rows.tsv by exactly one fault: a missing caption, an unflagged line, a
player name. The other rules are checked by corrupting a copy of the real sheet in a temp directory.
"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check_cues  # noqa: E402

CLI = HERE / "check_cues.py"
FIXTURES = HERE / "fixtures" / "cues"
COL = {name: i for i, name in enumerate(check_cues.COLUMNS)}


def run_cli(*args: str) -> tuple[int, str, str]:
    p = subprocess.run([sys.executable, str(CLI), *args], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def codes(stderr: str) -> set[str]:
    return set(re.findall(r"\[([a-z-]+)\]", stderr))


def real_rows() -> list[list[str]]:
    lines = check_cues.DEFAULT_SHEET.read_text(encoding="utf-8").splitlines()
    return [line.split("\t") for line in lines[1:] if line.strip()]


def check_mutated(rows: list[list[str]], rows_only: bool = False) -> set[str]:
    """Write rows (with the real header) to a temp sheet, run the loader in-process, return problem codes."""
    with tempfile.TemporaryDirectory() as d:
        sheet = Path(d) / "sheet.tsv"
        sheet.write_text("\t".join(check_cues.COLUMNS) + "\n" + "\n".join("\t".join(r) for r in rows) + "\n",
                         encoding="utf-8")
        return {p.code for p in check_cues.check_sheet(sheet, rows_only=rows_only).problems}


def first(rows: list[list[str]], moment: str, variant: str = "1") -> list[str]:
    return next(r for r in rows if r[COL["moment_id"]] == moment and r[COL["variant"]] == variant)


class RealSheet(unittest.TestCase):
    def test_real_sheet_passes(self) -> None:
        rc, out, err = run_cli()
        self.assertEqual(rc, 0, err)
        self.assertIn("OK:", out)
        self.assertEqual(err, "")

    def test_every_declared_moment_meets_its_floor(self) -> None:
        result = check_cues.check_sheet()
        self.assertEqual([str(p) for p in result.problems], [])
        for mid, moment in check_cues.MOMENTS.items():
            self.assertGreaterEqual(len(result.moments[mid]["cues"]), moment.floor, mid)

    def test_required_moments_from_the_bead_are_declared(self) -> None:
        for mid in ("welcome", "countdown", "final-lap", "door-off", "wheel-off", "big-air", "late-joiner",
                    "photo-finish", "winner", "next-round", "wreck", "lead-change"):
            self.assertIn(mid, check_cues.MOMENTS)

    def test_json_export_records_the_repeat_rule(self) -> None:
        rc, out, _ = run_cli("--json")
        self.assertEqual(rc, 0)
        self.assertIn('"no_immediate_repeat": true', out)

    def test_glossary_used_in_matches_the_sheet(self) -> None:
        self.assertEqual(check_cues.check_sheet().notes, [])


class Fixtures(unittest.TestCase):
    """Each bad fixture is ok-rows.tsv plus one fault; the loader must name that fault and nothing else."""

    def test_ok_fixture_is_accepted(self) -> None:
        rc, _, err = run_cli("--rows-only", str(FIXTURES / "ok-rows.tsv"))
        self.assertEqual(rc, 0, err)

    def test_missing_caption_is_refused(self) -> None:
        rc, _, err = run_cli("--rows-only", str(FIXTURES / "bad-missing-caption.tsv"))
        self.assertEqual(rc, 1)
        self.assertEqual(codes(err), {"missing-caption"}, err)

    def test_unflagged_line_is_refused(self) -> None:
        rc, _, err = run_cli("--rows-only", str(FIXTURES / "bad-unflagged.tsv"))
        self.assertEqual(rc, 1)
        self.assertEqual(codes(err), {"unflagged"}, err)

    def test_player_name_is_refused(self) -> None:
        rc, _, err = run_cli("--rows-only", str(FIXTURES / "bad-player-name.tsv"))
        self.assertEqual(rc, 1)
        self.assertEqual(codes(err), {"player-name"}, err)

    def test_missing_file_exits_2(self) -> None:
        rc, _, _ = run_cli(str(FIXTURES / "does-not-exist.tsv"))
        self.assertEqual(rc, 2)


class Corrupted(unittest.TestCase):
    """The rest of the guardrail, one corrupted copy of the real sheet per rule."""

    def mutate(self, moment: str, column: str, value: str, variant: str = "1") -> set[str]:
        rows = real_rows()
        first(rows, moment, variant)[COL[column]] = value
        return check_mutated(rows)

    def test_unmodified_copy_passes(self) -> None:
        self.assertEqual(check_mutated(real_rows()), set())

    def test_variant_floor_repeating(self) -> None:
        rows = [r for r in real_rows() if not (r[0] == "door-off" and r[1] in ("4", "5"))]
        self.assertIn("variants-short", check_mutated(rows))

    def test_variant_floor_once(self) -> None:
        rows = [r for r in real_rows() if not (r[0] == "winner" and r[1] != "1")]  # one variant, under the once floor
        self.assertIn("variants-short", check_mutated(rows))

    def test_required_moment_missing(self) -> None:
        rows = [r for r in real_rows() if r[0] != "photo-finish"]
        self.assertIn("moment-missing", check_mutated(rows))

    def test_unknown_moment(self) -> None:
        self.assertIn("moment-unknown", self.mutate("welcome", "moment_id", "party-time"))

    def test_wrong_trigger_event(self) -> None:
        self.assertIn("event", self.mutate("welcome", "trigger_event", "room.closed"))

    def test_bad_delivery(self) -> None:
        self.assertIn("delivery", self.mutate("welcome", "delivery", "shout"))

    def test_not_family_friendly_flag(self) -> None:
        self.assertIn("not-family-friendly", self.mutate("welcome", "family_friendly", "no"))

    def test_blank_slang_cell(self) -> None:
        self.assertIn("slang-missing", self.mutate("welcome", "slang_terms", ""))

    def test_unknown_slang_term(self) -> None:
        self.assertIn("slang-unknown", self.mutate("welcome", "slang_terms", "g'day; legend"))

    def test_slang_listed_but_unused(self) -> None:
        self.assertIn("slang-unused", self.mutate("welcome", "slang_terms", "g'day; crikey"))

    def test_slang_used_but_undeclared(self) -> None:
        self.assertIn("slang-undeclared", self.mutate("welcome", "slang_terms", "-"))

    def test_digit_in_speech(self) -> None:
        self.assertIn("number", self.mutate("final-lap", "text", "Final lap! Car 7 leads!", "2"))

    def test_car_number_in_words(self) -> None:
        self.assertIn("number", self.mutate("final-lap", "text", "Last lap! Number seven leads!", "2"))

    def test_colour(self) -> None:
        self.assertIn("colour", self.mutate("final-lap", "text", "Last lap! The red car leads!", "2"))

    def test_swearing(self) -> None:
        self.assertIn("banned-word", self.mutate("final-lap", "text", "Last lap! Bloody hold on!", "2"))

    def test_indigenous_joke(self) -> None:
        self.assertIn("indigenous-term", self.mutate("wheel-off", "text", "That wheel's gone bunyip hunting!"))

    def test_walkabout_approved(self) -> None:
        # Owner, 2026-10-06: "walkabout is categorically approved forever" (R114). It must never be flagged.
        self.assertNotIn("indigenous-term", self.mutate("wheel-off", "text", "That wheel's gone walkabout!"))

    def test_glossary_dont_say(self) -> None:
        self.assertIn("glossary-dont-say", self.mutate("final-lap", "text", "Last lap! Check your device!", "2"))

    def test_us_spelling(self) -> None:
        self.assertIn("us-spelling", self.mutate("final-lap", "text", "Last lap! Your favorite car leads!", "2"))

    def test_too_long_callout(self) -> None:
        long_line = "Last lap and the whole pack is bunched up tight so hold on to your doors now"
        self.assertIn("too-long", self.mutate("final-lap", "text", long_line, "2"))

    def test_caption_must_track_speech(self) -> None:
        self.assertIn("caption-mismatch", self.mutate("final-lap", "caption", "Totally different words here", "2"))

    def test_duplicate_text(self) -> None:
        rows = real_rows()
        a, b = first(rows, "door-off", "1"), first(rows, "door-off", "2")
        b[COL["text"]], b[COL["caption"]], b[COL["slang_terms"]] = a[COL["text"]], a[COL["caption"]], a[COL["slang_terms"]]
        self.assertIn("duplicate-text", check_mutated(rows))

    def test_variant_gap(self) -> None:
        rows = [r for r in real_rows() if not (r[0] == "door-off" and r[1] == "2")]
        self.assertIn("variant", check_mutated(rows))

    def test_non_ascii(self) -> None:
        self.assertIn("non-ascii", self.mutate("final-lap", "text", "Last lap — hold on to your doors!", "2"))

    def test_wrong_field_count(self) -> None:
        rows = real_rows()
        rows[0] = rows[0][:-1]
        self.assertIn("fields", check_mutated(rows))

    def test_curated_name_list(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            names = Path(d) / "names.json"
            names.write_text('["Davo"]', encoding="utf-8")
            sheet = Path(d) / "sheet.tsv"
            rows = real_rows()
            first(rows, "final-lap", "2")[COL["text"]] = "Last lap! Davo is flat out!"
            sheet.write_text("\t".join(check_cues.COLUMNS) + "\n" + "\n".join("\t".join(r) for r in rows) + "\n",
                             encoding="utf-8")
            result = check_cues.check_sheet(sheet, names_path=names)
            self.assertTrue(any(p.code == "player-name" and "Davo" in p.message for p in result.problems))


if __name__ == "__main__":
    unittest.main(verbosity=2)
