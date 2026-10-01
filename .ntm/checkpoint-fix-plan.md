# Checkpoint Gate Orientation Fix - Implementation Plan

## Problem Statement
Checkpoints are axis-aligned bounding boxes (AABBs) that:
1. Ignore Y-coordinate (height) → airborne/under-track cars trigger checkpoints
2. Don't use track tangent → curved procedural tracks cause missed/false triggers

## Solution Architecture

### Phase 1: Checkpoint Data Enrichment
**Goal:** Store tangent and height band for each checkpoint

#### Changes to ProceduralTrackGenerator.js (lines 212-223)
- For each checkpoint, compute the tangent as the direction between centerline points
- Store `tangent: {x, z}` (normalized 2D vector for track flow)
- Store `heightBand: {min, max}` for valid crossing height range
- Track width already available as `trackWidth`

```
checkpoint: {
  id, position, width,
  tangent: {x, z},           // NEW: track-flow direction
  heightBand: {min, max},    // NEW: Y coordinate range
  isFinishLine
}
```

#### Changes to Track.js _initCheckpoints()
- Preserve tangent and heightBand from config
- Store in checkpoint object for runtime use

### Phase 2: Checkpoint Crossing Logic
**Goal:** Detect if car crossed gate plane instead of AABB collision

#### Changes to Track.js isInCheckpoint() → checkCrossing()
Old behavior (simple box):
```javascript
const dx = Math.abs(position.x - cpPos.x);
const dz = Math.abs(position.z - cpPos.z);
return dx < halfWidth && dz < halfWidth;
```

New behavior (oriented gate):
1. Check Y is in heightBand: `position.y >= heightBand.min && position.y <= heightBand.max`
2. Check perpendicular distance to tangent line: 
   - Project car position onto checkpoint line
   - Measure distance perpendicular to tangent
   - Should be < checkpoint.width/2
3. For crossing detection (not just "in gate"), track frame-to-frame position:
   - Test if car moved from one side of the gate plane to the other
   - This requires frame history (previous position)

#### Implementation Path
1. Create a helper `checkpointGateDistance(position, checkpoint)` 
2. Create a helper `didCrossGate(prevPosition, currPosition, checkpoint)`
3. Update RaceSystem to track previous vehicle positions frame-to-frame

### Phase 3: Integration Points
**Goal:** Wire up new crossing logic without breaking existing callers

#### RaceSystem.js changes
- Update checkpoint crossing detection in update() method
- Use didCrossGate() instead of simple distance check
- Maintain checkpoint progress per vehicle

#### Test Coverage
- Oriented gate math (distance calculation, crossing detection)
- Height filtering (airborne rejection)
- Curved tracks with tangent-based gates
- Oval tracks (ensure backward compatibility)
- Bot following racing line crosses all checkpoints

## Files to Modify
1. static/js/resources/ProceduralTrackGenerator.js - Add tangent/height to checkpoints
2. static/js/entities/Track.js - Enhance checkpoint data and crossing logic
3. static/js/systems/RaceSystem.js - Use new crossing detection
4. tests/unit/checkpoint-gates.test.js - NEW: Unit tests for gate math
5. tests/integration/track-physics.test.ts - Updated: Sim tests with new logic

## Edge Cases to Handle
- Checkpoint at start of centerline (tangent = direction to second point)
- Height band: reasonable defaults for procedural tracks
- Curved tracks where cars might cross at oblique angles
- Oval tracks (uniform height, simple tangent handling)
- Repeated checkpoint crossing false-positives (frame history prevents this)

## Determinism Requirements
- Tangent calculation: deterministic from centerline (uses seed)
- Gate crossing: deterministic frame-to-frame (uses position deltas)
- No random/time-dependent logic in gate detection

## Evidence to Collect
1. Unit tests passing for gate orientation math
2. Bot driving race sim: crosses all checkpoints in order on curved track
3. Airborne test: car flying over checkpoint does NOT trigger it
4. Oval regression: oval track checkpoints still work correctly
5. Debug visualization of gate planes and crossing detection
