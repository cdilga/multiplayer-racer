# P1-G01 edge variants: visual self-review

Journey: `web/tests/journeys/jn3-edges.test.mjs`, run on eris at 0198173 (Playwright Chromium, host on the GPU with
`JJ_CHROMIUM_GPU=1`, run `g01-edges2`). TV 1280x720; phones 844x390 landscape touch contexts. Force-start and End use two
synthetic controllers (Davo, Shazza); the reload cases use real phones over WebRTC. Captures: `~/Work/runs/g01-edges2/shots/`.

Results at that commit: force-start and End mid-round pass; reload with `end` allowed raced only on a case-sensitive text
match ("THAT ROOM HAS ENDED" is rendered upper-case: the phone did reach room-ended, test now matches case-insensitively);
reload with `end` blocked didn't reach "host gone" (see Open).

## Looked at

- `tv-force-lobby-one-ready.png`: Lobby, "2 in the room · 1 ready", Davo green READY, Shazza "Choosing car…", Start race
  live. Nothing started on its own.
- `tv-force-countdown.png`: after Start race, both cars on the grid in their seat colours under the START · FINISH
  gantry, a big "9": the force-start warning lengthens the countdown past 3. The giant number sits across the seam
  between the two tiles and hides part of the gantry banner and Shazza's left car.
- `tv-force-results.png`: Round 1 complete, Davo 1st +30, Shazza 2nd +23: the not-ready player raced and scored.
- `tv-end-racing.png`: mid-round, both tiles with "1st Lap 1/1" / "2nd Lap 1/1", before End.
- `tv-end-lobby.png`: after End: a new room code is not involved (same room, header "RND A"), both seats back to
  "Choosing car…", "2 in the room · 0 ready", no cars, Start race live.
- `phone-reload-room-ended.png`: the old room's phone after the host page reloaded: "That room has ended · Thanks for
  playing. · Join another room".

## Rerun at 8cf874a (eris run `g01-edges5`, GPU host)

Passed: JN2, force-start, End mid-round, reload with `end` allowed. The blocked-`end` reload test failed: the phone showed
room-ended, because the unload's keepalive request isn't seen by Playwright routes (neither page- nor context-level). The
test now makes the page's own `fetch` refuse `.../rooms/<id>/end` (init script plus an evaluate on the live page); that
version is not yet run.

Looked at again after the UI fixes (round.css):

- `tv-force-countdown.png`: the "9" is about two thirds of its old size and no longer hides the gantry banner or either car
  (it still crosses the seam between the tiles, mid-pop and translucent). The footer reads "Pause · C55X · 127.0.0.1:... ·
  2 racing"; the sound icon sits clear of the button.
- `tv-end-racing.png`: no "Join at" chip over tile 2 any more (the footer carries the code and address); both HUDs clear.
- `tv-end-lobby.png`: "Host menu" is whole beside the sound icon; after End the hint now reads "Start race when
  everyone's ready", which is true of a disarmed room (host-screens lane's change).
- `tv-reload-new-room.png`: the reloaded host page's new room "6RFF", 0 in the room, Start race disabled with
  "Scan to join on your phone, or press a key cluster or pad".

## Defects still seen (not mine to fix here)

- In the fresh room's Lobby the "WELCOME, MATE! SCAN THE CODE..." shout banner overlaps the top of the Diagnostics button
  in the footer (`tv-reload-new-room.png`).

## Open

- `phone-reload-reconnecting.png` and `phone-reload-host-gone.png`: captured by the blocked-`end` test once it passes.
