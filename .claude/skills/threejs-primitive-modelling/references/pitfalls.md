# Pitfalls (symptom → cause → fix), all hit while building the Cruze + bin

## Shape and seams
| Symptom | Cause | Fix |
|---|---|---|
| Dark trough along the beltline; window frame ends in sharp wedges that dig into the dome ("pinch") | Body = tub loft + greenhouse loft meshed separately (hard concave crease); door = 3 patches (lower, ruled belt strip, frame) with straight slanted edges | `LoftUnion` (smooth-min, `k≈0.6–0.8`), chassis from `radial()`, **one** door skin whose top edge follows `roofline − 0.13`, glass as rounded-corner inlay (`round≈0.55`) |
| Fat roll / fold at the A-pillar base | Greenhouse ends abruptly (still full width) so the union has a step where the top loft stops | Add end stations that taper inward and down to a hair-thin slab buried in the base loft; move bonnet/boot cut lines beyond the taper |
| Crinkled shading across a fillet | Rays from the axis meet the fillet almost edge-on: ~1 sample across it | `radial({flank})` remaps the ray angle to bunch samples at the flanks; raise `nu` |
| Ragged patch edge where a panel crosses a crease | Coarse panel grid chords cut the convex crease | Cut panels from the blended surface (no crease), not from two lofts |
| Jagged "torn paper" edge on the dark missing-door opening | Hard inside/outside vertex paint on a coarse mesh | Distance-based soft falloff (`depthIn` + `sstep`) |
| Pale blotch below the mirror | It is the mirror's soft **shadow** | Check the light direction before touching geometry |
| Shards/garbage geometry near arches or the roof edge | `probe` missed and fell back to a clamped point | Restrict the sample domain (chop arch discs at the shoulder), narrow the decal, or assert a hit |
| Grille chrome ring cuts the plate corners | Outline walked a circle in decal-parameter space | Trace the boundary of the unit square (superellipse p≈8) then map through the same shape fn |
| Tyres look like tank tracks | Tread blocks across the full width | Smooth kart tyre, thin sidewall ring in the paint function |
| Rim hidden by the tyre | Tyre profile closed to the axis as a solid disc | Tyre is a ring (inner radius = rim), dish sits inside it |

## Deformation
| Symptom | Cause | Fix |
|---|---|---|
| Dent shows as a black hole | Panel dents below the dark shell behind it (shell not dented, or dented less) | Apply the same dent to the shell with larger radius (×1.3) and depth (×1.4), no scuff — and make sure the chassis part has `userData.jj` so the sim can find it |
| Detached door looks like two sheets | Lower panel and window frame were separate shells | One continuous door skin |
| Debris lands then vanishes | Particle `life` expiry | Persist until `reset()` (owner ruling) |
| Bin squish leaves the inner wall tall | Crushed only the outer mesh | Crush every mesh under the part |
| Lid hit topples the bin | Any hit >0.55 triggered knock-over | Only body hits ≥0.55 (or any ≥1.3) |
| Dent reads wrong after `wake()` | Merged intact proxy and the parts diverge | Hits call `wake()` first; `reset()` calls `showIntact()` |

## Performance and plumbing
| Symptom | Cause | Fix |
|---|---|---|
| LOD1/2 barely smaller | Fixed-segment primitives (rounded boxes, tube caps, spheres) dominate | LOD table drives every primitive; tube caps at 3 rings; rounded box → `BoxGeometry` at low tiers |
| 24 cars take 1.4 s to instance | `Object3D.clone()` `JSON.stringify`s userData containing scene graphs / Rapier handles | Stash `parts, ctx, intact, dmg, spin, …` off userData while cloning |
| Stats show 95 k tris for a 55 k car | Counted meshes whose *parent* is hidden | Walk ancestors for `visible` |
| Browser shows stale code after edits | `python -m http.server` sends no cache headers | In browser-harness: `cdp("Network.setCacheDisabled", cacheDisabled=True)` then `Page.reload ignoreCache` |
| Screenshot smaller than the render | Canvas size ≠ viewport | Set `page.setViewportSize` **and** `stage.setSize` |
| Exported GLB parts "at origin" | GLTFExporter writes a `matrix`, not `translation` | Read `matrix[12..14]` when checking pivots |
| Dev server exposed on the LAN | `http.server` binds 0.0.0.0 and serves the whole repo | `--bind 127.0.0.1` |
| Text glyph boxes (□) in PIL labels | Helvetica.ttc lacks arrows | Use ASCII in labels |

## Reading a minified reference bundle
Download `game.js` with browser-harness `http_get`, beautify with `npx prettier --parser babel`, find the kit by grepping
for `vertexColors`, `mergeGeometries`, `LatheGeometry`, `onBeforeCompile`, `castShadow`; the kit is contiguous. Infer
roles from behaviour; mark anything inferred as inferred.


## Round 3 additions
| Symptom | Cause | Fix |
|---|---|---|
| Dark wedges smeared over doors/bonnet on coarse LODs | "under-panel" darkness painted into body vertex colours | explicit dark **bay** patches on the same grid as the panel, dented with the shell |
| Bay pokes through its panel at low LOD | bay and panel on different grids → different chord error | build the bay from the identical grid, 10–14 mm lower |
| Wheels float 2–4 cm at LOD2/3 | tyre profile radius < wheel radius, or vertex count not divisible by 4 | tread radius exactly R; segments ∈ {8,12,16,…} |
| Glass looks "funky" (wedges, mismatched shapes) | window outlines invented as straight-sided quads | Coons patch of the **measured** daylight-opening polygon, soft corners |
| Lots of cute detail but "isn't a Cruze" | flourish outweighed measured cues | recognition spec + gates (roofline, glass, lamps, grille, proportions, silhouette IoU) |
| Rule reads 3× the vertices it should | glTF primitives of one mesh share a vertex buffer | read each primitive's index range; edit/write each accessor once |
| Original validator says "no mesh to measure" | mesh was on per-material child nodes | the part node is the mesh (multi-primitive); trims are `_trim` children |
| Node-name mismatch across LODs | detail nodes only existed at high LOD | emit empty groups at every LOD |
| Roofline gate finds no roof at LOD3 | vertex sampling; coarse mesh has no centreline vertices | vertical ray/triangle casts |
| Checker says a hinge opens the wrong way | measured the "free edge" from the origin, not from the hinge axis | distance from the axis line |
| `L.rim` is a string → NaN cylinder segments → zero-triangle parts | reused a numeric option name for a style flag | separate numeric and enum fields; the per-part breakdown reveals zeros |
| Command hook blocks a harmless shell heredoc | a safety hook false-positive on unrelated text | split the command; don't try to bypass |
| Concave "neck" between greenhouse and haunch (outline goes convex-concave-convex from the rear) | greenhouse loft is a boxy slab, narrower than the tub, widest above the belt; the smooth-min can only fill the shelf | make the rear greenhouse stations start at the belt at the tub's width (`yb` ≈ belt, `w` ≈ tub `w`), tumble 0.2, lower exponent; blend in over ~0.7 m |
| Glass / door top edge "floats" off the body with bright shards near the roof edge | panel grid is a few samples across a corner of radius ~10 cm: the chord cuts through the surface and the liner shows | denser glass/frame grids (×2) and door rows **bunched toward the roof edge** (`1-(1-b)^1.3`) plus extra rows; do it only on LOD0/1 (LOD2/3 doors have 3–4 rows and the bay tears through) |
| Bunched rows open dark streaks at the sills | bunching starves the *bottom* of a panel of rows | keep the exponent ≤ 1.35 and add ~35% rows to compensate |
| `mesh.visible = undefined` does not hide a mesh | three.js tests `visible === false` | assign `!!x` when isolating parts for debugging |
