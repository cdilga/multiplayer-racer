# Test Scenario Analysis

## Test Coverage Summary

### 1. **car-movement.spec.ts** (2 tests)
- ✅ Car moves forward when accelerating (Physics + Controls)
- ✅ Car stops when braking (Physics + Controls)

### 2. **car-reset.spec.ts** (1 test)
- ✅ Car resets to spawn position (Reset functionality)

### 3. **console-errors.spec.ts** (2 tests)
- ✅ No console errors after starting (Smoke test)
- ✅ Physics maintains valid positions (Position validation)

### 4. **game-flow.spec.ts** (9 tests)
- ⚠️ Car has valid position after start (REDUNDANT - covered by console-errors test 2)
- ⚠️ Receives control inputs (REDUNDANT - covered by car-movement tests)
- ✅ Creates room and displays code (UI - Unique)
- ✅ Allows player to join (UI - Unique)
- ✅ Starts game when host clicks (UI - Unique)
- ✅ Handles player disconnection (Network - Unique)
- ✅ Handles host disconnection (Network - Unique)
- ✅ Supports multiple players (Multiplayer - Unique)
- ✅ Shows error for invalid room code (Error handling - Unique)

### 5. **debug-panels.spec.ts** (3 tests)
- ✅ F2 toggles physics panel (UI - Unique)
- ✅ F3 toggles stats overlay (UI - Unique)
- ✅ F4 toggles physics debug (UI - Unique)

## Redundancies Identified

1. **game-flow.spec.ts - "car should have valid position after game starts"**
   - **Redundant with**: console-errors.spec.ts - "physics should maintain valid car positions"
   - **Action**: Remove or merge

2. **game-flow.spec.ts - "should receive control inputs and update car position"**
   - **Redundant with**: car-movement.spec.ts tests
   - **Action**: Remove (car-movement tests are more comprehensive)

## Test Optimization Opportunities

1. **Reduce wait times** (already done)
2. **Combine similar setup** - Many tests have identical setup (room creation, player join, game start)
3. **Skip slow tests during dev** - Add tags for smoke tests vs full tests
4. **Parallelize where possible** - Some UI tests could run in parallel

## Current Issue: Page Crash

The page is crashing during `startGameFromHost` at the body click step. This suggests:
- Three.js r152 might have compatibility issues
- Game initialization might be failing
- Need to check console errors during initialization

