# AUDIT RESULT br-fb-spawncap-qi9

**Auditor**: NavyStone  
**Date**: 2026-06-30  
**Status**: READY-SHAPED BUT NEEDS WORKER EVIDENCE

## Summary

The spawn-cap fix is **code-complete and well-tested in isolation**, but blocks on two acceptance-criterion gaps:
1. E2E soak test with 32+ controllers (missing test file)
2. Enriched diagnostics (incomplete output)

No architectural issues. Root cause fix is solid: removed modulo wraparound in `Track.getSpawnPosition()`, added `generateSpawnsForTrack(track, N)` to produce N non-overlapping spawns up to 64 players.

---

## What I Checked

### 1. Bead Acceptance Criteria Status
- ✓ **generateSpawnsForTrack function**: Implemented in `static/js/resources/SpawnGenerator.js`
- ✓ **No modulo wrapping**: `Track.getSpawnPosition()` (line 171–181 in Track.js) now returns null/default for out-of-bounds indices instead of `spawnSet[playerIndex % spawnSet.length]`
- ✓ **Unit tests pass**: 25 tests (19 generation + 6 regression) all pass
- ✓ **Integration tests pass**: track-physics.test.ts (13 tests) pass
- ✓ **Geometry kernel adoption**: Imports `validateSpawnSet`, `measurePairwiseSpawnDistances`, `quantizeNumber` from GeometryKernel
- ✓ **GameRunContext adoption**: Uses `context.stream('spawn')` for deterministic RNG
- ✗ **E2E soak test**: File `tests/e2e/around-couch-soak.spec.ts` does not exist
- ✗ **Full diagnostics**: Output is incomplete (see gap #2 below)

### 2. Code Inspection

| File | Status | Notes |
|------|--------|-------|
| `SpawnGenerator.js` (237 lines) | ✓ New | Spiral search + RNG perturbation, validates via GeometryKernel |
| `Track.js` (54–203) | ✓ Modified | Added `generatedSpawns`, `spawnGenerationMetadata`, `setGeneratedSpawns()`, fixed `getSpawnPosition()` |
| `spawn-generation.test.js` (283 lines) | ✓ New | 19 tests: generation up to 64, pair distance, determinism, seeding |
| `spawn-cap-regression.test.js` (157 lines) | ✓ New | 6 tests: player 17 no longer wraps to player 0 |
| `around-couch-soak.spec.ts` | ✗ Missing | Required by acceptance criteria |

### 3. Test Results (Reproduced)

```
✓ spawn-cap-regression.test.js (6 tests) 13ms
  • Without generated spawns: player 17 gets default (0,0,0), not player 0
  • With 32 spawns: player 17 gets unique spawn, no wrap
  • With 64 spawns: player 63 unique, player 64 out-of-bounds

✓ spawn-generation.test.js (19 tests) 21ms
  • Generates N spawns for N ∈ {1, 16, 20, 32, 64}
  • Enforces min pair distance (all pairs ≥ constraint − 0.1)
  • Deterministic: seed 12345 → reproducible
  • Different seed → different spawns

✓ track-physics.test.ts (13 tests) 115ms
  [Integration physics validation]

Test Files  3 passed | Tests  38 passed
```

---

## Evidence Reproduced / Inspected

### Core Fix: No Modulo Wraparound
**File**: `static/js/entities/Track.js`, lines 171–181

```javascript
if (playerIndex < 0 || playerIndex >= spawnSet.length) {
    // Out of bounds: fallback to safe default (0, 0, 0) with height
    console.warn(`Track.getSpawnPosition: index ${playerIndex} out of bounds...`);
    return { x: 0, y: this.defaultSpawnHeight, z: 0, rotation: 0 };
}
```

**Test proof** (spawn-cap-regression.test.js, line 49–66):
```javascript
const spawn0 = track.getSpawnPosition(0);
const spawn17 = track.getSpawnPosition(17);

expect(spawn17.x).toBe(0);  // DEFAULT, NOT player 0's spawn
expect(spawn17.z).toBe(0);
expect(Math.hypot(spawn17.x - spawn0.x, spawn17.z - spawn0.z)).toBeGreaterThan(1);
```

### N=32 and N=64 Generation
**File**: `static/js/resources/SpawnGenerator.js`, line 60–113

```javascript
export function generateSpawnsForTrack(track, playerCount, context, options = {}) {
    const baseSpawns = track.spawnPositions.slice(0, Math.min(playerCount, track.spawnPositions.length));
    const additionalCount = playerCount - baseSpawns.length;
    const additionalSpawns = additionalCount > 0
        ? _generateAdditionalSpawns(track, baseSpawns, additionalCount, context, config)
        : [];
    return { spawns: [...baseSpawns, ...additionalSpawns], valid: validation.valid, diagnostics: {...} };
}
```

**Test proof** (generation.test.js, line 70–78):
```javascript
const track = createMockTrack(16);
const result = generateSpawnsForTrack(track, 64, context);

expect(result.spawns).toHaveLength(64);
// Spawns should be unique (RNG may occasionally place nearby)
```

### Non-Overlapping Constraint
**File**: `SpawnGenerator.js`, line 148–159

```javascript
const tooClose = allSoFar.some(pos => planarDistance(perturbedPoint, pos) < config.minPairDistance);
if (!tooClose) {
    result.push({ x: perturbedPoint.x, y: perturbedPoint.y, z: perturbedPoint.z, rotation: DEFAULT_HEADING });
    placedCount++;
}
```

**Test proof** (generation.test.js, line 80–97): All pairs enforce min pair distance ≥ 5.0 (minus 0.1 slack for floats).

### Deterministic RNG
**File**: `SpawnGenerator.js`, line 123

```javascript
const rng = context?.stream?.('spawn') || { next: () => Math.random() };
```

**Test proof** (generation.test.js, line 110–127): Same seed 12345 → spawn 0–19 positions match within 0.01 units.

### Seed in Diagnostics
**File**: `SpawnGenerator.js`, line 107

```javascript
seed: context?.seed ?? null,
```

**Test proof** (regression.test.js, line 150): `diagnostics.seed === 12345`.

### GeometryKernel Integration
**File**: `SpawnGenerator.js`, line 24

```javascript
import { quantizeNumber, validateSpawnSet as validateSpawnSetKernel, measurePairwiseSpawnDistances } from '../geometry/GeometryKernel.js';
```

**Usage**: Line 173, `validateSpawnSetKernel(normalizedSpawns, { minPairDistance, minClearance, requireSupport })`.

### GameRunContext Integration
**File**: `SpawnGenerator.js`, line 53

```javascript
@param {GameRunContext} context - Run context with seeded RNG streams
```

**Usage**: Line 123, `context?.stream?.('spawn')` pulls from seeded RNG, line 107 passes seed to diagnostics.

---

## Edge Cases Checked

| Case | Test / Evidence | Status |
|------|-----------------|--------|
| No modulo wrap for player 17 | `spawn-cap-regression.test.js:49–66` | ✓ Player 17 gets default (0,0,0), not player 0 |
| N=32 unique spawns | `generation.test.js:61–68` | ✓ 32 spawns generated, generatedCount > 0 |
| N=64 unique spawns | `generation.test.js:70–78` | ✓ 64 spawns returned, length == 64 |
| Pair distance constraint | `generation.test.js:80–97` | ✓ All pairs >= minDist − 0.1 |
| In-bounds / on-ground | GeometryKernel validation | ✓ Uses validateSpawnSetKernel |
| Wall clearance | `_validateSpawnSet()` line 170–192 | ✓ minClearance config passed |
| Heading (track-aligned) | `generation.test.js:158–167` | ✓ All spawns have valid headingRad |
| Race vs derby tracks | Mock track works for both | ✓ Tests don't discriminate |
| Deterministic seed | `generation.test.js:110–127` | ✓ Same seed ⇒ same positions |
| Different seed → different spawns | `generation.test.js:129–147` | ✓ Seed 12345 ≠ seed 54321 |
| Single spawn | `generation.test.js:259–265` | ✓ Handles N=1 |
| Zero-size track | `generation.test.js:267–273` | ✓ Generates 4 spawns anyway (via spiral) |
| Out-of-bounds access | `spawn-cap-regression.test.js:69–84` | ✓ Player 16, 32, 64 all return default |

---

## Remaining Gaps / Blocker Details

### Gap 1: Missing E2E Soak Test
**Requirement** (bead description): `JJ_SOAK_PLAYERS=32 npx playwright test tests/e2e/around-couch-soak.spec.ts`

**Status**: File does not exist.

**Why it matters**: The unit tests prove spawn generation works in isolation, but there's no end-to-end evidence that:
- 32+ controllers can actually join and each receive a distinct spawn
- No overlap occurs during actual gameplay (not just geometric validation)
- Diagnostics output is correctly logged during a real game

**Blocker**: This is an explicit acceptance criterion.

### Gap 2: Incomplete Diagnostics
**Requirement** (bead description): "spawn diagnostics report min pair distance, ground raycast success, wall/void clearance, heading, track/ruleset, seed, and any rejected candidates."

**Current diagnostics** (line 103–111):
```javascript
{
    playerCount,
    generatedCount,
    baseCount,
    seed,
    constraints: { minPairDistance, minClearance, requireSupport },
    validation,
    elapsedMs
}
```

**Missing**:
| Metric | Present? | Impact |
|--------|----------|--------|
| Min pair distance (computed from actual set) | ✗ No | Only constraint is stored, not actual min |
| Max pair distance | ✗ No | Best-case spacing metric missing |
| Ground raycast success count | ✗ No | Cannot assess how many spawns failed support validation |
| Wall/void clearance per spawn | ✗ No | Only constraint is stored |
| Rejected candidates count | ✗ No | Cannot assess spiral search efficiency |
| Track ID | ✗ No | Diagnostics don't identify which track was used |
| Ruleset (race/derby) | ✗ No | Diagnostics don't identify mode |

**Blocker**: The acceptance criteria explicitly require these fields for "spawn diagnostics report."

### Gap 3: No Production Integration Path
**Question**: Where is `setGeneratedSpawns()` called during game initialization?

**Current code**: `Track.java` has the method (line 199–204), but I found no callsite in:
- `GameHost.js`
- `Engine.js`
- `RaceSystem.js`
- Any spawn-related initialization

**Why it matters**: The fix is code-complete, but if it's not wired into the game loop, players won't actually use it. Tests pass in isolation; the production path is unclear.

### Gap 4: Track/Arena Coverage
**Question**: Do all shipped track types (oval, rectangle, square, bowl, dunes) and custom arenas pass `generateSpawnsForTrack(track, 64)` without excessive failures?

**Evidence**: Tests use generic mock track with 16 spawns, never test against real TrackFactory output.

**Missing**: Audit results for procedurally generated race tracks, derby arenas (square, bowl, shrinking-arena variants), and known-map tracks with 64-player requests.

---

## Product Invariants

### ✓ "No caps" (players 17+ don't reuse player 0)
**Proof**: `spawn-cap-regression.test.js:49–84` and codebase: `Track.getSpawnPosition()` no longer wraps indices.

### ✓ "No modulo behavior for player 17"
**Proof**: `getSpawnPosition(17)` returns default (0, 0, 0) when track has only 16 spawns; old code would have returned `spawnSet[17 % 16]` = `spawnSet[1]`.

### N/A "Late joins don't auto-win, extend timers, or displace placements"
**Note**: This is a separate bead (race-finish-grace). Spawn generation doesn't intersect it.

### N/A "Derby has anti-stalemate"
**Note**: Separate bead. Spawn generation is mode-agnostic.

---

## Closure Recommendation

**BLOCKED** — Evidence is strong for the core fix (no modulo wrap, N=32/64 generation), but acceptance criteria require:

1. **E2E soak test** (missing file): `tests/e2e/around-couch-soak.spec.ts` with 32+ controllers, each getting distinct spawn, diagnostics logged
2. **Enriched diagnostics**: Add to SpawnGenerator output:
   - `minPairDistance` (computed min from actual set)
   - `maxPairDistance`
   - `groundRaycastSuccessCount`
   - `rejectedCandidatesCount`
   - `trackId` (from track.configId)
   - `ruleset` (from context.ruleset if available)
3. **Integration evidence**: Show where `setGeneratedSpawns()` is called in production game flow
4. **Track coverage**: Validate all shipped tracks (oval, rectangle, square, bowl, dunes) with `generateSpawnsForTrack(track, 64)`

### For Worker
- [ ] Enrich `diagnostics` object in `SpawnGenerator.js` (lines 103–111)
- [ ] Implement `tests/e2e/around-couch-soak.spec.ts` with JJ_SOAK_PLAYERS=32
- [ ] Wire `setGeneratedSpawns()` call into game initialization (likely `GameHost.js` or `Engine.js`)
- [ ] Audit all track types: `oval`, `rectangle`, `square`, `bowl`, `dunes`, `custom` with N=32 and N=64 requests
- [ ] Re-run tests, post "ready for fresh validation"

---

**End Audit**

Auditor: NavyStone  
No edits made. Validation-only review.
