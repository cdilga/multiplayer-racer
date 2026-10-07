# P1-C04.style self-review (the scanner sheet against the accepted set)

Captures: `web/tests/journeys/c04-scan.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, software GL, fake camera playing a recorded QR), commit ba8106e. There is no scanner screen in the accepted phone mock: it shows the landing "Scan QR code" button (the landing page's, built in C01) and nothing after the tap. The sheet is therefore judged against the kit it is built from (`web/shared/ui` modal, panel, buttons, paper colour, ink outline, saffron accent) and the mock's "join" card beside it.

## Looked at
- `c04-scanner-open-390x844.jpg`: the sheet over the landing page: "Scan the big screen", a camera view with a square saffron frame, one status line, "Enter the code instead" (the kit's secondary button) and Cancel (the quiet one).
- `c04-scanner-unrelated-qr-phone-landscape-844x390.jpg`, `c04-scanner-unrelated-qr-phone-portrait-390x844.jpg`, `c04-scanner-unrelated-qr-tv-1920x1080.jpg`, `c04-scanner-unrelated-qr-resized-back.jpg`: the same sheet while an unrelated QR is rejected (the status line goes red: "That QR code isn't for this room"), at landscape, portrait, a TV-size window and after resizing back.
- `c04-camera-denied-390x844.jpg`: no sheet; the field keeps what was typed and the warning under it says the camera is blocked.

## Defects found and fixed
- The framing box was a 4:3 rectangle rather than a square: now a square.
- The first landing test and capture still asserted the stub toast: replaced by the no-camera and scanning journeys.

## Remaining defects
- The kit's buttons on the landing page are brushed, but the sheet's two buttons are the kit's plain secondary and quiet ones (the kit modal's own), so the sheet reads slightly flatter than the cards in P1-C03.style.
- The frame is a plain saffron outline, not the mock's brush stroke.

## Not covered
- A real phone camera, an Android emulator scan (P1-F08) and WebKit.
