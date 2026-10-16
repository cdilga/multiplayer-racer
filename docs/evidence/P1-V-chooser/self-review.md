# Self-review P1-V-chooser (br-bwju.9)

Owner 2026-10-12: "it's kinda unclear you can change car, and when you get to the screen you can't clearly see how many
choices you really have."

Two passes:
- **First pass (PearlPond, 2026-10-12):** MacBookPro18,3, local real jj-server, Chromium (Playwright headless)
  emulating a touch phone at 844x390 and 390x844, joining a real lobby.
- **Second pass (WhiteStream, 2026-10-16):** the same Mac, the controller's state opener
  (`j/ABCD#state=playing&round=lobby&roster=12`, a 12-car roster: the real cars plus stand-ins), Chromium emulating a
  touch phone at 390x844, 844x390, 375x667, 915x412 and 640x300.
  - The TV lobby with a pad player comes from `owner-lobby-settings` on eris, in Chromium (the shot looked at); CI runs it
    in WebKit too.

All of it is browser emulation, not a physical phone.

## Looked at

First pass:
- `chooser-844x390.png`, `chooser-390x844.png`: the picker shows "Car 1 of 2" on the car's card and "All 2 cars: tap
  one or swipe" over the thumbnails. Arrows, thumbnails, Use this vehicle and Leave are all visible, nothing overlapping.
- `play-change-car-844x390.png`, `play-change-car-390x844.png`: the tool-row button reads "Change car" after a pick.

Second pass, on the phone (`phone-<state>-<size>.png`, states lobby, picker and picked, at each of the five sizes):
- `phone-lobby-844x390.png`, `phone-lobby-640x300.png`, `phone-lobby-915x412.png`: the pod between the sticks shows
  "CRUZ MISSILE", a worded **Change car** button and "Car 1 of 12" under the launch meter. The tool row is one icon
  shorter. Nothing overlaps, and the "Tap Ready" banner sits clear below.
- `phone-lobby-390x844.png`, `phone-lobby-375x667.png`: upright, the pick is one row under the launch meter: name over
  count, Change car beside them. At 375x667 the "Tap Ready" banner clears "Car 1 of 12" (see defects).
- `phone-picker-*.png`: after Next, the card reads "Car 2 of 12" and the label reads "ALL 12 CARS: TAP ONE OR SWIPE".
  The thumbnail strip scrolls; Use this vehicle and Leave are reachable at every size.
- `phone-picked-*.png`: back in the lobby, the pod follows the pick: "TRADIE UTE", "Car 2 of 12".

Second pass, on the TV:
- `tv-pad-car-count-chromium.jpg` (owner-lobby-settings on eris, Chromium, 1366x768): a keyboard player (#1) and a pad
  player (#2) each show "Car 2 of 2" over "Vehicle for #n" and its car list. The lobby cards read "Tradie Ute" and
  "Choosing car...". Nothing overlaps the key/pad legends below.

## Defects found and fixed

- **The new button broke c02's "nothing in the pod can take focus" (CI run 5196).** In a race the car box is hidden,
  so its button can't take focus, but the test counted it. The test now skips hidden parts; the Lobby's car pick is the
  pod's one deliberate button.

- **The car control was a bare icon** at both sizes the acceptance names. At 844x390 and 640x300 the short-landscape
  rule hid its words, and under 400 px upright another rule did the same. That is exactly the owner's "unclear you can
  change car". Fixed by moving the choice into the pod, Lobby only, with its words always shown, and removing those
  hiding rules.
- **The pod ignores touches** (`.pod * { pointer-events: none }`), so the new button didn't respond. The button now
  takes touches; the rest of the pod still doesn't.
- **At 375x667 the "Tap Ready" banner (top 50%) covered "Car 1 of 12"** when the pick was three stacked lines. Upright,
  it is now a two-row grid beside the button. The journey checks that the name, count and button are uncovered
  (`elementFromPoint`) at all four journey sizes.

## Remaining defects

- **Picker art (filed as br-bwju.10):** the Tradie Ute, Hawk Dash and Lion President show the flat stand-in silhouette in
  the picker. Only the Cruz has a render in `roster.json`, so real cars look like placeholders.

## Not covered

- A physical phone. Safari on iOS is not covered; the WebKit run is Playwright WebKit on eris.
- The TV lobby card's car name for a phone player is unchanged by this bead. P1-C03 (`c03-pick`) covers it.
