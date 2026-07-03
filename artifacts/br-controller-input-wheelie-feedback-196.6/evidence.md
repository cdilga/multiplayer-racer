# br-controller-input-wheelie-feedback-196.6 Evidence

Implementation repaired the prior blocker: `computeSteeringAuthority()` is now used by the live
`PhysicsSystem.applyVehicleControls()` path instead of remaining an orphan helper.

## What changed

- `PhysicsSystem` imports `computeSteeringAuthority` and uses it to calculate live steering output.
- Grounded, front-light, wheelie, and airborne states now produce progressive authority instead of
  the old full-control to wheelie/airborne cliff.
- Bad-landing steering authority now ramps through the helper using the configured landing duration.
- Side-tilt recovery uses a capped, rate-limited torque impulse only with player input, and is
  disabled while fully airborne.
- Wall contact does not reduce steering authority; telemetry exposes the wall-peel bias separately.
- F2 `PhysicsTuningUI` shows authority, dominant limiter, factor breakdown, recovery/wall values,
  and exposes front-light/wheelie/air/side-tilt/recovery tuning controls.

## Commands

- `npx vitest run tests/unit/steering-authority.test.js tests/integration/steering-authority-live.test.js`
  - PASS: 2 files, 23 tests.
- `npx vitest run tests/unit/wheelie-intent.test.js tests/integration/wheelie-intent-sim.test.js`
  - PASS: 2 files, 4 tests.
- `npm run build`
  - PASS. Existing warnings only: Vite CJS Node API deprecation, non-module host `audioManager.js`,
    and standard chunk-size warnings.
- `python -m py_compile server/app.py`
  - PASS.
- `git diff --check -- static/js/systems/PhysicsSystem.js static/js/ui/PhysicsTuningUI.js tests/integration/steering-authority-live.test.js`
  - PASS.
- Focused source scan for new `console.log`, `requestAnimationFrame`, or `setInterval` in the diff
  - PASS: no matches.

## Numeric proof

See `steering-authority-live-diagnostics.json`.

The integration test calls the actual `PhysicsSystem.applyVehicleControls()` method with deterministic
vehicle/controller/body mocks. It proves actual wheel steering output:

- grounded authority `1.00`, applied steer `-0.50`
- front-light authority `0.70`, applied steer `-0.35`
- wheelie authority `0.18`, applied steer `-0.09`
- airborne authority `0.08`, applied steer `-0.04`

It also proves telemetry contains limiter/factors, bad-landing limiter behavior, capped side-tilt
recovery torque, no recovery torque without player input, no recovery torque while airborne, and no
wall-contact steering loss.

## Residual risk

This is deterministic live-path proof rather than a full Playwright feel pass. It validates the
previously missing sim integration, telemetry, and guard invariants. Tuning values should still be
playtested before declaring final handling feel perfect.
