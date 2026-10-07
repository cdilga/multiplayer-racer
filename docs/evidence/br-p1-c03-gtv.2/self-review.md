# P1-C03 data self-review (curated prefill names, 21 diminutives)

Captures: `web/tests/journeys/c03-ausname-join.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, software GL, commit 641249c), a real host and a real phone page at the join card. Chromium, not a phone.

## Looked at
- `c03-aussie-join-card-390x844.png`, `c03-aussie-join-card-412x915.png`, `c03-aussie-join-card-375x667.png`: portrait phones. The join card shows "Room XXXX", the prefilled name in the field (Macca, Dingo, Kev, Wombat in different runs: drawn at random from the whole familyFriendly list), the Aussie button beside it and "Join the race". Card, field, button and Join all sit inside the screen at 375 px.
- `c03-aussie-join-card-844x390.png`: landscape phone, the same card, nothing clipped.
- `c03-aussie-join-card-1920x1080.png`: the phone page at a TV-size window: a small centred card (a phone page, not designed for a TV).

## Defects found and fixed
- The name field's intrinsic width pushed the card past the right edge on 375 and 390 px screens, cutting off the new button and Join. The card now keeps to the screen (checked at five sizes by the journey).

## Remaining defects
- None known for the data. The duplicate suffix (" #<seat number>") is the host's rule (jj-session `names_follow_the_rules_and_duplicates_gain_the_number`), not re-tested here.
- The "never a slur or a real private person" rule is a human review of the list plus the validator's checks (NFC, 32 graphemes, no control or markup characters, unique, flagged); no automated slur check exists.

## Not covered
- Real phones, iOS, a room with more than a handful of duplicate prefills.
