Ensure you pull from main to check where that development is up to. Ok continue developing. Ensure you follow the established development loop ->
  add tests to validate -> make changes -> run test suite -> commit

High-Level Visual Overhaul Spec: Neon Cyberpunk Arena RacerCore Reminder: All rendering happens exclusively on the host (host.js and related files). Clients only send controls via Socket.IO. No Three.js code on client side.Overall Vision: Turn the flat green circular track into a vibrant neon cyberpunk low-poly racer with glowing edges, speed trails, cinematic color grading, and atmospheric depth. Achieve massive "WOW" factor while keeping code simple, performant, and mobile-friendly.Key Principles for Implementation:Use only built-in Three.js features + official addons (no external post-processing libraries like "postprocessing" npm package).
Imports: Use ES6 modules from 'three/addons/...' (standard since Three.js r152+).
No new npm dependencies — everything comes from the existing three package.
All effects configurable via a simple host-only lobby UI (sliders in HTML overlay).
Layer effects incrementally: Start with bloom + emissives (biggest instant impact), then add others.

Effect
Description & "Wow" Factor
Dependencies / Imports
High-Level Implementation Steps
Configurable Params (Lobby Sliders/Toggles)
Estimated Impact
Unreal Bloom + Glow
Bright parts (headlights, road lines, car edges) explode with neon glow. Core cyberpunk feel.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
1. Create EffectComposer after renderer.
2. Add RenderPass + UnrealBloomPass.
3. Replace renderer.render() with composer.render() in animate loop.
4. Handle resize for composer.
Bloom Strength (0-2), Radius (0-1), Threshold (0-1)
Highest (instant neon pop)
Neon Emissive Materials + Headlights
Road lines and cars glow teal/purpl/toe. Add point lights for headlights.
None (built-in MeshStandardMaterial + PointLight)
1. Update road/line materials: emissive: 0x00ffff, emissiveIntensity: 0.3-1.
2. Update car materials: player-specific colors with emissive purple/teal.
3. Add 2 PointLights per car (front left/right).
Neon Intensity (0-2), Headlight Brightness (0-5)
High (makes low-poly feel alive)
Color Grading + Vignette + Chromatic Aberration
Teal-orange cinematic "crush", dark edges, subtle speed warp.
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';
Custom shader for grading/vignette.
1. Add RGBShiftPass for aberration.
2. Create simple custom ShaderPass for teal boost + vignette.
3. Add both after bloom in composer.
Grading Intensity, Vignette Amount, Aberration Amount
High (film-like polish)
Particle Exhaust Trails
Glowing streaks behind accelerating cars for speed feel.
None (BufferGeometry + PointsMaterial)
1. Create one Points object per car.
2. In animate loop, push recent positions when speed > threshold.
3. Update geometry attribute.
4. Use additive blending + car-matching color.
Trail Density (particles 50-300), Min Speed Threshold, Opacity
Medium-High (dynamic motion)
Fog + Dynamic Sky
Atmospheric depth, electric blue infinite arena.
None (FogExp2 + MeshBasicMaterial shader or simple dome)
1. scene.fog = new THREE.FogExp2(0x001122, 0.02);
2. Add large inverted sphere with gradient material for sky.
Fog Density, Sky Brightness
Medium (depth & mood)
Camera / Headlight Shake
Punchy feedback on high speed or collisions.
None
1. In animate, if speed > 60 km/h or recent collision: offset camera position slightly.
2. Optional: flicker headlight intensity.
Shake Intensity (0-0.3)
Medium (immersive feedback)

Lobby Configuration UI (Host-Only):Simple HTML overlay in lobby screen (absolute positioned div).
Sliders/checkboxes for all params above.
Global visualConfig object in host.js.
On slider change → update passes/materials/lights live (no restart needed).
Presets buttons: "Neon Max", "Mobile Lite", "Off".

Integration Order (for Fast Wins):Bloom + Composer setup → immediate glow test.
Emissive materials + headlights.
Grading/vignette/aberration shaders.
Trails.
Fog/sky.
Shake.
Lobby sliders.

Performance Tips:Mobile detection → lower defaults (bloom 0.8, trails 100 particles).
Tune bloom threshold so only emissives glow strongly.
Limit particles per car.

This high-level plan gives massive visual upgrade with clean, standard Three.js code. All imports are from official addons — safe and compatible. Start with bloom/emissives for quickest "WOW", then layer the rest. Ready to hand off to architect! 

