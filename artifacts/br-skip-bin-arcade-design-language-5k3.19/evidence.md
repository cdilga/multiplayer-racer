# 5k3.19 Smash Callout Stinger Evidence

Agent: BlueLake

Status: Ready for fresh validation after the coordinator unblocked the
`VehicleIdentityOverlay.js` build failure in the 5k3.14 lane.

## Implemented Slice

- `static/js/systems/DamageSystem.js`
  - `damage:destroyed` now includes `source`, `sourcePlayerId`, `sourceVehicleId`, and `sourceWeaponId`.
  - Weapon damage already passes `sourcePlayerId` through `applyDamage`, enabling attributed stingers.
- `static/js/ui/SmashCalloutOverlay.js`
  - Standalone host DOM overlay.
  - Supports `X WRECKED Y` when attacker/victim attribution is available.
  - Falls back to victim-only copy when no attacker exists.
  - Uses `textContent`, capped queue, pointer-events none, no RAF/interval/logging.
- `static/js/ui/SmashCalloutOverlayBootstrap.js`
  - Waits for `window.game.eventBus` and attaches the overlay.
- `src/host/main.js`
  - Narrow dynamic import for the smash callout bootstrap after `window.game` exists.

## Commands

- `npx vitest run tests/unit/damage-smash-attribution.test.js tests/unit/smash-callout-overlay.test.js`
  - PASS: 2 files, 5 tests.
- `npm run build`
  - PASS: 134 modules transformed, built in 2.88s.
  - Existing warnings only: Vite CJS deprecation, non-module `audioManager.js`,
    chunk-size warnings.
- `npx playwright test tests/e2e/smash-callout-stinger.spec.ts --workers=1`
  - PASS: 1/1.

## Source Scan

Command:

```bash
rg -n "requestAnimationFrame|setInterval|console\\.|innerHTML|VehicleIdentityOverlay|DerbySystem|RaceUI|LobbyUI|lobby-as-world|leader-danger" \
  static/js/ui/SmashCalloutOverlay.js \
  static/js/ui/SmashCalloutOverlayBootstrap.js \
  tests/unit/damage-smash-attribution.test.js \
  tests/unit/smash-callout-overlay.test.js \
  tests/e2e/smash-callout-stinger.spec.ts
```

Result: no matches.

## Browser Proof

- `smash-callout-attributed.png`: live host screenshot with attributed stinger.
- `smash-callout-diagnostics.json`:

```json
{
  "visible": true,
  "queueLength": 0,
  "eventCount": 1,
  "lastCallout": {
    "text": "Ada WRECKED Grace",
    "attackerName": "Ada",
    "victimName": "Grace",
    "sourcePlayerId": "attacker-player",
    "playerId": "victim-player",
    "weaponId": "rocket"
  },
  "text": "Ada WRECKED Grace"
}
```

## Residual Risk

Collision/no-source deaths intentionally fall back to victim-only copy because
the existing collision damage path has no unambiguous attacker. Weapon/source
damage carries `sourcePlayerId` through `DamageSystem` and renders `X WRECKED Y`.
