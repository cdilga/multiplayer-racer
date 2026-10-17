// Per-seat race cameras (P1-R05). Framing is data (assets/profiles/camera.json, seeded from the POC's U05.2 framing,
// R98): cameras sit high and show the road ahead; distance is a preset (near, mid, far) with a host default by player
// count that each player may override.
// - Third person: the camera sits the preset's distance behind and above the car along a smoothed heading: the
//   heading follows the car's on a critically damped spring (`follow`, rad/s), so turns swing the camera smoothly while
//   the distance never stretches with speed; the aim looks further ahead the faster the car goes; when a barrier or
//   building stands between the car and the camera, it pulls in in front of it; when the car drives backwards for a
//   moment (camera.json `reverse`, state machine in reverse.ts) the chase swings right round, eased, to look the way it
//   travels, and swings back when it drives forward again. First person never swings (its mirror is the look-back).
// - First person: an eye over the bonnet riding the car body (its pitch and roll, damped for comfort, are the
//   suspension's head-bob), a speed FOV kick, and a rear-view mirror in a strip of the tile (segmented first person).
// - A respawn cuts: the camera jumps straight to its new place, never swoops across the map.
// - A loop (br-xlvx.6): a chase camera behind the car would end up outside the deck at the top, looking at the deck's
//   underside, with its heading swinging round as the car turns over. While the car is up on a loop the chase cuts to a
//   loop shot instead: side-on, level with the loop's middle, far enough out to frame the whole loop, panning to follow
//   the car round; at the exit it cuts back to the chase behind the car.
// The mode and distance never touch input: held steering means the same in either camera (master §4.1).
import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import profile from '../../../../assets/profiles/camera.json';
import { newReverse, reverseYaw, stepReverse, type ReverseState } from './reverse';

export type CameraMode = 'tp' | 'fp';
export type Distance = 'near' | 'mid' | 'far';
export const PROFILE = profile;

/** An oriented box the chase camera mustn't look through (a `collides` dressing piece). */
export interface Obstacle {
  centre: Vector3;
  half: Vector3;
  /** World → box rotation (inverse of the piece's yaw). */
  inv: Quaternion;
}

/** A loop's frame (render/map/loop.ts `loopFrame`), for the loop shot. */
export interface LoopShot {
  /** The entry point on the road, the road's direction there and its left (ground plane, unit). */
  entry: Vector3;
  forward: Vector3;
  left: Vector3;
  /** The exit's offset from the entry along `forward` and `left`, its radius and the deck's half width (m), and the
   *  exit's height above the entry. */
  runOut: number;
  shift: number;
  radius: number;
  halfWidth: number;
  rise: number;
}

export interface CarView {
  pos: Vector3;
  rot: Quaternion;
  life: number;
}

interface SeatState {
  id: number;
  mode: CameraMode;
  distance: Distance | null; // null: the host default
  pos: Vector3;
  look: Vector3;
  /** The chase heading (radians about +y) and its rate, following the car's heading. */
  heading: number;
  headingRate: number;
  life: number;
  init: boolean;
  last: Vector3;
  speed: number;
  cuts: number;
  /** The farthest the camera has been from its car (m): the chase holds its preset offset exactly, so a swoop after a
   *  respawn (the camera travelling across the map) would show here. */
  maxGapM: number;
  pulledIn: boolean;
  /** The reversing camera's state and the car's signed longitudinal speed (m/s, negative backwards). */
  rev: ReverseState;
  signedMps: number;
  /** The loop (index into `loops`) whose loop shot this seat shows, or null. */
  loop: number | null;
  /** How far (m) the chase stands above its preset height to clear the ground, and how fast that changes (m/s): a
   *  spring, quick up and slow down, never under the line-of-sight floor, so relief never makes it pop (br-gw74.14.1). */
  groundLift: number;
  groundLiftRate: number;
}

const UP = new Vector3(0, 1, 0);

/** The host default distance for this many players on screen (camera.json `byCount`). */
export function distanceFor(players: number): Distance {
  for (const b of profile.distance.byCount) if (b.upTo === null || players <= b.upTo) return b.preset as Distance;
  return profile.distance.default as Distance;
}

export class CameraRig {
  private seats = new Map<number, SeatState>();
  /** The host's default distance; 'auto' follows the player count. */
  hostDistance: Distance | 'auto' = 'auto';
  players = 1;
  obstacles: Obstacle[] = [];
  /** The ground's height (m) under (x, z): the chase stays above it and keeps its line of sight to the car over it. */
  groundAt: ((x: number, z: number) => number) | null = null;
  /** The map's loops: a car up on one gets the loop shot. */
  loops: LoopShot[] = [];
  private fwd = new Vector3();
  private v = new Vector3();
  private w = new Vector3();
  private q = new Quaternion();

  private seat(id: number): SeatState {
    let s = this.seats.get(id);
    if (!s) {
      s = { id, mode: 'tp', distance: null, pos: new Vector3(), look: new Vector3(), heading: 0, headingRate: 0, life: -1, init: false, last: new Vector3(), speed: 0, cuts: 0, maxGapM: 0, pulledIn: false, rev: newReverse(), signedMps: 0, loop: null, groundLift: 0, groundLiftRate: 0 };
      this.seats.set(id, s);
    }
    return s;
  }

  /** `SetCamera{fp|tp}` for a seat (the controller's camera button, C02). */
  setMode(seat: number, mode: CameraMode): void {
    this.seat(seat).mode = mode;
  }

  mode(seat: number): CameraMode {
    return this.seat(seat).mode;
  }

  /** A player's own distance for their tile; null goes back to the host default. */
  setDistance(seat: number, d: Distance | null): void {
    this.seat(seat).distance = d;
  }

  distance(seat: number): Distance {
    const own = this.seat(seat).distance;
    if (own) return own;
    return this.hostDistance === 'auto' ? distanceFor(this.players) : this.hostDistance;
  }

  /** Aims `cam` at its seat's car for this frame; `dt` in seconds. */
  update(seat: number, cam: PerspectiveCamera, car: CarView, dt: number): void {
    const s = this.seat(seat);
    const step = Math.min(Math.max(dt, 0), profile.rig.maxDtS);
    const cut = !s.init || car.life !== s.life;
    if (!cut && dt > 0) s.speed = s.last.distanceTo(car.pos) / dt; // real time: a slow frame is not a fast car
    // Heading on the ground plane: the chase never rolls or pitches with the car.
    this.fwd.set(0, 0, 1).applyQuaternion(car.rot).setY(0);
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, 1);
    this.fwd.normalize();
    // Signed speed along the car's own forward (negative: reversing), from the same real-time position delta.
    s.signedMps = !cut && dt > 0 ? this.w.copy(car.pos).sub(s.last).dot(this.fwd) / dt : 0;
    if (cut) {
      s.speed = 0;
      s.rev = newReverse(); // a respawn cuts straight to the chase from behind
    } else stepReverse(s.rev, s.signedMps, step, profile.reverse);
    s.last.copy(car.pos);
    if (s.mode === 'fp') this.firstPerson(s, cam, car);
    else this.chase(s, cam, car, step, cut);
    if (cut) {
      s.cuts += s.init ? 1 : 0;
      s.init = true;
      s.life = car.life;
    }
    s.maxGapM = Math.max(s.maxGapM, s.pos.distanceTo(car.pos));
  }

  /** The loop the car is up on (inside its plan footprint and `loop.enterUpM` above the line from entry to exit), or null. */
  private loopAt(pos: Vector3): number | null {
    const L = profile.loop;
    for (const [k, l] of this.loops.entries()) {
      const d = this.v.copy(pos).sub(l.entry);
      const along = d.dot(l.forward);
      const lateral = d.dot(l.left);
      const reach = l.halfWidth + L.marginM;
      if (along < -l.radius || along > l.runOut + l.radius) continue;
      if (lateral < Math.min(0, l.shift) - reach || lateral > Math.max(0, l.shift) + reach) continue;
      const base = l.entry.y + l.rise * Math.min(Math.max(along / l.runOut, 0), 1);
      if (pos.y - base > L.enterUpM) return k;
    }
    return null;
  }

  /** From the exit's side of the loop, `loop.azimuthDeg` round from side-on towards the way out, `loop.upOfTop` of the
   *  way up to the top, far enough out to frame all of it; the aim pans `loop.panToCar` of the way from the loop's middle
   *  to the car. Side-on, the barrier walls hang down at the top exactly as far as the car does and hide it; the oblique
   *  view looks in under the deck (raycast against the loop mesh: clear from about 20° to 55° up to 1.4 R high). */
  private loopShot(s: SeatState, cam: PerspectiveCamera, car: CarView, l: LoopShot, fovDeg: number): void {
    const L = profile.loop;
    const tanV = Math.tan((fovDeg * Math.PI) / 360);
    const out = Math.max((l.radius + L.marginM) / tanV, (l.runOut / 2 + l.radius + L.marginM) / (tanV * cam.aspect));
    const middle = this.w.copy(l.entry).addScaledVector(l.forward, l.runOut / 2).addScaledVector(l.left, l.shift / 2);
    middle.y += l.rise / 2;
    const a = (L.azimuthDeg * Math.PI) / 180;
    const reach = out + Math.abs(l.shift) / 2 + l.halfWidth;
    s.pos.copy(middle).addScaledVector(l.left, (l.shift < 0 ? -1 : 1) * Math.cos(a) * reach).addScaledVector(l.forward, Math.sin(a) * reach);
    s.pos.y += 2 * l.radius * L.upOfTop;
    middle.y += l.radius;
    s.look.copy(middle).lerp(car.pos, L.panToCar);
    if (cam.fov !== fovDeg) {
      cam.fov = fovDeg;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(s.pos);
    cam.up.copy(UP);
    cam.lookAt(s.look);
  }

  private chase(s: SeatState, cam: PerspectiveCamera, car: CarView, dt: number, cut: boolean): void {
    const R = profile.chase[this.distance(s.id)];
    const want = Math.atan2(this.fwd.x, this.fwd.z);
    const loop = this.loopAt(car.pos);
    if (loop !== null) {
      s.loop = loop;
      this.loopShot(s, cam, car, this.loops[loop]!, R.fovDeg);
      return;
    }
    if (s.loop !== null) {
      // Out of the loop: cut back to the chase behind the car (it leaves heading the way it went in).
      s.loop = null;
      cut = true;
    }
    if (cut) {
      s.heading = want;
      s.headingRate = 0;
    } else {
      // Critically damped spring on the heading (the short way round): θ'' = ω²(θ* − θ) − 2ω θ'.
      const om = R.follow;
      let err = want - s.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      s.headingRate += (om * om * err - 2 * om * s.headingRate) * dt;
      s.heading += s.headingRate * dt;
    }
    const yaw = s.heading + reverseYaw(s.rev);
    const dir = this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    const target = this.w.copy(car.pos).addScaledVector(dir, -R.backM);
    target.y = car.pos.y + R.upM - this.airHold(car);
    this.pullIn(s, car, target);
    this.overGround(s, car, target, dt, cut);
    s.pos.copy(target);
    // Look ahead along the car's own heading (in a turn it leads the camera's smoothed heading), further the faster it
    // goes, at the preset's pitch whatever the distance, so speed never tips the view up into the sky (R98).
    const ahead = R.lookAheadM + Math.min(profile.rig.lookAheadMaxM, s.speed * profile.rig.lookAheadPerMps);
    const pitch = Math.atan2(R.upM - R.lookUpM, R.backM + R.lookAheadM);
    const lookYaw = want + reverseYaw(s.rev);
    s.look.set(Math.sin(lookYaw), 0, Math.cos(lookYaw)).multiplyScalar(ahead).add(car.pos);
    const flat = Math.hypot(s.look.x - s.pos.x, s.look.z - s.pos.z);
    s.look.y = s.pos.y - Math.tan(pitch) * flat;
    if (cam.fov !== R.fovDeg) {
      cam.fov = R.fovDeg;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(s.pos);
    cam.up.copy(UP);
    cam.lookAt(s.look);
  }

  /** Big air reads as big air (br-gw74.13.1.1): how far (m) the chase stays below its usual height over the car while the
   *  car is off the ground. It holds `rig.airHold` of the car's height above `rig.airFromM` to the ground instead of
   *  rising with the car (up to `rig.airHoldMaxM`), and keeps its pitch, so the car climbs in frame and the road falls
   *  away under it; on the ground it is 0 and the chase is unchanged. Continuous in the height, so no pop at the lip. */
  private airHold(car: CarView): number {
    const ground = this.groundAt;
    if (!ground) return 0;
    const air = car.pos.y - ground(car.pos.x, car.pos.z) - profile.rig.airFromM;
    return air > 0 ? Math.min(profile.rig.airHoldMaxM, air * profile.rig.airHold) : 0;
  }

  /** Raises `target` until it is clear of the ground under it and the ground doesn't hide the car (undulating maps:
   *  in a dip the chase point can sit inside the rise behind the car). */
  private overGround(s: SeatState, car: CarView, target: Vector3, dt: number, cut: boolean): void {
    const ground = this.groundAt;
    if (!ground) return;
    const base = target.y;
    // The least height that clears the ground under the chase point and keeps the line of sight to the car 0.2 m over
    // the ground at each sample, solved exactly (y(t) = Y + (eye − Y)t ≥ g + 0.2  ⇔  Y ≥ (g + 0.2 − eye·t) / (1 − t)),
    // so it moves continuously with the car instead of in 0.5 m steps (br-gw74.14.1).
    const R = profile.rig;
    const eye = car.pos.y + R.pullInEyeUpM;
    const solve = (margin: number) => {
      let need = Math.max(base, ground(target.x, target.z) + R.groundClearM);
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const g = ground(target.x + (car.pos.x - target.x) * t, target.z + (car.pos.z - target.z) * t);
        need = Math.max(need, (g + margin - eye * t) / (1 - t));
      }
      return Math.min(need - base, R.losMaxLiftM);
    };
    // The lift follows what the ground needs (with headroom) on a critically damped spring, quick up and slow down, so
    // its acceleration stays continuous through every crest and dip; the floor (the line of sight 0.2 m over the
    // ground) holds whatever the spring does, so the car is never hidden.
    const want = solve(0.2 + R.groundHeadroomM);
    const floor = solve(0.2);
    if (cut) {
      s.groundLift = want;
      s.groundLiftRate = 0;
    } else {
      const om = want > s.groundLift ? R.groundRise : R.groundSettle;
      s.groundLiftRate += (om * om * (want - s.groundLift) - 2 * om * s.groundLiftRate) * dt;
      s.groundLift += s.groundLiftRate * dt;
    }
    if (s.groundLift < floor) {
      s.groundLift = floor;
      s.groundLiftRate = Math.max(0, s.groundLiftRate);
    }
    target.y = base + s.groundLift;
  }

  /** Moves `target` in front of the first obstacle between the car and it. */
  private pullIn(s: SeatState, car: CarView, target: Vector3): void {
    s.pulledIn = false;
    if (!this.obstacles.length) return;
    const from = this.v.copy(car.pos);
    from.y += profile.rig.pullInEyeUpM;
    const dir = target.clone().sub(from);
    const len = dir.length();
    dir.divideScalar(len);
    let hit = len;
    for (const o of this.obstacles) {
      const t = rayBox(from, dir, o);
      if (t !== null && t < hit) hit = t;
    }
    if (hit < len) {
      const d = Math.max(profile.rig.pullInMinM, hit - profile.rig.pullInMarginM);
      target.copy(from).addScaledVector(dir, d);
      s.pulledIn = true;
    }
  }

  private firstPerson(s: SeatState, cam: PerspectiveCamera, car: CarView): void {
    const F = profile.firstPerson;
    // The body's pitch and roll, damped for comfort, ride on the heading: the suspension's head-bob.
    const body = this.q.copy(car.rot);
    const yawOnly = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), this.fwd);
    const tilt = yawOnly.clone().invert().multiply(body); // pitch and roll in the car's heading frame
    const comfort = new Quaternion().slerp(tilt, profile.rig.fpTiltKeep);
    const frame = yawOnly.multiply(comfort);
    s.pos.set(F.eye.rightM, F.eye.upM, F.eye.forwardM).applyQuaternion(frame).add(car.pos);
    s.look.set(0, F.lookUpM, F.lookAheadM).applyQuaternion(frame).add(car.pos);
    const fov = F.fovDeg + Math.min(profile.rig.fovKickMaxDeg, s.speed * profile.rig.fovKickPerMps);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(s.pos);
    cam.up.set(0, 1, 0).applyQuaternion(frame);
    cam.lookAt(s.look);
  }

  /** The mirror camera for a first-person seat: from above the roof, looking back down the road. */
  aimMirror(seat: number, cam: PerspectiveCamera, car: CarView): void {
    const M = profile.firstPerson.mirror;
    void seat;
    cam.position.copy(car.pos);
    cam.position.y += M.eyeUpM;
    if (cam.fov !== M.fovDeg) {
      cam.fov = M.fovDeg;
      cam.updateProjectionMatrix();
    }
    cam.up.copy(UP);
    cam.lookAt(this.w.copy(car.pos).addScaledVector(this.fwd, -M.lookBackM).setY(car.pos.y + M.lookUpM));
  }

  /** Introspection (R90): each seat's camera state. */
  inspect() {
    return Object.fromEntries(
      [...this.seats].map(([id, s]) => [
        id,
        { mode: s.mode, distance: this.distance(id), cuts: s.cuts, loop: s.loop, maxGapM: +s.maxGapM.toFixed(2), speed: +s.speed.toFixed(2), pulledIn: s.pulledIn,
          reverse: { reversing: s.rev.reversing, blend: +s.rev.t.toFixed(3), yawDeg: +((reverseYaw(s.rev) * 180) / Math.PI).toFixed(1), signedMps: +s.signedMps.toFixed(2) } },
      ]),
    );
  }
}

/** Distance along the ray to an oriented box, or null if it misses (slab test in the box's frame). */
function rayBox(from: Vector3, dir: Vector3, o: Obstacle): number | null {
  const p = from.clone().sub(o.centre).applyQuaternion(o.inv);
  const d = dir.clone().applyQuaternion(o.inv);
  let tmin = 0;
  let tmax = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-9) {
      if (Math.abs(p[k]) > o.half[k]) return null;
      continue;
    }
    let t1 = (-o.half[k] - p[k]) / d[k];
    let t2 = (o.half[k] - p[k]) / d[k];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}
