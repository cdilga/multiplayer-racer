# Rapier 0.36.0 local dominance repair

Source: the crates.io rapier3d 0.36.0 package, Apache-2.0, authors as recorded in
Cargo.toml. Original archive SHA-256:
`c2e2b20538584bb3ba5bfe6a66c2d9a242ee17d15e5398be0fa35279c7d73739`.
`upstream.sha256` records each copied upstream file before the patch. The original
normalized manifest, source, tests, examples and README are preserved; the upstream
package does not contain a standalone licence file.

Only these four upstream source files change:

- src/dynamics/solver/contact_constraint/contact_with_coulomb_friction.rs
- src/dynamics/solver/contact_constraint/contact_with_twist_friction.rs
- src/geometry/narrow_phase/pair_update.rs
- src/geometry/contact_pair.rs

P1-W03 / br-p1-w03-zn1.1.1: masking a dominant side to u32::MAX for both reads and
writes made a moving dynamic body act as a stationary world anchor to its target.
Keep separate read ids for its actual poses/velocities and masked write ids for
impulses. Zero only the dominant side's solver inverse mass/inertia; leave its real
rigid body mass, controls and motion alone. Ordinary contact arithmetic stays on
its original path when read and write ids match. Fixed and sleeping world-attached
sides retain u32::MAX. Localize awake dynamic dominant contact anchors to their
body's centre of mass, so recycled contacts track its movement without penetration.
The patch applies only to awake dynamic dominance in the two SIMD contact models;
kinematic, sleeping and fixed conventions remain on their original paths.

The project Cargo patch points here and exactly pins 0.36.0. This is a dependency,
excluded from the application workspace members. Tests in
crates/jj-sim/tests/rapier_api.rs run against it natively and in WASM. Do not remove
the patch or update the version until the same dominance, expiry and ordinary-game
parity bank passes. 0.36.1 was inspected: its solver is unchanged and its only source
change adds a query-dispatcher setter, so it is not a dominance repair.

No gameplay item is implemented by this patch. W03 still owns the full Sanga
simulation, fixtures, renderer, timers and visual acceptance.
