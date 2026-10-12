# Self-review br-q7r4 (P1-U01)

Check: `node art/ui/lib/live-check.mjs --local --out <scratch> --viewports 412x915,915x412,1440x900 /sheets/brand.html /sheets/fonts.html /sheets/cvd.html`
Browser: Playwright Chromium on the Mac (not a physical phone). Screenshots here are full-page captures, 412 wide and 915 wide.

## Looked at
- sheets_brand_html_412x915.jpg: phone portrait, full page. Wordmark panels stack, icons and QR wrap, nothing cut off.
- sheets_brand_html_915x412.jpg: phone landscape. Two-column wordmark, QR and icon rows fit.
- sheets_brand_html_1440x900.jpg: laptop. Layout matches the original desk sheet.
- sheets_fonts_html_412x915.jpg: phone portrait. Specimens stack, numbers wrap, names table scrolls inside its own box.
- sheets_fonts_html_915x412.jpg: phone landscape. Names table scrolls inside its box; the last HUD column is cut at the box edge and needs a sideways scroll.
- sheets_fonts_html_1440x900.jpg: laptop. Unchanged layout.
- sheets_cvd_html_412x915.jpg: phone portrait. Rows of badges wrap, the ΔE table scrolls inside its box.
- sheets_cvd_html_915x412.jpg: phone landscape. Badges wrap, table fits.
- sheets_cvd_html_1440x900.jpg: laptop. Unchanged layout.

## Defects found and fixed
- All three pages had fixed desk widths: brand body was 1600px, fonts and cvd used fixed two-column or nine-column grids and a 170px row label. Fix: fluid body (max-width 1600px), flex-wrap on rows, minmax(0,1fr) grids, max-width:100% on images, a single-column breakpoint (900px for fonts, 700px for cvd).
- brand.html viewport meta was width=1600, which forced a 1600px phone layout. Changed to device-width (fonts and cvd also gained device-width metas).
- Wide tables (fonts names table, cvd ΔE table) now sit in a `.tablebox` with overflow-x:auto, so they scroll inside their own box and do not widen the page.
- Large display text (fonts "Round 3 complete", the score block) now uses clamp() so it shrinks on a phone and stays at full size on a laptop.
- brand.html QR "don't" cross-outs used fixed margins; now centred with transform and capped to 90% of the frame.

## Remaining defects
- fonts.html names table on 915x412: the Tile HUD column is cut at the box edge and needs a sideways scroll. Honest: content is reachable but not visible at a glance. Filed as a follow-up for the design agent (not blocking).
- live-check "cut off by the screen edge" flags remain on all three pages at both phone sizes. I measured the brand wordmark labels (y 912 to 970 at 412x915): they straddle the 915px fold of a scrolling page, so this is the checker's fold rule, not clipping. Horizontal overflow passes at every size. The checker logic is not changed here.

## Not covered
- Real iPhone or Android hardware; Playwright Chromium emulation only. No WebKit run.
- Full-screen toggle and resize before/after: not run for these pages (the --fullscreen flag was not used).
- Portrait tablet 820x1180 and TV 1920x1080: not run.
