#!/usr/bin/env bash
# Keep eris's per-run dirs bounded and report its cache sizes (P1-F06, plan §15.2).
#
# Usage: scripts/prune-caches.sh [--dry-run] [--days N]
#   Run from the Mac it runs itself on eris over ssh (ERIS_HOST, default eris); on eris it runs locally.
#   Run dirs (~/Work/runs/<id>, made by scripts/remote/eris.sh --run) with no writes for more than
#   N days (default 3) move to ~/Work/runs/.pruned/; entries there older than another N days are
#   deleted. A run dir is skipped while an eris.sh run holds the clone lock. Then it reports cache
#   sizes. Toolchains, browsers, the SDK and RCH's dirs are only reported: RCH prunes its own (rch gc).
set -euo pipefail

if [[ $(uname -n) != eris* && -z ${PRUNE_ON_ERIS:-} ]]; then
    exec ssh -o BatchMode=yes -o ConnectTimeout=8 "${ERIS_HOST:-eris}" \
        PRUNE_ON_ERIS=1 bash -s -- "$@" <"${BASH_SOURCE[0]}"
fi

days=3 dry=0
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) dry=1 ;;
        --days) days=${2:?--days needs N}; shift ;;
        *) echo "usage: scripts/prune-caches.sh [--dry-run] [--days N]" >&2; exit 2 ;;
    esac
    shift
done

runs=$HOME/Work/runs
mkdir -p "$runs/.pruned"
say() { echo "  $([[ $dry == 1 ]] && echo "would $1" || echo "$1")"; }

# A run that is still going keeps its dir: skip pruning while any eris.sh run holds the lock.
exec 9>>"$runs/.eris-clone.lock"
if ! flock -n -x 9; then
    echo "prune-caches: an eris.sh run is active; not moving run dirs this time"
else
    while IFS= read -r dir; do
        [[ -n $(find "$dir" -mmin "-$((days * 1440))" -print -quit) ]] && continue
        say "move $(basename "$dir") to .pruned/ (idle > $days days)"
        if [[ $dry == 0 ]]; then
            dest=$runs/.pruned/$(basename "$dir").$(date +%Y%m%d-%H%M%S)
            mv -- "$dir" "$dest" && touch "$dest"
        fi
    done < <(find "$runs" -mindepth 1 -maxdepth 1 -type d ! -name '.*')
    while IFS= read -r old; do
        say "delete .pruned/$(basename "$old") (set aside > $days days ago)"
        [[ $dry == 1 ]] || rm -rf -- "$old"
    done < <(find "$runs/.pruned" -mindepth 1 -maxdepth 1 -mmin "+$((days * 1440))")
fi
flock -u 9

echo "eris cache sizes:"
for p in "$runs" "$runs/.pruned" ~/.cache/ms-playwright ~/.npm ~/.cargo/registry ~/.cargo/git \
    ~/.rustup ~/Android/Sdk ~/.android/avd /tmp/rch /Users/cdilga/Documents/dev \
    ~/Work/dev/multiplayer-racer/node_modules ~/Work/dev/multiplayer-racer/target; do
    if [[ -e $p ]]; then printf '  %-8s %s\n' "$(du -sh "$p" 2>/dev/null | cut -f1)" "$p"; fi
done
df -h ~ /tmp | awk 'NR == 1 || /\// { printf "  %s\n", $0 }'
