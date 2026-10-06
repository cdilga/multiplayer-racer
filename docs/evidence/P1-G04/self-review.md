# P1-G04 visual self-review (free drive)

Captured by `JJ_CAPTURE_DIR=<dir> node --test web/tests/journeys/` (JN1) on eris (Linux, headless Chromium with
SwiftShader GL, loopback WebRTC through the real `jj-server`), commit a331351 and its predecessors; Chromium only
(not WebKit, not a device). The host runs `B/host?drive&test=live`; phones are mobile touch contexts.

## Looked at

- `tv-1280x720-three-seats.png`: three tiles (two phones + Keys A), each chasing its own car on the greybox.
- `tv-1280x720-four-seats.png`: phone C joined mid-drive: four equal tiles, the paper QR card bottom right.
- `tv-1920x1080-four-seats-resized.png`: the TV after a resize to 1080p: the grid reflows, tiles stay equal.
- `phone-join-card-Davo.png`, `phone-join-card-Shazza.png`, `phone-join-card-Robbo.png`: the join card (room code,
  prefilled name, Join the race).
- `phone-landscape-844x390-driving.png`: #1 Davo in the seat's red: strip, tools, DRIVE/ACTION sticks, boost pod top
  centre between the sticks.
- `phone-landscape-844x390-identify.png`: #2 Shazza, boost meter full from the host's HUD.
- `phone-landscape-844x390-identify-flash.png`: Identify's "Cooee #2" flash in the seat's blue.
- `phone-portrait-390x844-turn-sideways.png`: the R101 "Turn sideways" card upright, with "Play upright anyway".
- `phone-portrait-390x844-playing.png`: #4 Robbo upright: tools on their own row under the strip, pod above the sticks.

## Defects found and fixed

- The paper QR wasn't on the TV at all with one tile (the grid gave only a join chip): free drive now always shows the
  kit's paper QR card with the room code (`web/host/src/main.ts`), and JN1 decodes it.
- The QR card covered too much of the bottom-right tile at 160 px: down to 112 px.
- The boost meter sat along the bottom of the phone instead of the POC's pod: the pod now sits between the sticks in
  landscape and in a row above them in portrait (`web/controller/src/app/view.ts`).
- Upright, the name was squeezed to "R." because the tools shared the strip: in portrait the tools get their own row.
- No portrait prompt (R101): added the once-a-visit "Turn sideways" card.
- The HUD never arrived (the host sent none): the host now sends each phone its boost meter and pause state at 10 Hz;
  JN1 waits for it.

## Remaining defects

- Car paint doesn't match the seat's identity colour (phone #1 is red, its car isn't): the identity kit is P1-R06.
- The host's input drawer (Keys A/B help) overlaps the top-left tile in free drive; it's a dev/test mode (R110), and
  the lobby's layout (R07) decides where host-input help lives.
- The "Join at" chip and the QR card both show join details in free drive (the grid's chip plus the drive card).
- The phone screens are the accepted POC styling ported (C02.style); the join card is plain and the strip has no
  position/lap outside a race (no race until G01).

## Not covered

- WebKit / iOS Safari and real phones (the F08 emulator lane and P1-Q02 cover them), real 4K TV, gamepads beyond the
  Keys A cluster, fullscreen on a real phone, a reduced-motion capture of the identify flash.
