# Runbook: glTF validation + budgets (Stage A / Visual QA Layer 1)

No install needed beyond `npx` (or add as devDeps).

## Spec compliance (hard gate)
```bash
# Khronos glTF Validator — fail CI on errors; warnings are advisory.
npx gltf-validator model.glb
# JSON report for programmatic gating:
npx gltf-validator -o report.json model.glb && jq '.issues.numErrors' report.json
```

## Inspect + budgets
```bash
npx @gltf-transform/cli inspect model.glb   # tris, meshes, materials, textures, draw calls
```
Assert against `rubric.budgets`: `maxTriangles`, `maxMaterials`, `maxTextureSize`, `maxGlbBytes`.

## Optional optimization (only if perf gate fails)
```bash
npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp
```

## Notes
- glTF-Transform's `validate` wraps the Khronos validator.
- Keep this as a CI step so "almost good" models can't accumulate hidden errors.
