# P1-N08 status (2026-10-08, BrownCreek)

Tools: `tools/net/qualify.mjs`, `tools/net/qualify-matrix.sh`, `tools/net/netem.sh`, `tools/net/local-coturn.sh`.
The build under test is the live preview `v02-552e7bda` (game 552e7bd). The controller runs in Playwright Chromium on
eris. The host is a headless Google Chrome 154 on the Mac, driven over CDP: Chrome binds CDP to 127.0.0.1 only, so it
went through `ssh -N -R 9222:127.0.0.1:9222 eris`, and both were stopped after the runs. Receipts carry no IPs, SDP or
credentials (`qualify-lib.mjs receiptProblems`; a first coturn run was rejected for an address in its topology text).

| AC | State | Receipt |
|---|---|---|
| 1. controller on eris → host on the Mac over home Wi-Fi, selected pair, input age p50/95/99 with uncertainty, bytes | **met**: `qualify direct-wifi: OK path=srflx age p50/p95/p99=38/39/71 ms (±21) payload=312 B/s wire=3619 B/s` | `direct-wifi.json` |
| 2. the same pair forced through the real coturn (LAN-address override) | **met**: `qualify coturn-lan: OK path=coturn-relay age p50/p95/p99=16.5/33.5/34.5 ms (±9) payload=312 B/s wire=3615 B/s` (relay/relay over UDP, rtt 13 ms) | `coturn-lan.json` |
| 3. a local coturn container, and the Cloudflare TLS-443 row | **local row met**: `qualify local-coturn: OK path=coturn-relay age p50/p95/p99=10/26/26 ms (±0) payload=311 B/s wire=3613 B/s` (coturn/coturn:4.7.0 on eris, host network, relay pinned to loopback with `--allow-loopback-peers`; jj-server and both pages local to eris; the throwaway secret was never printed). **Cloudflare TLS-443 row: open**, it waits for the TURN broker deploy (R117 move, `../P1-N04b/status.md`). | `local-coturn.json` |
| 4. scripted loss/jitter with `tc netem` on eris | **met** (owner opened sudo on eris for the run, 2026-10-08): `qualify netem-loss3-jitter15: OK path=host age p50/p95/p99=49/81/98 ms (±32) payload=311 B/s` (delay 40 ms ±15, loss 3%); `qualify netem-loss10-jitter40: OK path=host age p50/p95/p99=117/168/217 ms (±113) payload=312 B/s` (delay 100 ms ±40, loss 10%). netem on `lo`, removed after each run by a trap (`tc qdisc show dev lo` → `noqueue`). | `netem-loss3-jitter15.json`, `netem-loss10-jitter40.json` |
| 5. 60 Hz changing input ≤ 2,000 B/s payload per source | **met**: `payload-60hz.json`; the two rows above also measured 312 B/s payload at 60 Hz | `payload-60hz.json` |

Earlier: `direct-loopback.json`, `transport-tests.txt`.

Left: the Cloudflare TLS-443 row, after the TURN broker deploys from this repo (R117).
