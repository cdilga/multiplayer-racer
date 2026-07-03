# Debug Lab Contract

Shared local QA/debug labs (`/car-viewer`, `/weapon-lab`, and map authoring) must expose the same evidence-oriented contract so a bead can be validated from deterministic state, screenshots, and machine-readable diagnostics rather than manual narration.

This contract is implemented by `static/js/debug/DebugLabContract.js` and safe text helpers in `static/js/debug/SafeTextRenderer.js`.
The live host installs a reference adapter from `static/js/debug/HostDebugLabAdapter.js` so Playwright can validate the browser hook shape against a real canvas before `/car-viewer`, `/weapon-lab`, and map authoring complete their own adapters.

## Scope Guard

- This bead closes on the shared contract/helper plus one reference fixture.
- Full adoption by `/car-viewer`, `/weapon-lab`, and map authoring is tracked by `br-around-couch-risk-resolution-3xv.14`.
- Labs must not add per-frame console logging. Use overlays, diagnostics JSON, screenshots, or explicit one-time action logs.

## Reference Adapter

`HostDebugLabAdapter` is the first reference fixture. It wraps the production host renderer and bug-report/debug surfaces to expose:

- `window.__debugLab` reset, step-frame, step-second, play/pause, screenshot, diagnostics, console-log, scenario export, and scenario import hooks.
- `window.__labTools` helpers for canvas, renderer, scene, state, and hostile-label safe-text probes.
- Diagnostics that include renderer metadata, tick, game state, player count, overlay flags, hook availability, and console-spy state.

The adapter owns deterministic lab hook state and evidence capture. It does not claim full deterministic control over the live multiplayer game loop; complete per-tool deterministic adoption remains owned by `br-around-couch-risk-resolution-3xv.14`.

## Required Surface

Every lab should provide:

- Full-screen production render path with a real canvas.
- Compact inspector panel for tuning uncertain defaults.
- Deterministic controls: reset, step frame, step second, play/pause.
- Scenario import/export JSON using schema `jj.debugLab.v1`.
- Screenshot hook callable from Playwright.
- Diagnostics hook returning JSON schema `jj.debugLab.diagnostics.v1`.
- Overlay layers for assumptions, diagnostics, geometry bounds, and picking/hit zones.
- Safe text rendering for labels, model names, player names, and errors.
- Global hooks:
  - `window.__debugLab`
  - `window.__labTools`

## Hook Shape

Required `window.__debugLab` methods:

```js
{
  reset(),
  stepFrame(),
  stepSecond(),
  playPause(),
  takeScreenshot(),
  getDiagnostics(),
  getConsoleLogs(),
  exportScenario(),
  importScenario(scenario)
}
```

Diagnostics must include:

```json
{
  "schema": "jj.debugLab.diagnostics.v1",
  "timestamp": 0,
  "tick": 0,
  "state": {},
  "warnings": [],
  "errors": [],
  "metrics": {}
}
```

Scenario exports must include the lab schema, seed, preset, tool name, build id, optional screenshot reference, diagnostics hash, tuning overrides, and tool-specific custom data.

## Safe Text Rule

All lab text must be rendered literally:

- Use `textContent`, `document.createTextNode`, or `canvas.fillText`.
- Do not use `innerHTML`, `DOMParser` execution, or event-handler attributes for untrusted text.
- Hostile labels such as `<img src=x onerror=alert("XSS")>` must render as visible text, not markup.

The safe text helpers also normalize display strings, cap length, and remove control, bidirectional, and zero-width characters that make labels misleading.

## Evidence Requirements

Minimum validation evidence:

- `npx vitest run tests/unit/debug-lab-contract.test.js tests/unit/safe-rendering.test.js`
- `npx playwright test tests/e2e/debug-panels.spec.ts tests/e2e/console-errors.spec.ts`
- A diagnostics fixture such as `tests/unit/fixtures/debug-lab-diagnostics.json`
- Screenshot or Playwright evidence that a reference lab/fixture exposes a nonblank canvas, diagnostics hook, screenshot hook, and no console spam.

## Residual Work

The shared contract does not itself prove every downstream tool has adopted it. Adoption is intentionally split so weapon lab and map authoring do not block the common contract from landing.
