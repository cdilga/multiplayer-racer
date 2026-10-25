#!/usr/bin/env bash
# Push a branch to Gitea (primary: CI runs there) and then GitHub (the passive mirror), each with its LFS objects
# first, because GitHub's pre-receive hook rejects LFS pointers whose objects it doesn't have (P1-D01).
#
# Why not a Gitea push mirror: Gitea push mirrors push with --mirror, which would prune every GitHub branch Gitea
# doesn't carry (GitHub keeps old branches Gitea dropped).
#
# Usage: scripts/push.sh [<branch>]   (default: the current branch). Needs AGENT_NAME for the pre-push hook.
set -euo pipefail
exec python3 "$(git rev-parse --show-toplevel)/scripts/agents/publish.py" "$@"
