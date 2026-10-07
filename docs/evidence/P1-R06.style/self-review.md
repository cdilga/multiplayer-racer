# Self-review P1-R06.style

Identify on the TV against the accepted Cooee (art/ui/accepted/2026-10-07/poc/tv/tv.css `.cooee`, and the captured frames
docs/evidence/P1-U02.2/identify/full-*.jpg). Captures from the R06 journey (`web/tests/journeys/r06-identify.test.mjs`,
24 then 120 synthetic controllers through the real host) on eris, Playwright Chromium with the RTX 2080 Super
(`JJ_CHROMIUM_GPU=1`), at commit 2f59650, 150 ms after the press.

## Looked at

- `identify-24-1920x1080.jpg`: #7's tile only: the seat-colour wash over the 3D (seat 7 is the charcoal seat, so a grey wash), the frame pulsing, and "Cooee #7" on a tilted slab in the seat colour with an ink outline and shadow, sentence case as in the reference; "#7" floats over the car in the tiles that see it (#8, #9, #17, #18 …); no other tile pulses.
- `identify-120-1920x1080.jpg`: 120 tiles: "Cooee #108" fits inside #108's small tile (bottom-right block), wash in sky blue; three-digit marks over the car in other tiles.

## Defects found and fixed

- Before: an upright, upper-case "COOEE #N" box at the top third and a border pulse only, no flash; now the accepted wash and tilted slab, fast attack and 1.4 s decay, and Reduced motion holds the label with no flash.

## Remaining defects

- None seen on these captures.

## Not covered

- The phone's flash: the controller's `.cooee-phone` is already the port of the accepted phone mock (web/controller/src/app/controller.css, 2026-10-07), unchanged here and not recaptured.
- Reduced motion on the TV, and real hardware; the flash is captured at one instant, not as a sequence.
