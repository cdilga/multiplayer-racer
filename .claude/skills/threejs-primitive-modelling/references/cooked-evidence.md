# The reference: dontdie.wtf/cooked ("Chef Clash", @_MaxBlade)

Facts observed (browser-harness, 2026-09-30):
* Page loads `index.html`, `style.css` (8 KB), **one** `game.js` (287 KB transferred / 1.09 MB raw; Vite bundle,
  Three.js `REVISION "186"`), manifest, icon, one 30 KB font. **No GLB/GLTF, no textures.**
* Post: x.com/_MaxBlade/status/2104704696967368758 — per its title the code was LLM-written (not verified further).

Mapping of the minified bundle (roles inferred from behaviour) to the kit in `spikes/art-pipeline/H-primitive-kit/kit/`:

| His name | Behaviour | Kit |
|---|---|---|
| `At/An(name, factory)` | string-keyed geometry cache, adds a white `color` attribute | `geo()` |
| `T2(kind)` | ~13 shared materials (`matte satin gloss ceramic leaf metal chrome wood paint emit water glass wisp`), all `vertexColors:true`, white base | `material()` |
| `Je` | `push/pop`, `add(geo, kind, {p,r,s,q,c,g,order})`, `box()`, `build()` → bucket by material → `mergeGeometries` | `KitBuilder` |
| `Vn`, `Qn` | Catmull-Rom profile → `LatheGeometry`; `Qn`: `pleats/amp/bend` hooks + AO | `lathe()`; bin `bodySurface()` |
| `R_` | generic parametric surface, central-difference normals, sampled winding fix | `surfaceGrid()` |
| `Ca`, `zr`, `ee/Ze` | bevelled extrude (centred), Catmull-Rom tube with caps, cached `RoundedBoxGeometry` | `extrude`, `tube`, `P.box` |
| `rr` | "aoBottom": darken toward the bottom via vertex colours | paint functions |
| `vR` | `onBeforeCompile` fresnel rim light before `opaque_fragment` | `installRim()` |
| `In`, `Ji`, `ai` | textured overlay materials from canvas-drawn textures (bin emblem, tomato slice) | `texturedMaterial`, `canvasTexture` |
| `Oa(scene,{keep})` | static batching by material | `bakeIntact()` |
| `xi.Spr`, `D_` | damped springs; chef rig from pivot groups and "beans" (squashed unit spheres between joints) | hinge springs in `DamageSim` |
| `Db`, `MC`, `wC` | offscreen state flipbook for QA, deduped by matrix/material hash | Playwright captures |
| palette `$n` | named candy palette constants (teal, coral, butter, lavender, mint …) | pick a palette per game |

His trash bin (`fR`): spline-profile lathe body with a per-vertex paint fn for bands and an inner dark rim, a separate lid
group with a knob, ring and base; open/close animated on the lid pivot. That is the direct ancestor of `bin.js`.

To re-inspect: `http_get` the bundle with browser-harness, `npx prettier --parser babel game.js > game.pretty.js`, read from
the geometry cache/material-kind definitions (~line 37800 in the beautified file) through the station builders (~48000).
