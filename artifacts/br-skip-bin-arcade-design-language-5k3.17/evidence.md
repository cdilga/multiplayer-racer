# br-skip-bin-arcade-design-language-5k3.17 Evidence

Status: Ready for fresh validation.

## Implementation

- `static/js/systems/RenderSystem.js`
  - Retires neutral host-native chromatic aberration (`enabled=false`, `amount=0`).
  - Adds `TRANSIENT_SMASH_FLASH_CURVE`.
  - Subscribes to `damage:vehicleCollision`, `weapon:explosion`, and `damage:destroyed`.
  - Drives a short existing-render-frame pulse through RGBShift amount plus existing color-grade uniforms.
  - Refreshes active pulse windows with `Math.max`, so repeat events do not stack duration/intensity past caps.
  - Adds `setTransientSmashFlashReduceEffects(enabled)`; when active, heavy/elimination flash triggers return `reason=reduce-effects`, in-flight pulse state is cleared, and all sampled frames stay neutral.
  - Reports `physicsTimeScale: 1` in diagnostics.
- `static/js/ui/ManualVisualSettingsController.js`
  - Wires the existing reduce-effects/manual visual settings path to `render.setTransientSmashFlashReduceEffects(reduce)`.
- `tests/unit/transient-smash-flash.test.js`
  - Covers ignored light hits, 3-frame heavy collision decay, 4-frame elimination decay, non-stacking refresh, CA cap, physics-time safety, reduce-effects suppression for heavy/elimination, active-pulse clearing, and restore-after-clear.
- `tests/unit/manual-visual-settings.test.js`
  - Covers reduce-effects enabling/disabling the transient flash gate through the existing presentation seam.

No shader edits were needed; the existing color-grade uniforms already support posterize/dither/grade pulsing.

## Numeric Diagnostics

Command:

```bash
node --input-type=module <<'NODE'
import { RenderSystem } from './static/js/systems/RenderSystem.js';
const render = new RenderSystem({ eventBus: null, container: {} });
console.log(JSON.stringify({
  heavy: render.sampleTransientSmashFlash({ severity: 0.9, source: 'damage:vehicleCollision' }, 5),
  elimination: render.sampleTransientSmashFlash({ severity: 0.1, elimination: true, source: 'damage:destroyed' }, 6),
  ignored: render.sampleTransientSmashFlash({ severity: 0.2, source: 'light-tap' }, 3)
}, null, 2));
NODE
```

Observed:

- Heavy collision trigger: `triggered=true`, `severity=0.9`, `frames=3`, `source=damage:vehicleCollision`.
- Heavy frame samples:
  - frame 1: `pulseIntensity=0.9`, `chromaticEnabled=true`, `chromaticAmount=0.0054`, `gradingIntensity=0.898`, `posterizeBandCount=5`, `ditherStrength=0.748`
  - frame 2: `pulseIntensity=0.6`, `chromaticAmount=0.0036`, `gradingIntensity=0.832`, `posterizeBandCount=6`, `ditherStrength=0.682`
  - frame 3: `pulseIntensity=0.3`, `chromaticAmount=0.0018`, `gradingIntensity=0.766`, `posterizeBandCount=6`, `ditherStrength=0.616`
  - frames 4-5: `pulseIntensity=0`, `chromaticEnabled=false`, `chromaticAmount=0`, `gradingIntensity=0.7`, `posterizeBandCount=7`, `ditherStrength=0.55`
- Elimination trigger: `triggered=true`, `severity=1`, `frames=4`, `source=damage:destroyed`.
- Elimination frame samples: pulse intensities `1`, `0.75`, `0.5`, `0.25`, then neutral frames 5-6 with CA disabled and amount `0`.
- Ignored light tap: `triggered=false`, `severity=0.2`, `reason=below-threshold`, all sampled frames neutral.
- Diagnostics report `physicsTimeScale=1`.

Node emitted the existing package warning: `MODULE_TYPELESS_PACKAGE_JSON`.

## Reduce-Effects Diagnostics

Command:

```bash
node --input-type=module <<'NODE'
import { RenderSystem } from './static/js/systems/RenderSystem.js';
const heavyRender = new RenderSystem({ eventBus: null, container: {} });
heavyRender.setTransientSmashFlashReduceEffects(true);
const heavyReduced = heavyRender.sampleTransientSmashFlash({ severity: 0.9, source: 'damage:vehicleCollision' }, 4);
const eliminated = new RenderSystem({ eventBus: null, container: {} });
eliminated.setTransientSmashFlashReduceEffects(true);
const elimReduced = eliminated.sampleTransientSmashFlash({ elimination: true, source: 'damage:destroyed' }, 4);
const active = new RenderSystem({ eventBus: null, container: {} });
active.triggerTransientSmashFlash({ severity: 1, source: 'damage:destroyed', elimination: true });
const beforeClear = active.getTransientSmashFlashDiagnostics();
active.setTransientSmashFlashReduceEffects(true);
const afterClear = active.getTransientSmashFlashDiagnostics();
const restored = new RenderSystem({ eventBus: null, container: {} });
restored.setTransientSmashFlashReduceEffects(true);
restored.setTransientSmashFlashReduceEffects(false);
const restoredHeavy = restored.sampleTransientSmashFlash({ severity: 0.9, source: 'damage:vehicleCollision' }, 5);
console.log(JSON.stringify({ heavyReduced, elimReduced, beforeClear, afterClear, restoredHeavy }, null, 2));
NODE
```

Observed:

- Heavy collision under reduce-effects: `triggered=false`, `severity=0.9`, `reason=reduce-effects`, `suppressedCount=1`, `physicsTimeScale=1`.
- Heavy reduced frame samples 1-4: `pulseIntensity=0`, `chromaticAmount=0`, `chromaticEnabled=false`, `gradingIntensity=0.7`, `posterizeBandCount=7`, `ditherStrength=0.55`.
- Elimination under reduce-effects: `triggered=false`, `severity=1`, `reason=reduce-effects`, all four sampled frames neutral with CA disabled and amount `0`.
- Active pulse clearing: before enabling reduce-effects `framesRemaining=4`, `intensity=1`; after enabling reduce-effects `framesRemaining=0`, `intensity=0`.
- Clearing reduce-effects restores normal behavior: heavy collision again triggers `frames=3`; first frame has `pulseIntensity=0.9`, `chromaticAmount=0.0054`; frame 4 returns to neutral.

## Verification

```bash
npx vitest run tests/unit/transient-smash-flash.test.js
```

Result: `1 passed (1)`, `8 passed (8)`.

```bash
npx vitest run tests/unit/manual-visual-settings.test.js
```

Result: `1 passed (1)`, `11 passed (11)`.

```bash
npx vitest run tests/unit/transient-smash-flash.test.js tests/unit/render-impact-shake.test.js tests/unit/hit-stop.test.js tests/unit/hit-stop-system.test.js
```

Result: `4 passed (4)`, `41 passed (41)`.

```bash
npm run build
```

Result: passed. Existing warnings observed:

- Vite CJS Node API deprecation warning.
- `/frontend/host/index.html` non-module `/static/js/audioManager.js` bundle warning.
- Existing chunk-size warnings.

```bash
npx playwright test tests/e2e/hit-stop.spec.ts
```

Result: `1 passed (6.9s)`.

Latest rerun result: `1 passed (5.1s)`. Existing `NO_COLOR` / `FORCE_COLOR` Node warning observed. The Flask server served from `dist/`.

## Source Scan

```bash
rg -n "TRANSIENT_SMASH_FLASH_CURVE|triggerTransientSmashFlash|sampleTransientSmashFlash|_applyTransientSmashFlash|_renderScene\\(|requestAnimationFrame|setInterval|physicsTimeScale|timeScale|slow.?mo|slowMotion|console\\." static/js/systems/RenderSystem.js tests/unit/transient-smash-flash.test.js
```

Observed:

- Transient flash code appears only in `RenderSystem.js` and `tests/unit/transient-smash-flash.test.js`.
- No `requestAnimationFrame` or `setInterval` matches in the touched test/source scan.
- `physicsTimeScale` appears only in diagnostics/tests and remains `1`.
- `console.*` matches are pre-existing `RenderSystem` startup/fallback logs, not added for this slice.
- Manual reduce-effects wiring appears in `ManualVisualSettingsController.js` and is covered by `tests/unit/manual-visual-settings.test.js`.
