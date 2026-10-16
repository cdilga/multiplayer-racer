// P1-FL16: counterpart of jj-map::fork::path_of (same constants, same arithmetic). The branch is drawn on the ground the
// generator stamped for it; the sim drives that ground, so this line is only paint.
import type { Params } from '../kit/types';
import type { MapJson } from './map';

const STEP_M = 2.5;
const END_M = 40;

const lengthM = (path: number[][]): number => {
  let l = 0;
  for (let k = 1; k < path.length; k++) l += Math.hypot(path[k]![0]! - path[k - 1]![0]!, path[k]![1]! - path[k - 1]![1]!);
  return l;
};

/** The branch's centreline (m, [x, z]) for a fork feature's params, or [] when they don't describe one. */
export function forkPath(map: MapJson, p: Params): number[][] {
  const pts = map.route.points;
  const n = pts.length;
  const [from, to] = [p.fromAt ?? -1, p.toAt ?? -1];
  if (n < 3 || from < 0 || to < 0 || from >= n || to >= n || from === to) return [];
  const frame = (i: number): [number[], number[]] => {
    const at = (k: number) => [pts[k % n]!.x / 1000, pts[k % n]!.z / 1000];
    const [a, b] = [at(i + n - 1), at(i + 1)];
    const l = Math.max(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!), 1e-9);
    return [[(b[0]! - a[0]!) / l, (b[1]! - a[1]!) / l], at(i)];
  };
  const turned = (v: number[], deg: number) => {
    const [s, c] = [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
    return [v[0]! * c - v[1]! * s, v[0]! * s + v[1]! * c];
  };
  const side = p.side ?? 1;
  const [ta, pa] = frame(from);
  const [tb, pb] = frame(to);
  const da = turned(ta, (side * (p.splitCdeg ?? 0)) / 100);
  const db = turned(tb, (-side * (p.mergeCdeg ?? 0)) / 100);
  const [inM, outM] = [(p.inMm ?? 0) / 1000, (p.outMm ?? 0) / 1000];
  const m0 = [da[0]! * inM, da[1]! * inM];
  const m1 = [db[0]! * outM, db[1]! * outM];
  const at = (t: number) => {
    const [t2, t3] = [t * t, t * t * t];
    const [h00, h10, h01, h11] = [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2];
    return [0, 1].map((c) => h00 * pa[c]! + h10 * m0[c]! + h01 * pb[c]! + h11 * m1[c]!);
  };
  const coarse = Array.from({ length: 65 }, (_, k) => at(k / 64));
  const count = Math.max(Math.ceil(lengthM(coarse) / STEP_M), 2);
  const curve = Array.from({ length: count + 1 }, (_, k) => at(k / count));
  const [wiggle, wave] = [(p.wiggleMm ?? 0) / 1000, (p.waveMm ?? 0) / 1000];
  if (wiggle <= 0 || wave <= 0) return curve;
  const total = lengthM(curve);
  const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
  let u = 0;
  return curve.map((q, k) => {
    if (k > 0) u += Math.hypot(q[0]! - curve[k - 1]![0]!, q[1]! - curve[k - 1]![1]!);
    const [a, b] = [curve[Math.max(k - 1, 0)]!, curve[Math.min(k + 1, curve.length - 1)]!];
    const l = Math.max(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!), 1e-9);
    const left = [-(b[1]! - a[1]!) / l, (b[0]! - a[0]!) / l];
    const env = smooth((u - END_M) / (wave / 2)) * smooth((total - u - END_M) / (wave / 2));
    const off = wiggle * env * Math.sin((2 * Math.PI * (u - END_M)) / wave);
    return [q[0]! + left[0]! * off, q[1]! + left[1]! * off];
  });
}

/** The surface a branch is paved with (jj-map `fork::surface_code`). */
export const forkSurface = (p: Params): string => ['tarmac', 'packed-dirt', 'gravel'][p.surface ?? 1] ?? 'packed-dirt';
