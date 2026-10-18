# P1-G-between (br-qw28, R125): between rounds, the vote for the next track and the TV's flyover

**What was built.**

- **Host round loop** (`crates/jj-wasm-host/src/host/between.rs`; timing data in `assets/profiles/rounds.json`):
  - The results hold for 10 s (the host's "Results on screen" setting: 10, 30 or 60 s), then the phones vote for 10 s.
  - The choices are Rematch (the same seed), New track (the next seed, the same recipe) and Surprise me (main draws one
    to four biomes from the seed).
  - The most votes win; a tie, or no votes, is a Rematch. The host can choose instead, and tapping its pick again goes
    back to the vote.
  - Before the countdown the TV flies the new track for 6 s, with the director's clock held. A map that arrives while
    the director is Preparing waits for the flyover.
  - Any press skips the flyover (Ready, an action, the host's Skip or Start). Cars can still be changed until it ends,
    because the grid is built at the countdown.
- **Protocol:**
  - `ControllerCmd::Vote` and `HostCmd::Between` (CMD 6).
  - `UiCommand::SetNextTrack`, and `PrepareRequested.surprise` (ABI 9).
  - Goldens re-blessed.
- **TV** (`round/screens.ts`):
  - The results screen's vote panel has three cards with their tallies. The card that will win is lit: the result,
    else the host's pick, else the leader.
  - The seconds count down between room updates. The panel is built once, so a tap never lands on a redrawn card.
  - The flyover screen has a caption ("Next: New track", "Any button skips · you can still change car") and Skip.
  - The world's flyover camera (`camera/flyover.ts`) follows the route from the start line round to the finish, eased.
- **Phone** (`controller/src/app/view.ts`):
  - A vote panel with three buttons and the tally. Your own vote is lit and the seconds count down.
  - During the flyover the panel shows "watch the TV" and "Skip the flyover", low on the screen. The Change car button
    stays usable above it.

**Checks.**

- Host test `phones_vote_the_next_track_ties_are_a_rematch_the_host_overrides_and_a_flyover_precedes_the_countdown`, plus
  the tally unit test. jj-wasm-host passes 56 of 56 through RCH, and the jj-protocol goldens pass.
- Journey `web/tests/journeys/g-between-rounds.test.mjs`: three real phones over WebRTC, generated tracks, three rounds. It
  is on the gpu.yml list.
  - Passed on eris in Chromium with the GPU (ANGLE/Vulkan) three times in a row.
  - Passed twice on SwiftShader, where the flyover's frame-by-frame path is only measured on the GPU runner.
- **Round 1:** New track 2, Rematch 1, so New track wins. The TV and each phone show the tally. The flyover runs out on
  its own: the route fraction goes from under 0.05 to over 0.95, only forwards, in 4.5 to 7.5 s.
- **Round 2:** Rematch 1, New track 1 is a tie, so Rematch, on round 2's own seed. A phone's Skip ends the flyover within
  4 s of game time.
- **Round 3:** the host picks Surprise me and the phones vote Rematch. Surprise wins, and main's record shows the drawn style.

## Looked at

- `tv-vote-1920x1080.jpg`: "Vote on your phone · 8 s". Rematch 1, New track 2 (lit), Surprise me 0. "Most votes wins · a
  tie is a Rematch · host: tap to choose". The strap reads "Vote for the next track · everyone keeps their number".
- `phone-vote-844x390.jpg`: "Next track? 8 s", three buttons with the tally, and Davo's New track lit, over the sticks.
- `tv-flyover-1920x1080.jpg`: the new track from above and behind the start, with the road, chevrons and town ahead.
  "NEXT: NEW TRACK", the skip hint and Skip are at the top. No cars from the last round sit on the new track.
- `phone-flyover-844x390.jpg`: "Next: New track · watch the TV" and "Skip the flyover", low on the screen. "Cruz Missile ·
  Change car · Car 1 of 6" is clear above it.
- `tv-vote-host-pick-1920x1080.jpg`: Rematch 3, but Surprise me carries the host's blue ring and is lit, with "Host's
  pick · Surprise me (tap again for the vote)".

## Defects found and fixed

- **Wrong strap:** the results strap still said "Rematch on the same track". It now says "Vote for the next track".
- **Wrong card lit:** the lit card followed the vote's leader even when the host had picked. It now follows the result,
  else the host's pick, else the leader.
- **TV seconds frozen:** the countdown only changed when the room did. It now counts down on the TV between updates.
- **Taps lost to redraws:** both vote panels were rebuilt every tick of their seconds, so a tap could land on a button
  that had just been replaced. A busy runner showed it. Both are now built once per state and update in place.
- **Change car hidden:** during the flyover the phone's panel covered the Change car button. It now sits low.

## Remaining defects

- The flyover is one route-following camera. It doesn't call out set pieces or the finish.
- Surprise me varies only the biome mix. Length and character presets aren't drawable yet (br-xlvx.2 and br-xlvx.7).
- The results in these captures read "DNF" for everyone, because the journey ends each race on demand.

## Not covered

- A real TV and real phones: these are Playwright Chromium pages on eris.
- WebKit.
- A derby between rounds (the vote applies there too, with Rematch preparing the same arena seed); it has no journey of
  its own.
