#!/usr/bin/env bash
# Publish the design POC (art/ui/poc/) to https://jammers-preview.dilger.dev/poc/.
# CI runs this on every push touching art/ui/poc/ (.gitea/workflows/poc-deploy.yml, key in $POC_DEPLOY_KEY);
# by hand it uses your own ssh config. The preview edge bind-mounts the target folder at /srv/poc, so this is an
# rsync: no app update, no restart.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
dest="${POC_DEST:-chris@192.168.11.12:/mnt/vessel/apps/jammers-preview-poc/}"
ssh_cmd="ssh -o StrictHostKeyChecking=accept-new"
if [ -n "${POC_DEPLOY_KEY:-}" ]; then
  key="$(mktemp)"; trap 'rm -f "$key"' EXIT
  printf '%s\n' "$POC_DEPLOY_KEY" > "$key"; chmod 600 "$key"
  ssh_cmd="$ssh_cmd -i $key"
fi
rsync -az --delete --exclude '.DS_Store' -e "$ssh_cmd" "$root/art/ui/poc/" "$dest"
sleep 1
code=$(curl -s -o /dev/null -w '%{http_code}' "https://jammers-preview.dilger.dev/poc/")
echo "published $(git -C "$root" rev-parse --short HEAD) -> /poc/ (HTTP $code)"
[ "$code" = 200 ]
