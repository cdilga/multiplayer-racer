# P1-C03 later self-review (the Australian name button)

Captures: `web/tests/journeys/c03-ausname-join.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, software GL, commit 641249c), real host and phone through the real join path; the on-device model is stubbed (available or unavailable), so the real Chrome Gemini Nano check is not done.

## Looked at
- `c03-aussie-converted-390x844.png`: "David" converted to "Davo" by the known-names sheet; the note reads "Davo instead of David." with an Undo button; the name field shows Davo; Join sits below, all on screen.
- `c03-aussie-converted-model-844x390.png`: landscape, the stubbed on-device model's reply "Davvo" used after the tap (the model is not asked until the tap).
- `c03-aussie-nothing-to-change-390x844.png`: "Zoë" has no rule, so the note says "No Australian version of that one, so it's left as typed." and the field is untouched.
- `c03-aussie-join-card-375x667.png`, `c03-aussie-join-card-844x390.png`: the card with the Aussie button at the smallest phone and in landscape; fits.

## Defects found and fixed
- The card overflowed the right edge on narrow phones (the button and Join were cut off): fixed and now asserted at 844x390, 1920x1080, 412x915, 375x667 and 390x844.
- The converted-name note split "Davo" and "instead of David" with a wide gap: wrapped in one span.
- CI caught the journey matching the note's text without its line break: matched with `\s+`.

## Remaining defects
- Rule-made names can be plain: Alice gives "Alo", Priya "Pro", Marlene "Marro". They validate and are deterministic, and the sheet covers the common names, but the rules are crude.
- Not run: the real Chrome built-in model on a device with it present (needs the owner's device; a receipt row for Q02).

## Not covered
- iOS Safari, a real keyboard (the field is a plain input), screen readers beyond the button's label and the note's `role=status`.
