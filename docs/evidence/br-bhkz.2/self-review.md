# Self-review br-bhkz.2: the derby reads (health, hits, how to win, who wrecked you)

Owner, 2026-11-17: "the strategies to actually win wasn't at all clear. I seemed to die more somehow."

Captured with `web/tests/journeys/derby-fun-capture.mjs` on 2026-11-17 from a local build of the working tree (commit
16624885 plus the wreck-by banner), served by `jj-server`, in Playwright Chromium 151 on an Apple Silicon Mac
(`JJ_CHROMIUM_GPU=native`, Metal). A TV at 1920x1080, two real phone pages over WebRTC (Chromium's phone emulation, not
a phone: 915x412 and 412x915, later resized to 667x375 and 375x667), four synthetic controllers. The room's clock is
held and stepped, so the phones read as dropped out and every car is on the autopilot (the "Autopilot" chips and the
first-drive cards in the stills are that, not the feature).

## Looked at

- `tv-1920x1080-countdown-tips.jpg`: TV, derby countdown. The three how-to-win lines sit under the cars, above the
  announcer caption, readable; nothing covers a car's name.
- `tv-1920x1080-overview-t-bone.jpg`: TV, Overview, just after a staged T-bone (Davo into Shazza's door at 16 m/s). The
  strip shows each standing's car from above and `+45` beside Davo's damage; Shazza's car shows its right side amber.
- `tv-1920x1080-grid-hit.jpg`: TV, Grid, same moment. Each tile has its car diagram under the place pill and
  `+22 HEAD-ON!` style callouts; a tile still on its first-drive card shows the card and no callout across it.
- `tv-1920x1080-grid-wrecked-by.jpg`: TV, Grid, mid-carnage. Two tiles read `WRECKED! by #1 Davo · Back in 1 s`;
  diagrams show gone zones as dashed outlines, amber and red zones; callouts `+42 PART OFF!`, `+10 WRECKED 'EM!`.
- `tv-1920x1080-overview-carnage.jpg`: TV, Overview, a minute in. Strip with four standings in view and the rest
  scrolling; each mini car's zones are tinted; the one takedown banner sits clear of cars and labels.
- `laptop-1366x768-overview.jpg`, `laptop-1366x768-grid.jpg`: the same round after a resize to a laptop. The strip, the
  diagrams, the callouts and the wreck banner all scale; nothing clipped.
- `phone-915x412-derby-start.jpg`: phone landscape, three seconds in. The car diagram sits between the sticks under the
  launch meter, `+13 WHEEL HIT!` and `Wheels 95%` under it; clear of both stick zones and the device card.
- `phone-915x412-derby-hit.jpg`: phone landscape after the T-bone: `+45 PART OFF!`.
- `phone-915x412-derby-carnage.jpg`: phone landscape mid-carnage (before the fix below): front gone, sides amber and
  green, wheels red, `+43 WRECKED 'EM!`, `Wheels 25%`.
- `phone-412x915-derby-rammed.jpg`: phone upright, the rammed car: its right side amber. The diagram and its words
  sit in one row under the launch meter, above the "Turn sideways" card.
- `phone-412x915-derby-carnage.jpg`: phone upright mid-carnage, with the tank-up and roo bar timers in the strip.
- `phone-667x375-derby.jpg`, `phone-375x667-derby.jpg`: a small phone both ways up after a resize: the diagram, the
  callout and the wheel line fit; no takedown banner over the diagram.

## Defects found and fixed

- A staged T-bone scored evenly for both cars in the first captures. Not the rule (a sim probe of the same hit: rammer
  18 HP lost, rammed 115): with the clock held the autopilot drove the "standing" car away, and an earlier staging put the
  rammer inside the bank. The capture now places both cars together on the floor.
- The callout read `+12.5 WHEEL HIT!` and a tile read `126.8 pts`: damage is fractional. Points now show whole.
- A hit that scored nothing showed `+0 HIT!`: zero-point events no longer start a callout.
- The Overview's strip grew by a whole phrase per standing (`+22 HEAD-ON!`) and scrolled with three standings in view:
  the strip now shows `+22` only (the phrase is on the tiles and the phone).
- On a tile whose seat was still on its first-drive card the callout printed across the card's title: that tile shows
  no callout until the card goes quiet.
- On the phone the "TAKEDOWN! BOOST" banner sat over the car diagram for 1.8 s after every takedown, and in a derby it
  repeats what the callout says: the phone no longer shows it in a derby.
- The Grid still showed the Overview in one capture: the held page needs frames pumped for the camera change (capture
  script only).

## Remaining defects

- With six or more seats the Overview's strip scrolls (it did before this bead; health cars add about a character each).
- The countdown's number is faint behind the cars' name labels in the still (its own pulse animation, unchanged here).
- Takedown and landing billboards in a Grid tile can sit under the car diagram's corner for a moment
  (`tv-1920x1080-grid-wrecked-by.jpg`, tile 1).
- A detached door shows its side amber (the zone is the mean of two doors), not half gone.

## Not covered

- A real phone, Safari or WebKit: Chromium's phone emulation on a Mac only.
- The published preview: these stills are a local build (the preview of this commit was still building).
- A person holding the phone: every car in the stills is on the autopilot, so the "tip until your first hit" line
  (`Ram at speed · hit doors and wheels`) had already gone by the first still; g06-derby asserts the diagram on a real
  phone page, not the tip.
- More than six seats, bikes (a bike has no doors: its side zones are hidden by design, not captured).
- The full-screen toggle on the phone (the pod layout is unchanged by it; not re-captured).
