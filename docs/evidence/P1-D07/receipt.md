# P1-D07 receipt (2026-10-07, BrownCreek)

Game build: `eceaeeb890bc`, green `ci.yml` run 1711 (http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/1711).
Image `127.0.0.1:3001/cdilga/jj-server@sha256:b2a4bd76727c141b5f62a829ff1430f1cf8ef14c69a44843e27a9f54bb14d082`.
Deploy repo: jammers-deploy `scripts/smoke.mjs` (d2cabdd: all seven steps mandatory), publisher at 364753f.

## AC1: the full smoke passes against a live preview (all seven steps)

Scheduled publish run 1714 (jammers-deploy), from `publish-runs-1658-1714-1731-1734.txt`:

    publish: jjp-v02-eceaeeb8 <- eceaeeb890bc sha256:b2a4bd76…
    smoke: PASS room 7QZH, join-webrtc (host, 2 ms), input, resume, drive, hud, round
    publish: v02-eceaeeb8 playable

Re-run by hand from eris through Cloudflare (`smoke-v02-eceaeeb8-pass.txt`):

    $ SMOKE_OTHERS=https://jammers-preview.dilger.dev/p/v02-f4d0e2ef/ node scripts/smoke.mjs \
        https://jammers-preview.dilger.dev/p/v02-eceaeeb8/ room,join-webrtc,input,resume,drive,hud,round
    smoke: PASS room NPXT, isolated from 1 other preview(s), join-webrtc (host, 0 ms), input, resume, drive, hud, round
    exit 0 after 85 s

A second preview of the same build (`v02-eceaeeb8-2`, dispatch run 1731) also passed all seven, isolated from one other.

## AC2: failure output names the failing step

- `v02-f4d0e2ef` (run 1658): `smoke: FAIL step drive: mandatory step drive is missing from smoke.json`.
- The same build's game flow by hand (`smoke-v02-f4d0e2ef-fail-drive.txt`): `smoke: FAIL step drive: after room 5W4W,
  join-webrtc (host, 1 ms), input, resume: page.waitForFunction: Timeout 60000ms exceeded.` (the image lacked the procgen
  kit stand-ins; fixed in 3892d51).
- `v02-eceaeeb8-3` (run 1734): `smoke: FAIL step round: after room K8DD, isolated from 2 other preview(s), …, hud:
  locator.click: Timeout 30000ms exceeded.`

## AC3: a build that drops a mandatory step from smoke.json is marked not playable

`f4d0e2e`'s bundle declared only room, join-webrtc, input, resume; run 1658 recorded `v02-f4d0e2ef not playable FAIL
step drive: mandatory step drive is missing from smoke.json`; the index lists it as "Not playable" with that reason and
no Host/Join links. Unit cover: jammers-deploy `tests/test_smoke_manifest.py`
(`test_dropping_a_mandatory_step_fails_naming_it`).

## AC4 [ev:ci]: the same flow against a local server in CI (`web/tests/smoke/`)

`web/tests/smoke/smoke.test.mjs` ran green in `ci.yml` run 1711, the build published above: `browser (6) slot-timing:
94.6s pass web/tests/smoke/smoke.test.mjs`.
