# Crossings self-review — br-xlvx.3

Local real jj-server build, 2026-10-12, Mac Chromium with native GPU and Playwright WebKit. These are browser viewports, not physical phone/TV hardware. Compared with the accepted 0.2 world and Cruz look. Deployed confirmation is pending the containing green preview.

## Looked at

All 40 images below were inspected on five labelled contact sheets, including both browsers, initial frame, fullscreen and transposed resize, and the ten live-check captures. Both cars and the grade-separated deck are visible; the lower car passes underneath without intersecting the upper car. The gate/replay assertions are in the journey receipt, rather than inferred from pixels.

- frames/chromium-fullscreen-1366x768.jpg
- frames/chromium-fullscreen-1920x1080.jpg
- frames/chromium-fullscreen-375x667.jpg
- frames/chromium-fullscreen-412x915.jpg
- frames/chromium-fullscreen-915x412.jpg
- frames/chromium-resized-1366x768.jpg
- frames/chromium-resized-1920x1080.jpg
- frames/chromium-resized-375x667.jpg
- frames/chromium-resized-412x915.jpg
- frames/chromium-resized-915x412.jpg
- frames/chromium-underpass-1366x768.jpg
- frames/chromium-underpass-1920x1080.jpg
- frames/chromium-underpass-375x667.jpg
- frames/chromium-underpass-412x915.jpg
- frames/chromium-underpass-915x412.jpg
- frames/live-1366x768-resized.jpg
- frames/live-1366x768.jpg
- frames/live-1920x1080-resized.jpg
- frames/live-1920x1080.jpg
- frames/live-375x667-resized.jpg
- frames/live-375x667.jpg
- frames/live-412x915-resized.jpg
- frames/live-412x915.jpg
- frames/live-915x412-resized.jpg
- frames/live-915x412.jpg
- frames/webkit-fullscreen-1366x768.jpg
- frames/webkit-fullscreen-1920x1080.jpg
- frames/webkit-fullscreen-375x667.jpg
- frames/webkit-fullscreen-412x915.jpg
- frames/webkit-fullscreen-915x412.jpg
- frames/webkit-resized-1366x768.jpg
- frames/webkit-resized-1920x1080.jpg
- frames/webkit-resized-375x667.jpg
- frames/webkit-resized-412x915.jpg
- frames/webkit-resized-915x412.jpg
- frames/webkit-underpass-1366x768.jpg
- frames/webkit-underpass-1920x1080.jpg
- frames/webkit-underpass-375x667.jpg
- frames/webkit-underpass-412x915.jpg
- frames/webkit-underpass-915x412.jpg

## Defects found and fixed

The previous diagnostic camera target of 4.5 m put the upper car's roof slightly behind the test-page input panel on the small portrait host. The crossing evidence camera now targets 6 m. Actual chase-camera defaults are unchanged. Raw seed 16 originally copied terrain ripples into the deck, exceeding its permitted grade; the generator now blends measured ground edges smoothly into the plateau, without relaxing grade/clearance validation.

## Remaining defects

No crossing geometry, car/deck overlap or framing defect observed in this local matrix. The free-drive test page retains its development input panel; the separate owner-settings change moves administration into the real room's Host menu.

## Not covered

Deployed preview matrix still pending; real Safari/iPhone/gamepad/TV hardware and owner playtest not covered by these Chromium/WebKit viewport captures. The three autopilot seeds per recipe are samples, not a generation/player limit.
