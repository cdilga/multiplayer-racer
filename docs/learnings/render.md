# Render learnings (append-only)

## 2026-10-04 · WebGPURenderer throws on an InstancedMesh of a morph-target GLB (P1-R01)

- **Symptom:** `TypeError: Cannot read properties of null (reading 'element')` deep in a `ShaderCallNode` while
  WebGPURenderer builds the material for an `InstancedMesh` made from a baked Cruz Missile part. WebGLRenderer draws
  the same mesh fine.
- **Cause:** the V02 bake carries damage warp morph targets; three's WebGPU morph node reads
  `mesh.morphTargetInfluences`, which a fresh `InstancedMesh` doesn't have.
- **Fix:** give the instanced mesh the influences (`im.morphTargetInfluences = src.morphTargetInfluences.map(() => 0)`);
  P1-R02 needs the same once per part mesh.

## 2026-10-04 · The headless-shell Chromium drops some GL lines (P1-R01)

- **Symptom:** `GridHelper` lines running away from the camera are missing from CI-style captures; lines across the
  view draw. Same in WebGLRenderer and WebGPURenderer's WebGL2 backend.
- **Cause:** the `--only-shell` headless Chromium's software rasteriser; full Chromium (`channel: 'chromium'`, which
  `art/ui/lib/live-check.mjs` uses) and Chrome draw them.
- **Use:** judge line art (grids, outlines) from live-check or headed captures, not from the shell.

## 2026-10-04 · Software-GL hosts starve main-thread timers (P1-R01)

- **Symptom:** with the host page rendering, the C05 journey's local sources sent ~165 samples instead of ~308 alone,
  and ~35 when `node --test web/host/tests/` ran its files in parallel; wall-clock waits saw cars travel much less.
- **Cause:** every headless page rasterises in software on the CPU, and `LocalInput` samples on a 16 ms `setInterval`
  on the main thread; the live sim's clock also slows.
- **Use:** browser journeys wait on sim ticks, seat counts and sample counts, never fixed wall time. On a real GPU
  the frame costs a few ms, so this is a CI-environment cost, not a host budget.
