#!/usr/bin/env bash
# Live beads graph at https://beads.dilger.dev (Authentik via Cloudflare Access).
# Runs only while this script runs: bv rebuilds the site when .beads changes, bv's
# preview server live-reloads open browsers, cloudflared exposes it (tunnel: beads-live).
set -euo pipefail
cd "$(dirname "$0")/.."

SITE="${BEADS_LIVE_DIR:-$HOME/.cache/beads-live/site}"
mkdir -p "$SITE"

pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM

bv --export-pages "$SITE" --pages-title "Joystick Jammers beads" --watch-export &
pids+=($!)
sleep 5
bv --preview-pages "$SITE" &
pids+=($!)
cloudflared tunnel run --url http://127.0.0.1:9000 beads-live &
pids+=($!)

echo "beads-live up: https://beads.dilger.dev (Ctrl-C to stop)"
wait
