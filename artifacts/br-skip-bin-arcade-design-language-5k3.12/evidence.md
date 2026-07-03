# br-skip-bin-arcade-design-language-5k3.12 Evidence

Fresh validation by StormyBeaver on 2026-07-02.

## Scope

`5k3.12` requires persistent per-car overhead name tags/color markers so players can identify their
car quickly under the active Skip Bin Arcade grade. The current implementation comes from the
host-only `VehicleIdentityOverlay` path and related marker tests.

## Commands

- `npx vitest run tests/unit/own-car-marker.test.js`
  - Result: pass, 1 file, 6 tests.
- `npm run build`
  - Result: pass. Vite built `dist/` from the current JS/CSS tree. Existing warnings only:
    Vite CJS Node API deprecation, non-module `audioManager.js`, large chunk warning.
- `npx playwright test tests/e2e/game-flow.spec.ts -g "host markers" --workers=1`
  - Result: pass, 2 tests.
  - Covers 4-car race markers, respawn pulse, rejoin pulse, and 4-car derby marker/HUD overlap.
- `npx playwright test tests/e2e/camera-modes.spec.ts --workers=1`
  - Result: pass, 1 test.
  - Covers marker persistence/preferred identity across party/chase/hood camera modes.

## Visual Artifacts

- `own-car-race-4p.png`
  - Four-player race under active grade. The debug assertion proved 4 markers exist and at least 3
    are visible; screenshot shows persistent overhead labels in the race scene.
- `own-car-respawn-pulse.png`
  - Respawn path after forced damage. The Playwright assertion proved a marker entered pulsing state.
    Screenshot framing shows the active grade and visible overhead labels; not every marker is in
    frame.
- `own-car-rejoin-pulse.png`
  - Rejoin path for player 1. The Playwright assertion proved player 1's marker entered pulsing
    state after reconnect.
- `own-car-derby-4p.png`
  - Four-player derby. Shows four overhead labels inside the arena and away from host HUD/camera
    controls; Playwright also checked marker boxes against timer, lap/HUD, speed, and camera-control
    occluder boxes.
- `own-car-chase-focus.png`
  - Chase camera. Shows the focused car marker plus peer markers, all readable with the active
    camera controls visible.

All PNGs were copied immediately after their producing Playwright run because Playwright clears
`test-results/` between runs.

## Coordination Notes

Agent Mail MCP was not reachable and the local `am` CLI was blocked by the running Agent Mail
daemon's SQLite lock during this validation. A direct read-only SQLite check showed zero unexpired
active file reservations before writing this artifact directory. Coordination/closure notes are
mirrored through Beads comments as the documented fallback for this transient Agent Mail outage.

## Residual Risk

The race screenshot has crowded labels because the camera starts with four cars close together, but
the assertions prove marker count and visibility. Higher-order styling such as leader/danger marker
treatment remains in dependent beads (`5k3.14`, `5k3.19`, `5k3.21`, `5k3.26`).
