# Project Plan - Multiplayer Racer

## Tech Debt

### Testing
- [ ] **Use Playwright built-in snapshot testing instead of pngjs**: Currently using manual PNG pixel comparison with `pngjs` library. Playwright has built-in visual comparison via `expect(page).toHaveScreenshot()` that handles diffing, thresholds, and baseline management automatically. See: https://playwright.dev/docs/test-snapshots
- [ ] **Movement test uses direct JS calls instead of real touch simulation**: The test sets `gameState.controls.acceleration = 1` via `page.evaluate()` and dispatches synthetic TouchEvents. Should ideally use Playwright's native touch simulation for more realistic testing, but touch event simulation in headless browsers is limited.
- [ ] **CRITICAL: Movement test fails in headless CI mode**: The game loop uses `requestAnimationFrame` which is throttled/paused in headless Chrome when the page isn't visible. This causes the physics engine to not update, so the car doesn't move.
  - **Root cause**: Headless Chrome pauses rAF for background tabs
  - **Potential fixes**:
    1. Add `setInterval` fallback in `host.js` game loop for when rAF is throttled
    2. Use Chrome flags like `--disable-backgrounding-occluded-windows` or `--disable-renderer-backgrounding`
    3. Use xvfb (X Virtual Framebuffer) in CI to simulate a display
    4. Use Playwright's `page.evaluate()` to manually step the game loop
  - **Current workaround**: Run with `npm run test:headed` locally
  - **Files affected**: `static/js/host.js` (game loop), `.github/workflows/test.yml` (CI config)
- [ ] **CRITICAL: Movement test is flaky**: The visual car movement test is flaky and currently skipped.
  - **What works**: Core functionality (mobile controls → car movement) works visually - verified in headed mode
  - **What's flaky**: The automated test sometimes passes, sometimes fails, even when run alone
  - **Root causes**:
    1. `requestAnimationFrame` throttling in headless Chrome stops the game loop
    2. Intermittent timing issues where controls are received but physics doesn't process them
    3. Server state may persist between test runs
  - **Evidence**: Controls show `acceleration=1` on both player and host, but car position stays at z=-20.00
  - **Current state**: Test is marked as `.skip` until fixed
  - **To reproduce working version**: Run in headed mode, sometimes works: `npm run test:headed -- --grep "car movement"`
  - **Potential fixes**:
    1. Fix the game loop to use `setInterval` fallback when rAF is throttled
    2. Add explicit physics step triggering via `page.evaluate()`
    3. Use xvfb in CI to simulate a display
    4. Investigate why physics sometimes doesn't process controls even when they're received

### Physics System
- [ ] **Two parallel physics systems exist**: Kinematic controller (`carKinematicController.js`) and dynamic rigid body (`rapierPhysics.js`). Decision made to use Rapier dynamic physics - need to remove kinematic controller.
- [ ] **Physics Parameters Panel broken**: `gameState.physicsWorld` should be `gameState.physics.world` in `host.js:2502`
- [ ] **Raycast not implemented properly**: Using height-threshold hack instead of actual Rapier raycasts (`rapierPhysics.js:496`)
- [ ] **Anti-bounce hacks**: Hardcoded damping forces masking gravity/suspension issues (`rapierPhysics.js:700-740`)
- [ ] **Delta-time integration**: Not passed properly to `world.step()` (`host.js:989`)

### Mobile/Player
- [ ] **innerHTML errors on mobile**: Missing null checks in `player.js` causing errors

### Code Quality
- [ ] **Inconsistent game state paths**: `physics.world` vs `physicsWorld` naming
- [ ] **NaN guards throughout code**: Defensive checks suggesting physics instability

---

## Completed Items

### Testing Infrastructure (Dec 2024)
- [x] Set up Playwright testing harness with dual browser contexts (host + mobile player)
- [x] Created E2E test suite covering: room creation, player join, game start, disconnections, multiple players
- [x] Added GitHub Actions CI workflow
- [x] Added car movement validation test

---

## Current Focus

### Movement Test Flakiness
The car movement test is flaky - sometimes the car moves, sometimes it doesn't:
- Touch events ARE being dispatched (`acceleration=1` confirmed in logs)
- But controls aren't consistently being transmitted to host or applied to physics
- Need to investigate the control pipeline: player.js → socket → host.js → physics

### Next Steps (Phase 3 Cleanup)
1. Fix Physics Parameters Panel (3.1)
2. Fix Mobile innerHTML Errors (3.2)
3. Consolidate to Rapier Dynamic Physics (3.3)
4. Fix Delta-Time Integration (3.4)
5. Remove Anti-Bounce Hacks (3.5)
6. Clean Up Game State (3.6)
