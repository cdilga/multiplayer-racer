# P1-A06c self-review

## Looked at
All in `docs/evidence/P1-A06c/captures/`:
- `poc_phone_index_html_race_stick_offcourse_412x915.png`, `poc_phone_index_html_race_stick_offcourse_915x412.png`: the new out-of-bounds banner, "Out past whoop whoop / Drive back onto the track."
- `poc_phone_index_html_game_ended_412x915.png`, `poc_phone_index_html_game_ended_915x412.png`: "Cheers for playing! You finished 3rd."
- `poc_phone_index_html_join_412x915.png`, `poc_phone_index_html_join_915x412.png`: heading changed "Join a game" to "Join a room" (R112).
- `landing-412x915.png`, `landing-915x412.png`: pitch now ends "Perfect for an arvo with the blokes and sheilas."

## Defects found and fixed
- The phone join screen said "Join a game"; the room/round rule (R112) forbids "game". Now "Join a room".
- The cue loader refused "walkabout" as an Indigenous term, against R114; removed from that rule and the left-out table updated.

## Remaining defects
- In portrait the out-of-bounds banner sits beside the POC's Mock button (POC chrome, not shipped); it covers no HUD or stick content.
- Landing landscape hides the car image as before (existing layout, not from this change).
- The 9 new cue rows have no clip yet (see receipt).
- Signs pass the grammar and layout tests but were not rendered to an image here; `web/host/tests/signs-capture.mjs` does not list the new signs.

## Not covered
TV and host copy (see `tv-copy-todo.md`); WebKit and real phones; listening to audio.
