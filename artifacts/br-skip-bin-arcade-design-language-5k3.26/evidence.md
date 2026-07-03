# br-skip-bin-arcade-design-language-5k3.26 Evidence

Status: Ready for fresh validation. Bead not closed.

## Coordination

Agent Mail inbox read succeeded for StormyMill, but `am mail ack ... 2627` failed repeatedly with:

```text
error: database error: Resource temporarily busy: sqlite init stage=base_pragmas failed: Query error: database is locked
```

Per coordinator fallback, claim/reservations/evidence were mirrored through Beads comments.

## Implementation

- `static/js/GameHost.js`
  - Reuses existing lobby-time vehicle creation.
  - Marks joined lobby vehicles as `lobbyWorld` cars.
  - Keeps lobby controls neutral while giving cars a render-only idle bob/wheel motion.
  - Records short join/leave banter.
  - Adds `getLobbyWorldDiagnostics()` for validator/browser assertions.
- `static/js/ui/LobbyUI.js`
  - Adds `#lobby-banter`.
  - Changes the lobby from a full-screen opaque panel to a left-side rail so the host world remains visible.
  - Keeps existing QR, player list, mode cards, settings, and start button in the rail.
- `tests/unit/lobby-as-world.test.js`
  - Covers neutral idle controls, visible lobby-world car diagnostics, wheel idle motion, and banter event emission.
- `tests/e2e/lobby-as-world.spec.ts`
  - Joins two players before game start.
  - Asserts host lobby diagnostics show `state=lobby`, `vehicleCount=2`, `visibleVehicleCount=2`.
  - Asserts `VehicleIdentityOverlay` has `markerCount=2`, `visibleCount=2`.
  - Asserts the canvas is visible and the lobby rail occupies less than 62% of viewport width.
  - Captures visual screenshot.

## Visual Evidence

- `artifacts/br-skip-bin-arcade-design-language-5k3.26/lobby-as-world-2p.png`

Observed screenshot: left lobby rail with QR/player/mode controls; right side remains the live arena with two joined cars and visible overhead name tags (`LobbyOne`, `LobbyTwo`) before start.

## Verification

```bash
npx vitest run tests/unit/lobby-as-world.test.js
```

Result: PASS. `1 passed (1)`, `2 passed (2)`. Existing warnings: Vite CJS Node API deprecation; `--localstorage-file` warning.

```bash
npm run build
```

Result: PASS. `132 modules transformed`, built in `3.93s`. Existing warnings: Vite CJS Node API deprecation, non-module `/static/js/audioManager.js`, chunk-size warnings.

```bash
npx playwright test tests/e2e/lobby-as-world.spec.ts --workers=1
```

Result: PASS. `1 passed (11.9s)`.

```bash
npx vitest run tests/unit/lobby-as-world.test.js tests/unit/own-car-marker.test.js
```

Result: PASS. `2 passed (2)`, `8 passed (8)`. Existing warnings: Vite CJS Node API deprecation; `--localstorage-file` warning.

```bash
git diff --check -- static/js/GameHost.js static/js/ui/LobbyUI.js tests/unit/lobby-as-world.test.js tests/e2e/lobby-as-world.spec.ts
```

Result: PASS, no output.

## Source Scan

```bash
rg -n "lobbyWorld|getLobbyWorldDiagnostics|lobby:worldBanter|lobby-banter|requestAnimationFrame|setInterval|console\\.log|console\\.warn|console\\.error" static/js/GameHost.js static/js/ui/LobbyUI.js tests/unit/lobby-as-world.test.js tests/e2e/lobby-as-world.spec.ts
```

Observed:

- 5k3.26 code appears in `GameHost.js`, `LobbyUI.js`, and the focused tests.
- No new `requestAnimationFrame` or `setInterval` matches in touched files.
- `console.*` matches are pre-existing host/lobby startup/settings logs; this slice did not add per-frame logging.
