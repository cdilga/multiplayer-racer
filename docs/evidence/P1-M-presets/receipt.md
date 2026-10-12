# P1-M presets · br-xlvx.7 / br-qhga

2026-10-12, CyanBridge. Generator v15 adds weighted, data-defined twisty, flowing and speedway families. The
same seed selects its length class and family deterministically. `jj procgen --preset <name>` forces a family
for a single seed or bank and reports class, family, corner counts and every straight length. The owner panel
uses the same generator schema, including the family parameters; they apply on regeneration.

Validation uses the actual generated maps, terrain, scenery, features, rails and simulation. Rapier 0.36's
existing vehicle, journals and autopilot are reused. Cohorts below are samples, not gameplay limits. The
physics fixture for bikes is not an accepted roster model. No geometry validation envelope, handling
envelope, duel margin, participant count or debris lifetime was relaxed.

On MacBookPro18,3 (Apple M1 Pro), aarch64 macOS, pinned Rust 1.99.0 and Node 26.10.0:

- AC1: `cargo test -p jj-procgen --release --target aarch64-apple-darwin --test presets` through RCH.
  The bank validates 100 actual Town maps per family and checks self-clearance/length bands. Mean straight
  length: twisty 106.23 m, flowing 122.34 m, speedway 151.76 m. Tight corners per km: 2.52374 / .66016 / .01504.
  Required margins: speedway straights ≥1.35× twisty; flowing ≥1.1× twisty; twisty tight corners ≥3× flowing;
  flowing ≥5× speedway. Family fallback counts are 0/1/1 per 100, within the retained ≤2/100 envelope.
- AC2: 3 families × 4 biomes × 3 seeds autopilot-lap and replay their full-state hash exactly. The fixture
  requires completion, zero recovery/wreck and upY > .5. `presets.json` and `laps.json` record every case.
- CLI integration checks forced-family single seeds and banks, output-directory equality and invalid-name refusal.
  `cli.txt` records the passing test; `cli-observe.json` is an actual CLI map report.
- Four generator native/WASM golden/parity/budget tests pass on eris in Node (`procgen-wasm.txt`). Native
  non-bless goldens are included in the final generator checks. Generator version 14→15 intentionally changes
  canonical seed bytes; committed golden hashes are compared bit for bit on both runtimes.
- Full `jj-sim` release suite passes: 119 tests across 25 suites (`sim.txt`). `jj-wasm-host --features testing`
  passes all 51 host tests (`host.txt`). Node's actual WASM host agrees with native bike, mixed-roster and all
  duel hashes/orderings: 4/4 tests (`host-wasm.txt`). This is Node/WASM evidence, not a physical phone run.
- The actual running host and Chromium controller tuning journey passes 5/5 (`tuning-journey.txt`): live
  vehicle/input changes, generator regeneration with measured length/relief, export/reset and production
  exclusion. It uses the freshly rebuilt host and procgen WASM. Chromium is not hardware qualification.
- Affected all-target/all-feature clippy, TypeScript, formatting and diff checks pass. Full generator checks
  pass in the final run: 84 tests, one ignored, across 21 result suites (`generator.txt`). This record awaits containing CI.

Sharper routes exposed support-loss tumbles. Cars now begin the existing levelling spring after losing their
three-contact support plane and tilting beyond profile data (10° initially); deliberate supported wheelies
remain free. Damping continues throughout the upright hemisphere rather than stopping at 45°. Gains and
forces are unchanged. Four focused Cruz cases reproduce the former failures; the full R122 banks retain
their original thresholds. Learner Some and Lots both finish all six novice seeds; Off still crashes more.

An exact six-tick air-control advantage failed the former floating subtraction (`5.60 - 5.55 < .05`). Both
native and WASM duel checks now compare tick differences before converting to seconds. A boundary fixture
accepts six ticks and rejects five at the unchanged .05 s margin.

An initial generator-suite run completed 100 bot laps with no softlocks but failed when writing to a missing
evidence directory. The rerun creates that directory first. That failed run is not presented as green.

Ordinary jump slopes are now profile data, initially .18–.21 within the retained .16–.21 safety range. The
seed9 trace showed a six-degree bend inside the nominal straight launch approach: the car left diagonally
and landed on the table edge. Placement and envelope validation now require an approach within .01 rad
(quantisation tolerance), through the longest ramp. The original .12 rad receiving-envelope limit remains.
A defect-injection test rejects a bend inside that approach. All 92 ordinary/boost jumps pass; racing mean
continuous flight is .85 s at the retained ≥.8 s threshold (`jump-scenarios.txt`).

Actual Chromium and WebKit generated-jump journeys use the final rebuilt native CLI and WASM: every uploaded
jump triangle fingerprint and the tick420 full-state hash match native. WebKit capture passed in14.45 s;
Chromium software rendering exceeded the unchanged180 s capture timeout. Chromium without captures passed
in11.53 s, and its native GPU capture rerun passed in118.01 s. The initial timeout is retained explicitly in
`jump-capture-initial-failure.txt`; it is not reported as green. All32 accepted jump images were inspected
in labelled four-image contact sheets (the original files are in `local-frames/`).

Seed0 Town full-course overview inspection found fixed chase-camera haze hiding the long course. This is
tracked as br-a92v and must be repaired before overview acceptance. Three explicit `look=plain` captures
show the generated family geometry and were inspected; they are geometry evidence, not acceptance of the
comic look. Scratch adapter uses the real host fixture/renderer and current WASM, zero cars, one stepped
tick. Zero cars tests the real empty-field camera and is not a participant cap.

Remaining: containing green CI, published v15 recapture, and br-a92v overview repair before final close.
