# Self-review P1-W05 (weapons end to end, first slice: W04 stations, W02a boomerang, phone item chip)

MacBookPro18,3, local real jj-server, Chromium (Playwright headless) at 1280x720 (TV) and an emulated touch phone at
844x390 and 390x844, from `web/tests/journeys/w05-weapons.test.mjs`. Browser emulation, not a physical phone or the TCL.

## Looked at

- `race-stations.png`: a generated track with a row of three cardboard station boxes across the road ahead, hovering
  over the road; nothing else on the road.
- `picked-up.png`: the same race after a car drove through a station and was handed its box.
- `boomerang-in-flight.png`: the thrower's tile just after a forward flick; the renderer reports one boomerang instance
  drawn (the journey asserts it). The boomerang is small at this distance in this frame.
- `phone-item-844x390.png`, `phone-item-390x844.png`: the phone's item chip under the connection badge, "BOOMERANG +1 /
  FLICK ↑ THROW · ↓ BACK", readable, no overlap in landscape or portrait.

## Defects found and fixed

- The boomerang was invisible on the TV: 0.8 m across, then 1.4 m. Now about 2.4 m tip to tip (cartoon-sized).
- The TV showed stale ticks after a burst of simulation (a hitch, or a test stepping the sim): the playback clock from
  br-gw74.14 only snapped after 60 ticks. It now snaps after 8 (about 67 ms), with a unit test.
- Stations crashed the map renderer (no kit module): they have a module and are drawn from the snapshot (ready with the
  item printed on the box, or a flat pad while recharging).
- A station's collider was larger than its box (kit bounds test): now 1.3 m, the box's size.

## Remaining defects

- At chase-camera distance the boomerang is still a small object; a trail and the comic hit word (R12) are not done.
- The TV doesn't show what each player holds; only the phone does.
- No derby-bowl stations yet, and the greybox has no authored stations (the sim test adds one in code).

## Not covered

- A physical phone and the TV, WebKit, and full screen; hits on other cars on a real track (the sim bank covers hits).
