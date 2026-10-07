# P1-F10 receipts

Taken from pushed commit `30f11c2` (matrix on eris through `scripts/remote/eris.sh`, preflight and probe on the Mac).

| Receipt | What |
|---|---|
| `matrix-eris-milestone.json` | `matrix.mjs --tier milestone` on eris: Chromium (GPU, ANGLE/Vulkan) and Chromium host + Android emulator controllers both passed the 12-controller demo; WebKit, Firefox: not installed there; iOS: macOS only |
| `demo-chromium.json`, `demo-chromium+android.json` | the demo journey's own receipts: 12 mixed controllers join and leave in waves, back to 2 with no phantom seat |
| `matrix-Chriss-MacBook-Pro-milestone.json` | the Mac: preflight shows WebKit and the iOS Simulator available, but the loopback probe fails (Playwright browsers can't connect WebRTC over loopback on this Mac), so every WebRTC lane here is reported unavailable with that reason, not claimed |

Lanes not run, and why: WebKit (Playwright) is not installed on eris and can't connect on the Mac; iOS Simulator needs the Mac's
WebRTC loopback to work; Firefox is installed on neither. Each is recorded as `unavailable` with its reason in the matrix receipts.
