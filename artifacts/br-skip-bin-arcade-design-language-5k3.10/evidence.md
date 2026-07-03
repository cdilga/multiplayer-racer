# br-skip-bin-arcade-design-language-5k3.10 Slice A Evidence

Agent: StormyMill

Scope:
- `static/js/resources/MaterialFactory.js`
- `tests/unit/material-warp.test.js`
- `artifacts/br-skip-bin-arcade-design-language-5k3.10/`

Implemented:
- Material-local Skip Bin lo-fi warp metadata on materials:
  `userData.skipBinWarp = { enabled, eligible, exempt, role, vertexSnapIntensity, affineIntensity, snapGridSize }`.
- Disabled/no-op by default.
- Readability-critical roles (`vehicle-readable`, `danger-readable`, `ui`, `hud`, `player-identity`) are exempt even if enabled is requested.
- `onBeforeCompile` shader hook injects vertex snap uniforms/code and an affine-intensity fragment hook while preserving MeshBasic/MeshToon material classes.
- Helper API exports:
  `configureLoFiWarpMaterial`, `setLoFiWarpEnabled`, `setLoFiWarpIntensity`.
- No RenderSystem/GameHost/VehicleFactory/TrackFactory/ColorGradingShader/e2e edits.

Commands:

```text
npx vitest run tests/unit/material-warp.test.js
=> PASS
Test Files 1 passed (1)
Tests 9 passed (9)
```

```text
npx vitest run tests/unit/material-warp.test.js tests/unit/material-conversion.test.js
=> PASS
Test Files 2 passed (2)
Tests 21 passed (21)
```

```text
npm run build
=> PASS
vite built successfully in 2.52s after the material-conversion harness repair
Warnings only: Vite CJS Node API deprecation, non-module audioManager script, large chunks.
```

```text
grep -R "new[[:space:]]\+THREE\.MeshStandardMaterial" -n static/js || true
=> no output
```

Material conversion guard repair:
- Reserved and updated `tests/unit/material-conversion.test.js` only.
- No `WeaponSystem.js` edit was needed.
- Root cause was the fake `THREE.Mesh` test double lacking production mesh
  fields (`scale.set`, `rotation`, `position`) used by the current pickup
  visual path. The product code uses real Three.js meshes that provide those
  fields.
- Added the missing vector test-double fields plus fake `CylinderGeometry` and
  `TorusGeometry` constructors so `_createPickupMesh` can execute far enough to
  assert its material contract.

Ready/blocker status:
- Slice implementation is present.
- The focused material warp test, adjacent material conversion guard, and
  production build all pass.
- Full bead close still requires fresh validation; I did not close it.

---

# br-skip-bin-arcade-design-language-5k3.10 Slice B Evidence

Agent: BlueLake

Scope:
- `static/js/resources/TrackFactory.js`
- `static/js/resources/VehicleFactory.js`
- `static/js/systems/RenderSystem.js`
- `tests/e2e/material-warp.spec.ts`
- `artifacts/br-skip-bin-arcade-design-language-5k3.10/`

Implemented:
- Track-created ground/track/barrier/ramp materials now carry disabled-by-default
  `loFiWarp` metadata with role `world`, `eligible: true`.
- Vehicle body/roof/wheel/light materials now carry disabled-by-default
  `loFiWarp` metadata with role `vehicle-readable`, `exempt: true`.
- Added `RenderSystem.setMaterialWarpEnabled(options)` as a narrow runtime/test
  hook that traverses scene materials and enables only eligible, non-exempt
  material warp metadata.
- Added `RenderSystem.getMaterialWarpDiagnostics()` with counts by role and a
  deterministic sampled vertex-snap delta for active world geometry.
- Added focused browser/WebGL proof in `tests/e2e/material-warp.spec.ts`.
- Did not edit `GameHost.js`, `tests/e2e/visual-effects.spec.ts`, or 5k3.25 UI
  files.

Commands:

```text
npx vitest run tests/unit/material-warp.test.js tests/unit/material-conversion.test.js
=> PASS
Test Files 2 passed (2)
Tests 21 passed (21)
```

```text
npm run build
=> PASS
vite built successfully in 2.63s
Warnings only: Vite CJS Node API deprecation, non-module audioManager script,
large chunks.
```

```text
npx playwright test tests/e2e/material-warp.spec.ts
=> PASS
1 passed (3.5s)
```

```text
grep -R "new[[:space:]]\+THREE\.MeshStandardMaterial" -n static/js || true
=> no output
```

```text
grep -R "new[[:space:]]\+THREE\.ShaderMaterial" -n \
  static/js/resources/MaterialFactory.js \
  static/js/resources/TrackFactory.js \
  static/js/resources/VehicleFactory.js \
  static/js/systems/RenderSystem.js || true
=> static/js/systems/RenderSystem.js:1009 existing sky dome ShaderMaterial
No material-warp/track/vehicle PBR or ShaderMaterial replacement was introduced.
```

Browser diagnostics:
- Artifact JSON: `material-warp-diagnostics.json`
- Screenshot: `material-warp-host.png`
- Disabled/no-op: `hookInstalled=18`, `eligible=9`, `exempt=6`, `active=0`,
  `worldVertexDeltaMax=0`, screenshot data length `16939`.
- Enabled world warp: `active=9`, `roles.world.active=9`,
  `roles.vehicle-readable.exempt=6`, `roles.vehicle-readable.active=0`,
  `vehicleReadableActive=0`, `activeVertexSnapIntensity=0.6`,
  `activeAffineIntensity=0.2`, `activeSnapGridSize=0.7`,
  `worldVertexDeltaMax=0.2700226596098423`.
- Restored/off: `active=0`, `worldVertexDeltaMax=0`.
- Browser console/page errors captured by the test: `consoleIssues=[]`,
  `pageErrors=[]`.
- Host diagnostics: renderer `WebGLRenderer`, backend adapter
  `WebGL (WebGPU fallback)`, `renderInfo.programs=15`, shadows mode
  `contact-blob`.

Status:
- Slice B runtime/browser proof is ready for fresh validation.
- Full adaptive/manual UI wiring is intentionally left to the final integration
  seam: call `render.setMaterialWarpEnabled({ enabled, vertexSnapIntensity,
  affineIntensity, snapGridSize })` from 5k3.37/adaptive settings. The API is
  host/viewer presentation-only and does not affect `/player` controller HUD or
  authoritative simulation.
- Bead not closed.

---

# br-skip-bin-arcade-design-language-5k3.10 Final Integration Evidence

Agent: BlueLake

Scope:
- `static/js/ui/ManualVisualSettingsController.js`
- `static/js/engine/AdaptiveQualityController.js`
- `tests/unit/manual-visual-settings.test.js`
- `tests/unit/adaptive-quality-controller.test.js`
- `tests/e2e/material-warp.spec.ts`
- `artifacts/br-skip-bin-arcade-design-language-5k3.10/`

Implemented:
- Added manual visual settings fields for `materialWarpMode`, vertex snap
  intensity, affine intensity, and snap-grid size while preserving unknown
  `visualSettings` keys such as `uiScale`.
- Added pure/testable material-warp policy resolution:
  - `reduceEffects=true` forces warp off with intensities 0.
  - manual `off` forces off.
  - manual `on` enables if reduce-effects is false.
  - auto mode enables on native/balanced and disables on degraded/fallback.
- Added adaptive-quality material-warp policy application. The adaptive
  controller reapplies the resolved config only when settings/tier policy
  changes, avoiding stable-sample/per-frame spam.
- Extended browser proof so the live host adaptive controller and manual
  settings controller drive `render.setMaterialWarpEnabled(...)`.
- No `GameHost.js`, `LobbyUI.js`, shader, or material class changes in this
  final slice.

Commands:

```text
npx vitest run tests/unit/material-warp.test.js tests/unit/material-conversion.test.js tests/unit/manual-visual-settings.test.js tests/unit/adaptive-quality-controller.test.js
=> PASS
Test Files 4 passed (4)
Tests 56 passed (56)
```

```text
npm run build
=> PASS
vite built successfully in 2.63s
Warnings only: Vite CJS Node API deprecation, non-module audioManager script,
large chunks.
```

```text
npx playwright test tests/e2e/material-warp.spec.ts
=> PASS
2 passed (4.7s), serial mode so the diagnostics artifact is deterministic.
```

Source scans:

```text
grep -R "new[[:space:]]\+THREE\.MeshStandardMaterial" -n static/js || true
=> no output
```

```text
grep -R "new[[:space:]]\+THREE\.ShaderMaterial" -n \
  static/js/ui/ManualVisualSettingsController.js \
  static/js/engine/AdaptiveQualityController.js \
  tests/e2e/material-warp.spec.ts \
  static/js/systems/RenderSystem.js || true
=> static/js/systems/RenderSystem.js:1009 existing sky dome ShaderMaterial
No material-warp PBR or ShaderMaterial replacement was introduced.
```

```text
grep -R "console\.\(log\|warn\|error\)" -n \
  static/js/ui/ManualVisualSettingsController.js \
  static/js/engine/AdaptiveQualityController.js \
  tests/e2e/material-warp.spec.ts || true
=> no output
```

Browser diagnostics:
- Artifact JSON: `material-warp-diagnostics.json`
- Screenshot: `material-warp-host.png`
- Tier names observed: `host-native`, `host-balanced`, `host-degraded`,
  `host-fallback`.
- Auto/native: `active=9`, `roles.world.active=9`,
  `vehicleReadableActive=0`, `activeVertexSnapIntensity=0.6`,
  `activeAffineIntensity=0.2`, `activeSnapGridSize=0.7`,
  `worldVertexDeltaMax=0.2700226596098423`.
- Auto/degraded: `active=0`, `worldVertexDeltaMax=0`,
  `vehicleReadableActive=0`.
- Manual-on at fallback: `active=9`, `worldVertexDeltaMax=0.27202188900303287`,
  `vehicleReadableActive=0`, intensities `0.5` / `0.18`, grid `0.8`.
- Reduce-effects: `active=0`, `worldVertexDeltaMax=0`,
  `vehicleReadableActive=0`; saved settings preserved `uiScale=1.23` and
  `customFutureKey=keep`.
- Restored auto/native: `active=9`, `worldVertexDeltaMax=0.2700226596098423`,
  `vehicleReadableActive=0`.
- Browser console/page errors captured by the test: `consoleIssues=[]`,
  `pageErrors=[]`.
- Host renderer: `WebGLRenderer`, backend adapter `WebGL (WebGPU fallback)`,
  shadows mode `contact-blob`.

Status:
- Final adaptive/manual/reduce-effects wiring is implemented and evidenced.
- Local mode role invariant preserved: this is a host/viewer presentation path;
  `/player` controller world rendering was not added.
- Ready for fresh validation. Bead not closed.
