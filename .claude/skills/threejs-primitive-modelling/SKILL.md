---
name: threejs-primitive-modelling
description: >
  Model, optimise and SHIP game assets (vehicles, props, characters) directly from Three.js primitives in code — no Blender, no
  hand-authored GLB, no paint textures — using the "Chef Clash / dontdie.wtf/cooked" method: cached unit primitives, spline lathes, analytic
  lofts and boundary-curve patches, colour painted per vertex by position functions, merged per material. Covers the whole loop:
  recognition-first design measured from reference images, runtime dents and hinge-then-detach parts (Rapier), parametric LODs with
  enforced triangle budgets, an intact-mesh draw-call fast path, bake to contract-valid GLB + sidecar, and the automated gate suite
  (validator, physics, render, determinism, defect-injection selftest) that keeps it honest. Use when asked to build or change a
  code-only model, make a procedural asset "recognisable", add deformation/destruction to it, cut its triangles, or make it pass a
  contract/perf gate. Not for hand-sculpted hero meshes or imported-GLB pipelines (see game-model-prep / vehicle-model-validation).
---

# Three.js primitive modelling (code-only assets)

Reference implementation: `spikes/art-pipeline/H-primitive-kit/` (Cruze sedan + wheelie bin; `REPORT.md`, `gallery.html`, `ASSET-CONTRACT-PROCEDURAL.md`).
This skill bundles self-contained copies of the generic kit and gate tooling in `assets/` (refresh with `scripts/sync.sh`); the project-specific
material (part names, budgets, style sources) is isolated in **`references/project-adapter-jj.md`**. Read `references/kit-api.md` before writing code.

## The idea in six lines
1. **Assets are functions.** A model is code building `THREE.Group`s. LOD, recolour, damage and iteration are parameters; nothing binary to review.
2. **Colour lives in vertices.** One shared material per *kind* (`vertexColors:true`, white base); dirt/AO/edge shading come from a paint
   function of position. Player colour is a *tinted* clone of the paint material, so baked shading survives recolouring.
3. **Shapes from a small toolbox:** cached unit primitives, spline **lathes**, **analytic lofts** (superellipse sections) blended with smooth-min,
   **boundary-curve (Coons) patches** for panels and glass, extrusions, tubes; details are decals placed by ray-probing the surface.
4. **Builder merges by material.** `KitBuilder.add(geo, kind, {p,r,s,c,g})` → `mergeGeometries` per material. Every detachable part is its own
   group with its origin on the hinge/hub.
5. **Deform the real vertices.** Panels are dense grids, so dents are CPU vertex edits recorded as `{part,pos,dir,radius,depth,severity}`
   (unbounded, replayable, no morph targets). Detached parts carry their dents.
6. **Ship through a contract.** Bake to GLB (+ sidecar) in the game's space and node conventions and let **hard gates** decide "done".

## Workflow — do the gates in order

| # | Step | Gate (look at it, or run it) |
|---|---|---|
| 0 | **References + style.** Get orthographic refs and the house-style blocks (see the project adapter). Measure them (`recog/measure_side.py`, `grid_overlay.py`). | refs share a ground line/scale; brand marks stripped |
| 1 | **Recognition spec.** Write down the 5–8 cues people use to recognise the subject and their measured positions (`recog/spec.js`). See `references/recognition-first.md`. | every cue has a number and a gate |
| 2 | **Harness.** Static server on `127.0.0.1`, Playwright + system Chrome, a `dev.html`/closeup script. | a screenshot in < 10 s |
| 3 | **Silhouette first.** Lofts/lathes, no trim; near-orthographic side/front/top vs refs. | reads as the subject in a 40 px thumbnail |
| 4 | **Split into parts** cut from the *same* blended surface; origins at hinges/hubs; dark bays as geometry. | exploded view; a missing part = a clean dark opening |
| 5 | **Cues + paint.** Build the recognition features exactly as measured; then vertex-paint functions. Flourish last, sparingly. | recolour works; no texture files |
| 6 | **Damage.** dent → loose → detach state machine, hull colliders from dented vertices. | strip: pristine → dents → loose → detached; no poke-through |
| 7 | **LOD table + budgets.** One table drives every primitive; per-tier cuts by distance. `references/optimisation.md`. | tri breakdown per part; ladder review at 40/100 px |
| 8 | **Bake + contract.** `contract.js` → GLB/sidecar. `references/contract-and-gates.md`. | `check_asset --bake --selftest` green |
| 9 | **Perf.** Intact fast path, template/instance, 24-tile grid *from the GLB*. | draws/tris/ms recorded |

Iterate with **one visible change per render**, always three views (hero 3/4, dead side, close-up of the area you changed) plus wireframe when
shading is odd. Review the **whole LOD ladder** after any geometry change: coarse tiers reveal problems the hero hides.

## Rules that paid for themselves
* **Recognition is the invariant; flourish is negotiable.** Copy measured cues, scale them, don't restyle them. Cute = proportion (bigger wheels, shorter
  wheelbase, softer volumes), not new shapes. When feedback says "too bubbly / funky window", the fix is *less* invention, more measurement.
* **Never mesh two lofts and stitch.** Blend them (smooth-min), cut everything from the blend. A concave crease shows up as a pinch at the belt line.
* **Windows and panels are defined by their edges** (polyline/Coons patches of the measured polygon), not by a warped rectangle.
* **Budgets are hard gates, dentability is a budget.** A mesh too coarse to dent fails the build. Triangles follow visibility: cut what a camera at that
  distance cannot resolve, keep the cues.
* **A gate you have not tried to fool is a hope.** Keep a defect-injection selftest; the first run of any gate finds bugs in your own asset *and* in the gate.
* **Cross-check against any existing validator** for the same contract; the disagreements are either deliberate profile differences (document them) or bugs.
* **Test the shipped file, not the code that made it:** load the GLB through `GLTFLoader` and drive it with the runtime rig.
* No arbitrary gameplay caps; asset budgets are not player caps.

## Deformation rules
* Dent: move vertices inside a radius along (impact dir ↔ −surface normal), falloff `(1−d²)²`, crumple ripple, scuff colour, `computeVertexNormals`. Dent the
  **shell behind** a panel too (a bit bigger/deeper, no scuff) or a deep dent pokes through the bay.
* Only dent meshes built from grids (`surfaceGrid`/`probed`). `RoundedBoxGeometry` has one flat quad per face.
* State machine per part: `fixed → loose` (spring to an "ajar" angle; wheels wobble) `→ detached` (re-parent keeping world pose, Rapier dynamic body,
  convex hull from the part's own vertices, cylinder for wheels, CCD). Debris needs **damping** or wheels roll forever; flush panels need a collision
  **grace period** at detach.
* Record hits; the same hit list on a fresh instance must give bit-identical vertices.

## Performance patterns
* **Intact bake:** merge all non-wheel parts to ~10 meshes; show them until the first hit, then swap to parts (`bakeIntact`, `bakeIntactTemplate`).
* **Template + instance:** build once per LOD, instantiate per car (shared geometry, tinted materials, copy-on-write geometry on first dent).
  Strip live scene-graph references from `userData` before `clone()`.
* **LOD selection by projected pixel height with hysteresis** (`pickLod`); thresholds from your own 40/100 px captures.
* Count draws with **inherited visibility**.

## Pitfalls
See `references/pitfalls.md` (symptom → cause → fix table: pinch, crinkle, thin-fold A-pillar, wheel floating at low LOD, shared vertex buffers between
primitives, GLTFExporter `matrix` nodes, multi-primitive rules, hook false-positives…).

## Verification checklist before calling it done
- [ ] Turnaround + near-orthographic vs refs; recognition sheet (reference vs ours, cues labelled)
- [ ] LOD ladder with wireframes and 100/40 px thumbnails; per-part triangle breakdown
- [ ] Damage strip + video; no poke-through; detached parts keep dents
- [ ] `check_asset.mjs --bake --selftest` green; original/other validator cross-checked, differences documented
- [ ] GLB loads through GLTFLoader; rig smoke passes; 24-tile grid numbers recorded
- [ ] Owner has looked at the gallery; say what was measured, what was inferred, what was not tested
