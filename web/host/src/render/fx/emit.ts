// What each effect family looks for in the snapshot (P1-R12). All of it is derived from state the renderer already has:
// car pose, linear velocity, the flags (bit 16 boosting, 32 drifting, bits 6-7 the ground under it), the boost meter, the
// throttle, the part records (loose, detached) and the husks. No sim events and no sim writes: an effect that can't be
// seen in the snapshot isn't drawn. Rules (§12.1a): emissive informs first and decorates second; comic effects never cover
// identity or the road ahead (dust stays low and behind, lamp glows are lamp-sized, flashes live 0.14 s); reduced motion
// tones flashes and sparks down.
import type { Frame } from '../snapshot';
import { PART_DETACHED, PART_LOOSE, PIECE_HUSK } from '../snapshot';
import { envelope, Pool, rng, type Spawn } from './particles';

export const FLAG_BOOSTING = 16;
export const FLAG_DRIFTING = 32;
/** Bits 6-7 of the flags: the ground under the car (0 tarmac, 1 dirt, 2 gravel). */
export const surfaceOf = (flags: number) => (flags >> 6) & 3;

/** What an update reads: the interpolated sample's arrays, and the newer frame carrying velocity, parts and husks. */
export interface FxInput {
  cars: number;
  id: ArrayLike<number>;
  flags: ArrayLike<number>;
  pos: ArrayLike<number>;
  rot: ArrayLike<number>;
  frame: Frame | null;
}

/** Linear-light colours of the palette (art/ui/tokens.json world colours, then brightened for dust). */
const C = {
  tarmacDust: [0.62, 0.6, 0.57] as [number, number, number],
  dirtDust: [0.82, 0.52, 0.3] as [number, number, number],
  dirtDustEnd: [0.86, 0.68, 0.5] as [number, number, number],
  gravel: [0.42, 0.32, 0.22] as [number, number, number],
  smoke: [0.92, 0.9, 0.86] as [number, number, number],
  smokeEnd: [0.62, 0.6, 0.58] as [number, number, number],
  dark: [0.1, 0.1, 0.11] as [number, number, number],
  darkEnd: [0.2, 0.19, 0.19] as [number, number, number],
  spark: [1.0, 0.82, 0.3] as [number, number, number],
  sparkEnd: [1.0, 0.25, 0.05] as [number, number, number],
  flash: [1.0, 0.95, 0.75] as [number, number, number],
  flashEnd: [1.0, 0.6, 0.2] as [number, number, number],
  flame: [1.0, 0.8, 0.3] as [number, number, number],
  flameEnd: [1.0, 0.2, 0.04] as [number, number, number],
  blue: [0.5, 0.85, 1.0] as [number, number, number],
  blueEnd: [0.1, 0.3, 1.0] as [number, number, number],
  tail: [1.0, 0.1, 0.08] as [number, number, number],
  head: [1.0, 0.93, 0.7] as [number, number, number],
};

interface CarState {
  /** Fractional spawns carried between frames, per rate-driven family. */
  carry: Record<string, number>;
  vy: number;
  /** Where the car last stood with level vertical speed: the ground it drives on (the snapshot has no terrain). */
  groundY: number;
  speed: number;
  vel: [number, number, number];
  tick: number;
  life: number;
  /** Non-intact part count and the state of each part, to see a part newly come loose or off. */
  parts: Map<number, number>;
  seen: boolean;
}

/** Spawns into a pool from successive snapshots. `step(dt)` is separate, so a test drives time exactly. */
export class Emitter {
  readonly pool = new Pool();
  /** Reduced motion: flashes and sparks tone down (the host's OS setting). */
  reducedMotion = false;
  private cars = new Map<number, CarState>();
  private husks = new Set<number>();
  private rand = rng(0x4a4a);

  /** Seeds the generator (captures and tests). */
  seed(n: number): void {
    this.rand = rng(n);
  }

  private state(id: number): CarState {
    let s = this.cars.get(id);
    if (!s) this.cars.set(id, (s = { carry: {}, vy: 0, groundY: Number.NaN, speed: 0, vel: [0, 0, 0], tick: 0, life: -1, parts: new Map(), seen: false }));
    return s;
  }

  /** Emits `rate * dt` particles (carrying the fraction) by calling `make` for each. */
  private rate(s: CarState, key: string, rate: number, dt: number, make: () => void): void {
    const n = (s.carry[key] ?? 0) + rate * dt;
    const whole = Math.floor(n);
    s.carry[key] = n - whole;
    for (let i = 0; i < whole; i++) make();
  }

  /** The ground under the car being emitted for (the car's origin stands on it). */
  private curFloor = 0;
  private spawn(p: Spawn): void {
    this.pool.spawn(p.gravity !== undefined && p.gravity > 0 && p.floor === undefined ? { ...p, floor: this.curFloor } : p);
  }

  private jitter(a: number): number {
    return (this.rand() - 0.5) * 2 * a;
  }

  /** Reads one snapshot sample and emits for `dt` seconds of it. */
  update(inp: FxInput, dt: number): void {
    const f = inp.frame;
    const calm = this.reducedMotion ? 0.35 : 1;
    // Parts that aren't intact, per car id, from the frame's part records.
    const broken = new Map<number, Map<number, { state: number; pos: [number, number, number] }>>();
    for (let k = 0; f && k < f.parts; k++) {
      const car = f.partCar[k]!;
      const m = broken.get(car) ?? broken.set(car, new Map()).get(car)!;
      m.set(f.partIndex[k]!, { state: f.partState[k]!, pos: [f.partPos[k * 3]!, f.partPos[k * 3 + 1]!, f.partPos[k * 3 + 2]!] });
    }
    for (let i = 0; i < inp.cars; i++) {
      const id = inp.id[i]!;
      const st = this.state(id);
      const wasSeen = st.seen;
      const flags = inp.flags[i]!;
      const [px, py, pz] = [inp.pos[i * 3]!, inp.pos[i * 3 + 1]!, inp.pos[i * 3 + 2]!];
      const [qx, qy, qz, qw] = [inp.rot[i * 4]!, inp.rot[i * 4 + 1]!, inp.rot[i * 4 + 2]!, inp.rot[i * 4 + 3]!];
      // Car-space to world: forward (+z), right is -x (the sidecar's left wheels are +x), up.
      const rotate = (x: number, y: number, z: number): [number, number, number] => {
        const tx = 2 * (qy * z - qz * y);
        const ty = 2 * (qz * x - qx * z);
        const tz = 2 * (qx * y - qy * x);
        return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
      };
      const at = (x: number, y: number, z: number): [number, number, number] => {
        const r = rotate(x, y, z);
        return [px + r[0], py + r[1], pz + r[2]];
      };
      const vel: [number, number, number] = f ? [f.vel[i * 3]!, f.vel[i * 3 + 1]!, f.vel[i * 3 + 2]!] : [0, 0, 0];
      const speed = Math.hypot(vel[0], vel[2]);
      const respawned = st.life !== -1 && f !== null && f.life[i] !== st.life;
      if (f) st.life = f.life[i]!;
      // The snapshot's own clock: a new tick is a new velocity, so the decelerations are per tick, not per drawn frame.
      const newTick = f !== null && f.tick !== st.tick;
      const dvx = vel[0] - st.vel[0];
      const dvy = vel[1] - st.vel[1];
      const dvz = vel[2] - st.vel[2];
      // Speed lost along the old heading: an impact or a scrape (gaining speed, or only falling, isn't one).
      const hv = Math.hypot(st.vel[0], st.vel[2]) || 1;
      const dv = Math.max(0, -(dvx * st.vel[0] + dvz * st.vel[2]) / hv);
      if (Number.isNaN(st.groundY) || Math.abs(vel[1]) < 1.2) st.groundY = py;
      const ground = st.groundY;
      this.curFloor = ground;
      const airborne = py - ground > 0.9 || vel[1] > 3;
      const surface = surfaceOf(flags);
      const kicked = (n: number) => Math.max(0, Math.min(1, n));

      if (wasSeen && !respawned && newTick) {
        // Contact: a sudden loss of velocity in one tick is an impact (an impulse of mass x dv); scaled by dv.
        if (dv > 3.2 && st.speed > 4) this.impact([px + (st.vel[0] / hv) * 2, py + 0.6, pz + (st.vel[2] / hv) * 2], dv, calm, vel);
        // Landing: falling, then not.
        if (st.vy < -3.5 && vel[1] > -1.2) this.landing(px, pz, ground, py, Math.min(1, -st.vy / 9), surface);
        // A scrape: grinding speed away without a hard hit.
        if (dv > 0.5 && dv <= 3.2 && st.speed > 6 && !airborne) this.scrape(at, vel, dv, calm);
      }
      if (newTick) {
        st.vy = vel[1];
        st.vel = vel;
        st.speed = speed;
        st.tick = f!.tick;
      }
      st.seen = true;

      // ---- Driving: dust and spray behind the wheels (light on tarmac, red on dirt, gravel spray) ------------------
      if (!airborne && speed > 4.5) {
        const k = kicked((speed - 4.5) / 20);
        const dust = surface === 1 ? 46 : surface === 2 ? 26 : speed > 13 ? 7 : 0;
        for (const side of [0.85, -0.85]) {
          this.rate(st, `dust${side}`, dust * k, dt, () => {
            const w = at(side, 0.12, -1.55);
            const back = rotate(0, 0, -1);
            const c0 = surface === 1 ? C.dirtDust : surface === 2 ? C.gravel : C.tarmacDust;
            this.spawn({
              family: 'dust', blend: 'alpha', x: w[0], y: w[1], z: w[2],
              vx: -vel[0] * 0.2 + back[0] * 1.2 + this.jitter(0.9), vy: 0.5 + this.rand() * 0.7, vz: -vel[2] * 0.2 + back[2] * 1.2 + this.jitter(0.9),
              life: 0.9 + this.rand() * 0.6, size0: 0.55, size1: surface === 1 ? 2.0 : 1.5, c0, c1: surface === 1 ? C.dirtDustEnd : C.smokeEnd,
              alpha: surface === 1 ? 0.8 : 0.5, drag: 0.35, gravity: -0.15, rim: 0.6,
            });
          });
          if (surface === 2)
            this.rate(st, `pebble${side}`, 20 * k, dt, () => {
              const w = at(side, 0.15, -1.5);
              this.spawn({
                family: 'dust', blend: 'alpha', x: w[0], y: w[1], z: w[2],
                vx: -vel[0] * 0.15 + this.jitter(1.6), vy: 2 + this.rand() * 2.5, vz: -vel[2] * 0.3 + this.jitter(1.6),
                life: 0.7, size0: 0.07, size1: 0.07, c0: C.gravel, c1: C.gravel, alpha: 1, drag: 0.9, gravity: 14, rim: 0,
              });
            });
        }
      }
      // ---- Tyre smoke: drift and handbrake --------------------------------------------------------------------------
      if (flags & FLAG_DRIFTING && !airborne && speed > 3) {
        for (const side of [0.85, -0.85])
          this.rate(st, `smoke${side}`, 55, dt, () => {
            const w = at(side, 0.2, -1.34);
            this.spawn({
              family: 'tyre-smoke', blend: 'alpha', x: w[0], y: w[1], z: w[2],
              vx: -vel[0] * 0.1 + this.jitter(0.7), vy: 0.7 + this.rand() * 0.8, vz: -vel[2] * 0.1 + this.jitter(0.7),
              life: 1.1 + this.rand() * 0.6, size0: 0.6, size1: 2.8, c0: C.smoke, c1: C.smokeEnd, alpha: 0.8, drag: 0.4, gravity: -0.2, rim: 0.7,
            });
          });
      }
      // ---- Boost: an emissive flame, blue at full ---------------------------------------------------------------------
      if (flags & FLAG_BOOSTING) {
        const full = f ? f.boost[i]! >= 0.9 : false;
        for (const side of [0.3, -0.3])
          this.rate(st, `flame${side}`, 90, dt, () => {
            const e = at(side, 0.5, -2.25);
            const back = rotate(0, 0, -1);
            this.spawn({
              family: 'boost', blend: 'add', x: e[0], y: e[1], z: e[2],
              vx: back[0] * 7 + vel[0] * 0.92 + this.jitter(0.4), vy: this.jitter(0.3), vz: back[2] * 7 + vel[2] * 0.92 + this.jitter(0.4),
              life: 0.3 + this.rand() * 0.1, size0: 0.6, size1: 0.14, c0: full ? C.blue : C.flame, c1: full ? C.blueEnd : C.flameEnd, alpha: 0.95, drag: 0.15,
            });
          });
      }

      // ---- Damage: parts newly loose or detached, then smoke from a badly damaged car ---------------------------------
      const parts = broken.get(id);
      let nonIntact = 0;
      if (parts) {
        for (const [part, p] of parts) {
          if (p.state !== PART_LOOSE && p.state !== PART_DETACHED) continue;
          nonIntact++;
          const before = st.parts.get(part);
          if (wasSeen && !respawned && before !== p.state && (before === undefined || p.state === PART_DETACHED)) {
            if (p.state === PART_DETACHED) this.detach(p.pos[0] === 0 && p.pos[2] === 0 ? at(0, 0.7, 0) : p.pos, calm);
            else this.puff(at(0, 0.7, 0.9), 0.5, C.smoke);
          }
          st.parts.set(part, p.state);
        }
        for (const part of [...st.parts.keys()]) if (!parts.has(part)) st.parts.delete(part);
      } else if (st.parts.size) st.parts.clear();
      if (nonIntact >= 2) {
        const k = Math.min(1, nonIntact / 5);
        this.rate(st, 'dsmoke', 8 + 16 * k, dt, () => {
          const e = at(this.jitter(0.3), 1.05, 1.0);
          this.spawn({
            family: 'damage-smoke', blend: 'alpha', x: e[0], y: e[1], z: e[2],
            vx: vel[0] * 0.5 + this.jitter(0.25), vy: 1.3 + this.rand() * 0.6, vz: vel[2] * 0.5 + this.jitter(0.25),
            life: 1.5 + this.rand(), size0: 0.5, size1: 1.8, c0: C.dark, c1: C.darkEnd, alpha: 0.65 + 0.2 * k, drag: 0.5, gravity: -0.4, rim: 0.8,
          });
        });
      }

      // ---- Lamps: head, tail and brake as emissive glow (lamp-sized, so they never cover the car's identity) ----------
      if (dt > 0) {
        const braking = f ? f.throttle[i]! < 0.05 && speed > 2.5 : false;
        for (const sx of [0.7, -0.7]) {
          const t = at(sx, 0.78, -2.17);
          this.glow(t, braking ? 0.62 : 0.3, braking ? 1 : 0.55, C.tail, dt);
          const h = at(sx, 0.72, 2.12);
          this.glow(h, 0.34, 0.7, C.head, dt);
        }
      }
    }
    // ---- Wrecks: fire and a smouldering glow on every husk; the husk stays for the round ------------------------------
    this.husks.clear();
    for (let k = 0; f && k < f.pieces; k++) {
      if (f.piecePart[k] !== PIECE_HUSK) continue;
      const car = f.pieceCar[k]!;
      this.husks.add(car);
      const st = this.state(car * 1000 + 7); // husks have their own carry (their car id may be live again after a rebuild)
      const [hx, hy, hz] = [f.piecePos[k * 3]!, f.piecePos[k * 3 + 1]!, f.piecePos[k * 3 + 2]!];
      this.rate(st, 'fire', 38, dt, () => {
        this.spawn({
          family: 'wreck-fire', blend: 'add', x: hx + this.jitter(0.7), y: hy + 1.0 + this.rand() * 0.3, z: hz + this.jitter(1.1),
          vx: this.jitter(0.3), vy: 1.8 + this.rand() * 1.2, vz: this.jitter(0.3), life: 0.55 + this.rand() * 0.3, size0: 1.2, size1: 0.3,
          c0: C.flame, c1: C.flameEnd, alpha: 0.9, drag: 0.6,
        });
      });
      this.rate(st, 'wsmoke', 9, dt, () => {
        this.spawn({
          family: 'wreck-fire', blend: 'alpha', x: hx + this.jitter(0.6), y: hy + 1.0, z: hz + this.jitter(0.9),
          vx: this.jitter(0.3), vy: 1.6 + this.rand() * 0.7, vz: this.jitter(0.3), life: 2.4, size0: 1.0, size1: 3.6, c0: C.dark, c1: C.darkEnd, alpha: 0.55,
          drag: 0.6, gravity: -0.3, rim: 0.8,
        });
      });
      // The smoulder: a slow pulsing glow over the husk, one sprite per frame.
      if (dt > 0) this.glow([hx, hy + 0.55, hz], 2.6 + 0.4 * Math.sin(f.tick / 14), 0.35, C.flameEnd, dt, 'wreck-fire');
    }
  }

  /** One frame's lamp or smoulder glow: a sprite living just past this frame, so it follows its car exactly. */
  private glow(p: [number, number, number], size: number, alpha: number, colour: [number, number, number], dt: number, family: 'lamp' | 'wreck-fire' = 'lamp'): void {
    this.spawn({ family, blend: 'add', x: p[0], y: p[1], z: p[2], vx: 0, vy: 0, vz: 0, life: Math.max(dt * 1.5, 0.02), size0: size, size1: size, c0: colour, c1: colour, alpha });
  }

  private puff(p: [number, number, number], size: number, colour: [number, number, number]): void {
    for (let k = 0; k < 4; k++)
      this.spawn({
        family: 'impact', blend: 'alpha', x: p[0], y: p[1], z: p[2], vx: this.jitter(1.6), vy: 0.6 + this.rand(), vz: this.jitter(1.6),
        life: 0.7 + this.rand() * 0.3, size0: size * 0.5, size1: size * 2, c0: colour, c1: C.smokeEnd, alpha: 0.5, drag: 0.3, gravity: -0.1, rim: 0.7,
      });
  }

  /** The impact flash and puff of a damage episode, scaled by the impulse (the velocity change, m/s). */
  private impact(p: [number, number, number], dv: number, calm: number, vel: [number, number, number]): void {
    const k = Math.min(1, dv / 14);
    this.spawn({ family: 'impact', blend: 'add', x: p[0], y: p[1], z: p[2], vx: 0, vy: 0, vz: 0, life: 0.14, size0: (0.7 + 1.9 * k) * calm, size1: (0.3 + 1.2 * k) * calm, c0: C.flash, c1: C.flashEnd, alpha: 0.95 * calm });
    this.puff(p, 0.5 + 0.9 * k, C.smoke);
    const n = Math.round((6 + 30 * k) * calm);
    for (let j = 0; j < n; j++) this.spark(p, 4 + 7 * k, vel);
  }

  private spark(p: [number, number, number], speed: number, vel: [number, number, number]): void {
    const a = this.rand() * Math.PI * 2;
    const up = this.rand() * 0.9 + 0.1;
    this.spawn({
      family: 'sparks', blend: 'add', x: p[0], y: p[1], z: p[2],
      vx: vel[0] * 0.3 + Math.cos(a) * speed * (1 - up * 0.5), vy: speed * up, vz: vel[2] * 0.3 + Math.sin(a) * speed * (1 - up * 0.5),
      life: 0.35 + this.rand() * 0.35, size0: 0.16, size1: 0.05, c0: C.spark, c1: C.sparkEnd, alpha: 1, drag: 0.5, gravity: 12,
    });
  }

  private scrape(at: (x: number, y: number, z: number) => [number, number, number], vel: [number, number, number], dv: number, calm: number): void {
    const n = Math.max(1, Math.round(Math.min(6, dv * 2) * calm));
    for (let j = 0; j < n; j++) this.spark(at(this.rand() < 0.5 ? 0.9 : -0.9, 0.25, this.jitter(1.8)), 3 + dv, vel);
  }

  private landing(x: number, z: number, ground: number, y: number, k: number, surface: number): void {
    const c0 = surface === 1 ? C.dirtDust : surface === 2 ? C.gravel : C.tarmacDust;
    const gy = Math.min(y, ground + 0.15);
    for (let j = 0; j < 8 + Math.round(10 * k); j++) {
      const a = (j / 14) * Math.PI * 2 + this.rand();
      this.spawn({
        family: 'landing', blend: 'alpha', x: x + Math.cos(a) * 0.6, y: gy, z: z + Math.sin(a) * 0.6,
        vx: Math.cos(a) * (2 + 2.5 * k), vy: 0.4 + this.rand() * 0.6, vz: Math.sin(a) * (2 + 2.5 * k),
        life: 0.8 + 0.3 * k, size0: 0.5, size1: 1.6 + 1.2 * k, c0, c1: surface === 1 ? C.dirtDustEnd : C.smokeEnd, alpha: 0.75, drag: 0.2, gravity: -0.1, rim: 0.6,
      });
    }
  }

  /** A part coming off: a flash, a puff and a burst of sparks at its pose. */
  private detach(p: [number, number, number], calm: number): void {
    this.spawn({ family: 'detach', blend: 'add', x: p[0], y: p[1], z: p[2], vx: 0, vy: 0, vz: 0, life: 0.16, size0: 1.3 * calm, size1: 0.5 * calm, c0: C.flash, c1: C.flashEnd, alpha: 0.9 * calm });
    for (let k = 0; k < 4; k++)
      this.spawn({
        family: 'detach', blend: 'alpha', x: p[0], y: p[1], z: p[2], vx: this.jitter(2), vy: 0.8 + this.rand(), vz: this.jitter(2),
        life: 0.8, size0: 0.4, size1: 1.5, c0: C.smoke, c1: C.smokeEnd, alpha: 0.5, drag: 0.3, gravity: -0.1, rim: 0.7,
      });
    const n = Math.round(14 * calm);
    for (let k = 0; k < n; k++) this.spark(p, 6, [0, 0, 0]);
  }

  /** Moves the pool on by `dt`. */
  step(dt: number, groundAt?: (x: number, z: number) => number): void {
    this.pool.step(dt, groundAt);
  }

  /** The cars' impact state forgets a car that left (a room's seat gone). */
  forget(live: ArrayLike<number>, n: number): void {
    const keep = new Set<number>();
    for (let i = 0; i < n; i++) keep.add(live[i]!);
    for (const id of this.cars.keys()) if (id < 1000 && !keep.has(id)) this.cars.delete(id);
  }
}

export { envelope };
