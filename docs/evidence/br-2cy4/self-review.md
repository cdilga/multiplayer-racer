# br-2cy4 portrait coaching self-review

2026-10-11, CyanBridge. Playwright Chromium and WebKit on the Apple Silicon Mac, real host/controller join path,
local refreshed build. The 12 images in `frames/` were individually inspected before copying them here.

## Looked at

For each engine at 412x915 and 375x667:

- `*-portrait-rotate.jpg`: rotate prompt alone, no overlapping tutorial.
- `*-landscape-coach.jpg`: turning to 915x412 opens one tutorial card and keeps its controls readable.
- `*-portrait-coach.jpg`: upright consent opens one tutorial card; text and actions remain inside the phone.

The journey also repeats orientation changes after Skip and checks that consent and dismissal persist.

## Defects found and fixed

Rotate and tutorial cards previously opened together. The tutorial is now deferred until rotation or explicit
upright consent, including Help requests and subsequent orientation changes.

## Remaining defects

No overlaps or clipped actions in the inspected states. Published-preview verification is outstanding.

## Not covered

Physical Android and Safari devices; WebKit is browser emulation. CI initially lacked WebKit, which is being
added to both runner images before this bead closes.
