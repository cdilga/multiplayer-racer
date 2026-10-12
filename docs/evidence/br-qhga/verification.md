# Unsupported wheel rays: R122 verification

2026-10-11, CyanBridge, `v0.2-revamp` after `bda46b7d`. Native selected-package builds on the Apple Silicon Mac;
procgen and workspace checks through RCH on eris. Browser comparisons use Playwright Chromium and the rebuilt WASM,
not a physical device.

## Reproduction and fix

Seed 2, route point 320, 35 m/s, full steering for two seconds: the car's up axis reached -0.047 with no damage events.
At tick 108 one wheel ray reported contact while all suspension forces were zero. This disabled airborne levelling
until the car exceeded its eligibility angle. Airborne support now requires positive suspension force. No torque,
unit scale, handling envelope or debris lifetime was changed.

## Checks

- `cargo test -p jj-procgen --test handling`: both flat and generated-road R122 banks pass without relaxed envelopes.
- `cargo test -p jj-sim -p jj-session -p jj-fixture -p jj-protocol`: 156 tests pass.
- `cargo test -p jj-procgen`: 71 pass, one ignored; remote RCH run on eris.
- `cargo test -p jj-wasm-host --features testing`: 47 pass.
- Native/WASM duel, feel and mixed-roster browser comparisons: 3 pass, using freshly rebuilt WASM.
- `rch exec -- cargo check --workspace`: passes remotely on eris.

The deliberate mixed-roster golden change was measured independently in native and WASM before updating the fixture.
Previous hash: `6f0f9c4e732a35ac2fb6251bbedc8ef50a2d04b4d835bc0c6a865f9483097508`.
Matching new hash: `8eae7be56efed7e9e9e5b9b27d518e64b1f61e904ec07c227a6a3c9f56e39ae1`.

## Related validation

The derby CLI bank initially failed because its cars reached one another during spawn protection. The fixture now
waits 200 ticks before placing them for impact. It measures 86.503 points for each ram participant and zero for the
environmental wall hit. The complete CLI scenario bank then passes remotely on eris. This changes the setup, not the
scoring envelopes or protection rules.

CI is required before the bug bead closes. This receipt does not claim an owner playtest.
