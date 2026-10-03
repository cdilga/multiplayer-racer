// A synthetic snapshot source (P1-R01): writes JJS1 snapshots (the §4.4 ABI's `Snapshot{buf, tick}`) into a pool of
// transferable-sized buffers on the sim's 120 Hz clock, so rendering work doesn't need the sim worker. It has the
// SimClient's snapshot surface (`onSnapshot`, `release`), so the renderer takes either; with no free buffer it skips
// the publish, like the worker. Poses are a pure function of the tick (cars lapping an oval in lanes, each respawning
// on its own 10 s cycle with its `life` bumped), so a frozen tick renders the same frame every time.
import type { Snapshot } from '../worker/client';
import { encodeSnapshot, snapshotBytes, type CarPose } from './snapshot';

export const TICK_HZ = 120;

export interface SnapshotSource {
  onSnapshot: (s: Snapshot) => void;
  release(s: Snapshot): void;
}

export interface SyntheticOptions {
  cars: number;
  poolSize?: number;
  /** Publish only the ticks up to this one, then stop (a reproducible frame for captures). */
  freezeAt?: number;
}

const SPEED = 18; // m/s
const RESPAWN_TICKS = 10 * TICK_HZ;

/** The oval for `n` cars: two straights joined by half circles, long enough that the field spreads out. */
function oval(n: number): { r: number; straight: number; lanes: number } {
  const lanes = Math.max(1, Math.min(4, n));
  return { r: 30, straight: Math.max(60, Math.ceil(n / lanes) * 9), lanes };
}

/** Where car `i` of `n` is at `tick`. */
export function syntheticPose(i: number, n: number, tick: number): CarPose {
  const { r, straight, lanes } = oval(n);
  const lap = 2 * straight + 2 * Math.PI * r;
  const phase = (i * 997) % RESPAWN_TICKS; // stagger respawns
  const life = Math.floor((tick + phase) / RESPAWN_TICKS);
  // After a respawn the car restarts from its grid slot, so the jump is visible (and must not be interpolated).
  const sinceSpawn = ((tick + phase) % RESPAWN_TICKS) / TICK_HZ;
  const grid = (Math.floor(i / lanes) * 7.5) % lap;
  let s = (((straight / 2 - grid + sinceSpawn * SPEED) % lap) + lap) % lap;
  const lane = ((i % lanes) - (lanes - 1) / 2) * 3.2;
  let x: number, z: number, yaw: number;
  if (s < straight) {
    x = r + lane;
    z = s - straight / 2;
    yaw = 0;
  } else if ((s -= straight) < Math.PI * r) {
    const a = s / r;
    x = Math.cos(a) * (r + lane);
    z = straight / 2 + Math.sin(a) * (r + lane);
    yaw = -a;
  } else if ((s -= Math.PI * r) < straight) {
    x = -(r + lane);
    z = straight / 2 - s;
    yaw = Math.PI;
  } else {
    const a = (s - straight) / r + Math.PI;
    x = Math.cos(a) * (r + lane);
    z = -straight / 2 + Math.sin(a) * (r + lane);
    yaw = -a;
  }
  // Car forward is +z; yaw about +y. A heading along +z on the right straight is yaw 0.
  return { id: i + 1, life, pos: [x, 0.5, z], rot: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], steer: 0 };
}

export class SyntheticSource implements SnapshotSource {
  onSnapshot: (s: Snapshot) => void = (s) => this.release(s);
  tick = 0;
  published = 0;
  skipped = 0;
  private free: ArrayBuffer[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private t0 = 0;

  constructor(readonly opts: SyntheticOptions) {
    const bytes = snapshotBytes(opts.cars);
    for (let i = 0; i < (opts.poolSize ?? 4); i++) this.free.push(new ArrayBuffer(bytes));
  }

  start(): void {
    const { freezeAt } = this.opts;
    if (freezeAt !== undefined) {
      // Two consecutive ticks so the interpolator has a pair to sit between.
      for (const t of [Math.max(0, freezeAt - 1), freezeAt]) this.publish(t);
      return;
    }
    this.t0 = performance.now();
    this.timer = setInterval(() => {
      const due = Math.floor(((performance.now() - this.t0) * TICK_HZ) / 1000);
      if (due > this.tick) this.publish(due);
    }, 4);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  release(s: Snapshot): void {
    this.free.push(s.buf);
  }

  private publish(tick: number): void {
    this.tick = tick;
    const buf = this.free.pop();
    if (!buf) {
      this.skipped++;
      return;
    }
    const n = this.opts.cars;
    const cars = Array.from({ length: n }, (_, i) => syntheticPose(i, n, tick));
    const bytes = encodeSnapshot(buf, tick, cars);
    this.published++;
    this.onSnapshot({ tick, view: new DataView(buf, 0, bytes), buf });
  }
}
