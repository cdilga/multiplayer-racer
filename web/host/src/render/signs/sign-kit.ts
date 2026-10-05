// The Australian road-sign kit (P1-M09, plan §8.3, master §11.5a): ONE code-drawn kit that renders any sign from its
// data (family + text + pictogram, assets/kit/signs/data/<name>.json). Adding a sign never needs new geometry: the
// lettering is a stroke font built here, the pictograms are polygons built here, nothing is fetched (no images, no
// fonts, no CDN). Grammar per family is fixed by the data validator (crates/jj-procgen/src/signs):
//   warning   yellow rotated-square diamond, black border, black legend or pictogram
//   direction green rectangle, white border and legend, route shield + road name, destinations with km and arrows
//   tourist   brown rectangle, white border and legend
// Self-contained (imports only three) so plain `node --test` can import it as TypeScript.
import { BoxGeometry, BufferAttribute, Color, Path, Shape, ShapeGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { KitModule } from '../kit/types';

export interface SignDef {
  id: string;
  version: number;
  family: 'warning' | 'direction' | 'tourist';
  shape: 'diamond' | 'rectangle';
  background: string;
  legend: string;
  pictogram?: string;
  lines?: string[];
  shield?: string;
  heading?: string;
  rows?: { text: string; km: number; arrow: 'ahead' | 'left' | 'right' }[];
  sidecar: { family: string; source: string; licence: string; note?: string };
}

// ---- Sizes (metres): the registry collider boxes in assets/kit/signs/*.json are these extents. ----
export const SIZES = {
  warning: { side: 1.2, bottom: 1.2 }, // the diamond's side; its diagonal is 1.697 m
  direction: { w: 2.4, bottom: 1.4 }, // its height grows with the rows: see directionHeight
  tourist: { w: 1.8, h: 1.2, bottom: 1.3 },
} as const;
const POST_R = 0.0425;
const POST = '#9ba1a8';
const BACK = '#7b8087';
// Layers, front to back of the panel (a couple of mm apart: flat shapes, so no z-fighting at game distances).
const Z0 = POST_R;
const Z_PANEL = Z0 + 0.012;
const Z_FACE = Z_PANEL + 0.001;
const Z_BORDER = Z_FACE + 0.0015;
const Z_LEGEND = Z_BORDER + 0.0015;
const Z_CUT = Z_LEGEND + 0.0015;

type Pt = [number, number];

// ---- Lettering: a stroke font on a 4 x 6 cell (chamfered corners, bold), built as quads and joint discs. ----
interface Glyph {
  w: number;
  s: Pt[][];
}
const O: Pt[] = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
const P_: Pt[] = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];
export const FONT: Record<string, Glyph> = {
  A: { w: 4, s: [[[0, 0], [0, 4], [1, 6], [3, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]] },
  B: { w: 4, s: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [4, 2], [4, 1], [3, 0], [0, 0]], [[0, 3], [3, 3]]] },
  C: { w: 4, s: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]] },
  D: { w: 4, s: [[[0, 0], [0, 6], [2.5, 6], [4, 4.5], [4, 1.5], [2.5, 0], [0, 0]]] },
  E: { w: 4, s: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]] },
  F: { w: 4, s: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]] },
  G: { w: 4, s: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]] },
  H: { w: 4, s: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]] },
  I: { w: 0, s: [[[0, 0], [0, 6]]] },
  J: { w: 4, s: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]] },
  K: { w: 4, s: [[[0, 0], [0, 6]], [[4, 6], [0, 2.5]], [[1.2, 3.4], [4, 0]]] },
  L: { w: 4, s: [[[0, 6], [0, 0], [4, 0]]] },
  M: { w: 4, s: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]] },
  N: { w: 4, s: [[[0, 0], [0, 6], [4, 0], [4, 6]]] },
  O: { w: 4, s: [O] },
  P: { w: 4, s: [P_] },
  Q: { w: 4, s: [O, [[2.5, 1.8], [4, 0]]] },
  R: { w: 4, s: [P_, [[2, 3], [4, 0]]] },
  S: { w: 4, s: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]] },
  T: { w: 4, s: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]] },
  U: { w: 4, s: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]] },
  V: { w: 4, s: [[[0, 6], [2, 0], [4, 6]]] },
  W: { w: 4, s: [[[0, 6], [1, 0], [2, 3], [3, 0], [4, 6]]] },
  X: { w: 4, s: [[[0, 6], [4, 0]], [[4, 6], [0, 0]]] },
  Y: { w: 4, s: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]] },
  Z: { w: 4, s: [[[0, 6], [4, 6], [0, 0], [4, 0]]] },
  '0': { w: 4, s: [O] },
  '1': { w: 3, s: [[[0, 5], [1.5, 6], [1.5, 0]], [[0, 0], [3, 0]]] },
  '2': { w: 4, s: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]] },
  '3': { w: 4, s: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1.5, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]] },
  '4': { w: 4, s: [[[3, 0], [3, 6], [0, 2], [4, 2]]] },
  '5': { w: 4, s: [[[4, 6], [0, 6], [0, 3.2], [3, 3.5], [4, 2.5], [4, 1], [3, 0], [1, 0], [0, 1]]] },
  '6': { w: 4, s: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]] },
  '7': { w: 4, s: [[[0, 6], [4, 6], [1.5, 0]]] },
  '8': { w: 4, s: [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]] },
  '9': { w: 4, s: [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [4, 3]]] },
  '.': { w: 0, s: [[[0, 0], [0, 0.01]]] },
  '-': { w: 3, s: [[[0, 3], [3, 3]]] },
  '/': { w: 3, s: [[[0, 0], [3, 6]]] },
  ' ': { w: 3, s: [] },
};
const SW = 1.0; // stroke width in cell units
const GAP = 1.3; // space between letters in cell units

/** A direction sign's panel height (m): border and margin, the shield/road-name header, and one pitch per destination row. */
export const DIR_HEADER = 0.5;
export const DIR_PITCH = 0.3;
export const directionHeight = (rows: number): number => 0.26 + DIR_HEADER + DIR_PITCH * rows + 0.04;

/** The panel's height in metres (the diamond's diagonal for a warning sign): what the legibility rule scales from. */
export function panelHeight(def: SignDef): number {
  return def.family === 'warning' ? SIZES.warning.side * Math.SQRT2 : def.family === 'direction' ? directionHeight(def.rows?.length ?? 1) : SIZES.tourist.h;
}

/** Width and height of `text` set with cap height `h` (metres), stroke overhang included. */
export function measure(text: string, h: number): { w: number; h: number } {
  const u = h / (6 + SW);
  let cells = 0;
  [...text].forEach((ch, i) => {
    cells += (FONT[ch]?.w ?? 4) + (i ? GAP : 0);
  });
  return { w: (cells + SW) * u, h };
}

/** The widest cap height at which `text` still fits `maxW` (metres). */
export function fitHeight(text: string, maxW: number): number {
  return maxW / measure(text, 1).w;
}

// ---- Parts: flat polygons at a layer, merged at the end. ----
class Parts {
  readonly list: BufferGeometry[] = [];
  private readonly c = new Color();

  private paint(g: BufferGeometry, colour: string): BufferGeometry {
    const out = g.index ? g.toNonIndexed() : g;
    const n = out.attributes.position!.count;
    const a = new Float32Array(n * 3);
    this.c.set(colour);
    for (let i = 0; i < n; i++) this.c.toArray(a, i * 3);
    out.setAttribute('color', new BufferAttribute(a, 3));
    out.deleteAttribute('uv');
    return out;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, colour: string, rotZ = 0): void {
    const g = new BoxGeometry(w, h, d).rotateZ(rotZ).translate(x, y, z);
    this.list.push(this.paint(g, colour));
  }

  /** A filled polygon (optionally with holes) in the xy plane at depth z, wound to face +z. */
  poly(pts: Pt[], z: number, colour: string, holes: Pt[][] = []): void {
    const s = new Shape(pts.map(([x, y]) => ({ x, y }) as never));
    for (const h of holes) s.holes.push(new Path(h.map(([x, y]) => ({ x, y }) as never)));
    this.list.push(this.paint(new ShapeGeometry(s, 1).translate(0, 0, z), colour));
  }

  disc(cx: number, cy: number, r: number, z: number, colour: string, n = 8): void {
    this.poly(Array.from({ length: n }, (_, i): Pt => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]), z, colour);
  }

  /** A thick polyline: one quad per segment, a small disc at every interior joint. */
  stroke(pts: Pt[], width: number, z: number, colour: string): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) {
        this.disc(x0, y0, width / 2, z, colour, 6); // a dot
        continue;
      }
      const nx = (-(y1 - y0) / len) * (width / 2);
      const ny = ((x1 - x0) / len) * (width / 2);
      this.poly([[x0 + nx, y0 + ny], [x0 - nx, y0 - ny], [x1 - nx, y1 - ny], [x1 + nx, y1 + ny]], z, colour);
      if (i > 0) this.disc(x0, y0, width / 2, z, colour, 6);
    }
  }

  /** `text` with cap height `h`, left edge at x (align 'l'), centred on x ('c') or right edge at x ('r'); vertically
   *  centred on y. */
  text(text: string, x: number, y: number, h: number, align: 'l' | 'c' | 'r', z: number, colour: string): void {
    const u = h / (6 + SW);
    const m = measure(text, h);
    let px = align === 'l' ? x : align === 'c' ? x - m.w / 2 : x - m.w;
    px += (SW / 2) * u;
    const py = y - h / 2 + (SW / 2) * u;
    for (const ch of text) {
      const g = FONT[ch];
      if (!g) throw new Error(`no glyph for ${JSON.stringify(ch)}`);
      for (const s of g.s) this.stroke(s.map(([gx, gy]): Pt => [px + gx * u, py + gy * u]), SW * u, z, colour);
      px += (g.w + GAP) * u;
    }
  }

  merged(): BufferGeometry {
    const g = mergeGeometries(this.list);
    if (!g) throw new Error('sign parts have mismatched attributes');
    g.computeBoundingBox();
    return g;
  }
}

// ---- Pictograms: shapes in a box x -1..1, y -0.62..0.62, in the legend colour ('cut' parts in the background). ----
interface PictoPart {
  pts?: Pt[];
  line?: Pt[];
  width?: number;
  disc?: [number, number, number];
  cut?: boolean;
}

const turn = (pts: Pt[], deg: number, ox: number, oy: number, s: number): Pt[] => {
  const a = (deg * Math.PI) / 180;
  const [c, sn] = [Math.cos(a), Math.sin(a)];
  return pts.map(([x, y]): Pt => [ox + (x * c - y * sn) * s, oy + (x * sn + y * c) * s]);
};

/** A car in side view facing right, wheels on y = 0, about 1 unit long, placed at (ox, oy) turned `deg`. */
function car(ox: number, oy: number, s: number, deg: number): PictoPart[] {
  const at = (pts: Pt[]) => turn(pts, deg, ox, oy, s);
  const wheel = (cx: number): Pt[] => Array.from({ length: 10 }, (_, i): Pt => [cx + 0.115 * Math.cos((i / 10) * 6.2832), 0.115 + 0.115 * Math.sin((i / 10) * 6.2832)]);
  return [
    { pts: at([[-0.5, 0.08], [-0.5, 0.3], [-0.3, 0.34], [-0.14, 0.58], [0.2, 0.58], [0.38, 0.34], [0.5, 0.3], [0.5, 0.08]]) },
    { pts: at(wheel(-0.3)) },
    { pts: at(wheel(0.3)) },
    // Wheel arches and a window, cut back to the sign colour so the car reads as a car.
    { pts: at([[-0.24, 0.36], [-0.12, 0.52], [0.06, 0.52], [0.06, 0.36]]), cut: true },
    { pts: at([[0.12, 0.36], [0.12, 0.52], [0.19, 0.52], [0.31, 0.36]]), cut: true },
  ];
}

export const PICTOGRAMS: Record<string, () => PictoPart[]> = {
  // A crest: the road lifts over a rise and a vehicle goes over it.
  crest: () => {
    const hump: Pt[] = Array.from({ length: 21 }, (_, i): Pt => {
      const x = -1 + i * 0.1;
      return [x, -0.42 + 0.46 * Math.cos((x * Math.PI) / 2) ** 2];
    });
    return [{ line: hump, width: 0.13 }, ...car(0, 0.08, 0.78, 0)];
  },
  // A steep descent: a road dropping away to the right, a vehicle on it, nose down.
  'steep-descent': () => {
    const slope = (x: number) => 0.34 - 0.36 * (x + 1);
    return [
      { pts: [[-1, 0.3], [1, -0.42], [1, -0.58], [-1, -0.58]] },
      { pts: [[-1, 0.3 + 0.0], [-1, -0.58], [-0.8, -0.58], [-0.8, 0.3]], cut: true },
      ...car(-0.05, slope(-0.05) + 0.03, 0.72, -19.8),
    ];
  },
  // An unsealed road: a vehicle on a rough surface throwing stones.
  'unsealed-road': () => [
    ...car(0.18, -0.33, 0.66, 0),
    { line: [[-1, -0.44], [-0.82, -0.38], [-0.64, -0.47], [-0.46, -0.39], [-0.28, -0.46], [0, -0.4], [0.3, -0.47], [0.6, -0.39], [0.8, -0.46], [1, -0.4]], width: 0.09 },
    { disc: [-0.72, -0.1, 0.1] },
    { disc: [-0.5, 0.12, 0.085] },
    { disc: [-0.78, 0.32, 0.075] },
    { disc: [-0.3, 0.38, 0.065] },
    { disc: [-0.96, -0.2, 0.065] },
    { disc: [-0.58, 0.45, 0.055] },
  ],
  // Animals: a kangaroo, hopping right.
  kangaroo: () => [
    { pts: [[0.64, 0.38], [0.46, 0.58], [0.24, 0.52], [0.08, 0.36], [-0.1, 0.12], [-0.26, -0.1], [-0.34, -0.2], [-0.6, -0.22], [-0.85, -0.36], [-0.98, -0.5], [-0.9, -0.6], [-0.62, -0.5], [-0.36, -0.46], [0.12, -0.34], [0.18, -0.12], [0.26, 0.1], [0.34, 0.26], [0.46, 0.34], [0.54, 0.4]] }, // head, back, tail, belly
    { pts: [[0.4, 0.5], [0.34, 0.66], [0.22, 0.5]] }, // ear
    { pts: [[0.24, 0.1], [0.5, 0.02], [0.54, -0.06], [0.44, -0.1], [0.2, -0.02]] }, // forelimb
    { pts: [[-0.36, -0.12], [0.08, -0.06], [0.22, -0.3], [0.1, -0.56], [-0.3, -0.56]] }, // thigh
    { pts: [[-0.12, -0.42], [0.14, -0.4], [0.12, -0.5], [0.6, -0.52], [0.62, -0.62], [-0.24, -0.62]] }, // shin and foot
  ],
};

export const ARROWS: Record<string, Pt[]> = {
  // Unit arrows (width 1, height 1, centred): ahead points up.
  ahead: [[-0.14, -0.5], [0.14, -0.5], [0.14, 0.05], [0.5, 0.05], [0, 0.5], [-0.5, 0.05], [-0.14, 0.05]],
  left: [[0.5, -0.14], [0.5, 0.14], [-0.05, 0.14], [-0.05, 0.5], [-0.5, 0], [-0.05, -0.5], [-0.05, -0.14]],
  right: [[-0.5, -0.14], [-0.5, 0.14], [0.05, 0.14], [0.05, 0.5], [0.5, 0], [0.05, -0.5], [0.05, -0.14]],
};

function drawPictogram(parts: Parts, name: string, cx: number, cy: number, hw: number, legend: string, bg: string, z: number): void {
  const make = PICTOGRAMS[name];
  if (!make) throw new Error(`unknown pictogram ${name}`);
  const t = (p: Pt): Pt => [cx + p[0] * hw, cy + p[1] * hw];
  for (const part of make()) {
    const zz = part.cut ? Z_CUT : z;
    const colour = part.cut ? bg : legend;
    if (part.pts) parts.poly(part.pts.map(t), zz, colour);
    if (part.line) parts.stroke(part.line.map(t), (part.width ?? 0.1) * hw, zz, colour);
    if (part.disc) parts.disc(...t([part.disc[0], part.disc[1]]), part.disc[2] * hw, zz, colour, 10);
  }
}

// ---- Layout ----

/** Cap height of the legend lines of a diamond sign: the widest that fits every line's chord (see fit below). */
export function diamondLegendHeight(lines: string[], rt: number): number {
  let h = rt * 0.5;
  lines.forEach((l, i) => {
    const c = Math.abs(i - (lines.length - 1) / 2);
    h = Math.min(h, (2 * rt) / (measure(l, 1).w + 2.3 * c + 1));
  });
  return h;
}

/** The smallest legend cap height (metres) a sign draws, for the legibility check: 0 for a pictogram-only sign. */
export function legendHeights(def: SignDef): number[] {
  const g = geometry(def);
  return g.legendHeights;
}

/** The shared cap height of a direction sign's destination rows: the widest row (name, gap, distance) fits `room`. */
export function rowHeight(rows: { text: string; km: number }[], room: number): number {
  let h = 0.24;
  for (const r of rows) h = Math.min(h, room / (measure(r.text, 1).w + measure(String(r.km), 1).w + 0.5));
  return h;
}

interface Built {
  geometry: BufferGeometry;
  legendHeights: number[];
}
const cache = new Map<string, Built>();

function geometry(def: SignDef): Built {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const parts = new Parts();
  const heights: number[] = [];
  const { family, background: bg, legend: fg } = def;
  const lines = def.lines ?? [];
  let top: number;
  const posts: [number, number][] = []; // x, top y

  if (family === 'warning') {
    const { side, bottom } = SIZES.warning;
    const R = side / Math.SQRT2;
    const cy = bottom + R;
    top = cy + R;
    posts.push([0, cy]);
    parts.box(side, side, Z_PANEL - Z0, 0, cy, (Z0 + Z_PANEL) / 2, BACK, Math.PI / 4);
    const dia = (r: number): Pt[] => [[r, 0], [0, r], [-r, 0], [0, -r]].map(([x, y]): Pt => [x!, cy + y!]);
    const Ro = R - 0.045;
    const Ri = Ro - 0.075;
    parts.poly(dia(R - 0.004), Z_FACE, bg);
    parts.poly(dia(Ro), Z_BORDER, fg, [dia(Ri).reverse()]);
    const Rt = Ri - 0.01; // legend area: half-diagonal of the diamond the legend must stay inside
    if (def.pictogram && lines.length === 0) {
      drawPictogram(parts, def.pictogram, 0, cy, Rt * 0.6, fg, bg, Z_LEGEND);
    } else if (def.pictogram) {
      const h = Math.min((1.0 * Rt) / (measure(lines[0]!, 1).w + 1), Rt * 0.26);
      heights.push(h);
      parts.text(lines[0]!, 0, cy - Rt * 0.42, h, 'c', Z_LEGEND, fg);
      drawPictogram(parts, def.pictogram, 0, cy + Rt * 0.13, Rt * 0.5, fg, bg, Z_LEGEND);
    } else {
      const h = diamondLegendHeight(lines, Rt);
      heights.push(h);
      lines.forEach((l, i) => parts.text(l, 0, cy - (i - (lines.length - 1) / 2) * 1.15 * h, h, 'c', Z_LEGEND, fg));
    }
  } else {
    const w = SIZES[family].w;
    const bottom = SIZES[family].bottom;
    const H = family === 'direction' ? directionHeight(def.rows?.length ?? 1) : SIZES.tourist.h;
    const cy = bottom + H / 2;
    top = bottom + H;
    posts.push([-w * 0.3, top - 0.12], [w * 0.3, top - 0.12]);
    parts.box(w, H, Z_PANEL - Z0, 0, cy, (Z0 + Z_PANEL) / 2, BACK);
    const rect = (hw: number, hh: number): Pt[] => [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]): Pt => [x!, cy + y!]);
    const [bo, bw] = [0.035, 0.035];
    parts.poly(rect(w / 2, H / 2), Z_FACE, bg);
    parts.poly(rect(w / 2 - bo, H / 2 - bo), Z_BORDER, fg, [rect(w / 2 - bo - bw, H / 2 - bo - bw).reverse()]);
    const iw = w - 2 * (bo + bw + 0.06);
    const ih = H - 2 * (bo + bw + 0.06);
    if (family === 'tourist') {
      const n = lines.length;
      let h = ih / (1 + 1.3 * (n - 1));
      for (const l of lines) h = Math.min(h, fitHeight(l, iw));
      h = Math.min(h, 0.3);
      heights.push(h);
      lines.forEach((l, i) => parts.text(l, 0, cy - (i - (n - 1) / 2) * 1.3 * h, h, 'c', Z_LEGEND, fg));
    } else {
      const rows = def.rows ?? [];
      const headH = DIR_HEADER;
      const pitch = DIR_PITCH;
      const block = headH + pitch * rows.length;
      let y = cy + block / 2; // top of the block
      // Header: the route shield and the road name.
      const sh = 0.46;
      const sw = 0.54;
      const left = -iw / 2;
      const sy = y - headH / 2;
      if (def.shield) {
        const shield = (k: number): Pt[] => [[-sw / 2 * k, sh / 2 * k], [sw / 2 * k, sh / 2 * k], [sw / 2 * k, -0.08 * sh * k], [0, -sh / 2 * k], [-sw / 2 * k, -0.08 * sh * k]].map(([x, yy]): Pt => [left + sw / 2 + x!, sy + yy!]);
        parts.poly(shield(1), Z_BORDER, '#ffffff');
        parts.poly(shield(0.88), Z_LEGEND, '#0a3f9c');
        const th = Math.min(0.16, fitHeight(def.shield, sw * 0.72));
        heights.push(th);
        parts.text(def.shield, left + sw / 2, sy + 0.03, th, 'c', Z_CUT, '#ffffff');
      }
      if (def.heading) {
        const hh = Math.min(0.24, fitHeight(def.heading, iw - sw - 0.15));
        heights.push(hh);
        parts.text(def.heading, left + sw + 0.14, sy, hh, 'l', Z_LEGEND, fg);
      }
      y -= headH;
      const arrowW = 0.2;
      // One lettering height for every destination, as on a real sign: the widest row sets it.
      const room = iw - arrowW - 0.12 - 0.12;
      const h = rowHeight(rows, room);
      heights.push(h);
      for (const r of rows) {
        const ry = y - pitch / 2;
        const km = String(r.km);
        const a = ARROWS[r.arrow]!;
        parts.poly(a.map(([x, yy]): Pt => [left + arrowW / 2 + x! * 0.2, ry + yy! * 0.2]), Z_LEGEND, fg);
        parts.text(r.text, left + arrowW + 0.12, ry, h, 'l', Z_LEGEND, fg);
        parts.text(km, iw / 2, ry, h, 'r', Z_LEGEND, fg);
        y -= pitch;
      }
    }
  }
  // Post(s): galvanised, behind the panel, from the ground to near the panel's top.
  for (const [px, ptop] of posts) {
    parts.box(POST_R * 2, ptop, POST_R * 2, px, ptop / 2, 0, POST);
  }
  void top;
  const built = { geometry: parts.merged(), legendHeights: heights };
  cache.set(def.id, built);
  return built;
}

/** The KitModule for one sign: a unit-scale merged geometry (origin on the ground at the post, +y up, facing +z). */
export function signModule(def: SignDef): KitModule {
  return { geometry: () => geometry(def).geometry.clone(), scale: () => [1, 1, 1] };
}

/** Panel colours the validator pins per family (mirrors crates/jj-procgen/src/signs grammar()). */
export const FAMILY_COLOURS = {
  warning: { shape: 'diamond', background: '#ffd100', legend: '#111111' },
  direction: { shape: 'rectangle', background: '#00693c', legend: '#ffffff' },
  tourist: { shape: 'rectangle', background: '#6b3410', legend: '#ffffff' },
} as const;
