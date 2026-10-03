# Self-review P1-R05

Captured with `node art/ui/lib/live-check.mjs --base <local web/dist> --viewports 412x915,915x412,1920x1080,1366x768
--fullscreen` on `/host/?synthetic=8&map&tiles=4&cams=fp,tp,fp,tp` and
`/host/?synthetic=24&map&tiles=12&cams=fp,tp,tp,fp,tp,fp,tp,tp,fp,tp,fp,tp` (16 captures), plus the CI test's two
named captures and side-by-sides with the POC (`review.md`). Playwright Chromium (headless, software GL).

## Looked at
- `self-review/matrix-all.jpg`: both routes on four screens before and after a resize: every tile aimed at its car,
  first-person mirrors in place, nothing blank.
- `first-person-4.jpg`, `mixed-fp-tp-12.jpg`: the bead's named captures (see `review.md`).
- `self-review/tiles_4_tp_fp_tp_tp_1920x1080.jpg`: third person framing next to first person at TV size.
- `self-review/24_map_tiles_12_cams_…_915x412.jpg` (phone landscape host, 12 seats) and
  `self-review/8_map_tiles_4_cams_fp_tp_fp_tp_412x915.jpg` (phone portrait host).
- `r05-vs-poc.jpg`: N = 4, 8 and 32 against the POC framing captures.

## Defects found and fixed
1. Third-person cars sat 14 m away instead of the preset's 8.4 m: a position spring lags a fast car by 2v/ω. The
   camera now holds the preset offset exactly and smooths only its heading.
2. Speed-scaled look-ahead tipped the view up into the sky: the aim now keeps the preset's pitch at any speed and
   leads turns along the car's own heading.
3. The default distance-by-count table (invented) picked near at 4 and far above 16, unlike the POC's mid
   everywhere: mid at every count until playtests pick.
4. First-person bonnet filled 40 % of the tile (the baked car's bonnet is higher than the POC's): eye moved forward.
5. The join chip (a 173 px QR) covered the bottom-right player's car on full grids, then the top-right player's
   mirror: it's a slim address pill under the top row's mirror strip, sized to its text and right-anchored (it ran
   off a landscape phone).

## Remaining defects
- More sky in third person than the POC mock (framing data is the POC's; a G-DESIGN tuning call).
- The join pill's place (under the top row's mirror strip, top-right) departs from the POC pseudocode's
  bottom-right; flagged for the owner at G-DESIGN.
- The rear-view mirror shows a strip of the car's own roof at its bottom edge.

## Not covered
- The accepted-mock review (AC1): the accepted set doesn't exist until G-DESIGN.
- Collision pull-in is exercised on the greybox's barriers and buildings but not captured in a dedicated view.
- The controller's SetCamera reaching the host (C02); here the seat's mode is set through the host API.
