#!/usr/bin/env bash
# R139: start a CI run on demand (no per-push, scheduled or nightly runs). Selective by default: what changed since the
# last green. One runs at a time; a dispatch while one is queued folds into that batch.
#   scripts/ci/run.sh          the usual batch
#   scripts/ci/run.sh --full   every suite
set -euo pipefail
full=false; [[ ${1:-} == --full ]] && full=true
tea api --login gitea-lan -X POST /repos/cdilga/multiplayer-racer/actions/workflows/ci.yml/dispatches \
  -d "{\"ref\":\"v0.2-revamp\",\"inputs\":{\"full\":\"$full\"}}" >/dev/null
echo "ci: dispatched (full=$full) on v0.2-revamp; watch with scripts/ci-status.sh --wait"
