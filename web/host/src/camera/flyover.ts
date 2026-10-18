// The next track's flyover on the TV (br-qw28, R125): between rounds, before the countdown, one camera flies the route
// from the start line to the finish in the flyover's time (6 s, data in assets/profiles/rounds.json), high and a little
// behind the line it follows, looking along it. It eases in and out, and turns smoothly: the look point runs ahead on the
// same route. Pure maths: route in, a pose out.
export interface FlyoverPose {
  position: [number, number, number];
  target: [number, number, number];
  /** Fraction of the route's length the camera has followed (0 at the start line, 1 back at it). */
  along: number;
}

export class Flyover {
  private pts: Array<[number, number, number]>;
  private cum: number[] = [0];
  readonly length: number;

  /** `route` is the map's route points in millimetres (a closed loop, start line first). */
  constructor(route: ReadonlyArray<{ x: number; y: number; z: number }>) {
    this.pts = route.map((p) => [p.x / 1000, p.y / 1000, p.z / 1000]);
    for (let i = 0; i < this.pts.length; i++) {
      const a = this.pts[i]!, b = this.pts[(i + 1) % this.pts.length]!;
      this.cum.push(this.cum[i]! + Math.hypot(b[0] - a[0], b[2] - a[2]));
    }
    this.length = this.cum.at(-1)!;
  }

  /** The route point `d` metres from the start line (wrapping). */
  at(d: number): [number, number, number] {
    const L = this.length || 1;
    d = ((d % L) + L) % L;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo % this.pts.length]!, b = this.pts[(lo + 1) % this.pts.length]!;
    const seg = this.cum[lo + 1]! - this.cum[lo]! || 1;
    const t = (d - this.cum[lo]!) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /** The camera at time fraction `u` (0..1) of the flyover: eased, so it starts and ends gently. */
  pose(u: number): FlyoverPose {
    u = Math.max(0, Math.min(1, u));
    const along = u * u * (3 - 2 * u);
    const d = along * this.length;
    // The look point runs 35 m ahead; the camera sits 20 m back along the route and 22 m up, so turns pan smoothly.
    const look = this.at(d + 35), here = this.at(d), back = this.at(d - 20);
    const [dx, dz] = [here[0] - back[0], here[2] - back[2]];
    const n = Math.hypot(dx, dz) || 1;
    return {
      position: [here[0] - (dx / n) * 20, Math.max(here[1], back[1]) + 22, here[2] - (dz / n) * 20],
      target: [look[0], look[1] + 1, look[2]],
      along,
    };
  }
}
