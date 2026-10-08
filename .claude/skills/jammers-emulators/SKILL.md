---
name: jammers-emulators
description: The emulator lanes for Joystick Jammers 0.2 (P1-F08, P1-F10) - Chrome on the Android emulator (eris, KVM) and Mobile Safari on the iOS Simulator (the Mac, per test only), driven with real touch gestures through scripts/emulators/ and the journey harness's lane preflight and platform matrix. Use when a bead needs a controller checked on an emulated phone (touch, two-finger sticks, typing the room code, the QR scanner, resume after backgrounding), when a receipt must say "Android emulator" or "iOS Simulator", when running the milestone matrix, or when an emulator run fails and you need its traps.
---

# Jammers emulators (labelled honestly: an emulator is never a "device")

Lanes, machines and labels are in `docs/evidence/README.md` ("Lane labels"): Android emulator on **eris** (KVM, AVD
`jj-ctrl-api37-play`), iOS Simulator on **the Mac** (allowed per test only; the Mac is otherwise kept light). Results
carry the label, machine, OS and browser version.

**Distilled from** steps repeated in two closed beads: **P1-F08** (the emulator lane itself: `scripts/emulators/lane.mjs`,
real gestures through XCUITest and CDP touch + adb) and **P1-C03** (join, claim and resume driven on the Android
emulator through `scripts/emulators/drive.mjs` and `stack-run.mjs`, receipts under `docs/evidence/P1-C03/`). P1-F10
added the lane preflight and the matrix.

## The tools (ask them, don't restate them)

- `node web/tests/journeys/harness/lanes.mjs`: which lanes exist on this machine, with the reason for each missing one.
- `node web/tests/journeys/harness/matrix.mjs --tier every-wave|milestone`: the F10 demo journey in every available
  lane, one receipt (`matrix-<host>-<tier>.json`; `JJ_EVIDENCE_DIR` moves it). `scripts/beads/batch-verify.sh run
  --matrix milestone` runs the same.
- `node scripts/emulators/lane.mjs ios|android …` and `scripts/emulators/drive.mjs` for gesture-level checks (their
  headers list every flag).

## Worked example (eris, about 3 minutes)

```bash
scripts/remote/eris.sh --run emu-demo 'node web/tests/journeys/harness/lanes.mjs; JJ_EVIDENCE_DIR=$JJ_RUN_DIR node web/tests/journeys/harness/matrix.mjs --tier milestone; echo "exit $?"'
```

Stated result (eris, game commit 9909380; the lane list prints twice, once from `lanes.mjs` and once from the matrix):
the preflight lists `available chromium`, `available webkit` (Playwright's WebKit build 2336, installed on eris
2026-10-08), `available android-emulator`, and `unavailable` for Firefox (not installed for Playwright there), the iOS
Simulator (macOS only), macOS Chrome headed, macOS Safari, Windows and real devices, each with its reason; then
`loopback WebRTC: connects`, `passed chromium`, `passed webkit`, `passed android-emulator`, a `receipt:
…/matrix-eris-milestone.json` line and `exit 0`. (Before WebKit was installed, the fresh-agent run in
`docs/evidence/P1-F09/` showed WebKit unavailable and the rest the same.)

A cold emulator can miss the page wait on the first run of the day (`failed android-emulator: Error: timed out waiting
for the emulator page`, seen 2026-10-08 on the run just before the passing one): run it again before treating it as a
regression; a second failure is a real one.

Notes for the run: `eris.sh` runs your **pushed** HEAD in eris's clean clone (it may print `RU_SYNC=skipped (runs in
progress …)`, which is fine). The single quotes keep `$JJ_RUN_DIR` (`~/Work/runs/<id>`, set by `eris.sh --run`) for
eris; the receipt and the demo's captures stay there: `scp -r eris:Work/runs/<id>/ <scratch dir>` to look at them.

## Rules

- Never call an emulator run a device run; never claim a lane that printed `unavailable`.
- On the Mac only the iOS Simulator, one test at a time (it boots a simulator on a 16 GB machine).
- No GUI clicks: XCUITest for Safari, CDP `Input.dispatchTouchEvent` + `adb input` for Android.

## Traps

`docs/learnings/emulators.md` (XCUITest without Simulator.app, never block Node's event loop while the page loads,
`simctl openurl` retries, the Android first-run prompts, `adb shell` eating stdin, `ssh -R` + `adb reverse` for a secure
origin).
