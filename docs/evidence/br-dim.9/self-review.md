# Self-review br-dim.9 (P1-U03 bug: phone gallery pages unusable on a phone)

Pages: `art/ui/poc/phone/frames.html` (the device-frame gallery) and `art/ui/poc/guide.html` (the design guide, also
too wide for a phone). The live mock `phone/index.html` already passed. Captured with `node art/ui/lib/live-check.mjs
--local --fullscreen` at 375x667, 412x915, 915x412, 1366x768, 1920x1080 and the evidence size 2700x1650 (Playwright
Chromium on a Mac, not a phone). True-size measurements: `true-size-receipt.txt`.

## Looked at
- `before-frames-412x915.jpg`: before; the first frame's top only, the rest off the right edge (page 2270 px too wide).
- `before-guide-412x915.jpg`: before; tables and code paths pushing the guide 210 px past the edge.
- `after-frames-412x915.jpg`: all six frames one per row with "drawn at N%" in each caption (portrait 84-95%,
  landscape 40-55%); small but whole and legible as a review picture.
- `after-frames-375x667.jpg`: the same on a small iPhone; nothing off the edge.
- `after-frames-915x412.jpg`: phone landscape; portrait frames at true size, landscape frames drawn at about 90%.
- `after-frames-lobby-412x915.jpg`: the lobby state (car picker): every frame whole and legible.
- `after-frames-1920x1080.jpg`: TV/desktop; portrait row, then landscape frames wrapping (before, even 1920 scrolled
  sideways).
- `after-frames-2700x1650.jpg`: the size `phone/check.mjs` captures at; still two rows (portrait, landscape), as before.
- `after-guide-375x667.jpg`: tables fit; code paths break, ordinary words don't.
- `after-guide-915x412.jpg`: landscape phone, unchanged desktop layout.

## Defects found and fixed
- frames.html: rows now wrap; on a narrow page each frame is drawn smaller as a whole (a CSS scale on the bezel) while
  the iframe keeps the device's true CSS size (inner viewport measured equal to the device size at every viewport);
  one frame per row below 640 px, scrolling vertically only.
- guide.html: code paths may break anywhere; tighter type and padding below 640 px.
- Loop 2: the first guide fix broke ordinary words mid-word in narrow table columns ("Refer ence"). Only `code` breaks
  anywhere now.
- Loop 2: with wrapping, the third landscape frame dropped to its own row at the 2700 px evidence size (10 px short).
  The row gap went from 28 to 20 px; two rows again.

## Remaining defects
- None seen. At 915 px landscape the portrait frames sit one per row at true size with space beside them; that is the
  true-size rule winning over density, and it scrolls vertically only.

## Not covered
- The owner's Android phone (Brave): Chromium emulation only. The deployed preview is checked after the push.
- `art/ui/poc/index.html` and `art/ui/index.html` report a failed HEAD probe for the engine page under live-check's
  local server only; the deployed preview answers it (200). Not a layout issue and not in this bead.
