# Emulator lane traps (P1-F08)

Lane: `scripts/emulators/lane.mjs` (`ios` on the Mac, `android` on eris, driven from the Mac).

- **No Simulator.app on this Mac** (Xcode 27 install has none), so no GUI-click route (CGEvent/Option-pinch).
  The iOS half drives Mobile Safari with **XCUITest** (`scripts/emulators/ios/`, hand-written pbxproj, no xcodegen).
  `safaridriver` only drives desktop Safari; Appium is not installed.
- **Never block the Node event loop while the simulator/emulator loads the page.** The lane's proxy lives in
  the lane process, so a `spawnSync` of `xcodebuild` or `simctl openurl` stalls the page request and Safari
  shows "server stopped responding". Use async spawns for anything long.
- `simctl openurl` right after `bootstatus` often times out (SpringBoard settling). The lane retries until the
  page's probe reports `load`.
- Safari freezes its UA OS token (`iPhone OS 18_7` on iOS 27.0); read the version from the Safari app's
  `Info.plist`, not the UA.
- The probe/proxy listens on `::` (dual stack): Safari resolves `localhost` to `::1` first.
- Android Chrome (Play image): first run shows "Stay signed out", then a notifications prompt *after* the page
  loads. The lane clears prompts with `uiautomator dump` + tap on the button text, then runs gestures.
- `adb shell` reads stdin: never feed an adb script through `ssh eris bash -s < file` (it eats the rest of
  the script). The lane runs one `ssh eris '<adb ...>'` per command.
- Android two-finger touch is `CDP Input.dispatchTouchEvent` (two touchPoints) over `adb forward` of
  `chrome_devtools_remote`; typing is real `adb shell input text` after a CDP touch-tap focuses the field.
  `adb shell input` cannot do multi-touch.
- The Android emulator reaches the Mac's server through `ssh -R <port>` (Mac -> eris) plus `adb reverse`
  (eris -> emulator), so the page origin is `http://localhost:<port>` (secure context) with no code on eris.
- Machine fit: the iOS lane builds the XCUITest bundle (~1 min first time, cached in `$TMPDIR/jj-f08-ios-dd`)
  and boots a simulator on a 16 GB Mac that is already swapping; the Android emulator needs KVM (eris only).

## Drive scenarios (C02, C03, G03, A03): what connects and what does not

Files: `scripts/emulators/drive.mjs` (controller + host scenarios), `stack-run.mjs` (the server side on eris),
`ios-local.mjs` (iOS Simulator without a host), `lib/platform-android.mjs`, `lib/platform-ios.mjs`.
These live in `scripts/emulators/` with the first lane (the bead names `tools/emulators/`, which would split one lane in two).

- **Browsers don't run on the Mac (coordinator rule, load ~400).** The stack for a drive run is `jj-server` + the lane proxy
  + a real host page (Playwright Chromium, `/host?drive&test=live`) on **eris**, started by `stack-run.mjs`. The driver reads
  the controller page through the injected probe (`ctl`, `rects`, `touch-summary`, `resume-ctl` events) and the host through
  `/__lane/host/observe` (`__jjTest.observe()`).
- **Android emulator + host on eris: connects.** Everything is one machine, the page is `http://localhost:<port>` through
  `adb reverse` (secure context), the controller reaches `ready-to-join`, joins, gets seat #1 and drives a car. All three
  scenarios pass twice in a row (`docs/evidence/P1-F08/drive-android-run{1,2}.json`).
- **iOS Simulator (Mac) to a host on eris: does NOT connect.** The page loads over an ssh tunnel (`localhost` secure context) but
  ICE stays `checking`: UDP from the Mac to eris is dropped (eris is on Wi-Fi; ping and TCP work, a UDP datagram to any port
  doesn't arrive; fixing that is a firewall change on eris, not ours), and Safari hides its host candidates behind mDNS
  names so eris can't call back. The Mac loopback is no better (VPN utun4). Ways out, none taken: a host browser on the
  Mac (not allowed now), eris allowing inbound UDP from the LAN, or `?ice=relay` through coturn (needs the coturn secret
  on the machine running `jj-server`, and coturn denies private peer addresses, so relay to relay must hairpin).
  Until then the iOS Simulator runs `ios-local.mjs`: no host, a **fixture** page (not the controller) for the touch engine
  and a clip decoder page for A03/A07.
- **Chrome fullscreen dialog.** The controller requests fullscreen on join; Chrome shows "Viewing full screen / Got it" over
  the page, and again after every return from the background. Touches go to the dialog until it is dismissed
  (`uiautomator` tap on "Got it", the lane's `settle()`).
- **Chrome comes back in portrait after HOME + relaunch.** Re-apply `user_rotation 1` and `wm user-rotation lock 1` on
  foreground, then re-read the control rects; stale rects tap the wrong place.
- **First-run tutorial covers the sticks.** Skip it with a real tap on `[data-act=skip]` (the probe reports its rect).
  Held upright the controller shows "Turn sideways"; tap "Play upright anyway" (`[data-act=upright]`).
- **Two fingers on iOS.** XCUITest's public API has no two-finger gesture at two points. The runner uses XCTest's own
  event synthesizer (`XCPointerEventPath` / `XCSynthesizedEventRecord`, private API, same machinery as `pinch`), reached
  through the ObjC runtime from Swift. **The interface orientation passed to the record must be the one the UI is actually
  in**: passing landscape while Safari was portrait rotated both touch points (both landed in one zone). The simulator did
  not rotate when asked through `XCUIDevice.orientation`, so iOS runs are upright.
- **XCUITest command mode.** `testDrive` long-polls `GET /__lane/cmd/next` and acks to `POST /__lane/cmd/ack`; the Node side
  queues with `POST /__lane/cmd` (`tap`, `hold`, `home`, `activate`). The runner stays up for the whole scenario, so each gesture
  costs milliseconds instead of an `xcodebuild` start.
- **Autopilot readout.** `observe().cars[i].autopilot` is `null` when the player drives and an object (`mode`, `target`...) while
  the autopilot has the car; the seat's `presence` stays `Active` for a backgrounded phone whose link survives.
- **A WebRTC link survives a short background.** On Android Chrome, the data channels stayed open through 1.5 s and 7 s
  backgrounds; the same seat was back in 3-85 ms after `visibilitychange`. That measures page resume, not a reconnect.
- **Never leave the simulator booted.** `drive.mjs`/`ios-local.mjs` shut it down at the end (a 16 GB Mac under load).
