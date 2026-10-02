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
