# Draft upstream issue for dimforge/parry (br-zrat AC3): not filed yet

Filing it is outward-facing (a public issue from the owner's account), so it waits for the owner's go-ahead.

---

**Title:** `HeightField` ray cast (dim3): a vertical ray exactly on a cell edge can miss the field

**parry3d 0.31.1**, `src/query/ray/ray_heightfield.rs`, `impl RayCast for HeightField` (dim3).

`cast_local_ray_and_get_normal` looks up the cell under the ray's entry point with `cell_at_point`, tests that cell's
two triangles, then steps to the next cell along the ray's x and z. A ray straight down (`dir.x == dir.z == 0`), or one
whose sideways travel inside the field is far smaller than a cell, never steps. When it stands exactly on a cell edge,
rounding can pick the cell whose triangles don't contain the point (a hair to one side of it), and the ray misses the
heightfield outright.

Repro: a flat 38 x 17 field of 10 m cells (all heights 0), rays from y = 0.5 straight down with max toi 2.0. Rays at
x = 20 and x = 0 (vertex columns) return `None`; x = 60, x = -130 and x = 20 +/- 0.001 hit at 0.5. A rapier
raycast-vehicle wheel on such a line loses its ground: a level vehicle on a grid line falls through flat ground.

Workaround we ship (vendored, one block): when the ray hits neither triangle of its cell and its sideways travel inside
the field (`hypot(dir.x, dir.z) * max_t`) is under 1 mm, also test the eight neighbouring cells and return the nearest
hit. An exact-zero guard (`dir.x == 0.0 && dir.z == 0.0`) is not enough: across platforms the same "vertical" ray can
come out exactly vertical on one and an ulp off on another, and the repair then runs on only one of them.

A test that pins it: every grid line, +/- 1 mm, for an exactly vertical ray and two an ulp or so off vertical, hits at
the ground's height.
