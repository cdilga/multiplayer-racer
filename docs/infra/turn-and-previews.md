# TURN and preview infrastructure (owner's homelab)

Status 2026-10-02. What exists for Playtest 1 networking (R85, R88), where it runs, and how to undo it.
Secrets are never in this repo; their **locations** are listed so agents know where to look.

## Summary

| Piece | Where | State |
|---|---|---|
| Self-hosted TURN (coturn 4.18.0) | TrueNAS custom app `jammers-turn`, host network, `192.168.11.12` | Running; local allocation test passed |
| `turn.dilger.dev` | Cloudflare DNS-only CNAME → `triton.dilger.dev` (A record kept on the WAN IP by triton's DDNS timer) | Live |
| FortiGate hole for TURN | VIP + policy + DoS policy, UDP only (below) | **Pending** (needs the management VLAN) |
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

Listening `192.168.11.12:3478/udp`, relay `49160–49359/udp` (200 ports), realm/server-name
`turn.dilger.dev`, `fingerprint`, `stale-nonce=600`, `no-tcp`, `no-tls`, `no-tcp-relay`, `no-cli`,
`no-software-attribute`, `no-multicast-peers`, denied-peer-ip for 0/8, 10/8, 100.64/10, 127/8,
169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24,
203.0.113/24, 224/3; allowed-peer-ip `192.168.11.12`. Logs to stdout.

Secret: `TURN_STATIC_AUTH_SECRET` in `~/.config/jammers/turn.env` on the owner's Mac (mode 600) and
in the `jammers-turn` app's compose config on TrueNAS. The jj-server deploy gets it as a deploy
secret (P1-N04/P1-D04), never from this repo.

## FortiGate change (to apply from the management VLAN)

Mirrors the existing Minecraft pattern (`DILGERCRAFT-TCP-25565`, policy `WAN-to-DILGERCRAFT`):

- Service `JJ-TURN-UDP`: UDP 3478 and 49160–49359.
- VIPs on the WAN interface → `192.168.11.12`: `JJ-TURN-UDP-3478` (3478→3478) and
  `JJ-TURN-UDP-RELAY` (49160–49359 → same).
- Address `geo-AU` (type geography, AU) as the source: the parties are in Australia; remote
  players abroad fall back to Cloudflare TURN. Easy to widen later.
- Policy `WAN-to-JAMMERS-TURN`: WAN → `Internal_Zone`, src `geo-AU`, dst both VIPs, service
  `JJ-TURN-UDP`, accept, log, comment pointing here.
- DoS policy `JJ-TURN-DOS` on the WAN interface for `JJ-TURN-UDP`: `udp_flood`,
  `udp_src_session` and `udp_dst_session` with block thresholds sized well above a party's traffic.
- No `cfg-save revert` (on some builds the revert path is a reboot); a full config backup is taken
  first under `~/.local/state/fortigate-backups/`.

**Undo:** disable or delete policy `WAN-to-JAMMERS-TURN` (closes the hole immediately); then delete
the DoS policy, VIPs, service and `geo-AU` if no longer wanted.

## Verifying

```bash
dig +short turn.dilger.dev                       # → current WAN IP via triton.dilger.dev
curl -s https://jammers-preview.dilger.dev/ | head -5
ssh truenas 'sudo -n docker logs --tail 20 $(sudo -n docker ps -q --filter name=jammers-turn)'
```

From outside the LAN (after the VIP lands): a TURN allocation with REST credentials against
`turn.dilger.dev:3478` must succeed, and a relay candidate must appear in a WebRTC trickle-ICE test.

## Undo everything

- `ssh truenas 'sudo -n midclt call -j app.delete jammers-turn'` and `... app.delete jammers-preview-edge'`.
- Restore the tunnel config from `/mnt/vessel/files/backups/homelab-tunnel-pre-jammers-preview-20261002T053119Z.json`
  (re-apply its `custom_compose_config` with `app.update homelab-tunnel`), or remove the
  `jammers-preview.dilger.dev` ingress lines.
- Delete the DNS records `turn.dilger.dev` and `jammers-preview.dilger.dev` in Cloudflare.
- FortiGate: see above.
