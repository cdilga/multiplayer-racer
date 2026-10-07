# Self-review P1-M04 (Town), second pass after the fresh-eyes FAIL

Captured with `JJ_HEADLESS=1 node web/host/tests/biome-capture.mjs town` (headless Chromium, software GL): the real host
page (test build, `?test=live&room&res=1&autores=off&recipe=town`, so 1080p is really 1080p), the procgen worker's town track
for seed 2, fake controllers through the real controller path, autopilot cars stepped until the lead car is at point 23-24 of
the town. The capture script chose that point with `mapInfo().pieces`: the stretch with the most houses and shopfronts ahead and a
junction sign in view. The join pill, key/pad drawer, render chip, mute button and HUD strips are hidden for the shot only.
Reference: `art/references/australia/generated/biome-town.png`.

## Looked at
- `street-tv-1080p.jpg` (1920x1080, one player): a left bend of tarmac with cream edge lines; on the left a tan shopfront with
  two dark windows and a blue stripe, a grey-roofed house cut off by the frame edge, a small green mailbox; on the right a
  dark side-street stub and the green "PRINCES HWY / ADELAIDE / MELBOURNE" direction sign with a yellow kangaroo warning sign
  just in front of it (they overlap slightly, and the "380" on the sign is partly hidden); rail and posts on the bend, a water
  tower and about a dozen gum trees on the skyline. The windows are now flat dark panels, not dithered. This is the frame the
  review failed: it now reads as a street with buildings and a junction. It is still sparse: two buildings, no power pole.
- `street-tiles-1080p.jpg` (four tiles, 1080p): the cars start bunched on the grid and are stacked on each other, filling
  the frame; the shopfront, rail and trees are behind them. The cars are the subject here, not the town.
- `street-laptop-1366.jpg` (1366x768, four tiles, no banner now): shopfront, mailbox, side street, and the direction sign is
  readable in the right-hand tiles ("PRINCES HWY, ADELAIDE 380, MELBOURNE 640"); cars bunched again.
- `plot-town.png`, `validator-town.txt`: regenerated with this round's Rust (ten seeds pass the validator; power-line spans
  are tallied and are the only on-road-by-design piece besides the centre line and side streets).
- A fuller town is visible in `../P1-M08b/lap-dirt-to-bitumen-tiles-1080p.jpg` (lower tiles): a row of grey-roofed houses with
  bins and mailboxes along the right, a green sign, and a wooden power pole carrying wires on the horizon; and in
  `../P1-M08b/lap-4-bitumen-tv-1080p.jpg`: a shopfront on each side of the road and a pole on the right edge.
- Against the reference: street, low buildings facing it, mailbox, junction sign, gum trees and water tower are in the hero frame.
  Poles with crossarms and sagging wires and bins by the houses are in the M08b tile frames, not in the hero.

## Fixed this round
- Poles had no crossarm or wires: poles now carry a crossarm, and a new `town/power-line` kit piece (three sagging wires) is
  placed between consecutive same-side poles 8 to 60 m apart (collision off, end-on-pole assertions in `tests/biomes.rs`;
  kit-bounds test green).
- The dithered building texture was z-fighting of windows and signboards with the wall; they stand 6 mm proud now.
- The hero capture was aimed at the first bend; it is aimed at frontage now.

## Remaining defects
- The hero frame has only two buildings and no pole or bin in view; poles with wires show up in the tile frames elsewhere.
- Direction sign and kangaroo sign overlap in the hero frame.
- The house's roof-pitch parameter is data only; houses are boxes under a gable; verandahs are slabs and posts.
- Cars bunch and stack at the start of the autopilot run (the capture is early in the race because the town frontage is there).
- This capture was headless Chromium (software GL) after the headed Chrome I used before; it is not GPU-representative.

## Not covered
- Phones, full-screen toggle, WebKit, and a fresh-eyes review of this second pass by someone other than me.
