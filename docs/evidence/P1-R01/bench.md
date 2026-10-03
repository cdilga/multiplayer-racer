# P1-R01 · Renderer backend decision

**Decision: WebGLRenderer** (`web/host/src/render/backend.ts`, `DEFAULT_BACKEND = 'webgl'`). The bead's DEFAULT
rule picks WebGPURenderer only if it is within 15 % of WebGLRenderer; on the reference host it is 2–7× slower, so
Playtest 1 ships WebGLRenderer. WebGPURenderer stays available as a lazily loaded chunk (`?renderer=webgpu`, or
`?renderer=webgl2` for its WebGL2 backend) so the decision can be re-measured when three or Chrome move.

## Run

- **Hardware:** Apple M1 Pro (the reference host that drives the TCL), macOS, arm64.
- **Browser:** Google Chrome 154.0.8037.95, **headed** (Playwright, `--enable-unsafe-webgpu`), the Mac's GPU. No
  headless or SwiftShader numbers.
- **Build:** the R01 working tree on `fe5c14ce3ce5`, production (minified) `npm --prefix web run build`.
- **Cohort:** 24 baked Cruz Missiles (P1-V02's `cruz-missile.lod1.glb`, 890 tris) on a starting grid × 24 chase-camera
  tiles on one canvas (5×5), every tile drawing the whole pack: Spike J's worst case, ported into the host
  (`host/?bench`, `web/host/src/render/bench.ts`). One InstancedMesh per GLB part. 10 warm-up frames, then 120 timed
  frames each waited to GPU completion (`median`, `p90`), then 120 back-to-back frames with one wait at the end
  (`throughput`, so a backend that pipelines isn't penalised by the per-frame wait).
- **Command:** `npm --prefix web run build && node web/host/tests/bench.mjs` → `bench.json`.

| Backend | Canvas | Shadows | Draws/frame | ms median | ms p90 | ms throughput |
|---|---|---|---:|---:|---:|---:|
| WebGPU (WebGPURenderer) | 1920×1080 | off | 312 | 7.1 | 8.0 | 5.79 |
| WebGPU (WebGPURenderer) | 1920×1080 | on | 312* | 8.7 | 8.9 | 5.97 |
| WebGPU (WebGPURenderer) | 3840×2160 | off | 312 | 18.6 | 19.5 | 17.37 |
| WebGPU (WebGPURenderer) | 3840×2160 | on | 312* | 20.5 | 20.9 | 18.85 |
| WebGL2 (WebGPURenderer) | 1920×1080 | off | 312 | 6.2 | 8.2 | 3.71 |
| WebGL2 (WebGPURenderer) | 1920×1080 | on | 312* | 8.2 | 9.6 | 3.77 |
| WebGL2 (WebGPURenderer) | 3840×2160 | off | 312 | 13.4 | 13.8 | 11.55 |
| WebGL2 (WebGPURenderer) | 3840×2160 | on | 312* | 13.6 | 13.9 | 11.68 |
| **WebGL2 (WebGLRenderer)** | 1920×1080 | off | 288 | **2.8** | 3.7 | **2.57** |
| **WebGL2 (WebGLRenderer)** | 1920×1080 | on | 552 | **6.4** | 8.7 | **3.98** |
| **WebGL2 (WebGLRenderer)** | 3840×2160 | off | 288 | **4.9** | 6.2 | **2.33** |
| **WebGL2 (WebGLRenderer)** | 3840×2160 | on | 552 | **9.2** | 9.5 | **6.92** |

\* WebGPURenderer's `info.render.drawCalls` doesn't count its shadow pass, so its shadow rows show the same draws as
without shadows; the timings include the pass.

At 4K (the TCL at native resolution, R111) WebGLRenderer draws the 24×24 worst case in 2.3 ms (no shadows) to 6.9 ms
(shadow map per tile) of GPU throughput; WebGPURenderer needs 17–19 ms, which alone would spend a 60 Hz frame.

## Forced fallback

`?renderer=webgl2` forces WebGPURenderer's WebGL2 backend (the path a WebGPU-first host takes when WebGPU is missing).
The CI test renders the same frozen synthetic frame (24 cars, tick 599.5) through WebGLRenderer and the fallback and
compares the captures: mean channel difference 0.19 / 255, 0.13 % of pixels differ by more than 48
(`browser-run.json`, `frame-webgl.png`, `frame-webgl2-fallback.png`).

## Not measured

- triton's GTX 1080 and eris's RTX 2080 SUPER as second data points (optional in the bead: "if clear"): not run in
  this session. The bench needs a headed browser driving that GPU; run `node web/host/tests/bench.mjs` there to add a
  row. The 2–7× margin on the reference host makes a different decision from either unlikely.
- The TCL itself (its own browser) is P1-Q02's playtest device.
