#!/usr/bin/env bash
# One-time/idempotent host preparation for multiplayer-racer.
# Renders the cloudflared config + credentials from .env values so the
# tunnel is fully defined in code (no dashboard configuration).
# Runs on the deploy target, in the deploy directory.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
    echo "ERROR: .env missing - deploy pushes it from the RUNTIME_ENV secret" >&2
    exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

: "${TUNNEL_ID:?TUNNEL_ID missing from .env}"
: "${TUNNEL_CREDENTIALS_B64:?TUNNEL_CREDENTIALS_B64 missing from .env}"
: "${TUNNEL_HOSTNAMES:?TUNNEL_HOSTNAMES missing from .env}"

mkdir -p cloudflared

# 644 not 600: the cloudflared container runs as a non-root user and reads
# this via a read-only bind mount. The deploy dir itself is the trust boundary.
echo "$TUNNEL_CREDENTIALS_B64" | base64 -d > cloudflared/credentials.json
chmod 644 cloudflared/credentials.json

{
    echo "tunnel: ${TUNNEL_ID}"
    echo "credentials-file: /etc/cloudflared/credentials.json"
    echo "ingress:"
    IFS=',' read -ra HOSTNAMES <<< "$TUNNEL_HOSTNAMES"
    for hostname in "${HOSTNAMES[@]}"; do
        echo "  - hostname: ${hostname}"
        echo "    service: http://multiplayer-racer:8000"
    done
    echo "  - service: http_status:404"
} > cloudflared/config.yml

echo "cloudflared config rendered for: ${TUNNEL_HOSTNAMES}"
