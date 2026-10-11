# P1-N WebKit TURN URL repair

2026-10-11, CyanBridge. Playwright 1.62.1 WebKit on macOS 27.0.1 (M1 Pro) and Linux Ubuntu 24.04 on triton.

## Reproduction

A WebKit phone on preview `v02-f08afc5e` registered successfully but never created a peer connection. Instrumenting the constructor captured `SyntaxError: Invalid TURN URL query string` for `turn:turn.dilger.dev:3479?transport=udp`. The page showed “Can't reach the host”; the host had no peer. No credentials were captured in the diagnostic record.

Constructor checks on Linux and macOS WebKit rejected explicit TURN transport query strings. Bare `turn:turn.dilger.dev:3479` and `turns:turn.dilger.dev:5349` were accepted on Linux.

## Change and verification

RFC 7065 defaults make `turn` without a transport query UDP, and `turns` without a query TLS over TCP. Both host and controller now omit only those redundant defaults when configuring peers, including refresh and fallback configurations. Explicit `turn?...transport=tcp` remains unchanged: removing it would change transport. API receipts, endpoint lists and credentials stay unchanged.

- `node --test web/shared/transport/tests/ice.test.mjs`: **1/1 pass**; checks both defaults, preserved non-default TCP/UDP, credentials, endpoints and immutable input.
- `node --test --test-name-pattern=WebKit web/shared/transport/tests/transport.test.mjs`: **1/1 pass**, Mac WebKit controller → Chromium host, real jj-server, with coturn's UDP URL present. Both semantic channels open and input moves that controller's marker.
- `node --test web/shared/transport/tests/`: **23/23 pass**, including coturn relay allocation, credential refresh, signalling recovery and the scripted Cloudflare fallback merge.

This local join uses a direct loopback path with an unreachable TURN endpoint present; it proves configuration and gameplay exchange, not relay allocation. Full transport/portrait CI and the new deployed preview remain required before close. WebKit is not labelled Safari.
