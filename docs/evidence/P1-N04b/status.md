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

## The live run: not yet a pass

`tools/net/qualify.mjs --row cloudflare-443 --policy relay --drop-stun --only-url ":443" --expect cloudflare-relay`
on eris against `https://jammers-preview.dilger.dev/p/v02-552e7bda-2/` (twice, 08:05 and 08:20 UTC). The qualify ICE
rewrite now also covers `setConfiguration()`, so the fallback's servers stay restricted to the TLS-443 entry (9a920a5a).
Second run, with the new failure dump:

    qualify cloudflare-443: FAIL page.waitForFunction: Timeout 60000ms exceeded.
      j/VSDR: {"state":"connecting","pc":"new","ice":"new","restarts":0,
               "relayFallback":{"state":"unavailable","reason":"no-relay-candidate","requests":1,"credentialHeld":false}}

The trigger fired as designed (`no-relay-candidate`), the controller called `POST /ice/fallback` once, and the backend
answered relay-unavailable (any non-200 from the broker maps to 503). What was ruled out, without issuing a credential:

| Check | Result |
|---|---|
| broker reachable from the previews' network, framing | `/healthz` → `200`, `Content-Length`, `Connection: close` |
| backend auth | `JJ_BROKER_SECRET` == HMAC(`JJ_BROKER_KEY`, preview id) (True); a wrong secret gets `401 bad backend secret` |
| the Cloudflare key exists | guard's `jammers_keys()`: `jammers-fallback`, uid == `CF_TURN_KEY_ID` (True) |
| the key's token authenticates, egress from that network | curl to `generate-ice-servers` from `jammers-previews`: bad token → `401`; real token with an invalid TTL → `400` (no credential issued) |
| backend startup | no "JJ_BROKER_URL needs…" error, so the broker transport is configured |

Left: the broker's own Cloudflare call (`asupersync` h1 `HttpClient`, `tls-webpki-roots`) or its parse, or the
backend's blocking client, fails silently: neither role logs a broker outcome. Finding which needs a one-time log
line in `crates/jj-server` (product code, outside this session's remit) or a run with the broker's call traced. If the
Cloudflare call itself succeeded and only the parse failed, one credential was issued per run (two at most; TTL
30 min, no relayed traffic). The guard's per-tag listing will show any `jj-preview-…` tag after Cloudflare's lag.

The guard dry-run against a synthetic breach: done 2026-10-07, `guard-dry-run.txt`.
