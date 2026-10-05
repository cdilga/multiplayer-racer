# Self-review P1-C01

Captured with `node web/landing/tests/capture.mjs` (Playwright Chromium; WebKit for two phone sizes), against a
local production build served at `/` by `web/landing/tests/lib/site.mjs`. These are emulated viewports, not the owner's
phone or TV. Every image below was opened and looked at.

## Looked at

- `phone-390x844.jpg` portrait phone: wordmark, pitch, car, Host and Join panels all on one screen, nothing clipped, buttons 48+ px.
- `phone-412x915.jpg` the owner's phone size: same layout with breathing room under Join.
- `phone-small-375x667.jpg` small phone: Host panel and the code field are visible; the Join first, field and Join fully on the first screen, Host below, car hidden at this height.
- `phone-landscape-844x390.jpg` landscape phone: brand left, both panels right, everything visible with no scrolling (the car is dropped at this height, see Remaining).
- `tablet-820x1180.jpg` tablet portrait: single centred column, vertically centred, no empty top band after the fix.
- `laptop-1366x768.jpg` laptop: two columns, desk profile, balanced.
- `tv-1920x1080.jpg` TV: big wordmark and car, panels scaled by the TV profile (96 px touch targets), type well above 24 px minimum.
- `state-invalid-char-390x844.jpg` `ab0d` typed: field turns danger-tint with a red border, message names the bad character, focus ring visible.
- `state-empty-submit-390x844.jpg` Join pressed with nothing typed: friendly message, field flagged, placeholder reads as a placeholder.
- `state-keyboard-focus-390x844.jpg` Tab focus on the Join button: cobalt ring visible on saffron.
- `state-scan-toast-390x844.jpg` Scan QR code stub: toast with icon at the top, readable, covers nothing the player needs.
- `resize-390x844-to-844x390.jpg`, `resize-to-tv-1920x1080.jpg`, `resize-tv-to-412x915.jpg` resize without reload: layout and profile follow the viewport each time and match the fresh-load captures.
- `webkit-phone-390x844.jpg`, `webkit-phone-landscape-844x390.jpg` Playwright WebKit (not Safari): same as Chromium, fonts and mask icons render.

## Defects found and fixed

0. Coordinator change: on portrait phones Join is first and the brand shrinks, so the code field and Join button are fully on the first screen at 375x667, 390x844 and 412x915 (Playwright asserts both rects inside the viewport, and Join above Host). Recaptured those three and the states and looked at them; the first try had the Join tag overlapping the pitch at 375x667, fixed with top padding on the panels.

1. TV: buttons were 48 px tall with 64 px type, so the label overflowed the button. The touch target now scales with the profile (`--touch` 96 px at 1080p on a TV), generated from the tokens.
2. Phone: the scan toast, anchored to the bottom, sat on top of the Join button. Toasts now anchor to the top.
3. Toast was captured mid fade-in; capture now waits for it to settle.
4. Tablet portrait: two columns left a huge empty top band and a small wordmark. Two columns now only apply in landscape; portrait is one centred column.
5. Phone portrait: Join button was pushed to the bottom edge when the error message appeared. The car is smaller on portrait phones (and smaller still under 760 px tall).
6. Placeholder "ABCD" looked like a typed value in the empty-error capture. It is now lighter and non-italic.

## Remaining defects

- Portrait phones show Join above Host by CSS `order` only; the DOM and Tab order still put Host first. The car is hidden at 375x667 (portrait under 700 px tall) to make room.
- Landscape phone (height 480 px or less): the car is hidden to keep both panels on one screen. It is decoration, not content, but it is a deliberate omission.
- The room-code field's display face draws `0` and `O` almost identically, so an entry like `AB0D` shows as "ABOD" next to a message about `0`. The message names the character; a slashed zero in the face would be a U01 font follow-up.
- Panels are straight rectangles with an ink outline and sticker shadow; the guide's wobbled outline and the torn heading banner exist as helpers (`tornBanner` in `web/shared/ui/paint.ts`) but the landing page doesn't use them yet.

## Not covered

- A real phone, a real TV, real Safari (WebKit here is Playwright's build). Dark mode and large system font sizes were not captured.
- The Scan QR code button only shows a toast (stub, P1-C04's scanner). The host and controller pages it links to are still scaffolds, so only the navigation and URL were checked, not what loads there.
