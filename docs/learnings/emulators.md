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
