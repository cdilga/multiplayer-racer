# Rock relief qualification — br-xlvx.4

2026-10-12. Generator 18, final sampler source. Native and WASM checks ran on eris through RCH; the working tree and tracker remain on the Mac. This receipt qualifies the physical and deterministic candidate, not its pending deployed visual review.

The rock profile raises road relief from 10 to 45 m, underlying ground relief from 10 to 30 m, and wavelength from 80 to 180 m. Local biome grade weighting preserves mixed tracks. Bridge approaches follow ground; lower roads win beneath explicit upper decks; route heights use the actual bilinear ground sampler. The road bank extends through its bed. Splitting grid cell/fraction before floating origin arithmetic preserves dressing invariance and native/WASM rounding.

## Commands and results

- `rch exec -- cargo test --release -p jj-procgen --test biome --test crossings --test handling --test jumps --test procgen --test relief --test roofs --test terrain`: biome 8/8; crossings 6/6; handling 6/6; jumps 5/5; procgen 5/5; relief 2/2; roofs 2/2; terrain 6/6. Final run verified goldens without bless. Existing tolerances retained.
- Relief acceptance runs seeds 0–11 with pure Rocks and mixed Rocks/Town: all 24 samples finish unaided, no wreck/Recover, up-vector above 0.5, no one-second stall, and exact full-state replay. This is a finite test cohort, not a seed or gameplay limit; `JJ_SEEDS` extends it.
- `rch exec -- cargo clippy --release -p jj-procgen --all-targets -- -D warnings`: green.
- `rch exec -- cargo test --release -p jj-procgen --target wasm32-unknown-unknown --test wasm_parity`: 4/4 green (5.42 s).
- `rch exec -- cargo test --release -p jj-procgen --test relief height_and_grade_distribution_by_biome -- --nocapture`: green; full table in `height-grades.txt`.

The distribution compares old profile values and shipped values through the same final generator. Rocks route relief rises from 2.07–8.33 m to 4.19–17.32 m over these 12 seeds. Other biomes retain their profile values. Route grade measurements include jump/feature slopes; their maximum is not the road-band terrain grade budget.

## Browser preflight and remaining work

The real local jj-server room rerolled normally to Rocks seed 7 in Chromium and Playwright WebKit; the actual WASM-prepared route matched native `jj procgen` exactly. Its route spans 17.318 m, with a 7.09 m rise over the selected 100 m climb. R90 Place stages the actual seated car at the climb and crest for visual review; this does not claim a browser-driven unaided lap.

All 18 initial phone/laptop/TV/fullscreen/resize frames were inspected. WebKit's intermittent blank badge and partially painted docked QR are tracked in br-293l and are being repaired. The capture labelled overview actually frames the car/props rather than the entire track; the complete zero-car course overview remains the separate br-a92v contract. No final visual acceptance, deployed acceptance, containing CI or bead close is claimed here.
