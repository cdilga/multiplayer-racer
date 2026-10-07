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
