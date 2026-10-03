# P1-R02 · Instanced vehicle renderer bench

- **Hardware:** Apple M1 Pro (the reference host), macOS, arm64.
- **Browser / backend:** Google Chrome 154.0.8037.95, headed (Playwright), WebGL2 through WebGLRenderer (the P1-R01
  decision).
- **Build:** the R02 working tree on `f616716768f8`, production `npm --prefix web run build`.
- **Cohort:** 24 baked Cruz Missiles (P1-V02 LOD1, 890 tris) × 24 chase-camera tiles (5×5, 384×216 at 1080p), every
  tile drawing the whole pack, culling off: the §6.1 reference row. Drawn by the production `VehicleRenderer`
  (`web/host/src/render/vehicles/vehicles.ts`): one InstancedMesh per part type per LOD class, the tile's LOD class
  picked by camera layers. 10 warm-up + 120 timed frames waited to GPU completion; throughput = 120 back-to-back frames.
- **Command:** `node web/host/tests/bench.mjs --backends webgl --out docs/evidence/P1-R02/bench.json`.

| Canvas | Shadows | Draws/frame | ms median | ms p90 | ms throughput |
|---|---|---:|---:|---:|---:|
| **1920×1080** | **off** | **216** | **3.1** | **4.9** | 2.13 |
| 1920×1080 | per tile | 408 | 7.0 | 8.2 | 4.07 |
| 3840×2160 | off | 216 | 4.4 | 5.5 | 1.90 |
| 3840×2160 | per tile | 408 | 8.9 | 9.2 | 7.01 |

**Reference row** (§6.1, Spike J `REPORT.md`): 216 draws, 3.6 ms median / 5.1 ms p90 at 1080p (5.1 / 6.4 ms at 4K).
Measured: **216 draws, 3.1 / 4.9 ms** (4.4 / 5.5 ms at 4K): within 20 %, and faster. Spike J's bench never set
`castShadow` on its sun, so its row is the shadows-off row. Draws per tile = 8 part types (core, front, back, four
doors, one shared wheel type) + the ground.

"Per tile" re-renders the shadow map in every tile (the bench's worst case). The host draws it once per frame
(`World`, §6.1), which the CI test pins: two tiles cost 2 × (8 + 2) + 8 draws.
