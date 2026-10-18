# Self-review P1-C10

Captured by `web/tests/journeys/c10-practice.test.mjs` (Playwright Chromium 151 headless, GPU, eris), converted to webp.
Every image below was opened and looked at.

## Looked at

- `captures/tv-practice-tile-1280x720.webp`: TV 1280x720, four racers + the newcomer's tile on the practice course (greybox
  start gantry, its own road and plain), the C06 prompt "1/5 Steer", the teal "Practice · own course" pill; footer standings
  list only the four racers.
- `captures/tv-practice-prompt-go-1280x720.webp`: the prompt ticked on to "2/5 Go and stop" after steering.
- `captures/tv-practice-driving-1280x720.webp`: practice car driving its course with the course's cones/bins; racers' tiles
  unaffected.
- `captures/tv-joined-at-tail-1280x720.webp`: after Join the race, the tile follows the round car, "5th Lap 1/99", the pill
  back to place/lap; footer standings now five.
- `captures/tv-practice-tile-phone-landscape-915x412-1920x1080.webp`, `captures/tv-practice-tile-phone-portrait-412x915-1920x1080.webp`,
  `captures/tv-practice-tile-phone-small-375x667-1920x1080.webp`: TV 1920x1080 with 6-8 tiles, the practising phone's tile on its course with prompts,
  others racing; footer "6 racing · 1 practising · round 1".
- `captures/tv-practice-shadows-1280x720.webp`, `captures/tv-practice-shadows-1920x1080.webp`: follow-up run with the practice
  tile's own shadow pass: the practice car casts its sun shadow on its course, and the round's tiles keep theirs.
- `captures/tv-practice-tile-resized-1366x768.webp`: the TV resized to 1366x768 while practising: tiles reflow, the practice
  tile keeps its course, prompt and pill.
- `captures/phone-join-card-practise-first-landscape-915x412.webp`, `captures/phone-join-card-practise-first-portrait-412x915.webp`, `captures/phone-join-card-practise-first-small-375x667.webp`: the join
  card while a round runs: Join the race stays the big primary button; Practise first beside it (landscape) or under it with
  "A race is on. Join it at the back now, or practise first on your own course." (portrait).
- `captures/phone-practising-landscape-915x412.webp`, `captures/phone-practising-portrait-412x915.webp`, `captures/phone-practising-small-375x667.webp`: the play screen while
  practising: sticks free, the practice bar (tag, one line, Join the race) in the column between the sticks (landscape) or at
  the bottom (portrait; on the small phone just the tag and the button).
- `captures/phone-practising-turned-landscape-915x412.webp`, `captures/phone-practising-turned-portrait-412x915.webp`, `captures/phone-practising-turned-small-375x667.webp`: the same phone turned the other way while practising (the play screen is rebuilt):
  the bar comes back in the right place, and above the "Back to full screen" prompt when that shows.
- `captures/phone-practising-fullscreen-landscape-915x412.webp`, `captures/phone-practising-fullscreen-portrait-412x915.webp`, `captures/phone-practising-fullscreen-small-375x667.webp`: after the full-screen tool while practising (headless: see Not covered).
- `captures/phone-joined-landscape-915x412.webp`, `captures/phone-joined-portrait-412x915.webp`, `captures/phone-joined-small-375x667.webp`: after Join the race: the normal racing screen, place and lap in the strip, no bar.
- `captures/phone-help-practice-landscape-915x412.webp`, `captures/phone-help-practice-portrait-412x915.webp`, `captures/phone-help-practice-small-375x667.webp`: Help while racing: the tutorial card's top row now has Practice beside Controls,
  Identify and Skip tutorial.

## Defects found and fixed

1. TV: the "Practice" chip sat in the tile's bottom status row, under the announcer's caption strip (run 1). Moved it to the
   tile's top-right pill ("Practice · own course", teal) where place and lap usually are.
2. Phone landscape 844x390 join card: Practise first fell below the fold behind the pad tray (run 1). Short landscape now
   puts Join the race and Practise first side by side and drops the icon.
3. Phone practice bar sat on the "#N This device" tray (run 1), then under the "Back to full screen" prompt, which took its
   Join the race click (run 5, found by the journey). The single-device tray steps aside while practising (as for the
   tutorial card, br-nbn2) and the bar rises above the full-screen prompt.
4. Landscape bar covered the inner bottoms of both stick zones (run 2): it now stands in the column between the sticks.
5. Small 375x667 bar overlapped the sticks' rings: the line is dropped there (tag and button only).
6. TV footer counted the practising seat as racing ("7 racing"): now "6 racing · 1 practising".
7. Not visual but found by the native test: Join the race after two seconds of no practice input started the round car on
   the autopilot (a stale sample read as a dropout). Fixed (fresh input state on joining).

8. Follow-up (coordinator): the practice course had no sun shadows; practice tiles now get their own shadow pass. The results
   reel recorded practice cars; it no longer does (`reel-recorder.test.mjs`, the c10 journey's reel check).

## Remaining defects

- A practice car's detached parts aren't drawn (the practice trailer carries its props and cones, not part records).

## Not covered

- Real phones, WebKit/Safari: not run (Chromium emulation only).
- Real full screen: headless Chromium doesn't enter it, so the full-screen captures show the "Back to full screen" prompt
  state rather than true full screen.
- The live preview: not deployed from this session (the deploy worker publishes from CI); captures are from the local build.
- Host pads and key clusters can't choose Practice (no drawer action yet); phones and hub sources can.
- Many practisers at once was exercised natively only (one world per seat, no cap); the browser runs had one at a time.
