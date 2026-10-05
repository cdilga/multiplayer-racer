# Self-review br-awxz (owner design review round 4, 2026-10-06)

Owner review from their Android phone (Brave, browser bars showing), 15 screenshots, plus two follow-ups mid-session:
"a consistent brush adjacent style and design language for the lot … be bold" and "straight-ish edges! commit to the
design!". Children: br-awxz.1 (brushed buttons and the sheet), br-awxz.2 (brushed chips/rows, paper QR, QR label),
br-awxz.3 (scale and browser-chrome defects, iPhone without full screen).

Viewports: the owner's phone with the bars showing is about **412 x 706** (portrait) and **806 x 325** (landscape) CSS px
at DPR 2.625, measured from their screenshots; plus 915 x 412 / 412 x 915 (bars hidden), 1920 x 1080 and 1600 x 900.
Tools: `node art/ui/lib/shot.mjs` (new: one page or element, `--mobile`, `--webkit`, `--resize` for a rotation or the
bars coming and going, `--print` to read layout numbers back) and `node art/ui/lib/live-check.mjs --local`.
All Playwright **Chromium** with mobile emulation (one **WebKit** run for the iPhone gate). Not the owner's phone.

## Looked at

- `frames/sheet_buttons_1600.jpg` (1600 x 900): every button variant x state; brushed slabs, compact plain variant.
- `frames/sheet_phone_412x706.jpg`: the sheet on a phone: words fit, components scroll sideways in their own box.
- `frames/tv_index_html_lobby_n_2-412x706.jpg`, `..._lobby_n_32-806x325.jpg`, `..._lobby_n_60-806x325.jpg`: heading never
  over a card, QR inside its paper card, slab cards, dab badges, slab chips, slab Start race.
- `frames/rotate_lobby32_412x706-to-806x325.jpg`, `frames/rotate_grid-player_412x706-to-806x325.jpg`: after a rotation.
- `frames/tv_index_html_grid_n_8-806x325.jpg`, `..._grid_n_8-1920x1080.jpg`, `..._grid_n_25-806x325.jpg`,
  `..._overlays_n_8-412x706.jpg`, `..._diagnostics_n_8-806x325.jpg`: tiles render once each (no second, shifted scene),
  HUD pills are slabs, the QR card shows ROO7 and jammers.dilger.dev, diagnostics never cover a tile.
- `frames/tv_index_html_results_n_8-806x325.jpg`, `..._intermission_n_32-806x325.jpg`: slab rows, saffron 1st, tiny
  number cells plain, QR on paper with an ink frame, slab host buttons.
- `frames/tv_index_html_paused_n_8-1920x1080.jpg`: slab Resume and actions, slab segmented settings.
- `frames/tv_index_html_grid-player_at_6-412x706.jpg`, `..._grid-player_at_13-806x325.jpg`: grid player in both
  orientations, rule text fits its panel.
- `frames/phone_index_html_gate-806x325.jpg`, `..._gate_fs_0-412x706.jpg` (WebKit): the gate fits with bars showing;
  full screen offered where it exists, "Let's play" plus an Add to Home Screen tip where it doesn't (iPhone).
- `frames/phone_index_html_lobby-806x325.jpg`, `..._lobby-412x706.jpg`, `..._race-806x325.jpg`,
  `..._settings-412x706.jpg`: the controller in the same language; Ready on screen at 806 x 325.

## Defects found and fixed

1. **Doubled/shifted scenes in lower tile rows** (owner's grid, overlays, diagnostics, portrait shots). Cause:
   `canvas#world` was CSS-sized `100vw x 100vh`; with the mobile bars showing `100vh` is the large viewport, so the
   image stretched against the tile maths (`innerHeight`). `world.resize()` now sizes the canvas box in px to exactly
   `innerWidth x innerHeight`.
2. **LOBBY banner over card 1** (n = 16/32/60): torn/brush shapes were painted once and kept their old size after the
   bars or a rotation changed the scale. `paint()` is idempotent and reruns after every relayout.
3. **Lobby QR wider than its card**: the column is now at least the scannable QR plus padding.
4. **In-match QR without the code**: the solver only places a QR together with its label (ROO7 + jammers.dilger.dev);
   when no cell holds both, the footer join line carries them.
5. **QR in a white box**: `qr-roo7-paper.svg` (ink modules on paper); every join QR sits on paper.
6. **Grid player broken after a rotation**: its frame and rule panel were placed once; now they follow every viewport
   change. Its rule panel was a scroller, and a scrolling layer over the WebGL canvas blanked every tile on a portrait
   phone (found while reviewing): the panel no longer scrolls and fits its text instead.
7. **Phone gate clipped with bars showing**: two-column layout on short landscape screens, `place-items: safe center`;
   never requires full screen; iPhone gets "Let's play" and an Add to Home Screen tip (`&fs=0` previews that path).
8. **Phone lobby: Ready off the bottom at 806 x 325**: a short-landscape layout and a sticky Ready row.
9. **Component sheet unreadable/clipped on a phone**: device-width viewport; text wraps; each section's components keep
   their 1600 px design and scroll sideways inside the section.
10. **Style**: one brush system (`art/ui/sheets/brush-button.js`): brushed-slab buttons with every state (hover, pressed,
    keyboard ring and gamepad ring tracing the slab, disabled), and for everything else a mask + skin per kind (chip,
    row, badge dab, panel) with any fill. Applied to badges, status chips, HUD pills, boost meters, roster cards,
    results rows, footer pills and toolbar buttons, segmented controls, fields, banners and list panels on the TV, the
    controller and the sheet. Iterated: first bristly ends (read as arrows/zig-zags), then straight-ish slabs with a
    forward lean (owner), streaks dropped (read as white ticks), badges as clean dabs (bristles fought the numbers).
    Fixes on the way: 1st-place row's rectangular fill, ends clipping `+21` on wide rows (wide row variant), outlines
    grazing descenders (padding), ink shadows vanishing on the ink controller (black on ink), tiny-tier double badges.

## Remaining defects

- Panels whose torn banner overhangs them (pause card, phone panels, gate card) keep straight edges: a shape mask would
  cut the banner off. They still use the language's ink outline and hard shadow.
- Masked elements can't show an outline focus ring; the TV footer buttons show keyboard focus as a cobalt fill instead,
  and the brushed buttons trace their own ring. A keyboard pass on the footer belongs to P1-R07.
- live-check flags one sheet note at 915 x 412 as "cut off by the screen edge": it straddles the bottom of a page that
  scrolls vertically (a false positive for scrolling pages).

## Not covered

- The owner's real phone (Android Brave) and a real iPhone: emulation only. The real-device check is the owner's
  review; the canvas fix is deterministic (CSS box = the box the tiles are laid out in) but only a real browser with
  its bars showing proves it.
- The 4K TCL capture (G-PERF) and the Android native-resolution run (br-dim.3) stay the owner's hardware items.
