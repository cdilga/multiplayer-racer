# br-bwju.7 self-review: roster plumbing

Captured by `web/tests/journeys/v-roster-mixed.test.mjs` (headless Chromium, software GL, loopback WebRTC). Every image was opened and looked at.

- `phone-picker-cruz-844x390.png`, `phone-picker-ute-844x390.png`: the picker offers both roster vehicles (two thumbnails, arrows, stats, blurb, Done). The Cruz has its hero render. The Ute is a blue "ute" silhouette: there is no hero render for it yet (gap; the roster row has no `art`).
- `tv-mixed-two-cars-1280x720.png`: two seats in free drive, Cruz (red) and Ute (blue) side by side in their own tiles. Each is its own model (tray, bull bar, roof stripes on the ute). The existing key-help panel and QR card overlap nothing new.
- `tv-mixed-grid-12-1920x1080.png`: 12 synthetic cars alternating the two vehicles; the ute and the Cruz are told apart at distance.
- `tv-tuning-ute-1280x720.png`: the tuning panel with the vehicle selector set to `tradie-ute`.

Honest gaps: the Ute hero art is a silhouette; ute engine sound is data only (nobody listened); native `cargo clippy` for jj-wasm-host and jj-fixture is blocked by another helper's `jj-procgen/src/tuning/mod.rs:138` (useless format!); `jj-sim/tests/damage.rs` fails in the shared tree but passes at HEAD, which looks like the concurrent surface work (not isolated).
