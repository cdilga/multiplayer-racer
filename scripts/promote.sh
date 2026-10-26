#!/usr/bin/env bash
# P1-D08: promote a smoked preview to production (https://jammers.dilger.dev) by dispatching the Promote workflow
# (.gitea/workflows/deploy-prod.yml, code infra/previews/scripts/promote.py). It runs that preview's exact image.
#
#   scripts/promote.sh                 the index's Latest (the newest playable preview)
#   scripts/promote.sh v02-<sha8>      that preview (ids are on https://jammers-preview.dilger.dev/)
#   scripts/promote.sh --rollback      back to the build production served before
#   scripts/promote.sh --status        what production serves now
#   scripts/promote.sh --smoke         the production game smoke (two phones over WebRTC race the real room) from here
# Uses `tea api` with the `gitea-lan` login, so no token is handled here.
set -euo pipefail

case "${1:-latest}" in
  --status) curl -fsS https://jammers.dilger.dev/version; echo; exit 0 ;;
  --smoke) cd "$(dirname "$0")/../infra/previews" && SMOKE_REALM=production exec node scripts/smoke.mjs https://jammers.dilger.dev/ room,join-webrtc,input,resume,race,hud ;;
  latest|--rollback|v02-*) build=${1:-latest} ;;
  *) sed -n '2,9p' "$0" >&2; exit 2 ;;
esac
tea api --login gitea-lan -X POST /repos/cdilga/multiplayer-racer/actions/workflows/deploy-prod.yml/dispatches \
  -d "{\"ref\":\"main\",\"inputs\":{\"build\":\"$build\"}}" >/dev/null
echo "dispatched Promote with build=$build; production switches in a minute or two"
echo "watch: http://192.168.11.12:3001/cdilga/multiplayer-racer/actions?workflow=deploy-prod.yml   then: scripts/promote.sh --status"
