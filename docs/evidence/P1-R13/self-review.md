# P1-R13 local self-review (deployed review pending)

Mac arm64, Playwright Chromium 151 (full Chromium/native mode) and WebKit. Local dirty build based on 8183b70c; two real loopback WebRTC phones per engine, plus rendered synthetic cohorts. Compared with accepted 2026-10-07 tokens.

## Looked at

- `local/cars-1-tiles-1.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/cars-24-tiles-24.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/cars-4-tiles-4.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-host-1366x768.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-host-1920x1080.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-host-375x667.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-host-412x915.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-host-915x412.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-host-after-fullscreen.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-host-fullscreen.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-phone-1-landscape.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-phone-1-portrait.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-phone-2-landscape.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/chromium-phone-2-portrait.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/cvd-deuteranopia.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/cvd-normal.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/cvd-protanopia.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/cvd-tritanopia.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/webkit-host-1366x768.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/webkit-host-1920x1080.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/webkit-host-375x667.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/webkit-host-412x915.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/webkit-host-915x412.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/webkit-phone-1-landscape.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/webkit-phone-1-portrait.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/webkit-phone-2-landscape.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.
- `local/webkit-phone-2-portrait.jpg`: checked paint, numbers, patterns, nameplate fit, toolbar and HUD placement; no blank or clipped controls.

## Defects found and fixed

- Rounded interpolated roof digit indices to remove speckled number pixels.
- Sized phone badges/tool buttons for short landscape screens; final five sizes checked separately.
- Removed a repeated nameplate collision search that could freeze a racing host at fractional positions.
- Waited for the actual landscape stick rebuild before rotation captures (WebKit delivers orientation asynchronously).
- Isolated the material draw comparison with the existing `fx=off` setting: wall-clock particles otherwise change triangle counts between samples.

## Remaining defects

- No defect found in the final local matrix. Containing green CI and the deployed matrix have not passed yet; the bead remains open.

## Not covered

- This is browser emulation on the Mac, not the owner’s physical phone/TCL TV or Safari.
- Deployed `live-check` and deployed real-room recapture remain mandatory before close.
- Full vehicle damage/model acceptance is inherited from production-car receipts; this change paints their existing geometry. The roster fixture checks identity on a withdrawn non-default husk and shared buffers/disposal.
