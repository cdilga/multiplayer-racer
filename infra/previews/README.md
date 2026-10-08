# infra/previews

Deploys Joystick Jammers 0.2 rainbow previews (P1-D03–D07). Moved here from `cdilga/jammers-deploy` at its commit
`3ddc6c9e` (R117, 2026-10-08; that repo is archived and keeps the earlier history). CI (`.gitea/workflows/ci.yml`, job
`image`) builds and pushes the `jj-server` image; the deploy workflows below publish it. They run only on the
`jammers-deploy` runner on TrueNAS, and only `deploy-*.yml` may name a deploy secret (`scripts/ci/check-deploy-secrets.sh`,
in the checks job).

| Path | What |
|---|---|
| `.gitea/workflows/deploy-previews.yml` | every 5 min + on demand: `scripts/publish.py` |
| `.gitea/workflows/deploy-retention.yml` | hourly + on demand: `scripts/retention.py` (publish also reconciles) |
| `scripts/publish.py` | green CI run + image digest → a TrueNAS app `jjp-<id>` per preview, health, smoke, the git record |
| `scripts/record.py` | **git is the record of what is deployed**: tags and commit statuses (below) |
| `scripts/smoke.mjs` | the fixed public smoke steps (`room`, `join-webrtc`, `input`, `resume`, `drive`, `hud`, `round`), all mandatory since P1-D07 |
| `scripts/retention.py` | pins, Latest, the three newest young previews stay; the rest are retired |
| `scripts/index_page.py` | the index at https://jammers-preview.dilger.dev/ |
| `scripts/truenas.py` | the middleware's JSON-RPC over wss, as the `jammersdeploy` user (privilege APPS_WRITE only) |
| `edge/` | the Caddy edge (`/p/<id>/` → `jjp-<id>:8080`, `/poc/`, the index), applied by the publisher |
| `tests/` | unit tests, run by CI's checks job |

## The record (R117)

| Git object | Meaning |
|---|---|
| tag `preview/<id>` (annotated, on the source commit) | a published preview; the annotation holds its digest, publish time, CI run, title and change list |
| commit status `preview/smoke/<id>` | `pending` while it smokes, `success` = playable (the PASS line), `failure` = not playable (the reason) |
| tag `pin/<id>` | pinned: exempt from retention. The annotation's first line is its label (`Playtest 1`, or `Pinned`) |
| tag `retired/<id>` | replaces `preview/<id>` when retention retires it; adds the time and reason |

Pin: `git tag -a pin/v02-552e7bda 552e7bda -m "Playtest 1" && git push gitea pin/v02-552e7bda`; unpin:
`git push gitea :refs/tags/pin/v02-552e7bda`. The next publish poll (5 min) or a Retention run reconciles the edge.
Tags never start CI (`ci.yml` triggers on branch pushes only). The old file register was migrated once into tags and
statuses (`migrate_register.py`).

Infrastructure (TrueNAS apps): `jammers-net` owns the `jammers-previews` Docker network; `jammers-preview-edge` is the
Caddy edge on :30290 behind the Cloudflare Tunnel route `jammers-preview.dilger.dev`; `jammers-runner` is the Gitea runner
`jammers-docker-truenas` (labels `jammers-docker`, `jammers-deploy`; its jobs get the host Docker socket); each preview is
its own app `jjp-<id>`; `jammers-turn-broker` is the TURN broker (`infra/turn-broker/`).

Secrets: this repo's Gitea Actions secrets, names in `docs/infra/turn-and-previews.md`; values are never printed or
committed.
