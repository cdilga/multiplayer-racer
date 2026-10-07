# P1-D05 self-review

## 2026-10-07, live index (BrownCreek)

Looked at: `index-live-desktop-1440x900.png`, `index-live-tv-1920x1080.png`, `index-live-phone-390x844.png` (DPR 3)
and `index-live-phone-landscape-844x390.png` (DPR 3): https://jammers-preview.dilger.dev/ in headless Chromium on eris
(`index-shots.mjs`, a fresh context per size), with the first real rows: `v02-eceaeeb8` (Latest, smoke passed, all seven
steps) and `v02-f4d0e2ef` (not playable, the reason shown). Horizontal overflow 0 px at every size.

What each row shows: id and the Latest badge, branch and commit, publish time, "What it is" (the run's title), "What
changed (40 commits)", smoke status with the steps it ran and when, Keep (Latest, or "Expires in 21 h"), and Host / Join
buttons plus the CI run link. Host (`/p/v02-eceaeeb8/host`) and Join (`/p/v02-eceaeeb8/`) both answer 200.

Defects found and fixed:
- The "CI run (evidence)" link pointed at Gitea's LAN address (http://192.168.11.12:3001/…), useless on a public page:
  it now uses https://git.dilger.dev/ (jammers-deploy 831df6e; takes effect on the next edge apply).
- Every page carried Cloudflare's injected Web Analytics beacon (static.cloudflareinsights.com): the edge now sends
  Cache-Control no-transform (jammers-deploy 0fd3976); `curl … | grep -c cloudflareinsights` is 0 on the index.

Remaining defects: the not-playable row's "What changed" is empty when it was the first publish (no previous build to
compare). "What it is" shows the newest commit's title even when that's a tracker export, not the build's own change.

Not covered: a live pinned row (no preview is pinned yet; `test_explicit_pin_stays_first_even_when_old_and_page_has_no_dollar`
covers the order), and the captures predate `v02-eceaeeb8-2`/`-3` and the retirement of `v02-f4d0e2ef` (16:43 UTC).

## Earlier (sample register)

Looked at: index-desktop.png (1280 wide) and index-phone.png (390 wide), rendered by `scripts/index_page.py` from
register-sample.json (a hand-made register: pinned "Playtest 1", Latest, a failed-smoke row, a retired row) in headless
Chromium via file://.

Defects found and fixed: none after the first render; no horizontal overflow (scrollWidth equals viewport width).

Remaining defects: the Barlow fonts load from the edge's /fonts/ path, so this file:// capture shows the system fallback.
The Keep column wraps under the grid on desktop (4 cells in a 3-column grid).
