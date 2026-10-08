"""Git is the record of what is deployed (R117): previews are tags and commit statuses on the game repo, not a file.

  preview/<id>   annotated tag on the preview's source commit; the annotation is one summary line, then JSON:
                 {id, sha, branch, digest, ciRun, title, publishedAt, changed}
  retired/<id>   replaces preview/<id> when retention retires it; the same JSON plus {retired, retiredReason}
  pin/<id>       a pinned preview (exempt from retention); the annotation's first line is its label, e.g.
                 "Playtest 1" (shown on the index) or just "Pinned". Pin or unpin with the Retention workflow:
                   .gitea/workflows/deploy-retention.yml with input pin=<id> (label=<text>), or unpin=<id>

  status         commit status context `preview/smoke/<id>`: pending while it smokes, success = playable,
                 failure = not playable; the description is the smoke's PASS line or the reason.

`load()` turns those into the dict the publisher, retention and index have always used ({previews, labels, pins});
the writers below change git only. ci.yml doesn't run on tags (its push trigger lists branches only).
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

GITEA = os.environ.get("GITEA_URL", "http://192.168.11.12:3001")
REPO = os.environ.get("JJ_RECORD_REPO", "cdilga/multiplayer-racer")
PUBLIC = "https://jammers-preview.dilger.dev"
FIELDS = ("id", "sha", "branch", "digest", "ciRun", "title", "publishedAt", "changed", "retired", "retiredReason")


def token() -> str:
    t = os.environ.get("GITEA_TOKEN", "")
    if not t:
        raise SystemExit("record: GITEA_TOKEN is missing (the workflow's own token)")
    return t


def api(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{GITEA}/api/v1/repos/{REPO}{path}", data=data, method=method, headers={
        "Authorization": f"token {token()}", "Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        if method == "GET" and e.code == 404:
            return None
        raise RuntimeError(f"record: {method} {path} -> {e.code} {e.read()[:200]!r}") from None


def tags() -> list[dict]:
    out, page = [], 1
    while True:
        batch = api("GET", f"/tags?page={page}&limit=50") or []
        out += batch
        if len(batch) < 50:
            return out
        page += 1


def parse(message: str) -> dict:
    body = message.split("\n", 1)[1] if "\n" in message else ""
    try:
        d = json.loads(body)
    except ValueError:
        return {}
    return {k: d[k] for k in FIELDS if k in d}


def statuses(sha: str) -> dict[str, dict]:
    """The newest status per context on a commit."""
    latest = {}
    for s in api("GET", f"/commits/{sha}/statuses?limit=50") or []:
        latest.setdefault(s["context"], s)
    return latest


STEPS = ("room", "join-webrtc", "input", "resume", "drive", "hud", "round")


def steps_of(desc: str) -> list[str]:
    """The step names in a PASS line ("smoke: PASS room ZG5H, isolated from 3 other preview(s), join-webrtc (host, 1 ms),
    input, ..."), so a card reads the same whether it was rendered at publish time or from the record."""
    if not desc.startswith("smoke: PASS"):
        return []
    body = re.sub(r"\([^)]*\)", "", desc.removeprefix("smoke: PASS"))
    words = [part.strip().split(" ")[0] for part in body.split(",")]
    return [w for w in words if w in STEPS]


def apply_status(row: dict, st: dict | None):
    state = (st or {}).get("status") or (st or {}).get("state")
    desc = (st or {}).get("description") or ""
    if state == "success":
        row["status"], row["reason"], row["smokeResult"] = "playable", "", desc
        row["smoke"] = steps_of(desc)
        row["smokedAt"] = st.get("updated_at") or st.get("created_at")
    elif state == "pending":
        row["status"], row["reason"] = "not playable", "the smoke is still running (or its run died)"
    else:
        row["status"], row["reason"] = "not playable", (desc.removeprefix("smoke: ") or "no smoke result recorded")


def load() -> dict:
    rows, pins, labels = {}, [], {}
    for t in tags():
        kind, _, pid = t["name"].partition("/")
        if kind in ("preview", "retired") and pid:
            row = {"id": pid, "sha": t["commit"]["sha"], **parse(t.get("message") or "")}
            row["id"] = pid
            if kind == "retired":
                row.setdefault("retired", row.get("publishedAt") or "retired")
                rows[pid] = row  # a retired tag wins over a preview tag a crashed retirement left behind
            else:
                rows.setdefault(pid, row)
        elif kind == "pin" and pid:
            label = (t.get("message") or "").split("\n", 1)[0].strip()
            if label and label.lower() != "pinned":
                labels[label] = pid
            else:
                pins.append(pid)
    by_sha: dict[str, dict] = {}
    for row in rows.values():
        if row["sha"] not in by_sha:
            by_sha[row["sha"]] = statuses(row["sha"])
        apply_status(row, by_sha[row["sha"]].get(f"preview/smoke/{row['id']}"))
    previews = sorted(rows.values(), key=lambda r: r.get("publishedAt", ""), reverse=True)
    reg = {"previews": previews, "labels": labels, "pins": pins}
    set_latest(reg)  # not a tag: derived, so the hourly retention run and the index see it too
    return reg


def set_latest(reg: dict):
    """Latest is the newest playable, un-retired preview; never one that failed its smoke."""
    live = [p["id"] for p in reg["previews"] if p.get("status") == "playable" and not p.get("retired")]
    if live:
        reg["labels"]["Latest"] = live[0]  # previews are newest first
    else:
        reg["labels"].pop("Latest", None)


def summary(row: dict, kind: str) -> str:
    return f"{kind} {row['id']}: {row.get('digest', '?')} published {row.get('publishedAt', '?')}"


def create_tag(name: str, sha: str, message: str) -> bool:
    """False when the tag already exists (another run made it): tags are the idempotency key."""
    try:
        api("POST", "/tags", {"tag_name": name, "target": sha, "message": message})
        return True
    except RuntimeError as e:
        if " 409 " in str(e) or "already exists" in str(e):
            return False
        raise


def delete_tag(name: str):
    try:
        api("DELETE", f"/tags/{urllib.parse.quote(name, safe='/')}")
    except RuntimeError as e:
        if " 404 " not in str(e):
            raise


def record_preview(row: dict) -> bool:
    body = {k: row[k] for k in FIELDS if k in row and k not in ("retired", "retiredReason")}
    return create_tag(f"preview/{row['id']}", row["sha"], summary(row, "preview") + "\n" + json.dumps(body, indent=1))


def set_status(row: dict, state: str, description: str):
    api("POST", f"/statuses/{row['sha']}", {"state": state, "context": f"preview/smoke/{row['id']}",
                                             "description": description[:250], "target_url": f"{PUBLIC}/p/{row['id']}/"})


def record_retired(row: dict):
    """retired/<id> first, then the preview tag goes: a crash in between leaves both, and load() reads it as retired."""
    body = {k: row[k] for k in FIELDS if k in row}
    create_tag(f"retired/{row['id']}", row["sha"], summary(row, "retired") + "\n" + json.dumps(body, indent=1))
    delete_tag(f"preview/{row['id']}")
