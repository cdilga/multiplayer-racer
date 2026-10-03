# P1-M03a: seeds, streams, assembly and `jj procgen`

Date 2026-10-03, GentlePike. Bead `br-p1-m03-74i.1`. Closes on green Gitea CI (`ev:ci`); this folder holds the test
output and byte hashes the bead asks for.

## What exists

- `crates/jj-procgen/src/seed/`: one seed → named streams (`structure`, `dressing`). xoshiro256** seeded through
  SplitMix64 from `seed ^ FNV-1a(name)`; `unit()` takes the top 53 bits. Adding a stream never shifts another.
- `crates/jj-procgen/src/assemble/`: `TrackSpec` (centerline, width, surface, dressing, props) → `jj.map.v1` through
  `jj-map` (gates every 40 m from a finish 60 m in, the start corridor behind it, recovery over the whole loop, bounds with
  a 60 m margin, a 10 m terrain grid whose surface follows the road), then `canonicalise`. Maths through `libm`, output
  integers only.
- `jj_procgen::generate(seed)`: a **placeholder** generator (generator id `jj.procgen.placeholder` v1): a Catmull-Rom loop
  through 9 seeded control points from the structure stream, resampled every ~2.5 m at 12 m wide, plus buildings and cones
  from the dressing stream. A building draw that lands within 26 m of the road is redrawn, so dressing never constrains
  the route. P1-M03b's course graph replaces the structure; the plumbing stays.
- `jj procgen --seed N [--json] [--out <dir>]`: generates, validates against the kit registry (`assets/kit`, else the
  built-in generic registry), writes `map.json`, `map.bin` (canonical bytes) and `report.json` to
  `target/jj-runs/procgen-<seed>/`, prints the report, exits 1 if the map fails validation and 2 on usage or I/O.

## Acceptance → tests

| AC | Test | Where it ran |
|---|---|---|
| Same seed → identical canonical bytes natively and in WASM | `tests/procgen.rs` `the_same_seed_gives_identical_canonical_bytes`, `seeds_hash_to_the_committed_goldens`; `tests/wasm_parity.rs` `golden_seeds_in_wasm_match_the_native_hashes` (CI step "WASM parity in Node") | Mac arm64 native (blessed the goldens), Node WASM on the Mac, Linux x86-64 through RCH, Gitea CI |
| Changing only the dressing stream never moves the route | `changing_only_the_dressing_stream_never_moves_the_route` (40 seeds × 3 swapped dressing streams: route and reference lap identical, dressing different, still valid); control `changing_the_structure_stream_does_move_the_route` | same |
| `jj procgen --seed N --json` generates, validates, dumps | `crates/jj-tools/tests/procgen_cli.rs` (the dumped `map.bin` equals the canonical bytes of the dumped `map.json`, hashes to the printed `gameplayHash`, `report.json` equals stdout; no `--seed` exits 2); CI step "A generated map validates" | RCH (Linux), Gitea CI |

Also `generated_maps_pass_the_validator`: seeds 0–63 plus the golden seeds all pass `jj-map`'s validator (a sample, not
a limit).

## Byte hashes (gameplay hash = SHA-256 of the canonical bytes)

`crates/jj-procgen/tests/goldens/seeds.txt`, identical on Mac arm64 native, Node WASM and Linux x86-64:

```
0 7b11a1c94723ad9775edc5a52dfc03618ab8fd6c5505791b7605693dd9e19a77
1 0ab0c2f0b603643a714bf7173e3238b0df8468c51dd2c011466dec5455f21c46
2 c29597655675bc158db0412030637fa3eef8051306abd6a385c567a649847040
3 87ee09b2eae7d875573541ec04f71ea7f38ce3a3dfd76c7cddfd1136162af5e2
42 5add1c9b2b380107461e09fbe3d1bca1699278893a55c061cac22fb9c7928a2f
1000003 cedcd49bcdcb3d01ee964b6dcb52632633115371a14019ace4cc6423f1e1987e
3735928559 56fabda071c0337a71e2657b724d85ddce2a306365aaf87b017f554e39dc1c3e
18446744073709551615 00a2a94dd5db52ea7333113f82d38516a5ce59278a10c1da42361478a55ffee2
```

`jj-procgen-seed-42.json` is `jj procgen --seed 42 --json` run on an RCH Linux worker: 311 route points, 19 gates,
reference lap 51.9 s, 9 buildings, 4 cones, no violations, hash `5add1c9b…` = the golden blessed on the Mac.

## Local runs

```
$ cargo test -p jj-procgen                         (Mac, per-crate)        6 passed
$ cargo test --target wasm32-unknown-unknown -p jj-procgen --test wasm_parity   (Node WASM)   1 passed
$ rch exec -- cargo clippy --locked --all-targets --no-deps -p jj-procgen -p jj-tools -- -D warnings   exit 0
$ rch exec -- cargo test --locked -p jj-tools      procgen_cli + scenarios passed
$ rch exec -- cargo test --locked -p jj-procgen    6 passed
```

## Known gaps

- The placeholder is flat (heights 0, bank 0) and one biome (greybox); terrain, biomes, features and the course graph are
  M03b onwards.
- Goldens pin the placeholder's output; any intended generator change bumps `PLACEHOLDER_VERSION` and re-blesses with
  `JJ_BLESS=1 cargo test -p jj-procgen --test procgen`.
