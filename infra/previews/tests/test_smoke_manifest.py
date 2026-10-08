"""P1-D07: the smoke's manifest rules (no browser needed): every failure names its step, and a bundle that drops a
mandatory step from smoke.json fails, so publish.py marks it "not playable"."""
import os
import subprocess
import unittest
from pathlib import Path

SMOKE = Path(__file__).resolve().parent.parent / "scripts" / "smoke.mjs"
ALL = "room,join-webrtc,input,resume,drive,hud,round"


def run(steps, **env):
    r = subprocess.run(["node", str(SMOKE), "https://x.test/p/a/", steps], capture_output=True, text=True,
                       env={**os.environ, **env}, timeout=30)
    return r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1]


class SmokeManifest(unittest.TestCase):
    def test_dropping_a_mandatory_step_fails_naming_it(self):
        for dropped in ALL.split(","):
            steps = ",".join(s for s in ALL.split(",") if s != dropped)
            code, line = run(steps)
            self.assertEqual(code, 1)
            self.assertEqual(line, f"smoke: FAIL step {dropped}: mandatory step {dropped} is missing from smoke.json")

    def test_unknown_and_empty_manifests_fail_at_the_manifest(self):
        self.assertEqual(run(ALL + ",bogus")[1], "smoke: FAIL step manifest: unknown step bogus")
        self.assertEqual(run("")[1], "smoke: FAIL step manifest: no steps given")

    def test_the_mandatory_list_can_be_narrowed_for_an_older_build(self):
        # The four G00 steps with the list narrowed pass the manifest and go on to need a browser/network: whatever
        # happens, it is not a manifest failure.
        _, line = run("room,join-webrtc,input,resume", SMOKE_MANDATORY="room,join-webrtc,input,resume")
        self.assertNotIn("mandatory step", line)


if __name__ == "__main__":
    unittest.main()
