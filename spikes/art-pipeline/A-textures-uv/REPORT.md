# Spike A: Textures & UVs — report (2026-09-29)

**Question:** does the art↔game contract for textures/UVs (plan §12.3/§12.4) work end to end —
packed non-overlapping UV0, a bake-only UV1, real Cycles bakes, a composited RGBA mask, a validator
that actually catches bad UVs/missing textures, and a Three.js shader that reads the mask to drive
per-player identity paint/pattern/dirt/emissive?

**Verdict: yes, GO**, with one real bug found and fixed along the way (see §6) and several contract
changes worth adopting (see §7). Everything below ran headless on this Mac; no GUI Blender, no MCP.

Scope note: this spike trims what the base `spikes/art-pipeline` spike already proved (dents, hinge
metadata, decal wordmarks, spoiler) to spend the time budget on textures/UVs specifically. The car is
a plain 6-panel "Cruz Missile" body: chassis, cabin, bonnet, boot, door_L, door_R (all `jj_paint`),
plus non-atlas parts (bumpers, glass, lights, wheels) that keep flat materials.

## 1. Pipeline (3 processes, ~25s total per variant)

1. `blender -b -P build_textured_car.py -- out` (~17-20s, Cycles CPU) — builds the car, packs UV0 +
   UV1, bakes AO/curvature (UV1) and a tangent-space normal (UV0), exports an **interim** GLB (no
   mask yet) + sidecar with atlas rects and texel-density numbers.
2. `python3 compose_mask.py out/cruz_missile_interim.glb out/cruz_missile_interim.asset.json out`
   (<1s, PIL, no Blender) — reads the interim GLB directly (stdlib GLB/accessor parsing in
   `uv_raster.py`), rasterizes the paint mask (R) from real triangle data, transfers AO+curvature
   from UV1 into UV0 space per-triangle via barycentric resampling (B), and draws a procedural
   stripe (G) and pinstripe glow (A). Saves `mask.png` + per-channel/diagnostic PNGs.
3. `blender -b -P attach_mask.py -- out` (~2-5s) — reopens the saved `.blend`, wires `mask.png` and
   the normal map into `jj_paint` via explicit `UV Map(UV0)` nodes (never "whichever UV is active"),
   exports the **final** textured GLB with both textures embedded.

Blender's bundled Python has **numpy but no PIL**; system Python has PIL but no numpy — hence the
Blender→PIL→Blender handoff instead of doing it all in one process.

## 2. UV0 atlas (task 1)

`build_textured_car.py`'s `pack_atlas()`: smart-projects each of the 6 paint parts into its own
0-1 space, measures its **actual UV bounding-box aspect ratio** (not assumed square), sizes a
rectangle proportional to the part's real-world surface area at that aspect, and places all 6 with a
best-area-fit **guillotine bin packer** (own implementation, ~25 lines, no rotation). Non-overlap is
by construction (rectangles don't overlap; a shrinking `FILL` retry loop, 0.70→0.45, guarantees a fit
for 6 rects of very different sizes — first attempt at `FILL=0.80` with a naive shelf packer put two
rects at v>1.25, outside the unit square; fixed by proper guillotine packing + a `FILL` search).

Because rectangle **area** is derived as `k^2 * real_area` with the **same constant k for every part**,
texel density comes out identical across parts, not just approximately consistent:

| part | area (m^2) | texel density (px/m) |
|---|---|---|
| chassis | 17.81 | 146.2 |
| cabin | 7.58 | 146.2 |
| bonnet | 3.59 | 146.2 |
| boot | 2.36 | 146.2 |
| door_L / door_R | 1.50 each | 146.2 |

`uv0_ratio_max_over_min = 1.0`. This is a **provable guarantee of the packer**, not a measurement that
happened to come out even — worth stating as the contract's texel-density rule (§7).

## 3. UV1 bake atlas + Cycles bakes (task 2)

UV1 uses the same packer (independent layout, larger margin) — its only job is to be a clean,
non-overlapping target for baking. Baked with Cycles CPU, `samples=48`, each pass targeting a
**shared** 1024^2 image across all 6 paint parts at once (one image-texture node on the one shared
`jj_paint` material, all 6 objects selected together, one `bpy.ops.object.bake()` call per pass):

| bake | type | target UV | time |
|---|---|---|---|
| AO | `AO` | UV1 | 6.7s |
| curvature | `EMIT` (Geometry->Pointiness->Emission override, restored after) | UV1 | 7.8s |
| normal | `NORMAL`, tangent space | **UV0**, not UV1 | 1.5s |

**Why normal is baked at UV0 directly, not transferred from UV1 like AO/curvature:** AO and curvature
are scalars, safe to resample between two different UV parameterizations of the same triangle by
matching barycentric weights (see §4). A tangent-space normal is a **vector in a per-triangle basis**;
resampling it into a different UV layout without re-deriving that basis per-pixel would silently
produce wrong lighting. Baking it directly at UV0 sidesteps the problem entirely. This is a concrete
recommendation for the contract (§7): normal maps should always be baked at the *runtime* UV set, not
transferred from a bake-only UV set the way scalar data can be.

The curvature bake uses Blender's `Geometry` node's `Pointiness` output through a `ColorRamp`
(0.44-0.56 contrast) fed temporarily into the Principled BSDF's Emission input, baked as `EMIT`, then
fully unwired afterward — no permanent change to the material. It reads as expected (bright at
convex edges, dark in creases) but is fairly subtle on beveled boxes; a genuinely bevelled/chamfered
hero mesh would show more.

## 4. Mask composition (task 3)

`compose_mask.py`, RGBA, all channels populated from real data or documented procedural rules:

| channel | source | how |
|---|---|---|
| R (paint) | real geometry | rasterize every `jj_paint` triangle at its UV0 position -> 255. Exact: every white pixel is provably a real paint-material surface point. |
| G (pattern) | procedural | a diagonal stripe drawn per paint-part atlas cell (rect from the sidecar) |
| B (dirt/damage) | **transferred bake** | for each pixel inside a UV0 triangle, compute barycentric weights there, apply the *same* weights to that triangle's UV1 vertices to find where to sample the AO/curvature bake images, blend `0.75*(1-AO) + 0.25*(1-curvature)` |
| A (emissive) | procedural | a thin pinstripe glow along the G stripe's edge |

This is genuinely exercising "UV1 for bakes": bake once at a clean unique unwrap, transfer the result
into the shared runtime atlas via barycentric correspondence between the two UV sets of the *same*
triangle. Composition itself takes well under a second (2,888 triangles, ~440K touched pixels).

## 5. Validator (task 5) — `validate_textures.py`

Checks, all against the actual GLB (not sidecar claims): UV0/UV1 presence on the right meshes, UV
coordinates within [0,1], **no overlapping UV0 islands** (rasterize all paint-part triangles at 1024^2,
flag if >25px are touched by more than one triangle — tolerance covers float/edge jitter, not real
overlap), texture size <=1024 and power-of-two, mask is RGBA with every channel non-empty, `jj_*`
material names, and every texture a material references is actually embedded and decodable.

| variant | expected | result |
|---|---|---|
| `cruz_missile_textured.glb` (good) | PASS | **PASS** — `ok: true`, 1px overlap noise (well under the 25px tolerance) |
| `cruz_missile_textured_broken.glb` (`--broken-overlap`: cabin's UV0 rect deliberately collided with chassis's) | FAIL on overlap only | **FAIL**: `"UV0 islands overlap across paint parts: 407760 px (budget 25)"` — nothing else fails, isolating the one broken thing |
| `cruz_missile_interim.glb` (mask never composited/attached — the natural output of step 1 alone) | FAIL on missing mask only | **FAIL**: `"mask texture: not present in GLB (no image named 'mask')"` — UV checks all pass |

Commands:
```
python3 validate_textures.py out/cruz_missile_textured.glb out/cruz_missile_textured.asset.json
python3 validate_textures.py out/cruz_missile_textured_broken.glb out/cruz_missile_textured_broken.asset.json
python3 validate_textures.py out/cruz_missile_interim.glb out/cruz_missile_interim.asset.json
```

## 6. Bug found: a double UV-flip (worth calling out — this is the "useful" kind of spike finding)

First render attempt showed paint rendering as near-random grey/black patches instead of identity
colour. Root cause, found by isolating layer-by-layer (traced through material assignment, texture
loading, then literal fragment-shader math, then finally the Python-side UV math):

- Blender's mesh UV layers are **bottom-origin** (v=0 at bottom); Blender's glTF exporter **flips V**
  on write so the exported `TEXCOORD_n` accessors are **top-origin** (glTF spec, matches PIL's
  row-major top-origin convention, and matches how three.js samples GLTF textures with
  `flipY=false`).
- `uv_raster.py`'s rasterizer was written assuming it would always receive bottom-origin coordinates
  and flipped them (`py = (1-v)*res`). But it's fed the GLB's **already-top-origin** `TEXCOORD_0/1`
  data (via `mesh_triangles`/`read_accessor`) — so it was flipping data that didn't need flipping,
  landing paint-mask content in the vertically mirrored position relative to where the procedurally
  drawn G/A channels (built from Blender-native, pre-export rect coordinates, correctly flipped once)
  expected it. Fixed by removing the extra flip (`uv_to_px` now does `py = v*res`); same bug existed
  in `compose_mask.py`'s UV1->bake-image sampling (Blender also flips its own internal image buffer
  to top-origin on `image.save()`, so `v1` from the GLB already matches the saved PNG's rows).
- **A second, unrelated red herring while debugging:** after the flip fix, cabin still rendered as a
  large near-black patch. That was *not* a bug — `PATTERN[0] = '#111827'` (near-black navy) was a bad
  colour choice for the "second identity colour" demo slot; the shader was correctly mixing to it,
  it just wasn't a legible colour on screen. Swapped the pattern palette to bright accents
  (white/cream/pastel) and the stripe reads clearly. Lesson for anyone authoring the identity/pattern
  palette for real: validate legibility, not just "is it a different hex code."
- A third, structural finding while modelling: Blender's `primitive_cube_add`/`primitive_cylinder_add`
  leave a **default `UVMap` layer** that silently claims `TEXCOORD_0` ahead of a manually-created
  `UV0` layer unless it's stripped first. `smart_project_into()` now clears existing UV layers the
  first time a mesh is touched, before creating `UV0`.

## 7. Contract recommendations

1. **Texel density**: define it as a *packer guarantee*, not a post-hoc measurement — "every part's
   atlas cell area = k * real surface area, k constant across the vehicle" is checkable exactly, and
   trivially provable to be 1.0 consistent if the packer is implemented this way (§2). Recommend the
   contract mandate this construction (or an equivalent) rather than just "consistent texel density."
2. **Normal maps bake at the runtime UV set (UV0), not the bake UV set (UV1)** — scalar bakes
   (AO/curvature/dirt) transfer safely UV1->UV0 via barycentric resampling; vector bakes (normal,
   and anything else that's a per-triangle-basis quantity) do not, without re-deriving the tangent
   basis per pixel. Contract should say this explicitly rather than leaving "UV1 for bakes" ambiguous
   about which bakes.
3. **UV convention pitfall is contract-worthy**: any tool in the pipeline that reads UV coordinates
   out of a GLB (validators, mask compositors, LOD/collision tooling) must treat them as
   glTF-convention (top-origin), *not* whatever a given DCC's native convention is. Recommend a
   one-line note in the contract doc plus a shared, tested `uv_to_px`-equivalent utility (this spike's
   `uv_raster.py`) that every downstream tool imports, so this class of bug can't recur per-script.
4. **Validator should rasterize, not trust min/max**: `validate_textures.py`'s overlap check needed
   real per-triangle rasterization; accessor `min`/`max` alone cannot detect island overlap. Worth
   stating in the contract that "no overlapping UV0 islands" is checked by rasterization, with a
   documented pixel-tolerance budget (this spike used 25px at 1024^2 — reasonable, not tuned).
5. **Decal integration into the shared atlas is unresolved**: this spike's pattern channel (G) is
   procedural, not decal-sheet-registered, to keep scope bounded. The base spike's word-decals used
   their *own* explicit UV mapping into the decal sheet's coordinate space, entirely separate from
   the paint atlas. Registering decal placement into the same shared UV0 atlas (so decals can be
   masked/tinted/damaged the same way as paint) is real follow-up work, not yet proven.
6. **Mask channel packing worked as specified** (R paint / G pattern / B dirt / A emissive) with no
   need to change the channel assignment — this spike is evidence the packing itself is sound, only
   the tooling around it needed fixing.

## 8. In-game proof (task 6)

`ingame_textured.html`: a custom `THREE.ShaderMaterial` (not the built-in toon material, since it
needs per-channel mask logic) for `jj_paint` meshes: samples `mask` at UV0 (`vUv = uv`, the default
glTF-mapped attribute), `mix()`s base->paintColor by R, paintColor->patternColor by G, darkens/scorches
by B x dirtAmount, adds `emissiveColor x A x emissiveStrength`, and applies a 3-tone toon ramp from
`N.L`. Non-paint parts (tyre/wheel/glass/plastic/lights) keep flat materials, matching the scoping
decision in §1.

Captured with Playwright + system Chrome (`channel: 'chrome'`), served via
`python3 -m http.server 8210` from the repo root:

- `out/ingame_identity_grid.png` — 6 cars, 6 distinct identity colours (red/blue/orange/green/
  purple/red-orange), each showing the pattern stripe in a shared bright accent colour, wheel rim
  colour unaffected (not part of the mask atlas, by design).
- `out/ingame_hero_clean.png` vs `out/ingame_hero_dirty.png` (`?dirt=0.05` vs `?dirt=0.95`) — the
  dirt/damage effect is **real but view-dependent**: max per-pixel RGB diff between the two is
  107-114/255, but only ~8,045 of ~330,000 visible car pixels differ by more than 5/255 from this
  rear-on angle, because this specific panel view has low AO/curvature variance (mostly flat, few
  edges). The effect would read more clearly from an angle showing more panel edges/corners; the
  chase-cam in this spike always frames directly behind the car regardless of `car.rotation.y`
  (camera offset is derived from that same rotation, so there's no independent "3/4 view" angle
  without adding a separate camera-offset parameter — not built here, noted as a gap, not a pipeline
  failure).

## 9. Pass/fail summary

| check | result |
|---|---|
| UV0 single packed non-overlapping atlas across paint parts | **PASS** (guillotine packer, non-overlap by construction, confirmed by rasterization: 1px noise) |
| UV1 unique bake atlas | **PASS** |
| Texel density consistency | **PASS**, exact (ratio 1.000, guaranteed by construction) |
| AO bake | **PASS** (6.7s, Cycles CPU, shared atlas across 6 parts) |
| Curvature bake | **PASS** (7.8s, Pointiness->Emission trick, real but subtle on low-bevel geometry) |
| Tangent-space normal bake | **PASS** (1.5s, baked directly at UV0, not transferred) |
| Mask composition (RGBA, all channels populated) | **PASS** (R exact/geometric, G/A procedural, B transferred via barycentric resample) |
| GLB export with textures embedded + sidecar | **PASS** (mask.png + normal_map_uv0.png embedded, `pbrMetallicRoughness.baseColorTexture` / `normalTexture` wired) |
| Validator PASS on good GLB | **PASS** |
| Validator FAILS on overlapping-UV0 variant, isolated to that check | **PASS** (demonstrated) |
| Validator FAILS on missing-mask variant, isolated to that check | **PASS** (demonstrated) |
| In-game shader reads mask, drives identity paint/pattern/dirt/emissive | **PASS**, dirt effect view-dependent (see §8) |
| Decal-sheet registration into the shared atlas | **NOT DONE** (procedural pattern used instead; follow-up) |

## 10. Evidence file paths (all under `spikes/art-pipeline/A-textures-uv/out/`)

- Atlas/UV: `cruz_missile_interim.asset.json` (`uv0_atlas_report`, `uv1_atlas_report`,
  `texel_density_consistency`), `atlas_layout.png` / `atlas_layout_broken.png`
- Bakes: `bake_ao_uv1.png`, `bake_curvature_uv1.png`, `normal_map_uv0.png`
- Mask: `mask.png`, `mask_R.png` / `mask_G.png` / `mask_B.png` / `mask_A.png` (split channels),
  `mask.json` (channel meanings + stats)
- GLBs: `cruz_missile_interim.glb` (no mask, valid UVs), `cruz_missile_textured.glb` (good, final),
  `cruz_missile_textured_broken.glb` (deliberately overlapping UV0)
- In-game captures: `ingame_identity_grid.png`, `ingame_hero_clean.png`, `ingame_hero_dirty.png`

## 11. Scripts

- `build_textured_car.py` — Blender headless: geometry, UV0/UV1 packing, Cycles bakes, interim export
- `compose_mask.py` — system Python + PIL: mask composition, UV1->UV0 scalar transfer
- `attach_mask.py` — Blender headless: wires mask/normal into `jj_paint` via UV0, final export
- `validate_textures.py` — system Python + PIL: the checks in §5
- `uv_raster.py` — shared stdlib triangle rasterization + GLB accessor parsing (used by both
  `compose_mask.py` and `validate_textures.py`)
- `ingame_textured.html` / `capture_textured.mjs` — Three.js custom shader + Playwright capture
