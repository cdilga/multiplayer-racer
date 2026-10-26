"""Promotes a smoked preview to production, https://jammers.dilger.dev (P1-D08; owner 2026-10-19: promoted by hand
from time to time, as Physical Soccer's stable site is).

Production is one TrueNAS app, `jammers-prod`, running the promoted preview's image **by digest** (the exact bytes the
preview's smoke proved) at base `/` in realm `production`: no test chunk (`/test/*` answers 404), its own room key and
TURN broker secret derived for the id `production`. It listens on the LAN at :30291, where the `jammers.dilger.dev`
tunnel ingress points (docs/infra/turn-and-previews.md). Promoting replaces the app's compose; the old container keeps
serving until the new one starts.

The record (R117) is git:
  release/<UTC stamp>  annotated tag on the promoted source commit: one summary line, then JSON
                       {id, sha, digest, promotedAt, previous}; the newest one is what production serves
  pin/<id>             label "Production": the promoted preview stays up and the index marks it (the previous
                       production pin is removed, so retention can retire that preview as usual)

  python3 scripts/promote.py latest          the index's Latest (the newest playable preview)
  python3 scripts/promote.py v02-<sha8>      that preview (live or retired: production needs only its digest)
  python3 scripts/promote.py --rollback      the build production served before the current one
  python3 scripts/promote.py --plan <which>  dry run: what would be promoted and the app's env (secrets redacted)

Run by .gitea/workflows/deploy-prod.yml (scripts/promote.sh dispatches it).
"""

import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import record
from publish import IMAGE, NETWORK, backend_secret, env, room_key

APP = "jammers-prod"
ID = "production"  # the room key and broker secret id; the server derives the same broker id from base "/"
PORT = 30291
LAN = os.environ.get("PROD_LAN_URL", f"http://192.168.11.12:{PORT}")
PUBLIC = "https://jammers.dilger.dev"
# Cloudflare answers 403 to urllib's default "Python-urllib" User-Agent (run 7062/7065).
UA = {"User-Agent": "jammers-promote/1"}
# The production game smoke (smoke.mjs, SMOKE_REALM=production): the real party loop through the public URL with
# WebRTC between two phones, no test surface.
SMOKE_STEPS = "room,join-webrtc,input,resume,race,hud"


def compose(build: str, digest: str, secrets: dict) -> dict:
    c = {
        "services": {
            "server": {
                "image": f"{IMAGE}@{digest}",
                "container_name": APP,
                "restart": "unless-stopped",
                "environment": {
                    "JJ_BASE_PATH": "/",
                    "JJ_REALM": "production",
                    "JJ_BUILD": build,
                    "JJ_PUBLIC_ORIGIN": PUBLIC,
                    "JJ_ROOM_KEY": room_key(secrets["JJ_ROOM_KEY_MASTER"], ID),
                    "TURN_STATIC_AUTH_SECRET": secrets["TURN_STATIC_AUTH_SECRET"],
                },
                "ports": [f"{PORT}:8080"],
                "networks": ["previews"],  # the TURN broker is on the previews network
                "read_only": True,
                "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"],
                "mem_limit": "1g",
                "cpus": 4.0,
                "pids_limit": 512,
            }
        },
        "networks": {"previews": {"external": True, "name": NETWORK}},
    }
    if secrets.get("JJ_BROKER_KEY"):
        c["services"]["server"]["environment"].update(
            JJ_BROKER_URL="http://jammers-turn-broker:8080", JJ_BROKER_SECRET=backend_secret(secrets["JJ_BROKER_KEY"], ID))
    return c


def releases() -> list[dict]:
    """The release/<stamp> tags, newest first."""
    out = []
    for t in record.tags():
        if t["name"].startswith("release/"):
            body = (t.get("message") or "").split("\n", 1)
            try:
                out.append({"tag": t["name"], **json.loads(body[1] if len(body) > 1 else "{}")})
            except ValueError:
                continue
    return sorted(out, key=lambda r: r["tag"], reverse=True)


def resolve(reg: dict, which: str, rels: list[dict]) -> dict:
    """The preview row to promote. Only a preview whose smoke passed may reach production."""
    if which == "--rollback":
        current = rels[0]["id"] if rels else None
        older = next((r for r in rels if r["id"] != current), None)
        if not older:
            raise SystemExit("promote: nothing to roll back to (production has served only one build)")
        which = older["id"]
    elif which == "latest":
        which = reg.get("labels", {}).get("Latest") or ""
        if not which:
            raise SystemExit("promote: no playable preview to promote")
    row = next((p for p in reg["previews"] if p["id"] == which), None)
    if not row:
        raise SystemExit(f"promote: no preview {which} in the record")
    if row.get("status") != "playable":
        raise SystemExit(f"promote: {which} is not playable ({row.get('reason') or 'no smoke'}); only a smoked build goes to production")
    if not str(row.get("digest", "")).startswith("sha256:"):
        raise SystemExit(f"promote: {which} has no image digest in its record")
    return row


def get_json(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=10) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, OSError, ValueError):
        return None


def status(url: str) -> int:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError):
        return 0


def wait_serving(base: str, build: str, timeout_s: int) -> dict | None:
    for _ in range(timeout_s // 3):
        v = get_json(f"{base}/version")
        if v and v.get("build") == build:
            return v
        time.sleep(3)
    return None


def checks(base: str, build: str, timeout_s: int) -> list[str]:
    """Production smoke: serves this build in realm production, the pages answer, the test chunk is gone. (The full
    WebRTC smoke ran on these exact bytes as the preview; production's own game smoke, game_smoke, runs after the
    record.)"""
    v = wait_serving(base, build, timeout_s)
    if not v:
        return [f"{base}/version never reported build {build}"]
    bad = [] if v.get("realm") == "production" else [f"realm is {v.get('realm')!r}, not production"]
    h = get_json(f"{base}/healthz") or {}
    if not h.get("ok"):
        bad.append(f"/healthz not ok: {h}")
    for path, want in (("/", 200), ("/host", 200), ("/c", 200), ("/test/", 404), ("/test/index.js", 404)):
        got = status(base + path)
        if got != want:
            bad.append(f"{path} answered {got}, want {want}")
    return bad


def game_smoke() -> str | None:
    """Runs the production game smoke against the public URL; returns the FAIL line, or None on a pass."""
    try:
        r = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "smoke.mjs"), f"{PUBLIC}/", SMOKE_STEPS],
                           capture_output=True, text=True, timeout=420, env=dict(os.environ, SMOKE_REALM="production"))
    except subprocess.TimeoutExpired:
        return "smoke: FAIL the smoke script timed out after 7 minutes"
    except OSError as e:
        return f"smoke: FAIL could not start node ({e.strerror})"
    tail = (r.stdout + r.stderr).strip().splitlines()[-12:]
    print("\n".join(tail))
    line = next((x for x in reversed(tail) if x.startswith("smoke:")), tail[-1] if tail else "no output")
    return None if r.returncode == 0 and line.startswith("smoke: PASS") else line[:400]


async def promote(row: dict, rels: list[dict], secrets: dict):
    from truenas import TrueNAS  # needs `websockets`
    build, previous = row["id"], (rels[0]["id"] if rels else None)
    print(f"promote: {build} ({row['sha'][:12]}, {row['digest']}) -> {APP}; production was {previous or 'never promoted'}")
    async with TrueNAS(secrets["TRUENAS_APPS_WRITE_KEY"]) as nas:
        cfg = {"custom_compose_config": compose(build, row["digest"], secrets)}
        if APP in await nas.apps(APP):
            await nas.job("app.update", [APP, cfg])
        else:
            await nas.job("app.create", [{"app_name": APP, "custom_app": True, **cfg}])
    bad = checks(LAN, build, 180)
    if bad:
        raise SystemExit("promote: FAIL on the LAN: " + "; ".join(bad) + ("; roll back with scripts/promote.sh --rollback" if previous else ""))
    print(f"promote: {LAN} serves {build} in realm production")
    public = checks(PUBLIC, build, 60)
    print(f"promote: {PUBLIC} " + ("serves " + build if not public else "NOT confirmed: " + "; ".join(public)))
    now = datetime.now(timezone.utc)
    body = {"id": build, "sha": row["sha"], "digest": row["digest"], "promotedAt": now.isoformat(timespec="seconds"), "previous": previous}
    record.create_tag(f"release/{now.strftime('%Y%m%dT%H%M%SZ')}", row["sha"], f"production {build}: {row['digest']}\n" + json.dumps(body, indent=1))
    reg = record.load()
    for label_pid in [p for label, p in reg.get("labels", {}).items() if label == "Production" and p != build]:
        record.delete_tag(f"pin/{label_pid}")
    if reg.get("labels", {}).get("Production") != build:
        record.delete_tag(f"pin/{build}")  # an unlabelled pin of the same build would otherwise keep the old label
        record.create_tag(f"pin/{build}", row["sha"], "Production")
    if public:
        raise SystemExit("promote: production runs the build on the LAN but the public URL doesn't serve it yet (tunnel?)")
    # After the record: production serves this build whatever the game smoke says, and --rollback needs the tag.
    bad = game_smoke()
    if bad:
        raise SystemExit(f"promote: {build} is production but its game smoke failed: {bad}"
                         + ("; roll back with scripts/promote.sh --rollback" if previous else ""))
    print(f"promote: PASS {build} is production and its game smoke passed")


def main():
    args = [a for a in sys.argv[1:] if a != "--plan"]
    which = args[0] if args else "latest"
    reg = record.load()
    rels = releases()
    row = resolve(reg, which, rels)
    if "--plan" in sys.argv:
        c = compose(row["id"], row["digest"], {k: "<redacted>" for k in ("JJ_ROOM_KEY_MASTER", "TURN_STATIC_AUTH_SECRET", "JJ_BROKER_KEY")})
        print(f"would promote {row['id']} ({row['sha'][:12]}) over {rels[0]['id'] if rels else 'nothing'}")
        print(json.dumps(c, indent=1))
        return
    secrets = {k: env(k) for k in ("TRUENAS_APPS_WRITE_KEY", "JJ_ROOM_KEY_MASTER", "TURN_STATIC_AUTH_SECRET")}
    if os.environ.get("JJ_BROKER_KEY"):
        secrets["JJ_BROKER_KEY"] = os.environ["JJ_BROKER_KEY"]
    asyncio.run(promote(row, rels, secrets))


if __name__ == "__main__":
    main()
