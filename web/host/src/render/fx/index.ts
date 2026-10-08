// The effects system (P1-R12): instanced billboard sprites (the WebGLRenderer route; TSL compute particles are the WebGPU
// port's), two draws for the whole field however many particles live, in the comic look: alpha puffs with an ink rim and a
// cel highlight, additive emissive flames, sparks, flashes and lamp glows. Fed by `update(sample)` from the vehicle renderer
// each drawn frame; `step`/`update` take the time explicitly so captures and tests replay them (`Fx.inspect()`, R90).
//
// Guard rails (§12.1a): effect detail scales with the tile (`uDetail` from the look's tier: small sparks and lamp glows
// drop out in the smallest tiles); particles fade out near the camera, so a follower's own dust never fills its screen;
// reduced motion tones flashes and sparks down. No particle cap: the pool grows with what the field emits.
import {
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  AdditiveBlending,
  NormalBlending,
  type Scene,
} from 'three';
import type { Sampled } from '../interp';
import { look, uniforms as lookUniforms } from '../look';
import { Emitter, type FxInput } from './emit';
import { envelope, FAMILIES, type Family } from './particles';

const VERT = /* glsl */ `
attribute vec4 aPos;   // xyz, size
attribute vec4 aCol;   // rgb (linear), alpha
attribute vec4 aMisc;  // rim (< 0: a hot sprite), age fraction, emissive (thinned only right at the lens), hot
varying vec4 vCol;
varying vec2 vUv;
varying vec2 vMisc;
varying float vHot;
uniform float uDetail;
void main() {
  vec4 mv = viewMatrix * vec4( aPos.xyz, 1.0 );
  float depth = -mv.z;
  // Big effects (smoke, fire, dust clouds) keep a minimum on-screen size, so a wreck's fire still reads from the overview
  // camera (hot ones larger still); small ones (sparks, lamp glints) stay true to size.
  float size = aPos.w > 0.5 ? max( aPos.w, depth * ( aMisc.w > 0.5 ? 0.024 : 0.012 ) ) : aPos.w;
  // Pulled toward the camera by most of its radius, so a sprite never sinks half into the ground or the car it sits on.
  mv.z += size * 0.6;
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  // Near the camera a sprite thins out: a follower's own dust never fills its screen. Emissive sprites (the boost flame
  // behind the followed car's bumper) only very near the lens.
  float near = aMisc.z > 0.5 ? smoothstep( 0.6, 2.2, depth ) : smoothstep( 1.6, 5.0, depth );
  // Small effects drop out in small tiles (effect detail scales with tile size).
  float small = uDetail < 0.5 ? smoothstep( 0.1, 0.3, aPos.w ) : 1.0;
  vCol = vec4( aCol.rgb, aCol.a * near * small );
  vUv = position.xy * 2.0;
  vMisc = aMisc.xy;
  vHot = aMisc.w;
}`;

const FRAG = /* glsl */ `
varying vec4 vCol;
varying vec2 vUv;
varying vec2 vMisc;
varying float vHot;
uniform vec3 uInk;
uniform float uAdd;
void main() {
  float r = length( vUv );
  if ( r > 1.0 || vCol.a < 0.01 ) discard;
  vec3 c = vCol.rgb;
  float a = vCol.a;
  if ( uAdd > 0.5 ) {
    // Emissive: a hot core and a soft edge (additive, so it only ever adds light).
    float core = 1.0 - smoothstep( 0.0, 1.0, r );
    gl_FragColor = vec4( c * ( 0.5 + 0.5 * core * core ), a * core );
  } else if ( vHot > 0.5 ) {
    // A hot sprite in daylight (flame, spark, flash): drawn, not added (added light washed out over sunlit ground), a
    // white-hot core over its colour, a soft edge.
    float core = 1.0 - smoothstep( 0.0, 0.75, r );
    c = mix( c, vec3( 1.0, 0.97, 0.88 ), core * core * 0.75 );
    gl_FragColor = vec4( c, a * ( 1.0 - smoothstep( 0.7, 1.0, r ) ) );
  } else {
    // A comic puff: a flat body lit from above (a two-tone step, no specular dot: a hard highlight read as a soap
    // bubble), a ring of ink all round (heavier on the shaded underside), opaque enough to read as a shape.
    float rim = vMisc.x;
    float lit = step( -0.1, vUv.y + 0.35 * vUv.x );
    c *= mix( 0.8, 1.06, lit );
    float edge = smoothstep( 0.8, 0.88, r ) * rim * ( 1.0 - 0.45 * lit );
    c = mix( c, uInk, edge * 0.85 );
    gl_FragColor = vec4( c, mix( a, min( 1.0, a * 1.6 ), edge ) );
  }
  #include <colorspace_fragment>
}`;

interface Layer {
  mesh: Mesh;
  geo: InstancedBufferGeometry;
  pos: InstancedBufferAttribute;
  col: InstancedBufferAttribute;
  misc: InstancedBufferAttribute;
  cap: number;
}

function layer(add: boolean): Layer {
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uInk: lookUniforms.uInk, uAdd: { value: add ? 1 : 0 }, uDetail: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: add ? AdditiveBlending : NormalBlending,
    fog: false,
    lights: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = add ? 11 : 10;
  mesh.name = add ? 'fx.add' : 'fx.alpha';
  // Per viewport, the look's tier decides how much detail survives.
  mesh.onBeforeRender = () => {
    mat.uniforms.uDetail!.value = look.tier.name === 'XS' || look.tier.name === 'S' ? 0 : 1;
  };
  const l: Layer = { mesh, geo, pos: null as never, col: null as never, misc: null as never, cap: 0 };
  resize(l, 256);
  return l;
}

function resize(l: Layer, cap: number): void {
  l.cap = cap;
  l.pos = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(35048);
  l.col = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(35048);
  l.misc = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(35048);
  l.geo.setAttribute('aPos', l.pos);
  l.geo.setAttribute('aCol', l.col);
  l.geo.setAttribute('aMisc', l.misc);
}

export class Fx {
  readonly emitter = new Emitter();
  private alpha = layer(false);
  private add = layer(true);
  private last = 0;
  /** Ground height for bounces; the map renderer's when one is loaded. */
  groundAt: (x: number, z: number) => number = () => 0;
  /** On with the look (default) or `?fx=on` over the plain look; off with `?fx=off` (backend.ts). */
  enabled = look.fxEnabled;

  constructor(private scene: Scene) {
    scene.add(this.alpha.mesh, this.add.mesh);
    if (typeof matchMedia === 'function') {
      const q = matchMedia('(prefers-reduced-motion: reduce)');
      this.emitter.reducedMotion = q.matches;
      q.addEventListener?.('change', (e) => (this.emitter.reducedMotion = e.matches));
    }
    this.alpha.mesh.visible = this.add.mesh.visible = false;
  }

  /** One drawn frame: emit from the sample, move the particles on, write the instance buffers. `now` in ms. */
  update(s: Sampled, now = performance.now()): void {
    if (!this.enabled) return;
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    this.advance(s as unknown as FxInput, dt);
  }

  /** The deterministic core of `update`: emit for `dt` seconds, then step. */
  advance(input: FxInput, dt: number): void {
    this.emitter.update(input, dt);
    this.emitter.step(dt, this.groundAt);
    this.write();
  }

  private write(): void {
    const p = this.emitter.pool;
    let na = 0;
    let nd = 0;
    for (let i = 0; i < p.n; i++) p.add[i] ? nd++ : na++;
    for (const [l, n] of [[this.alpha, na], [this.add, nd]] as const) {
      if (n > l.cap) {
        let cap = l.cap;
        while (cap < n) cap *= 2;
        resize(l, cap);
      }
    }
    let [ia, id] = [0, 0];
    for (let i = 0; i < p.n; i++) {
      const isAdd = p.add[i] === 1;
      const l = isAdd ? this.add : this.alpha;
      const k = isAdd ? id++ : ia++;
      const t = p.age[i]! / p.life[i]!;
      const pa = l.pos.array as Float32Array;
      const ca = l.col.array as Float32Array;
      const ma = l.misc.array as Float32Array;
      pa[k * 4] = p.x[i]!;
      pa[k * 4 + 1] = p.y[i]!;
      pa[k * 4 + 2] = p.z[i]!;
      pa[k * 4 + 3] = p.s0[i]! + (p.s1[i]! - p.s0[i]!) * t;
      for (let c = 0; c < 3; c++) ca[k * 4 + c] = p.c0[i * 3 + c]! + (p.c1[i * 3 + c]! - p.c0[i * 3 + c]!) * t;
      ca[k * 4 + 3] = p.alpha[i]! * (isAdd && p.life[i]! < 0.06 ? 1 : envelope(t));
      ma[k * 4] = p.rim[i]!;
      ma[k * 4 + 1] = t;
      const hot = p.rim[i]! < 0;
      ma[k * 4 + 2] = isAdd || hot ? 1 : 0;
      ma[k * 4 + 3] = hot ? 1 : 0;
    }
    for (const [l, n] of [[this.alpha, ia], [this.add, id]] as const) {
      l.geo.instanceCount = n;
      l.mesh.visible = n > 0;
      l.pos.needsUpdate = l.col.needsUpdate = l.misc.needsUpdate = true;
    }
  }

  /** Draws the effects add to one viewport (0, 1 or 2: a layer with nothing alive isn't drawn). */
  get drawsPerTile(): number {
    return (this.alpha.mesh.visible ? 1 : 0) + (this.add.mesh.visible ? 1 : 0);
  }

  /** Introspection (R90): what fired since the start, what is alive now, and the draw count. */
  inspect(): { spawned: Record<Family, number>; alive: Record<Family, number>; particles: number; capacity: number; drawsPerTile: number; reducedMotion: boolean; lastImpact: { car: number; at: [number, number, number] } | null; impactCars: number[] } {
    const p = this.emitter.pool;
    return { spawned: { ...p.spawned }, alive: p.alive(), particles: p.n, capacity: this.alpha.cap + this.add.cap, drawsPerTile: this.drawsPerTile, reducedMotion: this.emitter.reducedMotion, lastImpact: this.emitter.lastImpact, impactCars: [...this.emitter.impactCars] };
  }

  dispose(): void {
    this.scene.remove(this.alpha.mesh, this.add.mesh);
  }
}

export { FAMILIES };
