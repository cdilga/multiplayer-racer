# Visual Overhaul Implementation Plan

## Overview
This document outlines the step-by-step implementation plan for the neon cyberpunk visual overhaul as specified in `VISUAL_OVERHAUL.md`.

## Current State Analysis

### Codebase Structure
- **Rendering System**: `static/js/systems/RenderSystem.js` - handles all Three.js rendering
- **Track Creation**: `static/js/resources/TrackFactory.js` - creates track meshes and materials
- **Vehicle Creation**: `static/js/resources/VehicleFactory.js` - creates vehicle meshes and materials
- **Main Orchestrator**: `static/js/GameHost.js` - wires all systems together
- **UI System**: `static/js/ui/LobbyUI.js` - lobby interface (where we'll add visual config)

### Three.js Version
- **Current**: r128 (from CDN in `frontend/host/index.html`)
- **Package**: `three@^0.128.0` in package.json
- **Issue**: Spec mentions ES6 addons from `three/addons/...` which require r152+
- **Action Required**: Upgrade to r152+ OR use alternative approach for r128

## Implementation Phases

### Phase 1: Setup & Infrastructure (Foundation)
**Goal**: Prepare codebase for visual effects

1. **Upgrade Three.js**
   - Update `package.json` to `three@^0.152.0` or latest
   - Update CDN link in `frontend/host/index.html` OR switch to npm import
   - **Run Playwright tests first** - ensure everything still works after upgrade
   - Test that existing rendering still works

2. **Create Visual Config System**
   - Add `visualConfig` object to `GameHost.js` or `RenderSystem.js`
   - Create structure for all configurable parameters
   - **localStorage persistence**: Save visual settings to localStorage (like other settings)
   - Note: Mobile devices are controller-only (no rendering), so performance concerns are host-side only
   - Go MAXIMAL - 120fps on MacBook, optimize later if needed

3. **Create Post-Processing Module**
   - New file: `static/js/systems/PostProcessingSystem.js`
   - Will handle EffectComposer, passes, and shader management
   - Integrate with RenderSystem

### Phase 2: Bloom + Emissive Materials (Biggest Impact)
**Goal**: Instant neon glow effect

1. **Implement EffectComposer**
   - Modify `RenderSystem.js` to create EffectComposer after renderer
   - Add RenderPass + UnrealBloomPass
   - Replace `renderer.render()` with `composer.render()` in render loop
   - Handle resize for composer

2. **Add Neon Emissive Materials**
   - **Track**: Update `TrackFactory.js` to add emissive properties to:
     - Track surface lines (create separate line geometry if needed)
     - Barrier edges
   - **Vehicles**: Update `VehicleFactory.js` to add emissive to:
     - Car body edges
     - Headlights (already have emissive, enhance)
     - Taillights
   - **Color Scheme**: Use creative, bold cyberpunk colors (avoid teal/purple AI cliché)
     - Consider: Electric cyan (#00ffff), Hot magenta (#ff00ff), Neon orange (#ff6600), Electric lime (#ccff00), Deep purple (#6600ff)
     - Make it MAXIMAL, striking, bold, crazy, and over-the-top!

3. **Add Headlights (PointLights)**
   - Modify `VehicleFactory.js` to create 2 PointLights per vehicle
   - Position at front left/right
   - Add to scene in `RenderSystem` or track per vehicle
   - Make intensity configurable

### Phase 3: Color Grading & Post-Processing Effects
**Goal**: Cinematic polish

1. **Chromatic Aberration**
   - Add RGBShiftShader pass to composer
   - Import from `three/addons/shaders/RGBShiftShader.js`
   - Add ShaderPass wrapper

2. **Color Grading + Vignette**
   - Create custom shader pass for:
     - Teal-orange color grading (boost teal, crush orange)
     - Vignette effect (dark edges)
   - Add as ShaderPass after bloom

3. **Integrate Passes**
   - Order: RenderPass → Bloom → ColorGrading → ChromaticAberration
   - Make all parameters configurable

### Phase 4: Dynamic Effects
**Goal**: Motion and atmosphere

1. **Particle Exhaust Trails**
   - Create new file: `static/js/systems/TrailSystem.js`
   - One Points object per vehicle
   - Track recent positions when speed > threshold
   - Update BufferGeometry attributes each frame
   - Use additive blending + car-matching color
   - Integrate with Vehicle entity lifecycle

2. **Fog + Dynamic Sky**
   - Add FogExp2 to scene in `RenderSystem.init()`
   - Create sky dome (large inverted sphere) with gradient material
   - Electric blue color scheme

3. **Camera/Headlight Shake**
   - Add shake logic to `RenderSystem._updateCamera()`
   - Check vehicle speed > 60 km/h or recent collision
   - Offset camera position slightly
   - Optional: flicker headlight intensity

### Phase 5: Configuration UI
**Goal**: Host-only visual controls

1. **Extend LobbyUI**
   - Add visual config panel (collapsible section)
   - Create sliders for all parameters:
     - Bloom: Strength (0-2), Radius (0-1), Threshold (0-1)
     - Neon: Intensity (0-2), Headlight Brightness (0-5)
     - Grading: Intensity, Vignette Amount, Aberration Amount
     - Trails: Density (50-300), Min Speed Threshold, Opacity
     - Fog: Density, Sky Brightness
     - Shake: Intensity (0-0.3)
   - Add preset buttons: "Neon Max", "Mobile Lite", "Off"
   - Wire up to `visualConfig` object

2. **Live Updates**
   - On slider change → update passes/materials/lights immediately
   - No restart needed

## File Changes Summary

### New Files
- `static/js/systems/PostProcessingSystem.js` - Post-processing management
- `static/js/systems/TrailSystem.js` - Particle trail system
- `static/js/shaders/ColorGradingShader.js` - Custom color grading shader

### Modified Files
- `package.json` - Upgrade Three.js version
- `frontend/host/index.html` - Update Three.js CDN or switch to npm
- `static/js/systems/RenderSystem.js` - Add post-processing, fog, sky
- `static/js/resources/TrackFactory.js` - Add emissive materials
- `static/js/resources/VehicleFactory.js` - Add emissive materials, headlights
- `static/js/ui/LobbyUI.js` - Add visual config panel
- `static/js/GameHost.js` - Wire up visual config system

## Testing Strategy

1. **Visual Verification**
   - Test each effect individually
   - Test combinations
   - Verify mobile performance

2. **Performance Testing**
   - Monitor FPS with all effects enabled
   - Test on mobile devices
   - Verify frame rate stays > 30fps

3. **Configuration Testing**
   - Test all sliders
   - Test presets
   - Verify live updates work

## Performance Considerations

- **Host-Side Only**: All rendering happens on the host machine. Mobile devices are controller-only and send input via Socket.IO.
- **Performance Presets**: Host can choose preset based on their machine capabilities
  - "Neon Max": All effects enabled at full intensity
  - "Balanced": Default settings for most hosts
  - "Performance": Reduced effects for lower-end hosts
  - "Off": Disable all visual effects

- **Optimization Tips**
  - Tune bloom threshold so only emissives glow strongly
  - Limit particles per car (max 300)
  - Use lower resolution for post-processing on mobile
  - Consider LOD system for trails

## Rollout Order (Fast Wins First)

1. ✅ Bloom + Composer setup → immediate glow test
2. ✅ Emissive materials + headlights
3. ✅ Grading/vignette/aberration shaders
4. ✅ Trails
5. ✅ Fog/sky
6. ✅ Shake
7. ✅ Lobby sliders

## Notes

- All rendering happens on host only (as per spec)
- Mobile devices are controller-only - they send input via Socket.IO, no rendering
- No Three.js rendering code on client/player side (only simple car preview in lobby)
- Use only built-in Three.js features + official addons
- No new npm dependencies (except Three.js upgrade)
- Keep code simple, performant - focus on host-side performance only

