#!/usr/bin/env python3
"""Is a commit green? (used by scripts/beads/close.sh and the verifier)

A commit counts as green when **any completed, successful ci.yml run on the branch tested a commit that contains it**
(the commit itself or a descendant). Not "the run on the commit itself": with several lanes pushing, every waiting
ci.yml run is replaced by the next push and only the running one finishes (concurrency `cancel-in-progress: false`), so
most commits never get a run of their own; P1-C11 sat on a cancelled run that way. A later green run that contains the
commit tested it (the planner diffs from the last green run, so the commit's paths were in that diff).

  scripts/ci/green-for.py <rev> [--wait] [--timeout <s>] [--branch <name>]
Prints the deciding run's URL last. Exit 0 green, 1 red (the newest completed run containing it failed and none is
queued or running), 2 not decided yet (nothing completed contains it, or a containing run is still going).
"""
import json
import subprocess
import sys
import time

args = sys.argv[1:]
wait = "--wait" in args
timeout = int(args[args.index("--timeout") + 1]) if "--timeout" in args else 3600
branch = args[args.index("--branch") + 1] if "--branch" in args else "v0.2-revamp"
rev = next((a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--timeout", "--branch"))), "HEAD")


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True)


sha = git("rev-parse", "--verify", f"{rev}^{{commit}}").stdout.strip()
if not sha:
    sys.exit(f"green-for: no commit {rev}")
remote = "gitea"
repo = git("remote", "get-url", remote).stdout.strip().split("://", 1)[-1].split("/", 1)[-1].removesuffix(".git")


def runs():
    out = subprocess.run(["tea", "api", "--login", "gitea-lan",
                          f"/repos/{repo}/actions/workflows/ci.yml/runs?branch={branch}&limit=50"],
                         capture_output=True, text=True).stdout
    try:
        return json.loads(out).get("workflow_runs", [])
    except ValueError:
        return []


def contains(head):
    if git("cat-file", "-e", f"{head}^{{commit}}").returncode != 0:
        git("fetch", "-q", remote, branch)
    return git("merge-base", "--is-ancestor", sha, head).returncode == 0


def decide():
    rs = sorted(runs(), key=lambda r: r["id"], reverse=True)
    live, newest_done = False, None
    for r in rs:
        if not contains(r["head_sha"]):
            continue
        if r["status"] != "completed":
            live = True
            continue
        if r.get("conclusion") == "success":
            return 0, r
        if r.get("conclusion") in ("failure",) and newest_done is None:
            newest_done = r
    if live or newest_done is None:
        return 2, None
    return 1, newest_done


deadline = time.time() + timeout
while True:
    code, run = decide()
    if code != 2 or not wait or time.time() > deadline:
        break
    time.sleep(30)
if run:
    print(f"green-for: {sha[:9]} {'green' if code == 0 else 'red'} in run {run['id']} at {run['head_sha'][:9]}")
    print(run.get("html_url") or f"run {run['id']}")
else:
    print(f"green-for: {sha[:9]}: no completed ci.yml run contains it yet")
sys.exit(code)
