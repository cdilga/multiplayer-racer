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
| 3. a local coturn container, and the Cloudflare TLS-443 row | **blocked**: a coturn container on eris needs `cdilga` in eris's `docker` group (`id -nG`: cdilga openrazer input wheel; turnserver isn't installed). The Cloudflare row re-uses P1-N04b's single live run, which waits for the broker deployment (`../P1-N04b/status.md`). | |
| 4. scripted loss/jitter with `tc netem` on eris | **blocked**: `tc` needs root; eris's passwordless sudo has lapsed (`sudo -n true` → "a password is required"). | |
| 5. 60 Hz changing input ≤ 2,000 B/s payload per source | **met**: `payload-60hz.json`; the two rows above also measured 312 B/s payload at 60 Hz | `payload-60hz.json` |

Earlier: `direct-loopback.json`, `transport-tests.txt`.

Owner steps to finish: `sudo usermod -aG docker cdilga` on eris (then `tools/net/local-coturn.sh up` and the
`local-coturn` row); restore eris's passwordless sudo, or run `sudo tools/net/netem.sh up lo 40 15 3` before and `down lo`
after the `netem` row; deploy the TURN broker for N04b.
