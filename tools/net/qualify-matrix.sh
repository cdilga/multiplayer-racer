#!/usr/bin/env bash
# The P1-N08 rows, one receipt each under docs/evidence/P1-N08/. Run from the repo root on eris (WebRTC doesn't work on
# the Mac), via `scripts/remote/eris.sh --run P1-N08 'tools/net/qualify-matrix.sh <row>'`.
# The build under test is a running jj-server (a preview or a local one); its ICE list decides what the rows use.
#   BASE      build base URL ending in /          (required)
#   BUILD     what the receipt names as the build (required, e.g. the commit)
#   HW        hardware text                        (default: eris, headless Chromium, loopback)
#   MAC_CDP   http://<mac>:9222 for cross-machine rows (the Mac's Chrome started with --remote-debugging-port=9222)
# Rows: direct | direct-wifi | coturn-lan | local-coturn | cloudflare-443 | netem | payload
set -euo pipefail
: "${BASE:?}" "${BUILD:?}"
HW=${HW:-"eris, headless Chromium, loopback"}
q() { node tools/net/qualify.mjs --base "$BASE" --build "$BUILD" --hardware "$HW" "$@"; }
case "${1:?row}" in
  direct)  q --row direct-loopback --topology "host and controller pages on one machine, no TURN" --expect any ;;
  direct-wifi)  # controller on eris, host page on the Mac over the home Wi-Fi
    q --row direct-wifi --host-cdp "${MAC_CDP:?}" --insecure-origin "${ORIGIN:?}" --expect any \
      --topology "controller on eris, host on the Mac, home Wi-Fi/LAN (a direct pair is not proof of LAN locality)" ;;
  coturn-lan)  # forced through the real coturn at its LAN address (the WAN VIP is WAN-side only)
    q --row coturn-lan --policy relay --drop-stun --rewrite-turn "${COTURN_LAN:-192.168.11.12:3479}" --expect coturn-relay \
      ${MAC_CDP:+--host-cdp "$MAC_CDP"} --topology "forced relay via the real coturn at its LAN address" ;;
  local-coturn)  # a coturn container on this machine: tools/net/local-coturn.sh up, server started with JJ_TURN_URLS to it
    q --row local-coturn --policy relay --drop-stun --rewrite-turn "127.0.0.1:${LOCAL_COTURN_PORT:-3479}" --expect coturn-relay \
      --topology "forced relay via a local coturn container" ;;
  cloudflare-443)  # THE one live Cloudflare issuance (R92): the page must have called POST /ice/fallback first
    q --row cloudflare-443 --policy relay --drop-stun --only-url ":443" --expect cloudflare-relay \
      --topology "forced relay, restricted to Cloudflare's TLS-443 entry, via the fallback broker" ;;
  netem)  # scripted impairment is applied by the caller: tools/net/netem.sh up lo 40 15 3
    q --row "netem-${NETEM_NAME:-loss3-jitter15}" --netem "${NETEM:?describe, e.g. 'delay 40ms +-15ms, loss 3%'}" \
      --topology "two pages on one machine over impaired loopback" ;;
  payload)  q --row payload-60hz --seconds 20 --hz 60 --topology "60 Hz changing input, payload per source" ;;
  *) echo "unknown row" >&2; exit 2 ;;
esac
