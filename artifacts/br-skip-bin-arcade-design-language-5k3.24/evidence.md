# br-skip-bin-arcade-design-language-5k3.24 Evidence

BlueLake implementation evidence for the between-round derby standings sting.

## Scope

- Touched only reserved implementation/test/artifact paths:
  - `static/js/ui/ResultsUI.js`
  - `tests/unit/derby-standings-sting.test.js`
  - `tests/e2e/derby-standings-sting.spec.ts`
  - `artifacts/br-skip-bin-arcade-design-language-5k3.24/**`
- Host-only ResultsUI overlay; no controller/player renderer files touched.
- Uses existing `derby:roundEnd` event and `timerApi.setTimeout`; no RAF, interval, or logging.

## Commands

- `npx vitest run tests/unit/derby-standings-sting.test.js`
  - PASS: 3 tests.
- `npm run build`
  - PASS: Vite build completed. Existing warnings only: non-module `audioManager.js` script and chunk-size warnings.
- `npx playwright test tests/e2e/derby-standings-sting.spec.ts --workers=1`
  - PASS: 1 Chromium test.
- `npx vitest run tests/unit/win-moment.test.js tests/unit/rematch-countdown.test.js tests/unit/results-reskin.test.js tests/unit/derby-standings-sting.test.js`
  - PASS: 14 tests across 4 files.
- `rg -n "requestAnimationFrame|setInterval|console\\.log|frontend/player|static/js/player|world renderer|world-renderer" static/js/ui/ResultsUI.js tests/unit/derby-standings-sting.test.js tests/e2e/derby-standings-sting.spec.ts`
  - PASS: no matches.

## Browser Proof

- Screenshot: `derby-standings-sting.png`
- Diagnostics: `derby-standings-sting-diagnostics.json`
- Viewport: `1280x720`
- Observed state:
  - `active=true`
  - `completed=false`
  - `round=2`
  - `winnerName=Grace`
  - `rowCount=3`
  - `durationMs=650`
  - `hidden=false`
  - `modalVisible=false`
- Observed layout:
  - `rootInsideViewport=true`
  - `cardInsideRoot=true`
  - `rowsInsideCard=true`
  - `rowOverlapCount=0`
  - `winnerBadgeOverlap=false`
  - `card.height=160.21792602539062`
  - `loadingOverlayVisible=false`
- Auto-hide assertion passed:
  - after timer, diagnostics matched `active=false`, `completed=true`, `hidden=true`, `modalVisible=false`.
