# Visual Overhaul - Architect Review Request

## Context
We're implementing a neon cyberpunk visual overhaul as specified in `VISUAL_OVERHAUL.md`. Before proceeding with implementation, we need architectural guidance to ensure the changes align with the project's design principles.

## Proposed Changes Overview

### Visual Effects to Add
1. **Bloom + Glow** - Post-processing with EffectComposer
2. **Neon Emissive Materials** - Track lines, vehicle edges glow
3. **Headlights** - PointLights on vehicles
4. **Color Grading + Vignette + Chromatic Aberration** - Custom shader passes
5. **Particle Exhaust Trails** - Dynamic particle system per vehicle
6. **Fog + Dynamic Sky** - Atmospheric effects
7. **Camera/Headlight Shake** - Motion feedback
8. **Configuration UI** - Host-only lobby controls

## Architectural Questions

### 1. System Organization
**Question**: Where should post-processing code live?

**Current Plan**: 
- Create `PostProcessingSystem.js` as separate system
- Integrate with `RenderSystem.js`

**Concerns**:
- Is post-processing a separate "system" or part of rendering?
- Should it be composable/optional (can disable for performance)?
- How to handle resize events for EffectComposer?

**Architect's Input Needed**: 
- Should `PostProcessingSystem` be a separate system or integrated into `RenderSystem`?
- How should it communicate with `RenderSystem` (direct reference vs EventBus)?

### 2. Visual Configuration
**Question**: How should visual config be structured and stored?

**Current Plan**:
- Add `visualConfig` object to `GameHost.js` or `RenderSystem.js`
- Sliders in `LobbyUI.js` update config live

**Concerns**:
- Should visual config be data-driven (JSON) or runtime-only?
- Where should defaults live?
- How to persist user preferences?
- Should mobile detection affect defaults or be a separate preset?

**Architect's Input Needed**:
- Should visual config be in JSON (data-driven) or JavaScript (runtime)?
- Where should the config object live (GameHost, RenderSystem, separate module)?
- How should presets ("Neon Max", "Mobile Lite") be defined?

### 3. Material Management
**Question**: How to handle emissive material updates without breaking existing code?

**Current Plan**:
- Modify `TrackFactory.js` and `VehicleFactory.js` to add emissive properties
- Update materials when visual config changes

**Concerns**:
- Should material properties be configurable in JSON (vehicle/track definitions)?
- How to update materials live when sliders change?
- Should we create material instances per vehicle or share materials?

**Architect's Input Needed**:
- Should emissive properties be in vehicle/track JSON configs?
- How to handle material updates (recreate vs modify existing)?
- Should materials be shared or per-instance?

### 4. Particle System Architecture
**Question**: How should the trail system integrate with existing architecture?

**Current Plan**:
- Create `TrailSystem.js` as separate system
- One Points object per vehicle
- Update in render loop

**Concerns**:
- Is this a "system" or a component/effect?
- Should trails be part of Vehicle entity or separate?
- How to clean up trails when vehicle is removed?
- Should trail config be in vehicle JSON?

**Architect's Input Needed**:
- Should `TrailSystem` be a system or a component?
- How should it integrate with Vehicle lifecycle?
- Should trail properties be in vehicle JSON config?

### 5. Event-Driven Integration
**Question**: How should visual effects communicate with other systems?

**Current Plan**:
- Direct references in some places (e.g., RenderSystem → PostProcessingSystem)
- EventBus for some updates (e.g., vehicle speed for shake)

**Concerns**:
- Should all visual updates go through EventBus?
- How to handle performance-critical updates (particle trails every frame)?
- Should visual config changes emit events?

**Architect's Input Needed**:
- What level of event-driven communication is appropriate for visual effects?
- Should visual config changes emit events for other systems to react?
- How to balance EventBus overhead with direct calls for performance?

### 6. Performance Strategy
**Question**: How to structure performance optimizations?

**Important Context**: Mobile devices are controller-only - they don't render anything. All rendering happens on the host machine.

**Current Plan**:
- Performance presets for host machine capabilities
- Conditional feature disabling based on preset

**Concerns**:
- Should performance settings be a separate config?
- How to structure presets (low-end host vs high-end host)?
- Should we have a "PerformanceSystem" or handle in each system?

**Architect's Input Needed**:
- Should performance presets be data-driven?
- How to structure conditional feature enabling/disabling?
- Should presets be user-selectable or auto-detected?

## Proposed File Structure

```
static/js/
├── systems/
│   ├── RenderSystem.js          # Modified: Add post-processing integration
│   ├── PostProcessingSystem.js  # New: EffectComposer, passes management
│   └── TrailSystem.js           # New: Particle trails per vehicle
│
├── resources/
│   ├── TrackFactory.js          # Modified: Add emissive materials
│   └── VehicleFactory.js        # Modified: Add emissive, headlights
│
├── ui/
│   └── LobbyUI.js               # Modified: Add visual config panel
│
├── shaders/                     # New directory
│   └── ColorGradingShader.js    # New: Custom shader for grading/vignette
│
└── config/                      # New directory?
│   └── VisualConfig.js         # New: Visual config structure & defaults?
```

## Integration Points

### RenderSystem Integration
- Currently: `renderer.render(scene, camera)` in `render()` method
- Proposed: `composer.render()` with post-processing passes
- Question: Should this be optional/conditional?

### Vehicle Lifecycle
- Currently: Vehicles created in `GameHost._onPlayerJoined()`
- Proposed: Need to add headlights, trails, emissive materials
- Question: Should these be part of Vehicle entity or separate?

### Track Creation
- Currently: Track created in `GameHost._createTrack()`
- Proposed: Add emissive materials to track surface/barriers
- Question: Should emissive be in track JSON config?

## Code Quality Concerns

1. **File Size**: Will adding post-processing to RenderSystem make it too large?
   - Current: ~430 lines
   - Proposed additions: ~200-300 lines
   - Should we split RenderSystem?

2. **Coupling**: How to keep systems loosely coupled while sharing Three.js objects?
   - RenderSystem owns scene/renderer
   - PostProcessingSystem needs renderer
   - TrailSystem needs scene access

3. **Testing**: How to test visual effects?
   - Post-processing requires WebGL context
   - Particle systems need animation loop
   - Should we have visual regression tests?

## Specific Architecture Requests

1. **Review the proposed file structure** - Does it align with single responsibility?
2. **Recommend system boundaries** - Where should code live?
3. **Suggest data-driven approach** - What should be in JSON vs code?
4. **EventBus integration** - What should use events vs direct calls?
5. **Performance architecture** - How to structure mobile/desktop differences?
6. **Material management** - How to handle live updates and sharing?

## Success Criteria

The implementation should:
- ✅ Maintain single responsibility per module
- ✅ Keep systems loosely coupled
- ✅ Enable easy configuration/tweaking
- ✅ Support mobile performance optimization
- ✅ Not break existing functionality
- ✅ Be testable (where possible)

## Next Steps

After Architect review:
1. Refine file structure based on recommendations
2. Define data schemas for visual config (if data-driven)
3. Plan integration points with existing systems
4. Create detailed implementation steps per system

---

**Please review and provide architectural guidance on the questions above.**

