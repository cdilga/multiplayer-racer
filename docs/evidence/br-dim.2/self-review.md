# Self-review br-dim.2 (32-player host: layout glitches until full screen; the rear-view mirror display error)

The TV grid (`art/ui/poc/tv/`). Checked with the new `node art/ui/poc/tv/resize-check.mjs` (Playwright Chromium on a
Mac; `resize-check.json`): for 32 (`#hud&n=32&base=100`, the owner's case) and 100 players with first-person tiles mixed
in, load at one size, change the viewport (1366x768 to 1920x1080 and back, a browser-bar-sized 100 px height change, a
915x412 to 412x915 rotation, full screen on then off) and compare every tile, HUD part, mirror frame and 3D viewport with
a fresh load at the final size: all 10 runs match (188 and 573 rects). Mirror: first-person tiles at 1, 32 and 100 players
on 1920x1080 and 412x915, on and with `&mirror=0`: 12/12 pass. Emulation, not the owner's TV or phone.

## Looked at
- `mirror-1920x1080-n32.jpg`: the owner's case (32 players): seats 6, 13 and 27 in first person; the mirror sits just
  under the number and position pills, inside the tile.
- `mirror-1920x1080-n1.jpg`: one player, full screen: the mirror in its framed strip of sky, far from the labels.
- `mirror-1920x1080-n100.jpg`: 100 players (186x93 tiles): the mirror under the top row, above the boost bar.
- `mirror-412x915-n1.jpg`: phone-portrait host, one player.
- `mirror-412x915-n100.jpg`: phone-portrait host, 100 players (78x39 tiles): the mirror still inside its tile.

## Defects found and fixed
- The mirror's frame used fixed tile fractions (x 0.32-0.68, y 0.04): on small tiles the number/name and position/lap
  pills reach into that strip, so the mirror sat on top of them (the owner's #106). The mirror now drops to just below
  the top HUD row when they would meet; one function places both the frame and its 3D viewport, so they can't drift
  apart (the check compares them).
- The mirror had no off switch in the mock: `&mirror=0` turns the rear view off (no frame, no mirror viewport).
- Layout on viewport changes: only `window` resize was handled, each grid scene left its resize listener behind when you
  moved to another state, and nothing listened to the visual viewport (mobile browser bars), rotation or full screen.
  One handler now covers all of them, re-runs the scale, the world and the live scene's layout once per frame, and once
  more 250 ms later for viewports that finish changing after the event.

## Remaining defects
- None seen. I couldn't reproduce the owner's exact glitch in desktop Chromium (a plain resize already matched a fresh
  load there), so the fix covers the viewport changes Chromium on a desktop doesn't exercise: browser bars, rotation and
  full screen on a real device.

## Not covered
- The owner's TV/laptop browser and phone: the visual-viewport and orientation paths are only exercised by emulation
  here. The owner's playtest on the device is the real check.
