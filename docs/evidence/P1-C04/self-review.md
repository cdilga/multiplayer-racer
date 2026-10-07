# P1-C04 self-review (in-page QR scanner)

Captures: `web/tests/journeys/c04-scan.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, GPU, run `cap4`, commit b972e04); fake camera plays a recorded QR. Chromium on eris, not a phone: the Android emulator row is not done.
The PNGs are in eris:~/Work/runs/cap4/shots/ (c04-*); not committed here.

## Looked at
- `c04-scanner-open-390x844`: portrait phone, sheet open over the landing page; camera view with the QR inside a square saffron frame, one status line, "Enter the code instead" and Cancel. Reads at first look as "point at the big screen".
- `c04-scanner-unrelated-qr-phone-landscape-844x390`: landscape layout (view left, note and buttons right); the red note "That QR code isn't for this room" shows while scanning continues.
- `-phone-portrait-390x844`, `-tv-1920x1080`, `-resized-back`: same sheet at a TV-size window and after resizing back; sheet stays centred, nothing clipped, the page behind keeps its layout.
- `c04-camera-denied-390x844`: no sheet; the typed "AB" is kept in the field and the message "Camera access is blocked, so type the code from the big screen instead" sits under it with the warning icon.

## Defects found and fixed
- The framing box was a 4:3 rectangle, not a square; now a centred square (aspect-ratio 1).
- The old landing test and capture asserted the stub toast; replaced by a no-camera assertion (landing suite 39/39 on eris).

## Remaining defects
- Android emulator virtual-camera scan and iOS (Playwright WebKit only) are not run (F08 lane).
- Scanning the real TV is a P1-Q02 row.
- The fake camera frame is letterboxed (640x480 into the 4:3 view); a real phone camera will fill it differently, not judged.

## Not covered
- Real phone cameras, low light, glare, a QR shown on a TV at an angle.
- Accepted-mock comparison: the accepted set has no scanner screen; judged against the kit's modal and the landing page only.
