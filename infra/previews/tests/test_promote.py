"""P1-D08: production runs the promoted preview's exact image in realm production at /, and only a smoked build gets there."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from promote import compose, resolve  # noqa: E402

D = "sha256:" + "a" * 64
SECRETS = {"JJ_ROOM_KEY_MASTER": "m", "TURN_STATIC_AUTH_SECRET": "t", "JJ_BROKER_KEY": "b"}


def reg():
    return {"previews": [
        {"id": "v02-new", "sha": "1" * 40, "digest": D, "status": "not playable", "reason": "smoke failed"},
        {"id": "v02-mid", "sha": "2" * 40, "digest": D, "status": "playable"},
        {"id": "v02-old", "sha": "3" * 40, "digest": D, "status": "playable", "retired": "2026-10-18T00:00:00+00:00"},
    ], "labels": {"Latest": "v02-mid"}, "pins": []}


class Promote(unittest.TestCase):
    def test_compose_is_production_at_root_by_digest(self):
        s = compose("v02-mid", D, SECRETS)["services"]["server"]
        self.assertEqual(s["image"].split("@")[1], D)
        e = s["environment"]
        self.assertEqual((e["JJ_REALM"], e["JJ_BASE_PATH"], e["JJ_BUILD"]), ("production", "/", "v02-mid"))
        self.assertEqual(e["JJ_PUBLIC_ORIGIN"], "https://jammers.dilger.dev")
        self.assertNotIn("JJ_BROKER_KEY", e, "the broker key itself never reaches a backend")
        self.assertEqual(s["ports"], ["30291:8080"])

    def test_room_key_differs_from_any_preview(self):
        from publish import room_key
        e = compose("v02-mid", D, SECRETS)["services"]["server"]["environment"]
        self.assertNotEqual(e["JJ_ROOM_KEY"], room_key("m", "v02-mid"))

    def test_resolve(self):
        self.assertEqual(resolve(reg(), "latest", [])["id"], "v02-mid")
        self.assertEqual(resolve(reg(), "v02-old", [])["id"], "v02-old", "a retired preview's digest still promotes")
        with self.assertRaises(SystemExit):
            resolve(reg(), "v02-new", [])  # never an unsmoked build
        with self.assertRaises(SystemExit):
            resolve(reg(), "--rollback", [{"tag": "release/2", "id": "v02-mid"}])
        rels = [{"tag": "release/3", "id": "v02-mid"}, {"tag": "release/2", "id": "v02-mid"}, {"tag": "release/1", "id": "v02-old"}]
        self.assertEqual(resolve(reg(), "--rollback", rels)["id"], "v02-old")


if __name__ == "__main__":
    unittest.main()
