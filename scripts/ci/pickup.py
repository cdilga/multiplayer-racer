#!/usr/bin/env python3
"""Check CI once at bead boundaries; --claim gives the next free agent one repair.

No polling, dispatch, quarantine or code changes. A shared-tree lock covers repair
deduplication; br's atomic claim decides the winner. Without --claim this is read-only.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def run(*args):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True, timeout=45)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()[:500]}")
    return result.stdout.strip()


def api(path):
    return json.loads(run("tea", "api", "--login", "gitea-lan", path))


def latest_run(runs, branch):
    relevant = [r for r in runs if r.get("head_branch") == branch]
    return max(relevant, key=lambda r: r["id"], default=None)


def live_repair(issues, branch):
    return next((b for b in issues if "ci:repair" in b.get("labels", [])
                 and b.get("external_ref", "").startswith(f"ci-repair:{branch}:")
                 and b["status"] not in ("closed", "tombstone")), None)


def failed_contains_handoff(bead, failed, branch):
    comments = json.loads(run("br", "comments", bead["id"], "--json"))
    handoffs = [m.group(1) for c in comments for m in [re.search(r"commit:([0-9a-f]{7,40})\b", c["text"])] if m]
    if not handoffs:
        raise RuntimeError(f"{bead['id']} has no commit handoff; inspect before reassigning")
    head = failed["head_sha"]
    # Fetch only if the deciding commit is absent locally; no working tree changes.
    if subprocess.run(["git", "cat-file", "-e", f"{head}^{{commit}}"], cwd=ROOT, capture_output=True).returncode:
        run("git", "fetch", "-q", "gitea", branch)
    return subprocess.run(["git", "merge-base", "--is-ancestor", handoffs[-1], head], cwd=ROOT, capture_output=True).returncode == 0


def claim_repair(report, actor, branch, repo):
    # All providers share this lock; no TTL takeover can interrupt a live repair.
    lock = Path(run("git", "rev-parse", "--git-path", "jj-ci-pickup.lock"))
    if not lock.is_absolute():
        lock = ROOT / lock
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        data = json.loads(run("br", "list", "--label", "ci:repair", "--json", "--limit", "0"))
        issues = data.get("issues", []) if isinstance(data, dict) else data
        bead = live_repair(issues, branch)
        failed = report["run"]
        if bead is None:
            url = failed["html_url"]
            description = (f"CI batch {failed['id']} failed on {failed['head_sha']}. Run: {url}\n"
                           f"Failed jobs: {', '.join(j['name'] for j in report['failed_jobs'])}.\n"
                           f"Read logs: tea api --login gitea-lan /repos/{repo}/actions/runs/{failed['id']}/jobs?limit=100\n"
                           "Diagnose the failing assertions, reproduce with focused tests, fix forward, and publish a playable preview "
                           "when its image exists. Do not weaken gameplay acceptance or make diagnostic pushes. "
                           "This repair belongs to its claiming agent, regardless of who authored the batch. "
                           "Other agents continue disjoint game work. Record exact tests and run links.")
            acceptance = ("- [ ] Failed assertions and causes recorded; focused reproductions pass after the fixes.\n"
                          "- [ ] Fix commits pushed; a successful CI run containing the fixes is cited.\n"
                          "- [ ] Latest built image has a preview and its smoke result is recorded.")
            bead = json.loads(run("br", "create", f"CI repair: {branch} batch {failed['id']}", "--type", "bug",
                                  "--priority", "0", "--labels", "ci:repair,ev:ci", "--external-ref",
                                  f"ci-repair:{branch}:{failed['id']}", "--description", description,
                                  "--acceptance-criteria", acceptance, "--actor", actor, "--json"))
        if bead["status"] == "batch_pending":
            if not failed_contains_handoff(bead, failed, branch):
                return {**report, "action": "repair_pending", "bead": bead["id"], "assignee": bead.get("assignee")}
            # A red fix batch is a new handoff to the next free agent. CAS protects
            # a concurrent finalizer or author who has already resumed the repair.
            run("br", "update", bead["id"], "--status", "rework", "--assignee", "",
                "--if-unchanged", bead["updated_at"], "--actor", actor,
                "--transition-comment", f"CI batch {failed['id']} is red: {failed['html_url']}; next available agent resumes repair")
            bead = {**bead, "status": "rework", "assignee": None}
        if bead.get("assignee") and bead["assignee"] != actor:
            return {**report, "action": "repair_owned", "bead": bead["id"], "assignee": bead["assignee"]}
        if bead["status"] in ("open", "rework"):
            run("br", "update", bead["id"], "--claim", "--actor", actor)
        elif bead["status"] != "in_progress":
            return {**report, "action": "repair_blocked", "bead": bead["id"], "assignee": bead.get("assignee")}
        return {**report, "action": "repair", "bead": bead["id"], "assignee": actor}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--claim", action="store_true")
    args = parser.parse_args()
    branch = run("git", "branch", "--show-current")
    if not branch:
        raise RuntimeError("Use the shared development branch, not a detached HEAD")
    remote = run("git", "remote", "get-url", "gitea")
    repo = remote.split("://", 1)[-1].split("/", 1)[-1].removesuffix(".git")
    latest = latest_run(api(f"/repos/{repo}/actions/workflows/ci.yml/runs?branch={branch}&limit=50").get("workflow_runs", []), branch)
    if latest is None:
        report = {"action": "no_run", "branch": branch}
    elif latest["status"] != "completed":
        report = {"action": "running", "run": latest}
    elif latest.get("conclusion") not in ("failure", "cancelled", "timed_out", "action_required"):
        report = {"action": "game_work", "run": latest}
    else:
        jobs = api(f"/repos/{repo}/actions/runs/{latest['id']}/jobs?limit=100").get("jobs", [])
        report = {"action": "failed", "run": latest, "failed_jobs": [j for j in jobs if j.get("conclusion") in ("failure", "timed_out", "cancelled")]}
        if args.claim:
            actor = os.environ.get("AGENT_NAME", "")
            if not actor:
                raise RuntimeError("Set AGENT_NAME to your registered Agent Mail identity")
            report = claim_repair(report, actor, branch, repo)
    # Avoid dumping actor accounts, full repository objects, and unrelated run metadata.
    if "run" in report:
        report["run"] = {k: report["run"].get(k) for k in ("id", "head_sha", "status", "conclusion", "html_url")}
    if "failed_jobs" in report:
        report["failed_jobs"] = [{k: j.get(k) for k in ("id", "name", "conclusion")} for j in report["failed_jobs"]]
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        sys.exit(f"pickup: {error}\nCI could not be checked. Report this; do not claim CI is green.")
