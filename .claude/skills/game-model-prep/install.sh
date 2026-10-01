#!/usr/bin/env bash
# Install the canonical game-model-prep skill into the per-user skill dirs that
# Codex and Copilot read, by symlink (single source of truth, no drift).
# Idempotent. Re-run after pulling updates is unnecessary (symlinks track the source).
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="game-model-prep"

link() {
  local dest_parent="$1"
  if [ ! -d "$dest_parent" ]; then
    echo "skip: $dest_parent does not exist (agent not installed?)"
    return
  fi
  local dest="$dest_parent/$NAME"
  if [ -L "$dest" ] || [ -e "$dest" ]; then rm -rf "$dest"; fi
  ln -s "$SRC" "$dest"
  echo "linked: $dest -> $SRC"
}

link "$HOME/.codex/skills"
link "$HOME/.copilot/skills"
echo "done. Claude reads it in-place from .claude/skills/$NAME."
