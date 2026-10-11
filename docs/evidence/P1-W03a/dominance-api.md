# P1-W03a · Raw Rapier dominance repair

2026-10-11, CyanBridge. Raw API qualification for br-p1-w03-zn1.1 and
br-p1-w03-zn1.1.1; full Sanga remains unfinished.

The unpatched crates.io Rapier 0.36.0 test fails on eris and Mac: equal 1,200 kg
cuboids, no gravity/friction/restitution, locked rotations, 15 m/s mover. Equal
groups share 7.5 m/s. A higher group keeps 15 m/s but transfers about 1.5e-7 m/s
and passes through the target (x=4.5 vs 0.993 m at 0.5 s). Logs:
`/tmp/jj-dominance-api-isolated.log`, `/tmp/jj-dominance-api-macos.log`.
0.36.1's solver was inspected and is unchanged; it was not adopted.

The exact 0.36.0 dependency is vendored from its crates.io package, with its
archive digest and original file digests in `vendor/rapier3d/`. Four source files
separate dominant dynamic motion reads from impulse writes, zero only solver
inverse mass/inertia, and reconstruct contacts from actual body-local anchors.
An initial motion-only candidate transferred speed but left overlap; a separation
assertion caught it and the final anchor repair removes that overlap. The body's
real mass, controls and pose are unchanged. Fixed/sleeping/kinematic conventions
retain their original paths. Generic multibody/FEM dominance is not qualified.

Final eris Linux x64, pinned Rust, explicit dev/test opt-level 1:

- Native raw API: **10/10 passed**, including both Simplified/twist and Coulomb
  contact models, both insertion orders, equal/fixed controls, next-tick setter,
  expiry return to equal contacts and stationary-overlap energy. Log:
  `/tmp/jj-dominance-order-model-native.log`.
- WASM raw API, wasm-bindgen runner in Node: **10/10 passed**. Log:
  `/tmp/jj-dominance-order-model-wasm.log`. This is WASM execution, not a device.
- Corrected pair: both bodies 15 m/s, x=4.5 and 6.5 m, 2 m separation. Fixed
  barrier stops mover at approximately -2 m. Expired equal groups share 7.5 m/s.
  Stationary overlap separates 1.999984 m; maximum kinetic energy 1.45e-11 J.
  Exact output is in `/tmp/jj-dominance-vendored-anchors.log`.
- Full native workspace before Sanga integration: **455 passed, 0 failed,
  1 ignored, 77 suites**, exit 0. The new insertion/contact-model matrix was then
  separately checked as above. Log `/tmp/jj-dominance-workspace-bank.log`.
- Full workspace Clippy, all targets including host testing, warnings denied:
  **passed**, also providing the shared-contract compile check. Log:
  `/tmp/jj-dominance-workspace-clippy.log`.
- `scripts/ci/deny.sh`: advisories, bans, licenses and sources all pass.
  Log `/tmp/jj-dominance-deny.log`.

Fresh release host WASM on Mac Apple M1 Pro, 16 GiB, macOS 27.0.1, Node 26.10.0,
Playwright Chromium/SwiftShader, actual local Rust server:

- Mixed-roster golden plus all native/WASM duel hashes/orderings: **2/2 pass**,
  70.26 s. `/tmp/jj-dominance-host-parity.log`.
- Complete public smoke: **4/4 pass**, 119.94 s, unchanged assertions.
  `/tmp/jj-smoke-standalone-dominance.log`.

CI now runs the raw API test under WASM whenever jj-sim is selected. This repair
must pass a genuine green CI containing the commit before either bead closes.
It does not deliver the W03 buff, boomerang scaling, particles or timers.
# Vendored licence bookkeeping follow-up

CI [3342](http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/3342)
failed checks because Cargo.lock omits `source` for the path-patched Rapier crate,
and the credits checker incorrectly read that as removal of a dependency.
The generator and checker now identify third-party path crates from `vendor/*/Cargo.toml`.
Rapier remains in the shipped credits under Apache-2.0; the generated list is byte-identical
to the committed list. `node tools/licences/check.mjs` passes, and `node --test
tools/licences/` passes 6/6 on the Mac/Node 26.10.0, including defect injection for a
missing vendored credit and a missing licence. CI is still required.

