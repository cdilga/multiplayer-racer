# Spikes

Evidence from time-boxed experiments. **Nothing in the game imports from `spikes/`.** Production code
re-implements what a spike proved, in `crates/`, `web/`, `tools/` or `art/`.

Run any browser spike from the repo root with its own `serve.mjs` (binds 127.0.0.1), after `npm install`
at the root (the root `package.json` pins the three/Playwright/Rapier versions these were measured
with).

## Status at a glance

| Spike | Status | What to take from it |
|---|---|---|
| **`art-pipeline/J-cruze-lowpoly/`** | **Canonical (R81).** Source for the Playtest-1 car | The vehicle method (reference sheets → masks → model script → silhouette IoU + optimiser), the faceted Cruz Missile (1,252 / 878 / 538 tris), one-InstancedMesh-per-part-type rendering (216 draws for 24×24 tiles), the atlas paint key, per-tile LOD sizing. Read `REPORT.md`; the method is the `lowpoly-model-from-refs` skill. P1-V02 moves its model script into `art/vehicles/cruz-missile/` |
| `art-pipeline/I-cruze-destruction/` | Reference | Damage-ready primitives: closed shells, cut openings with cavities, warp morphs (denting is **not** used since R86), loose parts as visual springs, shard instancing, wreck re-bake, `selectLod(px, bias)` + quality governor, tool-agnostic gates |
| `art-pipeline/H-primitive-kit/` | Reference | The "Chef Clash" primitives method and JS contract/perf gates; recognition cue sets. Skill: `threejs-primitive-modelling` |
| `art-pipeline/G-cruze-v2/` | Superseded for vehicles (R81) | Blender station-shell pipeline and its draft asset conventions (`ASSET-CONTRACT.md`) |
| `art-pipeline/C-physics/` | Reference, findings adopted | Rapier contract checks: flip recovery needs an assist torque, mass fractions must sum to 1, origin on the ground, the "round" cabin proxy was a box, JS API footguns, detach → dynamic debris works |
| `art-pipeline/B-lod-batching/` | Reference, findings adopted | `BatchedMesh` only flattens draws for one shared camera and conflicts with per-part detach; KTX toolchain gap |
| `art-pipeline/A-textures-uv/` | Reference | Early UV/mask texturing experiments (Blender) |
| `art-pipeline/D-props-kit-surfaces/` | Reference | Wheelie bin, track kit piece and surface texture experiments (Blender) |
| `art-pipeline/E-mesh-lint-rig/` | Reference | Mesh lint and rig checks (Python) |
| `art-pipeline/F-cute-bin/` | Reference | Turnaround measurement for the wheelie bin (not yet cute) |
| `art-pipeline/I-fal-cruze/` | Reference | Generated Cruze reference images and concept renders |
| `art-pipeline/SPIKE-REPORT.md` | History | The first end-to-end art-pipeline spike (2026-09-29); its Blender-first conclusions are superseded by R81 |

The learnings these spikes produced that the plan adopts are tabulated in
`docs/plans/v0.2-playtest-1-plan.md` §6.1.

Reference sheets the owner generated for Spike J sit at `art-pipeline/{lowest-lod,lod + 1,lod + 2,max lod}.png`
and `art-pipeline/damage - med-lod.png` (paths with spaces; quote them).
