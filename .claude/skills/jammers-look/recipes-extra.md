# jammers-look: recipes not yet rendered, and the GLSL route

Everything in `SKILL.md` / `recipes.md` was rendered and captured in P1-F11. **Everything below was not**: it is written against the r182
sources and the vendored skills, kept short, and each item says what to verify first. Move a sketch into `example/look.js`
(with a `// region:` block and a capture) when you implement it, so `check-recipes.mjs` can hold it.

Names used: `look` (uniforms), `aCar` / `aState` (instanced attributes: `aState` = damage, dust, burn glow, heat),
`paintMask(texel)`, `jjShade`, as in `example/look.js`. Atlas = Spike J's `atlas.js` (white paint, swatches, emissive map).

## Trap that applies to every transparent effect (sprites, flames, smoke, sparks)

The scene pass writes **normal, shade and object id** for every fragment. A transparent material blends those targets too
and leaves junk normals and ids behind, which the outline and halftone passes then read. Expected, not yet verified:
either (a) draw effects in an overlay pass after `post.render()` (`renderer.autoClear = false; renderer.render(fxScene,
camera)`) with a soft-depth fade read from `scenePass.getTextureNode('depth')`, or (b) give the effect material
`m.mrtNode = mrt({ normal: vec4(0.5, 0.5, 1, 0), objectId: vec4(0), emissive: vec4(glow, 1) })` and `depthWrite: false`
so only the emissive target changes. Try (b) first (keeps bloom). Effects must also never draw over the clear ellipse the
speed lines leave (the road ahead) or over a car's roof number / identity colour.

## Cars and effects

### impact-word (12.1: "KRUNCH!", "BOOF!" sprites on big events)

```js
// word sheet from the Codex imagegen pipeline (master 12.2), self-hosted; one atlas, UV rect per word
const mat = new THREE.SpriteNodeMaterial({ map: wordAtlas, transparent: true, depthWrite: false });
const s = new THREE.Sprite(mat);
const pop = (t) => (t < 0.15 ? 0.4 + 6.0 * t : 1.3 - 0.3 * Math.min(1, (t - 0.15) / 0.2));  // t = age / life: overshoot, settle
s.scale.setScalar(base * pop(t)); mat.opacity = 1 - THREE.MathUtils.smoothstep(t, 0.75, 1.0);
s.position.copy(hitPoint).addScaledVector(toCamera, 1.5);   // toward the camera, off the road ahead; one per event, pooled
```

### squash (12.1: squash on landings, visual only)

```js
// scale the VISUAL instance matrix about the contact point; never touch the collider or sim body
const squash = (t, k) => { const a = Math.exp(-t * 14) * Math.cos(t * 38) * 0.16 * k; return new THREE.Vector3(1 + a * 0.5, 1 - a, 1 + a * 0.5); };
// M = T(contact) * S(squash(t, impulse01)) * T(-contact) * carMatrix  -> im.setMatrixAt(...), instanceMatrix.needsUpdate once per batch
```

### edge-wear (12.1a: edge-worn bare metal on corners, curvature bake)

Needs a baked per-vertex curvature attribute `aCurv` (0..1) emitted by the model script / vehicle contract (R81). Until it
exists there is nothing honest to render; do not fake it from screen derivatives (on faceted meshes it just outlines facets).

```js
const aCurv = attribute('aCurv', 'float');
albedo = mix(albedo, vec3(0.62, 0.64, 0.68), smoothstep(0.55, 0.8, aCurv).mul(paintMask(texel)).mul(0.8)); // bare metal, paint texels only
```

### hot-metal (12.1a: exhaust tips and turbo pipes glow orange to white with RPM and boost)

```js
const orange = uniform(new THREE.Color('#FF4A00')), amber = uniform(new THREE.Color('#FFB347'));
const hot = (h) => mix(mix(orange, amber, smoothstep(0.0, 0.6, h)), vec3(1.0, 0.95, 0.85), smoothstep(0.6, 1.0, h)).mul(h.mul(3.0));
material.emissiveNode = atlasEmissive.add(hot(aState.w).mul(exhaustSwatchMask)); // exhaustSwatchMask: like paintMask, for the chrome/exhaust swatch
```

### shimmer (12.1a: heat-shimmer behind cars at high revs; larger tiles / Overview only)

```js
// in comicPipeline, base colour fetch, gated by tier.shimmer (tier L only; drop the node elsewhere)
const wob = vec2(mx_noise_float(vec3(screenUV.mul(vec2(40, 90)), time.mul(3))), mx_noise_float(vec3(screenUV.mul(vec2(55, 70)).add(7), time.mul(3.7)))).mul(look.shimmer.mul(0.004));
const base = colTex.sample(screenUV.add(wob.mul(heatMask)));   // heatMask: aState.w written into emissive.a via mrtNode, dilated upward 4 taps
```

### underglow, glowing roof number, weapon charge (12.1a emissive kit)

```js
// all feed the EMISSIVE target, so bloom handles them and the halftone skips them
material.emissiveNode = atlasEmissive.mul(1.6)
  .add(texture(roofNumberEmissive).rgb.mul(look.night))              // roof number glows at night: atlas region, 0 by day
  .add(aCar.xyz.mul(chargeSwatchMask).mul(aState.z).mul(2.0));       // weapon charge in the identity colour
// underglow: an unlit disc under the car, MeshBasicNodeMaterial, colour aCar.xyz, additive, drawn with the emissive-only mrtNode above
```

### boost-flame (12.1a: comic flame sprites + emissive cone; blue at full boost)

```js
const flame = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const v = uv(), n = mx_noise_float(vec3(v.x.mul(6), v.y.mul(3).sub(time.mul(9)), 0.0)).mul(0.5).add(0.5);
const shape = smoothstep(1.0, 0.0, v.y.add(n.mul(0.35)).sub(0.15));                  // v.y: 0 at the nozzle, 1 at the tip; ragged, shrinking
flame.colorNode = mix(uniform(new THREE.Color('#FF7A00')), uniform(new THREE.Color('#1E5BFF')), boost).mul(shape.mul(2.5));
flame.opacityNode = shape;                                                            // cone mesh behind the exhaust + 2-3 comic flame sprites
```

### sparks and embers (12.1a: GPU particles on scrapes, detaches, wreck bursts; embers linger)

WebGPU backend only (compute). Pattern and the "stamp / fade" gotcha: `../webgpu-threejs-tsl/docs/compute-shaders.md` and
`examples/particle-system.js`.

- `instancedArray(count, 'vec3')` for position and velocity, `'float'` for life. `count` is per-view effect detail, never a gameplay quota.
- Sim events (scrape, detach, wreck) append spawn rows to a small storage buffer each frame; the compute kernel consumes them.
- Embers: same kernel, longer life, low velocity, `positionLocal` snapped to the ground; they fade over seconds (debris itself never fades, only the glow).
- Draw as an `InstancedMesh` of small quads, `MeshBasicNodeMaterial`, colour ramp by life, through the transparent-effect trap above.
- WebGL2 backend / `WebGLRenderer`: no compute; update a `THREE.Points` buffer on the CPU with the same ramp.

### damage-glow (12.1a: glowing cracks, burning husks, flicker then smoulder)

```js
const w = mx_worley_noise_vec2(positionGeometry.mul(9));
const crack = smoothstep(0.08, 0.0, w.y.sub(w.x));                                    // cell-edge lines
const flicker = oscSine(time.mul(11).add(hash(instanceIndex).mul(6.28))).mul(0.3).add(0.7);
material.emissiveNode = base.add(uniform(new THREE.Color('#FF5A1A')).mul(crack).mul(aState.z).mul(flicker).mul(3.0));
// aState.z: sim writes 1 on wreck, decays over a few seconds to a smoulder floor (0.15); debris stays, only the glow fades. Smoke = sprites (trap above).
```

## World

### weather and time-of-day parameter sets (12.1a: sky and light, heat haze, dust storm, dusk/night)

Plain objects fed to `addDayRig` and the `look` uniforms; every set must pass the same readability captures.

| Set | haze / fog | sun (colour, intensity, elevation) | hemisphere | grade (`warm`, `vignette`) | emissive |
|---|---|---|---|---|---|
| day | `#F4DDB0`, 45-190 m | `#FFF1D6`, 2.1, about 43 deg | 1.5 | 0.35, 0.22 | x1 |
| dusk | `#F3A15C`, 30-150 m | `#FF9A4D`, 1.6, about 12 deg (long shadows) | 1.2, sky `#7A6CB0` | 0.6, 0.3 | x1.5 |
| night | `#1B2440`, 25-120 m | `#8FA8FF`, 0.5, about 35 deg | 0.5 | 0.1, 0.35 | x2.5, roof numbers on |
| dust storm | `#D9A441`, 8-60 m, animated density | day sun x0.6 | 1.2 | 0.5, 0.3 | x1.2 |

Heat haze on the horizon: the shimmer recipe with the mask a band around the horizon row of the camera
(`smoothstep` on `screenUV.y` against the projected horizon). Dust storm: `scene.fog = new THREE.FogExp2(...)` animated plus a
noise-scrolled fog density in a `fogNode`.

### ground (12.1a: sun-cracked clay, wind ripples, tyre tracks that accumulate, wet sheen)

```js
// cracked clay: dark cell edges from Worley F2-F1, posterised, tinted from tokens (ochre / sandstone)
const w = mx_worley_noise_vec2(positionWorld.xz.mul(0.7)), crack = smoothstep(0.07, 0.0, w.y.sub(w.x));
colorNode = mix(clayColor, crackColor, crack.mul(0.8));
// wind ripples: ridges along the wind direction, wobbled by low-frequency noise, stepped into two tones
const ripple = step(0.5, fract(positionWorld.x.mul(2.5).add(mx_noise_float(positionWorld.xz.mul(0.3)).mul(0.8))));
// wet sheen: one hard specular band in JjToonLightingModel.direct, spec = step(0.93, pow(max(dot(reflect(-L, N), V), 0), 40)) * wet
// tyre tracks: stamp wheel contact points into a ground-space storage texture (never faded, like debris) and sample it in
// the ground colourNode as a darker mix; use the stamp pattern in compute-shaders.md
```

### environment emissive (12.1a: servo signs, neon pub signs, flares, flood-warning markers)

```js
const flicker = step(0.97, hash(floor(time.mul(8)).add(instanceIndex))).mul(-1.2);   // occasional neon dropout
sign.emissiveNode = signColor.mul(float(1.8).add(flicker));                            // bloom does the rest
// flares at checkpoints: a sprite + emissive point (transparent-effect trap); flood-warning markers: oscSine(time.mul(3)) pulse on emissiveNode
```

### sky, foliage cards, limited-palette ground (12.1: graphic skies, stylised foliage, limited-palette ground per surface)

```js
// graphic sky: banded gradient so it reads as a comic panel, plus a hard sun disc
scene.backgroundNode = mix(horizonColor, zenithColor, floor(smoothstep(0.0, 0.7, screenUV.y.oneMinus()).mul(4)).div(4))
  .add(sunColor.mul(step(0.995, viewDirection.dot(sunDir))));
// foliage cards: two crossed quads, JjToonMaterial, alphaTest from the card texture; sway as in
// ../threejs-aaa-graphics-builder/references/shader-cookbook.md "Wind sway", ported to positionNode
// limited palette per surface: sample a 1-D palette strip authored from tokens by the surface's luminance
colorNode = texture(paletteStrip, vec2(luminance(albedo), 0.5)).rgb;
```

## GLSL route leftovers (the rendered GLSL route is in `recipes.md`)

`recipes.md` has the plain-`WebGLRenderer` route that was rendered: 40-texel ramp, paint key on `instanceColor`, grit,
halftone inside the toon material, normal+id+depth prepass, one `ShaderMaterial` quad (ink outlines, speed lines, grade).
Not ported and **not rendered**:

- **Selective bloom**: the standard approach (`webgl_postprocessing_unreal_bloom_selective`): render the emissive-only
  version of the scene (non-emissive materials swapped to black, or a layer), run `UnrealBloomPass` on it, add the result to
  the colour buffer before the outline quad. Expect a second scene render per frame; budget it in G-PERF.
- **Damage creep, hot metal, fringe, shimmer**: port the TSL maths line for line; per-car state rides an instanced
  attribute (`aState`) read in `onBeforeCompile`, exactly like the `aId` attribute in `main-glsl.js`.
  `mx_noise_float` becomes the small `jjNoise` in `glsl.js`; `mx_worley_noise_vec2` needs a hand-written Worley function.
- **FXAA**: run `three/addons/shaders/FXAAShader.js` on the display-referred result (it needs its own render target, because
  the quad currently tone-maps straight to the canvas).
- **Depth range**: `glsl.js` relies on `d = A - B / z` with `A = f / (f - n)`, `B = f n / (f - n)` for the 0..1 window depth
  of a perspective `DepthTexture`. That is the same relation WebGPU uses, which is why one edge formula serves both. If a
  reversed or logarithmic depth buffer is ever enabled, redo the derivation.
- **R10 decision input**: both routes passed the same captures (`hero.png` vs `glsl-hero.png`); the TSL route needs 4 MRT
  attachments (28 B/pixel) and r182-specific workarounds (`SKILL.md` traps), the GLSL route needs a prepass render of the
  cars and ground (vertex cost only) and no MRT. Measured numbers: `docs/evidence/P1-F11/README.md` (not a perf receipt).
