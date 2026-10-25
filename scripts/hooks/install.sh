#!/usr/bin/env bash
# Installs the repo's versioned git hooks into this clone's .git/hooks (P1-F02): the evidence commit-msg hook and the rustfmt pre-commit check.
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
# The rustfmt check joins the pre-commit chain (Agent Mail's chain runner runs every executable in hooks.d/pre-commit).
mkdir -p "$hooks/hooks.d/pre-commit"
printf '%s\n' "${shim/commit-msg/pre-commit-rustfmt}" >"$hooks/hooks.d/pre-commit/40-rustfmt"
chmod +x "$hooks/hooks.d/pre-commit/40-rustfmt" "$repo/scripts/hooks/pre-commit-rustfmt"
echo "install: pre-commit chain 40-rustfmt -> scripts/hooks/pre-commit-rustfmt"
# Keep the installed Agent Mail reader/matcher outside the executable chain.
# The versioned adapter checks each outgoing commit under its author's identity.
guard=$hooks/hooks.d/pre-push/50-agent-mail.py
if [[ -f $guard ]] && ! grep -q 'scripts/hooks/pre-push-agent-mail.py' "$guard"; then
    cp "$guard" "$hooks/agent-mail-pre-push-base.py"
fi
if [[ -f $hooks/agent-mail-pre-push-base.py ]]; then
    printf '%s\n' "${shim/commit-msg/pre-push-agent-mail.py}" >"$guard"
    chmod +x "$guard" "$repo/scripts/hooks/pre-push-agent-mail.py"
    echo "install: pre-push checks each commit's Agent trailer"
fi
