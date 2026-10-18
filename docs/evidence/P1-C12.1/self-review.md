# P1-C12.1 visual self-review: the drawer's input helper block

Captured 2026-10-18 on eris (Chromium headless, `JJ_CHROMIUM_GPU=1`, ANGLE/Vulkan) by
`web/tests/journeys/c12-1-input-helper.test.mjs` with `JJ_CAPTURE_DIR`, the real host page (`host?drive`) and the real
helper binary (scripted backend; evdev with uinput devices for the last image). Every image below was opened and looked at.

## Looked at

- `helper-not-installed.png` (1366x768): "Input helper" block under the drawer's bar: one line of what it does, **Install
  the input helper** (Linux (x64), this visitor's OS, the only build the test server has), "Run it, then Connect".
- `helper-not-installed-phone.png` (412x915): the same block wraps inside the narrow drawer; no overflow.
- `helper-looking-tv.png` (1920x1080): after Connect with no helper running: "Looking for the input helper on this
  computer. Start it and it connects by itself." with Stop looking, and the install link still there.
- `helper-pairing-wrong-code.png` (1366x768): "Input helper found. Type the code its window shows:" six-digit field,
  Pair, and "wrong code" in the danger colour after a wrong code.
- `helper-connected-devices.png` (1366x768): "Connected: 2 keyboards and 6 pads, each its own player. Every keyboard
  plays W A S D, T / G, Q and E." with Disconnect and the device list; the rows below list Keyboard 1/2 and Pad 1-6 as
  their own sources; Keys A/B/C read "the input helper has these".
- `helper-keyboard-unplugged.png` (1366x768): during the race, keyboard 2 unplugged: the block says 1 keyboard and lists
  "Keyboard right: unplugged"; its row offers Remove (as an unplugged pad does); keyboard 1 still playing with Sit out /
  Leave; the car view behind is the playing seat's.
- `helper-connected-phone.png` (412x915): paired with three long-named devices: names wrap, no overflow.
- `helper-real-evdev-seven.png` (1366x768): the real Linux backend with two virtual keyboards and five virtual pads:
  "7 playing" in the head, seven rows playing, the grid of car tiles behind.

## Defects found and fixed

- Browser clusters standing down still said "· press W to join" after "the input helper has these" (contradictory):
  the hint now shows only for a cluster that plays.
- Helper pads offered "Map as a wheel", which can't work (wheel calibration reads the Gamepad API): hidden for helper
  pads and for browser pads standing down.
- An unplugged helper keyboard kept Sit out / Leave like a key cluster; it's a device now, so it gets Remove like an
  unplugged pad.
- The pairing field clipped the sixth digit ("00000(") at 7ch with letter spacing: widened to 9ch.
- "Install the input helper Linux (x64)" read as one phrase: the OS is now in brackets.

## Remaining defects

- The device names show twice when paired (the helper's list and the source rows). Kept: the block is the helper's own
  state (what it has opened), the rows are seats; the rows' names will go when the designed drawer (R07) replaces this
  plain one.
- On the 412-wide phone host the drawer itself is narrow (an existing drawer size, not this block's); the block wraps
  cleanly within it.

## Not covered

- The drawer inside the room's Host menu → Controllers panel (the same block; journeys there are c12/c14's).
- Real Windows and macOS windows of the helper itself (console window with the pairing code, Gatekeeper/SmartScreen,
  Input Monitoring prompt): owner rows in docs/playtests/owner-checklists.md §3.
- Chrome's local-network permission prompt on the public preview (loopback test pages don't trigger it): owner row.
