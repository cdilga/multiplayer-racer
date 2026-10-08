# P1-N04b status (2026-10-08 08:30 UTC, BrownCreek): broker deployed; the live fallback answers relay-unavailable

## Deployed (R117, from this repo's Gitea Actions; nothing by hand)

- `.gitea/workflows/deploy-turn-broker.yml` (code `infra/turn-broker/deploy.py`) created the TrueNAS app
  `jammers-turn-broker` from the `jj-server` image `sha256:2d1ad2a4…` (preview v02-552e7bda's): run 2111 with
  `cloudflare: off` (log: `jj-server turn-broker: cloudflare NOT configured (answers relay-unavailable)`), then run 2125
  with `cloudflare: on` (log: `cloudflare configured`). The container has no published port and sits only on
  `jammers-previews` (`docker inspect`: `{"8080/tcp":null} jammers-previews`); `/healthz` answers `ok 200` from a
  throwaway container on that network.
- Secrets (names only): `JJ_BROKER_KEY` (32 random bytes, generated straight into Gitea), `CF_TURN_KEY_ID`,
  `CF_TURN_KEY_API_TOKEN` (the TURN key `jammers-fallback`'s own token, piped from `~/.config/jammers/cf-turn-key.env`
  into the Gitea secrets API, never printed). `docs/infra/turn-and-previews.md` lists them.
- The publisher injects `JJ_BROKER_URL` and the per-preview `JJ_BROKER_SECRET`: preview `v02-552e7bda-2` (deploy-previews
  run 2122, smoke PASS) has `JJ_BROKER_URL=http://jammers-turn-broker:8080`, a broker secret that equals
  HMAC(broker key, `v02-552e7bda-2`) (checked on TrueNAS, boolean only), and no `CF_*`/`JJ_BROKER_KEY` variable.

## The live run: passed (2026-10-08 12:40 UTC)

`live-cloudflare-443.json` (same file as `../P1-N08/cloudflare-443.json`, N08 re-uses it, R92):

    qualify cloudflare-443: OK path=cloudflare-relay age p50/p95/p99=19/36/37 ms (±3.5) payload=312 B/s wire=3642 B/s

Controller and host in headless Chromium on eris against the live preview `v02-552e7bda-2`, `iceTransportPolicy: "relay"`,
STUN dropped and every ICE URL filtered to `:443` (coturn's 3479 entries gone, so coturn is unreachable); the fallback
fired (`no-relay-candidate`), the broker issued, and the selected pair is relay/relay with `relayProtocol: tls` via
Cloudflare, rtt 7 ms. The receipt carries no address or credential (`problems: []`).

### Why the earlier runs got relay-unavailable, and the fix

1. A diagnostic first (c5fba547): the broker and the backend now print one stderr line per distinct fallback failure
   cause (Cloudflare call failed / answered `<status> <error codes>` / reply unreadable; broker unreachable / answered /
   reply unreadable), never a body that could hold a credential (`cf_error_summary`, unit-tested).
2. A throwaway backend with that image (`jjp-v02-diag`, the preview's env, removed afterwards) printed:
   `jj-server: relay fallback unavailable: broker unreachable: jammers-turn-broker:8080: Connection refused (os error 111)`.
3. Cause: the `jammers-previews` network has IPv6 on; glibc in the Debian-based backend resolves `jammers-turn-broker`
   to its IPv6 address first, the broker listened on `0.0.0.0:8080`, and the backend's client connected to the first
   address only. (A musl-based Python container resolved IPv4 first, which is why replaying the request by hand
   worked and the broker itself was fine.)
4. Fixes: the backend client tries every resolved address (fe11c722), and the broker binds `[::]:8080`
   (`infra/turn-broker/deploy.py`, d399f7cc; deploy-turn-broker run 2215: `listening on [::]:8080`). The live run above
   used the old backend image with the dual-stack broker.

Credentials issued in total: the passing run (host and controller endpoints), plus two by-hand broker replays during
the diagnosis (`jj-preview-rm-diag-c-diag`, `…-c-diag2`, never used for traffic). All have a 30-minute TTL.

Guard per-tag listing (`guard.top_identifiers`, the guard's own `top_1h` query, run from the Mac with the guard's
scoped token at 12:45:59 UTC): `[('jj-preview-rm-c56f6348eebcc283-host', 0.003 MB), ('jj-preview-rm-c56f6348eebcc283-c-c70d89103106', 0.0 MB)]`:
the run's two issued tags (`jj-<realm>-<roomId>-<endpointId>`, host and controller endpoints).

The guard dry-run against a synthetic breach: done 2026-10-07, `guard-dry-run.txt`.
