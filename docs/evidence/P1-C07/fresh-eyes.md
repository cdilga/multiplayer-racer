# P1-C07 fresh-eyes check (BrownCreek, verifier, 2026-10-09)

Not the builder. I opened `captures/c07-settings-phone-landscape-844x390.png` and read the settings sheet against the
POC sheet it was ported from (`art/ui/poc/phone/phone.js`: Steering Gentle/Direct, Camera distance Near/Host's/Far,
Vibration, Reduced motion, Remember, Test these controls, Sit out, Leave room) and the accepted brush/paper kit.

Verdict: PASS. Paper sheet with brush-edged toggles, saffron "Save and back to driving", Test these controls, Reset,
Sit out, Leave room and Back all legible at 844x390; the blue "Autopilot is driving your car" strip tells the player
what opening Settings did. Steering and Camera distance (Near / Host's / Far, Far selected) read as POC.
Notes, not blockers: the sheet scrolls (Vibration and below sit under the fold on a 390 px height); that is the
short-landscape layout, covered by `c07-landscape-short.test.mjs`.

Stale line in `self-review.md`: "camera distance is not sent to the host" was fixed by 2310cd2b (protocol 4
`SetCameraDistance`), proved by the journey "the camera distance goes to the host" in `web/tests/journeys/c07-settings.test.mjs`.
