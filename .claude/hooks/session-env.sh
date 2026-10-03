#!/usr/bin/env bash
# SessionStart hook: give every Bash call in a Claude Code session this repo's pinned Node (.nvmrc) without
# sourcing nvm per command. The owner's shell loads nvm lazily through node/npm/npx functions that switch to
# nvm's *default* version, so the env file drops those functions and puts the pinned version first on PATH.
# Rust needs nothing here: rustup honours rust-toolchain.toml. Secrets stay out of the session environment.
set -euo pipefail
[[ -n ${CLAUDE_ENV_FILE:-} ]] || exit 0
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
want=$(tr -d ' v\n' <"$root/.nvmrc" 2>/dev/null || true)
[[ -n $want ]] || exit 0
bin="${NVM_DIR:-$HOME/.nvm}/versions/node/v$want/bin"
if [[ -x $bin/node ]]; then
    {
        echo 'unset -f nvm node npm npx 2>/dev/null || true'
        echo "export PATH=\"$bin:\$PATH\""
    } >>"$CLAUDE_ENV_FILE"
else
    echo "session-env: Node $want (from .nvmrc) isn't installed: nvm install $want" >&2
fi
