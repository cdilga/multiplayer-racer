# Linux WebKit STUN qualification — br-tssc

2026-10-12. Reproduced in the actual `jj-ci:d161a07c0df4` Ubuntu24.04 Docker job container on triton, at c58c8dd2. The owner real-room WebKit phone never reached ready-to-join. Full-depth host diagnostics show SDP negotiation at done, peer connecting, no bytes and no open data channel. The controller repeatedly rebuilt its ICE generation.

An independent WebKit peer-to-peer probe, with no game code or signalling server, exchanged its real offers/answers/candidates. With `iceServers:[]`, both peers completed gathering but stayed new, emitted only .local host candidates and received no remote candidates. With real local coturn STUN, the same untouched peers emitted127.0.0.1 srflx candidates, reached connected and exchanged hello. The container cannot resolve the mDNS-only candidates. Production already supplies STUN; the journeys had explicitly disabled it.

The local owner/identity journeys now reuse the transport bank's real coturn/readiness shape. The service is STUN-only, bound to loopback, uses an ephemeral port, validates a real binding response with the cookie and transaction id before jj-server starts, and is stopped on success/failure. Deployed journeys keep using the deployed room's real connectivity configuration. No candidates or game state are fabricated to make the connection succeed; behavioral assertions and their waits remain unchanged.

Local Mac validation after the fixture change:

- `node --test web/tests/journeys/owner-lobby-settings.test.mjs`: Chromium/WebKit2/2 green,40.6 s. Screenshot staging uses synchronous DOM scrolling to avoid a detached card during a late room update; behavioral clicks/assertions are unchanged.
- `node --test web/tests/journeys/r13-identity.test.mjs` in the same validation batch:3/3 green, including the rendered24-tile cohort. Chromium hardware renderer is Metal after the corrected launch helper.
- Main CI containing this fixture is pending. The earlier eris WebKit host-boot failure was a different environment failure and is not treated as reproduction of this defect.

This receipt proves loopback browser connectivity, not physical Safari/phone networking. Deployed review and containing Linux CI remain required; no bead close is claimed.
