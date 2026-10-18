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

Owner feedback 2026-10-12: implementation and 74 inspected local Chromium/WebKit images are recorded at `../br-f1di/self-review.md` and `../br-f1di/receipt.md`. Deployed verification remains pending.

## Deployed check (2026-10-18, AmberSpring)

**How these were made.** The published preview `https://jammers-preview.dilger.dev/p/v02-f147c283/` was driven by
`deployed/capture.mjs`, in Playwright Chromium on eris with the journeys' GPU setup (`JJ_CHROMIUM_GPU=1`, ANGLE on
Vulkan, RTX 2080 Super). Sizes: TV 1920x1080, laptop 1366x768, a phone-sized host 412x915, each resized with the menu
open, and a joined phone at 844x390 over the real join link.

These are browser viewports on the real deployed server, not a TV, a physical pad or a real phone.

The first pass used bare `--use-angle=vulkan` flags. It showed a doubled lobby (two QR cards, two Start buttons), which
the journeys' GPU setup does not reproduce on the same preview or on a local build. That was a capture artefact, not
the game, and those images were thrown away.

### Looked at (all in `deployed/`)

**Lobby hint:** `lobby-hint-tv-1920x1080.jpg`, `lobby-hint-laptop-1366x768.jpg`, `lobby-hint-phonehost-412x915.jpg`.
- The empty lobby carries the one quiet line, "Got a pad or keyboard? Press any button to join · Host menu → Controllers".
- No panel; the QR, Race/Derby and Start are clear.

**Host menu → Controllers:** `host-menu-controllers-tv-1920x1080.jpg`, `host-menu-controllers-laptop-1366x768.jpg`,
`host-menu-controllers-phonehost-412x915.jpg`.
- "Keyboard players: on" and "Controls".
- Keys A, Keys B and Keys C each listed with "press … to join" and **Add**, before anyone joins.
- "Control mappings" and "Back".

**After Add on Keys A:** `host-menu-controllers-added-tv-1920x1080.jpg`, `host-menu-controllers-added-laptop-1366x768.jpg`,
`host-menu-controllers-added-phonehost-412x915.jpg`.
- "Keys A: playing" with Sit out and Leave, and the lobby shows Player 1.
- Behind the menu, the host keyboard's car chooser and its Keys A card sit in the lobby's left column.

**Control mappings:** `host-menu-mappings-tv-1920x1080.jpg`, `host-menu-mappings-laptop-1366x768.jpg`,
`host-menu-mappings-phonehost-412x915.jpg`.
- One card per source kind: phone, pad, wheel, Keys A, Keys B, Keys C (numpad).
- On the phone-sized host the cards stack in one column and Back stays on screen.

**Resized with the menu open:** `host-menu-resized-from-tv.jpg`, `host-menu-resized-from-laptop.jpg`,
`host-menu-resized-from-phonehost.jpg`. The panel refits; nothing is clipped.

**Joined phone:** `phone-help-steps-844x390.jpg`, `phone-help-controls-844x390.jpg`.
- The tutorial's first step with Controls, Identify and Skip tutorial.
- Its Controls page has the same six cards, scrolling under "Back to Help".

### Remaining

- The host keyboard's lobby car chooser (a select with Use vehicle and Ready) is plain next to the lobby cards. It is
  usable but not as finished as the rest.
- The owner's couch check stays with the P1-Q02 checklist row "Controls you can find (P1-C14)"
  (`docs/playtests/owner-checklists.md`).
