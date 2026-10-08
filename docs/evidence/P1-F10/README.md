# P1-F10 receipts

Taken from pushed commit `30f11c2` (matrix on eris through `scripts/remote/eris.sh`, preflight and probe on the Mac).

| Receipt | What |
|---|---|
| `matrix-eris-milestone.json` | `matrix.mjs --tier milestone` on eris: Chromium (GPU, ANGLE/Vulkan) and Chromium host + Android emulator controllers both passed the 12-controller demo; WebKit, Firefox: not installed there; iOS: macOS only |
| `demo-chromium.json`, `demo-chromium+android.json` | the demo journey's own receipts: 12 mixed controllers join and leave in waves, back to 2 with no phantom seat |
| `matrix-Chriss-MacBook-Pro-milestone.json` | the Mac: preflight shows WebKit and the iOS Simulator available, but the loopback probe fails (Playwright browsers can't connect WebRTC over loopback on this Mac), so every WebRTC lane here is reported unavailable with that reason, not claimed |

Lanes not run, and why: WebKit (Playwright) is not installed on eris and can't connect on the Mac; iOS Simulator needs the Mac's
WebRTC loopback to work; Firefox is installed on neither. Each is recorded as `unavailable` with its reason in the matrix receipts.

## 2026-10-08 (BrownCreek): WebKit on eris

Playwright's WebKit (build 2336, WebKit 26.5) is installed on eris (`~/.cache/playwright-extra/webkit-2336`, linked
into `~/.cache/ms-playwright`). `matrix-eris-milestone-2026-10-08.json` (`matrix.mjs --tier milestone` in eris's clone
at 9909380): `passed chromium`, `passed webkit` (`demo-webkit.json`: Chromium host, WebKit controllers, the 12-controller
demo), `passed android-emulator`; Firefox not installed; iOS Simulator macOS only.

Still open: the **iOS Simulator** demo lane needs a host whose WebRTC the simulator can reach. The Mac's Playwright
browsers can't connect over loopback (the Mac matrix's probe), and the harness runs host and controllers on one machine,
so the iOS lane is still `unavailable` here. The iOS Simulator itself works on the Mac per test
(`docs/evidence/P1-A03/ios-simulator-decode-2026-10-08.json`: 78/78 clips decoded in Mobile Safari 27.0).
