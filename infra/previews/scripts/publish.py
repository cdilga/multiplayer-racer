"""Publishes green 0.2 builds as rainbow previews (P1-D03/D04, plan §12, R85).

Polled by .gitea/workflows/publish.yml. For each new green CI run on cdilga/multiplayer-racer's v0.2-revamp whose
`jj-server` image is in the registry:

1. a fresh, never-reused deployment id `v02-<sha8>` (a suffix if that commit was published before);
2. its own TrueNAS app `jjp-<id>` running the image **by digest** with its own room key and the coturn secret, on the
   shared `jammers-previews` network the edge routes `/p/<id>/` over;
3. health through the edge, then the fixed public smoke (scripts/smoke.mjs) with the steps the bundle declares in
   `assets/smoke.json` (data, never commands: an unknown step fails the publish);
4. the record in git (R117, scripts/record.py): an annotated tag `preview/<id>` on the source commit before the app is
   created, and a commit status `preview/smoke/<id>`: success = playable, failure = not playable with the reason.
   A failed health check or smoke never advertises the preview: it never becomes Latest, and the index offers only small "Try … anyway" links under a "probably not playable" warning.

Idempotent: a commit that already has a preview (or retired) tag is skipped; an app `jjp-<id>` left by a run that died
is adopted, not created twice; nothing here deletes an app (retention does, by policy).

  python3 scripts/publish.py                 publish what is new
  python3 scripts/publish.py --plan          dry run: what would publish, the app's env (secrets redacted), health and
                                             smoke targets, the retention plan; touches nothing. Without
                                             SOURCE_READ_TOKEN it can't list CI: add --run-sha <sha> [--digest <sha256:..>]
                                             and optionally --index-out <file>
  python3 scripts/publish.py --resmoke <id>  rerun the smoke against a live preview and update its row
  python3 scripts/publish.py --republish     publish the recent green runs again under new ids (-2, -3, ..)

Nothing from the candidate runs here but its image. Secrets come from this repo's Actions secrets only.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import index_page
import record
import retention
try:
    from truenas import TrueNAS  # needs `websockets`, installed with the tools; the --needs-work check runs before them
except ModuleNotFoundError:
    TrueNAS = None

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "edge"))
import apply as edge  # noqa: E402  (edge/apply.py: the edge's complete compose)

GITEA = os.environ.get("GITEA_URL", "http://192.168.11.12:3001")
GAME = "cdilga/multiplayer-racer"
BRANCH = "v0.2-revamp"
IMAGE = "127.0.0.1:3001/cdilga/jj-server"
EDGE = os.environ.get("EDGE_URL", "http://192.168.11.12:30290")
PUBLIC = "https://jammers-preview.dilger.dev"
NETWORK = "jammers-previews"
ROOT = pathlib.Path(__file__).resolve().parent.parent
SMOKE_STEPS = {"room", "join-webrtc", "input", "resume", "drive", "hud", "round"}
# How many recent green runs one poll looks through (newest first) for the newest one with an image. The game's CI
# builds the image only when its inputs changed, so a green test- or docs-only commit can have none; the newest green
# commit that has one is published, and older ones are never published behind it.
RECENT = 20


def env(name: str) -> str:
    v = os.environ.get(name, "")
    if not v:
        raise SystemExit(f"publish: secret {name} is missing")
    return v


def gitea(path: str, token: str, accept: str = "application/json"):
    req = urllib.request.Request(f"{GITEA}{path}", headers={"Authorization": f"token {token}", "Accept": accept})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, dict(r.headers), r.read()


def green_runs(token: str) -> list[dict]:
    # ci.yml's own runs: in the repo-wide listing the deploy workflows' 5-minute successes (R117, same repo now) and
    # gpu.yml's pushed every green ci.yml run out of the 20-run window.
    _, _, body = gitea(f"/api/v1/repos/{GAME}/actions/workflows/ci.yml/runs?branch={BRANCH}&status=success&limit=20", token)
    # Only the game's main CI (ci.yml) counts: Gitea leaves `name` empty, and gpu.yml's green runs must not publish a commit.
    runs = [r for r in json.loads(body).get("workflow_runs", []) if r.get("path", "").split("@")[0].rsplit("/", 1)[-1] == "ci.yml"]
    seen, out = set(), []
    for r in sorted(runs, key=lambda r: r["id"], reverse=True):
        if r["head_sha"] not in seen and r.get("conclusion") == "success":
            seen.add(r["head_sha"])
            out.append(r)
    return out[:RECENT]


class RegistryAuthError(SystemExit):
    """The registry refused our credentials: never confuse this with "no image for that commit"."""


_registry_bearer: dict[str, str] = {}


def registry_bearer(token: str) -> str:
    """A pull bearer for cdilga/jj-server. The OCI registry (/v2) ignores `Authorization: token …` and answers 401: it
    wants the Docker token flow, Basic <user>:<token> at /v2/token. Gitea takes the user from the token and ignores the
    name given (and SOURCE_READ_TOKEN has no read:user scope to look it up: 403 in run 1653)."""
    if token in _registry_bearer:
        return _registry_bearer[token]
    try:
        basic = base64.b64encode(f"jammers-deploy:{token}".encode()).decode()
        req = urllib.request.Request(f"{GITEA}/v2/token?service=container_registry&scope=repository:cdilga/jj-server:pull",
                                     headers={"Authorization": f"Basic {basic}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            bearer = json.loads(r.read())["token"]
    except urllib.error.HTTPError as e:
        raise RegistryAuthError(f"publish: the registry refused SOURCE_READ_TOKEN ({e.code} at {e.url.split('?')[0]}); "
                                "it needs read access to cdilga's packages") from None
    _registry_bearer[token] = bearer
    return bearer


def image_digest(token: str, sha: str) -> str | None:
    """The registry digest of the image CI pushed for this commit; None only when the registry says there's no such tag
    (404). Any auth failure stops the publish loudly instead of reading as "nothing new" (runs 1632, 1636)."""
    tag = sha[:12]
    req = urllib.request.Request(f"{GITEA}/v2/cdilga/jj-server/manifests/{tag}", method="HEAD", headers={
        "Authorization": f"Bearer {registry_bearer(token)}",
        "Accept": "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, "
                  "application/vnd.oci.image.manifest.v1+json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            headers = dict(r.headers)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        if e.code in (401, 403):
            raise RegistryAuthError(f"publish: the registry refused the pull token for jj-server:{tag} ({e.code})") from None
        raise
    digest = headers.get("Docker-Content-Digest") or headers.get("docker-content-digest")
    if not digest:
        raise SystemExit(f"publish: the registry answered jj-server:{tag} without a Docker-Content-Digest")
    return digest


def load_register() -> dict:
    """The deployed previews, read from git: tags and commit statuses (scripts/record.py)."""
    return record.load()


def room_key(master: str, preview_id: str) -> str:
    return base64.urlsafe_b64encode(hmac.new(master.encode(), preview_id.encode(), hashlib.sha256).digest()).decode().rstrip("=")


def backend_secret(key: str, preview_id: str) -> str:
    """JJ_BROKER_SECRET for one backend: hex(HMAC-SHA256(JJ_BROKER_KEY, previewId)) (docs/infra/turn-and-previews.md)."""
    return hmac.new(key.encode(), preview_id.encode(), hashlib.sha256).hexdigest()


def compose(preview_id: str, digest: str, secrets: dict) -> dict:
    c = {
        "services": {
            "server": {
                "image": f"{IMAGE}@{digest}",
                "container_name": f"jjp-{preview_id}",
                "restart": "unless-stopped",
                "environment": {
                    "JJ_BASE_PATH": f"/p/{preview_id}/",
                    "JJ_REALM": "preview",
                    "JJ_BUILD": preview_id,
                    "JJ_PUBLIC_ORIGIN": PUBLIC,
                    "JJ_ROOM_KEY": room_key(secrets["JJ_ROOM_KEY_MASTER"], preview_id),
                    "TURN_STATIC_AUTH_SECRET": secrets["TURN_STATIC_AUTH_SECRET"],
                },
                "networks": ["previews"],
                "read_only": True,
                "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"],
                "mem_limit": "512m",
                "cpus": 2.0,
                "pids_limit": 256,
            }
        },
        "networks": {"previews": {"external": True, "name": NETWORK}},
    }
    if secrets.get("JJ_BROKER_KEY"):  # the TURN broker (infra/turn-broker); the key itself never reaches a backend
        c["services"]["server"]["environment"].update(
            JJ_BROKER_URL="http://jammers-turn-broker:8080", JJ_BROKER_SECRET=backend_secret(secrets["JJ_BROKER_KEY"], preview_id))
    return c


def wait_healthy(preview_id: str, timeout_s: int = 120) -> bool:
    url = f"{EDGE}/p/{preview_id}/healthz"
    for _ in range(timeout_s // 2):
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


def declared_steps(preview_id: str) -> list[str]:
    try:
        with urllib.request.urlopen(f"{EDGE}/p/{preview_id}/assets/smoke.json", timeout=10) as r:
            steps = json.loads(r.read()).get("steps", [])
    except (urllib.error.URLError, ValueError, OSError):
        steps = []
    unknown = [s for s in steps if s not in SMOKE_STEPS]
    if unknown:
        raise ValueError(f"unknown smoke step(s): {', '.join(unknown)}")
    return steps


def others_live(reg: dict, preview_id: str) -> list[str]:
    return [f"{PUBLIC}/p/{p['id']}/" for p in reg["previews"] if p["id"] != preview_id and p.get("status") == "playable" and not p.get("retired")]


def smoke(preview_id: str, steps: list[str], others: list[str]) -> tuple[bool, str]:
    """Runs scripts/smoke.mjs; returns (passed, the PASS/FAIL line)."""
    if not steps:
        return False, "smoke: FAIL the bundle declares no smoke steps (assets/smoke.json)"
    senv = dict(os.environ, SMOKE_OTHERS=",".join(others))
    try:
        r = subprocess.run(["node", str(ROOT / "scripts" / "smoke.mjs"), f"{PUBLIC}/p/{preview_id}/", ",".join(steps)],
                           capture_output=True, text=True, timeout=420, env=senv)
    except subprocess.TimeoutExpired:
        return False, "smoke: FAIL the smoke script timed out after 7 minutes"
    except OSError as e:
        return False, f"smoke: FAIL could not start node ({e.strerror})"
    tail = (r.stdout + r.stderr).strip().splitlines()[-12:]
    print("\n".join(tail))
    line = next((x for x in reversed(tail) if x.startswith("smoke:")), tail[-1] if tail else "no output")
    return r.returncode == 0 and line.startswith("smoke: PASS"), line[:400]


def changes(token: str, prev: str | None, sha: str) -> list[str]:
    """First lines of the commits since the previous published build (they name the beads closed); best effort."""
    if not prev:
        return []
    try:
        _, _, body = gitea(f"/api/v1/repos/{GAME}/compare/{prev}...{sha}", token)
        return [short_title(c["commit"]["message"]) for c in json.loads(body).get("commits", [])][::-1]
    except Exception as e:  # the index just shows no list
        print(f"publish: no change list ({type(e).__name__})")
        return []


set_latest = record.set_latest


def short_title(t: str, n: int = 200) -> str:
    """A commit title for the index: whole, or cut at a word with an ellipsis (never mid-word)."""
    t = t.splitlines()[0] if t else ""
    return t if len(t) <= n else t[:n].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def preview_id_for(reg: dict, sha: str) -> str:
    base = f"v02-{sha[:8]}"
    taken = {p["id"] for p in reg["previews"]}
    preview_id, n = base, 2
    while preview_id in taken:
        preview_id = f"{base}-{n}"
        n += 1
    return preview_id


async def publish_one(nas: TrueNAS, reg: dict, run: dict, digest: str, secrets: dict, on_start=None) -> dict:
    sha = run["head_sha"]
    preview_id = preview_id_for(reg, sha)
    app = f"jjp-{preview_id}"
    print(f"publish: {app} <- {sha[:12]} {digest}")
    row = {"id": preview_id, "branch": BRANCH, "sha": sha, "digest": digest, "ciRun": run.get("html_url"),
           "title": short_title(run.get("display_title") or ""),
           "publishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "status": "not playable", "reason": ""}
    prev = reg["previews"][0]["sha"] if reg["previews"] else None
    row["changed"] = changes(secrets["SOURCE_READ_TOKEN"], prev, sha)
    if on_start:
        on_start(row)  # the git record exists before the app does
    try:
        if app in await nas.apps(app):
            print(f"publish: {app} already exists (an earlier run died before its row was saved); adopting it")
        else:
            await nas.job("app.create", [{"app_name": app, "custom_app": True, "custom_compose_config": compose(preview_id, digest, secrets)}])
        if not wait_healthy(preview_id):
            row["reason"] = "healthz never answered through the edge"
            return row
        steps = declared_steps(preview_id)
        row["smoke"] = steps
        ok, line = smoke(preview_id, steps, others_live(reg, preview_id))
        row["smokedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        row["smokeResult"] = line
        row["status"] = "playable" if ok else "not playable"
        row["reason"] = "" if ok else line.removeprefix("smoke: ")
    except Exception as e:  # any failure leaves a "not playable" row with its reason; nothing is advertised
        row["status"] = "not playable"
        row["reason"] = f"{type(e).__name__}: {e}"[:300]
    return row


async def ensure_network(nas: TrueNAS):
    """The shared network is owned by its own tiny app so the edge and the previews can each restart freely."""
    if "jammers-net" in await nas.apps("jammers-net"):
        return
    await nas.job("app.create", [{"app_name": "jammers-net", "custom_app": True, "custom_compose_config": {
        "services": {"hold": {"image": "busybox:1.37", "command": ["sleep", "infinity"], "restart": "unless-stopped",
                              "networks": ["previews"], "read_only": True, "cap_drop": ["ALL"], "mem_limit": "16m"}},
        "networks": {"previews": {"name": NETWORK}}}}])


def edge_key(reg: dict) -> str:
    """What the edge's index shows: the rows' ids, statuses and retirement, the labels and pins, and the renderer and
    edge files themselves (a change to the page's code or the Caddyfile re-applies the edge on the next poll)."""
    rows = [(p["id"], p.get("status"), bool(p.get("retired"))) for p in reg["previews"]]
    code = [hashlib.sha256(f.read_bytes()).hexdigest() for f in (ROOT / "scripts" / "index_page.py", ROOT / "edge" / "tokens.json",
                                                                   ROOT / "edge" / "Caddyfile")]
    return hashlib.sha256(json.dumps([rows, reg.get("labels", {}), reg.get("pins", []), code], sort_keys=True).encode()).hexdigest()[:16]


def index_html(reg: dict) -> str:
    """The rendered index, carrying the key of what it shows so a poll can tell it's stale without any stored state."""
    return index_page.render(reg).replace("<head>", f'<head><meta name="jj-index" content="{edge_key(reg)}">', 1)


def edge_current(reg: dict) -> bool:
    try:
        with urllib.request.urlopen(f"{EDGE}/", timeout=10) as r:
            return f'<meta name="jj-index" content="{edge_key(reg)}">' in r.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError):
        return False


async def apply_edge(nas: TrueNAS, reg: dict):
    """The index (P1-D05) lists the current previews: the edge is re-applied with it (a ~2 s edge restart)."""
    (ROOT / "edge" / "index.html").write_text(index_html(reg))
    await nas.job("app.update", ["jammers-preview-edge", {"custom_compose_config": edge.compose()}])


def redacted(preview_id: str, digest: str) -> dict:
    c = compose(preview_id, digest, {k: "<redacted>" for k in ("JJ_ROOM_KEY_MASTER", "TURN_STATIC_AUTH_SECRET", "JJ_BROKER_KEY")})
    c["services"]["server"]["environment"]["JJ_ROOM_KEY"] = "<HMAC(master, id), derived at publish>"
    c["services"]["server"]["environment"]["JJ_BROKER_SECRET"] = "<HMAC(broker key, id), derived at publish>"
    return c


def candidates(token: str, published: set | None = None):
    """(run, digest, verdict) for the recent green ci.yml runs, newest first, down to the newest one that has an image:
    that one is "NEW" or "already published"; newer ones without an image are "no image (CI didn't build one)"."""
    if published is None:
        published = {p["sha"] for p in load_register()["previews"]}
    out = []
    for run in green_runs(token):
        digest = image_digest(token, run["head_sha"])
        if not digest:
            out.append((run, None, "no image (CI didn't build one)"))
            continue
        out.append((run, digest, "already published" if run["head_sha"] in published else "NEW"))
        break
    return out


def arg(name: str) -> str | None:
    i = sys.argv.index(name) + 1 if name in sys.argv else 0
    return sys.argv[i] if 0 < i < len(sys.argv) else None


def plan_mode():
    """Dry run: reads CI and the registry when SOURCE_READ_TOKEN is set; never touches TrueNAS, git or the edge."""
    reg = load_register() if os.environ.get("GITEA_TOKEN") else {"previews": [], "labels": {}, "pins": []}
    now = datetime.now(timezone.utc)
    published = {p["sha"] for p in reg["previews"]}
    print(f"register: {len(reg['previews'])} preview(s), labels {reg.get('labels', {})}, pins {reg.get('pins', [])}")
    todo = []
    token = os.environ.get("SOURCE_READ_TOKEN")
    if arg("--run-sha"):
        todo.append(({"head_sha": arg("--run-sha"), "html_url": None}, arg("--digest") or "sha256:" + "0" * 64))
    elif token:
        for run, digest, why in candidates(token):
            print(f"green run {run['id']} {run['head_sha'][:12]}: {why}, image {digest or '<none for this commit>'}")
            if why == "NEW":
                todo.append((run, digest))
    else:
        print("no SOURCE_READ_TOKEN here: can't list CI runs (use --run-sha <sha> [--digest <sha256:..>] for a hypothetical)")
    for run, digest in todo:
        pid = preview_id_for(reg, run["head_sha"])
        print(f"would publish {pid}: app jjp-{pid}, image {IMAGE}@{digest}")
        print(json.dumps(redacted(pid, digest)["services"]["server"]["environment"], indent=1))
        print(f"  health  {EDGE}/p/{pid}/healthz")
        print(f"  smoke   node scripts/smoke.mjs {PUBLIC}/p/{pid}/ <steps from assets/smoke.json>; others: {others_live(reg, pid) or 'none'}")
    print("retention would retire:", retention.plan(reg, now) or "nothing")
    out = arg("--index-out")
    if out:
        pathlib.Path(out).write_text(index_page.render(reg, now))
        print(f"index rendered to {out}")


async def resmoke(preview_id: str):
    reg = load_register()
    row = next((p for p in reg["previews"] if p["id"] == preview_id), None)
    if not row or row.get("retired"):
        raise SystemExit(f"publish: no live preview {preview_id} in the register")
    steps = declared_steps(preview_id)
    ok, line = smoke(preview_id, steps, others_live(reg, preview_id))
    row.update(smoke=steps, smokedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"), smokeResult=line,
               status="playable" if ok else "not playable", reason="" if ok else line.removeprefix("smoke: "))
    set_latest(reg)
    record.set_status(row, "success" if ok else "failure", line)
    async with TrueNAS(env("TRUENAS_APPS_WRITE_KEY")) as nas:
        await apply_edge(nas, reg)
    print(f"publish: {preview_id} {row['status']} {row['reason']}")


def needs_work() -> bool:
    """True when a poll has something to do: a new green build with an image, or an edge index behind the register.
    Checked before the slow tool install (Playwright and its libraries took ~7 of every 8 minutes, so the 5-minute
    poll ran back to back and replaced every waiting dispatch)."""
    reg = load_register()
    published = {p["sha"] for p in reg["previews"]}
    new = [r for r, _, why in candidates(env("SOURCE_READ_TOKEN"), published) if why == "NEW"]
    stale = not edge_current(reg)
    print(f"publish: {len(new)} new build(s), edge index {'stale' if stale else 'current'}")
    return bool(new) or stale


async def main():
    if "--needs-work" in sys.argv:
        sys.exit(0 if needs_work() else 10)  # 10 = nothing to do; any other failure stays a failure
    if "--plan" in sys.argv:
        return plan_mode()
    if arg("--resmoke"):
        return await resmoke(arg("--resmoke"))
    secrets = {k: env(k) for k in ("TRUENAS_APPS_WRITE_KEY", "SOURCE_READ_TOKEN", "JJ_ROOM_KEY_MASTER", "TURN_STATIC_AUTH_SECRET")}
    if os.environ.get("JJ_BROKER_KEY"):
        secrets["JJ_BROKER_KEY"] = os.environ["JJ_BROKER_KEY"]
    reg = load_register()
    published = {p["sha"] for p in reg["previews"]}
    todo = [(run, digest) for run, digest, why in candidates(secrets["SOURCE_READ_TOKEN"], published)
            if why == "NEW" or (why == "already published" and "--republish" in sys.argv)]
    if not todo:
        if not edge_current(reg):
            # A run that died after recording a preview but before re-applying the edge (run 1714: the TrueNAS socket
            # dropped during the 6-minute smoke), or a pin made by a tag push, left the index stale: catch up.
            async with TrueNAS(secrets["TRUENAS_APPS_WRITE_KEY"]) as nas:
                await apply_edge(nas, reg)
            print("publish: nothing new; the edge index caught up with the register")
            return
        print("publish: nothing new")
        return
    async with TrueNAS(secrets["TRUENAS_APPS_WRITE_KEY"]) as nas:
        await ensure_network(nas)
        for run, digest in reversed(todo):  # oldest first, so "Latest" ends on the newest
            def start(row):
                record.record_preview(row)
                record.set_status(row, "pending", "smoke running")
            row = await publish_one(nas, reg, run, digest, secrets, on_start=start)
            reg["previews"].insert(0, row)
            set_latest(reg)
            print(f"publish: {row['id']} {row['status']} {row['reason']}")
            ok = row["status"] == "playable"
            record.set_status(row, "success" if ok else "failure", row.get("smokeResult") if ok else (row["reason"] or "not playable"))
    # A fresh session: the smoke takes minutes and TrueNAS drops an idle API socket meanwhile (run 1714).
    async with TrueNAS(secrets["TRUENAS_APPS_WRITE_KEY"]) as nas:
        # Retention (P1-D06) on every publish: pins, Latest, the three newest and anything under 24 hours stay.
        retired = await retention.reconcile(nas, reg, datetime.now(timezone.utc), record)
        for pid in retired:
            print(f"publish: retired {pid}")
        await apply_edge(nas, reg)


if __name__ == "__main__":
    asyncio.run(main())
