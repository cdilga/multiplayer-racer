// The Derby Overview camera (P1-R11, master §6.4, R22/R107): one shared camera over the arena. Ported from the accepted
// POC rig (art/ui/poc/shared/overview-camera.js, P1-U05.4); its values are data (assets/profiles/camera.json `overview`).
//   - Frames the cars' bounding box plus a margin, never the empty arena: each car now and `lookAheadS` ahead from its
//     smoothed velocity, so the frame opens before a car reaches the edge (predictive, POC2-07).
//   - Clamped to the arena: its centre drifts from the bowl's centre only as far as the smaller frame allows, so at high N
//     it settles on the whole arena and stays; the frame passes the whole bowl only to hold a car thrown out of it.
//   - Fixed pitch and heading, never rotates; centre and zoom follow critically damped springs with speed limits, zoom
//     out quicker than in (cars never leave the frame), and ignore moves inside a soft dead zone (no single-car jitter).
//     Round 0's per-frame refit made the owner motion sick (POC2-06).
// Pure maths: cars in, a pose out. `frame` is the height of ground the view shows, in metres.
import profile from '../../../../../assets/profiles/camera.json';

export type OverviewConfig = typeof profile.overview;
export const OVERVIEW: OverviewConfig = profile.overview;

/** Critically damped spring toward `target` with a speed limit (SmoothDamp). Returns [value, velocity]. */
export function smoothDamp(cur: number, target: number, vel: number, smoothTime: number, maxSpeed: number, dt: number): [number, number] {
  const st = Math.max(1e-4, smoothTime), omega = 2 / st, x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * st;
  const change = Math.max(-maxChange, Math.min(maxChange, cur - target));
  const to = cur - change;
  const temp = (vel + omega * change) * dt;
  return [to + (change + temp) * exp, (vel - omega * temp) * exp];
}

/** The ground height the frame must show for a box of `sx` × `sz` metres at this pitch and aspect. */
export const needFrame = (sx: number, sz: number, pitch: number, aspect: number): number => Math.max(sz * Math.sin(pitch) + 4, sx / aspect);

export interface OverviewPose {
  /** Camera position and look target, world metres. The camera looks along +z (from the arena's -z side). */
  position: [number, number, number];
  target: [number, number, number];
  frame: number;
  /** The frame the cars ask for: above `maxFrame` a car is outside the arena view. */
  wanted: number;
  maxFrame: number;
}

export interface Arena {
  x: number;
  z: number;
  /** The bowl's radius to its lip, metres: the whole arena the frame settles on. */
  r: number;
  /** Ground height the camera looks at. */
  y: number;
}

export class OverviewRig {
  private cx = 0;
  private cz = 0;
  private frameM = 0;
  private vx = 0;
  private vz = 0;
  private vf = 0;
  private gx = 0;
  private gz = 0;
  private gf = 0;
  private init = false;
  private prev = new Map<number, [number, number]>();
  private vel = new Map<number, [number, number]>();
  private wanted = 0;
  private share = 1;

  constructor(readonly arena: Arena, readonly cfg: OverviewConfig = OVERVIEW) {}

  reset(): void {
    this.init = false;
    this.prev.clear();
    this.vel.clear();
  }

  /** The frame that holds the whole arena at this aspect. */
  maxFrame(aspect: number): number {
    const d = 2 * (this.arena.r + this.cfg.lipMarginM);
    return needFrame(d, d, (this.cfg.pitchDeg * Math.PI) / 180, aspect);
  }

  /** Steps the rig by `dt` seconds with the cars at `cars` ([id, x, z, y?] each) for a gameplay area of `aspect` (width /
   *  height) that is `share` of the view's height (the rest is the HUD's edge bands). */
  update(cars: ReadonlyArray<readonly [number, number, number, number?]>, dt: number, aspect: number, share = 1): OverviewPose {
    this.share = share;
    const cfg = this.cfg, a = this.arena;
    const pitch = (cfg.pitchDeg * Math.PI) / 180;
    const maxFrame = this.maxFrame(aspect);
    if (!cars.length) {
      if (!this.init) Object.assign(this, { cx: a.x, cz: a.z, frameM: maxFrame, gx: a.x, gz: a.z, gf: maxFrame, wanted: maxFrame, init: true });
      return this.pose(maxFrame);
    }
    const ease = (tau: number) => 1 - Math.exp(-dt / Math.max(1e-4, tau));
    const soft = (cur: number, target: number, dz: number) => {
      const d = target - cur;
      return Math.abs(d) <= dz ? cur : target - Math.sign(d) * dz;
    };
    // Each car's velocity (smoothed, so one jolt doesn't swing the frame) and where it takes the car `lookAheadS` from
    // now. The centre follows where the cars are going; the frame covers both now and then.
    let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
    let [px0, px1, pz0, pz1] = [Infinity, -Infinity, Infinity, -Infinity];
    const k = ease(cfg.velocitySmoothS);
    const seen = new Set<number>();
    // A car above the arena's ground (up the bank, on the lip, in the air) shows further up the screen: it is framed as
    // the ground point it covers, its height over the pitch's tangent further away.
    const lift = 1 / Math.tan(pitch);
    for (const [id, x, z0c, y] of cars) {
      const z = z0c + Math.max(0, (y ?? a.y) - a.y) * lift;
      seen.add(id);
      const p = this.prev.get(id);
      let v = this.vel.get(id);
      if (!v) this.vel.set(id, (v = [0, 0]));
      // A jump of more than a few metres in one step is a respawn or a placement: no velocity from it.
      if (p && dt > 0 && Math.hypot(x - p[0], z - p[1]) < 40 * dt + 1) {
        v[0] += ((x - p[0]) / dt - v[0]) * k;
        v[1] += ((z - p[1]) / dt - v[1]) * k;
      }
      this.prev.set(id, [x, z]);
      let fx = x + v[0] * cfg.lookAheadS, fz = z + v[1] * cfg.lookAheadS;
      // No car drives through the bowl's wall: where a car is heading stops at the lip (a car already outside keeps its own
      // place in the box, so it is never cropped).
      const fr = Math.hypot(fx - a.x, fz - a.z), lip = Math.max(a.r, Math.hypot(x - a.x, z - a.z));
      if (fr > lip) [fx, fz] = [a.x + ((fx - a.x) / fr) * lip, a.z + ((fz - a.z) / fr) * lip];
      [x0, x1, z0, z1] = [Math.min(x0, x, fx), Math.max(x1, x, fx), Math.min(z0, z, fz), Math.max(z1, z, fz)];
      [px0, px1, pz0, pz1] = [Math.min(px0, fx), Math.max(px1, fx), Math.min(pz0, fz), Math.max(pz1, fz)];
    }
    for (const id of [...this.prev.keys()]) if (!seen.has(id)) (this.prev.delete(id), this.vel.delete(id));
    const m = cfg.marginM;
    let tx = (px0 + px1) / 2, tz = (pz0 + pz1) / 2;
    // Clamped to the arena: the centre may leave the bowl's centre only by the room a smaller frame leaves inside it.
    const drift = Math.max(0, (maxFrame - (this.init ? this.frameM : cfg.minFrameM)) / 2);
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    if (d > drift) [tx, tz] = d > 1e-6 ? [a.x + (dx / d) * drift, a.z + (dz / d) * drift] : [a.x, a.z];
    // The frame covers the box from the clamped centre, so the clamp never crops a car.
    const sx = 2 * Math.max(x1 - tx, tx - x0) + 2 * m, sz = 2 * Math.max(z1 - tz, tz - z0) + 2 * m;
    this.wanted = needFrame(sx, sz, pitch, aspect);
    // Never past the whole arena while the cars fit in it; a car outside the bowl (thrown over the lip) still never gets
    // cropped: the frame grows to hold it, and the host is offered the Grid.
    const tf = Math.max(cfg.minFrameM, this.wanted);
    if (!this.init) {
      Object.assign(this, { cx: tx, cz: tz, frameM: tf, vx: 0, vz: 0, vf: 0, gx: tx, gz: tz, gf: tf, init: true });
      return this.pose(maxFrame);
    }
    // The goal: a soft dead zone (a single car's wobble doesn't move it), then a low-pass, so the spring's acceleration
    // never steps (low jerk).
    const g = ease(cfg.goalSmoothS);
    this.gx += (soft(this.cx, tx, cfg.deadZoneM) - this.gx) * g;
    this.gz += (soft(this.cz, tz, cfg.deadZoneM) - this.gz) * g;
    // Zooming out never waits in the dead zone: a car near the edge is framed at once; zooming in does.
    this.gf += ((tf > this.frameM ? tf : soft(this.frameM, tf, this.frameM * cfg.deadZoneFrame)) - this.gf) * g;
    const s = cfg.smoothTimeS;
    [this.cx, this.vx] = smoothDamp(this.cx, this.gx, this.vx, s.pan, cfg.maxPanMps, dt);
    [this.cz, this.vz] = smoothDamp(this.cz, this.gz, this.vz, s.pan, cfg.maxPanMps, dt);
    [this.frameM, this.vf] = smoothDamp(this.frameM, this.gf, this.vf, this.gf > this.frameM ? s.zoomOut : s.zoomIn, this.gf > this.frameM ? cfg.maxZoomOutMps : cfg.maxZoomMps, dt);
    return this.pose(maxFrame);
  }

  private pose(maxFrame: number): OverviewPose {
    const cfg = this.cfg;
    const pitch = (cfg.pitchDeg * Math.PI) / 180, vfov = (cfg.fovDeg * Math.PI) / 180;
    const dist = this.frameM / this.share / 2 / Math.tan(vfov / 2) + 6;
    const y = this.arena.y;
    return {
      position: [this.cx, y + Math.sin(pitch) * dist, this.cz - Math.cos(pitch) * dist],
      target: [this.cx, y, this.cz],
      frame: this.frameM,
      wanted: this.wanted,
      maxFrame,
    };
  }
}
