# P1-U02 fresh-eyes review of the TV mocks (plan §13b.4)

**Who/what/when.** Sonnet 5.5 subagent, fresh context, did not build the mocks. 2026-10-03. Reviewed the 1080p set (all listed states), spot-checked 4K (`hud_n=32_base=100`), 21x9 (`grid_n=7`), phone-portrait (`hud_n=8`, `grid_n=32`), plus `capture-report.json` and `perf.json`. Captures: the Mac, headed Chromium 151, M1 Pro (ANGLE Metal), not Safari, not the TV. I did not run the mocks. I read the stills only, not the .webm. References: GUIDE.md, tokens.json, README, H4.

## State groups

- **Grid 1→32:** present for 1, 2, 3, 5, 7, 10, 13, 24, 32. Seat order is reading order (report: `inOrder`). Pseudocode is present (`grid-player.jpg`, mono text wraps mid-comment). The shrink back to 1 isn't shown in stills. Nothing is black.
- **Gaps:** n=3 shows QR plus standings in the fillers. n=2/5/7/13 fillers are thin dotted-paper bands only (140/3/70/20 px). The room-code chip stands in for the QR.
- **Per-tile HUD:** badge, name, position, lap, boost, wreck, autopilot, reconnecting, identify and countdown are all present (`hud_n=8`, `identify_n=8_seat=3`, `countdown_n=8`). Seat numbers past 100 widen the badge correctly (`hud_n=32_base=100`).
- **Mixed FP/TP:** present, weak (see 6).
- **Lobby:** 2/8/16/32/48/140 present. Roster goes cards, then 2-column cards, then chips, then pages (`lobby_n=140`).
- **Results 8/32:** present. H4 minus voting.
- **Host controls:** puck, pause, end-round confirmation, diagnostics, players drawer all present.
- **Captions:** player, global and filler present. **Overlays:** nameplates and off-screen arrow present. **Overview 8/32:** present.

## First-look reading

- **n≤8:** the eye lands on the saffron/cobalt/red tile borders and the number badges. Finding your own number and colour takes under a second. Your car is easy to pick out in the chase views.
- **n=24–32:** it takes a scan of 32 tiny badges to find yours. In `grid_n=32` the cars in rows 3 to 5 are three same-size cars side by side with no mark on yours. "Which car am I" fails there.
- **Lobby:** QR and R007 first, then "Start race". Good.
- **Results:** wordmark and "NEXT RACE STARTS IN 42s" first. Your own result is findable only if you're on the visible page.

## Defects, ranked

**High**
1. **QR rule violated.** The host puck carries a ~52 px QR, about 1.8 px per module, with a ~1-module quiet zone (`host_n=8.jpg`). `tokens.qr` wants 8 px or more per module and 4 modules of quiet zone. The README itself says "room code only" below 296 px. A decorative, unscannable QR.
2. **Overview truncates and collides** (`overview_n=32.jpg`). The damage list is clipped after row 24, so 8 players are silently missing (no paging, which breaks the no-truncated-arrays rule). Nameplates are bigger than the cars and bury each other: Dusty hidden behind Pip, Snag behind Shaz, #23/#25/#26 stacked.
3. **Chrome covers identity and your own HUD.**
   - `overlays_n=8.jpg`: the "#7 Snag" nameplate sits on tile #5's own badge. #4/#6/#7 plates overlap each other, and "#5 Big Kev" spills ~25 px past its tile.
   - `countdown_n=8.jpg`: the "Get ready" pill hides tile #8's badge. The big "3" sits on tile #5's car. At n=8 the screen centre falls inside one player's tile, so the countdown reads as theirs.
   - `identify_n=8_seat=3.jpg`, `hud_n=8.jpg`: the identify inner frame cuts through "3rd" and the boost bar.
4. **HUD text is bare, not on stickers.** Name, position and lap are white on pale sky, about 1.6 to 1.75:1 measured, held up only by a dark halo. GUIDE §7 says cream stickers, and white-on-sky is not a named contrast pair (`grid_n=*`, worst n≤13). The ordinal suffixes (st/nd/th) look about 15 px, under the 24 px TV minimum. The cap-height check in `capture-report.json` only reports the smallest `.hud-badge`.

**Medium**
5. **Charcoal seats vanish.** #7, #19, #31 (and #103) have a tile border and identify frame the same colour as the ink gutters (`grid_n=32.jpg`, `hud_n=32_base=100.jpg`).
6. **First person reads as "no car".** A stray black pole stands up the middle of the view, and the bonnet is a thin colour sliver at the bottom edge, not driver-side. Charcoal's sliver is black (`grid_n=8_fp=2,5,7.jpg`).
7. **Join chip sits on gameplay.** At n=32 it covers about a third of tile #32 and its boost bar (`grid_n=32.jpg`). It is 35 px from the bottom edge, inside the 54 px title-safe line, with text of about 22 px. At n=1 the corner QR covers the road (`grid_n=1.jpg`).
8. **Results drift from H4.** Flat tan ground, with no painted outback or bunting. The QR panel is flush at 20 px from the bottom. The "p" of "Jump in" collides with the caption below. Button sub-labels are about 20 px and the label/sub-label alignment differs button to button. At n=32 only 8 rows show, paged four times at 6 s each (`results_n=8.jpg`, `results_n=32.jpg`).
9. **Lobby.**
   - The warm-up drive shows no cars in any capture (`lobby_n=*.jpg`).
   - Dev annotations ("Cards: 1 column.") are left in the capture.
   - At 32 and 140, Ready is a ~14 px dot, with ~200 px of panel height unused (`lobby_n=32.jpg`).
   - The 8-row list puts the name and Ready ~900 px apart.
   - The ink "JOYSTICK" sits on red earth, with a tree behind it at 16 and 32.
10. **Phone-portrait HUD breaks.** HUD scales by height, so names collapse to one letter and collide with the ordinal (`phone-portrait/grid_n=32.jpg`).

**Low**
11. **Copy off-glossary.** "lobby" appears in `results_n=8.jpg` and `host-end_n=8.jpg`, and "Disband room" is used for what the guide calls "End room". `paused_n=8.jpg` contains a design note ("Every controller shows the same message."). "Back in 2" has no unit.
12. **Name truncation is inconsistent.** "Maxim…" (`hud_n=32_base=100`), "Maximil…" (`grid_n=32`) and "Maximilian A…" (`grid_n=13`) all appear, against the 12-grapheme rule.
13. **Translucent panels.** In `diagnostics_n=8.jpg` the HUD ghosts through the panel. `input-drawer_n=8.jpg` overlays rather than reflows, hiding #2/#5 position and leaving #8 a 240 px sliver, and shows no paging beyond 8 rows.
14. **Other.**
    - `grid-player.jpg` shows "4th" at n=1.
    - `grid_n=2.jpg` leaves 280 px of empty cream bands.
    - Corner-tile badges sit 14 px from the screen edge, which is ambiguous against the guide's 5% title-safe rule.
    - The room code uses zeros (R007), while H4 shows the letter O.

Good: tokens, type, ink and sticker shadow are followed in the chrome. Gap logic and seat order work. Perf is fine (HUD ≈0.02 ms/frame at 32, frame p50 8.3 ms). Gamepad focus rings read.

## Verdict

Layout logic and the identity kit hold up. Not ready to freeze as is. Fix 1 to 4 before G-DESIGN (the QR, the overview clipping and overlaps, the HUD stickers and sizes, and the covered badges). Items 5 to 9 should be fixed or explicitly accepted by the owner at P1-U04.

## Round 2 (after fixes)

Re-read the same 1080p set (plus `4k/grid_n=32`, `phone-portrait/grid_n=32`). `perf.json` still fine: HUD ≈0.017 ms/frame, p95 frame 8.7 ms at 32.

**Earlier defects**
1. Host puck QR: **fixed** (`host_n=8.jpg`, code only).
2. Overview: **not fixed** (`overview_n=32.jpg`). The list now wraps, but column 2 (rows 28 to 32) runs off the right edge and column 1 stops at a half-cut row 25, so rows 26 and 27 never show. Numbers-only plates are **partly** better: #26, #23, #1, #16/#18 and #10/#11 still stack. `overview_n=16.jpg` is clean apart from #8/#9 and #1/#2.
3. Chrome over identity: **mostly fixed**. Own badge is no longer covered (`overlays_n=8.jpg`), the pill is gone, and the identify frame is thin with the HUD stepping in (`identify_n=8_seat=3.jpg`). Remaining: the "3" sits on each car's roof in 7 of 8 tiles (`countdown_n=8.jpg`), and in `overlays_n=8.jpg` the "#5 Big Kev" plate still spills ~25 px past tile #7 and nudges the lap stickers in #7 and #8.
4. HUD on stickers: **fixed** (`grid_n=32.jpg`, `hud_n=8.jpg`). Ordinals now look about 24 px.
5. Charcoal borders: **fixed** (#7, #19, #31 in `grid_n=32.jpg`, #103 in `hud_n=32_base=100.jpg`).
6. First person: **partly**. The bonnet and decals now read (`grid_n=8_fp=2,5,7.jpg`), but a black pole still rises from the centre like an antenna.
7. Join chip: **partly**. It is compact, but still sits on tile #32 and ~35 px from the bottom (`grid_n=32.jpg`). The corner QR at n=1 still covers road (`grid_n=1.jpg`).
8. Results: **partly**. The 3D world is behind the panels, and the "Jump in" collision is gone (`results_n=32.jpg`). Not fixed: button sub-labels still ~20 px with uneven alignment, QR panel still ~30 px from the bottom edge, 32 players still page 8 rows at a time.
9. Lobby: ✓ / … marks **fixed** (`lobby_n=32.jpg`). Warm-up cars are **partly** there: a car is now visible, but cropped behind the QR panel, with unexplained dark and blue blocks (`lobby_n=8.jpg`, `lobby_n=32.jpg`). ~200 px of unused panel height at 32 remains.
10. Phone-portrait: names dropping is accepted, but see New 2.
11. Copy: "lobby" and "Disband room" are **closed** by the glossary change. **Not fixed:** "Every controller shows the same message." (`paused_n=8.jpg`), and "Back in 2" has no unit (`hud_n=8.jpg`).
12. Name truncation: **not fixed**, still width-based ("Maxi…" in `grid_n=32`, "Max…" in `hud_n=32_base=100`, "Maximilian A…" in `grid_n=13`). New 1 makes it worse.
13. Diagnostics panel is still translucent and the HUD ghosts through it (`diagnostics_n=8.jpg`). Drawer still overlays and clips tile HUDs (`input-drawer_n=8.jpg`). Global caption still sits inside one player's tile (`captions_n=8_kind=global.jpg`).

**New defects**
1. **Name sticker runs under the position sticker** in narrow tiles: "Big Kev" and "Roo Boy" at n=32 (`grid_n=32.jpg`, `4k/grid_n=32.jpg`), and "Dusty", "Tiggy", "Mack" at base 100 (`hud_n=32_base=100.jpg`). The position/lap sticker is also large, about 100×90 on a 268×210 tile.
2. **Phone-portrait regression** (`phone-portrait/grid_n=32.jpg`). The position sticker fills most of every tile. The number badge is hidden on tiles 1 to 8 and cut to "#1" or "#2" on the rest. The boost bar overlaps "Lap 1/3". Identity is lost, which is worse than round 1 and goes beyond "drop the names".
3. The in-race chip now says only "JOIN · R007", with no address (`grid_n=32.jpg`). The URL is gone from every in-race view.
4. Standings row 8 looks clipped under the "Page 1 of 4" line (`results_n=32.jpg`).

**Updated verdict.** The TV profile is much closer, and the identity kit now reads at 8 to 32. Before U04: fix overview n=32 list clipping and plate stacking, the name/position sticker collision, and the phone-portrait HUD (or drop that profile from the claim). Everything else is low and can go to the owner as accepted.

## Round 3 (after round-2 fixes)

Re-read the 1080p set again, plus `phone-portrait/grid_n=32` and `hud_n=8`. `capture-report.json`: 96 captures, no failures, no external requests. `perf.json`: HUD ≈0.02 ms/frame, p95 frame 9.9 ms at 32.

**Round-2 defects**
1. Overview n=32 list: **fixed**. All 32 rows show in two columns (`overview_n=32.jpg`). Plates: **partly**. Numbers are readable, but clusters still stack at #1/#32/#3/#2 on the right and #16 to #19 on the left. `overview_n=16.jpg` is clean.
2. Name/position collision: **fixed**. Name ellipsises inside the flex row (`grid_n=13.jpg`, `grid_n=32.jpg`, `hud_n=32_base=100.jpg`).
3. Phone-portrait: **fixed**. Badge, position and cars all show (`phone-portrait/grid_n=32.jpg`, `hud_n=8.jpg`).
4. Countdown "3": **fixed**. It sits in each tile's sky band, clear of the cars (`countdown_n=8.jpg`).
5. Nameplates: **partly**. They stay inside their tile, but in tile #7 "#6 Mia" is hidden under "#5 Big Kev", and both plates touch the lap sticker (`overlays_n=8.jpg`).
6. Join chip: **partly**. It now reads "ROO7 jammers.dilger.dev". It still sits over tile #32's road and a corner QR at n=1 still covers road, both by design.
7. Results standings: **not fixed** at n=32 (`results_n=32.jpg`). Row 8 (#18 Zara) is cut in half above the "Page 1 of 4" line. n=8 is clean.
8. Results sub-labels at 24 px, "Back in 2 s", opaque diagnostics and the shorter pause copy: **fixed** (`results_n=8.jpg`, `hud_n=8.jpg`, `diagnostics_n=8.jpg`, `paused_n=8.jpg`).
9. Lobby warm-up: **not fixed**. No car or pack is visible in `lobby_n=8/32/140.jpg`, only track bands, while the caption says "drive around while everyone joins".

**New observations**
- Compact HUD at n=32 (rows 1 and 2 of `grid_n=32.jpg`) drops name and lap. Identity still reads by number and colour. Per the brief this is intended, but the owner should know.
- The `capHeight` check in `capture-report.json` still measures only the smallest `.hud-badge`.
- Players drawer and global caption: accepted by design.

**Remaining defects (none blocking)**
1. Results n=32: row 8 clipped.
2. Lobby background shows no cars.
3. Overview and nameplate clusters still overlap.

**Verdict.** Ready for the owner's design review. The three remaining items are minor. The lobby car gap should be disclosed to the owner as a known gap rather than hidden. Identity, QR rule, contrast and type minimums now hold across the set.
