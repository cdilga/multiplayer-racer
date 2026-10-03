# P1-V02: the Cruz Missile bake

Date 2026-10-03, GentlePike. Bead `br-p1-v02-psq`. Closes on green Gitea CI (`ev:ci`).

Spike J's code-built car (R81) is now in the production tree, `art/vehicles/cruz-missile/`: the model script, its
parameters, the atlas, the reference sheets and `vehicle.json`. `tools/vehicles/bake.mjs` bakes it to the
`jj.vehicle.v1` contract: one GLB per LOD, the atlas and emissive PNGs, and `cruz-missile.asset.json`. The bake writes
its own GLB and PNG bytes (no exporter, no canvas, no zlib), so they're identical on every machine.

## Acceptance → evidence

| AC | Test (CI) | Result |
|---|---|---|
| Two bakes give identical bytes (hashes recorded) | `tools/vehicles/test/bake.test.mjs` "two bakes give identical bytes…", plus CI's `node tools/vehicles/bake.mjs --check` (a fresh bake must equal the committed files; an LFS pointer is compared by its sha256 oid) | hashes below; a third bake into a scratch folder was byte-identical too |
| The validator passes on every LOD's GLB + sidecar | CI rust job: `git lfs pull` of this folder, then `jj validate art/vehicles/cruz-missile/cruz-missile.asset.json` | `ok`, triangles per LOD `[1264, 890, 594]`, no violations |
| The GLB loads in Three.js with the same nodes and bounds as the spike model | `bake.test.mjs` "LOD0/1/2 loads in three.js…" (three r182 `GLTFLoader`): root `cruz-missile` → the 11 parts, 6 anchors and (LOD0) 11 collider proxies; one material with the atlas and emissive map; each part's world bounds equal Spike J's `build(params, lod)` within 1e-5 m, except the wheels (below); the whole car equals Spike J's apart from now sitting on the ground | pass |

### What changed from Spike J, and why

Each change is needed to pass the contract. The load test checks each one exactly.

1. **Sides named physically.** In this right-handed frame (+Y up, +Z nose) +X is the car's **left**. Spike J called it
   "right", so its `door_FR`/`wheel_FR` are this asset's `door_FL`/`wheel_FL`, and so on. This matches jj-sim's
   wheel order. The UHF whip is on the front-left.
2. **Tyres rest on the ground.** Spike J's 8-sided LOD1/2 tyres had their bottom flat 3.0 cm up (1.4 cm at LOD0's
   12 sides), so the car floated. The contract allows 2 cm. The tyre polygon's inscribed radius is now `wheelR`, so the
   flat touches the ground. Wheel bounds grow by at most `wheelR·(1/cos(π/n) − 1)` (3.3 cm at n = 8) and keep their
   width.
3. **LOD2 within 600 triangles.** Spike J's LOD2 had 606. LOD2 drops the whip's 9 cm mount block (12 triangles), which
   sits inside the spring base's footprint, so no bounds change: 594.
4. **One pivot per part at every LOD.** Spike J took each part's bounding-box centre per LOD. Coarser LODs sample fewer
   rings, which moved `door_FL` by 3 mm (the contract tolerance is 1 mm). Pivots are now measured on LOD0 and used at
   every LOD.

Triangles per part: LOD0 core 176, front 438, back 286, doors 18/18/12/12, wheels 76 each; LOD1 156/240/206, doors
12, wheels 60; LOD2 140/176/142, doors 6, wheels 28.

## Hashes (sha256)

```
cruz-missile.atlas.png     1c538df7284e84403f2e76a1fc23936b2004cbe4e33970e8a417c63d80628881   64,667 B
cruz-missile.emissive.png  cae2a2d7e28bcfc18eada1535b9ceccaacab016bb314d5ceed93d5da3d8dde9d   20,033 B
cruz-missile.lod0.glb      3a4ad793cc800d4dae61f9cba7860b94f7dfc9849bbd69f5287ed23eb4bc6427
cruz-missile.lod1.glb      b0392893a47633c16c25d393d2b89a0e2da4d29c32f3e04f1ab8b1692a2411b7
cruz-missile.lod2.glb      43f25f6402ff6c963828c1f40770b24225559c4096122a68cb73aca013568fa0
cruz-missile.asset.json    679470b8fe66e2b4cd257c418814b67e49d78735a531f0cfa0f63dfb92de8c4b
```

Baked on the Mac (arm64, Node 26.10.0). CI bakes on Linux x64 and must match these.

## Vehicle Model Validation (skill `vehicle-model-validation`)

```markdown
Vehicle Model Validation: PASS for P1-V02's scope (source, contract, budget, paint key, colliders); the gates owned
by later beads are listed under Remaining.

Vehicle/part IDs: cruz-missile; core, front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR
Commit: the P1-V02 commit
Changed files: art/vehicles/cruz-missile/{model.js, atlas.js, params.json, vehicle.json, refs/, README.md, the bake},
  tools/vehicles/{bake.mjs, glb.mjs, png.mjs, test/, view/}, .gitea/workflows/ci.yml
Requirement source: R81, R86; Playtest-1 plan §6; jj.vehicle.v1 (P1-V01)

Visual evidence (three r182 GLTFLoader + paint-key material, Playwright Chromium 151, from the baked GLBs):
- views.png: LOD0 front/rear/left/right/top and both 3/4 views; livery, lamps, bull bar, whip front-left
- paints.png: six car colours through the paint key; tyres, glass, lamps and livery keep their colours
- lods.png: LOD0/1/2 side and 3/4
- colliders.png: the LOD0 convex proxies; the cabin is rounded and the whip is excluded

Checks run:
- node tools/vehicles/bake.mjs --check: committed = fresh bake
- node --test tools/vehicles/test/: 5/5 pass
- jj validate art/vehicles/cruz-missile/cruz-missile.asset.json: ok, [1264, 890, 594], no violations

Findings:
- PASS contract + reproducibility (validator clean, byte-identical bakes)
- PASS budget (1264/890/594 within 1300/900/600) + silhouette: Spike J's geometry unchanged except the wheel flats
  and LOD2's mount block, so its measured IoU (0.947 vs lod + 1, 0.939 LOD2 vs lowest-lod) carries over; not re-measured
- PASS one material / paint key (one material in every GLB; pure-white texels tint). Note: anti-aliased livery edges
  leave thin light fringes (pixels that are neither paint nor livery colour), as Spike J's did; R02 may want a separate
  paint mask
- PASS physics fit as data: mass fractions sum to 1.00; origin on the ground between the axles; rounded cabin proxy
- n/a damage states (S04a–c, V03), sim settle with this asset (S03), draws/frame at 24×24 (R02), roof-number legibility
  at the smallest tile (R02)

Remaining blockers (other beads, not P1-V02):
- V03: hinge lines and limits, dark bays, interior blocks, mounts (hinges here are provisional)
- R02: instanced renderer captures, 1/4/24-tile grids, roof number
- S03/S04: settle in jj-sim with this asset; intact → loose → detached
```
