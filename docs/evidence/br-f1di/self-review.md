# Owner feedback visual self-review

2026-10-12. Local built game on Mac, Playwright Chromium and WebKit, accepted UI kit/POC of 2026-10-07. This record is local; deployed confirmation is still required.

## Looked at

Every one of the 74 final journey captures was inspected, including portrait and landscape phone choice, Ready, source-specific choices, five lobby/menu host sizes, short-panel scroll, actual host fullscreen, paused race sound/diagnostics. The files are:

- frames/chromium-Advanced-1366x768.jpg
- frames/chromium-Advanced-1920x1080.jpg
- frames/chromium-Advanced-375x667.jpg
- frames/chromium-Advanced-412x915.jpg
- frames/chromium-Advanced-915x412.jpg
- frames/chromium-Controllers-1366x768.jpg
- frames/chromium-Controllers-1920x1080.jpg
- frames/chromium-Controllers-375x667.jpg
- frames/chromium-Controllers-412x915.jpg
- frames/chromium-Controllers-915x412.jpg
- frames/chromium-Controllers-scrolled-915x412.jpg
- frames/chromium-Display-and-sound-1366x768.jpg
- frames/chromium-Display-and-sound-1920x1080.jpg
- frames/chromium-Display-and-sound-375x667.jpg
- frames/chromium-Display-and-sound-412x915.jpg
- frames/chromium-Display-and-sound-915x412.jpg
- frames/chromium-Race-rules-1366x768.jpg
- frames/chromium-Race-rules-1920x1080.jpg
- frames/chromium-Race-rules-375x667.jpg
- frames/chromium-Race-rules-412x915.jpg
- frames/chromium-Race-rules-915x412.jpg
- frames/chromium-advanced.jpg
- frames/chromium-controllers.jpg
- frames/chromium-display-sound.jpg
- frames/chromium-host-fullscreen-1920x1080.jpg
- frames/chromium-lobby-1366x768.jpg
- frames/chromium-lobby-1920x1080.jpg
- frames/chromium-lobby-375x667.jpg
- frames/chromium-lobby-412x915.jpg
- frames/chromium-lobby-915x412.jpg
- frames/chromium-lobby-pad-choice-375x667.jpg
- frames/chromium-lobby-pad-choice-412x915.jpg
- frames/chromium-lobby-three.jpg
- frames/chromium-phone-choice-landscape.jpg
- frames/chromium-phone-choice.jpg
- frames/chromium-phone-ready.jpg
- frames/chromium-race-rules.jpg
- frames/webkit-Advanced-1366x768.jpg
- frames/webkit-Advanced-1920x1080.jpg
- frames/webkit-Advanced-375x667.jpg
- frames/webkit-Advanced-412x915.jpg
- frames/webkit-Advanced-915x412.jpg
- frames/webkit-Controllers-1366x768.jpg
- frames/webkit-Controllers-1920x1080.jpg
- frames/webkit-Controllers-375x667.jpg
- frames/webkit-Controllers-412x915.jpg
- frames/webkit-Controllers-915x412.jpg
- frames/webkit-Controllers-scrolled-915x412.jpg
- frames/webkit-Display-and-sound-1366x768.jpg
- frames/webkit-Display-and-sound-1920x1080.jpg
- frames/webkit-Display-and-sound-375x667.jpg
- frames/webkit-Display-and-sound-412x915.jpg
- frames/webkit-Display-and-sound-915x412.jpg
- frames/webkit-Race-rules-1366x768.jpg
- frames/webkit-Race-rules-1920x1080.jpg
- frames/webkit-Race-rules-375x667.jpg
- frames/webkit-Race-rules-412x915.jpg
- frames/webkit-Race-rules-915x412.jpg
- frames/webkit-advanced.jpg
- frames/webkit-controllers.jpg
- frames/webkit-display-sound.jpg
- frames/webkit-host-fullscreen-1920x1080.jpg
- frames/webkit-lobby-1366x768.jpg
- frames/webkit-lobby-1920x1080.jpg
- frames/webkit-lobby-375x667.jpg
- frames/webkit-lobby-412x915.jpg
- frames/webkit-lobby-915x412.jpg
- frames/webkit-lobby-pad-choice-375x667.jpg
- frames/webkit-lobby-pad-choice-412x915.jpg
- frames/webkit-lobby-three.jpg
- frames/webkit-phone-choice-landscape.jpg
- frames/webkit-phone-choice.jpg
- frames/webkit-phone-ready.jpg
- frames/webkit-race-rules.jpg

## Defects found and fixed

- WebKit lost masked roster badges/chips after resize. Round brush skins now live on the round root; rebuilt rows/buttons are painted, and captures wait for layout frames.
- Small portrait host QR swallowed the vehicle controls. Its whole-module QR is compact and labels sit beside it; source choices retain fitted roster space and scroll when necessary.
- Local-choice buttons were squeezed beside the glyph card. The choice owns a full source row; mappings remain in Controllers and held Identify.
- Focusing Back scrolled Controllers past its heading. Focus now prevents automatic scrolling; the initial heading and deliberately scrolled Back are both inspected.
- A one-sample lobby Ready pulse could be lost. It is a reliable host command now; physical Ready retains its held edge behavior.

## Remaining defects

No blank panels, broken vehicle images, invisible roster status or clipped actionable controls in the inspected final matrix. Long source lists/short menu panels intentionally scroll. At portrait host size, mappings are available in Controllers or held Identify while vehicle choices take the lobby space.

## Not covered

Deployed preview/live-check pending; real Safari/iPhone/Android, physical pads/wheels and couch/TV distance acceptance. br-799j retains its explicit owner couch gate. No gameplay caps were introduced.
