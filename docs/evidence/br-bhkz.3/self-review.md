# Self-review br-bhkz.3: the derby's weapons (roo bar, bunger, magpie) as they look

Owner, 2026-11-17: "we didn't have anywhere near enough weapons for the derby".

Captured with `web/tests/journeys/derby-fun-capture.mjs` on 2026-11-17 from a local build of the working tree (commit
16624885 plus the tinnie print fix), served by `jj-server`, in Playwright Chromium 151 on an Apple Silicon Mac
(`JJ_CHROMIUM_GPU=native`, Metal). The close-ups are the host's own canvas from `__jjRender.peek`, with the HUD hidden;
the TV stills are the whole page at 1920x1080 (stored at 1440 wide). Every car is on the autopilot (the clock is held).

## Looked at

- `roo-bar-close-up.jpg`: the canvas, a fitted roo bar from the front quarter. Three pale rails on two posts with two
  spot lamps, square on the Cruz's nose, sitting on the bumper and clear of the headlights; it reads as a bull bar.
- `tv-1920x1080-grid-roo-bar.jpg`: TV Grid a moment after the bar is fitted. From its own chase camera the bar is behind
  the car and unseen; the wearer's phone says so instead (next line).
- `phone-915x412-roo-bar.jpg`: the wearer's phone: `ROO BAR! 10.0S` counting down in the strip, pale grey so it is not
  mistaken for the tank-up's yellow.
- `bunger-close-up.jpg`: the canvas, a lit bunger in the air: a red firecracker with two yellow bands, a fuse and
  sparks coming off it. About a metre tall, readable against the red floor by its bands and sparks.
- `bunger-blast-from-above.jpg`: the canvas from 20 m up as it goes off: a comic star at the middle and a ring of
  puffs at the blast's 9 m radius; the roo-bar car beside it and a magpie in flight with its shadow under it.
- `tv-1920x1080-grid-bunger-blast.jpg`: TV Grid as it goes off: the ring and star show in the two tiles that face it.
- `magpie-close-up.jpg`: the canvas, a magpie in flight from behind and above: black body, white nape and wing bars,
  grey beak. Reads as a black and white bird; from above (previous still) the wings and white bars are clearer.
- `boxes-close-up.jpg`, `boxes-wide.jpg`: the canvas, the derby's boxes: the bunger print (a red firecracker with its
  fuse), the esky, and the tinnie's blue can (see the fix below). The roo bar's rails and the magpie's print are in
  `roo-bar-close-up.jpg`'s background row of boxes.

## Defects found and fixed

- The first close-ups were taken from inside a car and with the HUD across them: the capture now hides the DOM for a
  peek and moves the car to a clear stretch of the rim first.
- A fitted roo bar was first written to the snapshot at the car's newest pose while the car is drawn interpolated, so
  the bar would lead its car between snapshots. Its record now names the car and the nose's offset, and the renderer
  draws it on that car's own interpolated pose.
- The tinnie's box was blank on every side (an existing bug: the can's print was flattened after it was moved out to
  the face, which put it inside the box). Fixed; `boxes-wide.jpg` shows three tinnie boxes with their blue cans.
- The magpie and the bunger each landed too hard for a round with this many of them (9 wrecks a minute among 7 bots):
  the magpie's peck is 20 HP (was 30) and the bunger's blast 30 at the middle (was 40): 6 wrecks a minute.

## Remaining defects

- The wearer cannot see their own roo bar from the chase camera (it is on the nose). The phone's timer and the other
  players' tiles show it.
- The magpie does not flap: one fixed pose.
- The tinnie's print is a thin blue bar rather than a can with a silver top (it is small on the box at any distance).
- None of the three has a sound, an announcer line or a TV comic callout: item sounds are P1-A06's, not played for any
  item yet.

## Not covered

- A person aiming a bunger or shaking a magpie: bots only. Whether the magpie is fair (20 of 20 pecks landed on bots
  in a minute) is a playtest question; its turn rate (`TURN_RAD_S`) is the number to move.
- The weapons in a race (they are in the race pool too): fixtures only, no race capture.
- The stills are a local build. The same capture ran against the published preview `v02-16624885` and passed with no
  page errors (24 bungers and 27 magpies used in its round); the tinnie print fix is not in a published preview yet.
- A real phone, Safari or WebKit.
- A bike wearing a roo bar (the bar is 1.8 m wide whatever the vehicle).
