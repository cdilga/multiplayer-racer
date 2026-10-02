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
| Cloudflare TURN | Cloudflare Realtime (fallback provider) | Needs a TURN key (owner action O1); fallback only |

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

Facts (Cloudflare docs, checked 2026-10-02): Realtime TURN bills **$0.05/GB of egress** (bytes sent
from Cloudflare to TURN clients, including TURN overhead), after a **1,000 GB/month free allowance
shared with the SFU**; STUN is free. Cloudflare's own budget alerts are **email-only, fire a day
late and never cap usage**. Per-credential revocation exists; usage is queryable per credential tag
through GraphQL `callsTurnUsageAdaptiveGroups.sum.egressBytes` (adaptive sampling). So the only way
to *guarantee* no charge is our own guard, and Cloudflare credentials aren't issued until it runs.

Defence in depth, cheapest first:

1. **Fewer credentials.** The ICE list starts with coturn only. `jj-server` issues Cloudflare
   credentials only on an explicit relay-fallback request from an authenticated endpoint of an
   active room whose coturn/direct attempt failed (for example UDP-blocked networks). Credentials
   carry a `customIdentifier` (room + endpoint), a short TTL (30 min, refreshed by live clients) and
   per-room/per-IP issuance rate limits. These are abuse limits, not player caps: without a
   Cloudflare credential a client still has direct paths and coturn.
2. **Watch usage.** A guard polls the GraphQL dataset every 5 minutes for (a) total egress this
   billing cycle and (b) the top `customIdentifier`s in the last hour.
3. **Cut off early.** Thresholds (defaults, owner-tunable): at **25 %** of the free allowance
   (250 GB) notify the owner; at **50 %** (500 GB) pull the kill switch. Any single identifier above
   **2 GB/hour** (a controller uses ~7 MB/hour) gets that credential revoked at once. 500 GB of
   headroom means an attacker would need sustained hundreds of MB/s for longer than the guard's
   detection lag before a cent is billable.
4. **Kill switch.** Delete the TURN key (invalidates its credentials; verified by test, see below)
   and revoke every credential `jj-server` issued from it; `jj-server` then fails Cloudflare
   issuance and answers coturn-only. **Re-enabling is a manual owner action** (create a new key), so
   it can't oscillate.
5. **Independent alarm.** Owner sets a Cloudflare budget alert at $1 (O1b) as a second, slower
   signal that fires even if the guard is broken.

Guard acceptance (Playtest-1 plan P1-N04b): a deleted key stops an existing credential from
allocating within a measured time (if it doesn't, revoke-each-credential becomes the primary kill
path); a synthetic threshold breach triggers notification and kill; the guard alerting on its own
failure (stale analytics, API errors) is part of done. Cloudflare TURN stays disabled until the
guard passes these tests.

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
