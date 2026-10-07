# P1-D03 evidence so far (2026-10-07, BrownCreek)

Raw logs; the closing receipt cites them once every AC holds.

- `sse-soak-300s.txt`: AC2. `node scripts/sse-soak.mjs https://jammers-preview.dilger.dev/p/v02-f4d0e2ef/ 300`
  (jammers-deploy 35d3673), run from eris through Cloudflare Tunnel (cf-ray …-BNE) and the edge: the signalling
  stream stayed open 305 s, 21 heartbeats, longest silence 15.0 s, all 10 signals sent every 30 s arrived. PASS.
- `midclt-stop-start.txt`: AC3. `midclt call -j app.stop` then `app.start` for `jammers-preview-edge` and
  `jjp-v02-f4d0e2ef` on TrueNAS, no other step: healthz through the edge answered 200 13 s after the start, and the
  public index, `/p/v02-f4d0e2ef/version`, `/healthz`, `/poc/` and `/poc/audio/engine/` all answered 200.
- Not yet: AC1 and AC4 need two live previews of the same build; the second waits for the next green `ci.yml` run
  with an image (the publisher only publishes green commits).
