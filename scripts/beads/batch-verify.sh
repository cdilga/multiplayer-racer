#!/usr/bin/env bash
# The verifier's local lane runner (P1-F02, docs/process/bead-workflow.md): the same lanes as CI, picked by the same
# planner (scripts/ci/plan.mjs) from a git range and run with the same scripts (scripts/ci/verify-lanes.sh), for when
# CI is down or a batch_pending wave needs one revision-bound receipt.
#
#   scripts/beads/batch-verify.sh plan  [--base <ref>] [--head <ref>]  # the lanes and batch_pending beads, no execution
#   scripts/beads/batch-verify.sh run   [--base <ref>] [--local] [--allow-dirty]
#       runs the lanes on eris (scripts/remote/eris.sh: HEAD must be pushed) or, with --local, on this machine;
#       writes .beads/receipts/wave-NNN.json (base, head, tree, dirty inventory, toolchain, lockfile hashes, each lane's
#       command, machine, exit code and seconds) and the full logs under .beads/receipts/logs/wave-NNN/
#   scripts/beads/batch-verify.sh close <bead> --receipt <wave.json>   # gate + close a batch_pending bead from a green wave
#   scripts/beads/batch-verify.sh close <bead> --evidence <record.md>  # evidence close (docs/evidence/README.md)
#   scripts/beads/batch-verify.sh rework <bead> "<failing assertion + file:line>"
#   scripts/beads/batch-verify.sh run --matrix milestone|every-wave    # the platform matrix (P1-F10)
#
# Scope comes from the planner over `git diff <base> HEAD`, never from what agents declare. <base> defaults to the head
# of the newest receipt. Verifier identity: AGENT_NAME (your Agent Mail name), or --actor <name>.
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO" || exit 2
RECEIPTS=.beads/receipts
LOGS=$RECEIPTS/logs
ACTOR=${AGENT_NAME:-}
BASE=""
HEADREF=HEAD
ALLOW_DIRTY=0
LOCAL=0
MATRIX=

die() { echo "batch-verify: $*" >&2; exit 2; }
note() { echo "batch-verify: $*"; }

latest_receipt() { ls "$RECEIPTS"/wave-*.json 2>/dev/null | sort | tail -1; }

resolve_base() {
    if [[ -z $BASE ]]; then
        local r; r=$(latest_receipt)
        [[ -n $r ]] || die "no previous receipt; pass --base <ref> for the first wave"
        BASE=$(jq -r .head "$r")
    fi
    git rev-parse --verify -q "$BASE^{commit}" >/dev/null || die "base '$BASE' is not a commit"
    BASE=$(git rev-parse "$BASE")
}

pending_beads() { br list --status batch_pending --json --limit 0 2>/dev/null | jq -r '(.issues // .)[] | .id'; }

# plan_to <file>: the planner's key=value outputs for BASE..HEAD; prints its one-line summary.
plan_to() { node scripts/ci/plan.mjs --base "$BASE" --head "$HEADREF" --github-output "$1" | head -1; }

cmd_plan() {
    resolve_base
    note "range $(git rev-parse --short "$BASE")..$(git rev-parse --short "$HEADREF"), $(git diff --name-only "$BASE" "$HEADREF" | wc -l | tr -d ' ') changed paths"
    local tmp; tmp=$(mktemp)
    plan_to "$tmp"
    note "lanes: $(sed -n 's/^lanes=//p' "$tmp" | sed 's/^$/checks only/')"
    rm -f "$tmp"
    echo
    echo "batch_pending beads:"
    local b n
    for b in $(pending_beads); do
        n=$(git log --oneline "$BASE"..HEAD --grep "$b" | wc -l | tr -d ' ')
        printf '  %-40s %s commit(s) in range%s\n' "$b" "$n" "$([[ $n == 0 ]] && echo '  <- nothing to verify in this wave')"
    done
}

cmd_run() {
    resolve_base
    local dirty; dirty=$(git status --porcelain --untracked-files=no)
    if [[ -n $dirty && $ALLOW_DIRTY -eq 0 ]]; then
        die "tracked changes are uncommitted. Commit-flush first (or --allow-dirty, recorded in the receipt)"
    fi
    mkdir -p "$RECEIPTS" "$LOGS"
    local n wave receipt logdir head tree planfile
    n=$(ls "$RECEIPTS"/wave-*.json 2>/dev/null | wc -l | tr -d ' ')
    wave=$(printf 'wave-%03d' $((n + 1)))
    receipt="$RECEIPTS/$wave.json"
    logdir="$LOGS/$wave"
    mkdir -p "$logdir"
    head=$(git rev-parse HEAD)
    tree=$(git rev-parse HEAD^{tree})
    planfile=$logdir/plan.txt
    local summary; summary=$(plan_to "$planfile")
    note "$summary"

    local beads_json='[]' b commits
    for b in $(pending_beads); do
        commits=$(git log --format=%H "$BASE"..HEAD --grep "$b" | jq -R . | jq -s .)
        beads_json=$(jq --arg id "$b" --argjson c "$commits" '. + [{id: $id, commits: $c}]' <<<"$beads_json")
    done

    local rc where
    if [[ $LOCAL -eq 1 ]]; then
        where=local
        scripts/ci/verify-lanes.sh "$planfile" "$logdir"; rc=$?
    else
        where=eris
        # eris runs the pushed HEAD in its clean clone; the plan file and logs travel by scp.
        ssh -o BatchMode=yes eris "mkdir -p ~/Work/runs/$wave" && scp -q "$planfile" "eris:Work/runs/$wave/plan.txt" ||
            die "eris unreachable (use --local)"
        scripts/remote/eris.sh --run "$wave" "scripts/ci/verify-lanes.sh \$JJ_RUN_DIR/plan.txt \$JJ_RUN_DIR/lanes"; rc=$?
        scp -q -r "eris:Work/runs/$wave/lanes/." "$logdir/" 2>/dev/null
    fi
    [[ -f $logdir/lanes.jsonl ]] || die "no lane results came back (exit $rc); see the output above"

    local overall=pass
    grep -q '"exit":[1-9]' "$logdir/lanes.jsonl" && overall=fail
    [[ $rc -ne 0 && $overall == pass ]] && overall=fail

    local tool
    tool=$(jq -n --arg node "$(node --version 2>/dev/null)" --arg rustc "$(rustc --version 2>/dev/null)" \
        --arg br "$(br --version 2>/dev/null)" --arg where "$where" \
        --arg lock "$(shasum -a 256 package-lock.json web/package-lock.json Cargo.lock 2>/dev/null | awk '{print $2": "$1}' | paste -sd';' -)" \
        '{node_here: $node, rustc_here: $rustc, br: $br, lanes_ran_on: $where, lockfiles: $lock}')
    jq -n --arg wave "$wave" --arg base "$BASE" --arg head "$head" --arg tree "$tree" --arg status "$overall" \
        --arg at "$(date -u +%FT%TZ)" --arg actor "${ACTOR:-unknown}" --arg dirty "$dirty" --arg plan "$summary" \
        --argjson files "$(git diff --name-only "$BASE" HEAD | jq -R . | jq -s .)" \
        --argjson beads "$beads_json" --argjson lanes "$(jq -s . "$logdir/lanes.jsonl")" --argjson tool "$tool" \
        '{wave: $wave, status: $status, at: $at, verifier: $actor, base: $base, head: $head, tree: $tree,
          dirty_tracked: ($dirty | split("\n") | map(select(length > 0))), toolchain: $tool, plan: $plan,
          changed_files: $files, beads: $beads, lanes: $lanes,
          commands: {checks: "scripts/ci/checks.sh", "rust-lint": "scripts/ci/rust-lint.sh",
                     "rust-test": "scripts/ci/rust-test.sh <plan crates>", build: "scripts/ci/build-web.sh (JJ_STORE=off)",
                     browser: "node scripts/ci/run-slot.mjs 1 <every planned target>"}}' >"$receipt"
    echo
    jq -r '.lanes[] | "  \(.lane | . + "          " | .[0:10]) exit \(.exit)  \(.seconds) s  on \(.machine)  \(.summary)"' "$receipt"
    note "$wave: $overall. Receipt: $receipt (logs: $logdir)"
    [[ $overall == pass ]] && note "next: $0 close <bead> --receipt $receipt" \
                           || note "next: '$0 rework <bead> \"<assertion + file:line>\"' to the same assignee, fix, re-run"
    [[ $overall == pass ]]
}

cmd_close() {
    local bead=${1:-} receipt="" evidence=""
    shift || true
    while [[ $# -gt 0 ]]; do
        case $1 in --receipt) receipt=$2; shift 2 ;; --evidence) evidence=$2; shift 2 ;; *) die "unknown arg $1" ;; esac
    done
    [[ -n $bead ]] || die "usage: close <bead> --receipt <wave.json> | --evidence <record.md>"
    [[ -n $ACTOR ]] || die "set AGENT_NAME (or --actor) to the verifier's own name"
    if [[ -n $evidence ]]; then
        # Evidence close: the record must pass the schema check; close.sh then records receipt:<record>.
        python3 scripts/beads/evidence-check.py "$bead" "$evidence" || exit 1
        local tests
        tests=$(sed -n 's/^covers: *//p' "$evidence" | head -1)
        AGENT_NAME=$ACTOR scripts/beads/close.sh "$bead" --tests "evidence record $evidence covers $tests" --receipt "$evidence"
        return
    fi
    [[ -f $receipt ]] || die "usage: close <bead> --receipt <wave.json> | --evidence <record.md>"
    [[ $(jq -r .status "$receipt") == pass ]] || die "$receipt is not green; beads close only on a green run"
    jq -e --arg id "$bead" 'any(.beads[]; .id == $id)' "$receipt" >/dev/null \
        || die "$bead was not batch_pending when $receipt was run; verify it in a new wave"
    [[ $(jq --arg id "$bead" '[.beads[] | select(.id == $id) | .commits[]] | length' "$receipt") -gt 0 ]] \
        || die "$bead has no commit in the verified range; nothing of it was exercised"
    # Revision binding: anything that moved since the run and that the planner would test invalidates it.
    local rhead moved
    rhead=$(jq -r .head "$receipt")
    moved=$(git diff --name-only "$rhead" HEAD | paste -sd, -)
    if [[ -n $moved ]]; then
        local again
        again=$(node scripts/ci/plan.mjs --changed "$moved" | head -1)
        [[ $again == *"lanes checks only"* ]] || die "files the lanes test moved since $(git rev-parse --short "$rhead") ($again); run a new wave"
    fi
    local wave lanes_run
    wave=$(jq -r .wave "$receipt")
    lanes_run=$(jq -r '[.lanes[] | "\(.lane)@\(.machine)"] | join(", ")' "$receipt")
    br gate report "$bead" --gate batch_verify --provider batch-verifier --status pass --to closed \
        --note "run:$wave commit:$rhead lanes:$lanes_run" --actor "$ACTOR" || exit 1
    br close "$bead" --actor "$ACTOR" \
        --reason "Verified green in $wave at commit:$rhead receipt:$receipt" \
        --transition-comment "Batch-verified in $wave ($lanes_run)." || exit 1
}

cmd_rework() {
    local bead=${1:-} why=${2:-}
    [[ -n $bead && -n $why ]] || die "usage: rework <bead> \"<failing assertion + file:line>\""
    [[ -n $ACTOR ]] || die "set AGENT_NAME (or --actor) to the verifier's own name"
    br update "$bead" --status rework --actor "$ACTOR" --transition-comment "$why"
}

# The platform matrix (P1-F10): the demo journey per lane, labelled by lane and machine. Lanes this machine doesn't have are
# reported unavailable with the reason; the emulator lanes close by receipt (docs/evidence/P1-F10/), Chromium and WebKit by CI.
cmd_matrix() {
    note "platform matrix ($MATRIX) on $(hostname -s)"
    node web/tests/journeys/harness/matrix.mjs --tier "$MATRIX"
}

sub=${1:-}; shift || true
args=()
while [[ $# -gt 0 ]]; do
    case $1 in
        --base) BASE=$2; shift 2 ;;
        --head) HEADREF=$2; shift 2 ;;   # plan only: an older range, e.g. to compare with that CI run
        --allow-dirty) ALLOW_DIRTY=1; shift ;;
        --local) LOCAL=1; shift ;;
        --matrix) MATRIX=$2; shift 2 ;;
        --actor) ACTOR=$2; shift 2 ;;
        *) args+=("$1"); shift ;;
    esac
done
case $sub in
    plan) cmd_plan ;;
    run)
        if [[ -n $MATRIX ]]; then
            [[ $MATRIX == milestone || $MATRIX == every-wave ]] || die "--matrix takes milestone or every-wave"
            cmd_matrix
        else cmd_run; fi ;;
    close) cmd_close "${args[@]}" ;;
    rework) cmd_rework "${args[@]}" ;;
    *) sed -n '2,19p' "$0"; exit 2 ;;
esac
