#!/usr/bin/env bash
# Runs on eris after an `eris.sh --run`: whatever the run left in the clone (a test that writes evidence into the repo
# by default) moves to <run dir>/stray/ with its path kept, and modified tracked files are copied there and restored,
# so the clone is clean for the next sync. Run from the clone's root.
#   scripts/remote/eris-tidy.sh <run dir>
set -uo pipefail
run_dir=${1:?usage: eris-tidy.sh <run dir>}
[[ -n $(git status --porcelain) ]] || exit 0
stray="$run_dir/stray"
mkdir -p "$stray"
while IFS= read -r -d '' f; do
    mkdir -p "$stray/$(dirname "$f")" && mv "$f" "$stray/$f"
done < <(git ls-files -z --others --exclude-standard)
while IFS= read -r -d '' f; do
    mkdir -p "$stray/$(dirname "$f")" && cp "$f" "$stray/$f"
done < <(git diff -z --name-only)
git restore --worktree -- .
echo "eris.sh: the run left files in the clone; moved to $stray/" >&2
