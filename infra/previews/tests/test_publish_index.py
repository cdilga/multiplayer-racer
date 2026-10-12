"""P1-D04 / P1-D05: publishing is idempotent and never advertises a failed smoke; the index shows what D05 lists."""
import asyncio
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
sys.modules.setdefault("websockets", mock.MagicMock())  # the middleware client isn't exercised here
import index_page  # noqa: E402
import publish  # noqa: E402

NOW = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)
SHA = "a" * 40


def row(pid, hours_ago, status="playable", **kw):
    at = (NOW - timedelta(hours=hours_ago)).isoformat(timespec="seconds")
    return {"id": pid, "branch": "v0.2-revamp", "sha": pid[-1] * 40, "publishedAt": at, "status": status, "title": f"title {pid}",
            "smoke": ["room", "join-webrtc"] if status == "playable" else [], "reason": "" if status == "playable" else "boom", **kw}


class FakeNas:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.created = []

    async def apps(self, prefix=""):
        return {n: "RUNNING" for n in self.existing if n.startswith(prefix)}

    async def job(self, method, params=None, timeout_s=600):
        assert method == "app.create"
        self.created.append(params[0]["app_name"])


def run_publish(nas, reg, smoke_result=(True, "smoke: PASS room 1234"), healthy=True, steps=("room",)):
    secrets = {"SOURCE_READ_TOKEN": "t", "JJ_ROOM_KEY_MASTER": "m", "TURN_STATIC_AUTH_SECRET": "s"}
    with mock.patch.object(publish, "wait_healthy", return_value=healthy), \
         mock.patch.object(publish, "declared_steps", return_value=list(steps)), \
         mock.patch.object(publish, "smoke", return_value=smoke_result), \
         mock.patch.object(publish, "changes", return_value=["P1-X: a thing"]):
        return asyncio.run(publish.publish_one(nas, reg, {"head_sha": SHA, "html_url": "http://ci/1"}, "sha256:" + "1" * 64, secrets))


class Publish(unittest.TestCase):
    def test_passing_smoke_is_playable(self):
        r = run_publish(FakeNas(), {"previews": [], "labels": {}})
        self.assertEqual((r["id"], r["status"], r["reason"]), ("v02-aaaaaaaa", "playable", ""))
        self.assertEqual(r["changed"], ["P1-X: a thing"])

    def test_failed_smoke_is_not_playable_with_the_reason(self):
        reg = {"previews": [], "labels": {}}
        r = run_publish(FakeNas(), reg, smoke_result=(False, "smoke: FAIL after room 1234: timeout waiting for connected"))
        self.assertEqual(r["status"], "not playable")
        self.assertIn("timeout waiting", r["reason"])
        reg["previews"].insert(0, r)
        publish.set_latest(reg)
        self.assertNotIn("Latest", reg["labels"])

    def test_unhealthy_and_any_exception_are_not_playable(self):
        self.assertEqual(run_publish(FakeNas(), {"previews": [], "labels": {}}, healthy=False)["status"], "not playable")
        nas = FakeNas()
        nas.job = mock.AsyncMock(side_effect=OSError("wss closed"))
        r = run_publish(nas, {"previews": [], "labels": {}})
        self.assertEqual(r["status"], "not playable")
        self.assertIn("wss closed", r["reason"])

    def test_an_orphaned_app_is_adopted_not_created_twice(self):
        nas = FakeNas(existing={"jjp-v02-aaaaaaaa"})
        self.assertEqual(run_publish(nas, {"previews": [], "labels": {}})["status"], "playable")
        self.assertEqual(nas.created, [])

    def test_a_republish_gets_a_fresh_id(self):
        reg = {"previews": [row("v02-aaaaaaaa", 1)], "labels": {}}
        self.assertEqual(publish.preview_id_for(reg, SHA), "v02-aaaaaaaa-2")

    def test_latest_is_the_newest_playable(self):
        reg = {"previews": [row("v02-bbbbbbbb", 1, "not playable"), row("v02-cccccccc", 2), row("v02-dddddddd", 3)], "labels": {"Latest": "gone"}}
        publish.set_latest(reg)
        self.assertEqual(reg["labels"]["Latest"], "v02-cccccccc")

    def test_unknown_smoke_step_fails_the_publish(self):
        resp = mock.MagicMock()
        resp.__enter__.return_value.read.return_value = b'{"steps": ["room", "teleport"]}'
        with mock.patch("urllib.request.urlopen", return_value=resp):
            with self.assertRaisesRegex(ValueError, "teleport"):
                publish.declared_steps("x")

    def test_no_declared_steps_is_not_playable(self):
        ok, line = publish.smoke("x", [], [])
        self.assertFalse(ok)
        self.assertIn("no smoke steps", line)

    def test_other_previews_for_the_room_isolation_check(self):
        reg = {"previews": [row("v02-aaaaaaaa", 1), row("v02-bbbbbbbb", 2, "not playable"), row("v02-cccccccc", 3, retired="x")]}
        self.assertEqual(publish.others_live(reg, "v02-new"), [f"{publish.PUBLIC}/p/v02-aaaaaaaa/"])

    def test_preview_env_has_no_cloudflare_token_and_a_per_preview_room_key(self):
        a = publish.compose("v02-aaaaaaaa", "sha256:1", {"JJ_ROOM_KEY_MASTER": "m", "TURN_STATIC_AUTH_SECRET": "s"})
        b = publish.compose("v02-bbbbbbbb", "sha256:1", {"JJ_ROOM_KEY_MASTER": "m", "TURN_STATIC_AUTH_SECRET": "s"})
        ea, eb = (c["services"]["server"]["environment"] for c in (a, b))
        self.assertNotEqual(ea["JJ_ROOM_KEY"], eb["JJ_ROOM_KEY"])
        self.assertFalse([k for k in ea if "CLOUDFLARE" in k.upper() or k.upper().startswith("CF_")])

    def test_long_titles_are_cut_at_a_word(self):
        t = publish.short_title("word " * 60)
        self.assertTrue(t.endswith("word…"))
        self.assertLessEqual(len(t), 201)
        self.assertEqual(publish.short_title("short title\nbody"), "short title")

    def test_broker_secret_is_per_preview_and_the_key_stays_out(self):
        s = {"JJ_ROOM_KEY_MASTER": "m", "TURN_STATIC_AUTH_SECRET": "s", "JJ_BROKER_KEY": "k"}
        ea = publish.compose("v02-aaaaaaaa", "sha256:1", s)["services"]["server"]["environment"]
        eb = publish.compose("v02-bbbbbbbb", "sha256:1", s)["services"]["server"]["environment"]
        self.assertEqual(ea["JJ_BROKER_URL"], "http://jammers-turn-broker:8080")
        self.assertNotEqual(ea["JJ_BROKER_SECRET"], eb["JJ_BROKER_SECRET"])
        self.assertNotIn("JJ_BROKER_KEY", ea)
        self.assertNotIn("k", ea.values())


class Index(unittest.TestCase):
    def reg(self):
        return {"labels": {"Latest": "v02-dddddddd", "Playtest 1": "v02-bbbbbbbb"}, "pins": [],
                "previews": [row("v02-dddddddd", 1, changed=["P1-D05: index", "P1-D04: smoke"], ciRun="http://ci/9"),
                             row("v02-cccccccc", 2, "not playable"),
                             row("v02-bbbbbbbb", 30),
                             row("v02-aaaaaaaa", 40, retired="2026-10-07T01:00:00+00:00", retiredReason="Expired: older than 24 hours.")]}

    def test_pinned_first_then_newest_first_then_retired(self):
        h = index_page.render(self.reg(), NOW)
        order = [h.index(f'id="v02-{c * 8}"') for c in "bdca"]
        self.assertEqual(order, sorted(order))
        self.assertIn("Playtest 1", h)

    def test_status_keep_links_and_reasons(self):
        h = index_page.render(self.reg(), NOW)
        self.assertIn("Smoke passed", h)
        self.assertIn("Not playable", h)
        self.assertIn("boom", h)  # the failed row's reason
        self.assertIn("Expired: older than 24 hours.", h)  # the retired row's reason
        self.assertIn("What changed (2 commits)", h)
        self.assertIn("3 newest</b>: kept until", h)  # c is one of the three newest: no countdown
        self.assertNotIn('data-expires="', h)
        self.assertIn("pin = <code>v02-dddddddd</code>", h)
        self.assertIn("unpin = <code>v02-bbbbbbbb</code>", h)
        self.assertNotIn("pin = <code>v02-aaaaaaaa</code>", h)  # a retired build can't be pinned
        self.assertIn('href="/p/v02-dddddddd/host"', h)
        self.assertIn('href="http://ci/9"', h)
        self.assertNotIn('class="btn" href="/p/v02-cccccccc/', h)  # a failed smoke is not advertised as playable
        self.assertIn('<a class="ev" href="/p/v02-cccccccc/host">Try Host anyway</a>', h)  # but can be opened
        self.assertIn("probably not playable", h)
        self.assertNotIn('href="/p/v02-aaaaaaaa/', h)  # nor is a retired one

    def test_a_fourth_young_build_counts_down(self):
        reg = {"labels": {"Latest": "v02-eeeeeeee"}, "pins": [],
               "previews": [row(f"v02-{c * 8}", h) for c, h in zip("edcb", (1, 2, 3, 4))]}
        h = index_page.render(reg, NOW)
        self.assertEqual(h.count('data-expires="'), 1)
        self.assertLess(h.index('id="v02-bbbbbbbb"'), h.index('data-expires="'))

    def test_explicit_pin_stays_first_even_when_old_and_page_has_no_dollar(self):
        reg = self.reg()
        reg["pins"] = ["v02-cccccccc"]
        h = index_page.render(reg, NOW)
        self.assertLess(h.index('id="v02-cccccccc"'), h.index('id="v02-dddddddd"'))
        self.assertNotIn("$", h)  # TrueNAS compose would interpolate it in the edge's config

    def test_styled_from_the_token_file_and_phone_safe(self):
        h = index_page.render({"previews": [], "labels": {}}, NOW)
        self.assertIn("--saffron:#FFB400", h)
        self.assertIn("width=device-width", h)
        self.assertIn("No previews yet", h)

    def test_escaping(self):
        r = self.reg()
        r["previews"][0]["title"] = "<script>alert(1)</script>"
        self.assertNotIn("<script>alert(1)", index_page.render(r, NOW))


if __name__ == "__main__":
    unittest.main()


class ChangedListBound(unittest.TestCase):
    """The index rides inside the edge app's compose through the TrueNAS middleware (64 kB messages): a card lists the
    first CHANGED_SHOWN commit titles and links to the rest, and a busy day's previews still fit."""

    def test_a_long_change_list_shows_the_first_titles_and_links_the_rest(self):
        p = {"sha": "ab" * 20, "changed": [f"P1-X: change number {i}" for i in range(20)]}
        out = index_page.changed_html(p)
        self.assertEqual(out.count("<li"), index_page.CHANGED_SHOWN + 1)
        self.assertIn(f"and {20 - index_page.CHANGED_SHOWN} more", out)
        self.assertIn("commits/commit/" + "ab" * 20, out)
        self.assertIn("What changed (20 commits)", out)

    def test_twenty_busy_previews_render_well_under_the_middleware_limit(self):
        rows = [row(f"v02-{i:08x}", i, changed=[f"P1-X: a fairly long commit title that goes on a while {k}" for k in range(40)]) for i in range(20)]
        size = len(index_page.render({"previews": rows}))
        self.assertLess(size, 48_000, f"index {size} bytes")
