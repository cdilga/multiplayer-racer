// Presentation particles (P1-R12): a CPU pool of billboard sprites. No gameplay entity quota and no particle cap: the pool
// grows by doubling with what the field emits (effect detail scales with tile size in the shader, not in a count).
// Debris stays physics (S04); these are smoke, dust, sparks, flashes, flame and glow, never read back by the sim.
// Pure data and maths (no GL), so node tests step it deterministically.

/** The effect families the captures and the tests name (every one of the bead's list). */
export const FAMILIES = [
  'dust', // surface dust and gravel spray behind the wheels
  'tyre-smoke', // drift and handbrake
  'landing', // landing puffs
  'boost', // boost flame (blue at full) and its glow
  'sparks', // scrapes
  'impact', // the flash and puff at a damage episode, scaled by impulse
  'detach', // the burst when a part comes off
  'damage-smoke', // smoke from a badly damaged car
  'wreck-fire', // fire and smoulder on a husk
  'lamp', // head, tail and brake lamps, as emissive glow
] as const;
export type Family = (typeof FAMILIES)[number];

/** How a particle is drawn: `alpha` over the scene with an ink rim (comic puffs), `add` as emissive light. */
export type Blend = 'alpha' | 'add';

export interface Spawn {
  family: Family;
  blend: Blend;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size0: number;
  size1: number;
  /** Linear-light colours at birth and death, and alpha at its peak. */
  c0: [number, number, number];
  c1: [number, number, number];
  alpha: number;
  /** Velocity kept per second (1 = none lost). */
  drag?: number;
  /** Gravity, m/s^2 (down positive); smoke rises with a negative one. */
  gravity?: number;
  /** Ink rim 0..1 on the sprite (comic puffs). */
  rim?: number;
  /** Where a bouncing particle rests; default the map's ground there. */
  floor?: number;
}

/** Structure-of-arrays pool; `step` ages, moves and compacts it, `fill` writes the instance attributes. */
export class Pool {
  n = 0;
  cap = 0;
  x = new Float32Array(0);
  y = new Float32Array(0);
  z = new Float32Array(0);
  vx = new Float32Array(0);
  vy = new Float32Array(0);
  vz = new Float32Array(0);
  age = new Float32Array(0);
  life = new Float32Array(0);
  s0 = new Float32Array(0);
  s1 = new Float32Array(0);
  c0 = new Float32Array(0);
  c1 = new Float32Array(0);
  alpha = new Float32Array(0);
  drag = new Float32Array(0);
  grav = new Float32Array(0);
  rim = new Float32Array(0);
  /** The height a bouncing particle (gravity > 0) rests on: where it was born, as the car stands on the ground. */
  floor = new Float32Array(0);
  fam = new Uint8Array(0);
  /** 1 = additive (emissive), 0 = alpha. */
  add = new Uint8Array(0);
  /** Total spawned since creation, per family: the captures' and tests' proof an effect fired. */
  spawned: Record<Family, number> = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;

  private grow(): void {
    const cap = Math.max(256, this.cap * 2);
    const f = (a: Float32Array, k = 1) => {
      const b = new Float32Array(cap * k);
      b.set(a);
      return b;
    };
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'alpha', 'drag', 'grav', 'rim', 'floor'] as const) this[k] = f(this[k]);
    this.c0 = f(this.c0, 3);
    this.c1 = f(this.c1, 3);
    for (const k of ['fam', 'add'] as const) {
      const b = new Uint8Array(cap);
      b.set(this[k]);
      this[k] = b;
    }
    this.cap = cap;
  }

  spawn(p: Spawn): void {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.x[i] = p.x;
    this.y[i] = p.y;
    this.z[i] = p.z;
    this.vx[i] = p.vx;
    this.vy[i] = p.vy;
    this.vz[i] = p.vz;
    this.age[i] = 0;
    this.life[i] = p.life;
    this.s0[i] = p.size0;
    this.s1[i] = p.size1;
    this.c0.set(p.c0, i * 3);
    this.c1.set(p.c1, i * 3);
    this.alpha[i] = p.alpha;
    this.drag[i] = p.drag ?? 1;
    this.grav[i] = p.gravity ?? 0;
    this.rim[i] = p.rim ?? 0;
    this.floor[i] = p.floor ?? Number.NaN;
    this.fam[i] = FAMILIES.indexOf(p.family);
    this.add[i] = p.blend === 'add' ? 1 : 0;
    this.spawned[p.family]++;
  }

  /** Ages and moves every particle by `dt` seconds and drops the dead (swap with the last). */
  step(dt: number, groundAt: (x: number, z: number) => number = () => 0): void {
    for (let i = 0; i < this.n; ) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) {
        const l = --this.n;
        if (i !== l) this.copy(l, i);
        continue;
      }
      const k = Math.pow(this.drag[i]!, dt);
      this.vx[i]! *= k;
      this.vz[i]! *= k;
      this.vy[i] = this.vy[i]! * k + this.grav[i]! * -dt;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.z[i]! += this.vz[i]! * dt;
      // Sparks and pebbles bounce off the ground rather than sinking into it.
      if (this.grav[i]! > 0) {
        const g = (Number.isNaN(this.floor[i]!) ? groundAt(this.x[i]!, this.z[i]!) : this.floor[i]!) + 0.03;
        if (this.y[i]! < g) {
          this.y[i] = g;
          this.vy[i] = Math.abs(this.vy[i]!) * 0.35;
        }
      }
      i++;
    }
  }

  private copy(from: number, to: number): void {
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'alpha', 'drag', 'grav', 'rim', 'floor'] as const) this[k][to] = this[k][from]!;
    this.c0.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.c1.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.fam[to] = this.fam[from]!;
    this.add[to] = this.add[from]!;
  }

  /** Counts alive per family. */
  alive(): Record<Family, number> {
    const out = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;
    for (let i = 0; i < this.n; i++) out[FAMILIES[this.fam[i]!]!]++;
    return out;
  }

  clear(): void {
    this.n = 0;
  }
}

/** The fade a particle shows at age fraction t: a quick fade in, a long fade out. */
export function envelope(t: number): number {
  return Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
}

/** A small seeded RNG (mulberry32): effects are presentation, but captures and tests replay them. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
