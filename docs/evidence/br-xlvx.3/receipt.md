# Crossings implementation receipt — br-xlvx.3

2026-10-12. Generator v16 adds a weighted figure-eight family to the original three families. Map data declares upper/lower inclusive spans, clearance, deck/barrier dimensions and maximum grade. Rust collision and Three.js upload share the same closed triangles and fingerprint. Ground/terrain baking excludes the upper deck. Layer-aware route acquisition and gate height windows prevent counting a bridge gate from underneath.

- `contract.txt`: 100 requested maps (20 seeds × five recipes), all valid without a redraw. Fifteen autopilot laps (three seeds × five recipes) visit both levels, with zero wrecks/recoveries and exact replay.
- `map-contract.txt`: bridge defect injections reject insufficient clearance, steep ramps, faulty joins and blocked lower roads.
- `generator.txt`: biome/course/preset/generator suites pass, including 100-seed course coverage. Raw dirt seed 16 has its own grade regression.
- `simulation.txt`: full jj-sim release suite passes via RCH on eris.
- `clippy.txt`: affected crates, all targets, warnings denied.
- `journey.txt`: actual generated crossing, two Cruz cars physically separated by over 5 m at nearby XY positions; renderer uploaded the exact bridge fingerprint. Native/WASM 300-tick hash and replay match. Chromium native GPU 42.75 s, Playwright WebKit 6.80 s, 2/2 pass.
- `live-check.txt`: all five viewports and fullscreen-style resize pass. Screenshots inspected in `self-review.md`.

These are local browser and remote Rust measurements from the dirty implementation, not deployed or physical-device qualification. A clean containing workspace/CI pass and deployed confirmation remain before close.

The containing workspace run found lane paint being deleted by the upper-corridor furniture clearing pass. That pass now preserves lane lines and puts upper markings on the deck. `bitumen-repaired.txt` passes all five biome checks, and `final-crossing-tests.txt` passes six crossing fixtures, including physical paint elevation. The first workspace matrix is not claimed green; clean containing CI remains required.
