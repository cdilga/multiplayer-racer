"""P1-D06: a scripted sequence of publishes, pins and time skips ends with exactly the expected set."""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from retention import keep_set, plan  # noqa: E402

T0 = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)


def publish(reg, pid, at):
    reg["previews"].insert(0, {"id": pid, "publishedAt": at.isoformat(timespec="seconds"), "status": "playable"})
    reg["labels"]["Latest"] = pid


class Retention(unittest.TestCase):
    def test_publishes_pins_and_time_skips(self):
        reg = {"previews": [], "labels": {}, "pins": []}
        for i in range(5):
            publish(reg, f"p{i}", T0 + timedelta(hours=i))
        now = T0 + timedelta(hours=5)
        self.assertEqual(keep_set(reg, now), {"p4", "p3", "p2"}, "three newest unpinned; p4 is also Latest")
        reg["pins"].append("p0")
        self.assertEqual(keep_set(reg, now), {"p0", "p4", "p3", "p2"}, "a pin is additional")
        # A day and a half later: the young ones aged out, Latest and the pin stay.
        now = T0 + timedelta(hours=40)
        self.assertEqual(keep_set(reg, now), {"p0", "p4"})
        publish(reg, "p5", now)
        self.assertEqual(keep_set(reg, now), {"p0", "p5"}, "p4 is neither latest nor young now")
        reg["pins"].remove("p0")
        self.assertEqual(set(plan(reg, now)), {"p0", "p1", "p2", "p3", "p4"})

    def test_idempotent_after_retiring(self):
        reg = {"previews": [], "labels": {}, "pins": []}
        for i in range(6):
            publish(reg, f"p{i}", T0 + timedelta(minutes=i))
        now = T0 + timedelta(hours=1)
        for pid in plan(reg, now):
            next(p for p in reg["previews"] if p["id"] == pid)["retired"] = now.isoformat()
        self.assertEqual(plan(reg, now), [], "a second run retires nothing")


if __name__ == "__main__":
    unittest.main()
