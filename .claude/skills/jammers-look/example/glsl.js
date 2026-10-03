// glsl.js: the same comic look for plain three.js WebGLRenderer (the GLSL route if P1-R01 picks WebGLRenderer).
// Differences from look.js: halftone lives in the toon material (no MRT needed), outlines read a normal+id+depth prepass,
// bloom/damage/shimmer are not ported here (see recipes-extra.md). Import map: index-glsl.html ('three' = three.module.js).
import * as THREE from 'three';

// region: glsl-tokens
export const INK = '#15203A';                          // art/ui/tokens.json palette.ink (same as look.js)
export const INK_PX = { tv: 4, desk: 3, handheld: 2.5 };
// endregion

// region: glsl-ramp
// 40-texel Nearest ramp: texel edges 19/40 and 29/40 are exactly n.l = -0.05 and 0.45 (u = n.l * 0.5 + 0.5)
export function makeRamp(tones = [0.40, 0.72, 1.0]) {
  const px = new Uint8Array(40 * 4);
  for (let i = 0; i < 40; i++) { const v = Math.round(255 * tones[i < 19 ? 0 : i < 29 ? 1 : 2]); px.set([v, v, v, 255], i * 4); }
  const t = new THREE.DataTexture(px, 40, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}
// endregion

// region: glsl-toon
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
// endregion

// region: glsl-pipeline
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
// endregion
