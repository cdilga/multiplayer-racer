# Testing Guide

This document describes the testing approach for the multiplayer racer project.

## Test Tiers

We use a three-tier testing strategy optimized for fast CI feedback:

```
                    ┌─────────────────┐
                    │    E2E Tests    │  ~3-5 min (SwiftShader)
                    │  tests/e2e/     │  Full browser, WebGL
                    │  1 comprehensive │  4 players, real gameplay
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │      Integration Tests      │  ~seconds
              │    tests/integration/       │  Rapier physics in Node.js
              │    No browser, no WebGL     │  Physics simulation only
              └──────────────┬──────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │            Unit Tests                 │  ~milliseconds
         │           tests/unit/                 │  Pure logic, math, state
         │      No dependencies, fast            │  Game rules, utilities
         └───────────────────────────────────────┘
```

## Directory Structure

```
tests/
├── unit/                    # Fast, pure logic tests
│   ├── math.test.ts
│   ├── game-rules.test.ts
│   └── state-machine.test.ts
├── integration/             # Physics tests without rendering
│   ├── vehicle-physics.test.ts
│   ├── collision.test.ts
│   └── reset-mechanics.test.ts
└── e2e/                     # Full browser tests (limited)
    ├── fixtures.ts
    └── full-game.spec.ts    # Single comprehensive test for CI
```

## Writing Unit Tests

Unit tests run in Node.js with Vitest. No browser, no WebGL, no network.

**When to use:** Pure functions, math, game logic, state machines.

**Location:** `tests/unit/*.test.ts`

```typescript
// tests/unit/lap-counter.test.ts
import { describe, it, expect } from 'vitest';
import { LapCounter } from '../../static/js/game/LapCounter';

describe('LapCounter', () => {
    it('should increment lap when crossing finish line', () => {
        const counter = new LapCounter({ totalLaps: 3 });
        counter.crossCheckpoint('finish', { direction: 'forward' });
        expect(counter.currentLap).toBe(2);
    });
});
```

**Run:** `npm run test:unit`

## Writing Integration Tests

Integration tests run Rapier physics in Node.js. No browser, no Three.js rendering.

**When to use:** Physics behavior, vehicle dynamics, collision response.

**Location:** `tests/integration/*.test.ts`

```typescript
// tests/integration/vehicle-physics.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

describe('Vehicle Physics', () => {
    let world: RAPIER.World;
    let vehicleBody: RAPIER.RigidBody;

    beforeAll(async () => {
        await RAPIER.init();
    });

    beforeEach(() => {
        world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        // ... setup vehicle
    });

    it('should accelerate when force is applied', () => {
        const initialZ = vehicleBody.translation().z;
        for (let i = 0; i < 60; i++) {
            vehicleBody.addForce({ x: 0, y: 0, z: -100 }, true);
            world.step();
        }
        expect(vehicleBody.translation().z).toBeLessThan(initialZ);
    });
});
```

**Run:** `npm run test:integration`

## Writing E2E Tests

E2E tests use Playwright with full browser and WebGL.

**When to use:** Only for comprehensive end-to-end validation. We maintain ONE test in CI that exercises the full stack with 4 players.

**Location:** `tests/e2e/full-game.spec.ts`

**Important:** We do NOT use `test.slow()` or other timeout extensions. If a test times out, it's broken and needs investigation - not more time.

```typescript
// tests/e2e/full-game.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Full Game E2E', () => {
    test('4 players can join and race', async ({ browser }) => {
        // This test validates the entire stack works.
        // It should complete within the 180s CI timeout.
        // If it doesn't, something is broken.

        // ... create host, 4 players join, start race, verify vehicles spawn
    });
});
```

**Run:** `npm run test:e2e`

## CI Workflows

### Fast Tests (`test-fast.yml`)
- Unit + Integration tests
- No browser, no WebGL
- Completes in < 1 minute
- Runs on every commit

### E2E Tests (`test-e2e.yml`)
- Single 4-player comprehensive test
- Uses SwiftShader (software WebGL)
- Completes in ~3-5 minutes
- Runs on every commit

## Running Tests

```bash
# All fast tests (unit + integration)
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# E2E (CI version - single comprehensive test)
npm run test:e2e

# E2E (all tests - local development only)
npm run test:e2e:all

# E2E with visible browser
npm run test:e2e:headed
```

## Timeout Philosophy

**We do NOT increase timeouts to fix failing tests.**

| Test Type | Timeout | If it times out... |
|-----------|---------|-------------------|
| Unit | Default (~5s) | Test is broken, fix it |
| Integration | Default (~5s) | Test is broken, fix it |
| E2E | 180s (CI) | Test is broken, fix it |

If a test is flaky or slow:
1. Investigate why
2. Fix the root cause
3. If it can't be fixed, consider if the test provides enough value

Never use `test.slow()`, `test.setTimeout()`, or similar as band-aids.

## Best Practices

### Do
- Write unit tests for pure logic
- Write integration tests for physics behavior
- Keep E2E to ONE comprehensive test in CI
- Investigate timeouts - don't just increase them

### Don't
- Write E2E tests for things testable at lower levels
- Test Three.js rendering in CI (no GPU)
- Use timeout extensions to fix flaky tests
- Add waits without understanding why

## Adding New Tests

1. **Determine the right tier:**
   - Pure logic? → Unit test
   - Physics behavior? → Integration test
   - Needs real browser? → Probably doesn't. Reconsider.

2. **If you think you need an E2E test:** Ask whether the existing 4-player E2E already covers it, or if it can be tested at a lower level.

3. **Run locally before pushing**

4. **If it fails in CI:** Fix it. Don't increase timeouts.
