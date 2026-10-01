# VALIDATION REPORT: br-modes-remote-play-design-48a.6

**Validator**: PurpleWaterfall  
**Bead**: br-modes-remote-play-design-48a.6 (Own-car identification: make it obvious which car is yours)  
**Date**: 2026-06-29  
**Decision**: 🔴 **BLOCKED**

---

## Executive Summary

The bead implementation is architecturally sound and the core feature (own-car markers with respawn/rejoin pulses) works correctly in race mode. However, **2 E2E test failures** prevent sign-off:

1. **Derby HUD Overlap** (BLOCKING) — Markers overlap with game UI, violating "without covering HUD" criterion
2. **Chase Camera Visibility** (INVESTIGATE) — Only 2/4 markers visible instead of ≥3

---

## Validation Results

### ✅ Unit Tests: PASS (5/5)

```bash
$ npx vitest run tests/unit/own-car-marker.test.js
✓ 5 passed (388ms)
```

**Covered**:
- `buildMarkerIdentity()`: Color, number, name badge normalization ✓
- `computeMarkerPresentation()`: Distance-based scale & opacity ✓
- `computeHighlightState()`: Pulse timing (spawn: 1.8s, respawn: dynamic) ✓
- `clampMarkerPosition()`: HUD safe-area collision detection ✓
- `computeMarkerPriority()`: Crowded scene overlap prioritization ✓

### ✅ Build: PASS

```bash
$ npm run build
✓ dist/ built in 2.91s
```

**Artifacts**:
- `VehicleIdentityOverlayBootstrap-DLFmnZE6.js` (17.59 kB gzip)
- `GameHost-D511TLGK.js` (bundled with overlay)

### ❌ E2E Tests: 9/11 PASS (81.8%)

```bash
$ npx playwright test tests/e2e/camera-modes.spec.ts tests/e2e/game-flow.spec.ts
✓ 9 passed
✘ 2 failed
```

#### ✅ Passing Tests (9)
- 4-player join flow
- Multiplayer state sync
- Game start & countdown
- Race mode gameplay
- Derby mode elimination
- Vehicle collision & physics
- Player disconnection handling
- **Host markers in 4-car race (line 287)** — RESPAWN/REJOIN PULSE WORKS ✓
- Hood camera mode

#### ❌ Failing Tests (2)

**FAILURE 1: camera-modes.spec.ts:21**
```
Test: "can switch between party, chase, and hood views from the host controls"
Line: 68
Assertion: expect(chaseState.visibleMarkers).toBeGreaterThanOrEqual(3)
Expected: >= 3
Actual:   2
```

**Analysis**: In chase camera mode (focused on player 1), only 2 out of 4 markers are visible.

**Root Cause Candidates**:
- A) One marker behind camera (z < 0) due to tight chase framing — LIKELY
- B) One marker off-screen due to tight viewport — POSSIBLE
- C) One marker hidden due to overlap + non-preferred status — LESS LIKELY
- D) Test expectation too strict for focused camera — PLAUSIBLE

**Severity**: MEDIUM
- Chase mode is intentionally a focused view; some culling is expected
- 2 visible markers still provides orientation
- Could be test expectation issue rather than implementation bug

**Action**: Verify z-culling logic and camera FOV/position; may need test adjustment

---

**FAILURE 2: game-flow.spec.ts:347**
```
Test: "host markers stay visible in 4-car derby without covering HUD or camera controls"
Lines: 393-397
Assertion: expect(boxesOverlap(markerBox, occluderBox)).toBe(false)
Expected: 0 overlaps
Actual:   >= 1 overlap
Overlapping with: #race-timer, .hud-lap, .hud-health-bars, .hud-speed, #camera-controls
```

**Analysis**: In derby mode, at least one visible marker overlaps with at least one HUD element.

**Root Cause Candidates**:
- A) Safe-area detection missing HUD element selector — UNLIKELY
- B) Safe-area bounds calculated incorrectly — POSSIBLE
- C) Marker rect estimation inaccurate (fixed bounds ≠ actual DOM) — LIKELY
- D) Clamping logic fails when marker would clip — POSSIBLE
- E) HUD elements dynamically resized during test — UNLIKELY
- F) Derby mode adds HUD elements not in selector list — POSSIBLE

**Severity**: HIGH
- **Violates acceptance criterion**: "without covering HUD or camera controls"
- Players' own-car markers obscured during critical gameplay
- UX impact: Cannot reliably identify own car during derby

**Action**: Debug safe-area and clamping logic; increase HUD margins if needed

---

## Acceptance Criteria Status

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Unit tests pass | ✅ COMPLETE | 5/5 in own-car-marker.test.js |
| Build succeeds | ✅ COMPLETE | npm run build successful |
| E2E race (4-car Local) | ✅ COMPLETE | game-flow.spec.ts:287 PASSES |
| E2E derby (4-car Local) | ❌ FAIL | Marker/HUD overlap detected |
| E2E camera modes | ❌ FAIL | Chase mode: 2 markers (expected ≥3) |
| Without covering HUD | ❌ FAIL | Derby test detects overlap |
| Respawn highlight | ✅ VERIFIED | Pulse triggers on damage |
| Rejoin highlight | ✅ VERIFIED | Pulse triggers on rejoin |
| Local phones HUD-only | ✅ VERIFIED | Bootstrap guard prevents overlay on phones |
| Remote viewer hook | ⏳ READY | Architecture in place (not activated) |

---

## Architecture Assessment

### ✅ Strengths

- **EventBus-driven**: Loose coupling, clean initialization
- **Bootstrap Guard**: Only triggers on host (`#game-container` check)
- **Marker Lifecycle**: Auto-cleanup tied to vehicle existence
- **Safe-Area Detection**: Scans for HUD occluders
- **Pulse Timing**: Correct (1.8s spawn, dynamic respawn, on-join)
- **Color/Number/Name**: Badge construction correct
- **Respawn/Rejoin**: Fully verified working in race mode

### ⚠️ Concerns

1. **Derby HUD Overlap** — Safe-area or rect estimation issue
   - Estimated rect may use fixed dimensions not matching actual rendering
   - HUD element margins may be insufficient
   - Cache (120ms) may miss dynamic HUD changes

2. **Chase Camera Culling** — z > 1 check correctness unclear
   - THREE.js: z < 0 = behind camera, z > 1 = beyond far plane
   - Tight framing may legitimately cull markers
   - Test expectation may be unrealistic for focused mode

3. **Marker Rect Estimation** — Uses assumed bounds
   - Actual DOM width varies with name length
   - Font rendering differences across browsers

4. **Race Condition Risk** — Multiple frames before safe-area stable
   - Low risk with static HUD but noted

---

## Local/Remote Architecture Verification

### ✅ Local Guard: CORRECT

- Bootstrap conditional: `if (document.getElementById('game-container'))`
- Host only: `#game-container` exists only in `frontend/host/index.html`
- Phone safe: `frontend/player/` pages have no `#game-container`
- Phones remain HUD-only (no render system, no overlay)

### ✅ Overlay Initialization: PROPER

- Waits for `game.systems.render.overlayContainer`
- Waits for `game.eventBus` and `game.systems.render.camera`
- Exposes `window.__vehicleIdentityOverlay` for test access
- Properly scopes to host render system

### ✅ Event Subscriptions: COMPLETE

- `loop:render` → marker position updates
- `damage:respawn` → respawn pulse trigger
- `network:playerJoined` → join pulse trigger
- `game:countdown` → start pulse trigger

### ✅ Marker Lifecycle: CLEAN

- Created when vehicle joins (`_ensureMarker`)
- Updated every frame (`loop:render`)
- Removed when vehicle leaves (`_removeMarker`)
- Cleaned up on overlay destroy

### ⏳ Remote Viewer: ARCHITECTURE-READY

- Hook exists for future Remote mode
- Not activated in this bead (separate milestone)
- Would allow separate overlay per viewer

---

## Pulse Evidence: RESPAWN & REJOIN

### ✅ Respawn Pulse Verified

**Test**: `game-flow.spec.ts:287`
```javascript
await hostPage.evaluate(() => {
    const game = window.game;
    const target = game.vehicles.get(1) || Array.from(game.vehicles.values())[0];
    game.systems.damage.applyDamage(target.id, 10000);
});
await expect.poll(async () => hostPage.evaluate(() => {
    const overlay = window.__vehicleIdentityOverlay;
    return overlay?.getDebugSnapshot?.()?.markers?.some((marker) => marker.pulsing) || false;
}), { timeout: 10000 }).toBe(true);
```

**Result**: ✅ PASS — Marker pulses on respawn

### ✅ Rejoin Pulse Verified

**Test**: `game-flow.spec.ts:287` (continued)
```javascript
await playerPage.reload();
await joinGameAsPlayer(playerPage, roomCode, 'PulseOne');
await expect.poll(async () => hostPage.evaluate(() => {
    const overlay = window.__vehicleIdentityOverlay;
    const marker = overlay?.getDebugSnapshot?.()?.markers?.find((entry) => entry.playerId === '1');
    return !!marker?.pulsing;
}), { timeout: 10000 }).toBe(true);
```

**Result**: ✅ PASS — Marker pulses on rejoin

---

## Required Actions for PeachOtter (Assignee)

### 🔴 HIGH PRIORITY

**1. Debug Derby HUD Overlap**

Add logging to `VehicleIdentityOverlay.js`:
```javascript
_getSafeArea(viewportWidth, viewportHeight) {
    const selectors = [
        '#race-timer',
        '.hud-lap',
        '.hud-health-bars',
        '.hud-speed',
        '#camera-controls',
        '.room-code-overlay'
    ];
    
    const occluders = selectors
        .map((selector) => document.querySelector(selector))
        .filter((element) => element && this._isVisible(element))
        .map((element) => element.getBoundingClientRect());
    
    // ADD LOGGING:
    console.log('HUD Occluders:', occluders.map(o => ({
        top: Math.round(o.top),
        bottom: Math.round(o.bottom),
        left: Math.round(o.left),
        right: Math.round(o.right)
    })));
    
    const area = resolveSafeArea({
        viewportWidth,
        viewportHeight,
        occluders
    });
    
    console.log('Safe Area:', area);
    return area;
}
```

Then run: `npx playwright test tests/e2e/game-flow.spec.ts:347`

Check console output for safe-area bounds. If safe-area is too tight, increase margin in `resolveSafeArea()`.

**2. Investigate Chase Camera Visibility**

Check `VehicleIdentityOverlay.js` lines 122-129:
```javascript
vector.project(this.renderSystem.camera);

if (vector.z > 1) {  // Is this correct?
    this._hideMarker(playerId);
    continue;
}
```

Verify z-culling logic. In THREE.js after projection:
- z < 0 = behind camera (should hide)
- z > 1 = beyond far plane (should hide)
- Current code only checks z > 1

**Or** accept that chase mode is focused and adjust test from >= 3 to >= 2

### 🟡 MEDIUM PRIORITY

**3. Increase HUD Safe-Area Margin**

In `vehicleIdentityMath.js`, the `resolveSafeArea()` function has a default margin. Try increasing it:
```javascript
export function resolveSafeArea({
    viewportWidth,
    viewportHeight,
    occluders,
    margin = 24  // Increase from 16 if needed
} = {}) {
    // ...
}
```

**4. Rerun Full Test Suite**

Once fixes applied:
```bash
npx vitest run tests/unit/own-car-marker.test.js
npm run build
npx playwright test tests/e2e/camera-modes.spec.ts tests/e2e/game-flow.spec.ts
```

Target: All green (unit + build + E2E)

---

## Residual Risks

### 🔴 BLOCKING
1. **Derby HUD overlap** — Players' markers obscured during gameplay
2. **Chase visibility** — Reduced readability in focused camera mode

### 🟡 WARNINGS
3. **Rect estimation accuracy** — Fixed bounds may not match actual DOM rendering
4. **Safe-area cache** (120ms TTL) — May miss dynamic HUD changes if HUD elements resize during gameplay
5. **Z-culling correctness** — Current z > 1 check might miss behind-camera culling (z < 0)

---

## Code Review Summary

**Files Reviewed**:
- `static/js/ui/VehicleIdentityOverlay.js` — Marker lifecycle & visibility logic
- `static/js/ui/vehicleIdentityMath.js` — Math utilities (distance scaling, clamping, priority)
- `static/js/ui/VehicleIdentityOverlayBootstrap.js` — Bootstrap & initialization
- `static/js/engine/EventBus.js` — Bootstrap trigger

**Quality**: ✅ GOOD
- Clean event-driven architecture
- Proper lifecycle management
- Safe-area detection is clever
- Math utilities comprehensive

**Issues**: ⚠️ EXECUTION (not design)
- HUD overlap in derby mode needs debugging
- Chase camera visibility needs investigation
- Fixed rect estimation may need dynamic adjustment

---

## Validation Artifacts

**Evidence Locations**:
- Unit test output: ✅ PASS
- Build log: ✅ Complete
- E2E screenshots: `test-results/visual/own-car-*.png`
- E2E reports: `test-results/camera-modes-*.md`, `test-results/game-flow-*.md`
- Debug snapshots: Available via `window.__vehicleIdentityOverlay.getDebugSnapshot()`
- Full validation report: `VALIDATION_br-modes-remote-play-design-48a.6.txt`

---

## Summary

**What Works** ✅:
- Own-car markers render correctly
- Pulse highlights work (respawn & rejoin verified)
- Race mode fully functional
- Local/Remote architecture properly guarded
- Phones remain HUD-only controllers

**What Needs Fixing** ❌:
- Derby mode: Markers overlap with HUD (acceptance criterion violation)
- Chase camera: Visibility degradation (may be test vs. implementation issue)

**Blockers**: 2 E2E test failures prevent sign-off until resolved.

**Expected Next Step**: PeachOtter debugs HUD overlap, verifies chase camera logic, reruns suite for sign-off.

---

**Validation By**: PurpleWaterfall (Claude Code + Playwright)  
**Completed**: 2026-06-29 22:11 UTC  
**Status**: 🔴 **BLOCKED** — Awaiting fixes to E2E test failures
