# br-captain-call-architecture-hardening-woq.2 Evidence

## Scope Completed

- Implemented a real Three `three/webgpu` renderer path in `static/js/rendering/WebGPUBackend.js`.
- Kept creation-time WebGL fallback when WebGPU import/init/create fails.
- Added renderer diagnostics for active API, native WebGPU state, adapter/device limits, renderer type, fallback reason, and backend selection source.
- Kept the default host path on WebGL for existing visual-effects parity; explicit `?renderer=webgpu` exercises the native WebGPU path.
- Confirmed Local player/controller pages do not instantiate the world renderer.

## Verification

- PASS: `npx vitest run tests/unit/renderer-backend.test.js tests/unit/renderer-backend-fallback.test.js tests/unit/render-grade-ladder.test.js tests/unit/manual-visual-settings.test.js tests/unit/adaptive-quality-controller.test.js`
  - 5 files, 78 tests passed.
- PASS: `npm run build`
  - Existing warnings only: Vite CJS deprecation, non-module `audioManager.js`, large chunks.
- PASS: `npx playwright test tests/e2e/webgpu-render-backend.spec.ts tests/e2e/visual-effects.spec.ts --workers=1`
  - 10 browser tests passed.
  - Default visual-effects path retained WebGL post-processing with composer, bloom, and color grading.
  - Explicit `?renderer=webgpu` path rendered race and derby scenes with native WebGPU.
- PASS: `git diff --check -- static/js/rendering/RendererBackend.js static/js/rendering/WebGPUBackend.js static/js/rendering/WebGLBackend.js static/js/systems/RenderSystem.js tests/unit/renderer-backend.test.js tests/unit/renderer-backend-fallback.test.js tests/e2e/webgpu-render-backend.spec.ts`

## Browser Evidence

- `race-backend-diagnostics.json`
  - `navigatorGpu=true`, `secureContext=true`
  - `activeApi=webgpu`, `nativeWebGPU=true`, `backend=WebGPU`, `renderer=WebGPURenderer`
  - adapter: Apple / Metal 3
  - nonblank screenshot metrics: 1280x720, `lumaStddev=48.34`
  - frame timing: average `0.38ms`, max `0.60ms`
  - tracked vehicles: 1
- `derby-backend-diagnostics.json`
  - `activeApi=webgpu`, `nativeWebGPU=true`, `renderer=WebGPURenderer`
  - nonblank screenshot metrics: 1280x720, `lumaStddev=29.48`
  - frame timing: average `0.68ms`, max `7.60ms`
  - tracked vehicles: 1
- `explicit-webgpu-attempt-summary.json`
  - confirms native WebGPU available in the explicit Chromium run; no browser limitation recorded.
- `race-controller-guard.json`
  - Local player page: `hasHostWorldRender=false`, `hasGameWorldRender=false`.

## Artifacts

- `artifacts/br-captain-call-architecture-hardening-woq.2/race-backend.png`
- `artifacts/br-captain-call-architecture-hardening-woq.2/derby-backend.png`
- `artifacts/br-captain-call-architecture-hardening-woq.2/explicit-webgpu-attempt.png`
- `artifacts/br-captain-call-architecture-hardening-woq.2/*-diagnostics.json`
