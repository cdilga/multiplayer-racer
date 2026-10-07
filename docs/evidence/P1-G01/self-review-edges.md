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

## Defects seen (outside this bead's owned files, reported)

- After End the Lobby still says "Everyone ready starts the race on its own", but End disarms the all-ready start
  (director `end` sets `armed = false`); only Start race works. Re-arm on End or change the hint.
- The bottom bar's "Host menu" button sits under the sound icon at bottom-left (its first letter is clipped).
- The "Join at 127.0.0.1:..." chip floats over the sky on tile 2 during the race and the countdown.

## Open

- `phone-reload-reconnecting.png` / `phone-reload-host-gone.png` still to capture: the blocked-`end` test needs the
  context-level route (the page-level route doesn't catch the unload's keepalive request, so the room ended and the phone
  showed room-ended instead of reconnecting) in the edited test file, which is not on eris yet.
