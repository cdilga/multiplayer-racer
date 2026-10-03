// A synthetic snapshot source (P1-R01): writes JJS1 snapshots (the §4.4 ABI's `Snapshot{buf, tick}`) into a pool of
// transferable-sized buffers on the sim's 120 Hz clock, so rendering work doesn't need the sim worker. It has the
// SimClient's snapshot surface (`onSnapshot`, `release`), so the renderer takes either; with no free buffer it skips
// the publish, like the worker. Poses are a pure function of the tick (cars lapping an oval in lanes, each respawning
// on its own 10 s cycle with its `life` bumped), so a frozen tick renders the same frame every time.
import sidecar from '../../../../art/vehicles/cruz-missile/cruz-missile.asset.json';
import type { Snapshot } from '../worker/client';
import { encodeSnapshot, PART_DETACHED, PART_LOOSE, snapshotBytes, type CarPose, type PartPose } from './snapshot';

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
  /** Damage some cars (P1-R02): every third car has a loose door swinging on its hinge; the next has its front and a
   *  wheel detached, lying where the car last respawned, and its rear door loose. */
  damage?: boolean;
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
  // Car forward is +z; yaw about +y. A heading along +z on the right straight is yaw 0. The body origin is on the
  // ground (the sidecar's vehicle space, as the sim reports it).
  return { id: i + 1, life, pos: [x, 0, z], rot: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], steer: 0 };
}

const PART = Object.fromEntries(Object.keys(sidecar.parts).map((id, i) => [id, i])) as Record<string, number>;
const deg = Math.PI / 180;

/** Car `i`'s non-intact parts at `tick` (a pure function of the tick, like the poses). */
export function syntheticParts(i: number, n: number, tick: number): PartPose[] {
  const car = i + 1;
  const swing = 0.5 + 0.5 * Math.sin(tick / 40 + i);
  if (i % 3 === 1) return [{ car, part: PART.door_FL!, state: PART_LOOSE, angle: -(20 + 45 * swing) * deg }];
  if (i % 3 !== 2) return [];
  // The detached parts lie where the car was when it last respawned (its grid slot at the start of this life).
  const life = syntheticPose(i, n, tick).life;
  const at = syntheticPose(i, n, Math.max(0, life * RESPAWN_TICKS - ((i * 997) % RESPAWN_TICKS)));
  const [x, , z] = at.pos;
  const side = (a: number): [number, number, number, number] => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
  return [
    { car, part: PART.door_RL!, state: PART_LOOSE, angle: -(10 + 30 * swing) * deg },
    { car, part: PART.front!, state: PART_DETACHED, pos: [x + 2.6, 0.7, z + 1.5], rot: side(80 * deg) },
    { car, part: PART.wheel_RR!, state: PART_DETACHED, pos: [x - 2.4, 0.15, z - 1], rot: [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)] },
  ];
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
    // Room for every car's part records: three at most per damaged car.
    const bytes = snapshotBytes(opts.cars, 0, opts.damage ? opts.cars * 3 : 0);
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
    const parts = this.opts.damage ? Array.from({ length: n }, (_, i) => syntheticParts(i, n, tick)).flat() : [];
    const bytes = encodeSnapshot(buf, tick, cars, 0, parts);
    this.published++;
    this.onSnapshot({ tick, view: new DataView(buf, 0, bytes), buf });
  }
}
