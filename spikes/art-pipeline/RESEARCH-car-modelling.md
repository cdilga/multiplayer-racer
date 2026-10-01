# Research: authoring a stylised, script-built low-poly game car (Joystick Jammers)

Context: previous attempt lofted superellipse cross-sections from pixel-measured ortho reference
profiles → dense (~4k tri chassis), lumpy "melted" surface, sawtooth part seams from face
classification, floating light boxes, wheels poking through body, no panel lines. Target: 1-3k tri
gameplay mesh (wheels incl.), LOD 500-1k / 150-400, part-split for destruction, UV0 + single RGBA
mask, hinge/hub pivots, authored by an AI agent writing Blender 5.2 Python (bpy/bmesh), headless,
with live Blender MCP for inspection. No image-to-3D API keys; Codex/ChatGPT image gen available
for concept/ortho refs.

---

## 1. How professional low-poly/stylised car artists actually work

Across tutorials, Polycount threads, and studio blogs, the workflow is consistent and is the
opposite of what the previous attempt did:

- **Blockout first, cut panels last.** Build the whole car body as *one continuous shell* with
  clean, sparse topology and no subdivision, purely to nail proportions and silhouette. Only after
  the surface "reads" correctly (in particular, after checking it under raking light / as a mirror,
  since a car body is essentially a giant curved mirror) do panel gaps, doors, hood and boot lines
  get cut in. Cutting seams early, before the surface is locked, is called out repeatedly as the
  classic beginner mistake — it "ripples" the surface and produces exactly the sawtooth/lumpy
  seams the previous attempt hit. ([Low Poly - Stylised Modelling Workflow — Polycount](https://polycount.com/discussion/153846/low-poly-stylised-modelling-workflow), [3D Car Models for Games — Sunstrike Studios](https://sunstrikestudios.com/en/blog/car_modeling_for_games/))
- **Box-modeling from orthographic blueprints**, loaded as background reference images (front/side/
  top planes in Blender), mirrored on X. Artists start from a cube, extrude/box-model half the car
  under a Mirror modifier, keeping the cage very coarse (a handful of key stations: front bumper,
  wheel arch front, A-pillar, roof, C-pillar, rear bumper) rather than sampling many silhouette
  points. ([Full Tutorial: Low Poly car in Blender — BlenderNation](https://www.blendernation.com/2024/06/14/full-tutorial-3d-modeling-a-low-poly-car-in-blender/), [3D Low Poly Car Modeling in Blender — Udemy](https://www.udemy.com/course/3d-low-poly-car-modeling-in-blender/))
- **Control cage + Subdivision Surface, applied down, not sculpted up.** The professional
  "sub-D" pattern: build a coarse quad cage (the "control cage"), put a Subdivision Surface
  modifier on top, and use **edge creases / vertex "corner" weights** — not extra loops sampled
  from pixels — to pin exactly the hard lines you want (shoulder crease, bonnet edge, wheel-arch
  lip). Crease *only* the perimeter edges that are an intended panel break; leave everything else
  to smooth naturally. This gives "soft, premium curvature and controlled manufactured detail"
  from a handful of control points, then you apply the modifier at level 1 (or bake) to get the
  final low-poly mesh. This directly replaces "loft many measured cross-sections" with "a few
  creased quad loops" — far fewer points, much less noise. ([Subdivision Surface Modifier — Blender Manual](https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/subdivision_surface.html), [Rhino tip: SubD creases and corners](https://novedge.com/blogs/design-news/rhino-3d-tip-controlling-subd-edge-sharpness-with-creases-and-corners))
- **Edge flow around wheel arches**: arches get *more* geometry density than flat door panels
  because of the tight curvature, with a clean radial loop ringing the arch lip that both other
  panel edges terminate into — this loop is also the natural seam for a wheel-arch panel.
  Boolean-cut arches are common but always need manual clean-up afterward (both meshes must be
  manifold/watertight going in; after the cut you delete interior faces, weld by distance, and
  manually re-quad the ring around the hole) — booleans are a shortcut for the *cut*, never a
  substitute for topology control. ([Smart Mesh Topology for Vehicles — Tripo3D](https://www.tripo3d.ai/blog/explore/smart-mesh-topology-for-vehicles-and-mechanical-parts), [Blender Artists: quad topology after boolean](https://blenderartists.org/t/how-can-i-clean-this-topology-to-quads/1613684))
- **Panel lines and separated parts (hood/doors/boot) are literal geometry breaks that follow
  existing edge loops**, not later face classification. The recommended method: once the shell
  reads well, *duplicate* the shell, select the region for e.g. the door along an edge loop that
  already exists in the cage, `Separate by selection`, and give the new piece a hair of thickness
  (inset + solidify) so it looks like sheet metal, not paper. Because the boundary is a pre-existing
  loop, the seam is clean by construction — there is no classification step to go wrong. ("The
  topology should break at seams, just as the real metal does.") ([Polycount / Tripo3D vehicle topology summary](https://www.tripo3d.ai/blog/explore/smart-mesh-topology-for-vehicles-and-mechanical-parts))
- **Lights and grilles are handled cheaply, mostly in texture, not geometry.** Consensus from the
  Sunstrike Studios guide and toy/low-poly kit conventions: model only the *outer lens shape* as a
  simple recessed or protruding shape merged into the body surface (never a separately-floating
  box), give it its own small material/mask region, and do the lens detail (reflector facets,
  amber corner, honeycomb grille) as a texture/emissive on a flat or shallow-depth card. Full 3D
  honeycomb grilles can strobe/moiré at motion and are not worth the tris. A believable trick: a
  slightly recessed face on the body cage + a normal/emissive-mapped card for the lens internals.
  ([3D Car Models for Games — Sunstrike Studios](https://sunstrikestudios.com/en/blog/car_modeling_for_games/))
- **Reference low-poly/toon car products** (Synty POLYGON Street/Pro Racer, City/Town packs;
  Kenney Car Kit CC0) universally use this recipe: a handful of big, chunky, slightly rounded
  primitive-like body panels, doors/hood/boot as separate simple pieces, wheels as separate
  reusable meshes (Kenney ships 8 interchangeable wheel models across 45 vehicles), and all fine
  detail (lights, grille, badges, panel gaps) done via a single small flat-color or low-res texture
  atlas rather than geometry. This maps almost one-to-one onto the brief's UV0 + single RGBA mask
  requirement. ([Synty POLYGON Street Racer](https://syntystore.com/products/polygon-street-racer), [Kenney Car Kit](https://kenney.nl/assets/car-kit))
- Mario Kart/CTR-style karts follow the same pattern at higher fidelity (~3k+ verts, but built by
  hand from control cages in Maya/Blender, not lofted); no public breakdown of CTR internals was
  found, but the modern low-poly-toon kart products on Sketchfab/CGTrader corroborate the same
  "chunky body + separate wheels + texture-carried detail" recipe. ([Low-poly Mario Kart models — CGTrader](https://www.cgtrader.com/low-poly-3d-models/mario-kart))

## 2. Techniques that specifically suit *scripted* (bpy/bmesh) authoring

- **Coarse quad cage from a small, hand-chosen set of key section profiles**, defined as data (a
  short Python list of station positions + width/height/crease flags), not sampled from a raster
  image. This is the single highest-leverage fix for the "melted" surface: pixel-measured profiles
  encode measurement noise as geometry; 6-10 hand-authored stations, each a simple quad ring, do
  not. Loft with `bmesh.ops.bridge_loops` or manual quad bridging between rings, so panel-boundary
  rings are explicit edges from the start.
- **Subdivision Surface + edge creases + `bmesh.ops.subdivide_edgering`-style control, applied at
  level 1 (via `object.modifier_apply` or `bpy.ops.object.modifier_apply` after baking) rather than
  left live**, so the exported gameplay mesh is the *coarse, creased* result, not a hi-poly bake.
  Creases can be set per-edge in bmesh (`bm.edges[i][crease_layer] = value`) entirely
  programmatically — this is exactly the kind of parameter a script controls well, vs. pixel noise.
  ([Subdivision Surface Modifier — Blender 5.2 Manual](https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/subdivision_surface.html))
- **Design the cage so panel boundaries ARE edge loops, not a later face-classification pass.**
  Concretely: tag each edge-loop-ring in the cage with a part name at creation time (e.g. a Python
  dict `ring_name -> part_id` or a bmesh face-map/vertex-group per station), so "door" or "bonnet"
  is a set of *contiguous rings you already built*, and `bmesh.ops.split`/`bpy.ops.mesh.separate`
  operates on that known boundary. This removes the "classify faces after the fact → sawtooth
  seam" failure mode entirely, because the seam edges were the loop boundary the whole time.
- **Curve/NURBS or "profiles-to-mesh" lofting** is a legitimate alternative to a bmesh cage:
  author a handful of Bezier/NURBS cross-section curves at named stations, use Blender's built-in
  Loft/`Curves to Mesh`-style bridging (or the `NURBS2Mesh` extension) to get a smooth quad-ish
  surface, then convert to mesh and decimate/retopo. This is more forgiving of "keep it smooth"
  but still requires hand-authored stations, not pixel-sampled ones, or you reproduce the same
  noise problem in curve form. ([Car Modeling Using NURBS — carbodydesign.com](https://www.carbodydesign.com/tutorial/148/car-modeling-using-nurbs/), [NURBS2Mesh — Blender Extensions](https://extensions.blender.org/add-ons/nurbs2mesh/))
- **Parametric/procedural car generators exist but are not a good fit as-is.** A commercial
  "Procedural Car Generator" (geometry-nodes based, Blender 3.0-4.0) and a "Procedural Traffic"
  add-on exist on Superhive/Blender Market, plus scattered Blender Artists geometry-node car rigs
  (wheel spin/steer without rigging) and city/road GN generators. None publish documented style
  presets for "exaggerated toy sedan with a specific real-car silhouette," and product pages give
  no verifiable topology/tri-count guarantees — they're built for generic traffic filler, not a
  hero, destructible, brand-specific gameplay car. Geometry Nodes *can* be authored/driven from
  Python (node trees are just data — `node_tree.nodes.new(...)`, set `default_value`s, connect
  sockets), so the *mechanism* (parametric, scriptable, non-destructive) is reusable even if no
  existing add-on fits; a bespoke small GN graph (chassis loft + arch boolean + crease) driven by a
  handful of exposed parameters is a real, buildable option, not just theoretical. ([Procedural Car Generator — Superhive](https://superhivemarket.com/products/procedural-car-generator), [How to Script Geometry Nodes in Blender with Python — CGWire](https://blog.cg-wire.com/blender-scripting-geometry-nodes-2/))
- **Shrinkwrap-based retopology** is the standard way to take *any* rough/organic blockout
  (including a metaball/SDF blockout, or a rough boolean result) down to a clean, low, quad
  cage: build the low cage by hand near the surface, add a Shrinkwrap modifier (Project or Nearest
  Surface Point, "Cage" enabled) targeting the rough shape, snap-to-face while modeling, then apply
  per-panel. This is a good *second* stage after either the cage or a curve-loft approach, and a
  plausible way to convert an SDF/metaball blockout into final topology if metaballs are used for
  ideation. ([Retopology using the Shrinkwrap Modifier — lesterbanks](https://lesterbanks.com/2011/09/blender-retopology-using-the-shrinkwrap-modifier/), [When to apply Shrinkwrap during retopology — Blender Artists](https://blenderartists.org/t/when-to-apply-shrinkwrap-during-retopology/1582004))
- SDF/metaball blockouts were not found to have a dedicated car-specific workflow in the
  literature searched; they're a reasonable *ideation* stage (very forgiving of scripted booleans
  of unions of metaball primitives for fenders/greenhouse) but every source converges on "retopo
  before it's a game asset," so treat metaballs as pre-viz only, not as a shortcut past
  retopology.

## 3. Judging quality automatically

- **Silhouette IoU against ortho refs** is an established, cheap metric: render the model's
  silhouette from front/side/3-quarter and compute intersection-over-union against the matching
  ortho reference mask. Used in recent 3D-reconstruction-evaluation work (e.g. "3D-CoS") as a
  primary geometric-fidelity score. This is directly automatable in the headless Blender pipeline
  (render silhouette pass, compare to the same-angle PNG masks already used to build the ortho
  refs) and gives a numeric, regression-testable gate ("did this edit make the front 3/4 silhouette
  worse?"). ([3D-CoS: VLM Code Synthesis for 3D Reconstruction — ResearchGate](https://www.researchgate.net/publication/406874895_3D-CoS_A_New_3D_Reconstruction_Paradigm_Based_on_VLM_Code_Synthesis))
- **Curvature/smoothness metrics**: no single named tool emerged, but the technique implied across
  sources is to check mean curvature variance across the surface (flag areas where adjacent-face
  normal deltas exceed a threshold) as a cheap automatable "lumpiness" detector — exactly the
  defect the previous pixel-sampled loft produced. Blender's own normal/curvature overlay
  (Viewport Shading → Cavity/Curvature) or a bmesh script computing face-normal angle deltas can
  serve as a fast pre-render gate before spending a vision-LLM call.
- **Vision-LLM critique loops**: current research (3D-DefectBench, Sept 2026) is directly
  applicable — render a **compact 6-view RGB set** (no depth/normal maps needed; a six-view
  protocol "performs comparably to denser multi-view settings" at much lower cost) and score
  against a small fixed taxonomy of binary defects split across geometry, texture, and
  prompt/reference alignment (9 categories in the paper). Its key caveat: **even the best VLM
  judges underperform trained human annotators**, and reliability drops further if your own
  labels/prompts are noisy — so use the vision-LLM loop as a fast *filter* (catch floating parts,
  gross asymmetry, wrong proportions, missing panel lines) and keep a human/owner spot-check
  before calling a model final, rather than trusting the VLM score as ground truth.
  ([3D-DefectBench — arXiv:2607.10826](https://arxiv.org/abs/2607.10826))
- **40px readability checks**: not covered by a dedicated named technique in the literature
  searched, but it composes directly from the above: render the model at actual in-game scale
  (e.g. 40x40px orthographic thumbnail) and (a) compute silhouette IoU at that resolution against a
  hand-drawn 40px "target read" silhouette, and (b) feed the same thumbnail to a vision-LLM with a
  fixed rubric ("can you identify: sedan vs SUV vs muscle car silhouette, wheel-well gap, lift
  height, tail-light cluster shape?"). This is a cheap extra evaluation stage layered on the same
  render-and-score infrastructure as the full-size checks, not a separate system.

## 4. Cel/toon + outline pitfalls on low-poly

- **Standard vertex normals on low-poly + toon shading combine badly**: linear interpolation of
  smoothed vertex normals across a coarse mesh directly produces the wavy/lumpy toon-shading band
  edges the brief is trying to avoid — the same failure mode a "melted" mesh shows even worse.
  Low-poly + no normal map = visible faceting once the toon ramp posterizes shading, because there
  aren't enough normal samples to hide the facets under continuous shading the way PBR/Lambert
  shading would. ([A Custom Normals Workflow for Toon Shading — aversionofreality.com](http://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow))
- **Custom/simplified normals decouple shading from topology**: the professional fix (from a toon
  character pipeline, directly transferable) is a *simplified proxy shape* whose smooth normals are
  transferred onto the detailed mesh (Blender's Data Transfer modifier, or a small Geometry Nodes
  graph doing `Transfer Attribute` on normals) so the toon shader reads clean gradients driven by
  a simple underlying form, while the actual game mesh keeps its low-poly panel breaks. For a car,
  this means: model (or reuse) a simplified "shading hull" — basically the un-creased, un-cut
  version of the body — and bake/transfer its normals onto the final part-split mesh, so panel
  seams and wheel-arch creases don't create hard toon-shading bands that don't belong there.
- **Hard edges are largely *wanted*, not a bug, for the cel look**: sources note that uniformly
  hard-edged (flat/faceted) shading is itself how a lot of toon-shaded low-poly gets its flat
  cartoon look; the actual pitfall is *inconsistent* smoothing (some auto-smooth angle threshold
  catching some edges and not others) producing visible seams/pinches only in some spots. Decide
  per-edge intentionally (sharp/mark-sharp on panel breaks and creases; smooth everywhere else)
  rather than relying on a single global auto-smooth angle across the whole part-split mesh, since
  different parts (bonnet vs. bumper vs. wheel) will want different thresholds.
  ([Cel-shading tricks — torchinsky.me](https://torchinsky.me/cel-shading/), [What Is a Toon Shader? — Autodesk](https://www.autodesk.com/solutions/toon-shader))
- **Outline-pass artifacts**: back-face/inverted-hull outline techniques can bleed through gaps at
  open seams (e.g. an ill-fitting door-to-body gap) and at overlapping silhouette edges; the fix is
  keeping panel gaps consistent and non-zero rather than coincident geometry (two faces sharing
  exactly the same position), which is also exactly what "give the separated door a hair of
  thickness" in section 1 already buys you for destruction/physics reasons.

## 5. Is image-to-3D + retopology realistic right now?

- **No hosted keys available** (stated constraint) rules out Meshy/Rodin/Tripo/Hunyuan-cloud APIs
  for this task as given.
- **Local/open options on Apple Silicon do exist in 2026** and are more mature than a year ago:
  - **TRELLIS.2 (community Apple Silicon port)**: pure-PyTorch/MPS, no CUDA required, GLB/OBJ
    export with baked PBR textures. Real numbers from the Show HN thread (more trustworthy than
    the SEO-farm "toolhunter.cc" page, which gave inflated/inconsistent specs): ~400K-vertex output
    meshes, ~3.5 minutes per image on an M4 Pro w/ 24GB RAM, ~15GB peak RAM, single-image input
    only. Community reception was mixed-to-skeptical — one commenter called quality "useless tier"
    vs. commercial Meshy, with the author agreeing texturing especially lags; geometry was rated
    "reasonable" among open options. ([Show HN: TRELLIS.2 on Apple Silicon](https://news.ycombinator.com/item?id=47828896))
  - **Hunyuan3D 2.1** also has a native MPS/Apple-Silicon path plus PBR texturing per general 2026
    surveys, in the same rough capability class.
  - **TripoSR** is the lightest option (~6GB VRAM) but is an older/simpler single-view model, most
    useful as a fast low-fidelity blockout generator, not a finishing tool.
  - A convenience wrapper ("Image to 3D Lab") bundles several of these (Pixal3D, TRELLIS.2,
    Hunyuan3D, SF3D) behind one local UI for Mac/Linux. ([Open Source AI 3D Model Generators 2026 — cmarix.com](https://www.cmarix.com/blog/top-open-source-ai-models-for-3d-image-generation/), [TRELLIS Mac — toolhunter.cc](https://www.toolhunter.cc/tools/trellis-mac))
- **Why this is still a weak fit for this brief even where available:** every image-to-3D model
  produces a dense, organic, non-manifold-ish triangle soup (hundreds of thousands of tris) with no
  concept of part boundaries, hub pivots, or panel seams — exactly the retopology-from-scratch
  problem the brief is trying to avoid, just moved one step later and now anchored to a mesh that
  doesn't natively separate into chassis/bumpers/doors/lights at all. AI retopology tools (Meshy's,
  Tripo3D's, layer.ai's) can rebuild quad-dominant topology at a target polycount, but none of them
  are described anywhere in the sources as being seam/part-aware — you'd still need a manual or
  scripted pass to *cut* panels along sensible loops after remeshing, i.e. you still need everything
  in sections 1-2 above, just applied to a retopo'd mesh instead of a from-scratch cage. Given a
  ~2-3k total-budget, part-split, hub-pivoted requirement, image-to-3D → retopo is realistically a
  *reference/blockout aid* (get a rough 3D "read" of the exaggerated proportions fast, in one image,
  to sanity-check the hand-authored cage against) rather than a production path to the final asset.
  It is also the only step that costs real local GPU minutes and 15-24GB RAM per iteration, which
  cuts against a fast scripted iterate-and-critique loop.

---

## Ranked recommendations

### 1. (Recommended) Hand-authored coarse quad cage + Subdivision Surface + creases, cage-defined seams, driven by a small Python data schema — done directly in bpy/bmesh
**Steps:**
1. Generate 2-3 ortho concept sheets via Codex/ChatGPT image gen (front, 3/4-front, side, rear) —
   used only as a *visual target for eyeballing/VLM critique*, never for pixel-sampling profiles.
2. Author a small Python data structure: ~8-10 named "stations" along the car's length (front
   bumper, headlight leading edge, front arch, A-pillar, roof mid, C-pillar, rear arch, rear bumper),
   each with hand-picked width/height/crease-flag values chosen by eye against the ortho sheet
   (not measured pixel-by-pixel). Encode each station as a quad ring in bmesh; bridge rings in
   sequence. Tag each ring/loop segment with the eventual part name at creation time.
3. Add Subdivision Surface (2 levels for preview), set edge creases from the data schema (shoulder
   line, bonnet edge, arch lip, boot lip = creased; everything else = free), inspect via Blender
   MCP screenshot, iterate stations only (never add ad hoc extra loops to "fix" a lump — fix the
   station data instead).
4. Apply modifier at a chosen preview level, decimate/collapse to hit the 1-3k tri close-mesh
   budget, then `bmesh.ops.split`/`Separate` along the pre-tagged rings into chassis / bumper_F /
   bumper_R / bonnet / boot / door_L / door_R / glass, each with a hub/hinge-aligned origin set via
   `object.origin_set` or manual matrix math.
5. Model lights/grille as shallow recesses in the cage (not floating boxes) with their own small
   flat material zone; wheels as a separate small reusable wheel mesh (hub, tread block-in, no
   organic tread loft) placed by hub pivot to guarantee no interpenetration with the arch.
6. Bake the single RGBA mask by assigning per-part/per-material IDs to UV0 islands.

**Risks:** requires the agent to make deliberate, chunky style calls (station widths/heights) —
harder to fully automate than "measure the image," and needs an explicit anti-perfectionism rule
("do not chase pixel-perfect against ortho refs, chase toy-proportions"). Creasing errors can still
recreate lumps if applied inconsistently between panels.

**Evidence it worked:** silhouette IoU vs. the ortho refs at both full-size and 40px thumbnail
render; tri-count assertion (≤3k close, ≤1k/≤400 LODs); a curvature-delta scan showing no outlier
faces (no "melted" noise); Blender MCP viewport screenshots from front/3-4/rear showing creased
panel lines, no floating lights, wheels flush with arches; vision-LLM rubric pass on the 40px
thumbnail identifying "sedan, swept headlight, high boot, lifted stance" unprompted.

### 2. Curve/NURBS station lofting → convert to mesh → same crease/split treatment as #1
Same station-based philosophy as #1, but stations are Bezier/NURBS cross-section curves lofted
with Blender's curve-to-mesh tooling (or the NURBS2Mesh extension) instead of a hand-bridged bmesh
cage. Slightly less scripting boilerplate for smooth curvature between stations; slightly less
direct control over exact quad layout, so panel-seam-as-edge-loop discipline (tagging boundaries
at station-definition time) still has to be enforced by the script, and the curve→mesh conversion
needs a controlled resolution setting to avoid re-introducing a dense/organic mesh.

**Risks:** conversion resolution defaults can silently blow the tri budget; less precedent found
for scripting this specific loft style than for bmesh cages; the wheel-arch boolean cut still needs
the same manual quad clean-up as #1.

**Evidence it worked:** same metrics as #1, plus an explicit triangle-count check immediately after
curve-to-mesh conversion (before any decimation) to catch runaway curve resolution early.

### 3. (Exploratory only, not primary) Local image-to-3D blockout (TRELLIS.2/Hunyuan3D on Apple
Silicon) purely as a proportion-check aid feeding back into #1
Generate a single dense mesh from the best ortho/3-quarter concept image, purely to get a fast 3D
"gut check" of whether the exaggerated proportions (swept headlight wrap, high short boot, lift)
read correctly in 3D before finalizing the station data in #1 — then discard the generated mesh
entirely rather than retopologizing it, since no source found describes existing retopo tooling as
part/seam-aware.

**Risks:** 3.5+ minutes and ~15-24GB RAM per iteration on a Mac is slow for a tight iterate loop;
community feedback rates current open Apple-Silicon image-to-3D quality as weak, especially
texturing; easy to waste time trying to salvage a generated mesh instead of treating it as
disposable reference.

**Evidence it worked:** would only be judged indirectly, via whether recommendation #1's silhouette
IoU/VLM scores improved faster after using this as a proportion sanity-check step vs. without it —
i.e. this is a process aid, not something to gate on its own output quality.

---

## Sources
- [Low Poly - Stylised Modelling Workflow — Polycount](https://polycount.com/discussion/153846/low-poly-stylised-modelling-workflow)
- [3D Car Models for Games: Modeling Workflow, Topology & PBR Guide — Sunstrike Studios](https://sunstrikestudios.com/en/blog/car_modeling_for_games/)
- [Full Tutorial: 3D Modeling a Low Poly car in Blender — BlenderNation](https://www.blendernation.com/2024/06/14/full-tutorial-3d-modeling-a-low-poly-car-in-blender/)
- [3D Low Poly Car Modeling In Blender — Udemy](https://www.udemy.com/course/3d-low-poly-car-modeling-in-blender/)
- [Subdivision Surface Modifier — Blender 5.2 LTS Manual](https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/subdivision_surface.html)
- [Rhino 3D Tip: Controlling SubD Edge Sharpness with Creases and Corners — Novedge](https://novedge.com/blogs/design-news/rhino-3d-tip-controlling-subd-edge-sharpness-with-creases-and-corners)
- [Smart Mesh Topology for Vehicles and Mechanical Parts — Tripo3D](https://www.tripo3d.ai/blog/explore/smart-mesh-topology-for-vehicles-and-mechanical-parts)
- [Blender Artists: How can I clean this topology to quads?](https://blenderartists.org/t/how-can-i-clean-this-topology-to-quads/1613684)
- [Blender Artists: When to apply Shrinkwrap during retopology?](https://blenderartists.org/t/when-to-apply-shrinkwrap-during-retopology/1582004)
- [Retopology in Blender using the Shrinkwrap Modifier — lesterbanks](https://lesterbanks.com/2011/09/blender-retopology-using-the-shrinkwrap-modifier/)
- [Car Modeling Using NURBS — carbodydesign.com](https://www.carbodydesign.com/tutorial/148/car-modeling-using-nurbs/)
- [NURBS2Mesh — Blender Extensions](https://extensions.blender.org/add-ons/nurbs2mesh/)
- [Procedural Car Generator — Superhive](https://superhivemarket.com/products/procedural-car-generator)
- [How to Script Geometry Nodes in Blender with Python (2026) — CGWire](https://blog.cg-wire.com/blender-scripting-geometry-nodes-2/)
- [Synty POLYGON Street Racer](https://syntystore.com/products/polygon-street-racer)
- [Kenney Car Kit](https://kenney.nl/assets/car-kit)
- [Low-poly Mario Kart 3D Models — CGTrader](https://www.cgtrader.com/low-poly-3d-models/mario-kart)
- [A Custom Normals Workflow for Clean, Stylized Toon Shading — aversionofreality.com](http://www.aversionofreality.com/blog/2022/4/21/custom-normals-workflow)
- [Cel-shading: some tricks that you might not know about — torchinsky.me](https://torchinsky.me/cel-shading/)
- [What Is a Toon Shader? — Autodesk](https://www.autodesk.com/solutions/toon-shader)
- [3D-DefectBench: A Controlled Factorial Study of VLM Evaluation Pipelines — arXiv:2607.10826](https://arxiv.org/abs/2607.10826)
- [3D-CoS: A New 3D Reconstruction Paradigm Based on VLM Code Synthesis — ResearchGate](https://www.researchgate.net/publication/406874895_3D-CoS_A_New_3D_Reconstruction_Paradigm_Based_on_VLM_Code_Synthesis)
- [Open Source AI 3D Model Generator: 7 Best Options for 2026 — cmarix.com](https://www.cmarix.com/blog/top-open-source-ai-models-for-3d-image-generation/)
- [Show HN: Run TRELLIS.2 Image-to-3D generation natively on Apple Silicon — Hacker News](https://news.ycombinator.com/item?id=47828896)
- [TRELLIS Mac: Best Image-to-3D Tools for Apple Silicon — toolhunter.cc](https://www.toolhunter.cc/tools/trellis-mac) (marketing/SEO page — treat specifics as unverified; cross-checked against the HN thread above)
