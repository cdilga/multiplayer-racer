#!/usr/bin/env bash
# Print a Playtest-1 task's §15 block and every plan section it cites, so a worker reads only what
# its bead names (P1-F04). Usage: scripts/plan-ref.sh P1-N03 [P1-XXX …]   (the P1- prefix is optional)
set -euo pipefail
exec python3 "$(dirname "$0")/reconcile_plans_to_beads.py" --plan-ref "$@"
