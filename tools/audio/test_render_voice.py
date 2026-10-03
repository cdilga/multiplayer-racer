#!/usr/bin/env python3
"""Tests for render_voice.py and voice_screens.py (P1-A01). No GPU and no ssh: runs on the Mac.

Run:  python3 tools/audio/test_render_voice.py

* the render command REFUSES a sheet that A00's loader rejects, and sends nothing to eris;
* it accepts the real sheet (dry run) and builds one job row per sheet row, in sheet order;
* the screens (WER with digit/alias normalisation, speaker similarity, duration, loudness) and the pick rule.
"""
from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check_cues  # noqa: E402
import render_voice  # noqa: E402
import voice_screens as S  # noqa: E402

FIXTURES = HERE / "fixtures" / "cues"


def run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.object(render_voice, "ssh", side_effect=AssertionError("ssh must not be called")), \
            mock.patch.object(render_voice.subprocess, "run", side_effect=AssertionError("no subprocess before the sheet passes")), \
            redirect_stdout(out), redirect_stderr(err):
        rc = render_voice.main(argv)
    return rc, out.getvalue(), err.getvalue()


class RefusesBadSheets(unittest.TestCase):
    def test_bad_fixture_is_refused_and_nothing_is_sent(self) -> None:
        for name in ("bad-missing-caption.tsv", "bad-unflagged.tsv", "bad-player-name.tsv"):
            rc, _, err = run(["--sheet", str(FIXTURES / name)])
            self.assertEqual(rc, 1, name)
            self.assertIn("REFUSED", err)
            self.assertIn("nothing was sent", err)

    def test_the_refusal_names_the_fault(self) -> None:
        _, _, err = run(["--sheet", str(FIXTURES / "bad-unflagged.tsv")])
        self.assertIn("[unflagged]", err)
        _, _, err = run(["--sheet", str(FIXTURES / "bad-player-name.tsv")])
        self.assertIn("[player-name]", err)

    def test_unreadable_sheet_exits_2(self) -> None:
        rc, _, _ = run(["--sheet", str(FIXTURES / "does-not-exist.tsv")])
        self.assertEqual(rc, 2)

    def test_fewer_than_three_candidates_is_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            with redirect_stderr(io.StringIO()):
                render_voice.main(["--candidates", "2", "--dry-run"])


class RealSheet(unittest.TestCase):
    def test_dry_run_accepts_the_real_sheet(self) -> None:
        rc, out, err = run(["--sheet", str(check_cues.DEFAULT_SHEET), "--dry-run"])
        self.assertEqual(rc, 0, err)
        self.assertIn("sheet OK", out)

    def test_unknown_moment_in_only_is_rejected(self) -> None:
        rc, _, err = run(["--only", "not-a-moment"])
        self.assertEqual(rc, 2)
        self.assertIn("not-a-moment", err)

    def test_job_has_one_row_per_sheet_row_in_order(self) -> None:
        result = check_cues.check_sheet(check_cues.DEFAULT_SHEET)
        job = render_voice.build_job(result, check_cues.DEFAULT_SHEET)
        self.assertEqual(len(job["rows"]), len(result.rows))
        self.assertEqual([r["id"] for r in job["rows"]], [f"{r['moment_id']}-{r['variant']}" for r in result.rows])
        self.assertTrue(all(r["delivery"] in ("hype", "warm") for r in job["rows"]))
        self.assertEqual(len({r["id"] for r in job["rows"]}), len(job["rows"]))


class Wer(unittest.TestCase):
    def test_exact_and_digits(self) -> None:
        self.assertEqual(S.wer("Three! Two! One! Go, go, go!", "3, 2, 1, go, go, go."), 0.0)
        self.assertEqual(S.wer("G'day, mate!", "G’day mate"), 0.0)

    def test_one_wrong_word_counts(self) -> None:
        self.assertAlmostEqual(S.wer("Look at that air", "Look at that hair"), 0.25)

    def test_alias_folds_asr_respelling(self) -> None:
        self.assertEqual(S.wer("Look at that air! Strewth!", "Look at that air. Struth."), 0.0)  # built-in alias
        with mock.patch.dict(S.ASR_ALIASES, {"bonza": "bonzer"}):
            self.assertEqual(S.wer("That's bonzer!", "That's bonza."), 0.0)
        self.assertGreater(S.wer("That's bonzer!", "That's bonza."), 0.0)

    def test_homophones_are_folded_but_real_errors_are_not(self) -> None:
        self.assertEqual(S.wer("Door's off! Free air-conditioning!", "Doors off. Free air conditioning."), 0.0)
        self.assertEqual(S.wer("All ready! This one's going to be a ripper!", "Already, this one's going to be a ripper."), 0.0)
        self.assertGreater(S.wer("Wheel's off!", "Wheel off."), 0.0)
        self.assertGreater(S.wer("G'day, new driver!", "Gay new driver."), 0.0)

    def test_tts_respelling_changes_only_whole_words(self) -> None:
        with mock.patch.dict(S.TTS_RESPELLINGS, {"G'day": "Gday"}):
            self.assertEqual(S.tts_text("G'day, new driver! G'days"), "Gday, new driver! G'days")
        self.assertEqual(S.tts_text("G'day, mate"), "Gidday, mate")  # the built-in respelling
        self.assertEqual(S.tts_text("Look at that air!"), "Look at that air!")


def good_take(**kw) -> dict:
    t = {"seed": 1000, "wer": 0.0, "speaker_sim": 0.97, "seconds": 2.5, "raw_lufs": -22.0, "raw_true_peak_dbtp": -6.0, "lift_st": 5.0}
    t.update(kw)
    return t


class Screens(unittest.TestCase):
    TEXT = "Final lap! Hold on to your doors!"  # 7 words -> duration window 1.45..6.2 s

    def test_a_good_take_passes_every_screen(self) -> None:
        self.assertTrue(S.screen_take(good_take(), self.TEXT)["pass"])

    def test_each_screen_can_fail_alone(self) -> None:
        cases = {"wer": {"wer": 0.14}, "speaker_sim": {"speaker_sim": 0.89}, "duration": {"seconds": 30.0},
                 "raw_loudness": {"raw_lufs": -60.0}}
        for name, patch in cases.items():
            res = S.screen_take(good_take(**patch), self.TEXT)
            self.assertFalse(res[name]["pass"], name)
            self.assertEqual([k for k, v in res.items() if k != "pass" and not v["pass"]], [name])
            self.assertFalse(res["pass"])

    def test_too_short_is_truncated(self) -> None:
        self.assertFalse(S.screen_take(good_take(seconds=0.5), self.TEXT)["duration"]["pass"])

    def test_clipped_raw_take_fails(self) -> None:
        self.assertFalse(S.screen_take(good_take(raw_true_peak_dbtp=0.4), self.TEXT)["raw_loudness"]["pass"])

    def test_unmeasured_take_is_not_a_candidate(self) -> None:
        self.assertFalse(S.screen_take(good_take(wer=None), self.TEXT)["pass"])
        self.assertFalse(S.screen_take(good_take(raw_lufs=None), self.TEXT)["pass"])

    def test_export_screen(self) -> None:
        self.assertTrue(S.screen_export(-16.1, -2.0)["pass"])
        self.assertFalse(S.screen_export(-18.5, -2.0)["lufs"]["pass"])
        self.assertFalse(S.screen_export(-16.0, -0.4)["true_peak"]["pass"])
        self.assertFalse(S.screen_export(None, None)["pass"])


class PickRule(unittest.TestCase):
    TEXT = "Final lap! Hold on to your doors!"

    def test_best_score_among_passing_takes(self) -> None:
        takes = [good_take(seed=1000, speaker_sim=0.95), good_take(seed=1001, speaker_sim=0.98), good_take(seed=1002, speaker_sim=0.96)]
        best, ok = S.pick_best(takes, self.TEXT, "warm")
        self.assertTrue(ok)
        self.assertEqual(best["seed"], 1001)

    def test_a_failing_take_never_beats_a_passing_one(self) -> None:
        takes = [good_take(seed=1000, wer=0.14, speaker_sim=0.99), good_take(seed=1001, speaker_sim=0.94)]
        best, ok = S.pick_best(takes, self.TEXT, "warm")
        self.assertTrue(ok)
        self.assertEqual(best["seed"], 1001)

    def test_no_passing_take_fails_the_row_but_keeps_the_best_score(self) -> None:
        takes = [good_take(seed=1000, wer=0.3), good_take(seed=1001, wer=0.14)]
        best, ok = S.pick_best(takes, self.TEXT, "warm")
        self.assertFalse(ok)
        self.assertEqual(best["seed"], 1001)

    def test_hype_prefers_the_more_excited_of_equal_takes(self) -> None:
        takes = [good_take(seed=1000, lift_st=1.0), good_take(seed=1001, lift_st=7.0)]
        self.assertEqual(S.pick_best([dict(t) for t in takes], self.TEXT, "hype")[0]["seed"], 1001)
        self.assertEqual(S.pick_best([dict(t) for t in takes], self.TEXT, "warm")[0]["seed"], 1000)  # tie -> lower seed

    def test_ties_go_to_the_lower_seed(self) -> None:
        takes = [good_take(seed=1003), good_take(seed=1001), good_take(seed=1002)]
        self.assertEqual(S.pick_best(takes, self.TEXT, "warm")[0]["seed"], 1001)

    def test_no_takes(self) -> None:
        self.assertEqual(S.pick_best([], self.TEXT, "warm"), (None, False))

    def test_lift_semitones(self) -> None:
        self.assertAlmostEqual(S.lift_semitones(238.8, 119.4), 12.0, places=3)
        self.assertIsNone(S.lift_semitones(None, 119.4))


if __name__ == "__main__":
    unittest.main()
