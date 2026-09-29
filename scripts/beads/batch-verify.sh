#!/usr/bin/env bash
# Phase 2 of the code-first / batch-verify doctrine (docs/process/code-first-batch-verify.md).
#
# One central verification run over a whole wave of batch_pending beads, a
# revision-bound receipt, then per-bead close or rework. Only the batch
# verifier runs this; workers never close their own beads.
#
#   scripts/beads/batch-verify.sh plan  [--base <ref>]        # what would run, no execution
#   scripts/beads/batch-verify.sh run   [--base <ref>] [--allow-dirty] [--e2e smoke|all]
#   scripts/beads/batch-verify.sh close  <bead> --receipt <file>     # gate + close (green only)
#   scripts/beads/batch-verify.sh rework <bead> "<failing assertion + file:line>"
#
# Scope comes from `git diff <base>..HEAD`, never from what agents declare.
# <base> defaults to the head recorded in the newest receipt.
# Verifier identity: AGENT_NAME (your Agent Mail name), or --actor <name>.
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO" || exit 2
RECEIPTS=.beads/receipts
LOGS=$RECEIPTS/logs
ACTOR=${AGENT_NAME:-}
BASE=""
ALLOW_DIRTY=0
E2E=all

die() { echo "batch-verify: $*" >&2; exit 2; }
note() { echo "batch-verify: $*"; }

# ---- suite table ---------------------------------------------------------
# name | trigger regex over changed paths | compile gate | commands (;-separated)
# A stack's tests only run after its compile gate passes: an aborted compile
# can print a green prefix that looks like a pass.
suites() {
    local cargo="cargo"
    command -v rch >/dev/null 2>&1 && cargo="rch exec -- cargo"
    if [[ -f Cargo.toml ]]; then
        echo "rust|(^|/)Cargo\.(toml|lock)$|^crates/|\.rs$|$cargo test --workspace --no-run|$cargo test --workspace"
    fi
    echo "js|^(static|src|frontend|public)/|^tests/(unit|integration)/|^package(-lock)?\.json$|^(vite|vitest)\.config|npm run build|npm run test:unit;npm run test:integration"
    echo "server|^server/|^requirements\.txt$||npm run test:server"
    local e2e="npx playwright test tests/e2e"
    [[ $E2E == smoke ]] && e2e="npm run test:ci:e2e"
    echo "e2e|^(static|src|frontend|public|server)/|^tests/e2e/|^playwright\.config|^package(-lock)?\.json$|npm run build|$e2e"
}
# The trigger regex itself contains '|', so split on the LAST three '|'.
suite_field() { # line index(1=name,2=trigger,3=gate,4=cmds)
    local line=$1 idx=$2 name rest trig gate cmds
    name=${line%%|*}; rest=${line#*|}
    cmds=${rest##*|}; rest=${rest%|*}
    gate=${rest##*|}; trig=${rest%|*}
    case $idx in 1) echo "$name" ;; 2) echo "$trig" ;; 3) echo "$gate" ;; 4) echo "$cmds" ;; esac
}

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

changed_files() { git diff --name-only "$BASE"..HEAD; }

pending_beads() { br list --status batch_pending --json --limit 0 2>/dev/null | jq -r '(.issues // .)[] | .id'; }

selected_suites() { # prints suite lines whose trigger matches a changed path
    local files; files=$(changed_files)
    [[ -n $files ]] || return 0
    local line trig
    while IFS= read -r line; do
        trig=$(suite_field "$line" 2)
        if printf '%s\n' "$files" | grep -Eq "$trig"; then echo "$line"; fi
    done < <(suites)
}

cmd_plan() {
    resolve_base
    note "wave range $(git rev-parse --short "$BASE")..$(git rev-parse --short HEAD)"
    echo
    echo "batch_pending beads:"
    local b n
    for b in $(pending_beads); do
        n=$(git log --oneline "$BASE"..HEAD --grep "$b" | wc -l | tr -d ' ')
        printf '  %-40s %s commit(s) in range%s\n' "$b" "$n" "$([[ $n == 0 ]] && echo '  <- nothing to verify in this wave')"
    done
    echo
    echo "changed paths: $(changed_files | wc -l | tr -d ' ')"
    echo "suites:"
    local line
    while IFS= read -r line; do
        [[ -n $line ]] || continue
        printf '  %-7s gate: %-40s run: %s\n' "$(suite_field "$line" 1)" "$(suite_field "$line" 3)" "$(suite_field "$line" 4)"
    done < <(selected_suites)
}

cmd_run() {
    resolve_base
    local dirty; dirty=$(git status --porcelain --untracked-files=no)
    if [[ -n $dirty && $ALLOW_DIRTY -eq 0 ]]; then
        die "tracked changes are uncommitted. Commit-flush the swarm first (or --allow-dirty, recorded in the receipt)"
    fi
    mkdir -p "$RECEIPTS" "$LOGS"
    local n wave receipt logdir head tree
    n=$(ls "$RECEIPTS"/wave-*.json 2>/dev/null | wc -l | tr -d ' ')
    wave=$(printf 'wave-%03d' $((n + 1)))
    receipt="$RECEIPTS/$wave.json"
    logdir="$LOGS/$wave"
    mkdir -p "$logdir"
    head=$(git rev-parse HEAD)
    tree=$(git rev-parse HEAD^{tree})

    local beads_json='[]' b commits
    for b in $(pending_beads); do
        commits=$(git log --format=%H "$BASE"..HEAD --grep "$b" | jq -R . | jq -s .)
        beads_json=$(jq --arg id "$b" --argjson c "$commits" '. + [{id: $id, commits: $c}]' <<<"$beads_json")
    done

    local runs='[]' overall=pass line name gate cmds c rc start log i
    local gates_passed=$'\n' gates_failed=$'\n'
    while IFS= read -r line; do
        [[ -n $line ]] || continue
        name=$(suite_field "$line" 1); gate=$(suite_field "$line" 3); cmds=$(suite_field "$line" 4)
        i=0
        local steps=()
        # A compile gate shared by several suites runs once per wave.
        if [[ -n $gate && $gates_failed == *$'\n'"$gate"$'\n'* ]]; then
            note "[$name] skipped: shared compile gate '$gate' already failed"; continue
        fi
        [[ -n $gate && $gates_passed != *$'\n'"$gate"$'\n'* ]] && steps+=("gate:$gate")
        IFS=';' read -r -a parts <<<"$cmds"
        for c in "${parts[@]}"; do steps+=("test:$c"); done
        for c in "${steps[@]}"; do
            i=$((i + 1))
            log="$logdir/$name-$i.log"
            note "[$name] ${c#*:}"
            start=$(date +%s)
            bash -c "${c#*:}" >"$log" 2>&1; rc=$?
            runs=$(jq --arg s "$name" --arg k "${c%%:*}" --arg c "${c#*:}" --argjson rc "$rc" \
                --argjson d $(( $(date +%s) - start )) --arg log "$log" \
                '. + [{suite: $s, kind: $k, command: $c, exit: $rc, seconds: $d, log: $log}]' <<<"$runs")
            if [[ $rc -ne 0 ]]; then
                overall=fail
                note "[$name] FAILED (exit $rc) -> $log"
                if [[ ${c%%:*} == gate ]]; then
                    gates_failed+="${c#*:}"$'\n'
                    note "[$name] compile gate failed; skipping its tests (fix compile errors first)"; break
                fi
            elif [[ ${c%%:*} == gate ]]; then
                gates_passed+="${c#*:}"$'\n'
            fi
        done
    done < <(selected_suites)

    local tool
    tool=$(jq -n --arg node "$(node --version 2>/dev/null)" --arg npm "$(npm --version 2>/dev/null)" \
        --arg rustc "$(rustc --version 2>/dev/null)" --arg python "$(python3 --version 2>/dev/null)" \
        --arg br "$(br --version 2>/dev/null)" \
        --arg lock "$(shasum -a 256 package-lock.json Cargo.lock 2>/dev/null | awk '{print $2": "$1}' | paste -sd';' -)" \
        '{node: $node, npm: $npm, rustc: $rustc, python: $python, br: $br, lockfiles: $lock}')
    jq -n --arg wave "$wave" --arg base "$BASE" --arg head "$head" --arg tree "$tree" \
        --arg status "$overall" --arg at "$(date -u +%FT%TZ)" --arg actor "${ACTOR:-unknown}" \
        --arg dirty "$dirty" --argjson files "$(changed_files | jq -R . | jq -s .)" \
        --argjson beads "$beads_json" --argjson runs "$runs" --argjson tool "$tool" \
        '{wave: $wave, status: $status, at: $at, verifier: $actor, base: $base, head: $head, tree: $tree,
          dirty_tracked: ($dirty | split("\n") | map(select(length > 0))),
          toolchain: $tool, changed_files: $files, beads: $beads, runs: $runs}' >"$receipt"
    echo
    note "$wave: $overall. Receipt: $receipt"
    [[ $overall == pass ]] && note "next: tick each bead's exercised acceptance items, then: $0 close <bead> --receipt $receipt" \
                           || note "next: cluster failures by file, '$0 rework <bead> \"<assertion + file:line>\"' to the same assignee, fix, re-run (attempts stay recorded)"
    [[ $overall == pass ]]
}

cmd_close() {
    local bead=${1:-} receipt=""
    shift || true
    while [[ $# -gt 0 ]]; do case $1 in --receipt) receipt=$2; shift 2 ;; *) die "unknown arg $1" ;; esac; done
    [[ -n $bead && -f $receipt ]] || die "usage: close <bead> --receipt <file>"
    [[ -n $ACTOR ]] || die "set AGENT_NAME (or --actor) to the verifier's own name"
    [[ $(jq -r .status "$receipt") == pass ]] || die "$receipt is not green; beads close only on a green run"
    jq -e --arg id "$bead" 'any(.beads[]; .id == $id)' "$receipt" >/dev/null \
        || die "$bead was not batch_pending when $receipt was run; verify it in a new wave"
    [[ $(jq --arg id "$bead" '[.beads[] | select(.id == $id) | .commits[]] | length' "$receipt") -gt 0 ]] \
        || die "$bead has no commit in the verified range; nothing of it was exercised"
    # Revision binding: anything that moved since the run under a suite trigger invalidates it.
    local rhead moved line trig
    rhead=$(jq -r .head "$receipt")
    moved=$(git diff --name-only "$rhead"..HEAD)
    if [[ -n $moved ]]; then
        while IFS= read -r line; do
            trig=$(suite_field "$line" 2)
            if printf '%s\n' "$moved" | grep -Eq "$trig"; then
                die "verified files moved since $(git rev-parse --short "$rhead") ($(suite_field "$line" 1) scope); run a new wave"
            fi
        done < <(suites)
    fi
    local wave suites_run
    wave=$(jq -r .wave "$receipt")
    suites_run=$(jq -r '[.runs[] | select(.kind == "test") | .command] | join(", ")' "$receipt")
    br gate report "$bead" --gate batch_verify --provider batch-verifier --status pass --to closed \
        --note "run:$wave commit:$rhead suites:$suites_run" --actor "$ACTOR" || exit 1
    br close "$bead" --actor "$ACTOR" \
        --reason "Verified green in $wave at commit:$rhead receipt:$receipt" \
        --transition-comment "Batch-verified in $wave ($suites_run)." || exit 1
}

cmd_rework() {
    local bead=${1:-} why=${2:-}
    [[ -n $bead && -n $why ]] || die "usage: rework <bead> \"<failing assertion + file:line>\""
    [[ -n $ACTOR ]] || die "set AGENT_NAME (or --actor) to the verifier's own name"
    br update "$bead" --status rework --actor "$ACTOR" --transition-comment "$why"
}

sub=${1:-}; shift || true
args=()
while [[ $# -gt 0 ]]; do
    case $1 in
        --base) BASE=$2; shift 2 ;;
        --allow-dirty) ALLOW_DIRTY=1; shift ;;
        --e2e) E2E=$2; shift 2 ;;
        --actor) ACTOR=$2; shift 2 ;;
        *) args+=("$1"); shift ;;
    esac
done
case $sub in
    plan) cmd_plan ;;
    run) cmd_run ;;
    close) cmd_close "${args[@]}" ;;
    rework) cmd_rework "${args[@]}" ;;
    *) sed -n '2,17p' "$0"; exit 2 ;;
esac
