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
// - A loop (br-xlvx.6, br-8h3u.2): a chase camera behind the car would end up outside the deck at the top, looking at the
//   deck's underside, with its heading swinging round as the car turns over. While the car is up on a loop the chase
//   holds the loop's heading and eases in towards the car, to a point part of the way from the car to the loop's axis
//   and a little behind it, so it sees the car from inside the loop all the way round; it eases back out after the
//   exit. It never cuts and never rolls: up stays world-up (the owner found the cut to a side-on shot disconcerting).
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
  /** The loop (index into `loops`) the car is up on, or null; the last one it rode (the ease out follows it); and how
   *  far the chase has eased in towards the car (0 the chase, 1 the loop framing). */
  loop: number | null;
  lastLoop: number | null;
  loopIn: number;
  /** The chase's distance to its car (m) and the distance at the preset's FOV that frames the car the same (its zoom). */
  gapM: number;
  zoomM: number;
  /** The chase's roll (degrees, its right vector off level): 0 on the ground and round a loop alike. */
  rollDeg: number;
  /** How far (m) the chase stands above its preset height to clear the ground, and how fast that changes (m/s): a
   *  spring, quick up and slow down, never under the line-of-sight floor, so relief never makes it pop (br-gw74.14.1). */
  groundLift: number;
  groundLiftRate: number;
  groundWant: number;
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
  private loopPos = new Vector3();
  private loopLook = new Vector3();

  private seat(id: number): SeatState {
    let s = this.seats.get(id);
    if (!s) {
      s = { id, mode: 'tp', distance: null, pos: new Vector3(), look: new Vector3(), heading: 0, headingRate: 0, life: -1, init: false, last: new Vector3(), speed: 0, cuts: 0, maxGapM: 0, pulledIn: false, rev: newReverse(), signedMps: 0, loop: null, lastLoop: null, loopIn: 0, gapM: 0, zoomM: 0, rollDeg: 0, groundLift: 0, groundLiftRate: 0, groundWant: 0 };
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

  /** The loop framing. The loop's centre travels with the car (along A·t, up R, sideways with the car), and the
   *  camera rides beside it on the exit's side, `loop.azimuthDeg` round from side-on (+ towards the way out), `loop.outRadii`
   *  radii out and `loop.upOfTop` of the way up to the top, aiming `loop.lookToCar` of the way from that centre to the car. A
   *  camera behind the car can't follow it round: over the top the car runs backwards and on the way down it is on the
   *  deck's forward face. Side-on, the barriers at the top hide the car; the oblique view looks in under the deck. The car's
   *  place round the helix comes from its sideways progress (lateral = S(t − sin 2πt / 2π) rises monotonically). */
  private loopFrame(car: CarView, l: LoopShot, pos: Vector3, look: Vector3): void {
    const L = profile.loop;
    const d = this.v.copy(car.pos).sub(l.entry);
    let t = Math.min(Math.max(d.dot(l.forward) / l.runOut, 0), 1);
    if (Math.abs(l.shift) > 1e-3) {
      const g = Math.min(Math.max(d.dot(l.left) / l.shift, 0), 1);
      let lo = 0, hi = 1;
      for (let k = 0; k < 24; k++) {
        const m = (lo + hi) / 2;
        if (m - Math.sin(2 * Math.PI * m) / (2 * Math.PI) < g) lo = m;
        else hi = m;
      }
      t = (lo + hi) / 2;
    }
    // The centre is the car less its offset round the circle (A·t inside the loop), so before the entry and after the exit
    // it travels with the car and an ease never drags the camera back towards the loop.
    const along = d.dot(l.forward) - l.radius * Math.sin(2 * Math.PI * t);
    const centre = this.w.copy(l.entry).addScaledVector(l.forward, along).addScaledVector(l.left, d.dot(l.left));
    centre.y += l.rise * t;
    const a = (L.azimuthDeg * Math.PI) / 180;
    pos.copy(centre).addScaledVector(l.left, (l.shift < 0 ? -1 : 1) * Math.cos(a) * L.outRadii * l.radius).addScaledVector(l.forward, Math.sin(a) * L.outRadii * l.radius);
    pos.y += 2 * l.radius * L.upOfTop;
    centre.y += l.radius;
    look.copy(centre).lerp(car.pos, L.lookToCar);
  }

  private chase(s: SeatState, cam: PerspectiveCamera, car: CarView, dt: number, cut: boolean): void {
    const R = profile.chase[this.distance(s.id)];
    const loop = this.loopAt(car.pos);
    s.loop = loop;
    if (loop !== null) s.lastLoop = loop;
    // Up on a loop the car's own heading flips over the top: the chase holds the loop's.
    const l = loop !== null ? this.loops[loop]! : null;
    const want = l ? Math.atan2(l.forward.x, l.forward.z) : Math.atan2(this.fwd.x, this.fwd.z);
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
    this.overGround(s, car, target, dt, cut, Math.sin(want) * s.speed, Math.cos(want) * s.speed);
    s.pos.copy(target);
    // Look ahead along the car's own heading (in a turn it leads the camera's smoothed heading), further the faster it
    // goes, at the preset's pitch whatever the distance, so speed never tips the view up into the sky (R98).
    const ahead = R.lookAheadM + Math.min(profile.rig.lookAheadMaxM, s.speed * profile.rig.lookAheadPerMps);
    const pitch = Math.atan2(R.upM - R.lookUpM, R.backM + R.lookAheadM);
    const lookYaw = want + reverseYaw(s.rev);
    s.look.set(Math.sin(lookYaw), 0, Math.cos(lookYaw)).multiplyScalar(ahead).add(car.pos);
    const flat = Math.hypot(s.look.x - s.pos.x, s.look.z - s.pos.z);
    s.look.y = s.pos.y - Math.tan(pitch) * flat;
    // Ease in towards the car on a loop and back out after it (exponential, `loop.easeInS` / `loop.easeOutS`).
    const L = profile.loop;
    const goal = loop !== null ? 1 : 0;
    s.loopIn = cut ? goal : goal + (s.loopIn - goal) * Math.exp(-dt / (goal ? L.easeInS : L.easeOutS));
    if (s.loopIn < 1e-3) s.loopIn = 0;
    let fov = R.fovDeg;
    if (s.loopIn > 0 && s.lastLoop !== null) {
      this.loopFrame(car, this.loops[s.lastLoop]!, this.loopPos, this.loopLook);
      s.pos.lerp(this.loopPos, s.loopIn);
      // Part way between the two, neither aim need hold the car: the aim comes onto the car over the first quarter of
      // the ease and goes on to the loop's aim over the rest.
      s.look.lerp(this.v.copy(car.pos).setY(car.pos.y + profile.rig.pullInEyeUpM), Math.min(1, 4 * s.loopIn));
      s.look.lerp(this.loopLook, Math.max(0, (4 * s.loopIn - 1) / 3));
      // Zoom in: the car fills the frame as it would from `loop.zoomM` away at the preset's FOV (never under `loop.minFovDeg`).
      const tan0 = Math.tan((R.fovDeg * Math.PI) / 360);
      const zoomed = Math.max(L.minFovDeg, (360 / Math.PI) * Math.atan((tan0 * L.zoomM) / Math.max(s.pos.distanceTo(car.pos), L.zoomM)));
      fov += (zoomed - R.fovDeg) * s.loopIn * s.loopIn; // the aim settles on the car before the frame tightens
    }
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.position.copy(s.pos);
    cam.up.copy(UP);
    cam.lookAt(s.look);
    s.gapM = s.pos.distanceTo(car.pos);
    s.zoomM = (s.gapM * Math.tan((fov * Math.PI) / 360)) / Math.tan((R.fovDeg * Math.PI) / 360);
    s.rollDeg = (Math.asin(Math.min(1, Math.max(-1, this.v.set(1, 0, 0).applyQuaternion(cam.quaternion).y))) * 180) / Math.PI;
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
  private overGround(s: SeatState, car: CarView, target: Vector3, dt: number, cut: boolean, vx: number, vz: number): void {
    const ground = this.groundAt;
    if (!ground) return;
    const base = target.y;
    // The least height that clears the ground under the chase point and keeps the line of sight to the car 0.2 m over
    // the ground at each sample, solved exactly (y(t) = Y + (eye − Y)t ≥ g + 0.2  ⇔  Y ≥ (g + 0.2 − eye·t) / (1 − t)),
    // so it moves continuously with the car instead of in 0.5 m steps (br-gw74.14.1).
    const R = profile.rig;
    const eye = car.pos.y + R.pullInEyeUpM;
    // `ahead` s from now, both points carried along the car's travel and the car riding the ground (relief look-ahead).
    const solve = (margin: number, ahead = 0) => {
      const dx = vx * ahead, dz = vz * ahead;
      const rise = ahead ? ground(car.pos.x + dx, car.pos.z + dz) - ground(car.pos.x, car.pos.z) : 0;
      const b = base + rise, e = eye + rise, tx = target.x + dx, tz = target.z + dz, cx = car.pos.x + dx, cz = car.pos.z + dz;
      let need = Math.max(b, ground(tx, tz) + R.groundClearM);
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        need = Math.max(need, (ground(tx + (cx - tx) * t, tz + (cz - tz) * t) + margin - e * t) / (1 - t));
      }
      return Math.min(need - b, R.losMaxLiftM);
    };
    // The lift follows what the ground needs (with headroom) on a critically damped spring, quick up and slow down, so
    // its acceleration stays continuous through every crest and dip; the floor (the line of sight 0.2 m over the
    // ground) holds whatever the spring does, so the car is never hidden.
    let want = 0;
    for (let k = 0; k <= 4; k++) want = Math.max(want, solve(0.2 + R.groundHeadroomM, (k / 4) * R.groundLookAheadS));
    const floor = solve(0.2);
    if (cut) {
      s.groundWant = want;
      s.groundLift = want;
      s.groundLiftRate = 0;
    } else {
      // A first-order smoothing of the aim ahead of the spring: together third order, so the camera's jerk stays finite.
      s.groundWant += (want - s.groundWant) * (1 - Math.exp(-dt / R.groundAimS));
      const om = s.groundWant > s.groundLift ? R.groundRise : R.groundSettle;
      s.groundLiftRate += (om * om * (s.groundWant - s.groundLift) - 2 * om * s.groundLiftRate) * dt;
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
        { mode: s.mode, distance: this.distance(id), cuts: s.cuts, loop: s.loop, loopIn: +s.loopIn.toFixed(3), gapM: +s.gapM.toFixed(2), zoomM: +s.zoomM.toFixed(2), rollDeg: +s.rollDeg.toFixed(2), maxGapM: +s.maxGapM.toFixed(2), speed: +s.speed.toFixed(2), pulledIn: s.pulledIn,
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
