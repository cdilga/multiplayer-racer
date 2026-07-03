# Independent Validation - br-skip-bin-arcade-design-language-5k3.26

Validator: StormyBeaver
Date: 2026-07-02
Status: PASS-SCOPE

## Scope

Fresh validation of StormyMill's lobby-as-world implementation. No implementation
files were edited during this validation pass.

Reserved evidence path:

- Agent Mail reservation 3622: `artifacts/br-skip-bin-arcade-design-language-5k3.26/**`

## Source Review

Reviewed:

- `static/js/GameHost.js`
- `static/js/ui/LobbyUI.js`
- `tests/unit/lobby-as-world.test.js`
- `tests/e2e/lobby-as-world.spec.ts`
- `artifacts/br-skip-bin-arcade-design-language-5k3.26/evidence.md`

Focused source scan confirmed the implementation covers:

- Joined pre-start vehicles are marked as lobby-world cars.
- Lobby controls are neutralized while cars remain visible.
- Idle wheel/bob motion is simulated during lobby state.
- Join/leave banter is recorded and emitted.
- `getLobbyWorldDiagnostics()` exposes validator-readable state.
- Lobby UI uses a side rail with `#lobby-banter` so the host world remains visible.

## Visual Evidence

Inspected:

- `artifacts/br-skip-bin-arcade-design-language-5k3.26/lobby-as-world-2p.png`

Observed result: the host lobby is a left rail, the live arena remains visible,
two joined lobby cars are visible before game start, and the name markers
`LobbyOne` and `LobbyTwo` are visible above the cars.

## Commands

```bash
npx vitest run tests/unit/lobby-as-world.test.js tests/unit/own-car-marker.test.js
```

Result: PASS. `2 passed (2)` test files, `8 passed (8)` tests.

```bash
npm run build
```

Result: PASS. Vite built successfully with `134 modules transformed`.
Existing warnings observed: Vite CJS Node API deprecation, non-module
`/static/js/audioManager.js`, and chunk-size warnings.

```bash
npx playwright test tests/e2e/lobby-as-world.spec.ts --workers=1
```

Result: PASS. `1 passed (5.2s)`. The run regenerated
`artifacts/br-skip-bin-arcade-design-language-5k3.26/lobby-as-world-2p.png`.

```bash
git diff --check -- static/js/GameHost.js static/js/ui/LobbyUI.js tests/unit/lobby-as-world.test.js tests/e2e/lobby-as-world.spec.ts artifacts/br-skip-bin-arcade-design-language-5k3.26/evidence.md
```

Result: PASS. No output.

## Cross-Lane Check

BlueLake reported a build blocker in CobaltTiger's `5k3.14` lane while this
validation was in progress. I re-ran `npm run build` against the current source
after that report and the build passed, so `5k3.26` is not blocked by that
transient/cross-lane state.

## Verdict

PASS-SCOPE. The bead acceptance is met for lobby-as-world: joined players are
represented as visible pre-start cars in the host world, name tags are present,
banter is shown in the lobby rail, and focused unit/build/E2E evidence passes.

## Post-Close Edge-Case Repair

After the close, I noticed the new lobby banter renderer used `innerHTML` with
player-derived banter text, and the adjacent player list used the same pattern
for player names. This was repaired immediately in `static/js/ui/LobbyUI.js` by
building DOM nodes and assigning user-visible text with `textContent`. Lobby
player and banter colors now accept only hex colors, falling back to safe
defaults for invalid CSS values.

Added unit coverage in `tests/unit/lobby-as-world.test.js` for hostile player
names, hostile banter text, and invalid CSS color input. The guard proves the
hostile strings remain literal text and are not parsed into child elements.

Post-repair verification:

```bash
npx vitest run tests/unit/lobby-as-world.test.js
```

Result: PASS. `1 passed (1)` test file, `3 passed (3)` tests.

```bash
npx vitest run tests/unit/lobby-as-world.test.js tests/unit/own-car-marker.test.js
```

Result: PASS. `2 passed (2)` test files, `9 passed (9)` tests.

```bash
npm run build
```

Result: PASS. Vite built successfully with `134 modules transformed`.
Existing warnings observed: Vite CJS Node API deprecation, non-module
`/static/js/audioManager.js`, and chunk-size warnings.

```bash
npx playwright test tests/e2e/lobby-as-world.spec.ts --workers=1
```

Result: PASS. `1 passed (9.9s)`. The run regenerated
`artifacts/br-skip-bin-arcade-design-language-5k3.26/lobby-as-world-2p.png`.

Visual recheck: the screenshot still shows the lobby side rail, two joined
pre-start cars, and visible `LobbyOne`/`LobbyTwo` name markers.
