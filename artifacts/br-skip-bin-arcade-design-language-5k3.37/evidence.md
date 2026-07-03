# br-skip-bin-arcade-design-language-5k3.37 slice A evidence

Agent: BlueLake

Scope:
- Added `static/js/ui/ManualVisualSettingsController.js`.
- Added `tests/unit/manual-visual-settings.test.js`.
- No LobbyUI, RenderSystem, GameHost, CSS/template, visual-effects, Beads, or closure changes.

Reservations:
- 3542 `static/js/ui/ManualVisualSettingsController.js`
- 3543 `tests/unit/manual-visual-settings.test.js`
- 3544 `artifacts/br-skip-bin-arcade-design-language-5k3.37/**`

Commands:
- `npx vitest run tests/unit/manual-visual-settings.test.js` -> PASS, 1 file, 8 tests.
- `npx vitest run tests/unit/manual-visual-settings.test.js tests/unit/adaptive-quality-controller.test.js` -> PASS, 2 files, 29 tests.
- `npm run build` -> PASS, Vite built in 2.53s.

Observed behavior covered by tests:
- Loads and saves the existing `visualSettings` blob without clobbering keys such as `uiScale`.
- Auto mode calls `adaptiveQuality.setAuto()`.
- Manual tier mode calls `adaptiveQuality.setManualTier(...)`.
- Forced resolution clamps to `0.5..1` and applies through `render.setResolutionScale`.
- Reduce-effects pins fallback quality, disables/lower grain, dither, scanline, bloom, post-processing, fog, shake, grain overlay, and toggles the document `reduce-effects` class.
- Clearing reduce-effects reapplies the saved manual values through the same seams.
- No console logging while normalizing, saving, or applying settings.

Residual blocker:
- This is a pure controller/helper slice only. Full bead closeability still needs UI integration through a clean reservation window, likely in `LobbyUI.js`, plus browser evidence that host-facing controls drive this controller. That was intentionally out of scope to avoid active 5k3.25/5k3.9 conflicts.

---

# br-skip-bin-arcade-design-language-5k3.37 full integration evidence

Agent: StormyBeaver

Scope:
- Wired `ManualVisualSettingsController` into the existing host `LobbyUI` visual settings panel.
- Added host controls for quality mode, forced resolution scale, reduce-effects, film grain, dither, scanline, bloom, fog, shake, and post-processing.
- Added real RenderSystem seams for `setDitherStrength(null|0..1)` and `setScanlineAmount(null|0..1)`.
- Added a subtle `scanlineAmount` uniform to the existing ColorGrading shader.
- Preserved the existing `visualSettings` localStorage blob and existing keys, including `uiScale`.
- Kept Local phones/controllers out of this surface; the implementation lives only in host lobby UI/render seams.

Reservations:
- 3704 `static/js/ui/LobbyUI.js`
- 3705 `tests/e2e/visual-effects.spec.ts`
- 3706 `artifacts/br-skip-bin-arcade-design-language-5k3.37/**`
- 3707 `static/js/systems/RenderSystem.js`
- 3708 `static/js/shaders/ColorGradingShader.js`
- 3709 `static/js/ui/ManualVisualSettingsController.js`
- 3710 `tests/unit/manual-visual-settings.test.js`
- 3711 `tests/unit/render-grade-ladder.test.js`

Commands:
- `npx vitest run tests/unit/manual-visual-settings.test.js tests/unit/render-grade-ladder.test.js tests/unit/adaptive-quality-controller.test.js` -> PASS, 3 files, 48 tests.
- `npm run build` -> PASS. Existing warnings only: Vite CJS deprecation, non-module `/static/js/audioManager.js`, and large chunks.
- `npx playwright test tests/e2e/visual-effects.spec.ts --workers=1` -> PASS, 7 browser tests.
- `git diff --check -- static/js/ui/LobbyUI.js static/js/ui/ManualVisualSettingsController.js static/js/systems/RenderSystem.js static/js/shaders/ColorGradingShader.js tests/unit/manual-visual-settings.test.js tests/unit/render-grade-ladder.test.js tests/e2e/visual-effects.spec.ts` -> PASS.

Browser-observed values from `tests/e2e/visual-effects.spec.ts`:
- Default host lobby controls present: quality select, resolution slider/auto toggle, reduce-effects toggle, film grain, dither, scanline, bloom, fog, shake, and post-processing.
- Persistence reload values observed from `localStorage.visualSettings`: quality `host-balanced`, resolution `0.75`, reduce-effects `true`, film grain `0.22`, dither `0.33`, scanline `0.11`, bloom `1.5`, fog `0.012`, shake `0.25`, post-processing `false`.
- Manual host settings observed after UI input: adaptive manual `true`, adaptive tier `host-degraded`, render resolution scale `0.65`, film grain `0.21`, dither `0.31`, scanline `0.17`, bloom `1.3`, fog `0.01`.
- Reduce-effects observed after UI toggle: adaptive tier `host-fallback`, post-processing `false`, bloom `0`, film grain `0`, dither `0`, scanline `0`, fog `<= 0.003`, `document.body.reduce-effects` `true`, grain overlay `data-enabled="false"`.
- Auto restoration observed after UI reset: visual quality `auto`, resolution scale `null`, reduce-effects `false`, adaptive manual `false`, body reduce-effects `false`.

Notes:
- Dither and scanline controls are not cosmetic: Playwright reads the live `RenderSystem.getGradeDiagnostics()` values after UI events.
- `setDitherStrength(null)` and `setScanlineAmount(null)` restore active grade-tier values; this is covered by `tests/unit/render-grade-ladder.test.js`.
- Diff-only source scan still shows earlier uncommitted RenderSystem one-time backend logs from adjacent work; this 5k3.37 patch did not add per-frame logging.
