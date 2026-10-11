# P1-C14 controls self-review

2026-10-11, CyanBridge. Local web build with refreshed host WASM, Playwright Chromium on the Apple Silicon Mac,
real jj-server and browser host. Keyboard events are real browser events; pads are emulated. These are browser
viewports, not a physical television or gamepad. Published-preview verification remains outstanding.

## Looked at

Every image in `frames/` was inspected. Each state has laptop 1366x768 and TV 1920x1080 captures:

- `lobby-empty-drawer-*`: pre-join clusters, Add, keyboard toggle and unobscured room controls.
- `drawer-open-lobby-*`: seated keys and pads, Sit out and Leave, no overlap with Start or QR.
- `lobby-four-cards-*`: two key and two pad cards with their correct glyphs and seat colours.
- `lobby-four-seats-no-cards-*`: cards fold after the controls are used; the lobby remains clean.
- `host-menu-controls-*`: source cards, wheel profile note and Back all fit in the panel.
- `race-identify-held-cards-*`: Keys A and Pad controls appear while Identify is held; cars, HUD and road ahead remain visible.
- `race-no-card-*`: releasing Identify removes the cards; ordinary source-specific tutorial prompts remain.
- `race-pause-menu-*`: Controls is findable in the pause menu; player rows and display options fit.
- `race-pause-controls-*`: the Controls page fits over the paused race and keeps Back visible.

## Defects found and fixed

- The Controls modal clipped Back. Its heading and actions now stay in place while the card middle can scroll.
- Tutorial prompts covered cars. Prompts and held cards now occupy the sky below the HUD at a smaller size.
- Key cards failed to fold when braking transitioned through neutral to throttle. The release is retained through
  the axis ramp and expires after the launch transition window.
- Identify cards waited for a room update. A local held-edge event now repaints the HUD immediately. The journey
  checks actual visible cards while held and their disappearance on release.

The final TV and laptop capture journeys pass (2/2); the controls behavior journeys and mapping checks also pass.

## Remaining defects

No clipping or car/HUD overlap found in the inspected matrix. The owner couch check remains open on br-799j.

## Not covered

Published preview, physical wheels/pads, owner couch readability and the full phone Help matrix are still to be
verified. This record covers the inspected host surfaces and does not complete the owner acceptance box.
