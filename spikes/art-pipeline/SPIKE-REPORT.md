# Art-pipeline spike — 2026-09-29

**Question:** can the 0.2 art pipeline (plan §12, `JOYSTICK_JAMMERS_ART_PIPELINE.md`) be set up on this
Mac and produce a contract-valid, destructible, identity-ready car that looks acceptable in game,
before we commit to beads?

**Verdict: yes, go.** Every stage ran end to end on the first day. The problems found are the useful
kind (contract rules and budgets to add), not blockers. Nothing needed manual Blender GUI work.

## What was set up

| Tool | Status |
|---|---|
| Blender 5.2.2 LTS | Installed (`brew install --cask blender`), `blender` on PATH, headless works. |
| Codex image generation | Works via `codex exec` (feature `image_generation` stable). ~2 min for two 1024² images. |
| MCP for Blender (`uvx mcp-for-blender`, formerly `blender-mcp`) | Addon installed and enabled in Blender prefs; MCP server registered for this repo in Claude Code (local scope, shows Connected). **Needs Blender GUI open + "Start MCP Server" clicked**, and a new Claude session to load its tools. Not exercised interactively yet. |
| Image-to-3D (Hunyuan3D / Hyper3D Rodin via MCP for Blender) | **Not tested.** Needs the GUI MCP session and possibly API keys. Next step. |
| Validator | `validate_vehicle.py` (stdlib only) checks the GLB + sidecar against the draft contract. |
| In-game render | `ingame.html` + `capture.mjs`: repo's Three.js, toon semantic materials, identity paint, inverted-hull ink, morph dents, dynamic grid; captured with system Chrome (real GPU). |

## The run

`build_cruz_missile.py` (headless, ~7 s) builds the "Cruz Missile" greybox: chassis, cabin, glass,
bonnet/boot (hinged), doors (hinged), bumpers, spoiler + struts, lights, 4 wheels with rims; markers
(`lplate_front/rear`, `cam_fp`, `cam_tp_target`, `com`, `exhaust_0`, `roof_number`); collider proxies
(`col_chassis`, rounded `col_cabin_round`); semantic `jj_*` materials; smart-UV; decals cut from the
Codex decal sheet; a per-part dent shape key (R68); AO baked to vertex colours (Cycles CPU, 25 meshes);
GLB export with part metadata as glTF extras + `cruz_missile.asset.json` sidecar.

Outputs in `out/`: `contact_sheet_blender.png`, `dent_compare.png`, `ingame_hero*.png`,
`ingame_grid4_1080p.png`, `ingame_grid12_4k.png`, `ingame_grid24_4k.png`.

Validator: **pass**. In game at 24 tiles on 4K (640×540 tiles): own car **220–270 px** tall (budget
≥ 40 px), numbers and identity colours read clearly.

## Findings → plan/contract changes

1. **Pivots silently collapse.** Blender's `transform_apply()` defaults to applying location *and*
   rotation, putting every part's pivot at the origin (wheels can't spin, doors can't hinge). The
   validator caught it. → Contract rule + validator check: wheel pivots at hubs, hinged parts off-origin.
2. **Dentable panels need interior vertices.** Bevelled boxes only have corner verts, so dents do
   nothing. Subdivide *before* an angle-limited bevel. → LOD0 grew from ~4.7k to **~9.2k tris**; revise
   the plan's 5k LOD0 starting budget to ~10k for dentable cars and lean on LOD1/2 for small tiles.
3. **Blender 5 creates new shape keys at value 1.0**, so the "pristine" export was pre-dented (and AO
   baked on the dented shape). → Set `value = 0`; validator should check default morph weights are 0.
4. **Draw calls scale with parts.** Separate parts (needed for destruction) + ink hulls ≈ 90 draw calls
   per tile with 24 cars → ~2,000+ per frame at 24 tiles. → G-PERF must test batching
   (`BatchedMesh`/merged intact car with parts split on detach) early; hulls could become a post outline.
5. **Imagegen adds unrequested cultural motifs.** The decal sheet included an Uluru-like rock. → Negative
   prompt ("no real landmarks, no Indigenous motifs, no real brands") + a human review step in the
   pipeline; the validator can't catch this.
6. **Imagegen concept style drifts realistic** ("modified street sedan", not "chunky toy"). Prompt
   iteration with reference images is needed for G-LOOK; the decal sheet quality is already usable.
7. **Roof number marker sits inside the cabin bevel** (clipped). → Contract: `roof_number` marker must be
   above the roof surface; validator can check marker height vs cabin bounds.
8. Test-scene issues (not pipeline): spawn overlap in the grid scene, no tile borders yet.

## Part 2 — Cruze from reference images (2026-09-29)

**Refs:** Codex generated orthographic side/front/rear/top views of a 2012 Holden Cruze (`refs/`). Measured by
`measure_refs.py` (PIL only): wheelbase **2.745 m** (real 2.685), height **1.50 m** (real 1.48), body width
1.72 m (real 1.79 incl. mirrors). Generated orthographic refs are accurate enough for blueprint modelling.

**Model:** `model_cruze_from_refs.py` lofts superellipse cross-sections along the measured side/top profiles
(arch cut-outs come from the tyre-top line, greenhouse tumblehome above a smoothed beltline), classifies faces
into contract parts (chassis, bumpers, bonnet, boot, doors, glass), splits them with **bmesh only**, adds wheels,
lights and per-part dent keys. Two variants: `CRUZE_REF` (measured proportions) and `CRUZE_CHUNKY` (wheels ×1.4,
overhangs ×0.72, +12 cm stance). Result: `out/cruze_compare.png` — the REF silhouette matches the reference
side view closely; the CHUNKY one reads as a Cruze-flavoured toy. Dents work.

Rough edges (fine for this detail level): stair-stepped glass edge (face-level split; cut along the beltline
instead), flat-disc rims, no mirrors/door lines, doors split as one strip per side.

**Findings:**
- `bpy.ops.mesh.separate(type="MATERIAL")` does not preserve slot indices for naming; split with bmesh instead.
- New objects' `matrix_world` is stale until `view_layer.update()`: parenting with a parent-inverse computed
  before the update doubles offsets. Call update (or set local transforms) before parenting.
- **Live Blender MCP**: works (scene info + `execute_code` answered) **only while the Mac is unlocked/display
  awake**. With the screen locked the GUI event loop is frozen, so every MCP call queues and times out.
  Disabling App Nap and `caffeinate` don't help a locked screen. Also, UI operators (edit-mode, separate)
  are the fragile part in live sessions — **MCP modelling scripts should use the data API (bmesh) only**,
  which also makes the same script run headless in CI.
- Practical workflow: write modelling as data-API scripts, run them **headless** for builds/CI/renders, and use
  live MCP for interactive inspection and tweaks when someone is at the machine.

## Not covered (next spike steps, if wanted)

- Interactive Blender MCP session (open Blender → Start MCP Server → new Claude session).
- Image-to-3D blockout of the concept image, then scripted clean-up to the contract.
- Texture/mask atlas bake (this run used vertex-colour AO + one decal sheet).
- Physics: colliders + CoM in Rapier; LOD generation; the comic post pipeline (outline in post, halftone).
