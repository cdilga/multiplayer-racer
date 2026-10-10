// A synthetic snapshot source (P1-R01): writes JJS1 snapshots (the §4.4 ABI's `Snapshot{buf, tick}`) into a pool of
// transferable-sized buffers on the sim's 120 Hz clock, so rendering work doesn't need the sim worker. It has the
// SimClient's snapshot surface (`onSnapshot`, `release`), so the renderer takes either; with no free buffer it skips
// the publish, like the worker. Poses are a pure function of the tick (cars lapping an oval in lanes, each respawning
// on its own 10 s cycle with its `life` bumped), so a frozen tick renders the same frame every time.
import type { Snapshot } from '../worker/client';
import { VEHICLE_IDS, vehicleSource } from './vehicles/registry';
import { encodeSnapshot, PART_DETACHED, PART_LOOSE, PART_PIECE, PIECE_HUSK, snapshotBytes, type CarPose, type PartPose } from './snapshot';

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
  /** The damage strip (P1-V03): cars parked side by side, side-on to the overview camera, each in one state. */
  strip?: boolean;
  /** The effects demo (P1-R12; `?fxdemo`): cars cycle through the families' triggers (dirt and gravel driving, a drift, a
   *  boost, impacts, landings, a part coming off) and a husk burns beside the oval. Presentation fixtures only. */
  fxDemo?: boolean;
  /** Cars take the roster's vehicles in turn (R123; `?vehicles=mixed`), so a grid shows every model; otherwise all draw the first. */
  mixed?: boolean;
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

// Every vehicle shares the part contract (jj.vehicle.v1 part names and order), so the first roster vehicle's sidecar names the parts.
const sidecar = vehicleSource(VEHICLE_IDS[0]!).sidecar;
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

/** The damage strip's states, one per car (every hinged part at its §6.3 limit, then detachments). */
export const STRIP: { name: string; parts: { part: string; state: number; angleDeg?: number }[] }[] = [
  { name: 'intact', parts: [] },
  { name: 'door_FL loose', parts: [{ part: 'door_FL', state: PART_LOOSE, angleDeg: -60 }] },
  { name: 'door_RL loose', parts: [{ part: 'door_RL', state: PART_LOOSE, angleDeg: -45 }] },
  { name: 'front loose', parts: [{ part: 'front', state: PART_LOOSE, angleDeg: 25 }] },
  { name: 'back loose', parts: [{ part: 'back', state: PART_LOOSE, angleDeg: -25 }] },
  { name: 'wheel_FL loose', parts: [{ part: 'wheel_FL', state: PART_LOOSE, angleDeg: 6 }] },
  { name: 'front detached', parts: [{ part: 'front', state: PART_DETACHED }] },
  { name: 'door_FL detached', parts: [{ part: 'door_FL', state: PART_DETACHED }] },
  { name: 'wheel_FL detached', parts: [{ part: 'wheel_FL', state: PART_DETACHED }] },
  {
    name: 'stripped',
    parts: ['front', 'back', 'door_FL', 'door_RL', 'door_FR', 'door_RR'].map((part) => ({ part, state: PART_DETACHED })),
  },
];
const STRIP_GAP = 6.5;

/** Strip car i: parked along -x (reading left to right from the overview camera) facing +x, so its left side (doors FL/RL) faces the overview camera. */
function stripPose(i: number): CarPose {
  const yaw = Math.PI / 2;
  return { id: i + 1, life: 0, pos: [-i * STRIP_GAP, 0, 0], rot: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], steer: 0 };
}

/** Strip car i's part records; detached parts lie on the ground in front of the car (towards the camera). */
function stripParts(i: number): PartPose[] {
  const pivots = sidecar.parts as Record<string, { pivot: number[] }>;
  return (STRIP[i % STRIP.length]?.parts ?? []).map((p, k) => {
    if (p.state !== PART_DETACHED) return { car: i + 1, part: PART[p.part]!, state: p.state, angle: (p.angleDeg ?? 0) * deg };
    // Car space → world: the car faces +x, so its local +z is world +x and its local +x (left) is world -z.
    const piv = pivots[p.part]!.pivot;
    const lie = [-i * STRIP_GAP + piv[2]! * 0.4, 0.3, -3.6 - k * 1.4];
    // A door or wheel (thin across the car) lies flat: a quarter turn about world z. The front and back lie upside
    // down: a half turn about world x.
    const rot: [number, number, number, number] =
      p.part === 'front' || p.part === 'back' ? [1, 0, 0, 0] : [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    return { car: i + 1, part: PART[p.part]!, state: PART_DETACHED, pos: lie as [number, number, number], rot };
  });
}

const HUSK_AT: [number, number, number] = [-14, 0, 6];

/** The effects demo's state for car `i` at `tick`: the flags, velocity, boost and throttle that trigger its family. */
export function fxDemoState(i: number, n: number, tick: number): Pick<CarPose, 'flags' | 'vel' | 'boost' | 'throttle'> {
  const a = syntheticPose(i, n, tick);
  const b = syntheticPose(i, n, tick + 1);
  // Across a respawn the next pose is the new life's: take the velocity from the tick before instead (a zero here read as
  // a full-speed stop, so every car 'crashed' at its respawn).
  const [p, q] = a.life === b.life ? [a, b] : [syntheticPose(i, n, tick - 1), a];
  const vel: [number, number, number] = p.life === q.life ? [(q.pos[0] - p.pos[0]) * TICK_HZ, 0, (q.pos[2] - p.pos[2]) * TICK_HZ] : [0, 0, 0];
  const kind = i % 6;
  let flags = 0;
  let boost = 0.2;
  let throttle = 1;
  const cycle = tick % (4 * TICK_HZ);
  if (kind === 0) flags = 1 << 6; // dirt
  else if (kind === 1) flags = 32; // drifting on tarmac
  else if (kind === 2) [flags, boost] = [16 | 0, i % 12 === 2 ? 1 : 0.5]; // boosting (blue at full)
  else if (kind === 3) flags = 2 << 6; // gravel
  else if (kind === 4) {
    // An impact every 4 s: six ticks at a fifth of the speed, then back (a hard hit: dv about 14 m/s). Six, not one or
    // two: a drawn frame samples every few sim ticks, and a one-tick dip was often never seen.
    if (cycle < 6) [vel[0], vel[2]] = [vel[0] * 0.2, vel[2] * 0.2];
    throttle = cycle < 40 ? 0 : 1;
  } else {
    // A landing every 4 s: falling for a third of a second, then level.
    if (cycle < 40) vel[1] = -7;
    flags = 1 << 6;
  }
  if (kind !== 4 && tick % (6 * TICK_HZ) < 120) throttle = 0; // braking lamps for a second in six
  return { flags, vel, boost, throttle };
}

/** The demo's extra part records: a husk (a burned-out car at HUSK_AT) and, on every sixth car, a door that comes off. */
export function fxDemoParts(n: number, tick: number): PartPose[] {
  const out: PartPose[] = [{ car: 900, part: PIECE_HUSK, state: PART_PIECE, pos: HUSK_AT }];
  for (let i = 5; i < n; i += 6) {
    if (tick < 480) continue; // intact for the first four seconds, then the door goes
    const at = syntheticPose(i, n, tick).pos;
    out.push({ car: i + 1, part: PART.door_FL!, state: PART_DETACHED, pos: [at[0] + 2, 0.3, at[2] + 2], rot: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }, { car: i + 1, part: PART.front!, state: PART_LOOSE, angle: 0.4 });
  }
  return out;
}

export class SyntheticSource implements SnapshotSource {
  onSnapshot: (s: Snapshot) => void = (s) => this.release(s);
  tick = 0;
  published = 0;
  skipped = 0;
  private free: ArrayBuffer[] = [];
  private fxDemo = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private t0 = 0;

  constructor(readonly opts: SyntheticOptions) {
    // Room for every car's part records: three at most per damaged car.
    this.fxDemo = opts.fxDemo ?? (typeof location !== 'undefined' && new URLSearchParams(location.search).has('fxdemo'));
    const bytes = snapshotBytes(opts.cars, 0, opts.strip ? opts.cars * 6 : opts.damage || this.fxDemo ? opts.cars * 3 + 1 : 0);
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
    const strip = this.opts.strip;
    const cars = Array.from({ length: n }, (_, i) => (strip ? stripPose(i) : syntheticPose(i, n, tick)));
    if (this.opts.mixed) cars.forEach((c, i) => (c.vehicle = i % VEHICLE_IDS.length));
    if (this.fxDemo && !strip) cars.forEach((c, i) => Object.assign(c, fxDemoState(i, n, tick)));
    const parts = this.fxDemo && !strip
      ? [...(this.opts.damage ? Array.from({ length: n }, (_, i) => syntheticParts(i, n, tick)).flat() : []), ...fxDemoParts(n, tick)]
      : strip
      ? Array.from({ length: n }, (_, i) => stripParts(i)).flat()
      : this.opts.damage
        ? Array.from({ length: n }, (_, i) => syntheticParts(i, n, tick)).flat()
        : [];
    const bytes = encodeSnapshot(buf, tick, cars, 0, parts);
    this.published++;
    this.onSnapshot({ tick, view: new DataView(buf, 0, bytes), buf });
  }
}
