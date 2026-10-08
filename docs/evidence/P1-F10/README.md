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

## 2026-10-08 07:25 UTC (BrownCreek): Mac rerun after the owner's firewall change

The application firewall now lists Playwright's `Google Chrome for Testing.app` and `chrome-headless-shell` as "Allow
incoming connections". Rerun: `matrix.mjs --tier milestone --lanes ios-simulator` (new `--lanes` filter, so the Mac only
runs the lane asked for) → `matrix-mac-ios-2026-10-08.json`: the loopback probe still fails (`ice checking, pc
connecting`), so the iOS lane is still `unavailable`.

The firewall was not the cause. A bare pair of RTCPeerConnections inside **one page** on the Mac never connects either,
and its only ICE candidate is `10.4.5.222 typ host`: the address of `utun4`, a point-to-point VPN tunnel interface
(`inet 10.4.5.222 --> 10.4.5.222`), not the Wi-Fi address on `en0` (192.168.10.x, the default route). Chromium gathers
only the tunnel's address and UDP to it goes nowhere; `--allow-loopback-in-peer-connection` and the full Chrome for
Testing binary (instead of the headless shell) change nothing. With that VPN disconnected (or set not to own the
interface Chromium picks), the probe and the iOS lane should run; that's an owner step on the Mac.
