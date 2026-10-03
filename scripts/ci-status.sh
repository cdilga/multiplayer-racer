#!/usr/bin/env bash
# The CI lanes for a commit on Gitea (P1-D01), so nobody queries Gitea by hand.
#
# Usage: scripts/ci-status.sh [--wait] [--timeout <s>] [<rev>]   (rev defaults to HEAD)
#   Prints one line per lane: state, lane name, run link. Lanes are Gitea's commit statuses for the commit
#   (one per workflow job), read through `tea api` with the `gitea-lan` login, so no token is handled here.
#   --wait polls every 20 s until no lane is pending, or until --timeout (default 3600 s).
#
# The last line is the run's URL (scripts/beads/close.sh cites it as the receipt).
# Exit: 0 every lane passed, 1 a lane failed (or errored), 2 lanes pending or none reported yet (also on timeout).
set -euo pipefail

wait=0 timeout=3600 rev=HEAD
while [[ $# -gt 0 ]]; do
    case $1 in
        --wait) wait=1; shift ;;
        --timeout) timeout=${2:?--timeout needs seconds}; shift 2 ;;
        -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
        *) rev=$1; shift ;;
    esac
done

sha=$(git rev-parse --verify "$rev^{commit}")
url=$(git remote get-url gitea)                       # http://192.168.11.12:3001/cdilga/multiplayer-racer.git
repo=${url#*://*/}; repo=${repo%.git}                  # cdilga/multiplayer-racer
export GITEA_BASE=${url%/"$repo"*}                       # http://192.168.11.12:3001

report() {
    tea api --login gitea-lan "/repos/$repo/commits/$sha/statuses?limit=50" | python3 -c '
import json, os, sys
latest, runs = {}, []
for s in json.load(sys.stdin):                         # newest first; keep the newest status per lane
    latest.setdefault(s["context"], s)
code = 2 if not latest else 0
for ctx, s in sorted(latest.items()):
    state = s["status"] if "status" in s else s.get("state", "pending")
    link = s.get("target_url") or ""
    if link.startswith("/"): link = os.environ["GITEA_BASE"] + link
    print(f"{state:8} {ctx}  {link}")
    run = link.split("/jobs/")[0]
    if run and run not in runs: runs.append(run)
    if state in ("failure", "error"): code = 1
    elif state in ("pending", "running", "waiting", "blocked") and code != 1: code = 2
for run in runs: print(run)
sys.exit(code)'
}

deadline=$((SECONDS + timeout))
while :; do
    set +e; out=$(report); code=$?; set -e
    if [[ $wait -eq 0 || $code -ne 2 || $SECONDS -ge $deadline ]]; then
        echo "commit ${sha:0:10} on $repo"
        [[ -n $out ]] && echo "$out" || echo "(no lanes reported yet)"
        exit "$code"
    fi
    sleep 20
done
