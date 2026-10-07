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
- Pick captures (`c03-pick-phone-open-844x390.jpg`, `c03-pick-tv-choosing-1280x720.jpg`, `c03-pick-tv-picked-1280x720.jpg`): the open picker, then the TV's lobby card "Choosing car…" and the picked car's name. Looked at all three; the picker's note used to say the host could not see the pick (stale once the pick went on the wire) and now says the big screen shows it.
- **The lobby pick is on the wire** (the earlier gap, now built): `Pick{vehicle, open}` is a new `ControllerCmd` (protocol 2, goldens added), the host keeps each seat's pick, and the TV's lobby card says "Choosing car…" while the picker is open and the car's name once it is picked (`c03-pick.test.mjs`: a 200-car roster, a reload, Ready never behind it). The stand-in cars of the `#roster=N` test surface are named from their ids on the TV ("Test 149"); the real roster (one car, the Cruz Missile) is named from `web/shared/src/roster.json`.
- **The protocol-mismatch cause is real now**: the host answers a Hello for another protocol with `ClaimRejected{Build}` and no seat (native test, and the journey patches a phone's first Hello on the way out: the page reloads itself once and then joins).
- **The F08 emulator row "background to foreground returns the same seat within 3 s"** is P1-F08's recorded C03 receipt (74 ms, labelled emulator), not re-run here.
- A card taller than a short screen (browser bars showing) scrolls; the journey checks every card's action is reachable at 640x300.
- At 375x667 portrait in the Lobby the tutorial card and the "Turn sideways" prompt stack and the prompt is clipped (`c03-state-playing-phone-small-375x667.jpg`); an existing C06/R101 interplay, left alone.
- One run of the states journey failed on the finding card once and passed on three reruns; not diagnosed.

## Not covered
- Real phones, a real lock/unlock (a P1-Q02 row), iOS and WebKit.
- A relay that actually connects through Cloudflare TURN (the journey only scripts the 429/503 answers).
