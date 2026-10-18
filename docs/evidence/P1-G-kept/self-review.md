# P1-G-kept (br-m1xe, R125): keep a good track, its share code, and best laps per car

The ghost lap was dropped by the owner (R134: ghosts don't fit procgen).

**What was built.**

- **Share codes** (`crates/jj-wasm-procgen/src/share.rs`):
  - A generated track is its generator version, seed and recipe. The code carries all three in Crockford base32 groups
    after a `T<version>` lead, with a check character, e.g. `T29-08-Z`.
  - It reads back however it's typed: any case, spaces or dashes, and O/I read as 0/1.
  - A typo is refused as a typo, and a code from another generator version names both versions.
  - The procgen worker makes and reads codes (`trackCode`, `readTrackCode`).
- **Kept tracks** (`web/host/src/round/favourites.ts`):
  - Round complete has "Keep this track" with the track's code. The list lives on this host and has no limit.
  - The host menu's new Tracks page lists them, with "Race next", Forget and "Back to new tracks".
  - It also adds another host's code, refusing a typo or another version with the reason.
  - The lobby says "Next track: kept T29-08-Z".
  - A track built with a tuned generator (the owner tuning menu) is kept on this host without a code, because it
    can't be rebuilt elsewhere.
- **Next round on a kept track:** `UiCommand::SetFavourite` (ABI 10) makes the next preparation ask main for exactly that
  seed and recipe. `PrepareRequested.recipe` carries it, and a preparation already made is superseded. A Rematch of a
  kept track keeps its recipe too.
- **Best laps** per track and per car:
  - The host times each seat's laps (`lapMs` in the room view, from GO and then lap to lap).
  - Round complete counts the round's laps in once and shows "Best laps here" per car.
  - The table lives on this host.

**Checks.**

- **jj-wasm-procgen `share` tests (via RCH):**
  - Codes round-trip for seeds 0 to u64::MAX with 0 to 4 biomes.
  - A typo and another generator version are refused, and the message names the versions.
  - **A kept track regenerates byte-identical from its code**: the default-mix and explicit-recipe seeds were prepared,
    encoded, decoded and prepared again, and the canonical bytes are equal.
- **Host test** `a_kept_track_is_prepared_by_its_seed_and_recipe_and_a_rematch_keeps_its_recipe`: the Lobby pick asks main
  for seed 777000 with "rocks,town", and the Rematch asks for the same again. jj-wasm-host passes 57 of 57.
- **Journey** `web/tests/journeys/g-kept-tracks.test.mjs`, on eris in Chromium with the GPU, real jj-server, generated
  tracks:
  - one autopilot lap is timed;
  - the code shows and is kept on this host;
  - Return to lobby, then the Tracks page refuses a mistyped code ("that code has a typo in it");
  - "Race next" on the kept track, and the lobby says so;
  - the next race has the same seed and recipe, and the same route point for point.
- Protocol goldens are re-blessed (ABI 10).

## Looked at

- `tv-results-kept-1920x1080.jpg`: under the vote, "Kept ✓" sits beside the code `T29-08-Z`, with "Best laps here: Cruz
  Missile 1:59.88 Racer 2" below. The results list and the vote are unchanged.
- `tv-tracks-page-1920x1080.jpg`: "Kept tracks" lists `T29-08-Z`, kept on 10/18/2026, with "Racing next" lit and Forget.
  Under it are "Back to new tracks", "Add a track code" (the field and Add), the note "T29-08-Z is the next round's
  track" and Back.
- `tv-lobby-kept-next-1920x1080.jpg`: the lobby with two racers. "Next track: kept T29-08-Z" is in blue under "Start the
  race when everyone's ready · 1 lap".

## Defects found and fixed

- **Picked track cleared at once:** a pick in the Lobby showed nothing, because the next preparation took it straight
  away. It's now kept until the countdown commits it, so the lobby and the Tracks page show it.
- **Page didn't redraw:** the Tracks page didn't redraw when the pick landed, still reading "Race next". The chosen
  track is now part of the menu's redraw key, and the lobby's too.
- **Keep row badly laid out:** Keep stretched and the code wrapped over two lines. Both are compact now.
- **Best laps empty:** a seat that never picked a car had no car to file its lap under. It now uses the host's default
  car.
- **Clippy (`type_complexity`):** br-qw28's between-rounds state tripped it; fixed with a type alias.

## Remaining defects

- The kept list shows codes and dates, not names. The owner may want to name a track, or see its biomes and length.
- Best laps are per host browser. There's no shared leaderboard (by design: nothing is uploaded).
- A code is only as stable as the generator version. When BrownHill bumps the version, older codes are refused with
  the reason, not rebuilt.

## Not covered

- Phones: nothing here is on the phone.
- WebKit, and a real TV.
- A kept arena: derbies keep no track.
