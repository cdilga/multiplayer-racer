# P1-N-join-recovery — br-j5fc

Local Mac arm64, Playwright Chromium/WebKit, real Rust server `/tmp/jj-macos-server-w01`, WebRTC and local coturn. Test cohorts are samples, never limits. CI/deployed validation remains pending.

Two faults were reproduced. The host serialized every endpoint through one promise queue, including the awaited answer POST. Holding the first answer blocked a second phone for the full 5-second regression timeout (`held-answer-before.txt`). The controller then advanced/rebuilt an unanswered negotiation every watchdog cycle: under an 8× host CPU throttle, the host lagged by eight generations and the phone rejected its eventual answers, indefinitely (`jn5-before.txt`). The CPU profile showed 147.76 seconds in native/program work and under one second in any individual JS function; it does not establish a particular renderer hotspot.

Host signalling is now ordered separately per endpoint, with completed queue entries released. An unanswered initial offer is retransmitted on its existing generation and peer; the host resends its answer without replacing that peer. Established-but-failed connections retain ICE restart/rebuild recovery. Resume cancels the deferred recovery timer and checks immediately. Negotiation stage/age/error-name diagnostics expose one current negotiation per peer, without SDP, credentials or per-tick logs.

Validation:

- `node --test web/shared/transport/tests/transport.test.mjs`: 15 pass, 72.415 seconds, including a held answer with a second endpoint, an answer delayed past the 8-second watchdog on the original generation, a lost initial offer, stale-generation fencing, real coturn relay and injected lost Allocate, credential refresh and fallback.
- `JJ_HOST_CPU_THROTTLE=8 JJ_BUILD_SUFFIX=-slow-retransmit node --test web/tests/journeys/jn5-churn.test.mjs`: pass, 547.581 seconds; actual host/controller join path, 12 players down to 2, every round phase. Existing timeouts/envelopes were retained.
- C03 hidden/offline 30 seconds then shown: same seat in 570 ms, within the existing 3-second envelope (`resume-after.txt`).
- Web typecheck and diff whitespace check pass.

No physical phone/Safari or deployed-preview claim. The slow-host churn proves eventual joins under deliberate throttling; it does not claim a three-second join on an 8× throttled software renderer.
