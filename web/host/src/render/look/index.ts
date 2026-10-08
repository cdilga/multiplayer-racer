// The in-world look (P1-R10), for the WebGLRenderer route the host ships on (backend.ts DEFAULT_BACKEND): the
// `jammers-look` recipes at material level, no screen post. See .claude/skills/jammers-look and
// art/ui/accepted/2026-10-07/poc/world/README.md (the accepted look and its cost measurement).
//   - a 3-tone toon ramp on the sun's light (flat colours stay flat: the ramp, not a gradient, shades a face);
//   - halftone dots in the sun's CAST shadows on static surfaces only (POC2-13: never a car's own shaded flank, so the
//     identity paint stays true; R108: the halftone sits under the car);
//   - sun-bleached grit and dust on the ground and kit (world-space noise, fades out under ~2 px);
//   - ink outlines as an inverted hull on the cars and the wayfinding kit (R108: mainly around the outside of the car),
//     a constant screen width per tile (`InkHull`);
//   - the scene's light rig, haze and a hand-inked sky.
// Per-tile cost tiers (jammers-look "Per-tile cost rules") are `tierFor(tileHeightPx)`; `look.tile(w, h)` is called
// before each viewport is drawn (backend.render does it) and switches the shared uniforms, so a tier never costs a pass.
import {
  BackSide,
  BufferAttribute,
  CanvasTexture,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Fog,
  HemisphereLight,
  InstancedMesh,
  type Mesh,
  ShaderChunk,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';

/** art/ui/tokens.json palette.ink. */
export const INK = '#15203A';

/** The toon ramp: tone by n.l band (the sun's key light; the hemisphere supplies the shade's fill). */
export const RAMP = { shadeBelow: 0.05, midBelow: 0.45, shade: 0.0, mid: 0.55, lit: 1.0 };

export interface Tier {
  name: 'L' | 'M' | 'S' | 'XS';
  /** Ink outline width in device pixels. */
  inkPx: number;
  /** Halftone cell in device pixels; 0 = off. */
  cell: number;
  /** Grit strength 0..1. */
  grit: number;
}

/** Cost tier by tile height in device pixels (jammers-look): L >= 540, M 270-540, S 110-270, XS < 110. */
export function tierFor(tileHeightPx: number): Tier {
  const h = tileHeightPx;
  if (h >= 540) return { name: 'L', inkPx: Math.min(6, Math.max(2.5, (4 * h) / 1080)), cell: 8, grit: 1 };
  if (h >= 270) return { name: 'M', inkPx: Math.max(2, (4 * h) / 1080), cell: 6, grit: 0.6 };
  if (h >= 110) return { name: 'S', inkPx: 1.5, cell: 0, grit: 0 };
  return { name: 'XS', inkPx: 1, cell: 0, grit: 0 };
}

/** The uniforms every look material shares: one set, switched per tile. */
export const uniforms = {
  uInk: { value: new Color(INK) },
  uCell: { value: 8 },
  uHalftone: { value: 1 },
  uGrit: { value: 1 },
  uInkPx: { value: 4 },
  uView: { value: new Vector2(1920, 1080) },
  /** The sun's colour times intensity: the reference a cast shadow darkens against. */
  uSun: { value: new Vector3(1, 1, 1) },
};

export const look = {
  uniforms,
  /** The tier the last `tile` call chose. */
  tier: tierFor(1080) as Tier,
  /** On by default on the WebGLRenderer route; off with `?look=plain` (backend.ts). */
  enabled: false,
  /** The effects' switch: the look's, or `?fx=on` alone. */
  fxEnabled: false,
  /** Switches the shared uniforms for a viewport `w` x `h` device pixels. */
  tile(w: number, h: number): Tier {
    const t = (this.tier = tierFor(h));
    uniforms.uView.value.set(w, h);
    uniforms.uInkPx.value = this.enabled ? t.inkPx : 0;
    uniforms.uCell.value = t.cell || 8;
    uniforms.uHalftone.value = this.enabled && t.cell > 0 ? 1 : 0;
    uniforms.uGrit.value = this.enabled ? t.grit : 0;
    return t;
  },
};

const W = 'vec3( 0.2126, 0.7152, 0.0722 )';

const RAMP_FN = /* glsl */ `
float jjShade = 0.0;
float jjRamp( float x ) { return x < ${RAMP.shadeBelow.toFixed(3)} ? ${RAMP.shade.toFixed(3)} : ( x < ${RAMP.midBelow.toFixed(3)} ? ${RAMP.mid.toFixed(3)} : ${RAMP.lit.toFixed(3)} ); }
`;
const NOISE = /* glsl */ `
float jjHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float jjNoise( vec3 x ) { vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( jjHash( i ), jjHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( jjHash( i + vec3( 0, 1, 0 ) ), jjHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( jjHash( i + vec3( 0, 0, 1 ) ), jjHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( jjHash( i + vec3( 0, 1, 1 ) ), jjHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }
`;
const GRIT = /* glsl */ `
{
  float lum = dot( diffuseColor.rgb, ${W} );
  vec3 sandy = mix( vec3( lum ), vec3( 0.88, 0.74, 0.55 ) * ( lum + 0.25 ), 0.55 );
  float blotch = smoothstep( 0.42, 0.58, jjNoise( vJjWorld * 0.35 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, sandy, 0.08 * uGrit * ( blotch * 0.6 + 0.4 ) );
  vec3 id = floor( vJjWorld * 5.0 ); float fleck = jjHash( id );
  float fade = 1.0 - smoothstep( 0.25, 0.6, length( fwidth( vJjWorld * 5.0 ) ) );
  diffuseColor.rgb *= 1.0 - step( 0.9, fleck ) * 0.08 * uGrit * fade;
  diffuseColor.rgb *= 1.0 + step( 0.985, fleck ) * 0.25 * uGrit * fade;
}`;
const HALFTONE = /* glsl */ `
{
  vec2 r = vec2( 0.70710678 * ( gl_FragCoord.x + gl_FragCoord.y ), 0.70710678 * ( gl_FragCoord.y - gl_FragCoord.x ) ) / uCell;
  float dist = length( fract( r ) - 0.5 );
  float radius = smoothstep( 0.42, 1.0, jjShade ) * 0.42;
  float aa = fwidth( dist ) * 0.75;
  float dots = 1.0 - smoothstep( radius - aa, radius + aa, dist );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( gl_FragColor.rgb * 0.5, uInk, 0.4 ), dots * uHalftone * 0.9 );
}`;

export interface ToonOptions {
  /** Dots in cast shadows (static ground and kit only; never cars). */
  halftone?: boolean;
  /** World-space sun-bleach blotches and flecks. */
  grit?: boolean;
}

/** Gives a Lambert or Standard material the ramp (and, optionally, halftone and grit), chaining any existing
 *  `onBeforeCompile` (the vehicles' paint key). Idempotent. */
export function toon<M extends Material>(material: M, opts: ToonOptions = {}): M {
  const m = material as M & { jjToon?: boolean };
  // Set in backend.ts before any material exists (on unless `?look=plain`): when off, the material is left exactly as it was.
  if (m.jjToon || !look.enabled) return material;
  m.jjToon = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.() ?? '';
  const physical = material.type !== 'MeshLambertMaterial';
  const chunk = physical ? 'lights_physical_pars_fragment' : 'lights_lambert_pars_fragment';
  const key = `${prevKey}|jj-toon-${chunk}-${opts.halftone ? 'h' : ''}${opts.grit ? 'g' : ''}`;
  material.onBeforeCompile = (sh, renderer) => {
    prev?.call(material, sh, renderer);
    Object.assign(sh.uniforms, uniforms);
    const needWorld = opts.grit;
    sh.vertexShader = (needWorld ? 'varying vec3 vJjWorld;\n' : '') + sh.vertexShader;
    if (needWorld)
      sh.vertexShader = sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        { vec4 jw = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            jw = instanceMatrix * jw;
          #endif
          vJjWorld = ( modelMatrix * jw ).xyz; }`,
      );
    const patched = ShaderChunk[chunk as 'lights_lambert_pars_fragment'].replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );', () =>
      opts.halftone
        ? `float jjRawNL = dot( geometryNormal, directLight.direction );
	float dotNL = jjRamp( jjRawNL );
	jjShade = max( jjShade, step( 0.05, jjRawNL ) * ( 1.0 - clamp( dot( directLight.color, ${W} ) / max( dot( uSun, ${W} ), 1e-4 ), 0.0, 1.0 ) ) );`
        : 'float dotNL = jjRamp( dot( geometryNormal, directLight.direction ) );',
    );
    sh.fragmentShader =
      `uniform vec3 uInk; uniform vec3 uSun; uniform float uCell, uHalftone, uGrit;\n${needWorld ? 'varying vec3 vJjWorld;\n' : ''}${NOISE}\n` +
      sh.fragmentShader
        .replace(`#include <${chunk}>`, () => RAMP_FN + patched)
        .replace('#include <color_fragment>', () => `#include <color_fragment>\n${opts.grit ? GRIT : ''}`)
        .replace('#include <opaque_fragment>', () => `#include <opaque_fragment>\n${opts.halftone ? HALFTONE : ''}`);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// ---- Ink outlines: an inverted hull ------------------------------------------------------------------------------

/** Per-vertex smoothed normals (area-weighted by position, so a flat-shaded low-poly mesh's hull has no cracks). */
export function smoothNormals(g: BufferGeometry): BufferAttribute {
  const pos = g.attributes.position as BufferAttribute;
  const index = g.index;
  const n = pos.count;
  const q = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const acc = new Map<string, [number, number, number]>();
  const tri = index ? index.count / 3 : n / 3;
  const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const p = [new Vector3(), new Vector3(), new Vector3()];
  const e1 = new Vector3();
  const e2 = new Vector3();
  const fn = new Vector3();
  for (let t = 0; t < tri; t++) {
    const idx = [at(t, 0), at(t, 1), at(t, 2)] as const;
    idx.forEach((v, k) => p[k]!.fromBufferAttribute(pos, v));
    fn.crossVectors(e1.subVectors(p[1]!, p[0]!), e2.subVectors(p[2]!, p[0]!)).normalize();
    if (!Number.isFinite(fn.x)) continue;
    // Each corner takes the face normal weighted by the angle there (area weighting skews a corner of unequal fans).
    for (let k = 0; k < 3; k++) {
      e1.subVectors(p[(k + 1) % 3]!, p[k]!).normalize();
      e2.subVectors(p[(k + 2) % 3]!, p[k]!).normalize();
      const w = Math.acos(Math.min(1, Math.max(-1, e1.dot(e2))));
      const key = q(idx[k]!);
      const e = acc.get(key) ?? acc.set(key, [0, 0, 0]).get(key)!;
      e[0] += fn.x * w;
      e[1] += fn.y * w;
      e[2] += fn.z * w;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const e = acc.get(q(i))!;
    const l = Math.hypot(e[0], e[1], e[2]) || 1;
    out.set([e[0] / l, e[1] / l, e[2] / l], i * 3);
  }
  return new BufferAttribute(out, 3);
}

const HULL_VERT = /* glsl */ `
attribute vec3 aSmooth;
uniform vec2 uView;
uniform float uInkPx;
void main() {
  mat4 mv = modelViewMatrix;
  #ifdef USE_INSTANCING
    mv = modelViewMatrix * instanceMatrix;
  #endif
  vec4 clip = projectionMatrix * ( mv * vec4( position, 1.0 ) );
  vec4 nc = projectionMatrix * vec4( mat3( mv ) * aSmooth, 0.0 );
  vec2 dir = nc.xy;
  float l = length( dir );
  dir = l > 1e-5 ? dir / l : vec2( 0.0 );
  // A constant width on screen: NDC is 2 units across the viewport, and clip.xy is divided by clip.w.
  clip.xy += dir * ( uInkPx * 2.0 / uView ) * clip.w;
  gl_Position = clip;
}`;
const HULL_FRAG = /* glsl */ `
uniform vec3 uInk;
void main() {
  gl_FragColor = vec4( uInk, 1.0 );
  #include <colorspace_fragment>
}`;

let hullMaterial: ShaderMaterial | null = null;
/** One material for every hull: the shared uniforms switch it per tile. */
export function inkMaterial(): ShaderMaterial {
  hullMaterial ??= new ShaderMaterial({
    vertexShader: HULL_VERT,
    fragmentShader: HULL_FRAG,
    side: BackSide,
    uniforms: { uInk: uniforms.uInk, uView: uniforms.uView, uInkPx: uniforms.uInkPx },
    fog: false,
    lights: false,
  });
  return hullMaterial;
}

/** An outline for an instanced mesh: the same geometry and instance matrices, pushed out along smoothed normals in
 *  screen space, back faces only. Draw calls scale with mesh types, never instances. Call `sync()` after the base mesh's
 *  instance buffer or count changes. */
export class InkHull {
  readonly mesh: InstancedMesh;
  readonly base: InstancedMesh;
  private geometry: BufferGeometry;

  constructor(base: InstancedMesh) {
    this.base = base;
    // The hull shares the base's attributes, plus the smoothed normal (stored once per geometry).
    this.geometry = base.geometry.clone();
    this.geometry.setAttribute('aSmooth', smoothNormals(base.geometry));
    this.mesh = new InstancedMesh(this.geometry, inkMaterial(), 1);
    this.mesh.name = `${base.name}.ink`;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = base.renderOrder;
    this.sync();
  }

  sync(): void {
    const m = this.mesh;
    if (m.instanceMatrix !== this.base.instanceMatrix) m.instanceMatrix = this.base.instanceMatrix;
    m.count = this.base.count;
    m.visible = this.base.visible && look.enabled;
    m.layers.mask = this.base.layers.mask;
  }
}

// ---- Light rig, haze, sky ---------------------------------------------------------------------------------------

/** The rig: warm sun, teal-blue sky fill over a warm earth bounce (the orange/teal split of jammers-look `rig`). */
export const RIG = {
  // Sun and sky together light an up-facing lit face to 1.0 x albedo (2.0/pi + 1.2/pi = 1.02), so the identity paint stays true.
  // Fury road (art/ui/accepted/2026-10-07/poc/world/shaders/looks.json): a warm low sun over a blue sky fill and a hot
  // earth bounce. The intensities stay the ones measured for true paint (identity check, eris 2026-10-08).
  sun: { colour: '#ffe2b8', intensity: 2.6 },
  sky: '#bfd3e8',
  ground: '#b0623a',
  hemi: 1.56, // measured on eris: 2.0 and 1.2 gave a lit roof 0.89 of its badge colour (sRGB), so both are raised by 1.3
  // The accepted Fury road look's dust haze (art/ui/accepted/2026-10-07/poc/world/shaders/looks.json, light.fog): 170-1100 m
  // left the horizon crisp in the engine captures, with no distance taken by the dust.
  haze: '#e9b98a',
  hazeNear: 160,
  hazeFar: 620,
};

const prepared = new WeakSet<Scene>();
let sun: DirectionalLight | null = null;

/** Applies the rig to a scene once: retunes the host's hemisphere and sun lights in place (it never adds a second sun),
 *  adds the haze and the sky. Safe to call every frame. */
export function prepareScene(scene: Scene): void {
  if (prepared.has(scene) || !look.enabled) return;
  prepared.add(scene);
  scene.traverse((o) => {
    // The host's plain ground (the land beyond the map) joins the look: ramp, cast-shadow dots and grit.
    const mat = (o as Mesh).material as Material | undefined;
    if ((o as Mesh).isMesh && mat?.type === 'MeshLambertMaterial') toon(mat, { halftone: true, grit: true });
    if ((o as HemisphereLight).isHemisphereLight) {
      const h = o as HemisphereLight;
      h.color.set(RIG.sky);
      h.groundColor.set(RIG.ground);
      h.intensity = RIG.hemi;
    } else if ((o as DirectionalLight).isDirectionalLight) {
      const s = o as DirectionalLight;
      s.color.set(RIG.sun.colour);
      s.intensity = RIG.sun.intensity;
      sun = s;
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.04;
    }
  });
  const c = new Color(RIG.sun.colour);
  uniforms.uSun.value.set(c.r * RIG.sun.intensity, c.g * RIG.sun.intensity, c.b * RIG.sun.intensity);
  scene.fog = new Fog(RIG.haze, RIG.hazeNear, RIG.hazeFar);
  scene.background = sky();
}

/** Keeps the sun's shadow box over the field: call each frame with the field's centre (metres). */
export function followSun(x: number, z: number): void {
  if (!sun || !look.enabled) return;
  sun.target.position.set(x, 0, z);
  // Low (about 32 degrees, Fury road's long shadows) and from the -z side: a chase camera behind a car heading +z sees its
  // rear lit. 32 rather than Fury road's 24 degrees keeps a car's roof and rear lit on most headings.
  sun.position.set(54 + x, 75, -107 + z);
  sun.target.updateMatrixWorld();
}

let skyTexture: CanvasTexture | null = null;

/** A hand-inked sky as an equirect background: a festival-blue gradient to a pale saffron horizon, and small inked
 *  cumulus 6-18 degrees up (accepted world look). A background texture stays out of fog and lighting. */
export function sky(): CanvasTexture {
  if (skyTexture) return skyTexture;
  const [w, h] = [4096, 2048];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  // Fury road's sky: deep blue overhead, a warm dusty band low down, the haze at the horizon (rows: 0 = straight up,
  // 0.5 = the horizon). A chase camera sees roughly 0.33 to 0.5, so the warm band starts low.
  grad.addColorStop(0, '#2b6db4');
  grad.addColorStop(0.24, '#3a7fc0');
  grad.addColorStop(0.38, '#5c9ed8');
  grad.addColorStop(0.455, '#d9bc98');
  grad.addColorStop(0.5, RIG.haze);
  grad.addColorStop(1, '#c9895a');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // Equirect: 4096 px is 360 degrees, so 11.4 px a degree; row = (90 - elevation) / 180 of the height.
  const rowOf = (elevDeg: number) => ((90 - elevDeg) / 180) * h;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  g.lineJoin = 'round';
  const clouds = 34;
  for (let k = 0; k < clouds; k++) {
    const x = (k / clouds) * w + rnd() * 50;
    const y = rowOf(8 + rnd() * 14);
    const s = 14 + rnd() * 16; // a puff radius: 1.2 to 2.7 degrees
    const puffs: [number, number, number][] = [
      [-1.1, 0.1, 0.7],
      [-0.4, -0.35, 0.95],
      [0.5, -0.2, 0.85],
      [1.2, 0.12, 0.65],
    ];
    for (const ox of [0, -w, w]) {
      // The ink first (every puff stroked fat), then the fill over it: only the cloud's outer outline survives.
      g.fillStyle = INK;
      for (const [dx, dy, r] of puffs) {
        g.beginPath();
        g.arc(x + ox + dx * s, y + dy * s, r * s + 3.5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#f4ecd8';
      for (const [dx, dy, r] of puffs) {
        g.beginPath();
        g.arc(x + ox + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
        g.fill();
      }
      // The flat underside: a paper-shade band so it reads as a toon cloud.
      g.save();
      g.beginPath();
      g.rect(x + ox - 2.6 * s, y + 0.3 * s, 5.2 * s, 1.4 * s);
      g.clip();
      g.fillStyle = '#d9cdb2';
      for (const [dx, dy, r] of puffs) {
        g.beginPath();
        g.arc(x + ox + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }
  skyTexture = new CanvasTexture(c);
  skyTexture.mapping = EquirectangularReflectionMapping;
  skyTexture.colorSpace = SRGBColorSpace;
  skyTexture.anisotropy = 4;
  return skyTexture;
}
