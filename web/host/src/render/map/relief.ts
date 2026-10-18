// A derby arena's jump paint (P1-M-arena-features-paint, br-qb0l). The arena's field (jj-procgen `arena::field`) is height
// in the terrain grid: table-tops and kickers (bare rock in the map's surfaces) and broad mounds and dips. Painted by the
// terrain's nearest-sample rule a rotated jump was a dark patch with stair-stepped edges, and its 12 degree ramps lit like
// the floor under the 60 degree Overview. Here each jump is recovered from the heights as the field built it (a footprint
// rectangle with an up-ramp, a table, a down-ramp and two side slopes; see `fitJump`) and painted in its own frame, so
// every paint edge is a straight line:
// - ramps and table in the race jumps' tan, the side slopes a darker skirt;
// - the last metre up to the table at either end a lip band in ink (br-gw74.13.1.1.1's convention: ink on the tan ramps),
//   so the jump reads as ramp, lip, table, lip, ramp from the Overview and the chase cameras;
// - each face lit by its own plane's normal (one tone per face, the toon look), and hill-shaded against the sun in a flat
//   step, so a 12 degree ramp facing the sun reads lighter and one facing away darker even under the toon ramp's bands.
// Mounds and dips keep the floor's paint but are lit by the heightfield's smooth normal at each corner, so the toon ramp's
// band edge curves round them instead of flipping facet by facet into a stair-stepped patch.
// Only the paint and the shading normals change: every triangle is split along straight lines in its own plane, so the
// surface is the sim's. The sim's surface lookup stays nearest-sample (the grip under a car is the map's rock or dirt).
import type { MapJson } from './map';
import { bowlDesign } from './bowl';
import { INK } from '../look';

export type V3 = [number, number, number];
/** `normal`: the shading normal, one for the face (3 numbers) or one per corner (9). */
export type Emit = (a: V3, b: V3, c: V3, colour: string, normal?: number[]) => void;

/** The race jumps' ramp tan (SURFACE_COLOURS['packed-dirt']), a jump's side skirt, its lip band. */
export const RELIEF_COLOURS = { ramp: '#e0b684', side: '#b8683f', lip: INK };
/** Jump samples are those over 3 cm (jj-procgen `arena::generate`). */
const JUMP_M = 0.03;
/** The lip band's run up a ramp to the table (m). */
const LIP_M = 1.0;
/** The sun's direction (look `followSun`: from (54, 75, -107) towards the field). */
const SUN: V3 = (() => {
  const l = Math.hypot(54, 75, 107);
  return [54 / l, 75 / l, -107 / l];
})();
/** Hill-shade: tone change per unit of n.l against flat ground, in steps, within these bounds. */
const SHADE_GAIN = 1.2;
const SHADE_STEP = 0.06;
const SHADE_MIN = -0.24;
const SHADE_MAX = 0.12;

const scale = (hex: string, f: number): string => {
  if (f === 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${((c(n >> 16) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).padStart(6, '0')}`;
};
const shadeOf = (n: V3): number => {
  const d = SHADE_GAIN * (n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2] - SUN[1]);
  return 1 + Math.max(SHADE_MIN, Math.min(SHADE_MAX, Math.round(d / SHADE_STEP) * SHADE_STEP));
};

/** Splits a convex polygon where the linear function `f` crosses `level`: the part below and the part above, in order. */
function split(poly: V3[], f: (p: V3) => number, level: number): [V3[], V3[]] {
  const below: V3[] = [];
  const above: V3[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    const [fa, fb] = [f(a) - level, f(b) - level];
    (fa < 0 ? below : above).push(a);
    if (fa < 0 !== fb < 0) {
      const t = fa / (fa - fb);
      const p: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      below.push(p);
      above.push(p);
    }
  }
  return [below.length >= 3 ? below : [], above.length >= 3 ? above : []];
}

/** A jump as the field built it, in its own frame: `u` along `dir` (up its first ramp) and `v` across, from `c`. */
export interface JumpFrame {
  c: [number, number];
  dir: [number, number];
  /** The footprint's ends along `u` and the lips (where each ramp meets the table). */
  foot: [number, number];
  lip: [number, number];
  /** The footprint's sides along `v` and the table's edges. */
  side: [number, number];
  top: [number, number];
  /** The ramps' and side slopes' rise over run. */
  slope: [number, number, number, number];
  height: number;
}

/** Least squares h = a + b t over `pts`, dropping points more than 6 cm off the first fit. */
function line(pts: [number, number][]): { a: number; b: number } | null {
  const fit = (p: [number, number][]) => {
    if (p.length < 3) return null;
    let [st, sh, stt, sth] = [0, 0, 0, 0];
    for (const [t, h] of p) [st, sh, stt, sth] = [st + t, sh + h, stt + t * t, sth + t * h];
    const n = p.length;
    const den = n * stt - st * st;
    if (Math.abs(den) < 1e-9) return null;
    const b = (n * sth - st * sh) / den;
    return { a: (sh - b * st) / n, b };
  };
  const first = fit(pts);
  if (!first) return null;
  return fit(pts.filter(([t, h]) => Math.abs(first.a + first.b * t - h) < 0.06)) ?? first;
}

/** Recovers a jump from its samples (x, z, h above the floor, gradient): the footprint's orientation as the smallest box
 *  round its samples, its ramps as the box axis whose faces are gentler (ramps 0.15-0.23, sides about 0.45), each face's
 *  foot and crest from a line fitted to the samples on it, and the table at the top (the field snaps heights to 0.1 m). */
export function fitJump(pts: { x: number; z: number; h: number; gx: number; gz: number }[], spacing: number): JumpFrame | null {
  const inside = pts.filter((p) => p.h > JUMP_M);
  if (inside.length < 4) return null;
  const height = Math.ceil(Math.max(...inside.map((p) => p.h)) * 10 - 1e-6) / 10;
  let best = { area: Infinity, a: 0 };
  for (let k = 0; k < 180; k++) {
    const a = (k / 180) * (Math.PI / 2);
    const [ca, sa] = [Math.cos(a), Math.sin(a)];
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of inside) {
      const u = p.x * ca + p.z * sa;
      const v = -p.x * sa + p.z * ca;
      [u0, u1, v0, v1] = [Math.min(u0, u), Math.max(u1, u), Math.min(v0, v), Math.max(v1, v)];
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) best = { area, a };
  }
  const span = (ax: [number, number]) => {
    const t = inside.map((p) => p.x * ax[0] + p.z * ax[1]);
    return [Math.min(...t), Math.max(...t)] as const;
  };
  // Each axis's two faces: the samples on that half of the footprint whose slope points along the axis, rising (+1) at
  // its low end or falling (-1) at its high end.
  const faces = (ax: [number, number]) => {
    const px: [number, number] = [-ax[1], ax[0]];
    const [lo, hi] = span(ax);
    return ([1, -1] as const).map((sign) => {
      const on: [number, number][] = [];
      for (const p of pts) {
        const t = p.x * ax[0] + p.z * ax[1];
        const ga = (p.gx * ax[0] + p.gz * ax[1]) * sign;
        const gp = Math.abs(p.gx * px[0] + p.gz * px[1]);
        if ((t - (lo + hi) / 2) * sign < 0 && ga > 0.05 && ga > 1.5 * gp && p.h > 0.015 && p.h < height - 0.03) on.push([t, p.h]);
      }
      const l = line(on);
      return l && l.b * sign > 0.05 ? l : null;
    });
  };
  const axes: [number, number][] = [
    [Math.cos(best.a), Math.sin(best.a)],
    [-Math.sin(best.a), Math.cos(best.a)],
  ];
  const fits = axes.map(faces);
  const steep = (f: ({ a: number; b: number } | null)[]) => {
    const s = f.filter((l) => l).map((l) => Math.abs(l!.b));
    return s.length ? s.reduce((x, y) => x + y) / s.length : Infinity;
  };
  const along = steep(fits[0]!) <= steep(fits[1]!) ? 0 : 1;
  const dir = axes[along]!;
  const across: [number, number] = [-dir[1], dir[0]];
  // Footprint and crest along an axis: from the fitted faces, else from the samples' extent and the field's slopes.
  // The outermost jump samples stand inside the footprint, and the next ones out (at most a sample spacing on) outside it:
  // a fitted foot is held to that, and a crest to the footprint.
  const extent = (ax: [number, number], f: ({ a: number; b: number } | null)[], slope: number) => {
    const [lo, hi] = span(ax);
    const rise = f[0] ?? { a: -slope * lo + JUMP_M, b: slope };
    const fall = f[1] ?? { a: slope * hi + JUMP_M, b: -slope };
    const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
    const foot: [number, number] = [clamp(-rise.a / rise.b, lo - spacing, lo), clamp(-fall.a / fall.b, hi, hi + spacing)];
    let crest: [number, number] = [clamp((height - rise.a) / rise.b, foot[0], foot[1]), clamp((height - fall.a) / fall.b, foot[0], foot[1])];
    // A table no wider than nothing: the crests meet (a peak) rather than cross.
    if (crest[0] > crest[1]) crest = [(crest[0] + crest[1]) / 2, (crest[0] + crest[1]) / 2];
    return { foot, crest, slopes: [Math.abs(rise.b), Math.abs(fall.b)] };
  };
  const u = extent(dir, fits[along]!, 0.2);
  // `across` is the other axis turned to the frame's handedness (it may point the other way): its faces are fitted again.
  const v = extent(across, faces(across), 0.45);
  return {
    c: [0, 0],
    dir,
    foot: u.foot,
    lip: u.crest,
    side: v.foot,
    top: v.crest,
    slope: [u.slopes[0]!, u.slopes[1]!, v.slopes[0]!, v.slopes[1]!],
    height,
  };
}

export interface ReliefPainter {
  readonly jumps: JumpFrame[];
  /** Paints triangle a-b-c (counter-clockwise from above) of the ground, `base` its nearest-sample paint: emits it as one or
   *  more same-plane triangles, a jump's with its face's normal. */
  tri(a: V3, b: V3, c: V3, base: string, emit: Emit): void;
}

/** The painter for a derby arena's ground, or null on a track (whose terrain keeps the nearest-sample paint). */
export function arenaRelief(map: MapJson, floor: string, rock: string): ReliefPainter | null {
  const bowlF = map.features.find((f) => f.kind === 'bowl');
  const bowl = bowlF && bowlDesign(bowlF.pose, bowlF.params);
  if (!bowl) return null;
  const t = map.terrain;
  const sp = t.spacing / 1000;
  const xOf = (j: number) => (t.originX + j * t.spacing) / 1000;
  const zOf = (i: number) => (t.originZ + i * t.spacing) / 1000;
  const hOf = (i: number, j: number) => t.heights[Math.min(Math.max(i, 0), t.rows - 1) * t.cols + Math.min(Math.max(j, 0), t.cols - 1)]! / 100 - bowl.baseY;
  const onFloor = (i: number, j: number) => t.surfaces[i * t.cols + j] === 'rock' && Math.hypot(xOf(j) - bowl.cx, zOf(i) - bowl.cz) < bowl.floorR;
  // The jumps: 8-connected bare-rock samples on the floor, with the samples round them (still on their slopes).
  const seen = new Uint8Array(t.cols * t.rows);
  const jumps: JumpFrame[] = [];
  for (let i0 = 0; i0 < t.rows; i0++)
    for (let j0 = 0; j0 < t.cols; j0++) {
      if (seen[i0 * t.cols + j0] || !onFloor(i0, j0)) continue;
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[i0, j0]];
      seen[i0 * t.cols + j0] = 1;
      while (stack.length) {
        const [i, j] = stack.pop()!;
        cells.push([i, j]);
        for (let di = -1; di <= 1; di++)
          for (let dj = -1; dj <= 1; dj++) {
            const [ii, jj] = [i + di, j + dj];
            if (ii < 0 || jj < 0 || ii >= t.rows || jj >= t.cols || seen[ii * t.cols + jj] || !onFloor(ii, jj)) continue;
            seen[ii * t.cols + jj] = 1;
            stack.push([ii, jj]);
          }
      }
      const ring = new Map<number, [number, number]>();
      for (const [i, j] of cells) for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) ring.set((i + di) * t.cols + j + dj, [i + di, j + dj]);
      // Local coordinates round the first sample keep the fit's sums small.
      const [ox, oz] = [xOf(j0), zOf(i0)];
      const pts = [...ring.values()]
        .filter(([i, j]) => i >= 0 && j >= 0 && i < t.rows && j < t.cols)
        .map(([i, j]) => ({ x: xOf(j) - ox, z: zOf(i) - oz, h: hOf(i, j), gx: (hOf(i, j + 1) - hOf(i, j - 1)) / (2 * sp), gz: (hOf(i + 1, j) - hOf(i - 1, j)) / (2 * sp) }));
      const fit = fitJump(pts, sp);
      if (fit) jumps.push({ ...fit, c: [ox, oz] });
    }

  // The heightfield's normal at (x, z): its samples' central differences, bilinear between them.
  const gradX = (i: number, j: number) => (hOf(i, j + 1) - hOf(i, j - 1)) / (2 * sp);
  const gradZ = (i: number, j: number) => (hOf(i + 1, j) - hOf(i - 1, j)) / (2 * sp);
  const normalAt = (p: V3): V3 => {
    const c = Math.min(Math.max((p[0] * 1000 - t.originX) / t.spacing, 0), t.cols - 1);
    const r = Math.min(Math.max((p[2] * 1000 - t.originZ) / t.spacing, 0), t.rows - 1);
    const [j, i] = [Math.min(Math.floor(c), t.cols - 2), Math.min(Math.floor(r), t.rows - 2)];
    const [fc, fr] = [c - j, r - i];
    const bi = (g: (i: number, j: number) => number) =>
      (g(i, j) * (1 - fc) + g(i, j + 1) * fc) * (1 - fr) + (g(i + 1, j) * (1 - fc) + g(i + 1, j + 1) * fc) * fr;
    const [gx, gz] = [bi(gradX), bi(gradZ)];
    const l = Math.hypot(gx, 1, gz);
    return [-gx / l, 1 / l, -gz / l];
  };
  const emitPoly = (poly: V3[], colour: string, normal: V3 | undefined, emit: Emit) => {
    for (let k = 1; k + 1 < poly.length; k++) emit(poly[0]!, poly[k]!, poly[k + 1]!, colour, normal);
  };
  const UP: V3 = [0, 1, 0];
  const faceNormal = (ax: [number, number], slope: number): V3 => {
    const l = Math.hypot(slope, 1);
    return [(-slope * ax[0]) / l, 1 / l, (-slope * ax[1]) / l];
  };

  return {
    jumps,
    tri(a, b, c, base, emit) {
      // The jump whose footprint (grown by a cell) the triangle touches, if any.
      const jump = jumps.find((J) => {
        const u = (p: V3) => (p[0] - J.c[0]) * J.dir[0] + (p[2] - J.c[1]) * J.dir[1];
        const v = (p: V3) => -(p[0] - J.c[0]) * J.dir[1] + (p[2] - J.c[1]) * J.dir[0];
        const us = [u(a), u(b), u(c)];
        const vs = [v(a), v(b), v(c)];
        return Math.max(...us) > J.foot[0] - sp && Math.min(...us) < J.foot[1] + sp && Math.max(...vs) > J.side[0] - sp && Math.min(...vs) < J.side[1] + sp;
      });
      if (!jump) {
        // Bare rock on the floor is only ever a jump's: one the fit missed is drawn as floor, never as stair-stepped rock.
        const onFloor = [a, b, c].some((p) => Math.hypot(p[0] - bowl.cx, p[2] - bowl.cz) < bowl.floorR);
        // A mound or dip is lit by the heightfield's smooth normal at each corner, so the toon ramp's band edge runs as a
        // curve round it rather than flipping facet by facet (a stair-stepped patch from the Overview).
        const relief = onFloor && [a, b, c].some((p) => Math.abs(p[1] - bowl.baseY) > 0.005);
        emit(a, b, c, onFloor && base === rock ? floor : base, relief ? [...normalAt(a), ...normalAt(b), ...normalAt(c)] : undefined);
        return;
      }
      const J = jump;
      const across: [number, number] = [-J.dir[1], J.dir[0]];
      const u = (p: V3) => (p[0] - J.c[0]) * J.dir[0] + (p[2] - J.c[1]) * J.dir[1];
      const v = (p: V3) => (p[0] - J.c[0]) * across[0] + (p[2] - J.c[1]) * across[1];
      const paint = (poly: V3[], colour: string, normal: V3) => {
        if (poly.length) emitPoly(poly, normal === UP ? colour : scale(colour, shadeOf(normal)), normal, emit);
      };
      // Outside the footprint: the floor, lit flat.
      let [out, rest] = split([a, b, c], u, J.foot[0]);
      paint(out, floor, UP);
      [rest, out] = split(rest, u, J.foot[1]);
      paint(out, floor, UP);
      [out, rest] = split(rest, v, J.side[0]);
      paint(out, floor, UP);
      [rest, out] = split(rest, v, J.side[1]);
      paint(out, floor, UP);
      // The side slopes along the footprint's long edges.
      let side: V3[];
      [side, rest] = split(rest, v, J.top[0]);
      paint(side, RELIEF_COLOURS.side, faceNormal(across, J.slope[2]));
      [rest, side] = split(rest, v, J.top[1]);
      paint(side, RELIEF_COLOURS.side, faceNormal([-across[0], -across[1]], J.slope[3]));
      // Up the first ramp, its lip band, the table, the second lip band and down the second ramp.
      const rampA = faceNormal(J.dir, J.slope[0]);
      const rampB = faceNormal([-J.dir[0], -J.dir[1]], J.slope[1]);
      let part: V3[];
      [part, rest] = split(rest, u, Math.max(J.foot[0], J.lip[0] - LIP_M));
      paint(part, RELIEF_COLOURS.ramp, rampA);
      [part, rest] = split(rest, u, J.lip[0]);
      paint(part, RELIEF_COLOURS.lip, rampA);
      [part, rest] = split(rest, u, J.lip[1]);
      paint(part, RELIEF_COLOURS.ramp, UP);
      [part, rest] = split(rest, u, Math.min(J.foot[1], J.lip[1] + LIP_M));
      paint(part, RELIEF_COLOURS.lip, rampB);
      paint(rest, RELIEF_COLOURS.ramp, rampB);
    },
  };
}
