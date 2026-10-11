# P1-C12 self-review (implementation slice)

Mac Apple M1 Pro; Playwright Chromium/Firefox/WebKit viewport emulation. WebKit is not Safari. Captured locally on the real Rust server. Deployed preview verification remains outstanding; this parent is not closed.

## Looked at

- `firefox-eight.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `joined-full-slots-1366x768.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `joined-full-slots-1920x1080.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `joined-full-slots-375x667.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `joined-full-slots-412x915.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `joined-full-slots-915x412.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-1366x768.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-1920x1080.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-375x667.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-412x915.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-915x412.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-after-fullscreen.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-fullscreen.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-scrolled-actions-1366x768.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-scrolled-actions-1920x1080.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-scrolled-actions-375x667.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-scrolled-actions-412x915.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `keyboard-actions-scrolled-actions-915x412.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-1366x768.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-1920x1080.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-375x667.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-412x915.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-915x412.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-scrolled-actions-1366x768.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-scrolled-actions-1920x1080.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-scrolled-actions-375x667.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-scrolled-actions-412x915.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.
- `webkit-keyboard-actions-scrolled-actions-915x412.jpg`: inspected guidance, cluster legends, live QR/link, source rows, resize and reachable controls; drawer scrolls rather than truncating rows.

## Defects found and fixed

- Joined landscape guidance covered the Join button. Reserve the actual tray height with ResizeObserver; safe centering and scroll padding keep the button fully visible and hittable. The real join button assertion now passes at all five sizes.
- Expanded keyboard actions were squeezed into the small phone drawer. Expand its available height/width while preserving scrolling.

## Remaining defects

- br-dx0e: Chromium SwiftShader leaves a dark strip under a clipped scrolling drawer. WebKit does not. Removing shadows and adding paint containment did not fix it; no fix claimed.
- A transient welcome callout overlays part of the open drawer/QR in some captures; it clears, and the live link remains accessible.

## Not covered

- Real USB/Bluetooth devices, physical keyboard rollover and owner phone/TV hardware. API emulation is not device qualification.
- Native input helper and self-hosted installer remain br-twal.1.
- Deployed copy must be captured after this commit ships.
