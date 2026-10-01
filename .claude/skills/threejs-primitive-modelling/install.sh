#!/usr/bin/env bash
# Symlink this skill into the per-user skill dirs Codex/Copilot read (single source of truth). Idempotent.
# Claude reads it in place from .claude/skills/threejs-primitive-modelling.
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; NAME="threejs-primitive-modelling"
for parent in "$HOME/.codex/skills" "$HOME/.copilot/skills"; do
  if [ -d "$parent" ]; then rm -rf "$parent/$NAME"; ln -s "$SRC" "$parent/$NAME"; echo "linked: $parent/$NAME -> $SRC"; else echo "skip: $parent (not installed)"; fi
done
