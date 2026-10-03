# P1-F11 evidence: shader skills and the Cruz Missile comic-look captures

Bead `br-p1-f11-yyw`. Commands and raw output: `local-receipt.txt`. Machine-readable capture facts: `captures.json`.
Everything below was produced on the Mac (Apple M1 Pro, macOS 27.0.1) with Playwright 1.62.1 Chromium 151 **headless**
(`chromium.launch({ channel: 'chromium' })`, default flags) and three **0.182.0** from the repo-root `node_modules`, served
from localhost, no CDN. The bead text says "headed on the Mac"; these runs are headless on the same GPU (ANGLE Metal, WebGPU
adapter `apple / metal-3`). They are not a device or perf receipt (see "Frame cost").

## What was vendored

| Skill folder | Upstream | Commit | Licence |
|---|---|---|---|
| `.claude/skills/webgpu-threejs-tsl/` | `dgreenheck/webgpu-claude-skill` | `af2319bd01bb7cc881267a9ef42cafdaf5e9029d` | MIT **declared** (README "MIT License", `plugin.json` `"license": "MIT"`); upstream ships **no LICENSE file** and GitHub reports none, so `LICENSE` here is the standard MIT text written by the vendoring agent, with a note saying so |
| `.claude/skills/threejs-aaa-graphics-builder/` | `majidmanzarpour/threejs-game-skills` (`skills/threejs-aaa-graphics-builder`) | `8286774b22a2566bf894dbc825825c16921866af` | MIT, upstream LICENSE copied byte for byte |

Both were read in full before copying (see each `VENDORED.md`); no installer was run, nothing executes on load. The vendored
files are byte-identical to upstream (`diff -rq` in the receipt) except that the TSL skill's Cursor shims, plugin metadata and
repo README were left out.

## The adapter

`.claude/skills/jammers-look/`: `SKILL.md` (element map of every master 12.1 / 12.1a row, cost tiers, r182 traps),
`recipes.md` (rendered code, verbatim), `recipes-extra.md` (not-rendered sketches), `example/` (the test scenes and the
capture and drift-check scripts). `node example/check-recipes.mjs` proves `recipes.md` is byte-identical to the code that
rendered these captures (23 blocks).

How the "fresh agent" step was done: first, the implementing agent drafted the recipes from the vendored skills and the r182
sources, built the test page from them, and fed every defect back into the recipes (the list is "r182 traps" in `SKILL.md`).
After that the recipe text was generated from the code, so it cannot drift, and `example/minimal.js` (barrel, crate, cone,
beacon) used only `look.js`'s public functions on ordinary meshes. Then **an independent fresh agent followed only `SKILL.md` /
`recipes.md` / `recipes-extra.md` (it did not open `example/`)** and rendered the Cruz Missile with all three treatments on the
first run: `fresh-agent/` (page, captures, `NOTES.md`). Its seven gaps (import map, import header, shadow flags, a
self-contained `wiring`, axis/sun/camera conventions, halftone levels, an undefined-variable `frame` block) were fixed in the
skill; the renderer, views, wiring and frame code were refactored into self-contained functions and every capture here was
re-rendered afterwards pixel-identical to the previous set.

## Captures (all `docs/evidence/P1-F11/`)

Scene: Spike J's Cruz Missile (`model.js` + `atlas.js` imported from `spikes/art-pipeline/J-cruze-lowpoly/`, not copied), LOD0,
on `red-earth` dirt under one shadow-casting sun, hemisphere ambient, haze fog. "Before" is the same scene, camera and
lights with plain `MeshStandardMaterial` and MSAA, no post.

| File | What it shows | Backend |
|---|---|---|
| `before-hero.png`, `before-side.png`, `before-thumb-40px.png` (+`@8x`) | the plain material | WebGPU |
| `hero.png` | three-quarter hero: 3-tone toon ramp (lit / mid / shadow faces), ink outlines (`#15203A`, silhouettes and creases), halftone dot screen in the shaded side and the cast shadow, emissive bloom on lights, paint key, grit, grade | WebGPU |
| `side.png` | side view, sun on the far side so the whole visible flank sits in the halftone and the cast shadow falls toward the camera | WebGPU |
| `thumb-40px.png`, `thumb-40px@8x.png` | 128x72 tile, car about 45 px tall: tier XS (toon + 1 px ink, no halftone/bloom/grit by the cost rule), `@8x` is nearest-neighbour | WebGPU |
| `compare-hero.png` | before | after | WebGPU |
| `pack.png` | four cars, one material, one `InstancedMesh` per part type: paint key (cyan / pink / yellow / green; glass, tyres, lights and livery accents keep their colour), damage creep on the yellow car, dust on the green | WebGPU |
| `speedlines.png` | speed lines at 0.9 with the clear ellipse around the car | WebGPU |
| `hero-fringe.png` | chromatic fringe path (`look.fringe` 30, big hits only) | WebGPU |
| `hero-outline-ids.png` | the cheap outline tier (`outline: 'ids'`, silhouettes only) | WebGPU |
| `hero-webgl2.png` | the same TSL recipes with `forceWebGL: true` | WebGPURenderer on its **WebGL2 backend** |
| `glsl-hero.png`, `glsl-pack.png`, `glsl-thumb-40px.png` (+`@8x`) | the GLSL route: plain `WebGLRenderer`, `MeshToonMaterial` + `onBeforeCompile`, prepass + one quad pass (no bloom, no FXAA) | plain WebGLRenderer (WebGL2) |
| `minimal-props.png` | the recipes on a barrel, crate, cone and glowing beacon | WebGPU |
| `debug-shade.png`, `debug-id.png`, `debug-edge.png` | intermediate channels (`dbg=`): shade (0 lit, 1 cast shadow), hashed object ids, edge mask | WebGPU |

Stills use `grainAmt=0` (film grain on would add noise and triple the PNG size); the grade and vignette are on.

**Renderer backend actually used:** WebGPU (Dawn on Metal, adapter `apple`/`metal-3`) for every file except the three
`glsl-*` files (plain WebGLRenderer on ANGLE Metal, `Apple M1 Pro`) and `hero-webgl2.png` (WebGL2 backend of
WebGPURenderer). `captures.json` records the backend string per shot.

## Frame cost (headless Chromium on the Mac, 1920x1080, hero view, 100 frames, median of 3 runs; NOT a perf receipt)

One car, one sun shadow map, no other load, so these only compare the treatments with each other. `pipelined` submits 100
frames then waits once; `serial` waits for the GPU after every frame (an upper bound with one round trip each).

| Config | pipelined ms/frame | serial ms/frame |
|---|---|---|
| plain, WebGPU (MSAA) | 0.48 | 0.93 |
| comic, WebGPU (TSL, all effects) | 0.68 | 1.46 |
| comic, WebGPU, `outline: 'ids'` | 0.60 | 1.38 |
| plain, WebGPURenderer on WebGL2 backend (MSAA) | 1.06 | 1.75 |
| comic, WebGPURenderer on WebGL2 backend | 0.83 | 1.43 |
| comic, plain WebGLRenderer (GLSL route, prepass + MSAA scene RT) | 1.95 | 2.63 |

Numbers are from `captures.json` (the last of several full runs; the serial column moved by up to about 0.3 ms between runs,
for example plain WebGPU 0.91-1.11, so treat differences under that as noise). The comic look adds roughly 0.5 ms (serial) at
1080p on WebGPU for this scene; the WebGL2 rows are not like for like (plain pays MSAA, comic TSL does not). The 24-tile cost
U05 must record is not measured here.

## Known defects and open points

- `webgpu-threejs-tsl` has no upstream LICENSE file (see above); owner call whether MIT-by-declaration is enough.
- Ids of dynamic objects are hashed into a half-float; two adjacent cars whose hashes land within 0.02 lose their mutual
  outline (depth/normal terms still draw most of it). No count limit.
- The 24-tile case (one MRT scene pass for all viewports, per-tile tier table) is design only; a single tile was rendered.
- Selective bloom, damage creep, shimmer, fringe and FXAA are not in the GLSL route; impact words, squash, flames, sparks,
  weather sets, ground variants and signs are sketches (`recipes-extra.md`), not rendered.
- Transparent effects (sprites, flames, smoke) will write junk normals/ids into the outline targets unless given an
  `mrtNode` or drawn after post; stated in `recipes-extra.md`, not yet exercised.
- Headless, not headed; one GPU (M1 Pro). Safari/WebKit WebGPU, iOS and weaker GPUs were not tried.
- Ground blotches show contour-like banding at grazing distance (posterised noise); acceptable for sun-bleached ground, tune in U05.
