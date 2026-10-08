# P1-C07 self-review (personal controller settings)

Captures: `captures/c07-settings.test.mjs` and `captures/c07-landscape-short.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, run `cap4`, commit b972e04), phone contexts at 844x390, 390x844, 1920x1080 and the short landscape set. Chromium on eris, not a device. The captures are committed in `docs/evidence/P1-C07/captures/` (file names below are relative to it).

## Looked at
- Images (in `captures/`): `captures/c07-play-screen-with-settings-button-844x390.png`, `captures/c07-settings-phone-landscape-844x390.png`, `captures/c07-settings-phone-portrait-390x844.png`, `captures/c07-settings-resized-back.png`, `captures/c07-settings-storage-denied-844x390.png`, `captures/c07-settings-tv-1920x1080.png`, `captures/c07-short-landscape-640x300.png`, `captures/c07-short-landscape-740x360.png`, `captures/c07-short-landscape-800x300.png`, `captures/c07-short-landscape-844x340.png`, `captures/c07-short-landscape-844x390.png`, `captures/c07-test-controls-844x390.png`, `captures/c07-test-controls-live-844x390.png`
- Settings sheet at 844x390 (two columns: your controls left, Save / Test / Reset / Sit out / Leave / Back right), 390x844 (one column, scrolls) and 1920x1080 (centred 460 px column over the dimmed play screen): all rows legible, the blue autopilot banner on top, segmented choices and switches in the POC's look (ported from art/ui/poc/phone), reduced-motion and remember toggles show their state.
- Storage-denied note: "Applied for now — this browser couldn't remember your settings." in red under the toggles.
- "Test these controls": two live sticks, readout "Drive x 1.00 y 0.00 Action x 0.00 y 0.00" while dragging, nothing reaches the race.
- Play screen with the new Settings button at 844x390, 844x340, 740x360, 800x300, 640x300: tools on one line, name readable, banner low between the sticks, bases inside their dashed zones, boost track visible.

## Defects found and fixed
- Rotating or resizing the phone while Settings was open rebuilt the play screen and lost the sheet (Menu stayed open): the sheet now moves onto the rebuilt screen.
- Seven tools plus the connection badge crowded the landscape strip (name cut to "B..."): landscape strip tightened; 640x300 tightened again so nothing scrolls sideways.
- Short viewports (from the Android drive images): banner over Leave, bases overflowing their zones, tools wrapping. Fixed in layout-short.css; guarded by `captures/c07-landscape-short.test.mjs`.
- "Turn sideways" card showed over the open sheet in portrait: hidden while the sheet is open.
- Connection badge was unstyled on the phone (its CSS only loaded with the hub): moved to the settings stylesheet.
- Storage-denied note was below the fold in the capture: the test scrolls it into view.

## Remaining defects
- (Fixed in 2310cd2b: camera distance goes to the host as `SetCameraDistance`.)
- Vibration switch only affects the sticks' own tap buzz (via sticks.ts); iOS shows the switch disabled with a reason.
- During a stick drag in Test these controls the base overlaps the "Drive" label (minor).
- Portrait play screen: the tutorial card and the "Turn sideways" card stack on top of each other (C06 behaviour, not changed here).
- Second reviewer: see `fresh-eyes.md` (PASS).

## Not covered
- Real phones, iOS Safari, a real haptic motor, tilt steering (C07.2).
- The host-side autopilot handoff when Menu opens (P1-G03); here only the Menu bytes are checked.
