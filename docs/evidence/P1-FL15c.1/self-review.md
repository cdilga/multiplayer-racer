# P1-FL15c.1 self-review: every figure-eight seats two set pieces (br-bbki.15.4.1)

Build: aaf11630 (the fix, GENERATOR_VERSION 25) and 38335734 (goldens). The captures were taken just before the bump,
on the shared tree with this change (headers read 24; the eight maps are the same).
Local `jj-server`, Playwright Chromium (not a TV), 1920×1080, `tools/maps/review-landscape.mjs` with `JJ_RECIPES=mix
JJ_PRESET=figureEight JJ_CLASS=epic`, which are the rhythm bank's epic eights. Seeds 5 and 12 (the two gaps), and seed 1 as a
control.

## Looked at

- `eights-overview.jpg`: the overviews of seeds 5, 12 and 1 side by side (from `captures/mix-s5-overview.jpg`,
  `captures/mix-s12-overview.jpg`, `captures/mix-s1-overview.jpg`). Seed 12 now shows a cream set-piece detour at the
  end of each lobe, and seed 5 shows its two pieces through the Rocks lobe. The bridge sits at the crossing in all three.
- `eights-chase.jpg`: the chase stills of seeds 5 (top) and 12 (bottom) (from `captures/mix-s5-high.jpg`,
  `captures/mix-s12-high.jpg` and the other states). Both show a road-wide kicker into a canyon cutting (their set
  pieces' approach). Seed 5's dirt lobe runs between rock walls with railed chevron corners. Seed 12 has Town's street
  with verandahs and power poles, and a railed sweeper. No blank frames, floating pieces or clipping seen.

## Defects found and fixed

- **Biome boundaries landed on a lobe's beat straight** (seed 5 at 874 m in the beat at 841–962 m; seed 12 at 747 m in
  the beat at 728–874 m), so that beat failed "outside one biome" and the lap seated one piece. `select_crossing` (the
  eights' selector) never saw `course.beat_spans`. It now keeps boundaries off them where the lap has room, as
  `select_avoiding` does. Seeds 5 and 12 now have 2 pieces each, and all 20 epic eights pass AC1.

## Remaining defects

- None found on the eights. Seed 5's last lobe beat still sits inside the start-line exclusion, so its second piece
  comes from the other beats. It's not needed for the minimum.

## Not covered

- Other families' AC1 on the shared tree: CoralCrane's uncommitted loop-overs (br-xlvx.10.2) fail 11 of 60 laps. The
  same 60 pass with `crossover.share` 0, so they're reported to CoralCrane and aren't from this change.
- A real TV; WebKit.
