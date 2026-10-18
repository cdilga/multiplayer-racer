# P1-A06c self-review

## Looked at
All in `docs/evidence/P1-A06c/captures/`:
- `captures/poc_phone_index_html_race_stick_offcourse_412x915.png`, `captures/poc_phone_index_html_race_stick_offcourse_915x412.png`: the new out-of-bounds banner, "Out past whoop whoop / Drive back onto the track."
- `captures/poc_phone_index_html_game_ended_412x915.png`, `captures/poc_phone_index_html_game_ended_915x412.png`: "Cheers for playing! You finished 3rd."
- `captures/poc_phone_index_html_join_412x915.png`, `captures/poc_phone_index_html_join_915x412.png`: heading changed "Join a game" to "Join a room" (R112).
- `captures/landing-412x915.png`, `captures/landing-915x412.png`: pitch now ends "Perfect for an arvo with the blokes and sheilas."

- `tv-oob-banner-1920x1080.jpg` (2026-10-18, the 0.2 host on eris, Chromium with GPU, two seats, Davo thrown off the
  course): Davo's tile reads "OUT PAST WHOOP WHOOP!" over "Back onto the track in 1 s" while the car waits on the line
  to respawn. Shaz's tile is untouched, and the announcer caption says "That car's gone walkabout! Back onto the track,
  mate." (cue `off-course-2`).
- `tv-results-cheers-1920x1080.jpg`: Round complete, with "CHEERS FOR RACING!" above "Vote opens in 7 s". The replay,
  placings, QR, vote, keep row and buttons all sit where they were.

## Defects found and fixed
- The phone join screen said "Join a game"; the room/round rule (R112) forbids "game". Now "Join a room".
- The cue loader refused "walkabout" as an Indigenous term, against R114; removed from that rule and the left-out table updated.

- (2026-10-18) **The tile's wreck banner was never fed**: the room view didn't send `wreckMs`, so a wrecked car showed
  nothing. The host now sends the respawn hold's time left and why (`wreckMs`, `wreckWhy`, from the wreck that started
  the hold). The tile reads "Out past whoop whoop! / Back onto the track in N s" for out of bounds, "Wrecked! / Back in
  N s" for a flip or a lost wheel, and "Back on the road" for a Recover. Tested in jj-wasm-host
  `the_room_view_carries_a_wrecked_seats_hold_and_its_cause`.
- (2026-10-18) **Thank-you hidden by the replay**: "Cheers for racing!" in the header strip was hidden whenever a replay
  plays (`.has-replay .rs-head .strip`). It sits above the vote now ("Cheers for the carnage!" after a derby).

## Remaining defects
- In portrait the out-of-bounds banner sits beside the POC's Mock button (POC chrome, not shipped); it covers no HUD or stick content.
- Landing landscape hides the car image as before (existing layout, not from this change).
- (Fixed since: the 9 new cue clips are in `assets/audio/voice/`, e.g. `off-course-1..4`, `welcome-4`, `winner-4`.)
- The highlight reel still titles an out-of-bounds wreck "Wrecked!" (the reel doesn't know the cause).
- The round-screens capture matrix (`captures:`, skipped in CI) timed out on eris waiting for a 99-car HUD while the
  machine was loaded; the 16 layout tests (lobby and results at N = 1-99, 1080p, 21:9, phone) passed.
- Signs pass the grammar and layout tests but were not rendered to an image here; `web/host/tests/signs-capture.mjs` does not list the new signs.

## Not covered
WebKit and real phones; listening to audio; the lobby's blokes-and-sheilas caption (left to the welcome cue).
TV and host copy from `tv-copy-todo.md` landed in the 0.2 host on 2026-10-18 (copy doc updated).
