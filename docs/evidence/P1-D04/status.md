# P1-D04 status (2026-10-07, BrownCreek): not closed

| AC | State | Evidence |
|---|---|---|
| First published preview is the G00 walking skeleton and passes room, join-webrtc, input, resume | met | `v02-f4d0e2ef` (run 1658, the first publish) passed room, join-webrtc, input and resume (`../P1-D07/smoke-v02-f4d0e2ef-fail-drive.txt`: "after room 5W4W, join-webrtc (host, 1 ms), input, resume"), then failed D07's later mandatory steps |
| Three consecutive publishes picked up by the scheduled poll, zero manual steps; each passes or is marked not playable with a reason | **2 of 3** | scheduled runs 1658 (`v02-f4d0e2ef` not playable, reason) and 1714 (`v02-eceaeeb8` playable); `-2` and `-3` came from manual `--republish` dispatches, so they don't count. The third waits for the next green ci.yml run that builds an image |
| An unknown smoke step name fails the publish | met | `test_unknown_smoke_step_fails_the_publish` (`../P1-D06/deploy-unit-tests.txt`) |
| With two live previews, a room code from one doesn't resolve on the other | met | `../P1-D03/isolation-two-previews-same-build.txt`; the smoke's own check: "isolated from 1 other preview(s)" (runs 1731, eris re-run) |
| The game repo holds no credential that can start a deploy or reach TrueNAS | **open (owner ruling)** | game repo secrets: `POC_DEPLOY_KEY`, `REGISTRY_PUSH_TOKEN`. `POC_DEPLOY_KEY` reaches TrueNAS for the /poc/ mirror, which D03's notes keep |
| Preview env has no Cloudflare token; broker secret differs from every other preview's | met | `../P1-D03/two-previews-same-build.txt`: no cloudflare/cf_/tunnel variable; JJ_ROOM_KEY sha256 1ae9afaf4a5c vs 82a8aae9b001 |

Publisher fixes on the way (jammers-deploy): registry auth via the Docker token flow with 401 failing loudly (86e477c,
f1cceb9); the newest green build with an image publishes (86e477c); a fresh TrueNAS session after the smoke and an edge
catch-up (29ef4e6); the register commit rebases before pushing (364753f); the poll skips its 7-minute tool install with
nothing to do (0fd3976). In the game repo: the image now bundles the procgen kit stand-ins (3892d51).

## 2026-10-08 (BrownCreek): R117, the move into this repo

- The deploy code lives in `infra/` (previews, TURN broker, POC) and runs from `.gitea/workflows/deploy-*.yml` on the
  `jammers-deploy` runner. `cdilga/jammers-deploy` is archived (its workflows were removed first, 89a77fb).
- Previews are recorded as git tags and commit statuses (`infra/previews/README.md`): the old register (6 rows, at
  3ddc6c9e) was migrated into `preview/`/`retired/` tags with `preview/smoke/<id>` statuses.
- **First publish from here:** deploy-previews run 2122 (dispatch, `--republish`): `v02-552e7bda-2` playable
  (`smoke: PASS room E6K2, isolated from 2 other preview(s), join-webrtc (host, 0 ms), input, resume, drive, hud,
  round`), tag `preview/v02-552e7bda-2` and status written with the workflow's token (no CI run started), and the same run
  retired `v02-eceaeeb8-3` (tag `retired/v02-eceaeeb8-3`). Scheduled polls run every 5 minutes (e.g. 2179–2183).
- **AC5 as replaced by R117:** the repo's Actions secrets are `CF_TURN_KEY_API_TOKEN`, `CF_TURN_KEY_ID`, `JJ_BROKER_KEY`,
  `JJ_ROOM_KEY_MASTER`, `REGISTRY_PUSH_TOKEN`, `SOURCE_READ_TOKEN`, `TRUENAS_APPS_WRITE_KEY`, `TURN_STATIC_AUTH_SECRET`;
  `POC_DEPLOY_KEY` is deleted, and its `jammers-poc-deploy` public key was removed from the TrueNAS user. The guard
  `scripts/ci/check-deploy-secrets.sh` runs in the checks job (it flagged the old `poc-deploy.yml` before its removal).
- **AC6:** `v02-552e7bda-2`'s env has `JJ_BROKER_URL` and its own `JJ_BROKER_SECRET` (= HMAC(broker key, its id), checked on
  TrueNAS as a boolean); no `CF_*` or `JJ_BROKER_KEY`.
- **AC2 still 2 of 3:** v02-552e7bda (scheduled run 2020) used an image I re-tagged by hand, so it isn't zero-manual.
  The third scheduled publish needs a green ci.yml run: none since 552e7bd (run 1991); the latest runs fail in product
  journeys (JN4/JN5 and the damage journeys, run 2136), not in the deploy lanes. CI now re-tags the last green image for
  commits that don't rebuild it, so the next green run publishes with no hand step. D05 and D06 wait on D04.

## 2026-10-08 17:3x UTC (BrownCreek): the third hands-off publish; all ACs met

| AC | State | Evidence |
|---|---|---|
| 1. first preview is G00 and passes room, join-webrtc, input, resume | met | above (`v02-f4d0e2ef`, run 1658) |
| 2. three consecutive publishes picked up by the scheduled poll, zero manual steps | **met** | jammers-deploy scheduled runs 1714 (`v02-eceaeeb8`) and 2003 (`v02-39f5aa80`), then this repo's scheduled run **2307** (`v02-84811340`, the first green ci.yml since 552e7bd, run 2301; image built by CI): `publish: 1 new build(s)` → `smoke: PASS room ZG5H, isolated from 3 other preview(s), join-webrtc (host, 1 ms), input, resume, drive, hud, round` → `publish: v02-84811340 playable` → `publish: retired v02-39f5aa80`. Tag `preview/v02-84811340`, status `preview/smoke/v02-84811340` success; the index shows it as Latest. No hand step in any of the three (552e7bda's run 2020 used a hand re-tag, so it isn't counted) |
| 3. unknown smoke step fails the publish | met | `infra/previews/tests` (`test_unknown_smoke_step_fails_the_publish`), in the checks job |
| 4. two live previews: a room code from one doesn't resolve on the other | met | every smoke checks it ("isolated from 3 other preview(s)" in run 2307) |
| 5. replaced by R117 (bead comment): deploy secrets only in this repo's Gitea secrets and deploy workflows, guard in CI | met | secret names above; `scripts/ci/check-deploy-secrets.sh` in checks; `POC_DEPLOY_KEY` deleted |
| 6. no Cloudflare token in a preview; its broker secret differs from every other preview's | met | `jjp-v02-84811340`: `JJ_BROKER_URL` set, broker secret sha256 prefix `bb4046d40229` (v02-552e7bda-2's differs), no `CF_*`/`JJ_BROKER_KEY` |
