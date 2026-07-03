# br-skip-bin-arcade-design-language-5k3.8 — Evidence (NobleBay)

**Scope:** P1.6 vignette + animated camcorder film grain over the frame, tier-gated so
reduce-effects/lower tiers respect it (5k3.37 seam). Visual/post-pass only. Implemented
inside reserved files 3479-3484; existing dirty render WIP preserved (backend/telemetry/
grade ladder/posterize-dither/upscale/diagnostics untouched except additive grain lines).

## Files changed (reservations only)
- `static/js/shaders/ColorGradingShader.js` (3479) — added `filmGrainAmount/filmGrainScale/filmGrainSpeed/time` uniforms + a `grainHash()` and a grain term CONSUMED in `main()` after vignette. Vignette + posterize/dither (5k3.4) preserved.
- `static/js/systems/RenderSystem.js` (3480) — per-tier `filmGrainAmount` (native 0.12 > balanced 0.08 > degraded 0.05 > fallback 0); init seeds grain uniforms; `_renderScene()` advances the `time` uniform each frame before `composer.render()` (NO logging); `_applyGradeTierSettings()` drives grain from the tier (honoring a manual override); `getGradeDiagnostics().postProcessing` exposes `filmGrainAmount/Scale/Speed/Animated/Override` + retains `vignetteAmount`; new public `setFilmGrainAmount(0..1|null)` override seam for 5k3.37; added `HOST_GRADE_TIER_DEFINITIONS` named export.
- `tests/unit/color-grading-shader.test.js` (3481, new) — 7 tests: grain uniforms + defaults, vignette/posterize retained, and GLSL CONSUMPTION (grain term `color.rgb + grain * filmGrainAmount`, animation `time * filmGrainSpeed`, chunky `gl_FragCoord/filmGrainScale`), vignette applied.
- `tests/unit/render-grade-ladder.test.js` (3482, new) — 10 tests: tier grain ladder descends + fallback 0 + post off, vignette still tiered, RenderSystem APPLIES tier grain to the live uniform, fallback disables the pass, diagnostics expose grain, and the override seam (force 0 for reduce-effects, survives re-apply, clears to tier, clamps).
- `tests/e2e/visual-effects.spec.ts` (3483) — additive: the existing host-grade-ladder test now also asserts live `filmGrainAmount > 0`, `filmGrainAnimated === true`, `vignetteAmount > 0` from real browser diagnostics.
- `artifacts/br-skip-bin-arcade-design-language-5k3.8/**` (3484) — this file + vitest.log + build.log.

## How the acceptance items are covered
- **Animated grain, consumed in GLSL:** shader test asserts the fragment shader adds `grain * filmGrainAmount` to the output and derives the grain frame from `time * filmGrainSpeed` (so `filmGrainAmount=0` is a true no-op and grain animates). RenderSystem advances `time` each render.
- **Vignette preserved + proven:** shader test asserts `color.rgb *= vignette` with `smoothstep(0.3,1.2,dist)*vignetteAmount`; ladder test asserts vignette tiered; browser test asserts live `vignetteAmount>0`.
- **Reduce-effects / tiers respect it:** ladder test proves native>balanced>degraded>0 and fallback=0 with the grade pass disabled; `setFilmGrainAmount(0)` forces grain off (reduce-effects/a11y) and wins over a tier re-apply. Manual post-processing toggle still disables the whole pass (unchanged).
- **Diagnostics observe real uniforms:** `getGradeDiagnostics().postProcessing.filmGrainAmount/filmGrainAnimated` (unit + browser).
- **5k3.37 handoff seam:** public `setFilmGrainAmount(amount|null)` + `filmGrainOverride` in diagnostics; `HOST_GRADE_TIER_DEFINITIONS` exported.
- **Repo invariants:** grain is a HOST composer pass — controllers never run it; lowest/fallback tier + reduce path yield grain 0; correctness never gated on it. No per-frame logging (time-uniform update is silent).

## Commands (fresh, by me)
- `npx vitest run tests/unit/color-grading-shader.test.js tests/unit/render-grade-ladder.test.js` => **Test Files 2 passed (2), Tests 17 passed (17)**. Log: `vitest.log`.
- `npm run build` => **PASS** (`✓ built in 2.69s`, pre-existing chunk-size warning only). Log: `build.log`.
- `npx playwright test tests/e2e/visual-effects.spec.ts --grep "host-grade ladder"` => **1 passed** (serves freshly-rebuilt dist/; live grain+vignette diagnostics asserted; composer builds, no console errors).

## Notes
- `ColorGradingShader.js`, `RenderSystem.js`, `visual-effects.spec.ts` were already dirty with other agents' WIP; my edits are purely additive grain/vignette lines and I preserved that WIP (re-diffed before editing). A validator should re-diff to confirm.
- Full P7.2 settings UI is NOT built here (out of scope) — only the override seam it will wire into.
