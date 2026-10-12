# Self-review P1-V-chooser (br-bwju.9)

Owner 2026-10-12: "it's kinda unclear you can change car, and when you get to the screen you can't clearly see how many
choices you really have." MacBookPro18,3, local real jj-server, Chromium (Playwright headless) emulating a touch phone at
844x390 and 390x844, joining a real lobby. Browser emulation, not a physical phone.

## Looked at

- `chooser-844x390.png`, `chooser-390x844.png`: the picker shows "Car 1 of 2" on the car's card and "All 2 cars: tap
  one or swipe" over the thumbnails; arrows, thumbnails, Use this vehicle and Leave all visible, nothing overlapping.
- `play-change-car-844x390.png`, `play-change-car-390x844.png`: after picking, the tools strip button reads "Change car"
  (it said "Vehicle"); before a pick it reads "Choose car". Its accessible name follows the text.

## Defects found and fixed

- None beyond the two the owner named (the count and the button's wording).

## Remaining defects

- The Tradie Ute shows as a silhouette in the thumbnails: it has no rendered card art yet (roster data).

## Not covered

- A 12-car fixture roster (`#roster=` test surface) and host keyboard/pad players' count cue (acceptance items 2 and 3);
  the TV lobby card.
