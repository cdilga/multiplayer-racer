# P1-C03 self-review (join, claim and resume flow)

Captures: `web/tests/journeys/c03-states.test.mjs`, `c03-car.test.mjs` and `c03-ausname-join.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, software GL, commit ba8106e), phone contexts at 844x390, 390x844 and 375x667, from the URL-fragment state opener (`B/j/ABCD#state=<phase>`, no network: R90's test surface) and, for the live causes, `c03-resume.test.mjs` on real hosts and phones. Chromium on eris, not devices. Accepted-mock comparisons are in `docs/evidence/br-p1-c03-gtv.1/`.

## Looked at
- Every §11 state at all three sizes (`c03-state-<state>-phone-<size>.jpg`): finding, no-such-room, room-ended, preview-expired, connecting, finding-relay, no-route, ready-to-join, joining, reconnecting, host-gone, host-paused, another-tab, update-needed and playing. Each shows its icon or spinner, its wording ("room", never "game": R112) and its next action; none scrolls or runs off an edge.
- The join card (`c03-state-ready-to-join-phone-landscape-844x390.jpg` and the other two sizes): "You're in ABCD", the name field with the dice and the Aussie button, "Join the race".
- The lobby car picker (`c03-car-landscape-844x390.jpg`, `c03-car-portrait-390x844.jpg`, `c03-car-small-375x667.jpg`, `c03-car-short-640x300.jpg`, `c03-car-one-844x390.jpg`, `c03-car-many-844x390.jpg`): the Cruz Missile big in its panel with class, name plate, four stat bars and a line about it, arrows and thumbnails when there is more than one car, "Done".

## Defects found and fixed
- The "Finding a relay…" and "Can't reach the host from this network" cards were declared but never reached; the session now shows them from the link's relay-fallback state (a 429 then a 503 from the relay is the scripted cause in the journey).
- The host-hidden pause never reached the phones: the HUD that carries it rides the sim's ticks and a paused sim has none. The host now sends it ten times a second while paused (Rust, with a test), and the phone shows the "Host paused" card.
- The page hidden for 30 s with its network cut returned to the same seat in 278-342 ms (the journey asserts 3 s); the earlier emulation that closed the phone's own connection hid a real case, so the journey now drops the host's end and cuts the phone's HTTP.
- The cards redrew only when the phase changed, so a room code arriving later left "Finding room …" empty; the card key now includes the code.
- Wording now follows the accepted mock (Edit the code / Scan again, Open the preview index, Cheers for playing! and the place, Can't reach…), with the mock's icons, spinner and brushed buttons.
- The car picker's portrait view had the "Turn sideways" prompt over Done and the name plate half hidden behind the panel; the prompt now stays off the picker and the plate sits on top.

## Remaining defects
- **The TV's "choosing" state and the host seeing the pick are unmet**: there is no wire message for a vehicle choice (and no host lobby support), so the picker is a per-device preference today. The picker itself is data-driven (any number of cars, tested at 40).
- **The protocol-mismatch cause is scripted from the controller side**: the host never checks `Hello.protocol` (`host.rs` ignores it), so no live room answers `ClaimRejected{Build}`; the journey delivers that reply through `__jjController.deliver` and checks the card and the one reload.
- **The F08 emulator row "background to foreground returns the same seat within 3 s"** is P1-F08's recorded C03 receipt (74 ms, labelled emulator), not re-run here.
- At 375x667 portrait in the Lobby the tutorial card and the "Turn sideways" prompt stack and the prompt is clipped (`c03-state-playing-phone-small-375x667.jpg`); an existing C06/R101 interplay, left alone.
- One run of the states journey failed on the finding card once and passed on three reruns; not diagnosed.

## Not covered
- Real phones, a real lock/unlock (a P1-Q02 row), iOS and WebKit.
- A relay that actually connects through Cloudflare TURN (the journey only scripts the 429/503 answers).
