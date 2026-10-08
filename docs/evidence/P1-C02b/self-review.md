# P1-C02b self-review: full screen on the phone controller

Captured by `web/tests/journeys/c02b-fullscreen.test.mjs` on eris (Chromium headless with mobile emulation, loopback
WebRTC, local build of d7eff97e, run `bc-r07b-5`, both tests pass). The short-strip layout check is
`c07-landscape-short.test.mjs` (640x300 to 844x390), which passed on eris (`bc-r07b-3`) and in CI run 2058.

## Looked at

- `phone-915x412-lobby-windowed.jpg`: the tools row with the full-screen tool (maximize icon, between Help and Settings).
- `phone-915x412-lobby-fullscreen.jpg`: after tapping it. The tool turns into a paper chip with an ink icon (pressed), and
  its name becomes "Exit full screen".
- `phone-915x412-settings-fullscreen-on.jpg`: the settings sheet has a "Full screen" switch, on, captioned "On: tap to
  exit full screen", above the existing "Full screen, screen on" preference. The switch follows exits the page didn't
  make (the test exits behind its back and the switch flips).
- `phone-915x412-race-fullscreen-lost.jpg`: mid-race, after full screen was lost without a tap. The prompt sits at the
  bottom middle: "Back to full screen" plus an × (Not now). It is off both stick bases, and the drive stick drives while
  it shows (the test asserts both).
- `phone-412x915-race-fullscreen-lost.jpg`: the same prompt upright. It sits at the bottom between the sticks, clear of
  the bases.
- `phone-844x390-no-api-note.jpg`: no Fullscreen API (iPhone Safari, emulated). The tool opens a note explaining Share,
  then Add to Home Screen, with "Got it". There is no fake toggle.
- `phone-844x390-no-api-settings.jpg`, `phone-375x667-no-api-settings.jpg`: the settings row reads "Full screen: Not from a
  page in this browser. Share, then Add to Home Screen…", with no switch.

## Defects found and fixed

- The × on the prompt and the pressed tool's icon were invisible: mask icons drawn in paper on paper chips. They are now
  ink.
- The new tool pushed the 640x300 strip's tools off screen (CI run 1998). The icon squares are now 34 px in the narrow
  short strip.
- The tool was first named "Leave full screen", which collided with JN5's `/Leave/` (the room's Leave). It is now "Exit
  full screen".
- The settings no-API note was greyed out and clipped. It is now shorter and in normal ink.

## Remaining defects

- None seen. The pressed tool reuses the maximize icon (the kit has no minimize); the pressed fill and its name tell the
  states apart.

## Not covered

- A real iPhone in Safari and a real Android in Chrome. The no-API path is emulated by removing the API in Chromium, and
  the "system gesture" exit is `document.exitFullscreen()` from outside the page's toggle. Playwright WebKit is not phone
  Safari.
- Home Screen standalone mode (the tool hides and settings says "On: opened from the Home Screen"). This path is in the
  code but was not captured.
