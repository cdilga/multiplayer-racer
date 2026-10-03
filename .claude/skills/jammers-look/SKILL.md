---
name: jammers-look
description: Joystick Jammers 0.2 in-world comic look as concrete three.js shader recipes. TSL for WebGPURenderer (WebGPU, or its WebGL2 backend) with a GLSL route for WebGLRenderer. 3-tone toon ramp, ink outlines from depth+normal+object id in one post pass, halftone in shadows, selective emissive bloom, paint key, sun-bleached grit, damage creep, speed lines, orange/teal grade, and per-tile cost tiers. Use when building, reviewing or tuning the in-world look or any car/track/item/effect shader (P1-U05, R10, R12, W02-W04), or when judging a look capture.
---

# jammers-look: master section 12.1 / 12.1a as shader recipes

Source of truth, in order: `docs/policies/owner-direction-2026-09-29.md` (R-rules) > `docs/plans/v0.2-revamp-plan-2026-09-28.md`
sections **12.1** (bold comic) and **12.1a** (comic + a bit of Mad Max, emissive everywhere, R34) > this skill. Colours and
ink weights come from `art/ui/tokens.json` (`palette.ink` **#15203A**, world colours `red-earth` #C8622E, `ochre`, `sandstone`)
and `art/ui/GUIDE.md` section 5 (outline 4 px at 1080p TV, 3 px desk, 2.5 px handheld). The look itself is designed by
P1-U05 (`art/ui/poc/world/`) and **the accepted U05 frames become the named reference** once the owner passes G-DESIGN
(`art/ui/accepted/<date>/`); until then judge against `docs/plans/ux-study-2026-09-29/images/H4-host-round-results-v2.png`
(primary), `spikes/art-pipeline/J-cruze-lowpoly/out/evidence/ladder_L0_hero.png` (the car) and this skill's own captures in
`docs/evidence/P1-F11/`. Do not restyle a recipe to taste; change the number, not the structure, and show a capture.

Deeper TSL / three material help: `../webgpu-threejs-tsl/` (docs/post-processing.md, docs/compute-shaders.md) and
`../threejs-aaa-graphics-builder/` (references/shader-cookbook.md, technical-art.md budgets, visual-scorecard.md). Both are
vendored from upstream (see their `VENDORED.md`); this skill wins where they disagree, and skip their credential-probe,
image/3D-generation and Vite-scaffold steps (R70: self-hosted only; art comes from the Codex/Blender pipeline of master section 12.2, never API keys in a skill).

> **Tested by a fresh agent:** an independent agent followed only this skill (not `example/`) and rendered the Cruz Missile with
> all three treatments on the first run; its page, captures and the gaps it hit are in
> `docs/evidence/P1-F11/fresh-agent/NOTES.md`. The setup, shadow, convention and halftone-level notes below close those gaps.

## Setup facts (three **0.182.0**, repo-root `node_modules`)

- Serve the **repo root**; every URL is root-relative. The exact import map (also `recipes.md`, "Setup"); `three` and
  `three/webgpu` must be the same URL, and `three/addons/` is needed for `bloom` and `fxaa`:

<!-- recipe: index.html#importmap -->
```html
<!-- Self-hosted only (R70): three comes from the repo-root node_modules, served from the repo root. 'three' and 'three/webgpu' MUST be
     the same URL, so Spike J's model.js (which imports 'three') and look.js (which imports 'three/webgpu') share one module instance. -->
<script type="importmap">{"imports":{
  "three":"/node_modules/three/build/three.webgpu.js",
  "three/webgpu":"/node_modules/three/build/three.webgpu.js",
  "three/tsl":"/node_modules/three/build/three.tsl.js",
  "three/addons/":"/node_modules/three/examples/jsm/"}}</script>
```
<!-- /recipe -->

- Imports: the exact lists are `look.js#imports` and `main.js#scene-imports` in `recipes.md`. Everything node-shaped is
  `three/tsl`; `THREE.LightingModel`, `THREE.MeshToonNodeMaterial`, `THREE.PostProcessing`, `THREE.WebGPURenderer` are `three/webgpu`.
- `renderer.shadowMap.enabled = true` is **required** (and `sun.castShadow`, car meshes `castShadow`, **ground `receiveShadow`**):
  no shadow map means no cast shadow and nothing for the halftone to key on. `renderer.setPixelRatio(1)` so the tile height
  you give `tierFor(H)` is device pixels. Both are in the `renderer` and `wiring` blocks.
- `await renderer.init()` first. `forceWebGL: true` runs the identical recipes on WebGPURenderer's **WebGL2 backend**
  (captured: `docs/evidence/P1-F11/hero-webgl2.png`). GPU compute (sparks) needs the WebGPU backend.
- r182 post class is **`PostProcessing`** (the vendored TSL skill says `RenderPipeline`; that rename is r183). Rename on bump.
- `renderer.toneMapping = THREE.NeutralToneMapping` (keeps saturated colours); no environment specular; flat albedo.
- Playwright 1.62.1 `chromium.launch({ channel: 'chromium' })` gets WebGPU on this Mac with default flags (probed), and the
  fresh agent's `--enable-unsafe-webgpu --use-angle=metal` also works; either way the page must be on a secure origin
  (`http://127.0.0.1:port`, not `about:blank`).
- Call `updateLookCamera(look, camera)` after every fov, aspect, near or far change (the edge pass needs near/far/aspect).

## Conventions: axes, sun, camera, shadow

- Spike J's car faces **+Z**, its right side is **+X**, origin on the ground between the axles, metres. Azimuths are degrees
  around +Y: **0 = in front of the car, positive toward its right side**. `addDayRig({ sunAz })` puts the sun at
  `(sin az, 0.95, cos az) x 9.5 m` (about 43 degrees up), so the cast shadow falls *away* from `sunAz`. `orbitCamera` uses the same azimuth.
- To see the shadow, put the camera 60-140 degrees away from the sun azimuth: hero camera 38 / sun -42, side 90 / -50, pack 30 /
  -45 (the `views` block). A front three-quarter camera with the sun in front hides the shadow behind the car.
- The sun's shadow frustum is +/-9 m around the origin: for a moving car move `sun.position` and `sun.target` with it every frame;
  a whole track needs cascades or several suns (R10).
- Colours: ground `#C8622E` is `art/ui/tokens.json` `palette.red-earth` (`RED_EARTH` in the `wiring` block).

## Halftone dot size by shade level

`jjShade = 1 - tone x shadowMask`; the dot radius is `smoothstep(0.42, 1.0, shade) x 0.42` of a cell (`look.cell` px, 45 degrees).

| Surface | tone x mask | `jjShade` | Dots |
|---|---|---|---|
| lit by the key light, n.l above 0.45 | 1.00 | 0 | none |
| mid tone, n.l -0.05 to 0.45 | 0.72 | 0.28 | none (below the 0.42 threshold) |
| facing away but the shadow map still lights it (rare) | 0.40 | 0.60 | tiny, radius about 0.10 cell (about 3% ink) |
| in the sun's shadow: cast shadows and, in practice, every face turned away from the sun | 0 | 1.0 | full: radius 0.42 cell (about 55% ink) |

The shadow map shadows a face that points away from the sun, so the flank away from the light gets the full dots, not the
small ones. `tones.x` (0.40) therefore barely shows on shadow-receiving meshes; to change how much of the car is dotted, move
`cuts`, `tones.y` or the sun, and to change dot size change the two numbers in the `halftone` Fn (threshold 0.42, scale 0.42).

## Element map (every 12.1 / 12.1a row)

Status: **run** = in `recipes.md` / `example/look.js` and rendered in the P1-F11 captures; **sketch** = code in `recipes-extra.md`, not rendered.
GLSL route = the same element on a plain `WebGLRenderer`; **run** items are in `recipes.md` (GLSL section, `example/glsl.js`), the rest are ports described in `recipes-extra.md`.

| Master element | TSL recipe | GLSL route | Status |
|---|---|---|---|
| 12.1 Cel/toon, 2-3 tone ramp | `toon-model` | `MeshToonMaterial({ gradientMap })`, 40-texel Nearest ramp (run) | run |
| 12.1 Thick ink outlines (depth + normals + object id, once in post) | `post` edge pass; `tokens`; `outline:'ids'` is the cheap tier | prepass RT + one quad pass, same maths (run) | run |
| 12.1 Halftone dots in shadows | `post` halftone, keyed on `jjShade` from `toon-model` | halftone inside the patched toon chunk (run) | run |
| 12.1 Bold flat colours, curated palette | flat `colorNode` from tokens + Neutral tone map | same | run |
| 12.1 Comic speed lines at high speed | `speed-lines` | same maths in the quad pass (run) | run |
| 12.1 Impact words (KRUNCH!) as sprites | `recipes-extra` impact-word | `Sprite` + `SpriteMaterial` | sketch |
| 12.1 Squash on landings (visual only) | `recipes-extra` squash | instance matrix scale | sketch |
| 12.1 Cars: paint from masks, decals, huge roof numbers | `paint-key`, `car-attributes` (roof number = atlas texels, not an effect target) | `instanceColor` + `onBeforeCompile` (run; Spike J `atlas.js`) | run |
| 12.1 Worlds: strong silhouettes, graphic skies, foliage cards, limited-palette ground | id outlines + `rig` haze; sky/foliage/palette in `recipes-extra` | cookbook sky dome, `alphaTest` cards | run + sketch |
| 12.1 UI hand-inked | not a shader: `art/ui/` sheets; world ink = same `palette.ink` and weights | n/a | n/a |
| 12.1 Readability: effects never cover identity or the road ahead | halftone skips emissive; speed-line clear ellipse; damage only on paint texels; tiers | same | run |
| 12.1a Car paint (toon-ramped, identity colour) | `paint-key` + `toon-model` | as above | run |
| 12.1a Rust and scorch creep from damage (mask B) | `damage` (reads `aState.x`; swap to `maskTex.b` when the contract mask lands) | `onBeforeCompile` | run |
| 12.1a Edge-worn bare metal (curvature bake) | `recipes-extra` edge-wear (needs baked `aCurv`) | same | sketch |
| 12.1a Dust layer, driven over | `grit` dust term (`aState.y`) | world-height dust (run), driven-over dust is a port | run |
| 12.1a Hot metal / exhaust orange to white | `recipes-extra` hot-metal (`aState.w`) | emissive `onBeforeCompile` | sketch |
| 12.1a Heat shimmer (larger tiles only) | `recipes-extra` shimmer, gated by `tier.shimmer` | `ShaderPass` UV offset | sketch |
| 12.1a Emissive kit: head/tail lights, light bars, underglow, roof number, weapon charge | `emissiveNode` from the atlas emissive map + MRT emissive + bloom (run: headlights, LED bar, tail); underglow/roof/charge in `recipes-extra` | cookbook selective bloom | run + sketch |
| 12.1a Selective bloom, once in post | `post` glow (emissive target only) | `UnrealBloomPass` on an emissive-only render (port, not run) | run |
| 12.1a Boost flames (blue at full boost) | `recipes-extra` boost-flame | same, cone + sprites | sketch |
| 12.1a Sparks and embers (GPU particles) | `recipes-extra` sparks, on `../webgpu-threejs-tsl/docs/compute-shaders.md` | CPU-updated `Points` | sketch |
| 12.1a Damage glow, burning husks | `recipes-extra` damage-glow (`aState.z`) | same | sketch |
| 12.1a Sky and light: harsh sun, long shadows, fog gradient | `rig` (sun azimuth/elevation, haze fog) | same | run |
| 12.1a Heat haze, dust storm, dusk/night variants | `recipes-extra` weather parameter sets | same | sketch |
| 12.1a Ground: red dirt (run), cracked clay, ripples, tyre tracks, wet sheen | `grit` ground; others in `recipes-extra` ground | same | run + sketch |
| 12.1a Environment emissive (servo/neon signs, flares, markers) | `recipes-extra` signs (`emissiveNode` + flicker) | same | sketch |
| 12.1a Post once (D17): warm grade, vignette, grain, halftone, chromatic fringe on big hits only | `post` (`look.warm`, `vignette`, `grainAmt`, `fringe`; fringe is a build option) | warm/vignette/grain in the quad pass (run), fringe is a port | run |
| 12.1a Guard rails: informative emissive first; effects scale down with tile size; measured cost | `tiers` + cost rules below | same (run at the 40 px tier) | run (tiers), cost = G-PERF |

## Recipes

The rendered, verbatim code is in **`recipes.md`**: setup (`importmap`, `imports`, `scene-imports`, `renderer`, `views`), TSL
blocks `tokens`, `tiers`, `look-uniforms`, `rig` (day rig + orbit camera), `toon-model`, `car-attributes`, `paint-key`, `damage`,
`grit`, `material`, `speed-lines`, `post`, then `wiring` (groups the car parts, builds the instanced cars and the ground) and
`frame`, then the GLSL route (`glsl-ramp`, `glsl-toon`, `glsl-pipeline`). The tested modules are `example/look.js` (TSL) and
`example/glsl.js`; the test scenes are `example/main.js` and `example/main-glsl.js`. Unrendered recipes (impact words, squash,
hot metal, shimmer, flames, sparks, weather sets, ground variants, signs, GLSL leftovers) are in `recipes-extra.md`, each marked
as not rendered.

## Per-tile cost rules

Post runs **once**. For a grid, draw every tile viewport (viewport + scissor) into the same MRT targets, then run one post
chain over the canvas; per-tile knobs (ink px, halftone cell, tier switches) come from a per-tile table read by `screenUV`
(R10 builds and measures this; P1-F11 rendered one tile at a time, so the table is design, not evidence).

| Tile height | Tier | Runs | Drops |
|---|---|---|---|
| >= 540 px (TV, Overview, desk) | L | toon, ink (`inkPx` = 4 x h/1080), halftone cell 8, bloom, grit, speed lines, shimmer, fringe on hits | nothing |
| 270-540 | M | toon, ink >= 2 px, halftone cell 6, bloom, grit 0.6, speed lines | shimmer |
| 110-270 | S | toon, ink 1.5 px | halftone, bloom, grit, speed lines |
| < 110 (the 40 px car) | XS | toon, ink 1 px | everything else (captured: `thumb-40px.png`) |

- Build-time options (`comicPipeline(..., { bloom, halftone, outline, speedLines })`) remove a pass's texture taps; the `look.*` uniforms only fade. Use options for tiers, uniforms for fades.
- If the outline pass is too costly at 24 tiles use `outline: 'ids'` (cars and debris silhouettes only, no depth or normal taps; GUIDE section 13 fallback). Captured: `docs/evidence/P1-F11/hero-outline-ids.png`.
- Attachments: 4 MRT targets = 28 bytes/pixel (output and emissive and objectId RGBA16F, normal RGBA8); the WebGPU default limit is 32. Do not add a fifth without packing. Drop `emissive` when bloom is off for a whole scene.
- Grit cells under about 2 px fade out in the shader; bleach/dust scale with `look.grit`; nothing here creates a cap on cars, tiles, debris or particles (No caps, R36/R47/R66): per-view effect detail, never entity quotas.
- Comic effects never cover identity or the road ahead: halftone skips emissive pixels, speed lines leave a clear ellipse, damage creep and rust only touch paint texels, bloom is emissive-only. Roof numbers and decals are atlas or decal texels: never key a degrading effect (creep, halftone, grit) on them.
- Every new effect needs its own cost line in G-PERF; P1-F11's numbers (see `docs/evidence/P1-F11/README.md`) are headless Chromium on the Mac, **not** a perf receipt.

## r182 traps found while building these (read in `node_modules/three/build/three.webgpu.js` or measured in the captures)

1. `MeshToonNodeMaterial` dots the raw object-space `normal` attribute with a view-space light direction: wrong on rotated or instanced meshes. Own `LightingModel` (`toon-model`).
2. `lightColor` passed to `LightingModel.direct()` is not "sun x shadow": it carries the shadow map's colour attachment (measured luminance 1.0 inside shadow vs 3.0 lit, while the unshadowed sun colour is 2.05). Use `lightNode.baseColorNode` times `lightNode.shadowNode` (a clean 0/1 mask), and gate on `builder.object.receiveShadow` because `shadowNode` can be stale from another object's build.
3. `NodeMaterial` multiplies `mesh.instanceColor` into the **whole** colour. The paint key uses an instanced attribute instead.
4. The extra MRT targets are cleared to (0,0,0,1) in the sky: shade reads 1.0 there (measured, `debug-shade.png`) and the zero-cleared normal decodes to (-1,-1,-1). Classify sky by depth (`>= 0.99999`), never by id, shade or normal.
5. Id, normal and depth targets must be **Nearest**; linear filtering invents phantom edges (a grey line along the far plane).
6. Linear-depth second differences light up every grazing plane near the horizon. The device depth is affine in screen space on any plane, so its Laplacian times `z / depthScale` is zero on planes and a clean relative step `dz/z` at real edges.
7. `atan2` warns "overloaded"; use `atan(y, x)`. `hash()` takes floats fine. Reversed `smoothstep` edges are undefined: write `1 - smoothstep(a, b, x)`.
8. `pass(scene, camera, { samples: 0 })`: MSAA would blend ids and normals; use FXAA after `renderOutput()` and set `post.outputColorTransform = false`.
9. `PostProcessing` renders with `post.render()` after `await renderer.init()`; give the first frames a few `requestAnimationFrame`s before a capture, pipelines compile asynchronously.
10. `info.render.calls` accumulates across frames in r182 and `gl.finish()` does not block in Chromium; time WebGL with a 1 px `readPixels`, WebGPU with `queue.onSubmittedWorkDone()` (see `main.js`).

## GLSL route (R01 picks `WebGLRenderer`)

Rendered, not just described: `example/index-glsl.html` + `glsl.js` (verbatim in `recipes.md`, captures `docs/evidence/P1-F11/glsl-*.png`).
Structure carries over: one key light + hemisphere, white-texel paint key on `instanceColor`, a normal+id+depth prepass, one
full-screen quad doing the same edge, speed-line and grade maths, halftone inside the toon material. Leftovers (selective
bloom, damage, fringe, FXAA) are listed in `recipes-extra.md`. WebGLRenderer's built-in toon chunk uses the view-space
normal, so trap 1 above is a TSL-only problem.

## How to run and re-prove it

```bash
source /opt/homebrew/opt/nvm/nvm.sh && nvm use --silent 26.10.0
node .claude/skills/jammers-look/example/capture.mjs            # serves the repo root, writes docs/evidence/P1-F11/*.png + captures.json (TSL and GLSL pages)
node .claude/skills/jammers-look/example/check-recipes.mjs      # recipes.md == the code that rendered
# interactive: serve the repo root (node spikes/art-pipeline/J-cruze-lowpoly/serve.mjs 8131), open
#   http://127.0.0.1:8131/.claude/skills/jammers-look/example/index.html?view=hero&dbg=shade
```

Look changes need captures: hero three-quarter, side, the 40 px thumbnail, plus the "before" with the plain material, and a
`dbg=` channel for whatever you touched. Night and dusk variants must pass the same readability captures (12.1a guard rails).
