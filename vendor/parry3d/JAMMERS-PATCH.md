# parry3d 0.31.1 local heightfield ray repair

**Source:** the crates.io parry3d 0.31.1 package, Apache-2.0, authors as recorded in `Cargo.toml`.
- Original archive SHA-256: `7b626edc0b497dba4bdf6e1e0797895294ed9f61dac2bd28cb5d34d37ad2ca7e`.
- `upstream.sha256` records each copied upstream file before the patch.
- The package is otherwise copied unchanged: manifest, source, tests, examples, benches and README.

**Only one upstream source file changes:** `src/query/ray/ray_heightfield.rs`, the `dim3` `RayCast for HeightField`
impl. One block is added, marked `JAMMERS PATCH`.

## The bug

`cast_local_ray_and_get_normal` looks up the cell under the ray's entry point with `cell_at_point`, tests that cell's
two triangles, then steps to the next cell along the ray's x and z.

A vertical ray (`dir.x == dir.z == 0`) never steps. When the ray stands exactly on a cell edge, rounding can pick the
cell whose triangles don't contain the point; they are a hair to one side of it. The ray then misses the heightfield
outright.

- **On a flat 38 × 17 field of 10 m cells:** rays straight down at x = 20 and x = 0 missed. x = 60, x = −130 and
  x = 20 ± 0.001 hit.
- **In the game:** a level bike placed on a grid line (`scenarios/bikes/flat-strips.json`, x = 20) lost both suspension
  rays. It fell 0.44 m onto its hull before its wheels touched. That turned `jj-procgen/tests/handling.rs`' flat banks
  red (CI 5422).

## The repair

When a vertical ray hits neither triangle of its cell, it also tests the eight cells around that cell and returns the
nearest hit.
- Rays that already hit, and every non-vertical ray, take the original path unchanged.
- No hash or golden in the project moved with the patch: the mixed-roster hash is unchanged.

## Tests and rules

- `crates/jj-sim/tests/rapier_api.rs` `a_vertical_ray_on_a_heightfield_grid_line_hits_the_ground` pins it. Every grid
  line, and ±1 mm either side, hits at the ground's height.
- The project Cargo patch (`[patch.crates-io] parry3d`) points here, alongside `vendor/rapier3d`. This is a
  dependency, excluded from the application workspace members.
- Remove the patch only for a parry release that passes that test. Upstream should get the same fix (report it at
  dimforge/parry).
