# P1-R05 · Fresh-eyes review of the camera captures against the accepted set (2026-10-07)

**Captures:** `first-person-4.jpg` (4 seats, all first person) and `mixed-fp-tp-12.jpg` (12 seats, five in first person), from
`web/host/tests/camera.test.mjs` on the real host build (synthetic cars over the greybox, headless Chromium on software GL, 1920×1080).
**Reference:** the accepted set in `art/ui/accepted/2026-10-07/`: `frames/tv-race-grid.webp` (the painted 4×2 grid, six chase and two
bonnet tiles) and the POC framing data `poc/shared/framing.json`, which the camera profile (`assets/profiles/camera.json`) copies. The
frames are painted style targets, not mocks of the real UI (`frames/README.md`), so this judges framing and orientation, not art.

**Matches the accepted set**
- Third person sits high behind the car, along its heading, with the road ahead: the car is in the lower half at a steady size and the
  road runs to the horizon, as in the accepted chase tiles. The distance is the framing file's `mid` (8.4 m back, 4.4 m up, 58° FOV).
- First person is the accepted bonnet view: the bonnet's front edge and the aerial in the bottom strip, the road filling the tile, with
  the segmented rear-view mirror in the sky strip (`framing.json` `firstPerson.mirror`).
- First- and third-person tiles share one grid (`mixed-fp-tp-12.jpg`), the same as the accepted grid mixes six chase and two bonnet tiles.
- Every tile is aimed at its own car, none shows blank or the wrong car.

**Differs, and why**
- The accepted chase tiles show the car larger (a third of the tile's width at N = 8) with the horizon about 40 % down; here the car is
  smaller (a fifth at N = 8, less at 12) and there is more sky. Cause: the framing values are the POC's own, the painted frames are
  illustrations that crop tighter, and the real car is the smaller low-poly Cruz Missile. Distance is a setting (near and far exist
  and each player can override), so the call is a playtest tuning, not a defect: `near` is one preset away.
- The painted frames' bonnet fills about 15 % of the tile height; ours about 10 %, with the eye at 1.05 m rather than the POC's 0.45 m,
  because the baked bonnet is higher than the POC car's (a 0.45 m eye put 40 % of the tile in bonnet).
- No badges, names, positions, lap pills or boost bars: those are the HUD (P1-R07), drawn over these tiles in the running game. The
  join pill and the resolution note in the corner are the host's own chrome.
- The 4-tile capture's overlay reads "auto-lowered to 75 %" and the 12-tile one "50 %": headless software GL missed the frame budget
  and R111's automatic last resort stepped down. These are framing captures only, not native-resolution evidence.

**First look:** reads as the accepted grid's camera language with plainer, flatter art. **Ambiguous:** none. **Absent by design
(other beads):** the comic look (P1-R10), biome dressing (M04-M07).

Verdict: framing and orientation match the accepted set; the car-size difference is a documented tuning value, not a defect.
