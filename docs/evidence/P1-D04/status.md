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
