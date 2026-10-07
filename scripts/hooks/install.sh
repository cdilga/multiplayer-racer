#!/usr/bin/env bash
# Installs the repo's versioned git hooks into this clone's .git/hooks (P1-F02): today the evidence commit-msg hook.
# Idempotent. An existing, different commit-msg hook is kept and chained (moved to hooks.d/commit-msg/00-previous).
set -euo pipefail
repo=$(git rev-parse --show-toplevel)
hooks=$(git -C "$repo" rev-parse --git-path hooks)
target=$hooks/commit-msg
shim='#!/usr/bin/env bash
# Installed by scripts/hooks/install.sh: the versioned hook lives in the repo.
exec "$(git rev-parse --show-toplevel)/scripts/hooks/commit-msg" "$@"'
if [[ -f $target ]] && ! grep -q 'scripts/hooks/commit-msg' "$target"; then
    mkdir -p "$hooks/hooks.d/commit-msg"
    mv "$target" "$hooks/hooks.d/commit-msg/00-previous"
    echo "install: kept the previous commit-msg hook as hooks.d/commit-msg/00-previous"
fi
printf '%s\n' "$shim" >"$target.new" && chmod +x "$target.new" && mv "$target.new" "$target"
chmod +x "$repo/scripts/hooks/commit-msg"
echo "install: commit-msg -> scripts/hooks/commit-msg"
