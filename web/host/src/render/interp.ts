// Interpolated scene state from snapshots (P1-R01). The renderer draws a little behind the newest snapshot, between the
// two snapshots around its render tick: positions lerp and rotations slerp. An interpolation pair never crosses a
// respawn: a car whose `life` differs between the two (or that is new) is drawn at the newer pose.
import { TICK_HZ } from './synthetic';
import type { Frame } from './snapshot';

/** How far behind the newest snapshot the renderer draws, in ticks (absorbs publish jitter). */
export const DELAY_TICKS = 3;
const KEEP = 8;

export interface Sampled {
  tick: number;
  cars: number;
  id: Uint32Array;
  flags: Uint32Array;
  pos: Float32Array;
  rot: Float32Array;
  steer: Float32Array;
  /** Bumps on a respawn: cameras cut instead of following across the map. */
  life: Uint32Array;
  /** Cars drawn at the newer pose because the pair crossed a respawn (or the car is new), this sample. */
  snapped: number;
  frame: Frame | null;
}

export class Interpolator {
  private frames: Frame[] = [];
  private lastArrival = 0;
  private shown = 0;
  /** Set to draw an exact tick (captures); otherwise the clock follows arrivals. */
  fixedTick: number | null = null;

  push(f: Frame, now = performance.now()): void {
    const last = this.frames.at(-1);
    if (last && f.tick <= last.tick) {
      if (f.tick < last.tick) this.frames.length = 0; // a new session or a rewind: start over
      else return;
    }
    if (last && f.sessionRev !== last.sessionRev) this.frames.length = 0;
    this.frames.push(f);
    if (this.frames.length > KEEP) this.frames.shift();
    this.lastArrival = now;
  }

  get latest(): Frame | null {
    return this.frames.at(-1) ?? null;
  }

  /** The tick the renderer should draw now. */
  renderTick(now = performance.now()): number {
    if (this.fixedTick !== null) return this.fixedTick;
    const last = this.frames.at(-1);
    if (!last) return 0;
    const ahead = Math.min(((now - this.lastArrival) * TICK_HZ) / 1000, DELAY_TICKS);
    // Never run backwards; never run past the newest snapshot.
    this.shown = Math.min(Math.max(this.shown, last.tick + ahead - DELAY_TICKS), last.tick);
    return this.shown;
  }

  sample(t: number, out?: Sampled): Sampled {
    const fs = this.frames;
    let a: Frame | undefined;
    let b: Frame | undefined;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i]!;
      if (f.tick <= t) {
        a = f;
        b = fs[i + 1] ?? f;
        break;
      }
    }
    if (!a) a = b = fs[0];
    const s = prepare(out, b?.cars ?? 0);
    s.tick = t;
    s.snapped = 0;
    s.frame = b ?? null;
    if (!a || !b) return s;
    const alpha = b.tick > a.tick ? Math.min(1, Math.max(0, (t - a.tick) / (b.tick - a.tick))) : 1;
    const index = new Map<number, number>();
    for (let i = 0; i < a.cars; i++) index.set(a.id[i]!, i);
    for (let i = 0; i < b.cars; i++) {
      s.id[i] = b.id[i]!;
      s.flags[i] = b.flags[i]!;
      s.steer[i] = b.steer[i]!;
      s.life[i] = b.life[i]!;
      const j = index.get(b.id[i]!);
      if (j === undefined || a.life[j] !== b.life[i] || alpha === 1) {
        if (alpha < 1) s.snapped++;
        s.pos.set(b.pos.subarray(i * 3, i * 3 + 3), i * 3);
        s.rot.set(b.rot.subarray(i * 4, i * 4 + 4), i * 4);
        continue;
      }
      for (let k = 0; k < 3; k++) s.pos[i * 3 + k] = a.pos[j * 3 + k]! + (b.pos[i * 3 + k]! - a.pos[j * 3 + k]!) * alpha;
      slerp(a.rot, j * 4, b.rot, i * 4, alpha, s.rot, i * 4);
    }
    return s;
  }
}

function prepare(out: Sampled | undefined, cars: number): Sampled {
  if (out && out.id.length >= cars) {
    out.cars = cars;
    return out;
  }
  return {
    tick: 0,
    cars,
    id: new Uint32Array(cars),
    flags: new Uint32Array(cars),
    pos: new Float32Array(cars * 3),
    rot: new Float32Array(cars * 4),
    steer: new Float32Array(cars),
    life: new Uint32Array(cars),
    snapped: 0,
    frame: null,
  };
}

function slerp(a: Float32Array, ai: number, b: Float32Array, bi: number, t: number, o: Float32Array, oi: number): void {
  let [bx, by, bz, bw] = [b[bi]!, b[bi + 1]!, b[bi + 2]!, b[bi + 3]!];
  const [ax, ay, az, aw] = [a[ai]!, a[ai + 1]!, a[ai + 2]!, a[ai + 3]!];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka = 1 - t;
  let kb = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos);
    const sin = Math.sin(th);
    ka = Math.sin((1 - t) * th) / sin;
    kb = Math.sin(t * th) / sin;
  }
  const x = ax * ka + bx * kb;
  const y = ay * ka + by * kb;
  const z = az * ka + bz * kb;
  const w = aw * ka + bw * kb;
  const n = Math.hypot(x, y, z, w) || 1;
  o[oi] = x / n;
  o[oi + 1] = y / n;
  o[oi + 2] = z / n;
  o[oi + 3] = w / n;
}
