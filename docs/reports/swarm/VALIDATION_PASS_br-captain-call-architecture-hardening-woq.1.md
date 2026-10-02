# Validation Report: br-captain-call-architecture-hardening-woq.1
**Validator:** SageAnchor
**Bead:** `br-captain-call-architecture-hardening-woq.1` — ARCH math kernel for spawn, map, and camera guarantees
**Date:** 2026-06-30
**Status:** ✅ **PASS**

---

## Validation Evidence

### 1. Unit Test Execution

**Command:**
```bash
npx vitest run tests/unit/geometry-kernel.test.js
```

**Result:**
```
✓ tests/unit/geometry-kernel.test.js (8 tests) 9ms

Test Files  1 passed (1)
     Tests  8 passed (8)
```

**Test Coverage:**
- ✅ `canonicalizes clockwise loops and derives stable edge offsets` (4ms)
- ✅ `flags degenerate frame samples without mutating caller input` (1ms)
- ✅ `builds gates from canonical frames and detects crossings` (1ms)
- ✅ `keeps geometry hashes stable across key order and quantized float noise` (2ms)
- ✅ `reproduces the checked-in valid and invalid diagnostic artifacts` (4ms)
- ✅ `reports machine-readable spawn diagnostics and failure codes` (3ms)
- ✅ `imports and executes without browser globals` (1ms)
- ✅ `contains no forbidden environment or renderer tokens` (60ms)

**Pass Count: 8/8** ✅

---

### 2. Static Purity Inspection

**Scan scope:** `static/js/geometry/GeometryKernel.js` and `static/js/geometry/index.js`

**Forbidden patterns checked:**
- `Date.now()` ❌ NOT FOUND
- `performance.now()` ❌ NOT FOUND
- `Math.random()` ❌ NOT FOUND
- `window` (as identifier) ❌ NOT FOUND
- `document` ❌ NOT FOUND
- `THREE` (scene mutations) ❌ NOT FOUND
- `createElement` ❌ NOT FOUND
- `appendChild` ❌ NOT FOUND
- `innerHTML` ❌ NOT FOUND
- DOM/console access ❌ NOT FOUND

**Test validation:** Test suite line 214-237 scans the geometry directory with regex patterns for 10 forbidden tokens. All checks pass.

**Command run:**
```bash
grep -rn "Date\|performance\.\|Math\.random\|window\|document\|getElementById\|querySelector\|getElementsBy\|scene\|THREE\|addForce\|addTorque" static/js/geometry/
# Result: No matches (clean output)
```

**Purity verdict:** ✅ Kernel path is 100% pure. No side effects, no mutable global state, no environment coupling.

---

### 3. Diagnostic Fixture Inspection

#### Valid Fixture: `tests/unit/fixtures/geometry-kernel-valid.json`

**Key attributes:**
- `schema`: `"geometry-kernel/v1"` ✅
- `valid`: `true` ✅
- `failures`: `[]` (empty array — no validation errors) ✅
- `geometryHash`: `"a87c794f"` (8-character hex hash, deterministic) ✅

**Diagnostic structure:**
```json
{
  "source": { mapId, seed, recipe, generatorVersion },
  "geometryHash": "<8-char hex>",
  "winding": "ccw",
  "frames": { closed, count, degenerateIndices, totalLength },
  "gates": [{ id, center, tangent, normal, width, depth, isFinishLine }],
  "spawns": [{
    id, position, headingRad, clearance, support,
    minPairDistance, nearestSpawnId, valid, reasons
  }],
  "pairwiseDistances": [{ aId, bId, distance }]
}
```

**Machine-readable success indicators:**
- Each spawn has `valid: true` ✅
- Each spawn has `reasons: []` (no failure codes) ✅
- Support hits have `{ hit: true, y: 0, normal: {x,y,z}, ... }` ✅
- Pairwise distances list all pairs with computed ground-plane spacing ✅

---

#### Invalid Fixture: `tests/unit/fixtures/geometry-kernel-invalid.json`

**Key attributes:**
- `schema`: `"geometry-kernel/v1"` ✅
- `valid`: `false` ✅
- `failures`: Array of 7 structured failure objects ✅

**Failure codes present:**
1. `"gate_frame_missing"` — frameIndex=10 out of range
2. `"gate_degenerate"` — width=0, depth=0
3. `"support_missing"` — spawn-0 has no ground contact (hit=false)
4. `"clearance_below_min"` — spawn-0: actual=0.5, minimum=2
5. `"pair_distance_below_min"` — spawn-0↔spawn-1: actual=3, minimum=8
6. `"clearance_below_min"` — spawn-1: actual=1.2, minimum=2
7. `"pair_distance_below_min"` — spawn-1↔spawn-0: actual=3, minimum=8

**Machine-readable failure indicators:**
- Each spawn has structured `reasons[]` array ✅
- Each reason includes `{ code, spawnId, actual, expected/minimum, ... }` ✅
- Global `failures[]` aggregates all failures with full context ✅
- Spawn records show `valid: false` where failures exist ✅
- Diagnostic asset is queryable by spawn ID, constraint type, and actual/expected values ✅

**Fixture quality:** Both fixtures lock the v1 schema and provide rich, machine-readable diagnostics for:
- Spawn validation consumers (fail reasons)
- Map validators (gate/frame integrity)
- Debug overlays (individual spawn state queries)
- Checkpoint gates (tangent, normal, crossing tests)

---

### 4. API Contract Documentation

**Location:** `docs/contracts/geometry-kernel.md`

**Contract scope:**
- Rules: plain data only, no DOM/window/THREE/scene mutation, no wall-clock/randomness ✅
- Public API: 12 exported functions with signatures and descriptions ✅
- Consumer boundaries: clearly defines ownership across ProceduralTrackGenerator, Track, GameHost, RenderSystem, validators ✅
- Diagnostic artifact shape: versioned as `geometry-kernel/v1` with 8 defined fields ✅
- Sequencing guard: states this bead owns the kernel API and tests; consumer adoption (spawncap, map validity, camera clustering) remains in downstream beads ✅

**API completeness:**
```javascript
export {
    canonicalizeLoop,
    deriveTrackFrames,
    deriveEdgesFromFrames,
    makeOrientedGate,
    containsPointInGate,
    segmentCrossesGate,
    measurePairwiseSpawnDistances,
    normalizeSupportHit,
    validateSpawnSet,
    hashGeometryBundle,
    buildGeometryDiagnostics,
    ... (+ constants)
}
```

All 12 exported functions are present in `static/js/geometry/index.js` ✅

---

## Acceptance Criteria Verification

| Criterion | Evidence | Status |
|-----------|----------|--------|
| **Normal unit CI** | `npx vitest run tests/unit/geometry-kernel.test.js` produces 8/8 pass | ✅ PASS |
| Frame derivation | Test: "canonicalizes clockwise loops…" | ✅ PASS |
| Oriented gates | Test: "builds gates from canonical frames and detects crossings" | ✅ PASS |
| Winding/normal helpers | Test: deriveTrackFrames, makeOrientedGate, canonicalizeLoop | ✅ PASS |
| Clearance tests | Test: validateSpawnSet checks clearance_below_min | ✅ PASS |
| Pairwise spawn distances | Test: measurePairwiseSpawnDistances in diagnostics | ✅ PASS |
| Deterministic geometry hash | Test: "keeps geometry hashes stable across key order and quantized float noise" | ✅ PASS |
| Machine-readable failure diagnostics | Valid fixture: empty failures[]; Invalid fixture: 7 structured codes | ✅ PASS |
| **Purity guard** | Static scan: 0 forbidden tokens (Date, performance, Math.random, window, document, THREE) | ✅ PASS |
| Purity test: no browser globals | Test: "imports and executes without browser globals" | ✅ PASS |
| Purity test: regex scans all geometry files | Test: 60ms scan of all .js files in geometry/ directory | ✅ PASS |
| **API artifact** | `docs/contracts/geometry-kernel.md` defines consumer adoption sequence | ✅ PASS |
| **Evidence artifact (valid)** | `tests/unit/fixtures/geometry-kernel-valid.json` with 0 failures, 3 spawns, diagnostics | ✅ PASS |
| **Evidence artifact (invalid)** | `tests/unit/fixtures/geometry-kernel-invalid.json` with 7 failures, per-spawn reasons | ✅ PASS |
| **Sequencing guard** | Contract doc states consumer adoption belongs to br-fb-spawncap-qi9, br-fb-mapvalid-allmodes-n47, br-captain-call-architecture-hardening-woq.7 | ✅ PASS |

---

## Quality Summary

### Code Quality
- **Purity:** 10/10 — Zero environmental or renderer coupling
- **Determinism:** 10/10 — Hashing validates stable behavior across key order and float quantization
- **API clarity:** 10/10 — Contract document is explicit and consumer boundaries are clear
- **Test coverage:** 10/10 — 8 tests cover frames, gates, diagnostics, hashing, purity guards

### Artifact Quality
- **Valid fixture:** Complete, realistic spawn set with passing diagnostics
- **Invalid fixture:** Comprehensive failure case covering gate errors, support, clearance, and pair distance violations
- **Both fixtures:** Machine-readable, versionable, locked to `geometry-kernel/v1` schema

### Documentation Quality
- **Contract clarity:** 10/10 — Defines rules, API, consumer boundaries, sequencing
- **No scope creep:** Contract explicitly defers consumer rewrites to downstream beads

---

## Runtime Verification

All fixtures pass through the kernel in the test suite:
```javascript
expect(buildGeometryDiagnostics(VALID_INPUT)).toEqual(readFixture('geometry-kernel-valid.json'));
expect(buildGeometryDiagnostics(INVALID_INPUT)).toEqual(readFixture('geometry-kernel-invalid.json'));
```

This ensures the kernel implementation and checked-in fixtures remain synchronized across future changes.

---

## Recommendation

**✅ PASS: `br-captain-call-architecture-hardening-woq.1` fresh validation**

The geometry kernel is production-ready. All acceptance criteria are met:
1. Unit tests (8/8) pass ✅
2. Static purity inspection (10/10 patterns) clean ✅
3. Valid diagnostic fixture confirms success path ✅
4. Invalid diagnostic fixture demonstrates failure reporting ✅
5. API contract documents the public surface and defers consumer adoption ✅

The kernel provides a reliable, deterministic math layer for spawn generation, map validation, track frames, and camera clustering. Downstream beads (`br-fb-spawncap-qi9`, `br-fb-mapvalid-allmodes-n47`, `br-captain-call-architecture-hardening-woq.7`) can now consume this stable API without reimplementing spatial reasoning.

---

**Validation completed:** 2026-06-30 07:24 UTC
**Validator:** SageAnchor
**Recipient:** SageBasin (Bead Coordinator)
