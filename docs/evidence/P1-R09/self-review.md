# Self-review P1-R09 / br-61po

## Looked at

Every image below was inspected on 2026-10-12. Local preview-realm Rust server; Playwright on the Apple Silicon Mac.
Chromium and WebKit are browser automation, not physical devices. Contact sheets retain each source image; small-phone text was also reviewed during the correction loop.

- `chromium/phone-results-1.jpg`: controller intermission: identity, both sticks, Ready and actions remain available.
- `chromium/phone-results-2.jpg`: controller intermission: identity, both sticks, Ready and actions remain available.
- `chromium/reel-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-1920x1080.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-375x667.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-412x915.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-915x412.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-fullscreen-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-fullscreen-1920x1080.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-fullscreen-375x667.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-fullscreen-412x915.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-fullscreen-915x412.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-gazza-detach-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-hidden-1366x768.jpg`: Hide: canvas removed, standings expand, QR and buttons clear of the drawer.
- `chromium/reel-roo-detach-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `chromium/reel-roo-wreck-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/phone-results-1.jpg`: controller intermission: identity, both sticks, Ready and actions remain available.
- `webkit/phone-results-2.jpg`: controller intermission: identity, both sticks, Ready and actions remain available.
- `webkit/reel-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-1920x1080.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-375x667.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-412x915.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-915x412.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-fullscreen-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-fullscreen-1920x1080.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-fullscreen-375x667.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-fullscreen-412x915.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-fullscreen-915x412.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-gazza-detach-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-hidden-1366x768.jpg`: Hide: canvas removed, standings expand, QR and buttons clear of the drawer.
- `webkit/reel-roo-detach-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `webkit/reel-roo-wreck-1366x768.jpg`: recorded damage: subject identity, complete vehicles/parts, separate world; standings/QR/Hide, caption and drawer clear, resize/fullscreen attempt.
- `live-check/host_roundfixture_results_0_1920x1080.png`: empty/two-player no-replay results: expected paper slot, QR, standings and actions; resize/fullscreen attempt.
- `live-check/host_roundfixture_results_0_1920x1080_after-resize.png`: empty/two-player no-replay results: expected paper slot, QR, standings and actions; resize/fullscreen attempt.
- `live-check/host_roundfixture_results_0_375x667.png`: empty/two-player no-replay results: expected paper slot, QR, standings and actions; resize/fullscreen attempt.
- `live-check/host_roundfixture_results_0_375x667_after-resize.png`: empty/two-player no-replay results: expected paper slot, QR, standings and actions; resize/fullscreen attempt.
- `live-check/host_roundfixture_results_2_1920x1080.png`: empty/two-player no-replay results: expected paper slot, QR, standings and actions; resize/fullscreen attempt.
- `live-check/host_roundfixture_results_2_1920x1080_after-resize.png`: empty/two-player no-replay results: expected paper slot, QR, standings and actions; resize/fullscreen attempt.
- `live-check/host_roundfixture_results_2_375x667.png`: empty/two-player no-replay results: expected paper slot, QR, standings and actions; resize/fullscreen attempt.
- `live-check/host_roundfixture_results_2_375x667_after-resize.png`: empty/two-player no-replay results: expected paper slot, QR, standings and actions; resize/fullscreen attempt.

## Defects found and fixed

- Hide initially inherited oversized brush-button geometry; scoped its size. Identity badge sizing is explicit.
- Narrow portrait results originally stacked the QR and buttons, squeezing standings; compact footer keeps them adjacent.
- Timer intrinsic digit widths moved Start; fixed timer width and tabular numerals. Regression checks bounds across countdown changes.
- Keys & Pads covered Return; reserve its 36px strip beneath actions.
- Announcer captions covered the results edge; reserve the caption band, refit on resize, and keep its background paper.
- A two-line caption still made small-phone placings tiny; compact QR room-code typography helped.
  Deployed review on v02-cc9b2c81 then found the long preview join URL squeezed WebKit 375x667
  rows again. The portrait split is now 44/56. The long-URL 64px-caption regression passes >=12px.
  Every revised local image (32 journeys plus four live-check captures) was inspected individually;
  the detailed review is in [br-61po self-review](../br-61po/self-review.md).

## Remaining defects

No unresolved local layout defect in the revised judged states. Deployed Chromium/WebKit journeys
passed on v02-cc9b2c81, and all 36 deployed images were inspected individually. The new font
correction still needs containing green CI and deployed recapture; the beads remain open.

## Not covered

- Physical phones/TV, Safari, WAN TURN, a full cohort GPU performance run and owner taste review.
- The no-replay fixture intentionally has a decorative paper slot; it is not a failed replay render.
- Fullscreen API calls are attempts in headless browsers; before/after viewport captures and explicit resizes are recorded, not a claim of physical fullscreen behavior.
- Publication of the latest correction and deployed recapture are pending green CI.
