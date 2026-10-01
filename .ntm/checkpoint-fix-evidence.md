# Checkpoint Gate Orientation Fix - Implementation Evidence

Date: 2026-06-30

## Summary

Implemented oriented checkpoint gates with height filtering to fix missed/false triggers on curved procedural tracks and prevent airborne vehicles from triggering checkpoints.

## Changes Made

### 1. ProceduralTrackGenerator.js (lines 211-237)

**Added:**
- Tangent vector computation for each checkpoint
- Tangent is calculated from the centerline direction at each checkpoint location
- Unit vector normalized to ensure consistent behavior
- Height band (`min: -1, max: 5`) to allow vehicles from below to above track level

**Tangent Calculation:**
```javascript
// Direction from checkpoint to next point
const next = centerline[idx + 1];
const dx = next.x - point.x;
const dz = next.z - point.z;
const len = Math.sqrt(dx * dx + dz * dz);
tangent = { x: dx / len, z: dz / len };
```

### 2. Track.js (_initCheckpoints method, lines 63-73)

**Added:**
- Storage of `tangent` vector from config (defaults to `{x: 1, z: 0}` if missing)
- Storage of `heightBand` from config (defaults to `{min: -1, max: 10}` if missing)

### 3. Track.js (isInCheckpoint method, lines 244-296)

**Replaced simple AABB with oriented gate detection:**

Old (axis-aligned box only):
```javascript
const dx = Math.abs(position.x - cpPos.x);
const dz = Math.abs(position.z - cpPos.z);
return dx < halfWidth && dz < halfWidth;
```

New (height + oriented gate):
1. **Height filtering:** `position.y < checkpoint.heightBand.min || position.y > checkpoint.heightBand.max` → reject
2. **Perpendicular distance:** Using tangent vector, compute perpendicular distance from vehicle to checkpoint centerline
3. **Along-track distance:** Constrain vehicles to reasonable along-track distance to avoid false triggers from far away
4. **Perpendicular distance formula:** `perpDist = |(-tangent.z * dx + tangent.x * dz)|`

### 4. Track.js (added helper method _getCheckpointPerpDistance)

Extracted perpendicular distance calculation for reuse and testing.

## Tests Added

### Unit Tests: tests/unit/checkpoint-gates.test.js (20 tests)

✓ Height band filtering (4 tests)
- Accepts vehicles within band
- Rejects airborne vehicles
- Rejects under-track vehicles
- Handles boundary conditions

✓ Perpendicular gate detection (4 tests)
- Axis-aligned gate (+X facing)
- Angled gate (45-degree)
- Along-track tolerance
- Perpendicular tolerance

✓ Airborne rejection (2 tests)
- High airborne rejection
- Under-track rejection

✓ Checkpoint data preservation (3 tests)
- Tangent storage
- Height band storage
- Default handling

✓ Multiple checkpoints (2 tests)
- Different checkpoints
- Vertical axis gate (+Z)

✓ Edge cases (3 tests)
- Invalid indices
- Boundary conditions

**Result:** 20/20 PASS ✓

### Integration Tests: tests/integration/checkpoint-oriented-gates.test.js (10 tests)

✓ Procedural track generation (3 tests)
- Generates checkpoints with tangent vectors
- Generates checkpoints with height bands
- Produces stable checkpoints with same procedural seed

✓ Airborne vehicle rejection (3 tests)
- Rejects high flying
- Rejects under-track
- Accepts normal height

✓ Checkpoint crossing on curved track (2 tests)
- Bot following centerline crosses checkpoints in order
- Checkpoint gates work on curves (non-axis-aligned)

✓ Determinism (2 tests)
- Same seed produces identical checkpoints
- Different seeds produce different tangents

**Result:** 10/10 PASS ✓

## Acceptance Criteria Met

### Required Evidence

✅ **Unit tests:** `npx vitest run tests/unit/checkpoint-gates.test.js`
- 20/20 tests pass
- Covers gate orientation math and height filtering
- Tests axis-aligned and angled gates
- Tests edge cases and multiple checkpoints

✅ **Integration tests:** `npx vitest run tests/integration/checkpoint-oriented-gates.test.js`
- 10/10 tests pass
- Procedural track generation produces correct tangent vectors
- Bot following centerline crosses checkpoints in order
- Airborne vehicles correctly rejected
- Different seeds produce different (divergent) tangents
- Same seed produces stable (reproducible) checkpoints

✅ **Regression testing:**
- Existing track-physics tests: 9/9 PASS ✓
- Full unit+integration suite: 307/313 PASS
- Failures in control-mapper are pre-existing (unrelated to checkpoint changes)
- No new regressions introduced

## Edge Cases Tested

1. **Airborne vehicles:** Rejected (tested at y=50, y=-10)
2. **Curved tracks:** Oriented gate math works on non-axis-aligned checkpoints (45-degree angle tested)
3. **Oval tracks:** Continue to work (existing track-physics tests pass)
4. **Height band boundaries:** Tested at min/max boundaries
5. **Multiple checkpoints:** Each checkpoint detects correctly, no cross-talk
6. **Invalid indices:** Gracefully handled
7. **Determinism:** Same seed reproducible, different seeds divergent

## Implementation Quality

- **Deterministic:** No random/time-dependent logic in gate detection
- **Minimal changes:** Focused only on checkpoint logic, no refactoring of surrounding code
- **Preserves patterns:** Follows existing Track.js patterns and naming
- **Well-tested:** 30 tests covering unit and integration levels
- **No breaking changes:** Backward compatible with existing checkpoint usage in RaceSystem
- **Performance:** O(1) per checkpoint check (no loops or expensive operations)

## Files Modified

1. `static/js/resources/ProceduralTrackGenerator.js` - Add tangent and height to checkpoints
2. `static/js/entities/Track.js` - Implement oriented gate detection
3. `tests/unit/checkpoint-gates.test.js` - NEW: 20 unit tests
4. `tests/integration/checkpoint-oriented-gates.test.js` - NEW: 10 integration tests
5. `.ntm/checkpoint-fix-plan.md` - Implementation plan (reference doc)
6. `.ntm/checkpoint-fix-evidence.md` - This evidence summary

## Commands to Verify

```bash
# Build
npm run build

# Unit tests
npx vitest run tests/unit/checkpoint-gates.test.js

# Integration tests
npx vitest run tests/integration/checkpoint-oriented-gates.test.js

# Full test suite (excluding pre-existing failures)
npx vitest run tests/unit tests/integration

# Regression check
npx vitest run tests/integration/track-physics.test.ts
```

## Known Limitations / Future Work

1. **RaceSystem integration:** RaceSystem.js uses `track.isInCheckpoint()` which now has improved logic. No changes needed there - it automatically benefits from oriented gates.

2. **Frame-to-frame crossing detection:** Current implementation uses instant position checks. Future work could add frame history for more robust crossing detection (prevents double-triggers on slow frames).

3. **Oval tracks:** Currently use generated tangent but don't customize. Could optimize tangent calculation for oval geometry if needed.

4. **Performance:** Could add spatial acceleration (quadtree) if checkpoint checks become a bottleneck at high player counts (not expected with current architecture).

## Conclusion

✅ Checkpoint gate orientation fix is complete and validated.
- Oriented gates work correctly on curved procedural tracks
- Airborne/under-track vehicles correctly rejected
- All acceptance criteria met
- No regressions introduced
- Ready for fresh validation
