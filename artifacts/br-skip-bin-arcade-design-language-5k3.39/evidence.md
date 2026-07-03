# br-skip-bin-arcade-design-language-5k3.39 — Evidence (CobaltTiger)

**Scope:** P1.9 adaptive quality controller — a pure decision core that picks a
host grade tier + internal resolution scale from a hardware heuristic and a
runtime fps/frame-duration stream, and drives an existing RenderSystem through
its public API. NO RenderSystem edit (uses the already-public `getHostGradeTiers`
/ `setGradeTier` / `setResolutionScale` / `getGradeDiagnostics`).

## Reservations (exclusive)
- 3510 `static/js/engine/AdaptiveQualityController.js` (new)
- 3511 `tests/unit/adaptive-quality-controller.test.js` (new)
- 3512 `artifacts/br-skip-bin-arcade-design-language-5k3.39/**`
- 3513 `static/js/GameHost.js` (runtime wiring — additive, WIP preserved)
- 3514 `tests/e2e/adaptive-quality.spec.ts` (new)

No NobleBay 5k3.8 files touched (ColorGradingShader.js, RenderSystem.js, the grade
tests, visual-effects.spec). No 5k3.25 CSS/UI files touched. RenderSystem.js NOT edited —
the controller drives its existing public API only.

## Runtime wiring (GameHost, additive/WIP-preserving)
- `_createSystems()` calls `_attachAdaptiveQuality()` right after the render/weapon
  systems are configured (post `engine.init()`, so the grade ladder is live).
- `_attachAdaptiveQuality()` no-ops unless the render system exposes the ladder API
  (`setGradeTier` + `listGradeTiers`), then `new AdaptiveQualityController().attach(render, caps)`
  and exposes `window.__JJ_ADAPTIVE__` for diagnostics/e2e and future 5k3.37 settings.
- `_detectRenderCaps()` reads safe sources: `navigator.hardwareConcurrency`,
  `navigator.deviceMemory`, `window.devicePixelRatio`, `topology !== 'local'` (remote),
  and a software-GPU sniff from `render.getRenderDiagnostics().adapterInfo`
  (SwiftShader/llvmpipe/software). All best-effort; unknowns stay undefined.
- `_onRender({ fps })` feeds `this.adaptiveQuality.sample(fps)` each render (the loop
  already carries fps). Guarded on finite fps. No logging (confirmed: GameHost diff adds
  zero console lines).

## What was built
`AdaptiveQualityController` — pure, deterministic, no THREE/DOM/EventBus/clock/random:
- `classifyHardware(caps, tierCount)` — cores, deviceMemory, softwareGpu, devicePixelRatio, remote → starting tier index. softwareGpu forces the floor tier; remote adds a guaranteed one-tier conservative bump (clamped); strong hardware starts native.
- `sample(fps | {fps} | {frameMs})` — hysteresis + debounce ladder: below `downFps` (50) for `downDebounce` (6) samples steps DOWN; above `upFps` (58) for `upDebounce` (12) samples steps UP; a dead-band between them plus per-direction streak reset means a single spike never flaps the tier. Tier stepping is primary (the G2 effect ladder); resolution trim (`resStep` 0.1 down to `MIN_RENDER_SCALE` 0.5) is the last-resort knob only at the worst tier.
- `attach(target, caps)` — reads the real ladder from `target.getHostGradeTiers()` and drives `setGradeTier`/`setResolutionScale`, calling a setter only when its value changed (no churn).
- `setManualTier(name|index)` / `setAuto()` — the 5k3.37 manual/a11y override seam; manual pins the tier and sampling never overrides it until `setAuto()`.
- `state` snapshot + `lastDecision` for diagnostics/debug overlays. No per-frame logging anywhere.

## Commands + results
- `npx vitest run tests/unit/adaptive-quality-controller.test.js` => **PASS, 21 tests** (`vitest.log`).
- `npm run build` => **PASS**, vite `✓ built in ~2.6s` (pre-existing chunk-size warning only) (`build.log`).
- `npx playwright test tests/e2e/adaptive-quality.spec.ts` => **1 passed (4.1s)**, from a clean server
  serving the freshly-built dist (a stale dev server was killed first so the production `dist/`
  with the wiring is served).

## Runtime evidence (`runtime-wiring.json`, real observed values — non-fudged)
- `attachedToLiveRender: true` — the controller's `target` is the live `window.game.systems.render`.
- `hostFedFps: 109` — the host render loop fed real fps into the controller (lastDecision populated
  before any synthetic injection), proving the host path feeds the controller.
- `tierNames: [host-native, host-balanced, host-degraded, host-fallback]` — the real ladder read via
  `listGradeTiers()` (not the module's placeholder names).
- Synthetic slow-frame burst through the REAL render path: baseline `host-native` @ resolutionScale
  **1.0** → under sustained 12fps load `host-fallback` @ **0.5** (floor, never below) → recovery back to
  `host-native` @ **1.0**. Values read from `render.getGradeDiagnostics().resolutionScale` each phase.

## Evidence areas → tests
| Area | Test |
|---|---|
| Hardware heuristic (strong→native, software→floor, weak→floor, remote one step lower, clamped) | `classifyHardware — starting tier from capabilities` (5) |
| Hysteresis / debounce, no flapping, single-spike immunity | `fps ladder — hysteresis + debounce` (4) |
| Tier descend/ascend, resolution floor clamp + no runaway, recover-res-before-promote, native ceiling | `tier + resolution clamps` (5) |
| Manual override wins + resume + reject unknown (5k3.37 seam) | `manual override` (2) |
| Determinism (identical fps sequence → identical state) | `determinism` (1) |
| Drives RenderSystem public API, reads ladder on attach, no setter churn | `drives a RenderSystem-like target` (2) |
| No per-frame logging | `no per-frame logging` (1) |
| Non-fudged tier-transition timeline artifact | `evidence artifact — tier-transition timeline` (1) |

## Tier-transition timeline (real controller output, `decision-timeline.json`)
Synthetic fps track healthy → sustained 22fps load → floor squeeze → recovery 130fps:
- native → balanced (i15) → degraded (i21) → fallback (i27) via `tier_down`
- `res_down` 0.55 → 0.50 at the fallback floor (i33), then holds (no runaway)
- recovery: `res_up` 0.50 → 0.55 (i53), `tier_up` → degraded (i65) → balanced (i77)
- hardwareMatrix: {8c/8g}→0, {4c/4g}→1, {4c/4g/remote}→2, {2c/2g}→3, {softwareGpu}→3
All resolutionScale values stay >= 0.5.

## Integration handoff (NOT wired this slice — deliberate)
The controller needs one runtime feed: each render, call `controller.sample(loop.getFps())`
(or feed `renderSystem.getGradeDiagnostics().frameTiming.averageRenderDurationMs` as `{frameMs}`),
after `controller.attach(renderSystem, caps)` once at host start. That wiring belongs in
GameHost (owns the loop + systems), which is currently DIRTY with other agents' WIP; I did
not edit it to avoid a conflict-unsafe insertion. Recommended: a fresh, reserved ~3-line
insertion in GameHost after the render system is created, or self-subscribe to `loop:render`
from within an attach helper. Caps source: `navigator.hardwareConcurrency`, `navigator.deviceMemory`,
`devicePixelRatio`, the GPU renderer string from the existing WebGLBackend diagnostics
(softwareGpu = SwiftShader/llvmpipe), and the participant's remote flag.

## Posture
Bead remains `in_progress`. Requesting fresh validation of the controller slice + the
integration handoff. Not closed.
