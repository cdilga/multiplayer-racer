# br-2cy4 portrait coaching self-review

2026-10-11, CyanBridge. Playwright Chromium and WebKit on the Apple Silicon Mac, real host/controller join path,
local refreshed build. The 12 images in `frames/` were individually inspected before copying them here.

## Looked at

For each engine at 412x915 and 375x667 (local build, 2026-10-11):

- `frames/chromium-412-portrait-rotate.jpg`, `frames/chromium-375-portrait-rotate.jpg`, `frames/webkit-412-portrait-rotate.jpg`, `frames/webkit-375-portrait-rotate.jpg`: rotate prompt alone, no overlapping tutorial.
- `frames/chromium-412-landscape-coach.jpg`, `frames/chromium-375-landscape-coach.jpg`, `frames/webkit-412-landscape-coach.jpg`, `frames/webkit-375-landscape-coach.jpg`: turning to 915x412 opens one tutorial card and keeps its controls readable.
- `frames/chromium-412-portrait-coach.jpg`, `frames/chromium-375-portrait-coach.jpg`, `frames/webkit-412-portrait-coach.jpg`, `frames/webkit-375-portrait-coach.jpg`: upright consent opens one tutorial card; text and actions remain inside the phone.

Deployed preview `https://jammers-preview.dilger.dev/p/v02-a1f7bf4b/` (2026-10-16, WhiteStream, on eris: the same
journey with `JJ_BASE_URL`, Chromium and Playwright WebKit, 4/4 pass). All twelve opened in two contact sheets:

- `deployed-frames/chromium-412-portrait-rotate.jpg`, `deployed-frames/chromium-375-portrait-rotate.jpg`, `deployed-frames/webkit-412-portrait-rotate.jpg`, `deployed-frames/webkit-375-portrait-rotate.jpg`: before consent only the Turn sideways card shows, its heading and Play upright anyway clear of everything.
- `deployed-frames/chromium-412-portrait-coach.jpg`, `deployed-frames/chromium-375-portrait-coach.jpg`, `deployed-frames/webkit-412-portrait-coach.jpg`, `deployed-frames/webkit-375-portrait-coach.jpg`: after Play upright anyway only the STEP 1 OF 6 card shows; Controls/Identify/Skip tutorial, Right/Left and the step dots inside the card.
- `deployed-frames/chromium-412-landscape-coach.jpg`, `deployed-frames/chromium-375-landscape-coach.jpg`, `deployed-frames/webkit-412-landscape-coach.jpg`, `deployed-frames/webkit-375-landscape-coach.jpg`: one STEP 1 OF 6 card centred over the sticks, all actions readable; the toolbar fits in one row.

The journey also repeats orientation changes after Skip and checks that consent and dismissal persist.

## Defects found and fixed

Rotate and tutorial cards previously opened together. The tutorial is now deferred until rotation or explicit
upright consent, including Help requests and subsequent orientation changes.

## Remaining defects

No overlaps or clipped actions in the inspected states, local or deployed. Observed outside this bead: at 375 wide the
portrait toolbar wraps its exit icon onto a row of its own (Chromium and WebKit); that is the phone-buttons layout,
reworked by P1-FL14 (br-bbki.13) after this preview build, and passed to its author.

## Not covered

Physical Android and Safari devices; WebKit is browser emulation. CI initially lacked WebKit; the CI image now
installs it (`scripts/ci/ci-image.Dockerfile`), and the deployed WebKit run above was on eris.
