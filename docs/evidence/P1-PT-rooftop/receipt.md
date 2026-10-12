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

## Canonical target repair

The two-house regression failed before the repair: sorting dressing silently redirected `roofTarget=0` from the
house at x=50 m to the one at x=32 m. Canonicalisation now rebases the target against the original dressing before
sorting features. The regression passes, canonical bytes round-trip, reversed authoring order yields the same bytes,
and canonicalisation is idempotent. The complete native `jj-map` crate suite passes 19 tests; old greybox hashes remain
unchanged. The single-house landing fixture's geometry/state are unaffected. Per-crate Mac execution is identified in
`canonical-before.log` and `canonical-after.log`; no local workspace build is claimed.

The scenario bank explicitly includes the roof script, leaving its adjacent map JSON out of fixture enumeration.
The browser journey earns its keep by enforcing real WASM parity and collision/draw-buffer agreement, which a native
unit assertion cannot establish. Native tests provide drive-off/recovery and placement coverage without duplicating
those longer sequences in every browser.

## Generated Town stunt access

Generator version 14 adds empty run-in/kicker/house lots after the complete street/scatter pass.
No scenery is removed or route moved. Placement preserves existing circumscribed-footprint
spacing, straight-street house placement, road-facing fronts, Town masks and transition exclusion.
It samples the entire lot's ground grade, road clearance and bounds. Previously accepted stunt
lots reserve their approaches too. Density and dimensions live in `assets/profiles/generator.json`;
there is no stunt-count budget.

Ten actual Town seeds produce 20 lots (5,5,1,0,1,1,2,2,2,1). Every real Rapier landing remains
on the roof with four wheel contacts, upY >0.9, tarmac grip, zero husks and no life/recovery change.
Each run replays bit-identically. Nominal design speed is 15m/s; measured release speeds span
13.979932–15.246225m/s, not a claim that every release is within ±0.5m/s.
Moving the receiving house 60m away is rejected for every generated lot. Invalid dimensions
and sub-millimetre/nonadvancing offset steps are refused. The native suite passes 2/2 in 81.64s.

The first seed's full generated map and exact script are in `generated/{map,scenario}.json`.
Chromium and WebKit replay it through the real WASM worker, with native state hash
`6855953a4139a5842739a49fcc5db278d97b9bb82ad664db7aa36617a715c48b`, four roof contacts
and collision/draw geometry parity for all jumps (2/2 browser tests, 144.463s total).
The journey accepts explicit map/script inputs so it can review generated and authored fixtures.

The probe exposed `jj validate`'s disk registry missing generator-owned chevrons/rails/gantry.
It now fills only missing procedural contracts, preserving explicit `--kit` entries. The actual
CLI regression generates, saves and validates the map (1/1). Town's original scenery-spacing
test first rejected a tree/house overlap; preserving its conservative discs fixed it (1/1).
No acceptance assertion was weakened.

Remote eris checks pass: biome 8, features 2, scatter 5, tuning 4; workspace all-features check
passes. Intentional version-14 golden rebuild passes 5. Production/testing WASM and TypeScript/Vite
builds pass. Goldens, exports and per-crate CLI/landing runs used the permitted Mac lane through
RCH. Logs in `generated/` name commands/worker paths and retain the results.

## Remaining scope

The reachability rule checks declared `roofTarget` stunt landings. It does not claim every decorative house has a
reachable approach. Generated Town courses now offer targeted stunt lots where complete clearance
permits them; a seed may have none. Containing green CI and deployed visual review remain pending.
The older broad workspace test hit the remote 30-minute deadline; it is not recorded as green.
The CI matrix remains the required whole-workspace test receipt. No acceptance has been narrowed.
