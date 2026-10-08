"""One-time migration (R117, 2026-10-08): jammers-deploy's file register (register/previews.json at 3ddc6c9e) into the
git record: a preview/ or retired/ tag per row, a `preview/smoke/<id>` status per row, pin/ tags for pins and labels.
Idempotent (existing tags are left alone). Kept for the record of how the first tags were made.
  GITEA_TOKEN=… python3 infra/previews/scripts/migrate_register.py <previews.json> [--plan]
"""
import json
import sys

import record

reg = json.load(open(sys.argv[1]))
plan = "--plan" in sys.argv
for p in reversed(reg["previews"]):  # oldest first
    retired = bool(p.get("retired"))
    kind = "retired" if retired else "preview"
    state = "success" if p.get("status") == "playable" else "failure"
    desc = p.get("smokeResult") if state == "success" else (p.get("reason") or "not playable")
    print(f"{kind}/{p['id']} -> {p['sha'][:12]}  status {state}: {(desc or '')[:80]}")
    if plan:
        continue
    if retired:
        body = {k: p[k] for k in record.FIELDS if k in p}
        record.create_tag(f"retired/{p['id']}", p["sha"], record.summary(p, "retired") + "\n" + json.dumps(body, indent=1))
    else:
        record.record_preview(p)
    record.set_status(p, state, desc or "")
for label, pid in reg.get("labels", {}).items():
    if label != "Latest":
        print(f"pin/{pid} ({label})")
        if not plan:
            sha = next(p["sha"] for p in reg["previews"] if p["id"] == pid)
            record.create_tag(f"pin/{pid}", sha, label)
for pid in reg.get("pins", []):
    print(f"pin/{pid}")
    if not plan:
        sha = next(p["sha"] for p in reg["previews"] if p["id"] == pid)
        record.create_tag(f"pin/{pid}", sha, "Pinned")
