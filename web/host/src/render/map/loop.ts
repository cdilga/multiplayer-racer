// R124 (br-xlvx.6): exact counterpart of jj-map::looping. The deck leaves the road at the entry route point E and rejoins
// it at the exit X along a helix (along = A·t + R·sin θ, up = R(1 − cos θ), lateral = S(t − sin 2πt / 2π)), and the
// uploaded f32 triangles are compared with the native collision geometry (same arithmetic, same order).
import type { Params } from '../kit/types';
import type { MapJson } from './map';

type V3 = [number, number, number];

interface Frame { e: V3; forward: [number, number]; left: [number, number]; runOut: number; shift: number; halfWidth: number; yExit: number }

const point = (map: MapJson, i: number): V3 => { const q = map.route.points[i]!; return [q.x / 1000, q.y / 1000, q.z / 1000]; };

/** jj-map::looping::frame: forward is the road's direction arriving at E. */
export function loopFrame(map: MapJson, p: Params): Frame | null {
  const n = map.route.points.length, entry = p.entry!, exit = p.exit!;
  if (!Number.isInteger(entry) || !Number.isInteger(exit) || entry === 0 || entry >= exit || exit >= n) return null;
  const e = point(map, entry), before = point(map, entry - 1);
  const [dx, dz] = [e[0] - before[0], e[2] - before[2]], len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  const forward: [number, number] = [dx / len, dz / len], left: [number, number] = [forward[1], -forward[0]];
  const x = point(map, exit), [ex, ez] = [x[0] - e[0], x[2] - e[2]];
  return { e, forward, left, runOut: ex * forward[0] + ez * forward[1], shift: ex * left[0] + ez * left[1], halfWidth: map.route.points[entry]!.width / 2000, yExit: x[1] };
}

const TAU = 2 * Math.PI;

/** jj-map::looping::centre. */
function centre(fr: Frame, r: number, t: number): V3 {
  const th = TAU * t, along = fr.runOut * t + r * Math.sin(th), up = r * (1 - Math.cos(th)), lat = fr.shift * (t - Math.sin(th) / TAU);
  return [fr.e[0] + fr.forward[0] * along + fr.left[0] * lat, fr.e[1] + (fr.yExit - fr.e[1]) * t + up, fr.e[2] + fr.forward[1] * along + fr.left[1] * lat];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => scale(a, 1 / Math.max(Math.sqrt(dot(a, a)), 1e-12));

/** jj-map::looping::loop_mesh: the deck and two barriers as closed prisms; `beams` names each triangle's prism
 *  (0 deck, 1 left barrier, 2 right barrier) and `surfaces` its material, as jj-map::looping::triangle_surfaces. */
export function loopMesh(map: MapJson, p: Params): { vertices: number[][]; triangles: number[][]; beams: number[]; surfaces: string[] } | null {
  const fr = loopFrame(map, p);
  const r = p.radiusMm! / 1000, thick = p.thicknessMm! / 1000, bh = p.barrierHeightMm! / 1000, bw = p.barrierWidthMm! / 1000, segs = p.segments!;
  if (!fr || !(r > 0) || !(thick > 0) || !(bh > 0) || !(bw > 0) || !(segs >= 2)) return null;
  // jj-map::looping::sections: the Frenet frame (normal = principal normal, side = binormal).
  const tangent = (t: number) => { const h = 1e-4; return unit(sub(centre(fr, r, t + h), centre(fr, r, t - h))); };
  const secs = Array.from({ length: segs + 1 }, (_, k) => {
    const t = k / segs, h = 1e-3, tg = tangent(t);
    const normal = unit(sub(tangent(t + h), tangent(t - h)));
    return { c: centre(fr, r, t), side: cross(normal, tg), normal };
  });
  const vertices: number[][] = [], triangles: number[][] = [], beams: number[] = [];
  for (let beam = 0; beam < 3; beam++) {
    const start = vertices.length;
    for (const s of secs) {
      const l0 = add(s.c, scale(s.side, fr.halfWidth)), r0 = sub(s.c, scale(s.side, fr.halfWidth));
      const [l, rr, depth] = beam === 0 ? [l0, r0, thick] : beam === 1 ? [add(l0, scale(s.side, bw)), l0, bh] : [r0, sub(r0, scale(s.side, bw)), bh];
      const lift = beam === 0 ? 0 : bh;
      const lt = add(l, scale(s.normal, lift)), rt = add(rr, scale(s.normal, lift));
      vertices.push(lt, rt, sub(lt, scale(s.normal, depth)), sub(rt, scale(s.normal, depth)));
    }
    const quad = (a: number, b: number, c: number, e: number) => { triangles.push([a, b, c], [a, c, e]); beams.push(beam, beam); };
    for (let k = 0; k < secs.length - 1; k++) {
      const a = start + k * 4;
      quad(a + 1, a + 5, a + 4, a); quad(a + 2, a + 6, a + 7, a + 3); quad(a, a + 4, a + 6, a + 2); quad(a + 1, a + 3, a + 7, a + 5);
    }
    const end = start + (secs.length - 1) * 4;
    quad(start, start + 2, start + 3, start + 1); quad(end, end + 1, end + 3, end + 2);
  }
  const road = map.route.points[p.entry!]!.surface;
  const surfaces = beams.map((b) => (b === 0 ? road : 'rock'));
  return { vertices, triangles, beams, surfaces };
}
