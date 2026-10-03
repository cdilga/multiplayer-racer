#!/usr/bin/env bash
# Keep the Mac's local target/ under its disk budget (P1-F06, plan §15.2 and §13b.5). Workspace-wide
# cargo runs on the RCH workers and CI, so local artifacts are disposable.
#
# Usage: scripts/reclaim-target.sh [--dry-run] [--budget <GiB>] [--all]
#   default    prune incremental caches and lane dirs (target/<lane>: debug, release, wasm32-…,
#              per-lane CARGO_TARGET_DIRs) that nothing has written for 14 days; if target/ is still
#              over budget (15 GiB), prune every incremental cache too
#   --all      remove the whole target/ dir
#   --dry-run  report what would go, change nothing
# Reports the size before and after. Exits 1 if target/ is still over budget (then use --all).
set -euo pipefail

budget_gib=15 idle_days=14 mode=prune dry=0
while [[ $# -gt 0 ]]; do
    case $1 in
        --all) mode=all ;;
        --dry-run) dry=1 ;;
        --budget) budget_gib=${2:?--budget needs GiB}; shift ;;
        *) echo "usage: scripts/reclaim-target.sh [--dry-run] [--budget <GiB>] [--all]" >&2; exit 2 ;;
    esac
    shift
done

target="$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)/target"
kib() { if [[ -d $target ]]; then du -sk "$target" | awk '{print $1}'; else echo 0; fi; }
gib() { awk -v k="$(kib)" 'BEGIN { printf "%.2f", k / 1048576 }'; }
gone=()
drop() { # drop <dir> <why>; skips anything inside a dir already dropped
    local g
    for g in "${gone[@]+"${gone[@]}"}"; do [[ $1/ == "$g"* ]] && return 0; done
    gone+=("$1/")
    echo "  $([[ $dry == 1 ]] && echo would\ remove || echo remove) ${1#"$target"/} ($(du -sh "$1" | awk '{print $1}'), $2)"
    [[ $dry == 1 ]] || rm -rf -- "$1"
}
idle() { [[ -z $(find "$1" -mtime "-$idle_days" -print -quit) ]]; } # nothing in it (itself included) written lately
over() { awk -v k="$(kib)" -v b="$budget_gib" 'BEGIN { exit !(k > b * 1048576) }'; }

before=$(gib)
echo "target/: ${before} GiB (budget ${budget_gib} GiB)"
[[ -d $target ]] || exit 0

if [[ $mode == all ]]; then
    drop "$target" "--all"
else
    for lane in "$target"/*/; do # lane dirs: every top-level dir of target/
        lane=${lane%/}
        idle "$lane" && drop "$lane" "no writes for $idle_days days"
    done
    while IFS= read -r inc; do
        idle "$inc" && drop "$inc" "incremental, idle $idle_days days"
    done < <(find "$target" -maxdepth 3 -type d -name incremental 2>/dev/null)
    if over; then
        while IFS= read -r inc; do drop "$inc" "incremental, over budget"; done \
            < <(find "$target" -maxdepth 3 -type d -name incremental 2>/dev/null)
    fi
fi

after=$(gib)
echo "target/: ${before} GiB -> ${after} GiB$([[ $dry == 1 ]] && echo ' (dry run: nothing removed)')"
if [[ $dry == 0 ]] && over; then
    echo "reclaim-target: still over ${budget_gib} GiB; run with --all" >&2
    exit 1
fi
