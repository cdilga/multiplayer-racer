# Roof landings · br-gw74.11

Local validation on 2026-10-12, Mac arm64; real `jj-server`, Playwright Chromium/WebKit, real Rust/WASM worker.
One Cruz Missile, seed 21, authored town-house/kicker fixture on the greybox terrain. These are browser viewport
captures, not physical-phone, Safari, WAN or GPU performance measurements. CI and deployed review remain pending.

Every colliding `town/house` now has the visible gable and verandah as suspension-contact surfaces. Walls, deck,
chimney and posts remain solid. The complete house footprint still excludes placement/respawn. Roof tyre contact uses
tarmac grip/rolling drag/audio rather than the off-track terrain below the house. No invisible receiving platform.

- Focused native roof suite: four passing tests, including gable/verandah at three headings, an unprotected parked
  landing, driving off under throttle and ordinary Recover, full-footprint clearance, and exact replay.
- Actual kicker release: 14.939332 m/s, within the fixture's 15 ± 0.5 m/s design envelope. At tick 360 the car is
  airborne with zero wheel contacts. At tick 960 it rests at `[52.250484, 2.246200, 20.876814]`, upY 0.959908,
  four contacts, no wreck/husk. The fixture parks using the existing `no_reverse` input, now exposed as `noReverse`.
- `jj sim --json scenarios/roofs/kicker.json`: outcome envelopes pass and exact replay matches; full-state hash
  `4f60e738108a317b459e92d7f6ae8e4f39fad55515e7a380dc23688280cc2068`.
- `jj validate --json scenarios/roofs/kicker-map.json`: accepted; one kicker, 192 triangles, draw fingerprint
  `b93d2a2189c7a8d4`. Moving its target 60 m away is rejected by `roof-reach`.
- Real browser journey: Chromium 48.728 s, WebKit 11.104 s, both passing. Native/WASM hashes and actual uploaded
  kicker triangles match; the car stays on the rendered roof with four suspension contacts. No page errors.
- `live-check.mjs` passes portrait/landscape phone and TV before/after resize. Its scratch HTML adapter applies the
  same R90 fixture and awaits render tick 960; no gameplay state is mocked. All final images were inspected.
- Vehicle bake/contract reproducibility passes; canonical model, paint, damage meshes and batching are reused.
- Production WASM rebuild and final `npm --prefix web run build` (TypeScript + Vite) pass. The per-crate WASM build
  used RCH's local fallback on the Mac, which is permitted within the target budget; the workspace test uses
  `RCH_REQUIRE_REMOTE=1` and its receipt names eris. `cargo fmt --all -- --check` and `git diff --check` pass.

The scenario bank explicitly includes the roof script, leaving its adjacent map JSON out of fixture enumeration.
The browser journey earns its keep by enforcing real WASM parity and collision/draw-buffer agreement, which a native
unit assertion cannot establish. Native tests provide drive-off/recovery and placement coverage without duplicating
those longer sequences in every browser.

## Remaining scope

The reachability rule checks declared `roofTarget` stunt landings. It does not claim every decorative house has a
reachable approach. Generated town courses still have zero ordinary jump density and no targeted roof kickers; their
roofs are physical, but generated stunt access needs further work before calling the entire bead done. Final remote
workspace checks, CI and deployed visual review are pending. No acceptance has been ticked or narrowed.
