# br-dim.12 self-review (P1-U05 look settings, A/B compare, settings panel)

Built by a helper under BoldKite; Chromium (Playwright) with WebGPU on Metal, this Mac. Not a phone: the phone sizes are emulated
viewports (412x915 and 915x412, DPR 2.6, touch).

## Looked at
- `gtao-big-ab.jpg`, `gtao-big-crops.jpg`, `gtao-big-heat.jpg`, `gtao-small-crops.jpg`: the A/B page, the 4x crops and heatmap.
  GTAO turns the guard rail navy and stripes the mesas; no contact shadow.
- `smaa-big-ab.jpg`, `smaa-big-crops.jpg`, `smaa-small-crops.jpg`, `smaa-grid-crops.jpg`: edge softening only.
- `shadows-big-ab.jpg`, `shadows-grid-ab.jpg`, `shadows-small-crops.jpg`, `shadows-grid-crops.jpg`, `wipe-shadows.jpg`:
  cast shadow and halftone dots, visible in the grid image too. The wipe line and slider work.
- `phone-compare-shadows.jpg` (412 wide): stacks to one column, nothing clipped; the 24-tile grid is small but that is the real tile size.
- `panel-phone-portrait-open.jpg`, `panel-phone-landscape-open.jpg`, `panel-phone-landscape-closed.jpg`, `panel-tv-open.jpg` (and the
  closed ones): the collapsed corner button, the docked bottom sheet (portrait) and right column (landscape and TV), no clipped text.
- `panel-check.json` (after the re-layout fix): closed 0.51% (phone) and 0.09% (TV) of the view; open 0.0% at all three sizes, all 24
  tiles fully inside the visible view and none under the panel; Close and Escape each return to the full-size view. Looked at
  `panel-phone-landscape-open.jpg`, `panel-phone-portrait-open.jpg`, `panel-tv-open.jpg` again: every tile whole, no stray button.
- Control pair (A = B) reads 0 on all three cases, so the comparison is deterministic.

## Defects found and fixed
- First compare screenshots had the heatmap and metrics cut off: the TV stylesheet makes `html`/`body` `overflow: hidden; height: 100%`.
  Compare page now scrolls (full-page capture works).
- The open panel's close button showed a tiny "x" glyph (seen in the first panel captures); enlarged to 26 px.
- Metrics and heatmap were a full-width row below everything; moved beside each other so the page is shorter.

- Coordinator review: the open panel covered the grid's last column and a second "x" button sat over the panel. Fixed: opening the
  panel reloads with `&panel=1` and the world is laid out in the area left beside (landscape, TV) or above (portrait) the panel; the
  Look button is hidden while it is open (Close and Escape dismiss). panel-check now asserts open overlap <= 3% of the view, every
  tile rect inside the view and none under the panel.

- Coordinator review: a pale beige band where the sky should be in tiles #21-#24 of the open portrait capture. Root cause found, not a
  dock bug: those tiles' cars start under the start-finish banner (a real 12 m x 2.1 m box at 4.3-6.5 m) and the chase cameras pass it
  as the sim runs; the colour at the same tile point reads navy at frame 30, grey-beige at 120 and cream at 600, depending on where the
  banner is in view (banner ink face, then its paper type). It is time-dependent: the closed 412x915 capture shows the banner in the same
  tiles (black with "FINISH/START"), and a fresh 412x604 undocked load shows sky. Proof the dock is clean: the same frozen frame
  (?freeze=60, grain and shimmer off) docked and undocked at the docked view's size is pixel-identical (png equality) at all three sizes;
  `panel-check.mjs` now asserts that (`dockedEqualsUndocked`), which catches any pass or tile sized to the pre-dock canvas.
  Not fixed here: the chase camera sitting at the banner's height as the pack passes under it is a camera/world matter (P1-R05 / the
  banner's clearance), flagged to the owner of those.

## Remaining defects
- Opening or closing the panel reloads the page (a second or two) so the world can re-lay out; the choice lives in the URL (`panel=1`).
  The grid at the smaller area has smaller tiles (24 tiles in the space left), which is the point of docking.
- Shadow default: the code default is PCF on (the recommended preset); the owner's review URL passed `shadow=off`. Left as the code has
  it, per the coordinator; the owner confirms.
- The compare page renders two full-size frames at once, so a 4K compare needs a GPU with the memory; not run at 4K.
- GTAO pipeline code is still in `shaders/pipeline.js` (only the panel entry is gone); delete in P1-R10.

## Not covered
- A real phone, Safari or Firefox; only Chromium WebGPU. No WebGL2-fallback run of the compare page.
- Other looks (only Fury road, the recommended look, was compared) and other cameras (first-person tiles, overview).
- GTAO/SMAA cost in ms (the decision rests on the image difference; the earlier P1-U05.5 cost table stands).
- Shadow variants (soft, VSM, cascaded) against each other: only PCF 4096 against off.
