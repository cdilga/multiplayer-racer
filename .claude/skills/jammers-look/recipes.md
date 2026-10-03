# jammers-look recipes (verbatim, rendered in P1-F11)

Each block is the exact text between `// region:` markers in `example/look.js`, `example/main.js` and `example/index.html`, the code that produced
`docs/evidence/P1-F11/*.png`. `node example/check-recipes.mjs` fails if this file drifts from the source; edit the source,
then `node example/check-recipes.mjs --write`. Read `SKILL.md` first for the map, rules and traps. Unrendered recipes and
the GLSL route are in `recipes-extra.md`.

## Setup: import map, imports, renderer, views

`look.js#imports` is the header of the module you assemble from the TSL blocks below; `main.js#scene-imports` is the header of
your scene module. Order of use: the import map in your HTML, the imports at the top of your module, the renderer, the rig and camera, the
materials and meshes, the frame function. A page that follows the blocks in this order is self-contained apart from Spike J's
`model.js` / `atlas.js` and an element with `id="c"`. Serve the **repo root** (for example
`node spikes/art-pipeline/J-cruze-lowpoly/serve.mjs 8131`) because every URL below is root-relative.

<!-- recipe: index.html#importmap -->
```html
<!-- Self-hosted only (R70): three comes from the repo-root node_modules, served from the repo root. 'three' and 'three/webgpu' MUST be
     the same URL, so Spike J's model.js (which imports 'three') and look.js (which imports 'three/webgpu') share one module instance. -->
<script type="importmap">{"imports":{
  "three":"/node_modules/three/build/three.webgpu.js",
  "three/webgpu":"/node_modules/three/build/three.webgpu.js",
  "three/tsl":"/node_modules/three/build/three.tsl.js",
  "three/addons/":"/node_modules/three/examples/jsm/"}}</script>
```
<!-- /recipe -->

<!-- recipe: look.js#imports -->
```js
// THREE.LightingModel, THREE.MeshToonNodeMaterial, THREE.PostProcessing and WebGPURenderer all come from 'three/webgpu';
// the node functions come from 'three/tsl'; bloom and fxaa are addons (they are NOT in 'three/tsl').
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, attribute, property, mix, step, smoothstep, fract, floor, length, abs,
  max, min, saturate, sin, cos, atan, mat2, dot, hash, luminance, fwidth, mrt, pass, output, emissive, normalView, time,
  diffuseColor, directionToColor, colorToDirection, BRDF_Lambert, positionWorld, positionGeometry, normalWorld,
  screenCoordinate, screenUV, screenSize, perspectiveDepthToViewZ, renderOutput, mx_noise_float,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
```
<!-- /recipe -->

<!-- recipe: main.js#scene-imports -->
```js
import * as THREE from 'three/webgpu';
import { texture, color, positionWorld } from 'three/tsl';
import { build, DEFAULT_P } from '/spikes/art-pipeline/J-cruze-lowpoly/model.js';   // Spike J: the Cruz Missile model script
import { makeAtlas } from '/spikes/art-pipeline/J-cruze-lowpoly/atlas.js';          // its code-drawn atlas (white paint when asked)
import { createLook, addDayRig, orbitCamera, tierFor, updateLookCamera, addCarAttributes, paintKey, damageCreep, makeComicMaterial, comicPipeline, aCar, aState } from './look.js';
```
<!-- /recipe -->

<!-- recipe: main.js#renderer -->
```js
// setPixelRatio(1) makes the canvas size equal device pixels, so the tile height H given to tierFor() is real pixels.
// shadowMap.enabled is required: without it the sun casts no shadow, so there is nothing for the halftone to key on.
// antialias stays false for the comic chain (it ends in FXAA); forceWebGL: true selects WebGPURenderer's WebGL2 backend.
async function createRenderer(canvas, W, H, { forceWebGL = false, antialias = false } = {}) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias, forceWebGL });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  await renderer.init();
  return renderer;
}
```
<!-- /recipe -->

<!-- recipe: main.js#views -->
```js
// Camera and sun azimuths of the captures (degrees, 0 = in front of the car, + toward its right side). Camera minus sun is
// 75-140 degrees, so one flank is lit, the other is in halftone, and the cast shadow lands beside the car.
const VIEWS = {
  hero: { az: 38, el: 11, dist: 10.5, fov: 24, at: [0, 0.75, 0], sunAz: -42 },
  side: { az: 90, el: 9, dist: 13.5, fov: 22, at: [0, 0.8, 0], sunAz: -50 },
  thumb: { az: 38, el: 11, dist: 8.8, fov: 24, at: [0, 0.75, 0], sunAz: -42 },
  pack: { az: 30, el: 22, dist: 20, fov: 28, at: [0, 0.6, 2.2], sunAz: -45 },
};
```
<!-- /recipe -->

### Tokens and tile tiers

<!-- recipe: look.js#tokens -->
```js
export const INK = '#15203A';                          // art/ui/tokens.json palette.ink
export const INK_PX = { tv: 4, desk: 3, handheld: 2.5 }; // art/ui/GUIDE.md section 5 outline weights at 1080p / 60 cm / 30 cm
```
<!-- /recipe -->

<!-- recipe: look.js#tiers -->
```js
// Per-tile cost rule: the tile's pixel height picks which comic effects run. Starting values for R10 to measure in G-PERF.
export function tierFor(tileHeightPx) {
  const ink = INK_PX.tv * (tileHeightPx / 1080);
  if (tileHeightPx >= 540) return { name: 'L', halftone: 1, grit: 1, bloom: 1, shimmer: 1, speed: 1, inkPx: ink, cell: 8 };
  if (tileHeightPx >= 270) return { name: 'M', halftone: 1, grit: 0.6, bloom: 1, shimmer: 0, speed: 1, inkPx: Math.max(2, ink), cell: 6 };
  if (tileHeightPx >= 110) return { name: 'S', halftone: 0, grit: 0, bloom: 0, shimmer: 0, speed: 0, inkPx: 1.5, cell: 5 };
  return { name: 'XS', halftone: 0, grit: 0, bloom: 0, shimmer: 0, speed: 0, inkPx: 1, cell: 4 }; // 40 px car: toon + hairline ink only
}
```
<!-- /recipe -->

<!-- recipe: look.js#look-uniforms -->
```js
// One object of uniforms shared by every comic material and the post chain. Change .value at runtime, never rebuild nodes.
export function createLook(tier = tierFor(1080)) {
  return {
    // toon ramp: 3 tones (shadow, mid, lit) and the two n.l cut points between them
    tones: uniform(new THREE.Vector3(0.40, 0.72, 1.0)),
    cuts: uniform(new THREE.Vector2(-0.05, 0.45)),
    ink: uniform(new THREE.Color(INK)),
    // post (per tile tier)
    inkPx: uniform(tier.inkPx), outline: uniform(1), halftone: uniform(tier.halftone), cell: uniform(tier.cell),
    bloomOn: uniform(tier.bloom), grit: uniform(tier.grit), shimmer: uniform(0), speed: uniform(0), fringe: uniform(0),
    // grade: warm orange/teal split, vignette, grain (per theme and time of day)
    warm: uniform(0.35), vignette: uniform(0.22), grainAmt: uniform(0.02),
    // sun-bleach and dust (materials)
    bleach: uniform(0.22), dust: uniform(0.3), dustTint: uniform(new THREE.Color('#E0B389')),
    near: uniform(0.1), far: uniform(200), aspect: uniform(16 / 9), // mirror of the scene camera, set by updateLookCamera()
  };
}
export function updateLookCamera(look, camera) { look.near.value = camera.near; look.far.value = camera.far; look.aspect.value = camera.aspect; }
export function applyTier(look, tier) {
  look.inkPx.value = tier.inkPx; look.halftone.value = tier.halftone; look.cell.value = tier.cell;
  look.bloomOn.value = tier.bloom; look.grit.value = tier.grit;
}
```
<!-- /recipe -->

### Day rig (sun, ambient, haze)

<!-- recipe: look.js#rig -->
```js
// Conventions (Spike J): the car faces +Z, its right side is +X, origin on the ground between the axles, metres.
// Azimuths are degrees around +Y with 0 = in front of the car (+Z) and positive toward +X (its right side).
// Day rig for the comic look: one shadow-casting sun drives the toon ramp, a hemisphere light is the (cool) ambient, and fog
// and sky share the haze colour so the horizon dissolves instead of drawing a line. Dusk/night = another parameter set.
// The sun sits at (sin(az), 0.95, cos(az)) x 9.5 m (about 43 degrees up), so the cast shadow falls AWAY from azimuth `sunAz`.
// Its shadow frustum is +/-9 m around the origin: for a moving car move sun.position and sun.target with it each frame.
// Needs renderer.shadowMap.enabled = true (see 'renderer'), mesh.castShadow on cars and mesh.receiveShadow on the ground.
export function addDayRig(scene, { sunAz = -42, sunIntensity = 2.1, hemiIntensity = 1.5, haze = '#F4DDB0' } = {}) {
  scene.background = new THREE.Color(haze);
  scene.fog = new THREE.Fog(haze, 45, 190);
  scene.add(new THREE.HemisphereLight('#D8E2FF', '#B07A66', hemiIntensity));
  const sun = new THREE.DirectionalLight('#FFF1D6', sunIntensity), a = THREE.MathUtils.degToRad(sunAz);
  sun.position.set(Math.sin(a) * 9.5, 9, Math.cos(a) * 9.5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
  scene.add(sun, sun.target);
  return sun;
}
// Orbit camera, same azimuth convention. To SEE the cast shadow put the camera 60-140 degrees away from the sun azimuth
// (hero: camera 38, sun -42; side: 90 / -50; pack: 30 / -45): then one side is lit, the other is in halftone, and the shadow
// falls to the side of the car instead of straight behind it. Call updateLookCamera(look, camera) after any fov/aspect change.
export function orbitCamera(camera, { az, el, dist, at }) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  camera.position.set(at[0] + Math.sin(a) * Math.cos(e) * dist, at[1] + Math.sin(e) * dist, at[2] + Math.cos(a) * Math.cos(e) * dist);
  camera.lookAt(...at); camera.updateMatrixWorld();
}
```
<!-- /recipe -->

### Toon ramp with a shade channel

<!-- recipe: look.js#toon-model -->
```js
// Own lighting model instead of MeshToonNodeMaterial's: in r182 ToonLightingModel dots the raw object-space `normal`
// attribute with a view-space light direction (wrong on rotated or instanced meshes), and it exposes no shade value.
// This one ramps `normalView.dot(L)` into 3 tones, takes cast shadows from the light's 0/1 shadow mask, and records
// `jjShade` (0 = fully lit ... 1 = cast shadow) for the halftone pass. One key light drives the ramp; every other light
// must be hemisphere or ambient (indirect).
const jjShade = property('float', 'jjShade');

class JjToonLightingModel extends THREE.LightingModel {
  constructor(look) { super(); this.look = look; }
  start(builder) { jjShade.assign(float(1)); super.start(builder); }
  direct({ lightDirection, lightColor, lightNode, reflectedLight }, builder) {
    const { tones, cuts } = this.look;
    const ndl = normalView.dot(lightDirection);
    const w = fwidth(ndl).mul(0.5).add(0.002);                       // anti-aliased cut for smooth normals; flat faces just step
    let tone = mix(tones.x, tones.y, smoothstep(cuts.x.sub(w), cuts.x.add(w), ndl));
    tone = mix(tone, tones.z, smoothstep(cuts.y.sub(w), cuts.y.add(w), ndl));
    // Use the light's own colour and its 0/1 shadow mask, not `lightColor`: in r182 `lightColor` carries the shadow map's
    // colour attachment, so cast shadows leave about half the light in (measured: luminance 1.0 in shadow vs 3.0 lit).
    const lit = lightNode.shadowNode && builder.object.receiveShadow ? lightNode.shadowNode : float(1);
    const sun = (lightNode.baseColorNode ?? lightColor).mul(lit);
    reflectedLight.directDiffuse.addAssign(vec3(tone).mul(sun).mul(BRDF_Lambert({ diffuseColor: diffuseColor.rgb })));
    jjShade.assign(float(1).sub(tone.mul(lit)));
  }
  indirect(builder) {
    const { irradiance, reflectedLight, ambientOcclusion } = builder.context;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(BRDF_Lambert({ diffuseColor })));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}

export class JjToonMaterial extends THREE.MeshToonNodeMaterial {
  static get type() { return 'JjToonMaterial'; }
  constructor(look, params) { super(params); this.look = look; }
  setupLightingModel() { return new JjToonLightingModel(this.look); }
}
```
<!-- /recipe -->

### Per-car data, paint key, damage creep

<!-- recipe: look.js#car-attributes -->
```js
// Per-car data rides two instanced attributes (one InstancedMesh per part type, plan 6.1), written once per change:
//   aCar   = (paint r, g, b, car id)         paint is linear; the id is any integer, there is no cap
//   aState = (damage, dust, burn glow, heat) all 0..1, driven by the sim/UI
// NodeMaterial multiplies a mesh's `instanceColor` into the WHOLE colour, which would tint glass, tyres and lights, so
// the paint key reads aCar instead (the GLSL route can use instanceColor, see SKILL.md).
export function addCarAttributes(geometry, cars /* one entry per instance: { paint, id, damage?, dust?, glow?, heat? } */) {
  const car = new Float32Array(cars.length * 4), state = new Float32Array(cars.length * 4), c = new THREE.Color();
  cars.forEach((o, i) => {
    c.set(o.paint); car.set([c.r, c.g, c.b, o.id], i * 4);            // Color.r/g/b are linear
    state.set([o.damage ?? 0, o.dust ?? 0, o.glow ?? 0, o.heat ?? 0], i * 4);
  });
  geometry.setAttribute('aCar', new THREE.InstancedBufferAttribute(car, 4));
  geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(state, 4));
}
export const aCar = attribute('aCar', 'vec4'), aState = attribute('aState', 'vec4');
```
<!-- /recipe -->

<!-- recipe: look.js#paint-key -->
```js
// Paint key: the atlas is drawn with PURE WHITE paint texels; only those texels take the per-car colour, so glass, tyres,
// lights and livery accents keep theirs. With the contract's mask texture (R paint) use `maskTex.r` as `mask` instead.
export const paintMask = (texel) => step(0.985, min(texel.r, min(texel.g, texel.b)));
export function paintKey(texel) {
  return mix(texel, texel.mul(aCar.xyz), paintMask(texel));
}
```
<!-- /recipe -->

<!-- recipe: look.js#damage -->
```js
// Damage creep on paint texels only (identity stays readable on glass, lights and livery): posterised rust blotches grow
// with aState.x, scorch darkens the heaviest patches; a cap keeps some paint showing. Edge wear needs a baked curvature
// attribute (vehicle contract); until then it is omitted rather than faked.
export function damageCreep(albedo, texel) {
  const n = mx_noise_float(positionGeometry.mul(7)).mul(0.5).add(0.5);
  const d = aState.x.mul(0.65);                                       // never covers the whole car
  const rust = step(float(1).sub(d), n.add(mx_noise_float(positionGeometry.mul(23)).mul(0.08)));
  const scorch = step(float(1).sub(d.mul(0.55)), n);
  const crept = mix(mix(albedo, vec3(0.42, 0.2, 0.09), rust), vec3(0.09, 0.07, 0.07), scorch);
  return mix(albedo, crept, paintMask(texel));
}
```
<!-- /recipe -->

### Sun-bleached grit and the comic material

<!-- recipe: look.js#grit -->
```js
// Sun-bleached grit. `space` is object space (positionGeometry) so it rides a car, or positionWorld for static ground.
// Bleach lifts and desaturates toward sand in posterised patches; dust climbs from the ground (and with aState.y on
// cars); flecks are coarse and low contrast and fade out once a cell is under ~2 px, so they never shimmer.
// Everything scales with look.grit (the tile tier).
export function bleachGrit(albedo, look, { space = positionGeometry, cell = 40, patchFreq = 2, up = normalWorld.y, dust = float(0) } = {}) {
  const lum = vec3(luminance(albedo));
  const sandy = mix(lum, vec3(0.88, 0.74, 0.55).mul(lum.add(0.25)), 0.55);
  const patch = smoothstep(0.42, 0.58, mx_noise_float(space.mul(patchFreq)).mul(0.5).add(0.5)); // blotches, not gradients
  let c = mix(albedo, sandy, look.bleach.mul(look.grit).mul(patch.mul(0.6).add(0.4)).mul(up.mul(0.5).add(0.5)));
  const id = floor(space.mul(cell)), fleck = hash(id.x.add(id.y.mul(57.0)).add(id.z.mul(113.0)));
  const fade = float(1).sub(smoothstep(0.25, 0.6, length(fwidth(space.mul(cell)))));
  c = c.mul(float(1).sub(step(0.9, fleck).mul(0.10).mul(look.grit).mul(fade)));         // dark flecks
  c = c.mul(float(1).add(step(0.985, fleck).mul(0.35).mul(look.grit).mul(fade)));        // light flecks
  const dustAmt = max(smoothstep(0.55, 0.0, positionWorld.y).mul(look.dust), dust).mul(look.grit); // by height, or driven over
  return mix(c, look.dustTint.mul(lum.add(0.35)), dustAmt.mul(0.5));
}
```
<!-- /recipe -->

<!-- recipe: look.js#material -->
```js
// One comic material for every in-world surface. colorNode: e.g. paintKey(texel) or a flat colour.
// dynamicId: a float node (any integer id, no cap) for things that move or belong to players (cars, debris); omit for static world.
// The id target stores (hash(id), 1 = dynamic object); the outline pass compares hashes and outlines dynamic objects against sky.
export const idHash = (n) => fract(n.mul(0.6180339887)); // golden-ratio spread: neighbouring ids land far apart, any count works
export function makeComicMaterial(look, { colorNode, emissiveNode = null, dynamicId = null, grit = {} } = {}) {
  const m = new JjToonMaterial(look);
  m.colorNode = bleachGrit(colorNode, look, grit);
  if (emissiveNode) m.emissiveNode = emissiveNode;
  m.mrtNode = mrt({ objectId: dynamicId ? vec4(idHash(dynamicId), 1, 0, 1) : vec4(0, 0, 0, 1) }); // merged over the scene pass default
  return m;
}
```
<!-- /recipe -->

### Speed lines

<!-- recipe: look.js#speed-lines -->
```js
// Comic speed lines: ink wedges radiating from the screen centre (thin near the middle, wider outward), none inside a clear
// ellipse (the road ahead and the car stay untouched), re-rolled 12 times a second. look.speed 0..1 is the car's speed;
// tiers S/XS keep it at 0 and drop the node.
export const speedLines = (look) => Fn(() => {
  const p = screenUV.sub(0.5).mul(vec2(look.aspect, 1)), r = length(p);
  const sectors = atan(p.y, p.x).mul(180.0 / (2 * Math.PI));
  const id = floor(sectors), across = abs(fract(sectors).sub(0.5)).mul(2);           // 0 on the ray's axis, 1 at its edge
  const roll = hash(id.add(time.mul(12).floor().mul(7.0)));
  const start = float(0.42).add(hash(id.add(31.0)).mul(0.16));                       // each ray starts at its own radius
  const reach = smoothstep(start, start.add(0.03), r);
  const taper = smoothstep(start, start.add(0.5), r).mul(0.7).add(0.1);              // ray half-width grows outward
  const ray = step(across, taper).mul(step(0.88, roll)).mul(reach);
  return ray.mul(smoothstep(0.0, 0.3, look.speed)).mul(look.speed);
})();
```
<!-- /recipe -->

### The one post chain (bloom, halftone, ink outlines, speed lines, grade, FXAA)

<!-- recipe: look.js#post -->
```js
// One post chain, run once: scene pass with MRT -> selective emissive bloom -> halftone in shadows -> ink outlines
// -> speed lines -> grade -> tone map + sRGB -> FXAA. `PostProcessing` is the r182 class (renamed RenderPipeline in r183).
// opts.bloom / halftone / outline / fringe / speedLines false drops that effect's texture taps from the graph (a real saving for
// small tiles; the look.* uniforms only fade). opts.debug = 'id' | 'shade' | 'normal' | 'depth' | 'edge' | 'halftone' |
// 'glow' shows one intermediate channel instead of the picture (R90: the look is introspectable).
export function comicPipeline(renderer, scene, camera, look, opts = {}) {
  const { bloom: useBloom = true, halftone: useHalftone = true, outline: useOutline = true, fringe: useFringe = false,
    speedLines: useSpeed = true, fxaa: useFxaa = true, debug = null } = opts;
  const scenePass = pass(scene, camera, { samples: 0 });               // no MSAA: ids and normals must not blend
  scenePass.setMRT(mrt({
    output,
    emissive: vec4(emissive, 1),
    normal: vec4(directionToColor(normalView), jjShade),                // rgb = view normal, a = shade
    objectId: vec4(0, 0, 0, 1),                                          // overridden per material by makeComicMaterial
  }));
  scenePass.getTexture('normal').type = THREE.UnsignedByteType;
  for (const n of ['normal', 'objectId', 'depth']) { const t = scenePass.getTexture(n); t.minFilter = t.magFilter = THREE.NearestFilter; } // never blend ids or depth

  const colTex = scenePass.getTextureNode('output'), emiTex = scenePass.getTextureNode('emissive');
  const nrmTex = scenePass.getTextureNode('normal'), idTex = scenePass.getTextureNode('objectId');
  const depTex = scenePass.getTextureNode('depth');
  const px = vec2(1).div(screenSize);
  const dAt = (uvN) => depTex.sample(uvN).r;                          // device depth: affine in screen space on ANY plane
  const zOf = (d) => perspectiveDepthToViewZ(d, look.near, look.far).negate(); // metres in front of the camera
  const isSky = (uvN) => step(0.99999, depTex.sample(uvN).r);
  const depthScale = look.far.mul(look.near).div(look.far.sub(look.near));      // d = A - depthScale / z: a relative step dz/z shows as depthScale * (dz/z) / z

  // selective bloom: only the emissive target blooms, so white paint never glows
  const glow = useBloom ? bloom(emiTex, 0.6, 0.3, 0.0).rgb.mul(look.bloomOn) : vec3(0);

  // ink outlines: depth + normal + object id, 4 taps at inkPx/2. The depth term is the second difference of the DEVICE depth
  // (zero on every plane, so ground and walls at grazing angles don't light up), scaled to a relative step dz/z.
  // Sky is not an object: only dynamic objects (id target .g = 1) get an outline against it, never the horizon.
  // opts.outline = 'ids' is the cheap tier (GUIDE section 13): object silhouettes only, no depth or normal taps.
  const full = useOutline === true;
  const edge = !useOutline ? float(0) : Fn(() => {
    const r = look.inkPx.mul(0.5).ceil().max(1);                       // whole-pixel taps: band width = 2 * r
    const o = [vec2(r, 0), vec2(r.negate(), 0), vec2(0, r), vec2(0, r.negate())].map((d) => screenUV.add(d.mul(px)));
    const skyC = isSky(screenUV), idC = idTex.sample(screenUV).r;
    let nD = float(0), iD = float(0), skyEdge = float(0), dyn = idTex.sample(screenUV).g, anySky = skyC;
    o.forEach((u) => {
      const skyN = isSky(u), idN = idTex.sample(u);
      iD = max(iD, step(0.02, abs(idN.r.sub(idC))));
      skyEdge = max(skyEdge, abs(skyN.sub(skyC))); dyn = max(dyn, idN.g); anySky = max(anySky, skyN);
      if (full) nD = max(nD, float(1).sub(dot(colorToDirection(nrmTex.sample(screenUV).rgb), colorToDirection(nrmTex.sample(u).rgb))));
    });
    let surface = iD;
    if (full) {
      const dC = dAt(screenUV), ds = o.map(dAt);
      const lap = abs(ds[0].add(ds[1]).sub(dC.mul(2))).add(abs(ds[2].add(ds[3]).sub(dC.mul(2)))).mul(zOf(dC)).div(depthScale);
      surface = max(smoothstep(0.05, 0.15, lap), max(smoothstep(0.1, 0.25, nD), iD));
    }
    surface = surface.mul(float(1).sub(anySky));
    const silhouette = skyEdge.mul(dyn);
    return max(surface, silhouette).mul(look.outline);
  })();

  // halftone: 45 degree dot screen, dot radius grows with shade, only in the deep-shade tones; lights are left alone
  const halftone = !useHalftone ? float(0) : Fn(() => {
    const a = float(Math.PI / 4), rot = mat2(cos(a), sin(a).negate(), sin(a), cos(a));
    const cellUv = rot.mul(screenCoordinate.xy).div(look.cell);
    const dist = length(fract(cellUv).sub(0.5));
    const shade = nrmTex.sample(screenUV).a;
    const radius = smoothstep(0.42, 1.0, shade).mul(0.42);              // 0.42 = about 55% ink coverage at full shade
    const aa = fwidth(dist).mul(0.75);
    const dots = float(1).sub(smoothstep(radius.sub(aa), radius.add(aa), dist));
    const lit = saturate(luminance(emiTex.sample(screenUV).rgb).mul(2));
    return dots.mul(look.halftone).mul(float(1).sub(isSky(screenUV))).mul(float(1).sub(lit));
  })();

  // base colour; chromatic fringe (big hits only) splits R/B along the radius, 3 taps instead of 1
  const dirV = screenUV.sub(0.5), f = look.fringe.mul(px.x);
  const base = useFringe
    ? vec3(colTex.sample(screenUV.add(dirV.mul(f))).r, colTex.sample(screenUV).g, colTex.sample(screenUV.sub(dirV.mul(f))).b)
    : colTex.rgb;
  let c = base.add(glow);
  c = mix(c, mix(c.mul(0.5), look.ink, 0.4), halftone.mul(0.9));       // dots = darker, inky shade of the surface
  c = mix(c, look.ink, edge);
  if (useSpeed) c = mix(c, look.ink, speedLines(look).mul(0.55));
  // grade: warm orange highlights / teal shadows, corner vignette (never the centre), film grain
  const lum = luminance(c);
  c = mix(c, mix(c.mul(vec3(0.9, 1.0, 1.06)), c.mul(vec3(1.08, 1.0, 0.9)), smoothstep(0.1, 0.8, lum)), look.warm);
  c = c.mul(float(1).sub(look.vignette.mul(smoothstep(0.55, 1.1, length(dirV.mul(vec2(look.aspect, 1)).mul(1.1))))));
  c = c.add(hash(screenCoordinate.x.add(screenCoordinate.y.mul(4001.0)).add(time.mul(97.0))).sub(0.5).mul(look.grainAmt));

  const channels = {
    id: vec3(idTex.sample(screenUV).r), shade: vec3(nrmTex.sample(screenUV).a), normal: nrmTex.sample(screenUV).rgb,
    depth: vec3(zOf(dAt(screenUV)).div(look.far)), edge: vec3(edge), halftone: vec3(halftone), glow,
  };
  if (debug) c = channels[debug];
  const shown = renderOutput(vec4(c, 1));                               // tone map + sRGB here, so FXAA sees display values
  const post = new THREE.PostProcessing(renderer);
  post.outputColorTransform = false;                                     // renderOutput() above already did it
  post.outputNode = useFxaa ? fxaa(shown) : shown;
  return { post, scenePass };
}
```
<!-- /recipe -->

### Wiring it up (cars, ground, one frame)

<!-- recipe: main.js#wiring -->
```js
const RED_EARTH = '#C8622E';                                      // art/ui/tokens.json palette.red-earth
// One InstancedMesh per part type. build() returns one Mesh per part (name = part id, userData.rest = its offset from the
// origin). Every part is its own type except the four wheels, which share one geometry (left wheels are mirrored by a Y rotation).
function groupParts(template) {
  const groups = {};
  for (const [name, mesh] of Object.entries(template.parts)) (groups[name.startsWith('wheel') ? 'wheel' : name] ??= []).push(mesh);
  return groups;
}
// cars: any number of { x, z, yaw, paint: '#hex', damage?, dust? }. One material for all of them; per-car paint, id and damage
// ride instanced attributes. The ground must receiveShadow, or it shows neither the cast shadow nor the halftone.
function addComicWorld(scene, look, P, cars) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), makeComicMaterial(look, { colorNode: color(RED_EARTH), grit: { space: positionWorld, cell: 28, patchFreq: 0.35 } }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const atlas = makeAtlas({ paint: '#ffffff' });                  // paint key: pure white paint texels take the per-car colour
  const texel = texture(atlas.map).rgb;
  const carMaterial = makeComicMaterial(look, {
    colorNode: damageCreep(paintKey(texel), texel),
    emissiveNode: texture(atlas.emissiveMap).rgb.mul(1.6),
    dynamicId: aCar.w,
    grit: { dust: aState.y },
  });
  const m4 = new THREE.Matrix4(), carM = new THREE.Matrix4(), off = new THREE.Matrix4();
  for (const [key, meshes] of Object.entries(groupParts(build(P, 0)))) {
    const geo = meshes[0].geometry.clone();                       // correct for every group: a part type has exactly one geometry
    const im = new THREE.InstancedMesh(geo, carMaterial, cars.length * meshes.length);
    const perInstance = []; let k = 0;
    cars.forEach((car, i) => {
      carM.makeRotationY(car.yaw).setPosition(car.x, 0, car.z);
      for (const pm of meshes) {
        off.makeTranslation(...pm.userData.rest);
        if (key === 'wheel' && pm.name.endsWith('L')) off.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
        im.setMatrixAt(k++, m4.multiplyMatrices(carM, off));
        perInstance.push({ paint: car.paint, id: i + 1, damage: car.damage, dust: car.dust });   // id: any integer, no cap
      }
    });
    addCarAttributes(geo, perInstance);
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im);
  }
}
```
<!-- /recipe -->

<!-- recipe: main.js#frame -->
```js
// H = tile height in device pixels. `extra` forwards comicPipeline options. Call the returned function every frame instead of
// renderer.render(scene, camera); set look.speed.value (0..1) from the car's speed first if the speed lines should show.
function createDraw(renderer, scene, camera, look, H, extra = {}) {
  const tier = tierFor(H);                                        // the tile's pixel height picks the effects; unused ones leave the graph
  const { post } = comicPipeline(renderer, scene, camera, look, { bloom: tier.bloom > 0, halftone: tier.halftone > 0, speedLines: tier.speed > 0, ...extra });
  return () => post.render();
}
```
<!-- /recipe -->

## GLSL route (plain `WebGLRenderer`), rendered in P1-F11

Same look without WebGPURenderer: `example/index-glsl.html` (import map points `three` at `three.module.js`) +
`main-glsl.js` + `glsl.js`. Captured in `docs/evidence/P1-F11/glsl-*.png`. Not ported here: selective bloom (use the
standard three emissive-only bloom, see `recipes-extra.md`), damage creep, fringe, FXAA. Differences from the TSL route:
halftone lives in the toon material (no MRT), outlines read a normal+id+depth prepass, post is one `ShaderMaterial` quad.

### Ramp, toon material with paint key, grit and halftone

<!-- recipe: glsl.js#glsl-ramp -->
```js
// 40-texel Nearest ramp: texel edges 19/40 and 29/40 are exactly n.l = -0.05 and 0.45 (u = n.l * 0.5 + 0.5)
export function makeRamp(tones = [0.40, 0.72, 1.0]) {
  const px = new Uint8Array(40 * 4);
  for (let i = 0; i < 40; i++) { const v = Math.round(255 * tones[i < 19 ? 0 : i < 29 ? 1 : 2]); px.set([v, v, v, 255], i * 4); }
  const t = new THREE.DataTexture(px, 40, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}
```
<!-- /recipe -->

<!-- recipe: glsl.js#glsl-toon -->
```js
// MeshToonMaterial + onBeforeCompile: paint key (Spike J), sun-bleached grit, and halftone in the shade. Uniforms are shared.
export function createLook(inkPx = INK_PX.tv) {
  return { ink: { value: new THREE.Color(INK) }, cell: { value: 8 }, halftone: { value: 1 }, grit: { value: 1 }, inkPx: { value: inkPx } };
}
const W = 'vec3( 0.2126, 0.7152, 0.0722 )';
const TOON_PARS = THREE.ShaderChunk.lights_toon_pars_fragment
  .replace('void RE_Direct_Toon(', 'float jjShade = 1.0;\nvoid RE_Direct_Toon(')
  .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	// shade = 1 - ramp tone x shadow mask; directLight.color is the sun colour already multiplied by getShadow()
	float jjTone = getGradientIrradiance( geometryNormal, directLight.direction ).x;
	float jjLit = clamp( dot( directLight.color, ${W} ) / max( dot( directionalLights[ 0 ].color, ${W} ), 1e-4 ), 0.0, 1.0 );
	jjShade = 1.0 - jjTone * jjLit;`);
const NOISE = /* glsl */`
float jjHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float jjNoise( vec3 x ) { vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( jjHash( i ), jjHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( jjHash( i + vec3( 0, 1, 0 ) ), jjHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( jjHash( i + vec3( 0, 0, 1 ) ), jjHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( jjHash( i + vec3( 0, 1, 1 ) ), jjHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }`;
const GRIT = (cell, patchFreq, worldSpace) => /* glsl */`
{
  vec3 sp = ${worldSpace ? 'vJjWorld' : 'vJjPos'};
  float lum = dot( diffuseColor.rgb, ${W} );
  vec3 sandy = mix( vec3( lum ), vec3( 0.88, 0.74, 0.55 ) * ( lum + 0.25 ), 0.55 );
  float blotch = smoothstep( 0.42, 0.58, jjNoise( sp * ${patchFreq.toFixed(3)} ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, sandy, 0.22 * uGrit * ( blotch * 0.6 + 0.4 ) );
  vec3 id = floor( sp * ${cell.toFixed(1)} ); float fleck = jjHash( id );
  float fade = 1.0 - smoothstep( 0.25, 0.6, length( fwidth( sp * ${cell.toFixed(1)} ) ) );
  diffuseColor.rgb *= 1.0 - step( 0.9, fleck ) * 0.10 * uGrit * fade;
  diffuseColor.rgb *= 1.0 + step( 0.985, fleck ) * 0.35 * uGrit * fade;
  float dust = smoothstep( 0.55, 0.0, vJjWorld.y ) * 0.3 * uGrit;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.88, 0.70, 0.54 ) * ( lum + 0.35 ), dust * 0.5 );
}`;
const PAINT = /* glsl */`
#if defined( USE_COLOR )
  float paintMask = step( 0.985, min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) );
  diffuseColor.rgb *= mix( vec3( 1.0 ), vColor, paintMask );   // vColor = vertex colour (1,1,1) x instanceColor
#endif`;
const HALFTONE = /* glsl */`
{
  vec2 r = vec2( 0.70710678 * ( gl_FragCoord.x + gl_FragCoord.y ), 0.70710678 * ( gl_FragCoord.y - gl_FragCoord.x ) ) / uCell;
  float dist = length( fract( r ) - 0.5 );
  float radius = smoothstep( 0.42, 1.0, jjShade ) * 0.42;
  float aa = fwidth( dist ) * 0.75;
  float dots = 1.0 - smoothstep( radius - aa, radius + aa, dist );
  float emi = clamp( dot( totalEmissiveRadiance, ${W} ) * 2.0, 0.0, 1.0 );           // lights are left alone
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( gl_FragColor.rgb * 0.5, uInk, 0.4 ), dots * uHalftone * 0.9 * ( 1.0 - emi ) );
}`;
export function makeToonMaterial(look, { map, emissiveMap, ramp, paintKey = false, color = 0xffffff, grit = { cell: 40, patchFreq: 2, world: false } }) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp, vertexColors: paintKey });
  if (map) m.map = map;
  if (emissiveMap) Object.assign(m, { emissiveMap, emissive: new THREE.Color(0xffffff), emissiveIntensity: 1.6 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uInk: look.ink, uCell: look.cell, uHalftone: look.halftone, uGrit: look.grit });
    sh.vertexShader = 'varying vec3 vJjPos; varying vec3 vJjWorld;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vJjPos = position;
      { vec4 jw = vec4( position, 1.0 );
        #ifdef USE_INSTANCING
          jw = instanceMatrix * jw;
        #endif
        vJjWorld = ( modelMatrix * jw ).xyz; }`);
    sh.fragmentShader = 'varying vec3 vJjPos; varying vec3 vJjWorld; uniform vec3 uInk; uniform float uCell, uHalftone, uGrit;\n' + NOISE + '\n' + sh.fragmentShader
      .replace('#include <lights_toon_pars_fragment>', TOON_PARS)
      .replace('#include <color_fragment>', (paintKey ? PAINT : '#include <color_fragment>') + GRIT(grit.cell, grit.patchFreq, grit.world))
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + HALFTONE);
  };
  m.customProgramCacheKey = () => `jj-toon-${paintKey}-${grit.cell}-${grit.world}`;
  return m;
}
```
<!-- /recipe -->

### Prepass, edge/speed-line/grade pass, frame

<!-- recipe: glsl.js#glsl-pipeline -->
```js
// Frame: (1) normal+id prepass -> rtAux (static first, then dynamic objects, sharing one depth texture), (2) the lit scene -> rtColor,
// (3) one full-screen pass: ink outlines (same maths as look.js 'post'), speed lines, grade, tone map + sRGB to the canvas.
const PREP_VERT = /* glsl */`
varying vec3 vN;
#ifdef DYN
attribute float aId; varying float vId;
#endif
#include <common>
void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  vN = transformedNormal;
  #ifdef DYN
  vId = aId;
  #endif
}`;
const PREP_FRAG = /* glsl */`
varying vec3 vN;
#ifdef DYN
varying float vId;
#endif
void main() {
  #ifdef DYN
  float a = 0.25 + 0.75 * fract( vId * 0.6180339887 );      // alpha: 0 = static world, else dynamic object with a hashed id
  #else
  float a = 0.0;
  #endif
  gl_FragColor = vec4( normalize( vN ) * 0.5 + 0.5, a );
}`;
const POST_FRAG = /* glsl */`
uniform sampler2D tColor, tAux, tDepth;
uniform vec2 uTexel; uniform vec3 uInk;
uniform float uInkPx, uNear, uFar, uAspect, uSpeed, uTime, uWarm, uVignette, uGrain, uOutline;
varying vec2 vUv;
float sky( vec2 uv ) { return step( 0.99999, texture2D( tDepth, uv ).x ); }
vec3 nrm( vec2 uv ) { return texture2D( tAux, uv ).xyz * 2.0 - 1.0; }
float hash11( float n ) { return fract( sin( n ) * 43758.5453 ); }
void main() {
  vec3 c = texture2D( tColor, vUv ).rgb;
  // ink outlines: device-depth Laplacian x z / depthScale, normal difference, id hash difference; sky only outlines dynamic objects
  float r = max( 1.0, ceil( uInkPx * 0.5 ) );
  vec2 o[4] = vec2[4]( vec2( r, 0.0 ), vec2( -r, 0.0 ), vec2( 0.0, r ), vec2( 0.0, -r ) );
  float dC = texture2D( tDepth, vUv ).x, skyC = sky( vUv ), idC = texture2D( tAux, vUv ).a;
  float A = uFar / ( uFar - uNear ), B = uFar * uNear / ( uFar - uNear ), zC = B / max( A - dC, 1e-6 );
  float nD = 0.0, iD = 0.0, skyEdge = 0.0, dyn = step( 0.2, idC ), anySky = skyC, dN[4];
  vec3 nC = nrm( vUv );
  for ( int i = 0; i < 4; i++ ) {
    vec2 u = vUv + o[i] * uTexel; float sN = sky( u ); vec4 aux = texture2D( tAux, u );
    dN[i] = texture2D( tDepth, u ).x;
    nD = max( nD, 1.0 - dot( nC, normalize( aux.xyz * 2.0 - 1.0 ) ) );
    iD = max( iD, step( 0.02, abs( aux.a - idC ) ) ); skyEdge = max( skyEdge, abs( sN - skyC ) ); dyn = max( dyn, step( 0.2, aux.a ) ); anySky = max( anySky, sN );
  }
  float lap = ( abs( dN[0] + dN[1] - 2.0 * dC ) + abs( dN[2] + dN[3] - 2.0 * dC ) ) * zC / B;
  float surface = max( smoothstep( 0.05, 0.15, lap ), max( smoothstep( 0.1, 0.25, nD ), iD ) ) * ( 1.0 - anySky );
  float edge = max( surface, skyEdge * dyn ) * uOutline;
  c = mix( c, uInk, edge );
  // speed lines (same as look.js 'speed-lines')
  vec2 p = ( vUv - 0.5 ) * vec2( uAspect, 1.0 ); float rad = length( p );
  float sec = atan( p.y, p.x ) * ( 180.0 / 6.2831853 ), sid = floor( sec ), across = abs( fract( sec ) - 0.5 ) * 2.0;
  float roll = hash11( sid + floor( uTime * 12.0 ) * 7.0 ), start = 0.42 + hash11( sid + 31.0 ) * 0.16;
  float ray = step( across, smoothstep( start, start + 0.5, rad ) * 0.7 + 0.1 ) * step( 0.88, roll ) * smoothstep( start, start + 0.03, rad );
  c = mix( c, uInk, ray * smoothstep( 0.0, 0.3, uSpeed ) * uSpeed * 0.55 );
  // grade: warm highlights / teal shadows, corner vignette, grain
  float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( c, mix( c * vec3( 0.9, 1.0, 1.06 ), c * vec3( 1.08, 1.0, 0.9 ), smoothstep( 0.1, 0.8, lum ) ), uWarm );
  c *= 1.0 - uVignette * smoothstep( 0.55, 1.1, length( ( vUv - 0.5 ) * vec2( uAspect, 1.0 ) * 1.1 ) );
  c += ( hash11( dot( gl_FragCoord.xy, vec2( 1.0, 4001.0 ) ) + uTime * 97.0 ) - 0.5 ) * uGrain;
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function createPipeline(renderer, scene, camera, look, { groundMeshes, carMeshes }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rtColor = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const rtAux = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: new THREE.DepthTexture(size.x, size.y) });
  const prep = (dyn) => new THREE.ShaderMaterial({ vertexShader: PREP_VERT, fragmentShader: PREP_FRAG, defines: dyn ? { DYN: '' } : {}, fog: false });
  const prepStatic = prep(false), prepDyn = prep(true);
  const u = {
    tColor: { value: rtColor.texture }, tAux: { value: rtAux.texture }, tDepth: { value: rtAux.depthTexture },
    uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) }, uInk: look.ink, uInkPx: look.inkPx, uNear: { value: camera.near }, uFar: { value: camera.far },
    uAspect: { value: camera.aspect }, uSpeed: { value: 0 }, uTime: { value: 0 }, uWarm: { value: 0.35 }, uVignette: { value: 0.22 }, uGrain: { value: 0.02 }, uOutline: { value: 1 },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: u, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }', fragmentShader: POST_FRAG, depthTest: false, depthWrite: false }));
  const quadScene = new THREE.Scene(); quadScene.add(quad);
  const cam2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const set = (list, v) => list.forEach((m) => { m.visible = v; });
  const render = () => {
    const bg = scene.background, fog = scene.fog, sm = renderer.shadowMap.enabled;
    // prepass: no background, fog or shadow update; static world first, then dynamic objects into the same depth
    scene.background = null; scene.fog = null; renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(rtAux); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.autoClear = false;
    set(carMeshes, false); set(groundMeshes, true); scene.overrideMaterial = prepStatic; renderer.render(scene, camera);
    set(carMeshes, true); set(groundMeshes, false); scene.overrideMaterial = prepDyn; renderer.render(scene, camera);
    set(groundMeshes, true); scene.overrideMaterial = null; renderer.autoClear = true;
    scene.background = bg; scene.fog = fog; renderer.shadowMap.enabled = sm;
    renderer.setRenderTarget(rtColor); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(quadScene, cam2);
  };
  return { render, uniforms: u };
}
```
<!-- /recipe -->
