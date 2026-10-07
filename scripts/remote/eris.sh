#!/usr/bin/env bash
# Run a command on eris against the commit the Mac has checked out (P1-F06, plan §15.2).
#
# Usage: scripts/remote/eris.sh [--run <id>] <cmd...>
#   One argument is run as a shell snippet ('cd web && npm test'); several are quoted as one command.
#   --run <id>  gives the command ~/Work/runs/<id> (created) as $JJ_RUN_DIR for outputs, evidence,
#               browser profiles and server state. Only non-code goes there.
#
# Steps: `ru sync` on eris (ff-only; ru skips a dirty clone), then refuse unless eris's clone sits at
# the Mac's HEAD with a clean tree (unpushed commits: push first), then run the command in
# ~/Work/dev/multiplayer-racer with output streamed back. Uncommitted Mac changes never reach eris;
# uncommitted Rust work goes through RCH instead. This script never edits anything in the clone.
#
# Exit: the command's own status, or 2 usage, 3 refused (not in sync), 4 eris unreachable.
# Env: ERIS_HOST (default eris; eris-remote works off the LAN); ERIS_MIN=<commit> runs at any synced commit containing
#      it instead of exactly the Mac's HEAD.
set -euo pipefail

host=${ERIS_HOST:-eris}
clone='~/Work/dev/multiplayer-racer'
lock='~/Work/runs/.eris-clone.lock' # syncs take it exclusively, runs share it

die() { echo "eris.sh: $*" >&2; exit "${code:-3}"; }

run_id=""
if [[ ${1:-} == --run ]]; then
    run_id=${2:-}
    shift 2 || true
    [[ $run_id =~ ^[A-Za-z0-9._-]+$ ]] || code=2 die "--run needs an id made of [A-Za-z0-9._-]"
fi
[[ $# -gt 0 ]] || code=2 die "usage: scripts/remote/eris.sh [--run <id>] <cmd...>"
if [[ $# -eq 1 ]]; then cmd=$1; else cmd=$(printf '%q ' "$@"); fi

repo=$(git -C "$(dirname "${BASH_SOURCE[0]}")/../.." rev-parse --show-toplevel)
mac_head=$(git -C "$repo" rev-parse HEAD)
# ERIS_MIN=<commit>: run at any synced commit that contains it (lanes pushing often move the Mac's HEAD under you).
min=""
[[ -n ${ERIS_MIN:-} ]] && min=$(git -C "$repo" rev-parse "$ERIS_MIN")
mac_branch=$(git -C "$repo" symbolic-ref --short -q HEAD || echo "(detached)")
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=8)

# 1. Sync. If runs hold the clone and it is already at the Mac's HEAD, there is nothing to sync.
rc=0
sync_out=$(ssh "${ssh_opts[@]}" "$host" bash -s -- "$mac_head" "${min:-$mac_head}" 2>&1 <<EOF
mkdir -p ~/Work/runs && exec 9>>$lock
at_head() { [ "\$(git -C $clone rev-parse HEAD)" = "\$1" ]; }
# Untracked evidence a run wrote into the clone (an older eris.sh, or a test with a hard-coded path) moves to a run
# dir of its own, so it never blocks the sync; any other local change still refuses below.
if [ -n "\$(git -C $clone status --porcelain)" ] && [ -z "\$(git -C $clone status --porcelain | grep -v '^?? docs/evidence/')" ]; then
  tidy=~/Work/runs/stray-\$(date +%Y%m%d-%H%M%S)
  (cd $clone && git ls-files -z --others --exclude-standard -- docs/evidence | while IFS= read -r -d '' f; do mkdir -p "\$tidy/\$(dirname "\$f")" && mv "\$f" "\$tidy/\$f"; done)
  echo "eris.sh: moved stray evidence out of the clone to \$tidy" >&2
fi
# A sync interrupted earlier (a killed eris.sh) leaves ru wanting --resume/--restart: restart it unattended.
rusync() { ru sync --non-interactive --quiet || ru sync --restart --non-interactive --quiet; }
if flock -n -x 9; then rusync || echo "RU_SYNC_EXIT=\$?"
elif at_head "\$1"; then echo "RU_SYNC=skipped (runs in progress; clone already at \${1:0:12})"
else echo "eris.sh: waiting for runs on eris to finish before syncing" >&2
     flock -w 3600 -x 9 && { rusync || echo "RU_SYNC_EXIT=\$?"; }
fi
echo "ERIS_HEAD=\$(git -C $clone rev-parse HEAD)"
echo "ERIS_HAS_MIN=\$(git -C $clone merge-base --is-ancestor "\$2" HEAD 2>/dev/null && echo yes || echo no)"
echo "ERIS_BRANCH=\$(git -C $clone symbolic-ref --short -q HEAD)"
echo "ERIS_DIRTY=\$(git -C $clone status --porcelain | head -3 | tr '\n' ' ')"
EOF
) || rc=$?
if [[ $rc -eq 255 ]]; then
    code=4 die "can't reach $host (off or asleep). Rust: rch exec -- cargo … falls back to devbox;" \
        "otherwise run per-crate on the Mac (docs/process/dev-topology.md)."
fi
field() { sed -n "s/^$1=//p" <<<"$sync_out" | tail -1; }
eris_head=$(field ERIS_HEAD) eris_branch=$(field ERIS_BRANCH) eris_dirty=$(field ERIS_DIRTY) eris_has_min=$(field ERIS_HAS_MIN)
[[ -n $eris_head ]] || die "sync step failed on $host:"$'\n'"$sync_out"
grep -E '^(RU_SYNC|eris.sh)' <<<"$sync_out" >&2 || true

# 2. Refuse unless eris is exactly at the Mac's HEAD and clean.
if [[ -n ${eris_dirty// /} ]]; then
    die "eris's clone has local changes ($eris_dirty). Nobody edits on eris: tell the owner, don't run."
fi
if [[ -n $min ]]; then
    [[ $eris_has_min == yes ]] || die "refusing: eris is at ${eris_head:0:12}, which lacks ERIS_MIN ${min:0:12} (push it, then rerun)."
elif [[ $eris_head != "$mac_head" ]]; then
    tip=$(git -C "$repo" ls-remote origin "refs/heads/$mac_branch" | cut -f1)
    if [[ $mac_branch != "$eris_branch" ]]; then
        why="eris tracks $eris_branch but the Mac is on $mac_branch"
    elif [[ -z $tip ]]; then
        why="$mac_branch isn't on origin: push first"
    elif [[ $tip == "$mac_head" ]]; then
        why="the Mac's HEAD is pushed but eris's sync didn't reach it (ru output above)"
    elif git -C "$repo" merge-base --is-ancestor "$tip" HEAD 2>/dev/null; then
        why="the Mac has unpushed commits ($(git -C "$repo" rev-list --count "$tip"..HEAD) ahead of origin): push first"
    elif git -C "$repo" merge-base --is-ancestor HEAD "$tip" 2>/dev/null; then
        why="origin/$mac_branch is ahead of the Mac: pull first"
    else
        why="the Mac and origin/$mac_branch differ (fetch, then push or pull)"
    fi
    die "refusing: eris is at ${eris_head:0:12}, the Mac at ${mac_head:0:12}; $why."
fi
if [[ -n $(git -C "$repo" status --porcelain --untracked-files=no) ]]; then
    echo "eris.sh: note: uncommitted Mac changes don't reach eris; it runs ${mac_head:0:12}." >&2
fi

# 3. Run under a shared lock, so no sync moves the clone mid-run. The command doesn't inherit the
#    lock fd, so anything it leaves running in the background can't block later syncs.
setup="cd $clone && exec 9>>$lock && flock -s 9"
if [[ -n $min ]]; then
    setup+=" && { git merge-base --is-ancestor $min HEAD || { echo 'eris.sh: eris moved during the sync wait; rerun' >&2; exit 3; }; }"
else
    setup+=" && { [ \"\$(git rev-parse HEAD)\" = $mac_head ] || { echo 'eris.sh: eris moved during the sync wait; rerun' >&2; exit 3; }; }"
fi
setup+=' && export PATH="$HOME/.cargo/bin:$PATH"'
after=""
if [[ -n $run_id ]]; then
    # Outputs default into the run dir (tests honour JJ_EVIDENCE_DIR / JJ_CAPTURE_DIR), so evidence and captures never
    # land in the clone; the command can still override them.
    setup+=" && mkdir -p ~/Work/runs/$run_id && export JJ_RUN_DIR=\$HOME/Work/runs/$run_id"
    setup+=' && export JJ_EVIDENCE_DIR=${JJ_EVIDENCE_DIR:-$JJ_RUN_DIR/ev} JJ_CAPTURE_DIR=${JJ_CAPTURE_DIR:-$JJ_RUN_DIR/shots}'
    # Whatever a run still leaves in the clone (a test with a hard-coded evidence path) goes to the run dir's stray/
    # (paths kept) and the clone is restored, so the next sync never finds it dirty.
    after='; rc=$?; ~/Work/dev/multiplayer-racer/scripts/remote/eris-tidy.sh "$JJ_RUN_DIR"; exit $rc'
fi
tty=(-T)
[[ -t 0 && -t 1 ]] && tty=(-t)
exec ssh "${ssh_opts[@]}" "${tty[@]}" "$host" "$setup && { bash -c $(printf %q "$cmd") 9>&-$after; }"
