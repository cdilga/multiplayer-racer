# TURN and preview infrastructure (owner's homelab)

Status 2026-10-02. What exists for Playtest 1 networking (R85, R88), where it runs, and how to undo it.
Secrets are never in this repo; their **locations** are listed so agents know where to look.

## Summary

| Piece | Where | State |
|---|---|---|
| Self-hosted TURN (coturn 4.18.0) | TrueNAS custom app `jammers-turn`, host network, `192.168.11.12` | Running; local allocation test passed |
| `turn.dilger.dev` | Cloudflare DNS-only CNAME → `triton.dilger.dev` (A record kept on the WAN IP by triton's DDNS timer) | Live |
| FortiGate hole for TURN | VIPs `JJ-TURN-UDP-3479` + `JJ-TURN-UDP-RELAY`, policy 32 `WAN-to-JAMMERS-TURN` (src `geo-AU`), DoS policy 1 `JJ-TURN-DOS` | **Live 2026-10-02**; verified from outside: STUN, authenticated allocation, data both ways through the relay |
| Preview origin `jammers-preview.dilger.dev` | `homelab-tunnel` ingress → `http://192.168.11.12:30290` | Live |
| Preview edge | TrueNAS custom app `jammers-preview-edge` (Caddy 2.11.4) on `:30290` | Placeholder index; P1-D03 replaces it with `/p/<id>/` routing + generated index |
| Cloudflare TURN | Cloudflare Realtime (fallback provider), key `jammers-fallback` | Enabled with accepted bounded risk (R92); nothing issues credentials until P1-N04b. Guard alerts at 10 %, deletes keys at 25 % |

Infra-as-code for the two TrueNAS apps lives in the owner's private homelab folder
`~/Documents/dev/system-administration/jammers-turn/` and `.../jammers-preview-edge/` (payload
builders; the TURN one reads its secret from `~/.config/jammers/turn.env`).

## Why the design looks like this

- **Only TURN needs an inbound hole.** Cloudflare can't carry TURN for us: proxying UDP to a tunnel
  origin needs Spectrum, which is Enterprise-only for UDP and doesn't support port ranges on tunnel
  origins. Everything else (rooms, signalling SSE, bundles, the preview index) goes over the
  existing Cloudflare Tunnel with no WAN port.
- **UDP only at home.** coturn has no TCP/TLS listener and no TCP relay. Players on networks that
  block UDP fall back to Cloudflare TURN's TCP/TLS 443 in the same ICE server list (R79's provider
  stays as the fallback).
- **No pivoting into the LAN.** coturn denies relaying to every private/reserved range, except its
  own relay address so client → TURN → TURN → client still works.
- **Authenticated, short-lived credentials only.** `use-auth-secret` (TURN REST API): `jj-server`
  mints `username = "<expiry-unix>:<endpoint-id>"`, `credential = base64(HMAC-SHA1(secret, username))`
  per authorised endpoint. No static users.
- **Abuse limits are not player caps.** `user-quota=12`, `total-quota=1200`, `max-bps=131072` per
  allocation and the FortiGate DoS thresholds protect the house; a client that hits them still has
  direct paths and the Cloudflare fallback (R66).
- **Dynamic WAN IP.** The container's run script detects the public IPv4 by DNS every 5 minutes and
  restarts `turnserver` with the new `external-ip` when it changes; DNS follows via triton's DDNS.

## coturn settings (no secret)

Listening `192.168.11.12:3479/udp`, relay `49160–49359/udp` (200 ports), realm/server-name
`turn.dilger.dev`, `fingerprint`, `stale-nonce=600`, `no-tcp`, `no-tls`, `no-tcp-relay`, `no-cli`,
`no-software-attribute`, `no-multicast-peers`, denied-peer-ip for 0/8, 10/8, 100.64/10, 127/8,
169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24,
203.0.113/24, 224/3; allowed-peer-ip `192.168.11.12`. Logs to stdout.

Secret: `TURN_STATIC_AUTH_SECRET` in `~/.config/jammers/turn.env` on the owner's Mac (mode 600) and
in the `jammers-turn` app's compose config on TrueNAS. The jj-server deploy gets it as a deploy
secret (P1-N04/P1-D04), never from this repo.

## FortiGate change (applied 2026-10-02 as `claude-admin`, full-config backup `~/.local/state/fortigate-backups/Falcon_Root-20261002T061500Z-pre-jammers-turn-full-configuration.txt`)

Mirrors the existing Minecraft pattern (`DILGERCRAFT-TCP-25565`, policy `WAN-to-DILGERCRAFT`):

- Service `JJ-TURN-UDP`: UDP 3479 and 49160–49359. (UDP 3478 was already forwarded to another host by the existing `codbox3` VIP, so TURN uses 3479; browsers accept any port.)
- VIPs on the WAN interface → `192.168.11.12`: `JJ-TURN-UDP-3479` (3479→3479) and
  `JJ-TURN-UDP-RELAY` (49160–49359 → same).
- Address `geo-AU` (type geography, AU) as the source: the parties are in Australia; remote
  players abroad fall back to Cloudflare TURN. Easy to widen later.
- Policy `WAN-to-JAMMERS-TURN`: WAN → `Internal_Zone`, src `geo-AU`, dst both VIPs, service
  `JJ-TURN-UDP`, accept, log, comment pointing here.
- DoS policy `JJ-TURN-DOS` on the WAN interface for `JJ-TURN-UDP`: `udp_flood`,
  `udp_src_session` and `udp_dst_session` with block thresholds sized well above a party's traffic.
- No `cfg-save revert` (on some builds the revert path is a reboot); a full config backup is taken
  first under `~/.local/state/fortigate-backups/`.

**Undo:** `config firewall policy` → `edit 32` → `set status disable` closes the hole immediately. Full
removal: `delete 32` (policy), `config firewall DoS-policy` → `delete 1`, then delete the VIPs
`JJ-TURN-UDP-3479`/`JJ-TURN-UDP-RELAY`, service `JJ-TURN-UDP` and address `geo-AU`.

Management access: `ssh claude-admin@192.168.50.1` (super_admin, key auth, trusted host VLAN 50 only).
The old `codex-audit` admin (still trusting the key retired as compromised on 2026-08-18) was deleted.

## Cloudflare TURN fallback: never get billed (spend guard)

**Status 2026-10-02 (R92): the owner accepted a bounded risk (option 3 below).** Key `jammers-fallback`
exists (secret in `~/.config/jammers/cf-turn-key.env`, for the `jj-server` deploy only); nothing issues
credentials until P1-N04b's lazy, rate-limited issuance lands. Testing showed we can't take a
Cloudflare TURN credential back once it's issued, hence the early thresholds.

Facts (Cloudflare docs, checked 2026-10-02): Realtime TURN bills **$0.05/GB of egress** (bytes sent
from Cloudflare to TURN clients, including TURN overhead) after a **1,000 GB/month free allowance
shared with the SFU**; STUN is free. Budget alerts are **email-only, a day late and never cap
usage**. Usage is queryable per credential tag through GraphQL
`callsTurnUsageAdaptiveGroups.sum.egressBytes` (adaptive sampling).

**What we measured** (2026-10-02, `tools/net/turn_probe.py` against `turn.cloudflare.com:3478`):

| Lever | Result |
|---|---|
| Delete the TURN key | Existing credentials kept allocating for 18+ minutes afterwards; revoking is then impossible (404) |
| Revoke a credential (key alive, API returned 204) | Kept allocating for 14+ minutes afterwards |
| Credential TTL (`credentials/generate`, `ttl` 600 and 120) | Still allocating 8+ and 4+ minutes **after** expiry |
| Credential TTL (`generate-ice-servers`, `ttl` 120) | Still allocating 4 minutes after expiry |
| Lifetime probe (`generate-ice-servers`, `ttl` 120, minted 06:56Z) | Still allocating at 08:47Z, ~1 h 50 min later (probe stopped at its 2 h limit). Assume a leaked credential stays usable for **hours**, not minutes |

So the guard can stop **new** credentials (by deleting keys) but cannot stop a credential already
handed out, for an unknown period. Players join with public room codes, so any credential we give
them must be assumed leakable. A hard "never charged" guarantee therefore can't rest on revocation.

**What exists now** (safe to keep; it protects any future key from minute one):

- `jammers-turn-guard` TrueNAS app (code `tools/turn-guard/guard.py`): every 5 min reads 31-day
  TURN egress and the top credential tags; pushes an alert at 10 % (100 GB) of the free allowance; at 25 % (250 GB),
  or any tag above 2 GB/hour, deletes every `jammers-` key and pushes an alert; never re-enables;
  alerts when blind for 15 min. Scoped token (Calls Write + Account Analytics Read) in
  `~/.config/jammers/cf-turn-guard.env`.
- Alerts: a local-only Home Assistant webhook automation (`automation.jammers_turn_guard_alert`,
  approved by the owner for this one use only; nothing else in the game may depend on HA) plus
  Cloudflare's own in-band email budget alerts at **$1** and $10.

**Options considered** (option 3 chosen 2026-10-02):

1. **No Cloudflare TURN.** Self-hosted coturn covers UDP; add TURN over TLS on coturn (a second,
   cert-backed WAN port such as TCP 5349) for UDP-blocked networks. Zero billing risk; some very
   locked-down networks may still fail.
2. **A separate Cloudflare account with no payment method** used only for TURN, so overage can't be
   billed at all (check first whether Realtime works on such an account and what happens at the free
   limit).
3. **Accept a bounded, monitored risk**: Cloudflare credentials only on an authenticated relay-fallback
   request, per-room/IP issuance limits, the guard and alerts above. Not a guarantee.

## Cloudflare TURN issuance: the credential broker (P1-N04b)

Built 2026-10-07 (code: `crates/jj-server/src/ice/broker.rs`; tests: `ice/broker/tests.rs`). **Nothing has issued a
Cloudflare credential yet**: the broker isn't deployed and the one live run (below) hasn't happened.

- **One broker, same image.** `JJ_ROLE=turn-broker` runs `jj-server` as the broker. It alone holds
  `CF_TURN_KEY_ID` and `CF_TURN_KEY_API_TOKEN` (from `~/.config/jammers/cf-turn-key.env`) plus `JJ_BROKER_KEY`
  (its HMAC key). A normal backend **refuses to start** if any of those three is in its environment, so a preview
  container can't hold the token.
- **Backends call it** on the internal network (plain `http://`; `JJ_BROKER_URL`) with
  `x-jj-backend: <previewId>` and `x-jj-backend-auth: hex(HMAC-SHA256(brokerKey, previewId))`
  (`JJ_BROKER_SECRET`, injected by the publish workflow; `previewId` is `JJ_PREVIEW_ID` or derived from
  `JJ_BASE_PATH`: `/p/<id>/` gives `<id>`, `/` gives `production`). Another backend's secret gets `401`.
  The client IP is the tunnel's `CF-Connecting-IP`, forwarded in the request body.
- **Limits are rates** (never caps): per endpoint burst 2 then 1 per 5 min; per room burst 32 then 1 per 2 s; per IP
  burst 32 then 1 per 5 s. A limited call is `429 {retryAfterMs}`. A credential belongs to an endpoint and is reused
  (no new issuance, no token spent) while 5+ minutes of its 30 min TTL remain; a retried `requestId` returns the same
  credential for 10 min.
- **Cloudflare call:** `POST https://rtc.live.cloudflare.com/v1/turn/keys/<keyId>/credentials/generate-ice-servers`
  with `{"ttl":1800,"customIdentifier":"jj-<realm>-<roomId>-<endpointId>"}`. Port-53 URLs are dropped; the
  `turns:...:443` entry is kept. Key unset or Cloudflare failing gives `503 relay-unavailable`; direct and coturn
  paths are untouched.
- **Known limit:** the backend's call to the broker is a blocking socket call (4 s timeout, one retry) inside the
  request handler, acceptable for a rare event of a few hundred ms; revisit if the fallback gets common.

### Deploying the broker (written down 2026-10-07; not deployed)

What exists to deploy: the `jj-server` image already contains the broker role. Everything below is still to do.

1. **A TrueNAS custom app `jammers-turn-broker`** (created by the owner or the deploy repo through `midclt app.create`,
   like `jammers-net`). Compose service `broker`: the same `jj-server` image digest as the previews/production, `container_name:
   jammers-turn-broker`, `restart: unless-stopped`, `read_only: true`, `cap_drop: [ALL]`,
   `security_opt: [no-new-privileges:true]`, `mem_limit: 128m`, `pids_limit: 128`, joined **only** to the external network
   `jammers-previews` (so previews reach it as `http://jammers-turn-broker:8080`). **No tunnel ingress, no edge route, no
   published port**: nothing public can reach `/broker/issue`. It needs outbound HTTPS to `rtc.live.cloudflare.com`.
2. **Its environment:** `JJ_ROLE=turn-broker`, `JJ_BIND=0.0.0.0:8080`, `JJ_BROKER_KEY` (new; 32+ random bytes, base64),
   `CF_TURN_KEY_ID` and `CF_TURN_KEY_API_TOKEN` (from `~/.config/jammers/cf-turn-key.env`: `CF_TURN_KEY_ID`,
   `CF_TURN_KEY_API_TOKEN`). `JJ_DIST` isn't read in this role. Health: `GET /healthz` (the image's `--healthcheck` checks
   the same path on `JJ_BIND`'s port). The Cloudflare token lives in this one app's compose config and nowhere else: not in
   the deploy repo's Actions secrets, not in any preview.
3. **Deploy repo changes** (`jammers-deploy`, not made): add the Actions secret `JJ_BROKER_KEY` (same value as the broker's),
   and in `scripts/publish.py` `compose()` add to each backend's environment
   `JJ_BROKER_URL=http://jammers-turn-broker:8080` and
   `JJ_BROKER_SECRET=hex(HMAC-SHA256(JJ_BROKER_KEY, previewId))` (the same derivation as `room_key`; `previewId` is the
   `<id>` in `/p/<id>/`, `production` for the production backend). Backends must **not** receive `JJ_BROKER_KEY`,
   `CF_TURN_KEY_ID` or `CF_TURN_KEY_API_TOKEN`: they refuse to start if they do. Add `JJ_BROKER_KEY` to `publish.py`'s secret
   list and its `--plan` redaction. Production (P1-D08) gets the same two variables.
4. **Order:** deploy the broker first with the Cloudflare variables **unset** (it then answers `relay-unavailable` and
   never calls Cloudflare), check `/healthz` from a preview container, publish one preview with the two backend variables,
   and confirm `POST /ice/fallback` returns 503 `relay-unavailable`. Only then set the Cloudflare variables for the one live run.
5. **Rotation and kill switch:** rotating `JJ_BROKER_KEY` invalidates every backend's secret until they are republished
   (fallback shows "relay unavailable", direct and coturn keep working). The spend guard deleting the `jammers-` key makes
   the broker's Cloudflare call fail the same way. Removing the app is a full off switch for new issuance.

Live run for the receipt (one controlled Cloudflare issuance): deploy the broker, point one preview at it, then
`tools/net/qualify-matrix.sh cloudflare-443` from a machine outside the LAN. The issued tag
`jj-<realm>-<roomId>-<endpointId>` must then appear in the guard's per-tag listing
(`python3 tools/turn-guard/guard.py --once`, `top_1h`; it shows after Cloudflare's analytics lag).

## Verifying

```bash
dig +short turn.dilger.dev                       # → current WAN IP via triton.dilger.dev
curl -s https://jammers-preview.dilger.dev/ | head -5
ssh truenas 'sudo -n docker logs --tail 20 $(sudo -n docker ps -q --filter name=jammers-turn)'
```

From outside the LAN, from an Australian source (the policy is AU-only): `python3 tools/net/turn_probe.py
--host turn.dilger.dev --port 3479 --secret-env TURN_STATIC_AUTH_SECRET --relay-test` must report STUN OK,
allocate OK and both relay directions OK (`--relay-test` needs a host whose public IP is its own; on a
phone use a WebRTC trickle-ICE page and look for a `relay` candidate). A non-AU source is dropped by design.

## Undo everything

- `ssh truenas 'sudo -n midclt call -j app.delete jammers-turn'` and `... app.delete jammers-preview-edge'`.
- Restore the tunnel config from `/mnt/vessel/files/backups/homelab-tunnel-pre-jammers-preview-20261002T053119Z.json`
  (re-apply its `custom_compose_config` with `app.update homelab-tunnel`), or remove the
  `jammers-preview.dilger.dev` ingress lines.
- Delete the DNS records `turn.dilger.dev` and `jammers-preview.dilger.dev` in Cloudflare.
- FortiGate: see above.
