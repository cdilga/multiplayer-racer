# P1-C04 self-review (in-page QR scanner)

Captures: `web/tests/journeys/c04-scan.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, GPU, run `cap4`, commit b972e04); fake camera plays a recorded QR. Chromium on eris, not a phone. The Android emulator run (`scripts/emulators/scan.mjs`, label "Android emulator", Chrome 145 on API 37, eris) is below.
The Chromium captures are committed in `docs/evidence/P1-C04/captures/` (file names below are relative to it); the emulator's are `emulator-scan-*.jpg` and `emulator-scan-run.json` in this folder.

## Looked at
- `c04-scanner-open-390x844`: portrait phone, sheet open over the landing page; camera view with the QR inside a square saffron frame, one status line, "Enter the code instead" and Cancel. Reads at first look as "point at the big screen".
- `c04-scanner-unrelated-qr-phone-landscape-844x390`: landscape layout (view left, note and buttons right); the red note "That QR code isn't for this room" shows while scanning continues.
- `-phone-portrait-390x844`, `-tv-1920x1080`, `-resized-back`: same sheet at a TV-size window and after resizing back; sheet stays centred, nothing clipped, the page behind keeps its layout.
- `c04-camera-denied-390x844`: no sheet; the typed "AB" is kept in the field and the message "Camera access is blocked, so type the code from the big screen instead" sits under it with the warning icon.
- **Android emulator** (`emulator-scan-landing.jpg`, `emulator-scan-open.jpg`, `emulator-scan-joined.jpg`, `emulator-scan-run.json`): the landing page in Chrome on the emulator in landscape (the Scan button beside the code field); Chrome's own camera prompt ("localhost wants to use your camera", allowed through uiautomator as a player would); and the page after the scan, at `localhost:<port>/j/QRSC` showing the controller's "No room with code QRSC" card (no host is behind that code in this lane; arriving there is the join). In between, the sheet's camera view showed the emulator's virtual room with the QR poster in front of the lens (seen in an earlier run of the lane; the kept `emulator-scan-open.jpg` is the camera prompt in front of the page). The scanner used the browser's `BarcodeDetector` (`barcodeDetector: true` in the run's JSON).

## Defects found and fixed
- The framing box was a 4:3 rectangle, not a square; now a centred square (aspect-ratio 1).
- The old landing test and capture asserted the stub toast; replaced by a no-camera assertion (landing suite 39/39 on eris).
- On the emulator, a screen as short as a phone with its browser bars showing clipped the bottom button of a card ("Scan again" cut off): cards now scroll, and the states journey checks each action is reachable at 640x300.

## Remaining defects
- iOS (Playwright WebKit only) is not run: the iOS Simulator has no camera.
- Scanning the real TV is a P1-Q02 row.
- The fake camera frame is letterboxed (640x480 into the 4:3 view); a real phone camera will fill it differently, not judged.
- The emulator lane turns the virtual-scene camera on for the run and puts QR posters in its room (the AVD's `config.ini` and the emulator's posters file are restored afterwards); the camera never needs to be steered. The scanner only ran the browser's native detector there: the bundled jsQR path is covered in Chromium by `c04-scan.test.mjs`.

## Not covered
- Real phone cameras, low light, glare, a QR shown on a TV at an angle.
- Accepted-mock comparison: the accepted set has no scanner screen; judged against the kit's modal and the landing page only.
