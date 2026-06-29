# Asset Spike — Car Models for Joystick Jammers (2026-06-28)

**Goal:** find/evaluate ways to get good car models for a browser Three.js + Rapier arcade
multiplayer car-combat party game. Requirements: glTF/GLB, **low-poly** (mobile, up to ~60 cars
on screen), a **recolorable "paint" material slot** per player, room for a **roof-number decal**,
**correct scale/origin** to fit a Rapier box collider, and an on-brand **neon/arcade** look.

> **Status of this spike: timeboxed survey + real downloads. No game code was edited.**

## Context — current state of the pipeline (important)

`static/js/resources/VehicleFactory.js` does **not** load glTF/GLB today. It builds every car at
runtime from Three.js primitives: a `BoxGeometry` body, an optional box roof, four
`CylinderGeometry` wheels, plus headlight/taillight spheres. Cars are defined in
`static/assets/vehicles/default.json` (one file only). So this spike is really about **adding a
glTF path to VehicleFactory** and sourcing the meshes that feed it. The good news: the factory
already (a) tracks separate wheel meshes via `userData.isWheel` for visual sync, (b) takes a
per-car `color` override, and (c) reads a separate `physics` block with an explicit box/wheel
layout — all of which map cleanly onto a glTF body+wheels model.

Key numbers from `default.json` to match when scaling imported meshes: body **length 4, width 2,
height 1** (game units ≈ meters); wheel radius 0.35; wheelbase ±1.5 in Z, track ±0.8 in X.

---

## Track 1 — Royalty-free / CC0 sourcing ("muck")

### Source survey

| Source | License | Format | Poly range | Style | Link |
|---|---|---|---|---|---|
| **Kenney — Car Kit (v3.1)** | **CC0** (credit optional) | **GLB** + FBX/OBJ, shared 512² colormap | ~2.0–2.7k tris | Cohesive toy/arcade, flat-shaded | https://kenney.nl/assets/car-kit |
| Kenney — Racing Kit / Racing Pack | CC0 | GLB+FBX+OBJ | low | Same kit family (tracks, props, more cars) | https://kenney.nl/assets/racing-kit · /racing-pack |
| **Quaternius — Cars / LowPoly Cars** | **CC0** | GLB (via Poly Pizza), FBX/OBJ/Blend | ~0.4–3.2k tris | Flat-shaded, **body = own material** | https://quaternius.com/packs/cars.html · https://poly.pizza/bundle/Cars-Bundle-FE5IWe6OMk |
| **Poly Pizza** (Kenney+Quaternius+Google Poly mirror) | mostly CC0 / some CC-BY | **direct GLB** + REST API | low | mixed but filterable | https://poly.pizza · API: https://poly.pizza/docs/api/v1.1 |
| Sketchfab (Downloadable + CC0/CC-BY filter) | CC0 / CC-BY (per-model) | GLB/glTF | varies | inconsistent across authors | https://sketchfab.com/tags/low-poly-car |
| Khronos **glTF-Sample-Assets** | mixed (mostly CC0/CC-BY) | glTF/GLB | high-ish | realistic, **not arcade** (ToyCar, etc.) — useful as loader test fixtures only | https://github.com/KhronosGroup/glTF-Sample-Assets |
| OpenGameArt | per-item (filter CC0) | OBJ/Blend mostly | low | inconsistent; Kenney mirror present | https://opengameart.org/content/car-kit |
| itch.io game-asset packs | per-pack (many CC0) | mixed | low | Eclair "Car Kit GLB Pack" repackages Kenney to GLB | https://eclair-assets.itch.io/car-kit-glb-pack-50-free-cc0-3d-models |
| Google Poly (dead) | CC-BY | GLB | low | mirrored into Poly Pizza / archive.org | (use Poly Pizza mirror) |

**Bottom line on sourcing:** two CC0 libraries dominate and are purpose-built for exactly this —
**Kenney Car Kit** and **Quaternius Cars**. Both are CC0 (commercial OK, attribution optional),
both ship low-poly GLB, both have separated wheel meshes, and both look on-brand for a stylized
arcade game. Sketchfab is a per-model gamble; Khronos samples are realistic test fixtures, not
game cars. Everything else is a mirror of the first two.

### What I actually downloaded and inspected

Downloaded into `/Users/cdilga/Documents/dev/multiplayer-racer/scratch-assets/` (throwaway) and
parsed the glTF JSON with a custom inspector (`scratch-assets/inspect_glb.py`):

**Kenney Car Kit** (`kenney_car-kit.zip`, 4.8 MB → 50 GLBs + FBX/OBJ + 512² `colormap.png`):

| Model | Tris | Meshes | Materials | BBox (x,y,z) | Notes |
|---|---|---|---|---|---|
| `sedan.glb` | 2032 | 5 (`body` + 4 named wheels) | 1 (`colormap` tex) | 1.5 × 1.45 × 2.55 | clean centered origin, sits on ground |
| `hatchback-sports.glb` | 2088 | 5 | 1 | 1.3 × 1.25 × 2.85 | |
| `sedan-sports.glb` | 2088 | 6 (+`spoiler`) | 1 | 1.3 × 1.25 × 2.55 | muscle-ish |
| `truck.glb` | 2082 | 5 | 1 | 1.5 × 1.45 × 2.95 | |
| `race-future.glb` | 2068 | 5 | 1 | 1.2 × 0.93 × 2.66 | buggy/future silhouette |
| `kart-ooli.glb` | 2706 | 6 (+`character`) | 1 | 0.93 × 1.26 × 1.43 | kart |
| `wheel-default.glb` | 332 | 1 | 1 | separate wheel asset | for swapping wheels |

**Quaternius (via Poly Pizza direct GLB):**

| Model | Tris | Meshes | Materials | BBox | Notes |
|---|---|---|---|---|---|
| `truck_l200.glb` | 3232 | 4 (body + 3 wheel groups) | **8 named** (`White`=body, `Windows`, `Headlights`, `TailLights`, `Black`…) | 1.78 × 1.24 × 3.73 | **body is its own untextured material → ideal paint slot**; centered, on-ground |
| `quaternius_police.glb` | 388 | 1 (no wheel split) | 3 (color-factor mats) | 4.7 × 11.4 × 12.4 (odd) | this particular Poly Pizza id is mis-scaled/odd — illustrative only; download from the official Quaternius pack instead |

All Kenney + Quaternius files are real, load-clean GLB (`file` reports "glTF binary model,
version 2"), version-2, embedded geometry. They confirm the two viable archetypes below.

### The crux finding — two recolor architectures

The single most important result of this track is **how each library handles the body color**,
because that decides how the "paint slot" works:

- **Kenney = one shared `colormap` palette atlas (512²) for the whole kit.** Every part samples a
  flat swatch from that texture; the whole car is **one material**. *But* the body is a **separate
  named mesh** (`body`). So to recolor per-player you override just the `body` mesh's material with
  a flat `MeshStandardMaterial` of the player color (the swatches are flat anyway, so you lose
  nothing visually) — wheels/glass keep the atlas. Pro: one 12 KB texture shared across all 50
  models = tiny memory, perfect for instancing 60 cars. Con: recolor is "swap the body material,"
  not "set baseColorFactor."

- **Quaternius = materials split by function, untextured, color-by-factor.** The body has its own
  material (`White`, a neutral grey `0.55`) distinct from `Windows`, `Headlights`, wheels, etc.
  So the paint slot is literally `bodyMaterial.color.set(playerColor)` — the cleanest possible
  recolor. Con: more materials per car (8), no shared atlas, so batching needs care.

Both fit the neon/arcade look (flat-shaded, emissive-friendly). Quaternius is the better *paint*
model; Kenney is the better *consistent-kit + shared-texture + separate-wheels* model. You can mix:
use Kenney for silhouette variety and treat its `body` mesh as the paint slot.

---

## Track 2 — AI-tool-assisted generation

(Full per-tool detail from the dedicated research pass below; condensed here.)

### TL;DR

**AI image→3D for hero, recolorable car meshes is still the unreliable part of the pipeline in
2026.** Every tool produces a recognizable car, but none reliably delivers what we actually need:
a clean *separable* paint material (vs. baked-in albedo/lighting), correct real-world scale + a
centered origin for a box collider, separated/correctly-pivoted wheels, and a trustworthy
well-distributed poly budget at 60 instances on mobile. Expect a manual Blender pass per car
regardless of tool. **Conversely, AI is genuinely production-ready for the 2D side** — roof-number
sheets, livery/decal atlases, grunge/normal detail, tileable track textures — which is most of the
actual *art* workload for a recolorable arcade racer.

### Tool comparison

| Tool | Low-poly car quality | GLB? | Quad/retopo + poly control | Commercial license | Per-model cost | Scriptable API (no login) |
|---|---|---|---|---|---|---|
| **Meshy 6** | Very good (stylized) | Yes (+FBX/OBJ/USDZ/STL) | Yes — lowpoly mode, quad, polycount | Paid = full own; **Free = CC BY (attribution)** | ~$0.60 (Pro) | Yes, Bearer key (paid only) |
| **Tripo (P1/v3.1)** | Very good (vehicles strong) | Yes (+FBX/OBJ/USDZ/STL) | Yes — Smart Low Poly, quad, face_limit | Paid = full; Free = CC BY | $0.20–$0.50 | Yes, `tsk_` key; **300 free trial credits**; also on fal.ai/Replicate |
| **Rodin / Hyper3D 2.5** | Very good (hard-surface, quad) | Yes (+FBX/OBJ/USDZ/STL) | Yes — Quad mode, quality tiers | Creator=full but **no API**; fal.ai works | $0.40 (fal) | Direct API gated to $120/mo; **fal.ai is the easy path** |
| **Sloyd.ai (parametric)** | Clean low-poly, real LODs | Yes (+OBJ/STL/USD) | **Best — artist topology, LODs, UVs** | Commercial; ~$0.015/model | $15/mo ~unlimited | Yes (verify API onboarding reopened) |
| **Stable Fast 3D / SPAR3D** | OK with a good ref image | Yes (GLB only) | quad remesh flag, vertex target, **built-in delighting** | **Free <$1M rev (Community)** | $0.02 hosted / **$0 self-host** | **Yes — self-host, fully offline, no account** |
| **Luma Genie** | Mediocre (text-only) | Yes (+OBJ/FBX/USDZ) | Quad retopo, variable polycount | Pro SaaS, closed | Pro sub | Yes, Pro key only |
| **CSM / Cube** | Good + AI retopo + part-seg | Yes (+FBX/OBJ/USDZ) | Yes — retopology, `scaled_bbox` hint | Paid=own; Free=CC BY | ~$20–60/mo | Yes, `x-api-key` (paid) |
| **Hunyuan3D 2.5** | Excellent geo, **high-poly** | Yes (+OBJ) | tri default; fal retopo | **No EU/UK/Korea; 1M MAU cap** ⚠ | $0.05–0.45 fal / $0 self | Yes, `FAL_KEY`/self-host |
| **TRELLIS.2** | Strong, high-poly | Yes (+PLY) | tri; DIY decimate | **MIT — cleanest license** | $0 self-host | Yes, self-host/Replicate |

### Where AI 3D is unreliable for us (the hero-mesh requirements)

1. **Separable paint material** — generators bake albedo+lighting into one texture set; you get a
   textured blob, not a body/trim/glass/wheel split. Manual material assignment per car.
2. **Correct scale + centered origin for a Rapier box collider** — outputs come in arbitrary scale
   and arbitrary origin; only CSM's `scaled_bbox` even hints at dimensions. Plan a normalization
   pass (recenter to AABB center, scale longest axis to a fixed metric length).
3. **Separated, correctly-pivoted wheels** — not reliably produced; part-seg helps but isn't
   dependable.
4. **Trustworthy poly budget at 60 instances on mobile** — AI tri-meshes waste tris on flat panels
   and emit n-gons/non-manifold bits; budget a decimate/retopo/validate pass. Sloyd (parametric,
   real LODs) is the exception.

### Where AI is genuinely fine today

- **Static background props** (barriers, cones, stands, signage) — loose constraints, drop in.
- **2D outputs — the reliable, high-value part:**
  - **Roof-number sheets (0–9):** Ideogram (best in-image digit accuracy), `~$0.03–0.09/img`.
  - **Decal/livery sheets (transparent RGBA):** FLUX + LayerDiffuse via fal.ai, or OpenAI
    `gpt-image-1` with `background:transparent` (you own the output).
  - **Tileable track PBR + normals:** Substance 3D Sampler Text-to-Texture, or free
    ArmorLab/Materialize for normal-from-image.

### Lowest-friction API paths (documented, not signed up)

- **Stability SF3D self-host (FREE, offline):** clone `Stability-AI/stable-fast-3d`, one-time
  `huggingface-cli login`, `python run.py car_ref.png --remesh quad --texture-resolution 1024` → GLB.
- **Stability hosted:** `POST https://api.stability.ai/v2beta/3d/stable-fast-3d`, Bearer key,
  multipart `image=@car.png` → raw GLB (~$0.02).
- **Tripo:** `POST https://api.tripo3d.ai/v2/openapi/task`, `Authorization: Bearer tsk_…`,
  `{type:"image_to_model", style:"lowpoly", face_limit:6000, texture:true}`; 300 free trial credits.
- **Rodin via fal.ai:** `fal.subscribe("fal-ai/hyper3d/rodin", {prompt, geometry_file_format:"glb",
  material:"Shaded", quality:"low"})`, `FAL_KEY`, $0.40/gen.

> I did **not** sign up or pay for any service in this spike (no reachable zero-login car-mesh API
> without an account+key). Self-hosted SPAR3D is the only truly free/no-account path and needs a
> local GPU + one-time HF token; the exact commands are above.

### Caveats

Pricing/versions move monthly; figures are June-2026 doc/review snapshots — confirm at checkout.
Specifically: Sloyd API onboarding status, exact SPAR3D credit cost, and **Hunyuan's EU/UK/Korea
license exclusion + 1M-MAU cap** if you target European players (TRELLIS's MIT license avoids this).

---

## Track 3 — Program-based / skill-based generation

### Local tooling reality check

- **Blender: NOT installed** (`which blender` → not found). A bpy car-generator + glTF-export
  pipeline would require installing Blender (or `pip install bpy` headless) first.
- **codex: available** (`/opt/homebrew/bin/codex`) — usable for a second opinion on glTF inspection
  or a generator script (omit `--model`).
- node/npm + python3 present; the project already bundles `three` and `@dimforge/rapier3d-compat`
  via Vite/NPM (no CDNs, per CLAUDE.md).

### Option A — Three.js primitives at runtime (the current approach)

This is what `VehicleFactory._createVisualMesh()` does today: box body + box roof + cylinder
wheels + sphere lights, with seeded ±10% jitter for variety.

- **Ceiling:** it works, is zero-asset, and is trivially recolorable (`bodyMaterial.color`) and
  trivially fits a box collider (the body *is* a box). But it is visually a box-car — no curves, no
  fenders, no silhouette identity between "hatch" and "muscle" beyond proportions. For an on-brand
  neon arcade look it reads as "programmer-art." It cannot express the 3–5 distinct silhouettes the
  brief wants without becoming a mini modeling toolkit in code.
- **Verdict:** keep it as the **fallback / test path** (it's great for CI and headless tests where
  loading GLBs is undesirable), but it is not the shipping look.

### Option B — Parametric low-poly car generator (in-engine, data-driven)

Extend the primitive approach into a few hand-authored *profiles* (extruded body cross-section +
parametric cabin + fender boxes), driven by JSON. This is the "procedural lattice" route.

- **Pros:** infinite variety, tiny payload, perfect recolor + collider fit by construction, all in
  the existing data-driven `assets/vehicles/*.json` model.
- **Cons:** real silhouette quality (fenders, raked windscreens, wheel arches) is a lot of code to
  get to "looks good," and you're reinventing what Kenney/Quaternius already did for free under CC0.
  High effort-to-payoff vs. just loading a 2 KB-tris GLB.
- **Verdict:** not worth it as the *primary* mesh source given free CC0 kits exist. A *light*
  version (proportion sliders on top of a loaded base mesh) is worthwhile for cheap variety.

### Option C — Blender (bpy) scripted generation + glTF export

Script car assembly in `bpy` (or a generator like SimpleCarGenerator / a Sverchok graph), export
GLB with `bpy.ops.export_scene.gltf()`. This is the "generate our own asset library, offline"
route.

- **Pros:** full control over topology, **materials split for a paint slot**, origin/scale set
  exactly to spec, batch-export 3–5 silhouettes deterministically; runs headless in CI/asset-prep;
  pairs perfectly with AI image→3D bootstrapping (import generated mesh → re-origin → split
  materials → decimate → export to spec).
- **Cons:** **Blender isn't installed here** (setup cost), and authoring good car geometry in bpy
  from scratch is real modeling work. Its best use is **finishing/normalizing** (AI or scanned
  meshes) rather than from-scratch generation.
- **Verdict:** the right tool for the **asset-prep normalization pass** (re-origin, rescale,
  material-split, decimate, batch GLB export), *not* for from-scratch hero modeling. Install it
  when we adopt AI-bootstrapped meshes; not needed if we ship Kenney/Quaternius as-is.

### Track 3 verdict

Procedural generation's real role here is **normalization + variety on top of CC0 base meshes**,
not replacing them. The current runtime-primitive path stays as the CI/fallback renderer.

---

## Recommended pipeline

**Ship CC0 library base meshes + a runtime paint/decal/number material; use AI for 2D only; keep
runtime primitives as the fallback. Use Blender (once installed) only for an offline normalization
pass.** Argued from the findings: the two requirements that AI mesh-gen and pure-procedural both
struggle with — *clean recolorable material split* and *correct scale/origin for a box collider* —
are exactly what Kenney/Quaternius already deliver for free, today, in GLB. So the mesh problem is
already solved; the remaining work is integration (a glTF path in VehicleFactory) and the per-car
*variety* layer, where AI 2D shines.

### Concrete pipeline

1. **Base meshes — CC0 GLB.** Commit 3–5 chosen GLBs (Kenney + a couple Quaternius) into
   `static/assets/vehicles/models/`. Add a `visual.model` field to the vehicle JSON
   (`{"type":"gltf","url":"models/sedan.glb","paintMesh":"body","wheelMeshes":["wheel-*"]}`),
   keeping the current primitive block as `visual.fallback` for CI/headless.

2. **glTF loader in VehicleFactory.** Add `_createGltfMesh(config)` using three's `GLTFLoader`
   (NPM, already-bundled three). Traverse the scene: tag wheel nodes with
   `userData.isWheel = true` (so the existing wheel-sync in `create()` keeps working), find the
   paint mesh by name.

3. **Paint slot (per-player recolor).**
   - *Quaternius models:* clone the `body` material instance per car and
     `material.color.set(playerColor)`. Cleanest.
   - *Kenney models:* the `body` mesh shares the atlas; override just that mesh's material with a
     flat `MeshStandardMaterial({color: playerColor, emissive: playerColor, emissiveIntensity})` —
     swatches are flat so no detail is lost, and emissive gives the neon pop. Wheels/glass keep the
     shared 12 KB `colormap` atlas (great for instancing 60 cars).

4. **Roof number.** Project a `THREE.DecalGeometry` onto the top of the `body` mesh using an
   AI-generated transparent number atlas (Ideogram 0–9 sheet), or simply add a small textured
   quad parented above the roof. Data-driven: `decal.number` per player.

5. **Scale/origin → Rapier box collider.** Normalize on load: recenter to AABB center, then
   uniform-scale so the long (Z) axis matches the JSON `physics` length. Kenney sedan is 2.55 long
   → ×~1.57 to hit length 4; Quaternius L200 is 3.73 → ×~1.07. Origins are already centered on X
   and sit on the ground (min y ≈ 0), so the existing centered box collider + wheel layout in
   `default.json` fits with only a uniform scale + a small Y lift. Do the heavier normalization
   (re-origin/material-split/decimate) offline in Blender once, per imported AI/scan mesh.

6. **AI 2D layer (optional, high-value).** Generate number sheets (Ideogram), livery/sticker
   decals (FLUX-LayerDiffuse / gpt-image-1 transparent), and tileable track textures. No runtime
   AI dependency — bake to static assets at prep time.

7. **Fallback.** Keep `_createVisualMesh` (primitives) as the renderer when no `model` is present
   or in headless CI, so tests stay fast and offline (honors the no-CDN / fast-test rules in
   CLAUDE.md).

**Why not AI mesh-gen as primary:** the brief's hardest constraints (separable paint, box-collider
scale/origin, separated wheels) are precisely where AI image→3D is unreliable, and CC0 kits already
satisfy them. Reserve AI for bootstrapping a *new* silhouette we can't find, finished in Blender.

**Why not pure procedural as primary:** high code cost to reach silhouette quality that CC0 kits
give for free; keep it as the fallback/variety layer only.

---

## Second-pass refinement - Vehicle selection pipeline (2026-06-28)

**Status:** Jeff Emanuel planning-workflow iteration over the current spike and live code. This
does not replace the recommendation above; it sharpens the implementation boundary so the next
beads are self-contained. The key correction is that "asset pipeline" and "vehicle selection" are
not the same layer. The asset pipeline produces validated vehicle entries. The selection pipeline
lets players choose only from those entries, persists the choice, and guarantees the host can render
and simulate it cheaply.

### The revised thesis

**Build a catalog-driven selection pipeline, not a model-generation workflow.** In v1, the source of
truth is a small `vehicles/catalog.json` plus per-vehicle JSON manifests. The runtime never reasons
about "whatever GLB exists on disk"; it only accepts catalog IDs that have passed validation.

Recommended lock-ins:

1. **Source library:** use the staged **Kenney Car Kit first** for v1 breadth, but do not ship raw
   pack semantics. The debug viewer proved name/material heuristics are too weak: Kenney shares one
   material across body and wheels in many files, and Quaternius does not consistently name the body
   "body." Every selectable GLB must pass a small offline normalization pass that stamps our own
   conventions.
2. **Recolor:** ship **normalized `paint`/`tyre` material conventions + per-car material clones**
   first. `InstancedMesh` and per-instance color shaders are optimization paths, not prerequisites.
   The host is the main renderer in Local mode; 60 cars at roughly 2k tris each is a reasonable first
   measurement target, especially if we remove per-car point lights and use emissive materials
   instead.
3. **Number/decal:** use a **parented roof quad** in v1, not `DecalGeometry`. It is cheaper,
   deterministic, easy to orient on top-down cameras, and avoids projection edge cases on low-poly
   roofs. Decal projection can come later for side liveries.
4. **Normalization:** make **offline normalization a v1 prerequisite** for selectable GLBs. The
   runtime may keep a dominant-material fallback for debug tooling, but production should load assets
   that already expose `paint`, `tyre`, `glass`, `metal`, and `light` conventions, stable wheel names,
   declared scale, and a collider-fit manifest.
5. **AI/generated models:** keep them in a **quarantine lane**. They are allowed only after the same
   validation gate plus a Blender/glTF-Transform cleanup pass. They are not allowed to bypass the
   catalog because a generated mesh "looks good."
6. **Rigged player avatars:** defer. Vehicle selection v1 should not introduce a skeletal animation
   pipeline. If we need a visible driver, use a static seated low-poly driver mesh or the Kenney kart
   character. Full player avatars belong to a later identity/remote-viewer plan.

### Player-facing workflow

The selection workflow should be boringly reliable:

1. Player joins a room.
2. If they have no saved choice, assign a readable default: distinct color, first available vehicle
   silhouette, and a stable number.
3. Lobby shows a lightweight picker:
   - silhouette carousel: hatch, muscle, truck, buggy, kart
   - color swatches using the existing player-color palette
   - optional number picker or auto number
   - small preview, using the same catalog data as the host path
4. Player choice is sent as **appearance data**, not as arbitrary asset paths:

   ```json
   {
     "vehicleId": "kenney_hatchback_sports",
     "color": "#00ff88",
     "number": 7,
     "skinId": "default"
   }
   ```

5. Server validates `vehicleId`, `skinId`, `color`, and `number` against the catalog/rules, stores
   them with the player token, and relays the sanitized appearance to the host.
6. Host creates the vehicle by `vehicleId`, applies the color/number locally, and keeps physics from
   the vehicle manifest. Remote viewers later use the same sanitized appearance object.

This keeps trust boundaries clean: clients can ask for a catalog entry, but cannot make the host
fetch arbitrary files or create unbounded geometry.

### Catalog and manifest contract

Add a catalog file:

```text
static/assets/vehicles/catalog.json
```

Example shape:

```json
{
  "version": 1,
  "defaultVehicleId": "kenney_hatchback_sports",
  "vehicles": [
    {
      "id": "kenney_hatchback_sports",
      "name": "Hatch",
      "description": "Balanced arcade hatchback",
      "selectable": true,
      "sortOrder": 10,
      "config": "vehicles/kenney_hatchback_sports.json",
      "tags": ["starter", "compact"],
      "preview": {
        "image": "vehicles/previews/kenney_hatchback_sports.png",
        "accent": "#4cc9f0"
      }
    }
  ]
}
```

Per-vehicle JSON should extend the current `default.json` style rather than replace it:

```json
{
  "id": "kenney_hatchback_sports",
  "name": "Hatch",
  "visual": {
    "mode": "gltf",
    "model": {
      "url": "vehicles/models/kenney/hatchback-sports.glb",
      "templateId": "kenney_hatchback_sports_v1",
      "materials": {
        "paint": ["paint"],
        "tyre": ["tyre"],
        "glass": ["glass"],
        "metal": ["metal"],
        "light": ["light"]
      },
      "wheels": {
        "selectors": [
          { "node": "wheel_fl", "wheelIndex": 0 },
          { "node": "wheel_fr", "wheelIndex": 1 },
          { "node": "wheel_rl", "wheelIndex": 2 },
          { "node": "wheel_rr", "wheelIndex": 3 }
        ]
      },
      "normalization": {
        "forwardAxis": "z",
        "targetLength": 4,
        "groundY": 0,
        "origin": "aabb-center-xz-ground-y",
        "scale": 1.57
      },
      "numberMount": {
        "type": "roof-quad",
        "position": [0, 1.35, -0.1],
        "rotation": [-1.5708, 0, 0],
        "size": [0.9, 0.55]
      }
    },
    "fallback": {
      "mode": "primitive",
      "body": { "length": 4, "width": 2, "height": 1 }
    }
  },
  "physics": {
    "inherits": "default",
    "body": { "length": 4, "width": 2, "height": 1 },
    "colliderBorderRadius": 0.25,
    "colliderFit": {
      "mode": "per-silhouette",
      "visualCoverageMin": 0.92,
      "allowDriverHeadOutside": false
    }
  },
  "budgets": {
    "maxTriangles": 3500,
    "maxMaterials": 8,
    "maxTextureSize": 1024,
    "maxGlbBytes": 500000
  }
}
```

Important details:

- `visual.mode` chooses the path. `primitive` remains the CI/fallback renderer.
- `visual.model.url` is relative to `/static/assets/`, not an arbitrary network URL.
- `materials.paint` and `wheels.selectors` are conventions produced by the normalization pass, not
  best-effort guesses from source-pack names.
- `normalization.scale` is a manifest value produced by validation/import, not guessed during
  gameplay.
- `numberMount` is intentionally simple. A roof quad survives 60 cars better than projected decals.
- `physics` remains separate from the visible mesh, but collider fit is per silhouette. A kart with a
  visible driver cannot silently reuse a sedan hitbox that excludes the driver's head.

### Runtime architecture changes

`ResourceLoader` currently loads JSON only. Extend it in one narrow step:

- Add `loadModel(path)` using three's `GLTFLoader` from the npm-bundled `three/examples/jsm` path.
- Cache the **template GLTF scene** by URL.
- `VehicleFactory.create()` is already async, so it can await model loading without changing its
  public shape.
- Clone the cached template per spawned vehicle. If we ever accept skinned drivers, use
  `SkeletonUtils.clone`; for v1, avoid skinned meshes entirely.
- Traverse the clone:
  - apply cast/receive shadows
  - clone and recolor `paint` materials
  - force `tyre` materials to neutral black
  - tag wheel nodes with `userData.isWheel` and `wheelIndex`
  - attach roof number quad
  - strip or ignore embedded cameras/lights
- Do not add per-vehicle `PointLight`s in the GLB path. Headlights and tail lights should be emissive
  meshes only. Per-car lights are a bad trade at 24-60 cars.
- Keep `_createVisualMesh()` as `_createPrimitiveMesh()` and route through it for fallback/headless.

This keeps the runtime implementation small because the messy source-pack differences are handled
beforehand: JSON catalog, normalized GLB load/clone, selector traversal, paint/number application,
and tests.

### Import and validation gate

Use `.claude/skills/vehicle-model-validation/SKILL.md` as the human/agent review gate for this whole
section. The script below catches mechanical failures; the skill ensures the validator is applied in
context, with current requirements derived from the plan/code, screenshots, visual evidence, rig/state
previews, collider overlays, and check output before any model import is called done.

Add a script, preferably:

```text
scripts/validate-vehicle-assets.mjs
```

The script should fail CI if any selectable vehicle violates the manifest contract. It should check:

1. Catalog references only existing per-vehicle JSON files.
2. Every selectable vehicle has either `visual.mode = "primitive"` or a reachable local GLB.
3. GLB parses as glTF 2.0 and passes the Khronos glTF Validator with no errors.
4. Triangle count is within `budgets.maxTriangles`.
5. Material and texture counts are within budget.
6. No embedded cameras, animations, or lights in v1 selectable vehicles.
7. AABB dimensions after manifest scale match the declared physics body within tolerance.
8. Ground contact is sane: bottom Y near zero after normalization.
9. `paint` material convention resolves to at least one mesh.
10. `tyre` material convention resolves and stays neutral after recolor.
11. Wheel selectors resolve to four meshes, with stable wheel indices.
12. Wheel mesh pivots are close enough to their AABB centers for spin/steer to look correct.
13. Collider-fit coverage passes per silhouette, including karts/drivers.
14. Number mount is inside the vehicle AABB and above the roof.

Suggested tools:

- **Khronos glTF Validator** for spec compliance.
- **glTF-Transform** for inspection/optimization and optional texture resizing.
- **meshoptimizer/gltfpack** only if the first perf pass proves the simple GLB path is too heavy.
- Keep the existing `scratch-assets/inspect_glb.py` logic as a useful reference, but do not make
  scratch files the production validator.

This validation script is more important than the loader. It stops the project from accumulating
"almost good" models with hidden bad pivots, wrong scale, excess textures, or baked lights.
Passing the script is necessary but not sufficient: the project-scoped skill must also produce a
PASS/FAIL done report for each selectable vehicle or asset-pipeline change.

### Performance gates

Refine `FB-instperf` into a real decision gate:

1. Spawn 4, 24, and 60 vehicles on a fixed track.
2. Compare:
   - primitive fallback
   - GLB clone with material-per-car paint
   - GLB clone with shared materials except paint node
   - optional `InstancedMesh` prototype for one silhouette
3. Measure:
   - steady-state FPS
   - frame time p95
   - draw calls
   - GPU memory
   - model load time
   - spawn burst time
4. Test on the host-class machine first, then one mid-tier phone only for future Remote viewer
   sanity. AGENTS.md is clear that Local-mode phones are controllers, not renderers.

Decision rule:

- If 60 Kenney cars with cloned paint materials are smooth on the host-class target, ship that.
- If draw calls dominate, add a shader/per-instance-color path for same-silhouette cars.
- If GPU memory dominates, compress/resize textures before adding runtime complexity.
- If load burst dominates, preload catalog models in the lobby and pool clones.

### Source tiers

| Tier | Source | Use | Gate |
|---|---|---|---|
| A | Kenney Car Kit | v1 selectable vehicles | Normalize first; consistent kit; default source |
| B | Quaternius Cars | supplement silhouettes or paint-slot exemplar | Must be visually normalized against Kenney before selectable |
| C | AI/generated meshes | static props or one-off future silhouettes | Blender cleanup + validator + human visual review |
| D | Commissioned/custom Blender | future premium identity set | Same validator; preferred for bespoke polish |
| E | Rigged player avatars | not in vehicle selection v1 | Separate identity/avatar plan |

### Recommended implementation sequence

1. **Vehicle catalog/schema bead.** Add `catalog.json`, a schema/contract doc, and a validator that
   can pass with the existing primitive `default` vehicle.
2. **Asset normalization bead.** Add a Blender/bpy or equivalent offline step that writes normalized
   GLBs with `paint`/`tyre`/`glass`/`metal`/`light` material conventions, stable wheel names, emissive
   light meshes/underglow, and collider-fit metadata.
3. **Kenney import bead.** Move 3-5 normalized GLBs into
   `static/assets/vehicles/models/kenney/`, add per-vehicle manifests, and make the validator pass.
4. **ResourceLoader model bead.** Add GLB loading/caching without changing gameplay behavior.
5. **VehicleFactory GLB bead.** Route `visual.mode = "gltf"` through the loader, clone the template,
   apply paint, tag wheels, attach number quad, and fall back cleanly.
6. **Appearance data bead.** Define `PlayerAppearance` and plumb it through join, reconnect, lobby,
   and host spawn. Server validates catalog IDs.
7. **Selection UI bead.** Add lobby/controller selection UI with carousel, swatches, auto number,
   and preview. Use the catalog, not hardcoded options.
8. **Asset smoke and visual bead.** Add unit/integration smoke for catalog load plus Playwright
   screenshots for 4 vehicles, including color and number readability.
9. **Vehicle model validation bead.** Apply `.claude/skills/vehicle-model-validation/SKILL.md` to the
   imported starter set and require a PASS report with screenshots/check output before closing the
   import/loader/selection work.
10. **Perf bead.** Run the 4/24/60 car matrix and decide whether `InstancedMesh` is worth it now.
11. **Optional expansion bead.** Add Quaternius or generated assets only after the validator and
   runtime path are stable.

This order deliberately lands the boring infrastructure first. The picker UI should not be built on
hardcoded vehicle names, and GLBs should not be committed without validation.

### Recommendations against the old open questions

1. **Recolor strategy lock-in:** source can start with Kenney, but runtime locks onto normalized
   `paint`/`tyre` conventions, not source-pack `body` names.
2. **Instancing vs material clones:** material clones first. Let `FB-instperf` prove whether
   instancing is necessary.
3. **Scale convention:** canonical visual/physics length is 4 units for v1. Bake per-model scale in
   the manifest and assert it in validation.
4. **Roof number method:** roof quad first. Use `DecalGeometry` later for richer liveries.
5. **Blender install:** do it now, or use an equivalent deterministic normalizer. The debug viewer
   proved raw library semantics are not stable enough for selectable production assets.
6. **Wheel pivots:** promote this from an open question to a validator requirement before GLBs enter
   `static/assets`.

### Bead mapping

The existing `br-modes-remote-play-design-48a.7` bead is too broad to implement safely as one
change. Split or annotate it into:

- `assets-catalog-contract`: catalog, schema, validator, primitive default passes.
- `assets-normalization`: offline material/wheel/collider normalization and debug-viewer parity.
- `assets-kenney-starter-set`: import selected normalized Kenney GLBs and manifests.
- `assets-gltf-loader`: `ResourceLoader.loadModel()` and cache.
- `assets-vehiclefactory-gltf`: paint, wheel tags, scale, roof number, fallback.
- `assets-appearance-plumbing`: `PlayerAppearance` through join/reconnect/host spawn.
- `assets-selection-ui`: lobby/controller picker and preview.
- `assets-model-validation-gate`: run the project-scoped validation skill on every selectable model
  and attach screenshots/check output to the completion note.
- `assets-perf-gate`: 4/24/60 car measurements and final instancing decision.

Acceptance for the whole pipeline: a player can pick a hatch/truck/buggy/kart, color, and number;
leave/rejoin; and see the same car rendered on the host with correct physics, readable identity,
no arbitrary asset loading, no measurable regression in the 4-car E2E flow, and a PASS report from
`.claude/skills/vehicle-model-validation/SKILL.md`.

---

## Starter set + downloaded samples

5 silhouettes, all CC0, all separated-wheel GLB, all consistent enough to mix. Primary picks are
from the **Kenney Car Kit** (one cohesive kit, shared 12 KB atlas, ~2k tris each, already
downloaded + inspected), with Quaternius as the recolor-friendly alternative. The raw-source notes
below describe what was downloaded; the second-pass pipeline above supersedes the recolor path:
selectable assets should be normalized to `paint`/`tyre` material conventions before runtime.

| Silhouette | Primary model (Kenney, CC0) | Tris | Recolor via | Alt (Quaternius, CC0) |
|---|---|---|---|---|
| **Hatch** | `hatchback-sports.glb` | 2088 | normalized `paint` material | Quaternius Cars "Hatchback" |
| **Muscle** | `sedan-sports.glb` (has `spoiler`) | 2088 | normalized `paint` material | Quaternius "Muscle"/"Sedan" |
| **Truck** | `truck.glb` | 2082 | normalized `paint` material | **`truck_l200.glb` (downloaded)** |
| **Buggy** | `race-future.glb` | 2068 | normalized `paint` material | Quaternius "Buggy" |
| **Kart** | `kart-ooli.glb` (incl. `character`) | 2706 | normalized `paint` material | — |

Plus `wheel-default.glb` / `wheel-racing.glb` (separate CC0 wheels) for swappable rims.

**Downloaded and verified in `scratch-assets/` (real, loadable GLB v2):**

- `kenney_car-kit.zip` (4.8 MB) → `kenney_car-kit/Models/GLB format/` — all 50 GLBs incl. the 5
  silhouettes above + a shared `Textures/colormap.png` (512², 12 KB). License `License.txt` = CC0.
- `quaternius_police.glb` (22 KB) — illustrative (this Poly Pizza id is oddly scaled; pull from the
  official Quaternius pack instead).
- `truck_l200.glb` (180 KB, 3232 tris) — Quaternius, **body is its own `White` material → the
  cleanest paint-slot example in the set.**
- `inspect_glb.py` — the glTF-JSON inspector used (mesh/material/tri/bbox dump).

Integration notes per model: each candidate needs the normalization pass to produce stable
`paint`/`tyre` materials, `wheel_fl`/`wheel_fr`/`wheel_rl`/`wheel_rr` nodes, a centered/on-ground
origin, and a per-silhouette collider-fit manifest. Roof-number decal: use a parented roof quad in
v1.

**Direct links:** Kenney Car Kit — https://kenney.nl/assets/car-kit · Quaternius Cars —
https://quaternius.com/packs/cars.html · Poly Pizza (browse/API) — https://poly.pizza/docs/api/v1.1

---

## Decisions and remaining checks after the second pass

1. **Recolor source choice:** resolved. Start from Kenney for v1 breadth, but normalize every
   selectable GLB to `paint`/`tyre` material conventions. Runtime code should not depend on raw
   source-pack body names.
2. **Instancing vs. material clones:** partially open. Ship per-car material clones first; run the
   4/24/60 host-renderer perf gate to decide whether an `InstancedMesh`/shader path is worth adding.
3. **Scale convention:** resolved for v1. Canonical visual/physics length is 4 units unless a
   per-silhouette manifest explicitly declares a different collider fit.
4. **Roof-number method:** resolved for v1. Use a parented roof quad; reserve `DecalGeometry` for
   richer side liveries later.
5. **Blender/normalizer:** resolved. Add a deterministic offline normalization pass now, before
   `FB-assets`, because the debug viewer proved raw names/materials are not stable enough.
6. **Wheel pivots:** open only as a validation check. No selectable GLB enters `static/assets` until
   the validator confirms four wheels, stable wheel indices, and sane pivots.
7. **Source expansion:** open. Add Quaternius/generated/commissioned assets only after the Kenney
   starter set, catalog, normalizer, loader, and perf gate are stable.
