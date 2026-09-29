# Spike B — LODs, batching & texture compression (2026-09-29)

**Question:** does the 0.2 art↔game contract for level-of-detail, draw-call cost and compressed
textures work end to end, with real measured numbers, on the Part-A "Cruz Missile" asset?

**Verdict: mostly yes, with two concrete gaps to design before it's a real contract.**

1. LOD generation, visual comparison and separate-file packaging: **pass**.
2. Batching: **pass for the numbers, FAIL for the naive claim.** Merging/batching a car's parts into
   one draw per material is a large, real win. `THREE.BatchedMesh`'s often-quoted "flat draw count
   regardless of count" is **only true for a single shared camera** (arena Overview, §6.4). In Grid
   mode (§6.2, one camera per tile) draws still scale with tile count no matter the strategy, because
   each tile needs its own `render()` call. Also: batching an *intact* car is not compatible, as
   implemented, with per-part detach/damage — a real gap the plan already flagged (§6.7, "qualify
   identity, per-part deformation and detach... instead of assuming BatchedMesh handles them [S14]").
   This spike confirms that caution was correct and still unresolved.
3. Texture compression: **pass**, with one toolchain gap: KTX-Software isn't on Homebrew here, so
   `@gltf-transform/cli`'s `etc1s`/`uastc` (which shell out to the `ktx` CLI, no bundled fallback)
   needed a manually-fetched binary. Documented exactly, reproducible, but a real pipeline needs to
   vendor this deliberately rather than assume `brew install` works.

All work is in `spikes/art-pipeline/B-lod-batching/`. Nothing outside this directory was touched.

---

## Setup / versions

| Tool | Version |
|---|---|
| Blender | 5.2.2 LTS, headless (`blender -b -P ...`) |
| Three.js | r182 (`0.182.0`, repo's `node_modules`) |
| `@gltf-transform/cli` | 4.5.1 (via `npx --yes`) |
| KTX-Software `ktx` CLI | 4.4.2 (see "Texture compression toolchain" below — not from Homebrew) |
| Playwright | 1.57.0, `chromium.launch({ channel: 'chrome' })` |
| Chrome | 154.0.8037.58 (system Chrome, headless) |
| Node | v24.14.0 |
| GPU (measured via `WEBGL_debug_renderer_info`) | `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)` |

**Headless-GPU finding:** headless Chrome on this Mac reports the real Metal-backed GPU (not
SwiftShader), and `WEBGL_multi_draw` is present and actually exercised (confirmed both by
`gl.getSupportedExtensions()` and by the flat draw-call counts in the Overview results below). The
brief's "note headless limits" caveat did not bite here — treat this as a pleasant, environment-
specific result, not a general guarantee for CI machines without a real GPU.

---

## Task 1 — LOD generation

**Script:** `make_lods.py` (headless Blender). Loads the Part-A `cruz_missile.blend` fresh per LOD,
strips the per-part dent shape key (see decision below), applies a per-mesh `DECIMATE` modifier
(ratio tuned to hit the target), and exports.

| LOD | Triangles | vs LOD0 | GLB size | Dent shape key | Decals |
|---|---|---|---|---|---|
| LOD0 | 9,152 | 100% | 1.81 MB | kept | kept |
| LOD1 | 3,630 | 39.7% | 1.24 MB | **dropped** | kept |
| LOD2 | 1,270 | 13.9% | 179 KB | **dropped** | **dropped** (2 meshes) |

### Decisions (full rationale in `make_lods.py`'s module docstring)

- **Dent shape key dropped at LOD1/2.** Blender's `Decimate` modifier cannot be applied to a mesh
  that has non-Basis shape keys (`modifier_apply` raises). Re-decimating a dented target shape
  independently and keeping topology correspondence isn't headless-scriptable with `bpy`'s Decimate.
  Since LOD1/2 exist for medium/small projected sizes, a per-vertex crumple is sub-pixel there anyway
  — LOD0 (the only level close enough to matter) keeps it.
- **Separate GLBs per LOD** (`cruz_missile.lod{0,1,2}.glb`) rather than one glTF with `_LODx`-suffixed
  nodes. The plan's own contract language for higher detail ("available by immutable self-hosted
  URLs") is already a per-file model — one client only downloads the bytes for the LOD it picked,
  instead of every client fetching all three LODs bundled in one file.
- **Object names, parenting, pivots, colliders and markers are untouched across LODs** — Decimate is
  a mesh-data-only operation; `col_*` and empties (`wheel_*` hubs, `lplate_*`, `cam_fp`, etc.) are
  excluded from decimation entirely, so physics/anchors stay identical across visual LODs as the
  contract requires.
- **Decal meshes (2 tiny 2-tri quads) are dropped entirely at LOD2** — unreadable at that distance,
  and cheap to cut. Meshes under 40 faces are left untouched by Decimate (nothing useful to collapse).

### Visual check (target pixel height matched exactly via binary-searched camera distance + real
camera-projection math, not a paraxial approximation)

`render_lod_compare.py` renders each LOD at the pixel height it would actually appear at:
LOD0 @ 300px, LOD1 @ 120px, LOD2 @ 40px (measured **300.0 / 120.0 / 40.0px** exactly). See
`out/lod_contact_sheet.png` (also `out/lod_compare_{0,1,2}.png` individually). All three read clearly
as the Cruz Missile at their size; LOD2 loses the decal (by design) but silhouette, paint colour,
spoiler and wheels still read fine at 40px.

### Contract implication

The plan's §12.4 hypothesis (close 1-3k / medium 500-1k / distant 150-400 tris) undershoots what this
*specific, dentable* LOD0 needs (9.2k, per Part-A finding #2) — but LOD1 (3.6k) and LOD2 (1.3k), once
dents are dropped, land close to the medium/distant bands (slightly over). Recommend revising the
bands for a dentable car family to roughly **LOD0 ~8-10k / LOD1 ~3-4k / LOD2 ~1-1.5k**, or — per the
owner's follow-up in §12.4 — re-authoring LOD0 to spend geometry on silhouette/crumple zones only;
the current LOD0 was inherited from Part-A's "dents need subdivided panels" finding and wasn't
re-optimized in this spike.

---

## Task 2 — Draw-call batching

**Harness:** `bench.html` (Three.js `WebGLRenderer`) + `bench.mjs` (Playwright driver, headless system
Chrome). Three strategies, all sharing the same loaded LOD GLB:

- **`separate`** — every part is its own `Mesh` + a per-part inverted-hull ink outline `Mesh`
  (today's approach; ~27 parts + ~25 hulls = ~52 draws per intact car at LOD0/1, 50 at LOD2).
- **`merged`** — one merged `BufferGeometry` per material for the whole intact car (via
  `BufferGeometryUtils.mergeGeometries`, vertices pre-baked into car-local space) + one merged hull
  geometry. ~9 materials + 1 hull ≈ 10 draws per car, using `Mesh` objects that all share the SAME
  geometry across cars (geometry computed once, not per car).
- **`batched`** — the same merged-per-material geometries fed into one `THREE.BatchedMesh` per
  material (+1 for the hull), `addInstance`/`setMatrixAt`/`setColorAt` once per car. Geometry
  computed once, instance count = N.

Per-tile "own car" chase camera matches the existing `ingame.html` composition. Cars are spread
around a 180m-radius circuit (not clustered, unlike the Part-A hero shot) so each tile mostly sees
its own car, the way cars would actually be spaced on a track — clustering them would flatter every
strategy equally and hide the scaling difference.

**Measurement:** `renderer.info.autoReset = false`; `info.reset()` once per logical frame, then all
N tile `render()` calls happen, then `info.render.calls/triangles` is read — giving the *summed*
draws-per-frame across every tile, as the brief asked. 1 warm-up frame (shader compile) + 120 measured
frames via `requestAnimationFrame`, `frameMs.avg/p50/p95` from `performance.now()` deltas.

### Per-tile LOD selection by projected size

`pickLod(tileHeight)` estimates own-car pixel height as `0.46 x tileHeight` (calibrated from Part-A's
measured 220-270px own-car height in a 540px-tall tile) and picks LOD0 (>=300px), LOD1 (100-300px) or
LOD2 (<100px). This is a coarse **per-run** (one LOD for the whole grid at a given N), not a true
per-instance-per-view selector — see "Remaining gaps" below.

### Grid mode (§6.2: N tiles, N camera passes, 3840x2160 canvas)

| N | LOD (auto) | strategy | draws/frame | tris/frame | avg ms | p95 ms |
|---|---|---|---:|---:|---:|---:|
| 4 | 0 | separate | 328 | 109,832 | 1.07 | 1.5 |
| 4 | 0 | merged | 70 | 109,832 | 0.44 | 0.8 |
| 4 | 0 | batched | 48 | 109,832 | 0.56 | 1.1 |
| 12 | 0 | separate | 2,064 | 695,576 | 4.12 | 5.0 |
| 12 | 0 | merged | 430 | 695,576 | 1.07 | 1.4 |
| 12 | 0 | batched | 144 | 695,576 | 1.23 | 2.8 |
| 24 | 1 | separate | 6,884 | 924,680 | 10.82 | 12.3 |
| 24 | 1 | merged | 1,438 | 942,928 | 2.82 | 3.5 |
| 24 | 1 | batched | 288 | 942,928 | 2.23 | 2.8 |

Isolating LOD's contribution from batching's, at N=24 (LOD forced instead of auto):

| N=24, LOD forced | strategy | draws | tris | avg ms |
|---|---|---:|---:|---:|
| 0 | separate | 6,884 | 2,331,216 | 13.97 |
| 0 | batched | 288 | 2,377,280 | 2.22 |
| 2 | batched | 240 | 329,936 | 1.93 |

**Finding:** for a fixed strategy, draw-call count barely changes between LOD0 and LOD1 (same
mesh/material count, only geometry density differs) — LOD2 drops the decal meshes so its batch count
drops too. **LOD's lever is triangle throughput** (2.33M -> 0.94M -> 0.33M), which is why `separate`
still improves 13.97ms -> 10.82ms from LOD alone with an *identical* draw count. **Batching's lever is
draw-call/CPU-submission count.** They are complementary, not substitutes.

Evidence screenshots: `out/bench_grid_{separate,merged,batched}_n24_auto.png` — all render correctly
with per-car identity paint colours and a couple of small distant rivals visible in the background of
some tiles (realistic — see the circuit spacing note above).

### Overview mode (§6.4: ONE shared camera framing the whole circuit — one `render()` call/frame)

This is the case that actually isolates the batching win from the "N tiles need N camera passes"
cost, which Grid mode pays regardless of strategy.

| N | strategy | draws/frame | tris/frame | avg ms |
|---|---|---:|---:|---:|
| 24 | separate | 757 | 101,642 | 1.35 |
| 24 | merged | 155 | 101,642 | 0.57 |
| 24 | batched | **12** | 101,642 | 0.39 |
| 48 | separate | 1,433 | 193,698 | 2.63 |
| 48 | merged | 301 | 202,822 | 0.70 |
| 48 | batched | **12** | 202,822 | 0.42 |
| 96 | separate | 2,837 | 382,458 | 5.05 |
| 96 | merged | 587 | 391,582 | 1.26 |
| 96 | batched | **12** | 391,582 | 0.49 |

**`batched` draws stay flat at 12 from N=24 to N=96** — quadrupling the car count added zero draw
calls, because `WEBGL_multi_draw` folds every frustum-visible instance of a material into one native
GL call. `separate` and `merged` both scale ~linearly. This directly validates R66 "no caps": batched
drew **96** cars (0.49ms) faster than separate drew **24** (1.35ms). Evidence:
`out/bench_overview_{separate,merged,batched}_n{24,48,96}_1.png`.

### Honest caveats / things that did NOT go as the naive story predicts

1. **In Grid mode, `batched` is not always fastest.** At N=4 and N=12, `merged` beat `batched` on
   frame time (0.44 vs 0.56ms; 1.07 vs 1.23ms) — `BatchedMesh` carries fixed CPU overhead (matrix/
   colour-texture uploads, per-instance frustum-test bookkeeping) that only pays for itself once the
   draw-call savings are large enough. The crossover in this test is around N~=24. **Recommendation:
   default to `merged` for the per-tile own-car case; reserve `BatchedMesh` for Overview/arena camera
   and any other single view that must show many cars at once** (a crowded derby, a killcam-free
   highlight reel render, etc.), where it wins by 10-60x.
2. **`BatchedMesh.setColorAt` silently renders solid black without an explicit fix.** Tinting an
   instance requires `material.vertexColors = true`, which makes the vertex shader multiply by a
   `color` **geometry attribute** before multiplying by the per-instance batching colour
   (`three/src/renderers/shaders/ShaderChunk/color_vertex.glsl.js`). If the geometry has no `color`
   attribute, WebGL feeds the disabled generic attribute's default `(0,0,0,1)` — i.e. **every vertex
   renders black**, and the per-instance tint never has anything to multiply against. Caught via the
   Overview screenshot showing solid black car silhouettes instead of identity colours; fixed by
   writing an explicit all-white `color` attribute onto the paint geometry before batching (see
   `bench.html`'s `buildBatched()` comment). This is a real, non-obvious integration gotcha worth
   carrying into the production renderer.
3. **Batching an intact car is incompatible, as implemented, with per-part detach/damage.**
   `mergeGeometries` requires a consistent attribute layout across all parts being merged; getting it
   to succeed required stripping vertex-colour AO and ALL morph targets (the dent shape key) from
   every part first. A merged/batched car has **no per-part boundaries left** to detach a door or
   blow off a bumper from. This confirms the plan's own §6.7 caution ("qualify identity, per-part
   deformation and detach with the selected batching path instead of assuming BatchedMesh handles
   them [S14]") was correct and remains **unresolved** — a real engine would need detachable parts to
   live in a separate (small, per-part-type) mesh/batch set from the "commonly intact" merged body,
   promoted out of the batch the moment they detach. Not designed here; flagging as follow-up work.
4. Numbers are relative-ordering evidence from a bare scene (no shadows, no post pipeline, no
   physics) on one Mac's headless Chrome — not an absolute production frame-time budget.

---

## Task 3 — Texture compression

### Toolchain gap: KTX-Software isn't on Homebrew here

`brew search ktx` found nothing usable (`ktx-software` formula doesn't exist; only unrelated
`mktxp`/`kty` matched). `@gltf-transform/cli etc1s`/`uastc` hard-depend on shelling out to an external
`ktx` binary — confirmed in its source (`@gltf-transform/cli/src/transforms/toktx.ts` spawns `ktx`
directly, `TrustedCommand.KTX = 'ktx'`), **no bundled WASM fallback**. Worked around by downloading
the official `KhronosGroup/KTX-Software` **v4.4.2** macOS arm64 release `.pkg` from GitHub Releases
and extracting it with `pkgutil --expand-full` (no system install, no `sudo`): the `ktx` binary's
rpath (`@executable_path/../lib`) resolves against a sibling `lib/libktx.4.dylib` symlink, so it runs
standalone from any directory. This is a build-time tool download (compliant with R70 — runtime
decoders stay self-hosted, see below), but **a real CI/build image needs to vendor this binary
deliberately** rather than assume `brew install ktx-software` works; recorded exact version (4.4.2)
for pinning.

### File size / GPU memory comparison (LOD0 GLB; `decal_sheet.png`, 1024x1024, is the only texture)

| Variant | GLB size | Texture disk size | Texture est. GPU size |
|---|---:|---:|---:|
| Original (PNG) | 1.81 MB | 893.8 KB | 5.59 MB |
| ETC1S (Basis, `KHR_texture_basisu`) | 1.04 MB | 131.1 KB | 1.4 MB |
| UASTC (Basis, `KHR_texture_basisu`) | 1.43 MB | 543.9 KB | 1.4 MB |
| meshopt (geometry only, `EXT_meshopt_compression`) | 1.06 MB | 893.8 KB (still PNG) | 5.59 MB |
| Draco (geometry only, `KHR_draco_mesh_compression`) | 1.19 MB | 893.8 KB (still PNG) | 5.59 MB |
| **ETC1S + meshopt combined** | **343 KB** | 131.1 KB | 1.4 MB |

ETC1S alone cuts the texture 6.8x on disk and 4x in VRAM. Combining ETC1S with meshopt geometry
compression cuts the **whole GLB** by 81% (1.81 MB -> 343 KB) with no separately-added quality cost
(meshopt is lossless-ish quantized geometry, not a texture change).

### Visual check

`out/compression_contact_sheet.png` — all 6 variants rendered side by side at the same camera/frame;
**no visible difference**, and the "CRUZ MISSILE" decal text reads cleanly in every variant including
the 343 KB ETC1S+meshopt combo. UASTC is visually indistinguishable from ETC1S here (as expected — the
decal has flat colour regions and sharp text, not the smooth gradients where ETC1S block artifacts
usually show up first); recommend keeping UASTC available as a per-texture override rather than
defaulting to it, since it does cost 4x the disk size of ETC1S for identical GPU memory.

### Runtime load test — self-hosted decoders, no CDN (R70)

`compress_test.html` loads each variant via `GLTFLoader` wired to:
- `KTX2Loader.setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/')`
- `DRACOLoader.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/')`
- `MeshoptDecoder` (bundled ES module, no separate path)

All served by our own `python3 -m http.server` from the repo root — **never a CDN**. All 6 variants
(original, etc1s, uastc, draco, meshopt, etc1s+meshopt) loaded and rendered without error; the
combined-decoder path (`etc1s.meshopt.glb`, using both `KHR_texture_basisu` and
`EXT_meshopt_compression` in one file) worked on the first try. `usesBasisu` (checked via
`material.map.isCompressedTexture`) was confirmed `true` for all Basis variants.

**Production note:** "self-hosted" here meant pointing directly at `node_modules` (already local,
never fetched remotely) — sufficient to prove the loading path, but `node_modules` typically isn't
part of a deployed static bundle. A real build needs an explicit step copying
`basis_transcoder.{js,wasm}`, `draco_decoder.*` and `meshopt_decoder.module.js` into the served
static asset tree (e.g. `static/vendor/basis/`, `static/vendor/draco/`) so the runtime path isn't
accidentally left pointing at a dev-only location.

### Recommendation

Adopt **ETC1S + meshopt** as the default combined export step for vehicle GLBs (biggest win, no
visible loss on this asset); make UASTC an available per-texture override for textures with smooth
gradients/normal maps where ETC1S artifacts might show. Pin KTX-Software 4.4.2's `ktx` binary in the
build image/CI rather than relying on Homebrew.

---

## Recommended concrete contract changes (§12.3/§12.4)

1. **LOD packaging:** ship `<vehicle>.lod{0,1,2}.glb` as separate files (not multi-LOD nodes in one
   glTF) plus a `lods.json`/sidecar field per LOD (`triangles`, `dropped_meshes`, source ratio).
   Validator should NOT require morph targets to be present on LOD1/2 if a vehicle's contract marks
   them dent-capable only at LOD0 (needs an explicit sidecar flag, e.g. `dents_lod_max: 0`).
2. **LOD triangle budgets:** revise the plan's 1-3k/500-1k/150-400 hypothesis for dentable cars to
   roughly 8-10k / 3-4k / 1-1.5k (measured here), pending a leaner LOD0 re-authoring pass per the
   owner's "spend geometry on silhouette, not universal subdivision" follow-up.
3. **Batching contract:** default the Grid/own-car-tile renderer path to the `merged` strategy (one
   mesh per material per intact car, shared geometry across identical cars); reserve `BatchedMesh` for
   Overview/arena camera and other single-view-many-cars cases. Explicitly scope a follow-up design
   for **detachable parts under batching** — they cannot live inside a merged/batched intact-car mesh
   as implemented here; this is new work, not solved by this spike.
4. **Texture/geometry compression:** make ETC1S (`KHR_texture_basisu`) + meshopt
   (`EXT_meshopt_compression`) the default GLB export step; vendor a pinned `ktx` CLI binary (4.4.2
   confirmed) in the build image; add a static-asset build step that copies the self-hosted
   transcoder/decoder files out of `node_modules` into the deployed static tree.

## What this spike did NOT cover (explicitly out of scope / unresolved)

- Per-instance-per-view LOD selection (this spike picks one LOD per whole benchmark run, not per car
  per camera the way §6.7 ultimately wants).
- Detachable-part batching/damage compatibility (flagged above as unresolved, needs its own design).
- Toon-ramp/ink-outline shading was simplified to plain glTF PBR materials + a flat black hull for the
  batching benchmark (kept the *draw-call cost* of the outline, dropped the *shader style*) — visual
  style parity with `ingame.html` was not re-verified here.
- Production frame budget under full game load (shadows, post pipeline, physics, real player camera
  motion) — only relative strategy/LOD ordering was measured.
