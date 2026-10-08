# P1-R07b self-review: the footer QR opens the big join card

Captured by `web/tests/journeys/r07b-join-card.test.mjs` on eris (Chromium headless, loopback WebRTC, local build of
d7eff97e, run `bc-r07b-5`, both tests pass). Host at 1920x1080, 1366x768, 915x412 and 412x915; display modes TV, Desk,
Handheld and Auto at every size, plus full screen. The race has four synthetic racers, so no spare grid cell holds the QR
and the footer docks it.

## Looked at

- `tv-1920x1080-race-docked-qr.jpg`: the race with the QR docked in the footer (the button the owner pressed).
- `tv-1920x1080-join-big.jpg`: after pressing it. The race is paused. The paper QR card sits on the left, about 550 px
  across, with the room code under it in the display face. Beside it are "Paused: join in", the join URL (it breaks at
  its slashes), "4 in the room", Resume and Host menu. Nothing scrolls, and the footer stays clear.
- `phone-915x412-joined-while-paused.jpg`: the phone that opened the URL decoded from that QR, after it pressed Join while
  the race was paused. It shows "Joining…" (see Remaining defects).
- `tv-1920x1080-join-big-after-phone.jpg`: the card opened again after Resume. It shows "5 in the room".
- `tv-1920x1080-pause-menu.jpg`: the pause menu, with the join card (QR, code, domain) beside "Join in" and the URL above the
  menu actions.
- `join-big-1920x1080-{tv,desk,handheld,auto}.jpg`, `join-big-1366x768-{…}.jpg`, `join-big-915x412-{…}.jpg`,
  `join-big-412x915-{…}.jpg`: every display mode at every size. On wide screens the words and buttons sit beside the QR.
  On the tall 412x915 screen they sit under it. In every capture the card is centred, within the screen and clear of the
  footer, and its QR decodes to the join URL. The test asserts all of this.
- `join-big-fullscreen.jpg`: 1366x768 after the menu's Full screen button. The card is redrawn for the new size.

## Defects found and fixed

- In the first version the footer QR only opened the plain menu: no QR, URL or code (the owner's bug).
- With the title above the QR and the buttons under it, the 1080p TV panel scrolled 68 px and clipped the title (CI run
  1998). The title, words and buttons now share a column beside the QR, and a shrink-to-fit loop takes the QR down a
  module-pixel at a time until the panel fits.
- The code under the big QR was 150 px tall and crowded the panel. It is now capped at 80 px × the profile scale.
- The join URL broke mid-code ("…/j/Y TSR"). It now breaks at its slashes.

## Remaining defects

- A phone that joins while the race is paused holds at "Joining…" until the host presses Resume. The sim applies claims
  at a tick boundary, and no tick runs while paused (`jj-wasm-host` `frame`). It gets its seat and car the moment the
  race resumes, as the journey asserts. Seating it during the pause is a sim change (filed as a follow-up bug).
- At 1080p the pause menu with the join card is taller than the screen, so the player list starts below the fold. The
  panel scrolls, as it did before with long player lists.

## Not covered

- A real TV across a room and a real phone camera scanning it. The QR is decoded from screenshots with `jsqr`.
- WebKit and Firefox hosts. The phone-host sizes were run in Chromium only.
