# Verification loop and reference imagery

## 0. Reference imagery (image generation)
The Cruze work used **Codex image generation** — but only via the *first* art-pipeline spike's outputs; the primitives
spike itself generated no new images:
* `spikes/art-pipeline/refs/{side,front,rear,top}.png` + `generation-prompts.txt` — flat orthographic technical
  turnarounds of a stock 2012 Holden Cruze (mid-grey body, dark-grey glass, white background, no shadows, no logos).
  Prompt shape: "Use case: scientific-educational. ONE orthographic technical reference PNG, exactly W×H … parallel
  orthographic projection, zero perspective … target bumper-to-bumper length N px … NO shadows, NO text, NO logos".
  Generate the side view first, then front/rear/top as companions that "match this exact car".
* The concept look (chunky toy, heroic stance) is the top-left tile of `spikes/art-pipeline/G-cruze-v2/out/r7/sheet.jpg`,
  from the master style blocks in `art/style/MASTER_PROMPTS.md` (VEHICLE / VEHICLE TURNAROUND / PROP TURNAROUND).
* Bin: `art/style/refs/wheelie_bin*.png`.
Run image generation with `codex exec` headless, **omit `--model`** (gpt-5-codex is blocked on this ChatGPT account); it
takes ~2 minutes per pair. Strip brand marks and protected motifs in the prompt AND review the output (imagegen adds
unrequested motifs). Measure proportions with `spikes/art-pipeline/measure_refs.py` (PIL only): wheelbase, height, width,
station profile. Real photos in the owner's zip are for *identity cues* (grille, lamps, fog pods), not for measuring.

## 1. Screenshot harness
Static server: `python3 -m http.server 8123 --bind 127.0.0.1` from the repo root. Playwright with the **system Chrome**
(`chromium.launch({channel:'chrome', args:['--use-angle=metal','--enable-gpu']})`) gives a real GPU on macOS. Page sets
`document.title='READY'` when built; the script waits for it and screenshots. Keep `preserveDrawingBuffer:true`.
`renderViews([{x,y,w,h,target,az,el,dist,fov}])` renders a contact sheet in one canvas (scissor per view).
Near-orthographic = small fov (6–14°) at large distance. Template: `scripts/shot.mjs`.

## 2. What to look at every iteration
1. Hero 3/4 (both front and rear), dead side, front, top.
2. A **close-up of the area you just changed** from two angles (this is how the belt-line pinch was diagnosed).
3. Wireframe when shading is wrong (creases, undersampling, z-fighting are visible immediately).
4. Ink on (outlines expose intersecting shells) and the exploded view (proves part origins).
5. Thumbnails at 100 px and 40 px tall.

## 3. Composite evidence (PIL)
`compose.py` builds: reference-vs-ours ortho comparison, LOD ladder with wireframes and thumbnails, damage strips.
Auto-crop by background distance, fit into equal tiles, label each. Keep them in `out/` (LFS-tracked PNG).

## 4. Metrics to record
Triangles, meshes (draw calls), materials, geometry KB, build ms per LOD; intact-bake meshes; 24-tile 4K grid ms +
draw calls + tris with each tile drawing only its own car; template build vs instance time; baked GLB size.
State the machine (Apple GPU numbers are relative, not phone numbers).

## 4b. Gates supersede eyeballing where they can
Recognition, roofline, glass, lamps, proportions, silhouette IoU, dent resolution, budgets, hinge direction, physics fit and determinism are automated (`references/contract-and-gates.md`). Use
your eyes for the things gates can't judge: charm, colour, shading, whether the cues *feel* like the subject.

## 5. Determinism checks
`replay_test.mjs`: same hit list on two instances → identical vertex hash; shared template has no private geometry.
`tools/validate_asset.mjs`: part names, pivots off-origin (reads `matrix` and TRS nodes), markers, `COLOR_0`, materials, budgets.

## 6. Done means
The checklist at the bottom of `SKILL.md` is green **and** the owner has looked at the gallery. Say what is inferred,
what was measured, and what you did not test (phones, driving physics, Rust port).
