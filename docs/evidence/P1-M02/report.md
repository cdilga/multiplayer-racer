# P1-M02 · G-PROCSPIKE: report and recommendation

Throwaway spike `spikes/procgen/` (its own Cargo workspace; it depends on `jj-procgen` and `jj-map`, nothing in
`crates/` depends on it). It takes jj-procgen's seeded course and jj-map's `jj.map.v1` model and validator, and tries
three undulation candidates and three scatter candidates in each of the four Playtest-1 biomes. The maps are drawn and
driven on the real host (`/host/?mapUrl=…`, the real sim worker, the baked Cruz Missile).

## How to reproduce

```bash
cd spikes/procgen && cargo build --release && ./target/release/procgen-spike bench 8 out \
  && cargo build --release --lib --target wasm32-unknown-unknown && node wasm-check.mjs out
npm --prefix web run build && node web/host/tests/procgen-spike.mjs
# compare sheets: montage the nine captures/<biome>-<undulation>-<scatter>.jpg per biome, 3x3 (see self-review.md)
```

## Candidates

| | Candidate | What it is |
|---|---|---|
| Undulation | `flat` | Baseline, no relief. |
| | `noise` | fBm value noise over the whole map. The road follows the ground. |
| | `route` | A closed height profile along the route with a bounded grade. The road bed is level across its shoulders, and off-road ground blends from the road's height into noise over 40 m. |
| Scatter | `poisson` | Bridson Poisson-disc at the biome's spacing. |
| | `blue` | Mitchell best-candidate for a fixed count (the same count as Poisson). |
| | `cluster` | Thomas process: Poisson parents with Gaussian children. |

Every scatter keeps each piece's whole footprint off the road corridor, and tall pieces 2.5 m clear of the road edge
(the validator's camera rule wants 2 m). Biome presets are data: road and ground surface, relief amplitude and
wavelength, spacing, and pieces (kit id, weight, parameter ranges, setback from the road, collides). The biome kits are
M04–M07, so the spike dresses with `generic/*` pieces.

## Evidence

- `compare-<biome>.jpg`: the nine undulation × scatter candidates for each biome, seed 1, at 1280×720 on the real
  host. Single captures are in `captures/`.
- `drives/<biome>.webm`: a recorded keyboard drive through each biome on the recommended candidates (real sim worker,
  chase camera). `host-run.json` holds the numbers.
- `spikes/procgen/out/bench-native.json` (288 rows: 4 biomes × 3 × 3 × 8 seeds) and `bench-wasm.json`.

### Determinism and generation time

| Measure | Result | Budget |
|---|---|---|
| Native repeatability (same seed twice → same canonical bytes) | 288/288 | must hold |
| Native vs WASM canonical bytes (FNV of the canonical map) | 288/288 identical, 0 mismatches | must hold |
| Native generate + validate, worst of 288 (Mac, arm64, release) | 47.3 ms | ≤ 1.5 s laptop |
| WASM generate in Node 26 (V8), worst of 288 | 144 ms | ≤ 1.5 s laptop |
| WASM generate in Chromium 151, unthrottled, worst of 16 | 89 ms | ≤ 1.5 s laptop |
| Chromium at 4× CPU throttle, worst | 373 ms | ≤ 4 s phone (stand-in) |
| Chromium at 6× CPU throttle, worst | 567 ms | ≤ 4 s phone (stand-in) |
| Validator violations across all 288 maps | 0 | 0 |

The throttled Chromium figures stand in for a phone; they weren't measured on one. The real phone-host figure is owed
by the M03 core's own receipt on a device.

### Candidate statistics (means over 8 seeds)

`nnCv` is the coefficient of variation of nearest-neighbour distance (low means even, high means clumped). `relief`
is the map's height range in metres (mean over seeds). The grade column is the **maximum over the 8 seeds** of the steepest grade along the road (the means are lower: 5.6 % route, 12.6 % noise in rocks).

| Biome | Scatter: nnCv poisson / blue / cluster | Relief (mean): noise / route | Road grade, max over seeds: noise / route |
|---|---|---|---|
| town | 0.24 / 0.31 / 0.76 | 3.0 / 4.0 m | 3.7 % / 6.1 % |
| rocks | 0.17 / 0.23 / 0.72 | 10.6 / 9.9 m | **16.2 %** / 6.1 % |
| outback-dirt | 0.09 / 0.18 / 0.70 | 4.9 / 4.7 m | 5.2 % / 6.1 % |
| outback-bitumen | 0.25 / 0.30 / 0.68 | 1.9 / 3.9 m | 1.5 % / 6.1 % |

### Drives (seed 1; bitumen was driven on `blue`, see recommendation 2)

| Biome | Map | Ticks | Path | Recoveries | Upright (upY) | Page errors |
|---|---|---|---|---|---|---|
| town | route + cluster | 1568 | 409 m | 0 | 1.000 | none |
| rocks | route + cluster | 1585 | 397 m | 0 | 1.000 | none |
| outback-dirt | route + poisson | 1708 | 474 m | 0 | 1.000 | none |
| outback-bitumen | route + blue | 1615 | 169 m | 0 | 0.999 | none |

The drive is open-loop: throttle held, steering left and right in turn on wall-clock timing. Its path therefore varies
from run to run. In the bitumen run shown, the car weaved off the road and stopped against a shed 25–70 m out (it was
398 m on the previous run). It was still upright and needed no recovery. That's the script, not the map.

## Recommendation (the default for M03c, M03e, M03f)

1. **Undulation: `route` (M03c).** It's the only candidate that controls the gameplay-relevant number. The road grade
   stays at the profile's bound (6.1 %) in every biome and seed, while `noise` lets the ground set it, up to 16 % in the
   rocks biome. On the flatter biomes (town, dirt, bitumen) the spike's single 6.1 % bound is actually steeper than
   noise gave, because the spike used one max-grade value for every biome: the per-biome max-grade parameter below is
   recommended but was not exercised, so the core must set it per biome (bitumen and town lower). Off-road relief is
   about the same as `noise` in rocks and dirt (10/5 m) and higher in bitumen (3.9 vs 1.9 m), because the ground
   outside the road bed still blends into noise. The road bed is level across its shoulders, so no off-road vertex lifts the ground over
   the road. Parameters: relief amplitude, ground wavelength and max road grade per biome. Keep `flat` as a biome
   value (relief 0), not a separate algorithm.
2. **Scatter: one interface with two algorithms, chosen per biome as data (M03e).** Poisson-disc for even cover and
   clustered (Thomas) for clumps. Recommended defaults are town = cluster (buildings group into blocks and the road's
   frontage stays open), rocks = cluster (outcrops read as groups, like the Olgas), outback dirt = Poisson (even scrub
   cover, nnCv 0.09). Outback bitumen is the one call the numbers don't settle: Mitchell `blue` gives a fixed count
   with near-Poisson evenness (nnCv 0.30 vs 0.25), but Poisson at a larger radius gives the same look. So the core
   ships Poisson plus cluster, and bitumen uses Poisson. That is two algorithms, not three, and every feature earns
   its keep. Caveat: the bitumen drive and captures used `blue`; Poisson at a larger radius for bitumen is a claim
   from the statistics, not a run, and M03e's own capture settles it.
3. **Parameter surface and kit-piece format (M03f).** A biome is data: road surface, ground surface, relief, wavelength,
   max grade, scatter kind and spacing (cluster adds parent density and child spread), and a weighted list of kit
   pieces. Each piece carries its kit id, parameter ranges drawn per instance, a setback band from the road edge and a
   collides flag. The spike's `Preset`/`Piece` structs in `spikes/procgen/src/lib.rs` are that shape. Kit pieces stay
   registry entries in `assets/kit/<family>/<id>.json` with integer-millimetre/centimetre params, so generation stays
   integer-friendly and byte-identical across native and WASM.
4. **Keep the maths pure and `libm`-only.** The spike gets native = WASM bytes with no special handling because every
   function is a pure function of (seed, biome, candidates) in libm maths. The core should keep that and test it the
   same way (the canonical-bytes FNV across native and WASM per seed). The spike showed this on arm64 macOS only
   (native, Node V8, Chromium); x86 and Safari/JavaScriptCore were not run, so it is shown, not proven, and the core's
   CI should repeat it on the x86 runners. WASM timings are generation only (the validator ran natively).

## Findings the core must handle (not spike defects to fix here)

- **Road edges stair-step on diagonals.** The road surface is painted per heightfield cell (`terrain.surfaces`), so a
  diagonal straight shows a saw-tooth edge at the grid spacing in every biome (see any `compare-*.jpg`). The core
  should render the road as its own ribbon along the route, or sample the surface at sub-cell resolution. This is for
  M03 and the map renderer, not a spike tweak.
- **The plain beyond the map covered terrain below zero.** The host's off-map plain sat at y = −0.05 and hid
  undulating ground that dipped below zero (sand-coloured holes, and road sections missing in the earlier captures).
  Fixed on the host: the plain now sits just under the map's lowest ground (`web/host/src/render/world.ts`). The
  current captures were taken after the fix.
- **Pale smudges around the road in `route` rows** (dirt and bitumen sheets): the 40 m blend from the road bed into
  the noise shades as a lighter band at this lighting. Harmless in the spike; the core's blend should be judged on the
  biome's real ground look.
- **One route shape.** The spike reuses jj-procgen's seeded course, so every biome drives the same loop shape at seed 1.
  Route variety is the course generator's job (M03a/b), not the spike's.
- **Generic dressing.** Rocks scatters `generic/box-building` as stand-in domes and outback scrub is `generic/post`.
  How each biome looks belongs to its kit bead (M04–M07).
