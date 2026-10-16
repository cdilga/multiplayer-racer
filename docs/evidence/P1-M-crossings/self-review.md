# Self-review P1-M crossings (br-xlvx.3): bridges and figure-8 crossings

Captured on the Mac (Apple M1 Pro), local real jj-server, `web/tests/journeys/generated-crossing.test.mjs`
(`JJ_CAPTURE_DIR`), generator 23, Town seed 0 figure-eight: two cars placed on the upper and lower roads, frame-stepped,
native/WASM full-state parity and the uploaded bridge triangles' fingerprint compared with the native collision mesh.
Chromium (GPU) and Playwright WebKit (not Safari); emulated viewports, no physical TV or phone.

## Looked at

- [chromium-underpass-1920x1080.jpg](chromium-underpass-1920x1080.jpg), TV: one car on the deck, the other on the lower
  road passing under it; concrete piers stand either side of the lower road, clear of it; the deck's barriers read white.
- [chromium-underpass-1366x768.jpg](chromium-underpass-1366x768.jpg), laptop: the same passage.
- [webkit-underpass-915x412.jpg](webkit-underpass-915x412.jpg), phone landscape (WebKit): deck, both piers and both cars
  read; the underpass is open.
- [webkit-underpass-412x915.jpg](webkit-underpass-412x915.jpg), phone portrait (WebKit): the lower car and deck read; the
  keyboard-players panel covers the upper car (see Remaining defects).
- [chromium-resized-1920x1080.jpg](chromium-resized-1920x1080.jpg), after a resize to portrait: the view recovers.

Fixtures (CI): `crates/jj-procgen/tests/crossings.rs` (generated crossing bank validates without flattening the
family; bots lap both levels on Town/Rocks/Dirt/Bitumen/four-biome seeds without recovery and replay exactly; paint on
both levels; a bridge gate can't be passed from underneath; dirt seed 16's deck edges), `crates/jj-map/tests/bridges.rs`
(defect injection: too little clearance and too steep a ramp are rejected).

## Defects found and fixed

- The deck read as a floating slab from the TV: it now stands on piers (a column under each edge every 20 m where the
  deck is a metre or more above the ground, never within the lower road's half-width + 2.5 m). They are part of the shared
  bridge geometry (`jj-map::bridge::piers`, mirrored in `web/host/src/render/map/bridge.ts`), so they are colliders, not
  ghosts, and the journey's triangle-fingerprint parity covers them.
- Figure-eights were rare (preset weight 0.6, ~17 % of courses) and short sprint ones were cramped (a 650 m lap with a
  deck span over a third of it couldn't climb 25 m): weight 1.2 (~29 %) and a 850 m minimum length for the family
  (`course.presets.figureEight.minLengthM`, inside the class's band).
- Earlier in this run (P1-FL15a): the deck rose over a sag or a hill under the span, the underpass dip left a kink the bot
  bounced out of, and a ground cap dug a drop in front of the deck; all fixed there.

## Remaining defects

- Host UI: on a portrait phone viewport the keyboard-players panel covers a third of the host view (not this bead).
- Crossings come only from the figure-eight family; a crossing in other families (a loop passing over itself) is
  br-xlvx.6 (loops) / br-bbki.15.4 territory.

## Not covered

Physical phones/TV, Safari, the owner's taste review, a deployed preview run.
