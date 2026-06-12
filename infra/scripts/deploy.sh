#!/usr/bin/env bash
# Deploy script - run by CI on the target host via SSH.
# Usage: deploy.sh [image_tag]
set -euo pipefail

IMAGE_TAG="${1:-latest}"

cd "$(dirname "$0")"

# shellcheck disable=SC1091
[ -f .env ] && { set -a; source .env; set +a; }
HOST_PORT="${HOST_PORT:-8095}"

echo "=== Deploying multiplayer-racer:${IMAGE_TAG} ==="

docker pull "ghcr.io/cdilga/multiplayer-racer:${IMAGE_TAG}"

if [ "$IMAGE_TAG" != "latest" ]; then
    sed -i "s|image: ghcr.io/cdilga/multiplayer-racer:.*|image: ghcr.io/cdilga/multiplayer-racer:${IMAGE_TAG}|" docker-compose.yml
fi

docker compose up -d --remove-orphans

echo "Waiting for health check on :${HOST_PORT}..."
for i in $(seq 1 30); do
    if curl -sf "http://localhost:${HOST_PORT}/health" > /dev/null 2>&1; then
        echo "Health check passed!"
        exit 0
    fi
    sleep 2
done

echo "ERROR: Health check failed after 60s" >&2
docker compose logs --tail=50 app
exit 1
