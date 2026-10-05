#!/usr/bin/env bash
# Close a bead in one command: the whole of docs/process/bead-workflow.md steps 4-6 (push, CI, tick, gate, close).
#
#   scripts/beads/close.sh <bead|P1-ID> --tests "AC1: <test> AC2: <test> …" [--comment "<one line>"]
#       green CI on a pushed commit naming the bead: waits on scripts/ci-status.sh --wait, then closes
#   scripts/beads/close.sh <bead|P1-ID> --tests "…" --receipt docs/evidence/<P1-ID>/<file>
#       an evidence close (ev:owner/deploy-repo/hardware), or any close before CI exists (P1-D01, P1-F02)
#   scripts/beads/close.sh <bead|P1-ID> --tests "…" --pending
#       hand off instead of waiting: batch_pending with the commit and tests; the verifier closes it on green
#
# It finds the newest commit naming the bead, pushes it (and its LFS objects) if needed, ticks every acceptance
# box, records the batch_verify gate and closes. Needs AGENT_NAME (the commit guard and the br actor).
# Contract for scripts/ci-status.sh (P1-F02): `--wait` blocks until CI finishes for HEAD, prints the run URL as its
# last stdout line, and exits 0 green, 1 red, 2 still pending.
# Exit: 0 closed or handed off, 1 a step failed or CI is red, 2 usage, 3 CI still pending.
set -euo pipefail

usage() { sed -n '2,10p' "$0" >&2; exit 2; }
die() { echo "close: $*" >&2; exit 1; }

[[ $# -ge 1 ]] || usage
ref=$1; shift
tests="" comment="" receipt="" pending=0
while [[ $# -gt 0 ]]; do
    case $1 in
        --tests) tests=${2:?--tests needs text}; shift ;;
        --comment) comment=${2:?--comment needs text}; shift ;;
        --receipt) receipt=${2:?--receipt needs a path}; shift ;;
        --pending) pending=1 ;;
        *) usage ;;
    esac
    shift
done
[[ -n $tests ]] || { echo "close: --tests is required (which test covers each acceptance item)" >&2; usage; }
[[ -n ${AGENT_NAME:-} ]] || die "set AGENT_NAME to your Agent Mail name"
cd "$(git rev-parse --show-toplevel)"

# Resolve a P1 ID to its live bead.
id=$ref
if [[ $ref == P1-* ]]; then
    id=$(python3 - "$ref" <<'PY'
import json, sys
hits = [d["id"] for d in map(json.loads, open(".beads/issues.jsonl")) if d.get("external_ref") == sys.argv[1] and d.get("status") != "closed"]
print(hits[0] if len(hits) == 1 else "")
PY
)
    [[ -n $id ]] || die "no single open bead carries external_ref $ref"
fi

sha=$(git log -1 --format=%H --grep="$id" HEAD)
[[ -n $sha ]] || die "no commit on this branch names $id: commit with the P1 ID and bead ID first"
short=${sha:0:9}

# Push the commit and its LFS objects when the branch is ahead of its upstream.
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || die "the branch has no upstream to push to"
remote=${upstream%%/*} branch=$(git rev-parse --abbrev-ref HEAD)
if [[ $(git rev-list --count "$upstream..HEAD") -gt 0 ]]; then
    echo "close: pushing $branch (Gitea, then the GitHub mirror)"
    scripts/push.sh "$branch"
fi
git merge-base --is-ancestor "$sha" "$upstream" || die "$short isn't on $upstream yet"

# Visual beads (owner 2026-10-04): a committed self-review with the screenshots that were looked at, or no close.
if python3 - "$id" <<'PY'
import json, sys
for d in map(json.loads, open(".beads/issues.jsonl")):
    if d["id"] == sys.argv[1]: sys.exit(0 if "visual" in (d.get("labels") or []) else 1)
sys.exit(1)
PY
then
    pid=$(python3 -c 'import json,sys
for d in map(json.loads, open(".beads/issues.jsonl")):
    if d["id"] == sys.argv[1]: print(d.get("external_ref") or d["id"])' "$id")
    review="docs/evidence/$pid/self-review.md"
    [[ -f $review ]] || die "$id is a visual bead: run docs/process/visual-self-review.md and commit $review with the screenshots you looked at"
    git ls-files --error-unmatch "$review" >/dev/null 2>&1 || die "$review isn't committed"
    git diff --quiet HEAD -- "$review" || die "$review has uncommitted changes"
    for h in "## Looked at" "## Defects found and fixed" "## Remaining defects" "## Not covered"; do
        grep -q -- "$h" "$review" || die "$review is missing the section '$h'"
    done
    imgs=$(grep -oE '[A-Za-z0-9_./-]+\.(png|jpe?g|webp)' "$review" | sort -u || true)  # no match must reach the die below, not pipefail
    [[ -n $imgs ]] || die "$review names no screenshots: list the images you looked at"
    for i in $imgs; do
        f="docs/evidence/$pid/$i"; [[ -f $f ]] || f=$i
        [[ -f $f ]] || die "$review names $i but it isn't in docs/evidence/$pid/"
    done
    echo "close: visual self-review present ($review)"
fi

if [[ $pending == 1 ]]; then
    br update "$id" --status batch_pending --transition-comment "commit:$short $tests" --actor "$AGENT_NAME" >/dev/null
    echo "close: $id handed off (batch_pending, commit $short); the verifier closes it when CI is green"
    exit 0
fi

if [[ -n $receipt ]]; then
    [[ -f $receipt ]] || die "receipt $receipt doesn't exist"
    git ls-files --error-unmatch "$receipt" >/dev/null 2>&1 || die "receipt $receipt isn't committed"
    git diff --quiet HEAD -- "$receipt" || die "receipt $receipt has uncommitted changes"
    provider=local evidence=$receipt
else
    [[ -x scripts/ci-status.sh ]] || die "no CI yet (scripts/ci-status.sh lands with P1-F02): close with --receipt docs/evidence/<P1-ID>/<file>"
    echo "close: waiting for CI on $short"
    set +e; out=$(scripts/ci-status.sh --wait); rc=$?; set -e
    case $rc in
        0) ;;
        2) echo "close: CI still pending for $short; rerun later or use --pending" >&2; exit 3 ;;
        *) die "CI is red for $short: $(tail -1 <<<"$out") (a red lane on your change is yours to fix)" ;;
    esac
    provider=gitea-ci evidence=$(tail -1 <<<"$out")
fi

# Tick every acceptance box: closing claims each item is met (BEAD-DEFINITION-OF-DONE's anti-narrowing clause).
ac=$(python3 -c 'import json,sys
for d in map(json.loads, open(".beads/issues.jsonl")):
    if d["id"] == sys.argv[1]: print(d.get("acceptance_criteria") or "", end="")' "$id")
if grep -q -- '- \[ \]' <<<"$ac"; then
    br update "$id" --acceptance-criteria "${ac//- \[ \]/- [x]}" --actor "$AGENT_NAME" >/dev/null
fi
br gate report "$id" --gate batch_verify --provider "$provider" --status pass --to closed \
    --note "receipt:$evidence commit:$short" --actor "$AGENT_NAME" >/dev/null
br close "$id" --reason "receipt:$evidence $tests" \
    --transition-comment "${comment:-closed on $provider, commit $short}" --actor "$AGENT_NAME" >/dev/null
echo "close: $id closed (receipt:$evidence, commit $short). Commit .beads/issues.jsonl with your next change."
