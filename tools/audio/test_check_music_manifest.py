#!/usr/bin/env python3
"""Tests for check_music_manifest.py (P1-A02v): the committed manifest passes, and every way an acoustic or
voiced track could sneak back in is refused."""
import copy
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import check_music_manifest as c  # noqa: E402

MANIFEST = c.DEFAULT
BASE = json.loads(MANIFEST.read_text())


def errs(mutate):
    m = copy.deepcopy(BASE)
    mutate(m)
    return c.check(MANIFEST, m)


class MusicManifest(unittest.TestCase):
    def test_committed_manifest_passes(self):
        self.assertEqual(c.check(MANIFEST), [])

    def test_refuses_an_acoustic_render(self):
        def acoustic(m):
            t = m["tracks"][0]
            t["source"] = {"tool": "yue-synth", "stage": "acoustic", "request": t["source"]["request"]}
        e = errs(acoustic)
        self.assertTrue(any("acoustic render" in x for x in e), e)
        self.assertTrue(any("plan stage" in x for x in e), e)

    def test_refuses_the_old_acoustic_manifest_shape(self):
        def old(m):
            m["tracks"][1].update({"source_take": "race/fresh.s11", "kind": "fresh", "words_screen": "clean"})
        self.assertTrue(any("acoustic render" in x for x in errs(old)))

    def test_refuses_separated_stems_and_vocal_rests(self):
        for words in ("Demucs accompaniment stem", "vocal notes replaced by rests"):
            def sep(m, words=words):
                m["tracks"][2]["render"]["soundfont"] = words
            self.assertTrue(any("acoustic render" in x for x in errs(sep)), words)

    def test_refuses_method_other_than_score_only(self):
        def meth(m):
            m["tracks"][0]["method"] = "raw"
        self.assertTrue(any("not score-only" in x for x in errs(meth)))

    def test_refuses_extra_renderer_inputs(self):
        def extra(m):
            m["tracks"][0]["render"]["inputs"].append("YuE2 song.wav")
        self.assertTrue(any("renderer inputs" in x for x in errs(extra)))

    def test_refuses_a_voice_patch(self):
        def choir(m):
            m["tracks"][0]["render"]["patches"]["lead"]["program"] = 52
        self.assertTrue(any("voice/choir" in x for x in errs(choir)))

    def test_refuses_a_flagged_or_stale_voice_check(self):
        def flagged(m):
            m["tracks"][3]["voice_check"]["flagged"] = True
        def stale(m):
            m["tracks"][3]["voice_check"]["sha256"] = "0" * 64
        self.assertTrue(any("flags it" in x for x in errs(flagged)))
        self.assertTrue(any("different file" in x for x in errs(stale)))

    def test_refuses_a_detector_that_misses_the_positive_control(self):
        def blind(m):
            m["no_voice_proof"]["supplementary"]["positive_control"]["flagged"] = False
        self.assertTrue(any("positive control is not flagged" in x for x in errs(blind)))

    def test_refuses_level_and_loop_out_of_spec(self):
        def loud(m):
            m["tracks"][0]["level"]["true_peak_dbtp"] = -0.5
        def seam(m):
            m["tracks"][0]["loop"]["crossfade_s"] = 1.0
        self.assertTrue(any("out of spec" in x for x in errs(loud)))
        self.assertTrue(any("seam" in x for x in errs(seam)))

    def test_refuses_an_untracked_track(self):
        def drop(m):
            m["tracks"].pop()
        e = errs(drop)
        self.assertTrue(any("cue counts" in x for x in e) and any("without a track" in x for x in e), e)


if __name__ == "__main__":
    unittest.main(verbosity=1)
