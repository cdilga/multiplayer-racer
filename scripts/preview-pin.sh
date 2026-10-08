#!/usr/bin/env bash
# Pin or unpin a rainbow preview (P1-D06) without opening Gitea: dispatches the Retention workflow
# (.gitea/workflows/deploy-retention.yml), which makes or deletes the `pin/<id>` tag and re-applies the index.
#
# Usage: scripts/preview-pin.sh <preview-id> [label]     pin, e.g. scripts/preview-pin.sh v02-0a6757f6 "Playtest 1"
#        scripts/preview-pin.sh --unpin <preview-id>
# Uses `tea api` with the `gitea-lan` login, so no token is handled here. Ids are on https://jammers-preview.dilger.dev/.
set -euo pipefail

if [[ "${1:-}" == "--unpin" && -n "${2:-}" ]]; then
  inputs=$(python3 -c 'import json,sys; print(json.dumps({"unpin": sys.argv[1]}))' "$2")
elif [[ -n "${1:-}" && "$1" != -* ]]; then
  inputs=$(python3 -c 'import json,sys; print(json.dumps({"pin": sys.argv[1], "label": sys.argv[2]}))' "$1" "${2:-}")
else
  sed -n '2,7p' "$0" >&2; exit 2
fi
tea api --login gitea-lan -X POST /repos/cdilga/multiplayer-racer/actions/workflows/deploy-retention.yml/dispatches \
  -d "{\"ref\":\"v0.2-revamp\",\"inputs\":$inputs}" >/dev/null
echo "dispatched Retention with $inputs; the index updates when the run finishes (about a minute)"
