"""R117: the deployed previews are read from git tags and commit statuses, and retiring is a tag swap."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import record  # noqa: E402

A, B = "a" * 40, "b" * 40


def tag(name, sha, body=None, first=None):
    msg = (first or f"summary {name}") + ("\n" + json.dumps(body) if body is not None else "")
    return {"name": name, "commit": {"sha": sha}, "message": msg}


class FakeGitea:
    def __init__(self, tags, statuses):
        self.tags, self.statuses, self.calls = tags, statuses, []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "GET" and path.startswith("/tags"):
            return self.tags if "page=1" in path else []
        if method == "GET" and "/statuses" in path:
            return self.statuses.get(path.split("/")[2], [])
        if method == "POST" and path == "/tags" and any(t["name"] == body["tag_name"] for t in self.tags):
            raise RuntimeError("record: POST /tags -> 409 b'already exists'")
        return {}


class Record(unittest.TestCase):
    def fake(self):
        return FakeGitea(
            [tag("preview/v02-aaaaaaaa", A, {"digest": "sha256:1", "publishedAt": "2026-10-08T02:00:00+00:00", "title": "t"}),
             tag("preview/v02-bbbbbbbb", B, {"publishedAt": "2026-10-08T03:00:00+00:00"}),
             tag("retired/v02-aaaaaaaa-2", A, {"publishedAt": "2026-10-07T01:00:00+00:00", "retired": "2026-10-08T00:00:00+00:00",
                                               "retiredReason": "Expired"}),
             tag("preview/v02-aaaaaaaa-2", A, {"publishedAt": "2026-10-07T01:00:00+00:00"}),  # a crashed retirement left it
             tag("pin/v02-aaaaaaaa", A, first="Playtest 1"),
             tag("pin/v02-bbbbbbbb", B, first="Pinned"),
             tag("v0.1-final", A)],
            {A: [{"context": "preview/smoke/v02-aaaaaaaa", "status": "success", "description": "smoke: PASS room, join-webrtc"},
                 {"context": "preview/smoke/v02-aaaaaaaa", "status": "pending", "description": "smoke running"},
                 {"context": "CI / build", "status": "success"}],
             B: [{"context": "preview/smoke/v02-bbbbbbbb", "status": "failure", "description": "FAIL step round: timeout"}]})

    def test_load_reads_tags_and_statuses(self):
        with mock.patch.object(record, "api", self.fake()):
            reg = record.load()
        ids = [p["id"] for p in reg["previews"]]
        self.assertEqual(ids, ["v02-bbbbbbbb", "v02-aaaaaaaa", "v02-aaaaaaaa-2"], "newest first; other tags ignored")
        a, b, old = reg["previews"][1], reg["previews"][0], reg["previews"][2]
        self.assertEqual((a["status"], a["smoke"], a["digest"]), ("playable", ["room", "join-webrtc"], "sha256:1"))
        self.assertEqual((b["status"], b["reason"]), ("not playable", "FAIL step round: timeout"))
        self.assertEqual(old["retired"], "2026-10-08T00:00:00+00:00", "a retired tag wins over a leftover preview tag")
        self.assertEqual(reg["labels"], {"Playtest 1": "v02-aaaaaaaa", "Latest": "v02-aaaaaaaa"})  # Latest is derived on load
        self.assertEqual(reg["pins"], ["v02-bbbbbbbb"])

    def test_retiring_swaps_the_tag_and_keeps_the_story(self):
        g = self.fake()
        with mock.patch.object(record, "api", g):
            record.record_retired({"id": "v02-bbbbbbbb", "sha": B, "publishedAt": "x", "retired": "y", "retiredReason": "Superseded"})
        (m1, p1, body), (m2, p2, _) = g.calls
        self.assertEqual((m1, p1, body["tag_name"], body["target"]), ("POST", "/tags", "retired/v02-bbbbbbbb", B))
        self.assertEqual(json.loads(body["message"].split("\n", 1)[1])["retiredReason"], "Superseded")
        self.assertEqual((m2, p2), ("DELETE", "/tags/preview/v02-bbbbbbbb"))

    def test_an_existing_tag_is_not_an_error(self):
        with mock.patch.object(record, "api", self.fake()):
            self.assertFalse(record.record_preview({"id": "v02-aaaaaaaa", "sha": A}))

    def test_steps_from_a_real_pass_line(self):
        line = "smoke: PASS room ZG5H, isolated from 3 other preview(s), join-webrtc (host, 1 ms), input, resume, drive, hud, round"
        self.assertEqual(record.steps_of(line), ["room", "join-webrtc", "input", "resume", "drive", "hud", "round"])

    def test_status_description_is_bounded(self):
        g = self.fake()
        with mock.patch.object(record, "api", g):
            record.set_status({"id": "x", "sha": A}, "failure", "y" * 900)
        self.assertEqual(len(g.calls[0][2]["description"]), 250)
        self.assertEqual(g.calls[0][2]["context"], "preview/smoke/x")


if __name__ == "__main__":
    unittest.main()
