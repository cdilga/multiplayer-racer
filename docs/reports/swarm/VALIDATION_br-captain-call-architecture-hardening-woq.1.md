# Validation Report: br-captain-call-architecture-hardening-woq.1

**Validator**: CloudCoder  
**Bead**: br-captain-call-architecture-hardening-woq.1 (ARCH math kernel for spawn, map, and camera guarantees)  
**Assignee**: SnowyAnchor  
**Date**: 2026-06-30  
**Decision**: 🟢 **PASS**

---

## Executive Summary

The geometry kernel is a pure, deterministic math layer for spatial reasoning across spawn generation, map validation, track frames, camera grouping, and checkpoint gates. All acceptance criteria are satisfied:

✅ **8/8 unit tests pass** — Frame derivation, oriented gates, hashes, diagnostics, purity guard  
✅ **Zero purity violations** — No Date.now, performance.now, Math.random, window, document, or THREE.js  
✅ **Diagnostic artifacts locked** — Valid and invalid fixture bundles demonstrate schema and error codes  
✅ **Public API complete** — 19 exports covering frames, gates, spawns, hashing, validation  
✅ **Build succeeds** — Geometry kernel bundles with host render system  

---

## Validation Tests

### ✅ Unit Tests: PASS (8/8)

```bash
$ npx vitest run tests/unit/geometry-kernel.test.js
✓ 8 passed (13ms)
```

**Test Coverage**:
1. ✅ `canonicalizeLoop` — CW→CCW conversion, signed area computation
2. ✅ `deriveTrackFrames` — Tangent/normal derivation, arc length computation  
3. ✅ `deriveEdgesFromFrames` — Left/right offset calculation
4. ✅ `makeOrientedGate` — Gate orientation from frame tangent/normal
5. ✅ `containsPointInGate` — Point-in-gate membership test
6. ✅ `segmentCrossesGate` — Line segment / gate crossing detection
7. ✅ `hashGeometryBundle` — Stable hashing with key ordering and quantization
8. ✅ Purity guard — No forbidden tokens, runs without browser globals

---

### ✅ Purity Scan: PASS

**Forbidden Pattern Check**:
```bash
$ grep -n "Date.now\|performance.now\|Math.random\|window\|document\|THREE\|createElement\|appendChild\|innerWidth\|innerHeight" static/js/geometry/*.js
[No matches found]
```

**Purity Guard Test**:
```javascript
it('imports and executes without browser globals', async () => {
    expect(globalThis.window).toBeUndefined();
    expect(globalThis.document).toBeUndefined();
    
    const geometryKernel = await import('../../static/js/geometry/GeometryKernel.js');
    expect(geometryKernel.hashGeometryBundle({ a: 1 })).toMatch(/^[0-9a-f]{8}$/);
    expect(geometryKernel.buildGeometryDiagnostics({ centerline: [] }).schema).toBe('geometry-kernel/v1');
});
```

**Result**: ✅ PASS — Kernel executes in Node.js environment (no browser needed)

---

### ✅ Build: PASS

```bash
$ npm run build
✓ built in 5.59s
```

Geometry kernel compiles and bundles with main host render system.

---

## Diagnostic Artifacts

### Valid Spawn Set: `tests/unit/fixtures/geometry-kernel-valid.json`

**Input**: 3-spawn octagon track (spawn-a, spawn-b, spawn-c)
- Centerline: 8-point octagon (CCW when canonical)
- Spawns: Evenly spaced (24m apart)
- Support: All solid ground
- Clearance: 3.5m, 3.2m, 3.1m (all ≥ 2m min)
- Constraints: minPairDistance=10, minClearance=2, requireSupport=true

**Output Schema** (excerpt):
```json
{
  "schema": "geometry-kernel/v1",
  "valid": true,
  "failures": [],
  "geometryHash": "a87c794f",
  "winding": "ccw",
  "frames": {
    "count": 8,
    "closed": true,
    "degenerateIndices": [],
    "totalLength": 200
  },
  "gates": [
    {
      "id": "finish",
      "center": { "x": 40, "y": 0, "z": 0 },
      "tangent": { "x": 0, "y": 0, "z": 1 },
      "normal": { "x": -1, "y": 0, "z": 0 },
      "width": 18,
      "depth": 4,
      "isFinishLine": true
    }
  ],
  "pairwiseDistances": [
    { "aId": "spawn-a", "bId": "spawn-b", "distance": 24 },
    { "aId": "spawn-a", "bId": "spawn-c", "distance": 48 },
    { "aId": "spawn-b", "bId": "spawn-c", "distance": 24 }
  ],
  "spawns": [
    {
      "id": "spawn-a",
      "position": { "x": -24, "y": 1.5, "z": -10 },
      "valid": true,
      "minPairDistance": 24,
      "nearestSpawnId": "spawn-b",
      "clearance": 3.5,
      "support": { "hit": true, "y": 0, "normal": { "x": 0, "y": 1, "z": 0 } },
      "reasons": []
    }
  ]
}
```

**Analysis**: All spawns pass all constraints; `failures` array is empty; `valid=true`

---

### Invalid Spawn Set: `tests/unit/fixtures/geometry-kernel-invalid.json`

**Input**: 2-spawn degenerate square (spawn-0, spawn-1)
- Centerline: 4-point quadrilateral with duplicate first point
- Spawns: Only 3m apart (below 8m minimum)
- Support: spawn-0 has no ground hit; spawn-1 has ground
- Clearance: 0.5m and 1.2m (both below 2m minimum)
- Constraints: minPairDistance=8, minClearance=2, requireSupport=true

**Output Schema** (excerpt):
```json
{
  "schema": "geometry-kernel/v1",
  "valid": false,
  "failures": [
    { "code": "gate_frame_missing", "gateId": "broken-gate", "frameIndex": 10 },
    { "code": "gate_degenerate", "gateId": "broken-gate", "width": 0, "depth": 0 },
    { "code": "support_missing", "spawnId": "spawn-0", "expected": true, "actual": false },
    { "code": "clearance_below_min", "spawnId": "spawn-0", "minimum": 2, "actual": 0.5 },
    { "code": "pair_distance_below_min", "spawnId": "spawn-0", "nearestSpawnId": "spawn-1", "minimum": 8, "actual": 3 },
    { "code": "clearance_below_min", "spawnId": "spawn-1", "minimum": 2, "actual": 1.2 },
    { "code": "pair_distance_below_min", "spawnId": "spawn-1", "nearestSpawnId": "spawn-0", "minimum": 8, "actual": 3 }
  ],
  "spawns": [
    {
      "id": "spawn-0",
      "valid": false,
      "minPairDistance": 3,
      "reasons": [
        { "code": "support_missing", "spawnId": "spawn-0", "expected": true, "actual": false },
        { "code": "clearance_below_min", "spawnId": "spawn-0", "minimum": 2, "actual": 0.5 },
        { "code": "pair_distance_below_min", "spawnId": "spawn-0", "nearestSpawnId": "spawn-1", "minimum": 8, "actual": 3 }
      ],
      "support": { "hit": false, "y": null, "normal": null }
    }
  ]
}
```

**Analysis**:
- Gate failures: Frame index 10 doesn't exist; gate has 0 width/depth (degenerate)
- Spawn-0 failures: No support, clearance too low, too close to spawn-1
- Spawn-1 failures: Clearance too low, too close to spawn-0
- `failures` array lists all issues; `valid=false`; per-spawn `reasons` enable targeted debugging

---

## Public API Review

### ✅ Core API: 19 Exports

| Function | Purpose | Consumer |
|----------|---------|----------|
| `canonicalizeLoop(points)` | Removes closing duplicate, computes signed area, returns CCW canonical | ProceduralTrackGenerator |
| `deriveTrackFrames(centerline, options)` | Produces tangent/normal/arc-length frames for each centerline sample | ProceduralTrackGenerator, Track |
| `deriveEdgesFromFrames(frames, halfWidth)` | Computes left/right boundary offsets from frame normals | ProceduralTrackGenerator |
| `makeOrientedGate(frame, options)` | Builds checkpoint gate with proper tangent/normal orientation | Track, checkpoint system |
| `containsPointInGate(point, gate)` | Point-in-gate membership (local tangent/normal coords) | Lap counting, gates |
| `segmentCrossesGate(start, end, gate)` | Segment/gate crossing for checkpoint detection | Lap counting |
| `projectPointToGate(point, gate)` | Projects point to gate-local coordinates (lateral/longitudinal) | Debug overlay, gate visualization |
| `measurePairwiseSpawnDistances(spawns)` | All pairwise spawn distances and nearest-neighbor metrics | Spawn validation, diagnostics |
| `normalizeSupportHit(rawHit)` | Normalizes physics raycast/support into stable shape | Spawn validation |
| `validateSpawnSet(spawns, constraints)` | Scores spawns against minDistance, minClearance, requireSupport; returns failure codes | Spawn generation, map validator |
| `hashGeometryBundle(bundle, options)` | Stable 8-char hash with key ordering and float quantization | Reproducibility, caching |
| `buildGeometryDiagnostics(input)` | Master diagnostic artifact (frames, gates, spawns, failures) | Tests, map validator, debug overlay |
| `stableCanonicalize(value, options)` | Deterministic canonicalization (sorted keys, quantized floats) | Hashing, diagnostics |
| `stableStringify(value, options)` | Stringification with canonicalization | Hashing |
| `quantizeNumber(value, decimals)` | Float quantization for stable comparison | All numeric values |
| `signedArea2D(points)` | Signed area computation on X/Z plane | Winding detection |
| + Constants: `EPSILON`, `HASH_DECIMALS`, `DEFAULT_UP`, `DEFAULT_GATE_DEPTH` |

---

## Code Quality

### ✅ Architecture: Event-Driven Functional

- **No side effects**: All functions are pure; no state mutation
- **Deterministic**: Same inputs → same outputs (no randomness, no clock)
- **Serializable**: Input/output are plain JSON (no objects with methods)
- **Composable**: Functions chain logically (frames → edges → gates → validation)

### ✅ Defensive Coding

- **Sanitization**: `sanitizeNumber()` fallbacks for NaN/Infinity
- **Epsilon tolerance**: Floating-point comparisons use `EPSILON = 1e-9`
- **Degenerate detection**: Tracks zero-tangent frames, degenerate loops, zero-area gates
- **Guard clauses**: Early returns for empty arrays, null/undefined inputs

### ✅ Constants

```javascript
const EPSILON = 1e-9;           // Floating-point tolerance
const HASH_DECIMALS = 6;        // Float quantization decimals
const DEFAULT_GATE_DEPTH = 4;   // Checkpoint depth if unspecified
const DEFAULT_UP = {x:0, y:1, z:0}; // World up vector
```

All constants are immutable (`Object.freeze`)

---

## Consumer Boundaries

**This Bead Owns**:
- Pure geometry/math API
- Diagnostic artifact schema
- Evidence fixtures
- Unit tests

**Downstream Beads Own**:
- `ProceduralTrackGenerator` — Uses frames, edges, spawns in centerline derivation
- `Track` — Uses oriented gates instead of world-axis box checks
- `spawn generation (br-fb-spawncap-qi9)` — Uses validateSpawnSet, diagnostic failures
- `map validator (br-fb-mapvalid-allmodes-n47)` — Uses full diagnostic bundle
- `camera clustering (br-captain-call-architecture-hardening-woq.7)` — Uses frame math for camera fit
- `GameHost` — Uses diagnostics for fail-loud validation reporting
- `debug overlay` — Consumes diagnostic schema for visualization

---

## Edge Cases Tested

✅ **Frame Derivation**:
- Closed loops (octagon) — Handles circular wrapping
- Open polylines — Handles endpoints without wraparound
- Degenerate frames (duplicate points) — Detected and flagged
- Single/two-point inputs — Returns empty frames array gracefully

✅ **Gate Orientation**:
- Frame with no normal — Uses basis normal from tangent
- Gate spanning width — Computed correctly (±halfWidth from center)
- Height band tests — Optional; null returns true for all heights

✅ **Spawn Validation**:
- No spawns — Returns empty validation
- Single spawn — No pairwise distances (nothing to compare)
- Missing support — Flagged with `support_missing` code
- Below clearance — Flagged with `clearance_below_min` code
- Insufficient distance — Flagged with `pair_distance_below_min` code

✅ **Hashing**:
- Key reordering — Hash is identical regardless of object key order
- Float noise — 1e-7 differences are quantized away (HASH_DECIMALS=6)
- Negative zero — Normalized to positive zero

✅ **Purity**:
- Execution in Node.js (no browser) — Success
- No forbidden tokens — Pass (grep for Date.now, window, etc.)

---

## Residual Risks

### 🟢 LOW

1. **Float quantization precision** (HASH_DECIMALS=6)
   - Sufficient for geometry (0.000001 unit precision)
   - Track frames are typically at meter scale
   - Unlikely to cause collision detection drift

2. **Epsilon tolerance choice** (1e-9)
   - Standard for graphics applications
   - May need empirical tuning if physics behavior changes
   - Mitigation: Built into constants; adjustable if needed

3. **Segment/gate crossing logic**
   - Assumes planar XZ reasoning (ignores Y except for height band)
   - Correct for lap counting on track surfaces
   - May not work for 3D environments (mitigated by design)

4. **Support normalization**
   - Expects physics system to provide `hit`, `y`, `normal` or `point`
   - Gracefully degrades (normalizes to `hit=false` if missing)
   - Consumers must provide format-compatible raycast results

### 🟡 MEDIUM

5. **No validation of consumer input schemas**
   - GeometryKernel trusts frameIndex, spawn positions, gate specs are sensible
   - Invalid frameIndex silently creates gate at origin (caught by diagnostics)
   - Mitigation: Diagnostics clearly report failures

6. **Determinism edge case: Map seed**
   - Kernel is deterministic; ProceduralTrackGenerator seed reproducibility depends on upstream
   - Out of scope for this bead; tracked by map validator bead

---

## Fixture Files

✅ **`tests/unit/fixtures/geometry-kernel-valid.json`** (2,763 bytes)
- Maps to `VALID_INPUT` in test
- Demonstrates a pass: all spawns valid, no failures, geometry hash stable

✅ **`tests/unit/fixtures/geometry-kernel-invalid.json`** (3,419 bytes)
- Maps to `INVALID_INPUT` in test
- Demonstrates failures: multiple spawn issues, gate degenerate, machine-readable error codes

Both fixtures are generated by `buildGeometryDiagnostics()` and locked in tests to ensure schema stability.

---

## Acceptance Criteria Checklist

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Unit tests (frame, gate, winding, hash, diagnostics) | ✅ PASS | 8/8 tests pass (13ms) |
| Purity (no Date.now, performance.now, Math.random, window, DOM, THREE.js) | ✅ PASS | Grep scan + purity guard test |
| API artifact (documented consumption boundaries) | ✅ PASS | docs/contracts/geometry-kernel.md + 19 exports |
| Evidence artifact (valid spawn set) | ✅ PASS | tests/unit/fixtures/geometry-kernel-valid.json |
| Evidence artifact (invalid spawn set) | ✅ PASS | tests/unit/fixtures/geometry-kernel-invalid.json |
| Sequencing guard (API closed; consumer adoption separate) | ✅ PASS | Downstream beads (br-fb-spawncap-qi9, br-fb-mapvalid-allmodes-n47, br-captain-call-architecture-hardening-woq.7) are separate |

---

## Summary

The geometry kernel is a **pure, deterministic, well-tested math layer** that centralizes spatial reasoning for spawn validation, track frames, checkpoints, and diagnostics. It:

✅ Passes all 8 unit tests  
✅ Has zero purity violations  
✅ Provides machine-readable diagnostic failures  
✅ Locks schema with checked-in fixture artifacts  
✅ Chains cleanly to downstream consumer beads  

**No architectural or implementation blockers.** The bead is ready for downstream adoption.

---

**Validation by**: CloudCoder (Claude Code)  
**Completed**: 2026-06-30 07:21 UTC  
**Decision**: 🟢 **PASS**
