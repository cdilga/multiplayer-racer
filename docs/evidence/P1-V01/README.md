# P1-V01 evidence: the vehicle contract and validator

`local-checks.txt`: `cargo test -p jj-contracts` on eris (3 tests) and `jj validate --json` on a valid vehicle, a broken one
and the greybox (exit 1, naming `mass-sum`). Clippy clean (`--no-deps -p jj-contracts -p jj-tools -D warnings`).

| Acceptance | Test |
|---|---|
| A small hand-made valid fixture (GLB + sidecar) passes | `the_hand_made_vehicle_passes`: `tests/fixtures/vehicle/valid/` (three LOD GLBs + `toy.asset.json`, written by `tools/vehicles/contract-fixtures.mjs`: the 11 contract parts at real pivots, the 6 anchors, one atlas material, a rounded 12-sided cabin proxy, 196 triangles per LOD) |
| Ten deliberately broken fixtures each fail with a named rule (mass sum, origin, cuboid cabin proxy, a missing part at one LOD, a missing anchor, a triangle budget breach…) | `every_broken_vehicle_fails_with_the_rule_it_names`: 16 broken cases, each with an EXPECT file: `mass-sum` (fractions 0.92), `origin-ground` (car lifted 10 cm), `cabin-proxy-cuboid` (proxy mesh is a box; and declared cuboid), `part-missing-at-lod` (no door_RL at LOD1), `anchor-missing` (no roof_number at LOD0), `tri-budget` (700 tris at LOD2), `pivot` (GLB vs sidecar; and LOD2 vs LOD0), `materials` (two), `hinge` (zero axis), `origin-axles` (axles off centre), `part-unknown`, `schema`, `collider-missing`, `draws` |
| `jj validate --json` reports machine-readably and exits non-zero on failure | `local-checks.txt` (JSON per file: kind, ok, triangles per LOD, violations with rule/at/detail; exit 1) |

The contract (`crates/jj-contracts/src/vehicle.rs`, schema `art/contracts/vehicle.schema.json`, kept in step by
`the_json_schema_names_the_same_parts_and_anchors`): sidecar `jj.vehicle.v1` (units m, +y up, +z forward, origin on the
ground between the axles; parts with pivot, hinge axis + loose limits, mass fraction, collider type; anchors; one
material; LOD files with budgets no higher than 1,300 / 900 / 600 triangles). The validator reads the GLBs themselves
(`crates/jj-contracts/src/glb.rs`, a minimal GLB 2.0 reader with no dependencies): part nodes at every LOD with pivots as
declared and identical across LODs, anchors, one material, at most one draw per part, triangles per LOD, the lowest
vertex on the ground, wheels centred about the origin, and LOD0 collider proxies typed as declared, with a cabin that
really is rounded.
