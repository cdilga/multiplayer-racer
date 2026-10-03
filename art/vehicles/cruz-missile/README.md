# Cruz Missile

The Playtest-1 car, code-built from reference sheets (R81). P1-V02 moved Spike J's model here
(`spikes/art-pipeline/J-cruze-lowpoly/` stays as evidence).

## Production files

| File | What |
|---|---|
| `model.js` | The model script: `soups(P, lod)` for the bake, `build(P, lod)` for three.js, `pivots(P)` |
| `atlas.js` | The one atlas, drawn as data and rasterised without a DOM; `BAKE_COLOURS` paints pure white (the paint key) |
| `params.json` | Spike J's final, pixel-fitted parameters (silhouette IoU 0.947 against `refs/lod-plus-1.png`) |
| `vehicle.json` | Contract data the geometry doesn't carry: mass split, hinges (provisional until P1-V03), collider kinds, anchors, LOD budgets |
| `refs/` | The owner's reference sheets (`lod-plus-1` ≈ LOD0, `lowest-lod` ≈ LOD2, `damage-med-lod`) |
| `cruz-missile.asset.json`, `cruz-missile.lod{0,1,2}.glb`, `cruz-missile.atlas.png`, `cruz-missile.emissive.png` | The bake: never edit by hand |

Rebake after changing any of the first four, and commit the outputs:

```
node tools/vehicles/bake.mjs            # writes the bake here
node tools/vehicles/bake.mjs --check    # CI: a fresh bake must equal the committed files
node --test tools/vehicles/test/        # three.js load test against Spike J's model
jj validate art/vehicles/cruz-missile/cruz-missile.asset.json
node tools/vehicles/view/capture.mjs    # contact sheets (views, paints, LOD ladder, colliders)
```

Frame: metres, +Z nose, +Y up, origin on the ground between the axles. **+X is the car's left**
(right-handed), so `door_FL`, `wheel_FL` and the UHF whip are on +X. The driver sits on the right
(`cam_fp` at −X).

## Superseded files (not the production asset)

`cruz_missile.asset.json`, `cruz_missile.lod{0,1,2}.glb`, `cruz_missile.source.blend*`, `.build/`,
`previews/` and `mask.lod*.png` are the 2026-09-30 Blender-era asset from the Spike G pipeline,
which R81 replaced. Spike B's evidence pages (`spikes/art-pipeline/B-lod-batching/`) still load them, so
they stay until nothing does. Nothing in the game loads them.
