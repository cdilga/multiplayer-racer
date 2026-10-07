# P1-D03 receipt (2026-10-07, BrownCreek)

Edge: jammers-deploy `edge/Caddyfile` at 0fd3976 (applied with `python3 edge/apply.py`), Cloudflare Tunnel route
jammers-preview.dilger.dev -> TrueNAS :30290. Previews: `v02-eceaeeb8` (scheduled publish run 1714) and `v02-eceaeeb8-2`
(the same build again, dispatch run 1731 with `--republish`), image
`sha256:b2a4bd76727c141b5f62a829ff1430f1cf8ef14c69a44843e27a9f54bb14d082` (game `eceaeeb`, green ci.yml run 1711).

## AC1: two previews of the same build side by side, each with its own id and its own secrets

`two-previews-same-build.txt` (16:45 UTC):

    v02-eceaeeb8     /version: {"build":"v02-eceaeeb8","protocol":1,"realm":"preview"}
    v02-eceaeeb8-2   /version: {"build":"v02-eceaeeb8-2","protocol":1,"realm":"preview"}
    jjp-v02-eceaeeb8    image sha256:8ff62df6db6a  JJ_ROOM_KEY sha256:1ae9afaf4a5c  JJ_BASE_PATH /p/v02-eceaeeb8/
    jjp-v02-eceaeeb8-2  image sha256:8ff62df6db6a  JJ_ROOM_KEY sha256:82a8aae9b001  JJ_BASE_PATH /p/v02-eceaeeb8-2/

(secret values shown only as the first 12 hex of their sha256). Same image, own id, own room/broker key
(HMAC(master, id)). `TURN_STATIC_AUTH_SECRET` is the one coturn server's shared secret, the same for every preview by
design (TURN credentials are minted per session from it).

## AC2: an SSE stream through tunnel + edge keeps streaming for 5 minutes

`sse-soak-300s.txt`: `node scripts/sse-soak.mjs https://jammers-preview.dilger.dev/p/v02-f4d0e2ef/ 300` (jammers-deploy
35d3673), from eris through Cloudflare (cf-ray …-BNE): `sse-soak: PASS held 305 s, stream still open, 21 heartbeats,
longest silence 15.0 s, signals 10/10`. This closes the T6 hypothesis: SSE survives Cloudflare.

## AC3: after the edge and preview apps are stopped and started through midclt, routing and the index return; /poc/ served

`midclt-stop-start.txt` (14:09-14:10 UTC): `midclt call -j app.stop` / `app.start` for `jammers-preview-edge` and
`jjp-v02-f4d0e2ef`, nothing else: healthz through the edge 200 13 s after the start; the public index,
`/p/v02-f4d0e2ef/version`, `/healthz`, `/poc/` and `/poc/audio/engine/` all 200.

## AC4: with two previews up, cold-cache loads stay inside /p/<id>/; root-relative and cross-preview requests fail

`isolation-two-previews-same-build.txt` (`node isolation.mjs …/p/v02-eceaeeb8/ …/p/v02-eceaeeb8-2/`, a fresh browser
context per page, from eris through Cloudflare):

    ok   /p/v02-eceaeeb8/host?room: 64 requests, all under /p/v02-eceaeeb8/
    ok   /p/v02-eceaeeb8/c: 17 requests, all under /p/v02-eceaeeb8/
    ok   /p/v02-eceaeeb8-2/host?room: 62 requests, all under /p/v02-eceaeeb8-2/
    ok   /p/v02-eceaeeb8-2/c: 17 requests, all under /p/v02-eceaeeb8-2/
    ok   root-relative /assets/, /host, /api/v1/rooms/ABCD, /version answer 404
    ok   room 5EE5 resolves under its own /p/v02-eceaeeb8/ and is not-found under /p/v02-eceaeeb8-2/
    ok   room Q3RN resolves under its own /p/v02-eceaeeb8-2/ and is not-found under /p/v02-eceaeeb8/
    isolation: PASS

The first run of this probe failed: Cloudflare's automatic Web Analytics injected
`static.cloudflareinsights.com/beacon.min.js` and a `/cdn-cgi/rum` post into every page (a runtime CDN, R70). The edge now
sends `Cache-Control: …, no-transform` on every response (jammers-deploy 0fd3976), which stops the injection
(`isolation-eceaeeb8-vs-f4d0e2ef.txt`, after the fix: PASS).
