# WebKit resize painting — br-293l

The standalone vector QR reproduction separates the defect from the game: WebKit corrupts `crispEdges` thumbnails at26/33/47px; ordinary vector sampling restores finder squares. Intrinsic dimensions alone did not fix the QR. The shared QR now retains integer module sizing for its large card and uses normal vector sampling for reductions. Brush SVG backgrounds/masks also declare their intrinsic dimensions.

`node --test web/shared/ui/tests/kit.test.mjs`:13/13 pass on the Mac, including compact37/74px QR decoding after repeated laptop/landscape/phone/TV resizes in Chromium and WebKit; quiet zones, large QR decoding, the accepted component-sheet comparison, focus geometry and bundle separation remain green.

All18 real local host screenshots were individually inspected. They show visible HUD/positions badges and recognisable paper docked QR before/after actual fullscreen and resize. See `../P1-M-relief/local-self-review.md` and its named frames. WebKit evidence is Playwright WebKit, not Safari. First-frame mask painting is intermittent; captures await decode and layout, and this receipt does not infer an unproven engine root cause. Containing CI and deployed repetition remain pending; the bead is not closed.
