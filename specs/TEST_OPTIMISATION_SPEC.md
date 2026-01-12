# Test Optimisation Spec

## Overview

This document outlines the migration from slow WebGL-based E2E tests to a tiered testing approach.

**Problem:** Running 41 WebGL E2E tests in CI with SwiftShader takes 60-90+ minutes.

**Solution:** Three-tier testing - unit, integration, and ONE comprehensive E2E test.

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CI Pipeline                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │   test-fast.yml     │    │       test-e2e.yml              │ │
│  │  Unit + Integration │    │  Single 4-player E2E test       │ │
│  │  No browser         │    │  SwiftShader, ~3-5 min          │ │
│  │  ~30 seconds        │    │  Validates full stack           │ │
│  └─────────────────────┘    └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Infrastructure Setup

### Step 1.1: Create test directories

```bash
mkdir -p tests/unit tests/integration
```

### Step 1.2: Install Vitest

```bash
npm install -D vitest
```

### Step 1.3: Create vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    },
});
```

### Step 1.4: Update package.json scripts

Add to `scripts`:

```json
{
  "test": "npm run test:unit && npm run test:integration",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:e2e": "playwright test tests/e2e/full-game.spec.ts",
  "test:e2e:all": "playwright test tests/e2e",
  "test:e2e:headed": "playwright test tests/e2e --headed"
}
```

---

## Phase 2: Create CI Workflows

### Step 2.1: Create .github/workflows/test-fast.yml

```yaml
name: Fast Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration
```

### Step 2.2: Create .github/workflows/test-e2e.yml

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          npm ci

      - name: Cache Playwright
        uses: actions/cache@v4
        id: playwright-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - name: Install Playwright
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium

      - name: Install Playwright deps
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium

      - name: Build frontend
        run: npm run build

      - name: Start server
        run: python server/app.py &

      - name: Wait for server
        run: npx wait-on http://localhost:8000 --timeout 30000

      - name: Run E2E test
        run: xvfb-run --auto-servernum npm run test:e2e
        env:
          CI: true

      - name: Upload results on failure
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-results
          path: test-results/
```

---

## Phase 3: Create Core Tests

### Step 3.1: Create tests/e2e/full-game.spec.ts

This is the ONE comprehensive E2E test for CI:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Full Game E2E', () => {
    test('4 players can join and race', async ({ browser }) => {
        // Create host
        const hostContext = await browser.newContext();
        const hostPage = await hostContext.newPage();
        await hostPage.goto('/?testMode=1');

        // Get room code
        await hostPage.waitForSelector('#room-code', { timeout: 30000 });
        const roomCode = await hostPage.locator('#room-code').textContent();
        console.log(`Room: ${roomCode}`);

        // Create 4 players
        const players = [];
        for (let i = 1; i <= 4; i++) {
            const ctx = await browser.newContext();
            const page = await ctx.newPage();
            await page.goto('/player?testMode=1');
            await page.fill('#room-code-input', roomCode!);
            await page.fill('#player-name', `Player${i}`);
            await page.click('#join-btn');
            await page.waitForSelector('#controller-screen, #waiting-screen', { timeout: 30000 });
            players.push({ ctx, page });
            console.log(`Player${i} joined`);
        }

        // Verify all joined
        for (let i = 1; i <= 4; i++) {
            await expect(hostPage.locator('#player-list')).toContainText(`Player${i}`, { timeout: 30000 });
        }

        // Start game
        await hostPage.waitForFunction(() => {
            const btn = document.querySelector('#start-game-btn') as HTMLButtonElement;
            return btn && !btn.disabled;
        }, { timeout: 60000 });
        await hostPage.click('#start-game-btn');

        // Wait for engine
        await hostPage.waitForFunction(() => {
            return (window as any).game?.engine?.initialized;
        }, { timeout: 120000 });

        // Verify 4 vehicles
        const count = await hostPage.evaluate(() => (window as any).game?.vehicles?.size);
        expect(count).toBe(4);

        // Verify racing state
        const state = await hostPage.evaluate(() => (window as any).game?.engine?.getState());
        expect(['racing', 'countdown']).toContain(state);

        // Cleanup
        for (const p of players) await p.ctx.close();
        await hostContext.close();

        console.log('=== PASSED ===');
    });
});
```

### Step 3.2: Create tests/integration/vehicle-physics.test.ts

```typescript
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

describe('Vehicle Physics', () => {
    let world: RAPIER.World;
    let vehicle: RAPIER.RigidBody;

    beforeAll(async () => {
        await RAPIER.init();
    });

    beforeEach(() => {
        world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100));
        vehicle = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0)
        );
        world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.5, 2), vehicle);
    });

    it('accelerates when force applied', () => {
        const initialZ = vehicle.translation().z;
        for (let i = 0; i < 60; i++) {
            vehicle.addForce({ x: 0, y: 0, z: -100 }, true);
            world.step();
        }
        expect(vehicle.translation().z).toBeLessThan(initialZ);
    });

    it('decelerates when braking', () => {
        vehicle.setLinvel({ x: 0, y: 0, z: -10 }, true);
        for (let i = 0; i < 60; i++) {
            const v = vehicle.linvel();
            vehicle.setLinvel({ x: v.x * 0.95, y: v.y, z: v.z * 0.95 }, true);
            world.step();
        }
        expect(Math.abs(vehicle.linvel().z)).toBeLessThan(5);
    });

    it('resets position and velocity', () => {
        vehicle.setTranslation({ x: 50, y: 10, z: -100 }, true);
        vehicle.setLinvel({ x: 5, y: 2, z: -20 }, true);

        vehicle.setTranslation({ x: 0, y: 1, z: 0 }, true);
        vehicle.setLinvel({ x: 0, y: 0, z: 0 }, true);

        expect(vehicle.translation().x).toBeCloseTo(0);
        expect(vehicle.linvel().z).toBeCloseTo(0);
    });
});
```

### Step 3.3: Create tests/unit/example.test.ts

```typescript
import { describe, it, expect } from 'vitest';

describe('Example', () => {
    it('works', () => {
        expect(1 + 1).toBe(2);
    });
});
```

---

## Phase 4: Migrate Existing Tests

### Test Disposition Table

| File | Action | Reason |
|------|--------|--------|
| `ci-diagnostic.spec.ts` | DELETE | No longer needed |
| `camera-zoom.spec.ts` | LOCAL ONLY | Visual, needs GPU |
| `car-movement.spec.ts` | CONVERT | Physics → integration |
| `car-reset.spec.ts` | CONVERT | Physics → integration |
| `game-flow.spec.ts` | LOCAL ONLY | Covered by full-game |
| `late-join.spec.ts` | CONVERT + LOCAL | Logic → integration, UI → local |
| `player-name.spec.ts` | LOCAL ONLY | UI test |
| `race-completion.spec.ts` | CONVERT | Logic → integration |

### Step 4.1: Delete ci-diagnostic.spec.ts

```bash
rm tests/e2e/ci-diagnostic.spec.ts
```

### Step 4.2: Update playwright.config.ts

Add `testMatch` to only run full-game in CI:

```typescript
testMatch: isCI ? 'full-game.spec.ts' : '**/*.spec.ts',
```

### Step 4.3: Convert physics tests

For each physics test, extract the assertion and create a Rapier-only version in `tests/integration/`.

---

## Phase 5: Validation

### Step 5.1: Run locally

```bash
npm run test:unit        # Should pass in < 1s
npm run test:integration # Should pass in < 5s
npm run test:e2e         # Should pass in < 3 min
```

### Step 5.2: Push and verify CI

- `test-fast.yml`: < 1 minute
- `test-e2e.yml`: < 10 minutes

### Step 5.3: Delete old workflow

```bash
rm .github/workflows/test.yml
```

---

## Success Criteria

| Metric | Before | After |
|--------|--------|-------|
| Fast CI feedback | 60-90 min | < 1 min |
| E2E CI time | 60-90 min | ~5 min |
| Test reliability | ~75% | 99%+ |
| CI tests | 41 WebGL | 1 E2E + N unit/integration |

---

## References

- [TESTING.md](./TESTING.md) - Testing patterns
- [Vitest](https://vitest.dev/)
- [Playwright CI](https://playwright.dev/docs/ci)
