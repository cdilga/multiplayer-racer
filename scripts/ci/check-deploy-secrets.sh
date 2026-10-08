#!/usr/bin/env bash
# R117's light guard: deploy secrets appear only in the deploy workflows (.gitea/workflows/deploy-*.yml, code under
# infra/), and those run only on the `jammers-deploy` runner (TrueNAS). Any other workflow may name only the secrets
# listed in ALLOWED (the image push). Run by scripts/ci/checks.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
ALLOWED="REGISTRY_PUSH_TOKEN"
rc=0
for f in .gitea/workflows/*.yml .gitea/workflows/*.yaml; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  used=$(grep -o 'secrets\.[A-Za-z0-9_]*' "$f" | sed 's/secrets\.//' | sort -u || true)
  if [[ $name == deploy-*.yml ]]; then
    bad=$(grep -E '^\s*runs-on:' "$f" | grep -v 'runs-on: jammers-deploy\s*$' || true)
    [ -z "$bad" ] || { echo "check-deploy-secrets: $f is a deploy workflow but runs elsewhere: $bad"; rc=1; }
    continue
  fi
  for s in $used; do
    [[ " $ALLOWED " == *" $s "* ]] || { echo "check-deploy-secrets: $f references secrets.$s (deploy secrets belong to deploy-*.yml only)"; rc=1; }
  done
done
exit $rc
