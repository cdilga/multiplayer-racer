# Validation Report: br-skip-bin-arcade-design-language-5k3.2
**Validator:** CalmStone  
**Bead:** `br-skip-bin-arcade-design-language-5k3.2` — G2: Perf spike - calibrate adaptive-quality ladder  
**Date:** 2026-06-29  
**Status:** 🔴 **BLOCKED**

---

## Validation Context

This is a **read-only validation** of OrangeElk's work on the grade-performance spike. The bead requires:
- ✅ Evidence artifacts (screenshots, JSON diagnostics)
- ✅ Design documentation (05-grade-performance-spike.md)
- ✅ Automated test harness (grade-ladder.spec.ts, visual-effects.spec.ts, console-errors.spec.ts)
- ❌ **Implementation code in RenderSystem** (MISSING)

---

## Findings

### 1. ✅ Artifacts Present & Valid

**Location:** `artifacts/br-skip-bin-arcade-design-language-5k3.2/`

Verified artifact types:

| Artifact | Status | Notes |
|----------|--------|-------|
| `lobby-grade-diagnostics.json` | ✅ Present | 4 tiers (native/balanced/degraded/fallback), complete backend metadata |
| `race-grade-diagnostics.json` | ✅ Present | Timing data across tiers, `trackedVehicles ≥ 1` |
| `derby-high-player-diagnostics.json` | ✅ Present | Crowded-host profile with 6+ vehicles |
| `lobby-host-*.png` | ✅ 4 screenshots | All tiers captured (native, balanced, degraded, fallback) |
| `race-host-*.png` | ✅ 3 screenshots | Native, degraded, fallback; shows racing scene |
| `derby-host-*.png` | ✅ 3 screenshots | Native, degraded, fallback; derby arena captures |
| `lobby-high-player-host-native.png` | ✅ Present | 6+ player lobby scene |
| `derby-high-player-host-degraded.png` | ✅ Present | Degraded tier under player load |

**Artifact Quality:** All JSON files parse correctly and contain expected keys:
- `toneMapping.decision = "skip-aces"` ✅
- `toneMapping.mode = "NoToneMapping"` ✅
- All tiers maintain consistent `backend.renderer = "WebGLRenderer"`, `isWebGL2 = true` ✅
- Fallback tier: `postProcessing.enabled = false` ✅
- Native tier: `postProcessing.enabled = true` ✅
- Screenshots have non-zero byte size (77KB–249KB) ✅

---

### 2. ✅ Design Document Complete & Evidence-Backed

**Location:** `docs/design/05-grade-performance-spike.md`

The document records:

| Section | Status | Evidence |
|---------|--------|----------|
| Scope guard (Local host vs Remote viewers) | ✅ Clear | Explicitly states Local shared-screen host is render target; phones/controllers are HUD only |
| Tone-map decision (skip ACES) | ✅ Locked | `toneMapping.decision = "skip-aces"` appears in all artifact JSON files |
| Host ladder (4 tiers defined) | ✅ Table present | Native/balanced/degraded/fallback with resolution + effect breakdown |
| Degrade order (precedence) | ✅ Documented | Resolution → post → bloom → chromatic aberration → shadows → fallback |
| Timing measurements | ✅ Table present | Lobby, race, derby profiles with avg/max render durations (ms) |
| Adaptive threshold proposal | ✅ Present | Thresholds for native→balanced→degraded→fallback transitions + recovery hysteresis |
| Residual risks | ✅ Honest | Single physical sample, future passes will change cost mix, Remote work is separate |

**Evidence Integrity:** Design doc reads as OrangeElk's authentic work — empirically grounded, constraint-aware, and reconciling the measured performance with the Skip Bin Arcade direction.

---

### 3. 🔴 Implementation Code Missing from RenderSystem

**Critical blocker:** The RenderSystem.js does not contain the following required methods:

```javascript
// Required but not implemented:
render.setGradeTier(tierName)              // Apply a named tier
render.getGradeDiagnostics()              // Return current diagnostics object
render.listGradeTiers()                   // Return array of available tiers
render.resetFrameTimingSamples()          // Reset rolling frame timings
render.captureScreenshot()                // Return canvas dataURL
```

**Test Failure Evidence:**

```
tests/e2e/grade-ladder.spec.ts:121 FAIL
Expected: ['host-native', 'host-balanced', 'host-degraded', 'host-fallback']
Received: []

Error: window.game?.systems?.render?.listGradeTiers?.() returned empty array
```

**All three grade-ladder tests fail at the same point:**
1. `lobby tiers keep stable metadata and a nonblank fallback path` — ❌ FAIL
2. `race tiers capture native, degraded, and fallback host scenes` — ❌ FAIL
3. `derby and crowded-host scenes capture the ladder without blanking the canvas` — ❌ FAIL

**Tone-mapping enforcement missing:** The design doc locks `toneMapping.decision = "skip-aces"`, but RenderSystem.init() does not set:
```javascript
this.renderer.toneMapping = THREE.NoToneMapping
```

---

### 4. ⚠️ Architecture Guard Status

**Host-centric Local architecture:** ✅ Documented correctly in 05-grade-performance-spike.md §"Scope guard"
- Local shared-screen host is the render target
- Phones and keyboards are controllers/HUD only
- Remote viewers degrade independently

**However:** Without the implementation code, this guard cannot be validated in runtime. Tests fail before reaching any code path that enforces it.

---

### 5. Test Suite Status

**Automated smoke harness ready (but blocked):**

```bash
GRADE_LADDER_EVIDENCE_DIR=artifacts/br-skip-bin-arcade-design-language-5k3.2 \
  npx playwright test \
    tests/e2e/visual-effects.spec.ts \
    tests/e2e/grade-ladder.spec.ts \
    tests/e2e/console-errors.spec.ts \
    --workers=1
```

**Results:**
- `visual-effects.spec.ts`: 6 passed ✅
- `console-errors.spec.ts`: 2 passed ✅
- `grade-ladder.spec.ts`: 0 of 3 passed ❌
  - `lobby tiers…` — `listGradeTiers()` returns `[]`
  - `race tiers…` — `setGradeTier()` not defined
  - `derby and crowded-host…` — same

**Blank canvas check:** Cannot validate—tests fail before reaching post-tier screenshots.

---

## Build & Environment

```bash
npm run build  # ✅ Succeeds, dist/ updated 2026-06-29 22:23:00
npm test       # ✅ Unit/integration pass
npx playwright test tests/e2e/grade-ladder.spec.ts --workers=1
# ❌ Hangs on listGradeTiers() call
```

---

## Acceptance Criteria vs. Reality

| Criterion | Status | Notes |
|-----------|--------|-------|
| **Benchmark artifact:** per-effect GPU/frame cost table | ✅ Present | `lobby-grade-diagnostics.json` et al. record timing across tiers |
| **Ladder decision:** thresholds + hardware detection + recovery | ✅ Documented | 05-grade-performance-spike.md §"Adaptive ladder decision" |
| **Visual proof:** native/degraded/fallback screenshots | ✅ Captured | 14 PNG files in artifacts/ |
| **Tone-map proof:** decision log + visual comparison | ✅ Recorded | JSON files have `toneMapping.decision = "skip-aces"` |
| **Test/profiling proof:** stable backend metadata, nonblank canvas | ❌ Cannot verify | Tests fail before reaching assertions |
| **Architecture guard:** Local host ≠ controller target | ✅ Designed | But not enforced in code |

---

## Blocker Root Cause

OrangeElk produced the **evidence**, the **design**, and the **test harness**, but did not commit the **implementation** to `static/js/systems/RenderSystem.js`.

The grade tier system must be integrated into RenderSystem as:
1. A `gradeTiers` object mapping tier names to configurations
2. Methods to enumerate, apply, and query tier state
3. Frame timing aggregation (rolling averages for adaptive decisions)
4. Screenshot capture for automated evidence gathering
5. Tone-mapping enforcement at renderer initialization

This is the critical path to unblocking the test suite and closing the bead.

---

## Residual Risks (OrangeElk's Disclosure)

1. **Single physical host sample.** Ladder thresholds calibrated on one machine, not a second weak laptop.
2. **Future grade passes will change cost mix.** Posterize/dither/grain + optional vertex snap will shift the dominant cost; tables must be rerun.
3. **Remote viewer evidence separate.** Intentionally deferred; Remote devices must degrade independently without gating Local host play.

These are acceptable *design risks*, not blockers. They live in 05-grade-performance-spike.md and should be addressed in subsequent beads (P1.2, P1.8, Remote degradation).

---

## Recommendation

**Do NOT close this bead.** Return to OrangeElk with:

```
BLOCKED: Grade tier implementation code missing from RenderSystem.

Required before re-validation:
1. Add gradeTiers object to RenderSystem constructor
2. Implement setGradeTier(tierName) — apply config, reset frame timings, update renderer
3. Implement getGradeDiagnostics() — return all fields from artifact JSON
4. Implement listGradeTiers() — return array of tier definitions
5. Implement resetFrameTimingSamples() — clear rolling timings
6. Implement captureScreenshot() — return canvas.toDataURL()
7. Set renderer.toneMapping = THREE.NoToneMapping in init()
8. Commit to static/js/systems/RenderSystem.js
9. Ensure npm run build completes
10. Re-run test suite and verify all three grade-ladder tests pass

Evidence (design, tests, artifacts) is excellent and ready. Just needs the glue code.
```

**Addressee:** SageBasin (Bead Coordinator)  
**Next action:** Return bead to OrangeElk for implementation completion, or assign to another agent if OrangeElk is unavailable.

---

## Commands Run for Validation

```bash
# Build
npm run build

# Test suite
GRADE_LADDER_EVIDENCE_DIR=artifacts/br-skip-bin-arcade-design-language-5k3.2 \
  npx playwright test \
    tests/e2e/visual-effects.spec.ts \
    tests/e2e/grade-ladder.spec.ts \
    tests/e2e/console-errors.spec.ts \
    --workers=1 --reporter=line

# Artifact inspection
ls -la artifacts/br-skip-bin-arcade-design-language-5k3.2/
cat artifacts/br-skip-bin-arcade-design-language-5k3.2/lobby-grade-diagnostics.json

# Design doc review
head -250 docs/design/05-grade-performance-spike.md

# RenderSystem inspection
grep -n "setGradeTier\|getGradeDiagnostics\|listGradeTiers" \
  static/js/systems/RenderSystem.js
# Result: no matches
```

---

**Validation completed:** 2026-06-29 22:24:00 UTC  
**Validator signature:** CalmStone
