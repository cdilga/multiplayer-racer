# P1-N07a evidence: the seat reducer

`test-output.txt`: `RCH_REQUIRE_REMOTE=1 rch exec -- cargo test --locked -p jj-session` on eris, 2026-10-03: 10 tests pass
(`cargo clippy --no-deps -p jj-session -- -D warnings` clean). Code: `crates/jj-session/src/seats/` (pure reducer: inputs in,
outputs out, time only through `Input::Tick`).

| Acceptance | Test |
|---|---|
| Property tests over random join/leave/resume/duplicate sequences: one car per seat, no phantom seats | `one_car_per_seat_no_phantoms_stable_numbers`: 1,000 random sequences of up to 200 steps (Hello with right or wrong secrets, Claim retries with blank or set names, Leave, Sit out, Disconnect, Identify, Tick) over 8 endpoints and 24 connections; after every step: one seat per claiming endpoint and none for anyone else, a car only for an active seat, numbers never change or repeat, only an endpoint's live connection drives its seat |
| Numbers stable across resume; N up to large generated values, no truncation (no cap) | the property above (numbers fixed per seat across resumes), `retries_and_reconnects_never_duplicate_a_seat`, `any_number_of_seats_gets_stable_distinct_numbers` (10,000 seats: numbers 1..=10,000, every seat has its car, colours cycle the palette, "Player 13" past 99) |
| A retried `Claim` with the same `requestId` yields one seat; resume by secret returns the same seat; a duplicate tab fences the older one | `retries_and_reconnects_never_duplicate_a_seat`, `a_duplicate_tab_fences_the_older_one_and_a_wrong_secret_is_refused` |
| Identify rate-limited to once per 3 s per seat; Leave/Sit out at a tick boundary, standings kept | `identify_rate_limit_table` (ticks 1, 179 limited; 180 fires; 181, 359 limited; 360 fires; auto-fires on join and respawn and restarts the limit), `leave_and_sit_out_take_effect_at_the_next_tick_boundary_and_keep_the_seat` (car stays until the boundary; the seat, number and name stay after Leave; claiming again returns the same seat) |
| The §14 0.1 seat cases as Rust tests | `opening_never_claims_and_one_car_per_seat`, `stale_input_is_neutralised` (wrong source handle, unknown or fenced connection, a seat that left), `retries_and_reconnects_never_duplicate_a_seat` |

Also: names per plan §9 / master §10.6 (`names_are_cleaned_and_bounded`, `names_follow_the_rules_and_duplicates_gain_the_number`):
NFC, trimmed, ≤ 32 graphemes (a ZWJ family emoji counts once), markup/control/bidi characters refused, blank reverts to the
default, case-folded duplicates gain the seat number (the earlier seat keeps its plain name).

Design notes: the reducer takes the SHA-256 of the endpoint secret, so no secret is stored. `Hello.resume` is treated as the
endpoint secret on every connection (first contact included), because the host can only check a resume against a hash it
recorded earlier. A wrong secret for a known endpoint id is refused without touching the seat.
