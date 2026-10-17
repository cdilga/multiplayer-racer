# P1-G06: derby rounds end to end, and the lobby's mode choice

**What was built.**

- **Host round loop** (`crates/jj-wasm-host/src/host/round.rs`):
  - The next round's mode, Race or Derby, is set by `mode:derby` / `mode:race` (UiCommand SetMode, ABI 8).
  - A derby round's Countdown builds an arena for everyone in the room: main's procgen worker runs `prepareArena`, or the host does when nothing prepares maps.
  - GO starts the sim's derby.
  - The director's game clock (`GameElapsed`) ends the round at the host's derby length.
  - Results commit from the ledger (P1-S10): raw points, ties sharing, no times.
- **Host settings:** derby length (`derby-ms:N`) and Intermission length (`intermission-ms:N`) are set the same way, from the next round.
- **Race rules page** (Host menu): Next round (Race/Derby), Laps, Derby length and Between rounds.
- **Lobby:** a Race/Derby pair above Start, and Start reads "Start derby" when Derby is chosen.
- **Remembered:** every rule is kept on this host device (`web/host/src/round/rules.ts`) and re-applied in the next room.
- **TV and phone:** TV tiles show rank, raw points and the derby clock; phones show rank, points and time left (Hud.derby, P1-S10).

**Checks.**

- **Host test** `a_derby_round_runs_to_results_on_game_time_and_the_next_starts_on_its_own`: a derby round in an arena, a ram that scores, results at the limit, the next derby starting on its own, then Race again.
- **Journey** `web/tests/journeys/g06-derby.test.mjs` (JN8 + JN9), on eris in Chromium at 0779fd3f, 2/2 and 4/4 before that. Six controllers (five synthetic, one real phone over WebRTC) play a derby in the bowl:
  - rams score raw points;
  - a late joiner drops in mid-derby and scores;
  - no car leaves the bowl;
  - round 1's results rank by raw points, with the late joiner in them and no times;
  - after the Intermission the next round starts on its own, as a Race because the host switched it.
- **Unchanged layouts:** the lobby and round-loop journeys (owner-lobby-settings, both engines; jn3-round-loop) pass with the new lobby.

## Looked at

- `tv-lobby-derby-1920x1080.jpg`: the Race/Derby pair under the QR with Derby lit, "Start derby", and the hint "Everyone ready starts the derby on its own · 40 s in the bowl, most damage dealt wins".
- `tv-derby-running-1920x1080.jpg`: seven tiles in the bowl.
  - Each pill is a rank and raw points ("1st 170.1 pts", "6th 55.8 pts"), and each status reads "0:28 left".
  - The late joiner #7 has its own tile. The join card and the players panel fill the last cells.
- `phone-derby-hud-844x390.jpg`: the real phone's strip reads "6th" with "56 pts · 0:26" under it.
- `tv-derby-results-1920x1080.jpg`: "Derby 1 complete — Most damage dealt wins · everyone keeps their number".
  - Seven rows ranked by raw points, with the championship table's points (+25, +18, +15, …).
  - No times. Late Lenny is second.
- `race-rules-1920x1080.jpg`, `race-rules-412x915.jpg`: Next round, Laps, Derby length and Between rounds, the chosen ones lit, "They apply from the next round", then Catch-up. On a phone-sized host they wrap to two columns.

## Defects found and fixed

- **Lobby toggle stuck on Race.** The lobby didn't redraw when the mode changed: the mode, derby length and laps weren't in its render key.
- **Toggle too big.** The Race/Derby pair was two more big buttons (three stacked); it's now a small pair above Start.
- **Hint rounding.** "1 min" for a 40 s round; the hint now names seconds under a minute.
- **Wrong strap.** Derby results said "Rematch on the same track".
- **Results tested too late.** The journey checked round 2's results (everyone tied on nothing) instead of round 1's.
- **Late-joiner flake.** The late joiner rammed a car under spawn protection and scored nothing (2/3); it now rams until a hit counts.

## Remaining defects

- The results' countdown still says "Next race in 11 s" after a derby, and before one.
- Bots on autopilot in a derby drive the bowl's ring rather than hunting other cars. A derby-hunting autopilot is part of
  br-bbki.11 (the carnage bowl).
- The 8-car arena's start grid packs the cars on one side (P1-M10's self-review).
- The players panel lists seats in race order, not derby rank.

## Not covered

- More than one real phone; WebKit for the derby journey; a real TV. The overview camera switch (P1-R11) is its own bead.
