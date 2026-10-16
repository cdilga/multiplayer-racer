# br-xlvx.5 (huge jumps over another part of the track): self-review

**Map:** Town seed 1, a generated figure-eight whose crossing's upper road is an overpass leap laid by
`jj_procgen::overpass::place`, from `crates/jj-procgen/tests/overpass.rs` with `JJ_EVIDENCE_DIR` set. The leap has a
44.9 m gap over the lower road, a band of 28.5..38.4 m/s at the lip and a 52.6 m landing.

**Run:** by hand with `web/tests/journeys/lib/overpass-capture.mjs` in the real host: a local build, Playwright Chromium
on the Mac, 2026-10-17. It shows two cars:
- a Cruz started on the level before the kicker at about 37 m/s, flat out;
- a second Cruz driving the lower road beneath it, timed to pass under the gap.

At tick 188 the leaper is airborne past 40% of the gap, 15.7 m above the car on the lower road (`capture.json`).

## Looked at

- `chromium-side-1920x1080.jpg` and `chromium-side-1366x768.jpg`: a side-on orbit of the leaper.
  - It is high in the air over the lower road's cutting, with the second car driving beneath it.
  - The upper road's ribbon stops at the kicker and starts again at the rim, with nothing drawn across the gap.
  - The kicker stands on the take-off embankment (left).
- `chromium-chase-1920x1080.jpg` and `chromium-chase-1366x768.jpg`: the leaper's own chase camera in flight.
  - The upper road continues straight ahead past the landing.
  - The lower road runs off to the left through its cutting.
- `chromium-grid-1920x1080.jpg` and `chromium-grid-1366x768.jpg`: two tiles. The leaper's tile is in flight; the lower
  car's tile shows the road ahead through the cutting, under the leap.

## Defects found and fixed

- **Flights landed short.** Real flights landed about a quarter shorter than the validator's prediction. The cars'
  `linear_damping` (0.15-0.19/s) acts in the air, and the flight model ignored it.
  - Overpass leaps now fly with `FLIGHT_DAMPING_PER_S` (0.19).
  - Predicted and real touchdowns now agree to about a metre, and real cars land slightly long.
- **Steep kickers bled speed.** A 20° kicker with a short foot cost a car 5-7 m/s, slamming its suspension. The kicker
  is now 15° with a 10 m concave foot, and costs about 3 m/s.
- **The pit took landing cars.** A car coming down onto the rim, which is lower than the take-off, dipped under the
  pit's trigger while still over the gap, and respawned. An overpass pit now triggers below the lower of the take-off
  and the rim.
- **Pads cut instead of filled.** The take-off and rim pads (a terrain cell past the lip and before the rim) were only
  ever cut, so the ground under the lip was lower than the take-off. They are now laid like road.
- **The host refused the map.** An old host wasm didn't know piece 4 and refused the map, so `__jjTest` never came up.
  Rebuilding the host wasm fixed it.
- **The TV drew a zero-width detour.** The renderer drew a detour for every set piece. One with width 0 (an overpass
  leap) now draws nothing.

## Remaining defects

- **Gap and band floor.** The figure-eights cross at about 40°, so the gap is 40-45 m and the band floor 27-28.5 m/s at
  the lip. The V8s and the Cruz reach that; the Ute and the bikes probably don't (R11). The fix is a squarer crossing
  for leap eights, about 24-30 m of gap at 70-90°, which is asked of the course (BrownHill, thread br-xlvx.5). Until
  then the generator won't place leaps (the hook waits on FL15c).
- **Jagged walls.** The abutment faces (4:1) and the cutting walls show the heightfield's stair-steps on the 2.5 m
  terrain grid (side and grid captures). That is a terrain-resolution limit, as with the other set pieces' pits.
- **Kicker underside.** From the lower road, the kicker's underside shows as a brown wedge against the sky at the top
  of the abutment (grid capture, right tile).

## Not covered

- **The generator placing leaps itself.** The hook in `generate_course` waits on BrownHill's FL15c commit, so these
  maps are generated eights with the leap laid on afterwards by `overpass::place` (the bridge, dressing and props taken
  off).
- **WebKit, phones and real devices.** The capture is Chromium only. A phone shows no world.
- **R14's pitch skill window per jump.** It is judged by FL07's landing tiers, not measured here.
