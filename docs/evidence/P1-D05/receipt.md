# P1-D05 receipt (2026-10-07, BrownCreek)

Index: jammers-deploy `scripts/index_page.py` and `edge/tokens.json`, rendered on every publish and applied to the edge.
Live page: https://jammers-preview.dilger.dev/.

## AC1: after a publish the new row appears with commit, time, summary, "What changed", smoke status, expiry and working Host/Join links

After scheduled publish run 1714 (and the catch-up poll 1720: "the edge index caught up with the register"), the live
index's first row, read from the page (`curl -s https://jammers-preview.dilger.dev/`):

    Latest  v02-eceaeeb8
    Build   v0.2-revamp eceaeeb890bc, 2026-10-07 15:47:59 UTC
    What it is  beads: tracker export (hand-offs and claims from the lanes)
    What changed (40 commits)  P1-G02: JN5 waits for the twelfth tile … (40 commit titles since the previous build)
    Status  Smoke passed. Ran: room, join-webrtc, input, resume, drive, hud, round.
    Keep  Latest: kept while it is the newest   (the not-playable row: "Expires in 21 h")
    Open  Host -> /p/v02-eceaeeb8/host [200]   Join -> /p/v02-eceaeeb8/ [200]   CI run (evidence) -> run 1711

## AC2: a pinned row stays first

`test_explicit_pin_stays_first_even_when_old_and_page_has_no_dollar` and `test_pinned_first_then_newest_first_then_retired`
in jammers-deploy `tests/test_publish_index.py` (20 tests OK, `docs/evidence/P1-D06/deploy-unit-tests.txt`). No preview is
pinned live yet.

## AC3: the page works at desktop and phone viewports (screenshots) and is styled from the token file

`index-live-desktop-1440x900.png`, `index-live-tv-1920x1080.png`, `index-live-phone-390x844.png`,
`index-live-phone-landscape-844x390.png`: the live page, no horizontal overflow at any size. Token styling:
`test_styled_from_the_token_file_and_phone_safe`.

## AC4: visual self-review

`self-review.md` (the live captures looked at, two defects fixed, the remaining ones listed).
