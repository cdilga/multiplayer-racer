"""Preview retention (P1-D06, R73): which previews keep running, and the reconciler that retires the rest.

Ordered policy, hourly and on every publish:
1. owner-pinned previews (`pin/<id>` tags, scripts/record.py) survive until unpinned;
2. the latest preview (label `Latest`) survives regardless of age;
3. other unpinned previews older than 24 hours expire;
4. at most the three newest unpinned previews are kept; pins are additional.
(The three-preview policy is the owner's, R73; it has nothing to do with player counts.)

Retiring a preview deletes its TrueNAS app (container and its disposable state) and replaces its `preview/<id>` tag
with `retired/<id>` (time and reason in the annotation); evidence for it lives in git, never in the container. The edge
then answers its links with an explanation and its API with 410 preview-expired. Idempotent: running it twice changes
nothing the second time.
  python3 scripts/retention.py --plan        # what would happen (reads the tags: GITEA_TOKEN)
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone

MAX_UNPINNED = 3
MAX_AGE = timedelta(hours=24)


def keep_set(reg: dict, now: datetime) -> set[str]:
    """The ids that stay up under the ordered policy."""
    live = [p for p in reg.get("previews", []) if not p.get("retired")]
    # A labelled build (e.g. "Playtest 1") is pinned by its label (D05: the playtest build is pinned).
    pins = set(reg.get("pins", [])) | {pid for label, pid in reg.get("labels", {}).items() if label != "Latest"}
    latest = reg.get("labels", {}).get("Latest")
    keep = {p["id"] for p in live if p["id"] in pins}
    if latest:
        keep.add(latest)
    unpinned = sorted((p for p in live if p["id"] not in pins), key=lambda p: p.get("publishedAt", ""), reverse=True)
    young = [p for p in unpinned if now - datetime.fromisoformat(p["publishedAt"]) < MAX_AGE]
    keep.update(p["id"] for p in young[:MAX_UNPINNED])
    return keep


def plan(reg: dict, now: datetime) -> list[str]:
    keep = keep_set(reg, now)
    return [p["id"] for p in reg.get("previews", []) if not p.get("retired") and p["id"] not in keep]


def reason(reg: dict, pid: str, now: datetime) -> str:
    """Why a preview is retired, in words for the index page."""
    p = next(p for p in reg["previews"] if p["id"] == pid)
    if now - datetime.fromisoformat(p["publishedAt"]) >= MAX_AGE:
        return "Expired: older than 24 hours, and not pinned or the latest build."
    return "Superseded: only the three newest unpinned previews stay up."


async def reconcile(nas, reg: dict, now: datetime, record=None) -> list[str]:
    """Retires what the policy drops; with `record` (scripts/record.py) each retirement is also written to git."""
    retired = []
    apps = await nas.apps("jjp-")
    for pid in plan(reg, now):
        if f"jjp-{pid}" in apps:
            await nas.job("app.delete", [f"jjp-{pid}", {"remove_images": False, "remove_ix_volumes": True}])
        why = reason(reg, pid, now)
        for p in reg["previews"]:
            if p["id"] == pid:
                p["retired"] = now.isoformat(timespec="seconds")
                p["retiredReason"] = why
                if record:
                    record.record_retired(p)
        retired.append(pid)
    return retired


if __name__ == "__main__":
    import record
    reg = record.load()
    now = datetime.now(timezone.utc)
    if "--plan" in sys.argv:
        print(json.dumps({"keep": sorted(keep_set(reg, now)), "retire": plan(reg, now)}, indent=1))
        sys.exit(0)
    from truenas import TrueNAS

    async def main():
        async with TrueNAS(os.environ["TRUENAS_APPS_WRITE_KEY"]) as nas:
            print("retired:", await reconcile(nas, reg, now, record))

    asyncio.run(main())
