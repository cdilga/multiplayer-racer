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

## Follow-up: native answer application (2026-10-12)

CI 3475 JN5 still saw two restarts/rebuilds while joining Gazza on a heavily loaded host. A distinct race remained:
`remoteDescription` can be visible while `setRemoteDescription(answer)` is still pending. The watchdog then mistook
that intermediate state for a completed answer and advanced the generation. The controlled real-WebRTC regression
holds the answer promise after native application and keeps the exposed connection state connecting for 9 seconds;
before the fix it fails because the generation changed. This deliberately injected timing is not a physical device
measurement.

Track answer application explicitly, defer recovery during it, cancel the old watchdog, and re-arm connection
recovery after application and early candidates finish. `inspect().applyingAnswer` exposes that state. The new
regression passes on the original generation and exchanges input afterwards. The full transport file passes
15 tests, including relay loss/fallback and existing failure recovery. Web typecheck passes. Final 8× CPU-throttled
JN5 passes all phases, 12 seats down to 2, in 401.928 seconds, without wider timeouts; drop-in claim-to-driving samples
are 3738/4555/7444/8385/5114 ms on this software-rendered deliberately slowed host. Final same-seat hidden/offline
resume is 286 ms within the unchanged 3-second envelope. Green CI remains required before closure.

CI 3475 JN3 completed its button click but timed out while Playwright waited for scheduled navigation. A local
software-rendered repeat passes the full two-round journey in 135.17 seconds. No button bypass or wider acceptance
timeout was added. A simultaneous native-GPU-mode run exceeded the 150 ms Identify budget on this Mac; this is
not evidence that the GPU latency gate passed. The actual GPU CI lane passed at the previous committed source.

## Follow-up: answer POST response and ICE queue (2026-10-12)

CI 3487 still failed JN5 while Jonesy joined a heavily loaded host. The host had installed and sent its answer,
but awaited the HTTP reply before releasing that endpoint's signal queue. This unnecessarily held its incoming
ICE candidates even when the answer had already reached the controller. A real-WebRTC regression delivers the
answer while holding the POST response, and removes the reverse trickle path so connectivity requires the host to
apply incoming candidates. It times out at 5 s before the change and passes in 336 ms afterwards, with input exchange
and zero restart/rebuild. This is controlled signalling fault injection, not a physical WAN measurement.

The host now sends its installed answer without blocking the signal queue on the HTTP response. The controller's
existing early-candidate queue already handles candidates arriving before an answer. Signal ordering within each
endpoint and generation fencing remain intact; no recovery or acceptance timeout increased.

- Full transport suite: 16 pass in 80.533 s, including real coturn and recovery (`transport-post-final.txt`).
- 8× CPU-throttled software-rendered JN5: 12 seats to 2, every round phase, pass in 385.057 s
  (`jn5-post-final.txt`). This local tree also contains the in-progress presentation recorder; no reel acceptance
  is claimed from this churn run.
- C03 hidden/offline 30 s: same-seat recovery within the existing 3 s envelope, plus reload/fencing and idempotent
  Claim checks pass (`resume-post-final.txt`).

The defect injections prove two independent queue/race repairs; the slowed journey proves the whole join path.
CI on the committed fix and deployed validation remain required.
