# StormyMill Fresh Validation - 5k3.21

Result: PASS.

Scope:

- `static/js/ui/ResultsUI.js`
- `tests/unit/win-moment.test.js`
- `tests/e2e/win-moment.spec.ts`
- `artifacts/br-skip-bin-arcade-design-language-5k3.21/*`

## Harness Inspection

The repaired E2E harness explicitly prevents the prior false-positive failure mode:

- waits for `window.__hostLoadingOverlay.completed === true`
- verifies `loadingVisible === false`
- force-hides only `#loading-overlay` and `#error-overlay` after host startup
- asserts `#loading-overlay` is not visible before both screenshots
- scopes result assertions to `#win-moment-test-container`

This satisfies the warm-up overlay guard requirement.

## Commands

```bash
npx vitest run tests/unit/win-moment.test.js
```

PASS: `1 passed (1)`, `3 passed (3)`, duration `645ms`.
Existing warning: Vite CJS Node API deprecation.

```bash
npm run build
```

PASS: `134 modules transformed`, built in `4.06s`.
Existing warnings: Vite CJS Node API deprecation, non-module `/static/js/audioManager.js`, chunk-size warnings.

```bash
npx playwright test tests/e2e/win-moment.spec.ts --workers=1
```

PASS: `2 passed (7.0s)`.

## Visual Inspection

Freshly regenerated screenshots inspected:

- `win-moment-race.png`: visibly shows the winner spotlight with huge `ADA`; no warm-up/loading overlay visible.
- `win-moment-derby.png`: visibly shows the winner spotlight with huge `GRACE`; no warm-up/loading overlay visible.

## Diagnostics

Race:

```json
{
  "immediate": {
    "visible": true,
    "active": true,
    "completed": false,
    "mode": "race",
    "winnerName": "Ada",
    "durationMs": 850,
    "tableHidden": true,
    "winMomentHidden": false
  },
  "finalDiagnostics": {
    "visible": true,
    "active": false,
    "completed": true,
    "mode": "race",
    "winnerName": "Ada",
    "durationMs": 850,
    "tableHidden": false,
    "winMomentHidden": true
  }
}
```

Derby:

```json
{
  "immediate": {
    "visible": true,
    "active": true,
    "completed": false,
    "mode": "derby",
    "winnerName": "Grace",
    "durationMs": 850,
    "tableHidden": true,
    "winMomentHidden": false
  },
  "finalDiagnostics": {
    "visible": true,
    "active": false,
    "completed": true,
    "mode": "derby",
    "winnerName": "Grace",
    "durationMs": 850,
    "tableHidden": false,
    "winMomentHidden": true
  }
}
```

## Source Scan

```bash
rg -n "loading-overlay|win-moment-test-container|requestAnimationFrame|setInterval|console\.|frontend/player|static/js/player|static/css/player|/player|VehicleIdentityOverlay|SmashCalloutOverlay|DamageSystem|LobbyUI|GameHost|RenderSystem" static/js/ui/ResultsUI.js tests/unit/win-moment.test.js tests/e2e/win-moment.spec.ts
```

Observed matches are only the expected E2E warm-up guard and `#win-moment-test-container` scoping. No player/controller route changes or cross-feature source references were found.

## Conclusion

PASS. The repaired evidence now proves a sub-1-second host win moment for race and derby, screenshots show the actual spotlight/name beat instead of the warm-up overlay, and the harness includes an explicit overlay guard.
