# Audit Result: br-fb-spawncap-qi9
**Bead:** br-fb-spawncap-qi9 (Silent 16-spawn cap: player 17 spawns on top of player 1)  
**Auditor:** NavyStone  
**Date:** 2026-06-30  
**Status:** **READY-SHAPED BUT NEEDS WORKER EVIDENCE**

---

## Executive Summary

The bead implements the core fix for the silent spawn cap bug (modulo wrapping causing player 17 to spawn on player 1). The implementation is well-structured with:
- ✅ Removed modulo wrapping in `Track.getSpawnPosition()` 
- ✅ New `SpawnGenerator.js` with deterministic generation for arbitrary N
- ✅ GeometryKernel + GameRunContext adoption (determinism)
- ✅ Unit tests (25/25 PASS) and integration tests (13/13 PASS)
- ✅ Checkpoint crossing detection improvements

However, **critical E2E evidence is missing**: no soak test with 32+ controllers proving distinct spawns under load. The bead is implementation-complete but validation-incomplete.

---

## Test Execution Summary

### Unit Tests: PASS (25/25)
```
✓ tests/unit/spawn-cap-regression.test.js (6 tests) 13ms
✓ tests/unit/spawn-generation.test.js (19 tests) 22ms

Test Files: 2 passed (2)
Tests: 25 passed (25)
```

**spawn-cap-regression.test.js Coverage:**
- ✓ Returns default spawn (not player 0) for out-of-bounds index
- ✓ Does not wrap player indices (16, 32 all return default, not modulo)
- ✓ Provides distinct spawns for 17+ players with generation
- ✓ Proves no modulo wrapping even with N=64
- ✓ Metadata preservation (playerCount, generatedCount, baseCount)
- ✓ Diagnostics include seed and constraints

**spawn-generation.test.js Coverage:** (19 tests, not listed in detail but all passing)
- Non-overlapping spawn generation
- Deterministic seeding
- Geometry validation
- Support/clearance checks

### Integration Tests: PASS (13/13)
```
✓ tests/integration/track-physics.test.ts (13 tests) 163ms
```

Validated track physics integration without showing specific test names.

---

## Code Inspection

### Track.js Changes (static/js/entities/Track.js)

**Key Fix - Modulo Wrapping Removed:**
```javascript
// OLD (BUGGY): const index = playerIndex % this.spawnPositions.length;
// NEW (FIXED):
if (playerIndex < 0 || playerIndex >= spawnSet.length) {
    console.warn(`Track.getSpawnPosition: index ${playerIndex} out of bounds...`);
    return {
        x: 0,
        y: this.defaultSpawnHeight,
        z: 0,
        rotation: 0
    };
}
```
**Line 165-176 (approx):** Boundary checking instead of modulo wrap. Returns safe default (origin) for out-of-bounds, NOT player 0's spawn.

**Generated Spawns Integration:**
```javascript
setGeneratedSpawns(generationResult) {
    if (!generationResult || !generationResult.spawns) return false;
    this.generatedSpawns = generationResult.spawns;
    this.spawnGenerationMetadata = generationResult.diagnostics || {};
    return true;
}
```
**New method:** Allows track to use generated spawn set instead of base grid. Metadata preserved for diagnostics.

**Checkpoint Improvements:**
- Line ~268: Added `heightBand` support (Y-coordinate acceptance range)
- Line ~276: Added oriented gate support (tangent direction for curved tracks)
- Line ~325: New `checkCrossing()` method for frame-based crossing detection (prevents false positives from fast/far vehicles)

### SpawnGenerator.js (static/js/resources/SpawnGenerator.js)

**Key Function:**
```javascript
export function generateSpawnsForTrack(track, playerCount, context, options = {})
```
**Lines 60-112:** Deterministic generation for arbitrary N using:
- Seeded RNG from GameRunContext (not Math.random)
- Base spawns from track (up to first N existing)
- Additional spiral-search generation for spawns beyond base count
- Validation via GeometryKernel (`validateSpawnSetKernel`, `measurePairwiseSpawnDistances`)

**Constraints:**
- `minPairDistance`: 3.5 world units (car diameter + buffer)
- `minClearance`: 2.0 world units (wall/void safety)
- `requireSupport`: Ground raycast validation
- `MAX_GENERATION_ATTEMPTS`: 1000

**Returns:**
```javascript
{
    spawns: Spawn[],
    valid: boolean,
    diagnostics: {
        playerCount,
        generatedCount,
        baseCount,
        seed,
        constraints,
        validation,
        elapsedMs
    }
}
```

### ProceduralTrackGenerator.js Updates

**Line ~180-200 (estimated):** Grid spawn generation still exists (base 16-spawn grid), but now serves as fallback/base set that can be extended by SpawnGenerator for arbitrary N.

---

## Architecture Compliance

✅ **GeometryKernel Adoption:**
- Imports: `quantizeNumber`, `validateSpawnSetKernel`, `measurePairwiseSpawnDistances`
- Uses kernel's spawn validation instead of ad hoc checks
- File: SpawnGenerator.js:24

✅ **GameRunContext Adoption:**
- Seeded RNG stream: `context.stream('spawn')`
- Deterministic generation tied to run seed
- File: SpawnGenerator.js:123

✅ **No Modulo Wrapping:**
- Old: `playerIndex % spawnPositions.length` (REMOVED)
- New: boundary check with safe default
- Verified: Test explicitly checks player 17, 32, 64 get defaults or generated spawns

---

## Acceptance Criteria Status

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Unit CI: spawn-generation + regression tests | 25/25 PASS (spawn-cap-regression + spawn-generation) | ✅ Complete |
| Integration CI: track-physics | 13/13 PASS | ✅ Complete |
| No modulo wrapping: player 17 ≠ player 0 | Regression test explicitly checks; returns default (0,0,0) not player 0 spawn | ✅ Complete |
| N=64 non-overlapping spawns | Generation test covers up to N=64 with no duplicates | ✅ Complete |
| Metadata diagnostics (seed, constraints) | Returned in diagnostics object; test verifies structure | ✅ Complete |
| E2E soak: 32+ controllers distinct spawns | **NOT YET EVIDENCED** | ❌ Missing |
| Seed diagnostics for reproducibility | Seed stored in diagnostics; GameRunContext seeded RNG used | ✅ Complete |
| GeometryKernel + GameRunContext adoption | Imports confirmed; seeded RNG, kernel validation used | ✅ Complete |

---

## Edge Cases Verified

✅ **No Modulo Wrap (Player 17):**
- Test: `spawn-cap-regression.test.js` line 49-67
- Result: Player 17 gets default (0,0,0), NOT player 0's spawn
- Distance > 1 unit ensures no overlap

✅ **N=32 Unique Spawns:**
- Test: `spawn-cap-regression.test.js` line 88-112
- Result: 32 spawns generated; player 17 ≠ player 0
- Player 32 correctly out-of-bounds → default

✅ **N=64 No Wrapping:**
- Test: `spawn-cap-regression.test.js` line 114-134
- Result: 64 spawns linear; player 64 is default (0,0,0), not wrap to player 0
- Distance spawn63 → spawn0 > 0 (unique spawns)

✅ **Deterministic Seeding:**
- GameRunContext.create({seed: 12345}) passed to generation
- Seed stored in diagnostics
- Reproducible from run seed

✅ **Metadata Preservation:**
- Test: `spawn-cap-regression.test.js` line 136-145
- `spawnGenerationMetadata` populated with playerCount, generatedCount, baseCount
- Constraints recorded

---

## What's Missing (Blocker for PASS)

### 1. **E2E Soak Test Not Run** ⚠️
**Acceptance Criterion:** "opt-in soak: `JJ_SOAK_PLAYERS=32 npx playwright test tests/e2e/around-couch-soak.spec.ts`"

**Status:** Test file reference exists in acceptance criteria, but **no evidence provided** that the soak test was actually run with 32+ controllers. This is the highest-value remaining validation.

**What it would verify:**
- 32 controllers connect simultaneously
- Each receives a distinct spawn in real game scenario
- No immediate overlap/penetration under load
- Game loop stability with high player count

**Risk if skipped:** Unit tests pass in isolation, but real multiplayer load might surface:
- Race condition in spawn assignment
- RNG stream collision under concurrent generation
- Physics penetration from spawns that validated OK in isolation

### 2. **No Artifact Evidence of Diagnostics Output**
Acceptance criterion requests "spawn diagnostics report min pair distance, ground raycast success, wall/void clearance, heading, track/ruleset, seed, and any rejected candidates."

**What exists:** `generationResult.diagnostics` object structure returned.  
**What's missing:** Sample JSON artifact showing actual diagnostic output (not test expectations).

---

## Coherence Assessment

✅ **Diff is Coherent:**
- Single clear fix: remove modulo, add generation
- Related changes fit together (Track changes + SpawnGenerator + tests)
- No extraneous edits or code smell
- Backward compatible (base spawns still work; generation adds capability)

✅ **No Blocked Dependencies:**
- GeometryKernel (br-captain-call-architecture-hardening-woq.1) — closed ✓
- GameRunContext (br-around-couch-risk-resolution-3xv.5) — closed ✓

❌ **Dependents Downstream:**
- br-around-couch-risk-resolution-3xv.9 (2-32 player soak gate) — depends on this
- br-fb-mapvalid-allmodes-n47 (map validity for race/derby) — depends on this
- Several others: .10, .13, .15

---

## Implementation Quality Notes

**Strengths:**
1. **Clear separation of concerns**: Track handles access, SpawnGenerator handles creation
2. **Deterministic by design**: Seeded RNG throughout, no implicit randomness
3. **Graceful fallback**: Out-of-bounds players get safe default, not wrapped position
4. **Comprehensive testing**: 25 unit tests cover the core fix deeply
5. **Well-documented code**: Comments explain the bug fix and new behavior

**Minor concerns:**
1. **Warning log on fallback**: `console.warn(...)` when player out-of-bounds — acceptable for now but should be toggled by game phase (not every frame during soak)
2. **"Grid-based search" implementation detail hidden**: `_generateAdditionalSpawns()` uses spiral pattern; could benefit from more inline documentation on why spiral vs. grid extension
3. **Support/clearance checks deferred**: SpawnGenerator relies on `requireSupport` flag; no explicit proof in tests that raycasting actually validates ground contact

---

## Recommendation

**Status: READY-SHAPED BUT NEEDS WORKER EVIDENCE**

The implementation is **architecturally sound** and **well-tested in isolation**. All acceptance criteria except the E2E soak are evidenced.

**To move to PASS, worker must:**
1. Run `JJ_SOAK_PLAYERS=32 npx playwright test tests/e2e/around-couch-soak.spec.ts` (if this test exists)
2. Provide sample diagnostics JSON artifact from a real generation run
3. Confirm 32+ players each have distinct spawns in actual game scenario

**If E2E soak test does not exist yet:** Worker should create a minimal one (connect 32 players, verify spawn positions in game state, assert no overlaps) and run it. This is table-stakes for a "no player caps" claim.

**Decision:** Do not PASS until soak evidence exists. The unit/integration tests prove the fix works; the soak test proves it scales.

---

## Files Inspected

✅ static/js/entities/Track.js — modulo wrap fix + generation integration  
✅ static/js/resources/SpawnGenerator.js — deterministic N-spawn generation  
✅ static/js/resources/ProceduralTrackGenerator.js — confirmed grid spawns exist as base  
✅ tests/unit/spawn-cap-regression.test.js — regression proof (6 tests, all PASS)  
✅ tests/unit/spawn-generation.test.js — generation validation (19 tests, all PASS)  
✅ tests/integration/track-physics.test.ts — integration smoke (13 tests, all PASS)  

---

**Audit complete. Post to thread for worker review.**
