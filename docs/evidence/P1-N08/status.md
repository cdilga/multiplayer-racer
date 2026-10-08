# P1-N08 status (2026-10-08, BrownCreek): blocked on two machine permissions

Tools: `tools/net/qualify.mjs`, `tools/net/qualify-matrix.sh` (rows direct, direct-wifi, coturn-lan, local-coturn,
cloudflare-443, netem, payload), `tools/net/netem.sh`, `tools/net/local-coturn.sh`. Already committed here:
`direct-loopback.json`, `payload-60hz.json` (AC5's 60 Hz payload), `transport-tests.txt`.

| Row | Blocker |
|---|---|
| `netem` (AC4) | `tc` needs root on eris; eris's passwordless sudo has lapsed (`sudo -n true` → "a password is required", 2026-10-08). Owner: restore it (or run `sudo tools/net/netem.sh up lo 40 15 3` / `down lo` around the row). |
| `local-coturn` (AC3, first half) | a coturn container on eris: `cdilga` isn't in eris's `docker` group (`id -nG`: cdilga openrazer input wheel), and turnserver isn't installed. Owner: `sudo usermod -aG docker cdilga` (or install coturn). |
| `cloudflare-443` (AC3, second half) | re-uses P1-N04b's single live Cloudflare run, which needs the TURN broker deployed (`docs/infra/turn-and-previews.md` "Deploying the broker": not deployed). |
| `direct-wifi`, `coturn-lan` (AC1, AC2) | runnable now: a host Chrome on the Mac with `--remote-debugging-port` and the controller on eris. The Mac's application firewall is on, which may also block the host's incoming UDP (see P1-F10's loopback finding); allow-listing Chrome for Testing fixes that. |
