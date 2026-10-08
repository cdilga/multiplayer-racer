// The town biome's kit pieces (P1-M04, playtest scope): code-built low-poly geometry in flat vertex colours, unit size scaled
// by the params, so one geometry serves every size and its bounds are the registry collider's. One parametric house and one
// parametric shopfront (their only variation is size), power pole, mailbox, water tower, gum tree and a side street's stub.
// Boxes: x = width/length, y = height, z = depth, front +z. Cylinders: unit radius and height.
import { BoxGeometry, ExtrudeGeometry, Shape, SphereGeometry, type BufferGeometry } from 'three';
import { drum, merge, paint, slab } from '../shapes';
import type { KitModule } from '../types';

/** A gable roof from y0 (eaves) to y1 (ridge) across the whole width (x), over z0..z1 (the ridge runs along x). */
function gable(y0: number, y1: number, colour: string, z0 = -0.5, z1 = 0.5): BufferGeometry {
  const t = new Shape();
  t.moveTo(z0, y0);
  t.lineTo(z1, y0);
  t.lineTo((z0 + z1) / 2, y1);
  t.closePath();
  const g = new ExtrudeGeometry(t, { depth: 1, bevelEnabled: false });
  // Shape x is z here: rotate so the profile lies in (z, y) and the extrusion runs along x, centred.
  g.translate(0, 0, -0.5).rotateY(-Math.PI / 2);
  return paint(g, colour);
}

/** A skillion (the verandah's lean-to roof) across the width from (zBack, yBack) down to (zFront, yFront). */
function skillion(zBack: number, yBack: number, zFront: number, yFront: number, colour: string): BufferGeometry {
  const len = Math.hypot(zFront - zBack, yFront - yBack);
  const g = new BoxGeometry(1, 0.012, len).rotateX(Math.atan2(yBack - yFront, zFront - zBack));
  return paint(g.translate(0, (yBack + yFront) / 2, (zBack + zFront) / 2), colour);
}

const WALL = '#e4dcc3'; // cream weatherboard
const BOARD = '#c9bf9f'; // the shadow line under each board
const ROOF = '#9aa3a8'; // galvanised corrugated iron
const ROOF_LIGHT = '#b9c1c5';
const TRIM = '#f4f1e8';
const GLASS = '#2d3a4a';
const GREEN = '#3d6b4c'; // the bush-green dado, door and trim of the reference

/** Weatherboards: a darker line every board across a front face at z, between y0 and y1, skipping nothing (windows sit proud). */
function boards(w: number, y0: number, y1: number, z: number): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (let y = y0 + 0.055; y < y1 - 0.01; y += 0.065) out.push(slab(w, y, y + 0.01, 0.003, BOARD).translate(0, 0, z));
  return out;
}

/** A window: a white frame and dark glass standing proud of the face at z. */
function window_(x: number, w: number, y0: number, y1: number, z: number): BufferGeometry[] {
  return [slab(w, y0, y1, 0.004, TRIM).translate(x, 0, z + 0.003), slab(w - 0.035, y0 + 0.02, y1 - 0.02, 0.004, GLASS).translate(x, 0, z + 0.006)];
}

/** Verandah posts along the front edge. */
function posts(xs: number[], y1: number, z: number): BufferGeometry[] {
  return xs.map((x) => slab(0.022, 0.03, y1, 0.022, TRIM).translate(x, 0, z));
}

// The house (unit footprint, front +z): weatherboard walls on low stumps under a corrugated gable, a chimney, and a front
// verandah under its own lean-to roof on white posts. Front face at z = 0.24; the verandah fills z 0.24..0.5.
export const house: KitModule = {
  geometry: () => {
    const front = 0.24;
    return merge([
      slab(0.92, 0, 0.06, 0.72, '#7d6c58').translate(0, 0, -0.12),
      slab(0.9, 0.06, 0.62, 0.72, WALL).translate(0, 0, -0.12),
      ...boards(0.9, 0.06, 0.62, front + 0.001),
      gable(0.6, 1, ROOF, -0.5, front + 0.04),
      slab(1, 0.985, 1, 0.03, ROOF_LIGHT).translate(0, 0, (front + 0.04 - 0.5) / 2),
      slab(1, 0.595, 0.615, 0.02, TRIM).translate(0, 0, front + 0.035),
      slab(0.07, 0.72, 0.97, 0.07, '#9b5a42').translate(0.28, 0, -0.22),
      skillion(front, 0.56, 0.5, 0.47, ROOF_LIGHT),
      slab(0.9, 0, 0.07, 0.25, '#8a6b4a').translate(0, 0, 0.37),
      ...posts([-0.45, -0.15, 0.15, 0.45], 0.475, 0.48),
      ...window_(-0.27, 0.2, 0.22, 0.48, front),
      ...window_(0.27, 0.2, 0.22, 0.48, front),
      slab(0.12, 0.07, 0.5, 0.004, GREEN).translate(0, 0, front + 0.004),
    ]);
  },
  scale: (p) => [p.widthMm! / 1000, p.heightCm! / 100, p.depthMm! / 1000],
};

/** Painted lettering as dark word blocks (the reference's GENERAL STORE board, read at chase distance as a sign). */
function lettering(rows: [number, number[]][], z: number): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (const [y, words] of rows) {
    const total = words.reduce((a, b) => a + b, 0) + 0.04 * (words.length - 1);
    let x = -total / 2;
    for (const w of words) {
      out.push(slab(w, y, y + 0.045, 0.004, '#2b2a28').translate(x + w / 2, 0, z));
      x += w + 0.04;
    }
  }
  return out;
}

// The shopfront (unit footprint, front +z): a weatherboard store with a green dado under a gable, a tall false front
// carrying a lettered signboard, big shop windows and a door, and a verandah over the footpath on posts.
export const shopfront: KitModule = {
  geometry: () => {
    const front = 0.24;
    return merge([
      slab(0.96, 0, 0.66, 0.74, WALL).translate(0, 0, -0.13),
      ...boards(0.96, 0.22, 0.66, front + 0.001),
      slab(0.962, 0, 0.22, 0.742, GREEN).translate(0, 0, -0.13),
      gable(0.66, 0.86, ROOF, -0.5, front),
      // The false front: a parapet the full width up to the top, the signboard on it.
      slab(1, 0.6, 1, 0.04, WALL).translate(0, 0, front),
      slab(1, 0.975, 1, 0.044, GREEN).translate(0, 0, front),
      slab(0.8, 0.7, 0.95, 0.006, '#3b3a36').translate(0, 0, front + 0.023),
      slab(0.76, 0.715, 0.935, 0.006, '#f3ead0').translate(0, 0, front + 0.027),
      ...lettering([[0.855, [0.26, 0.25]], [0.76, [0.12, 0.1, 0.16]]], front + 0.031),
      skillion(front, 0.58, 0.5, 0.5, ROOF_LIGHT),
      slab(1, 0, 0.03, 0.26, '#b8ab95').translate(0, 0, 0.37),
      ...posts([-0.47, -0.16, 0.16, 0.47], 0.505, 0.485),
      ...window_(-0.29, 0.3, 0.12, 0.5, front),
      ...window_(0.29, 0.3, 0.12, 0.5, front),
      slab(0.13, 0.03, 0.5, 0.004, '#5b3d2a').translate(0, 0, front + 0.004),
    ]);
  },
  scale: (p) => [p.widthMm! / 1000, p.heightCm! / 100, p.depthMm! / 1000],
};

export const powerPole: KitModule = {
  geometry: () => merge([drum(1, 0, 1, '#6b5339'), drum(1, 0.9, 0.96, '#4a3a28'), drum(1, 0.96, 1, '#cfd4d8')]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};

/** A span of power line between two poles (unit size, length along x, `heightCm` the poles'): a crossarm at each end and three
 *  sagging wires. The ghost poles at the ends stand inside the real poles (they only keep the bounds standing on the ground). */
export const powerLine: KitModule = {
  geometry: () => {
    const parts: BufferGeometry[] = [];
    for (const x of [-0.499, 0.499]) {
      parts.push(slab(0.002, 0.955, 0.975, 1, '#5b4630').translate(x, 0, 0), slab(0.002, 0, 1, 0.01, '#6b5339').translate(x, 0, 0));
    }
    const n = 8;
    for (const z of [-0.32, 0, 0.32]) {
      for (let i = 0; i < n; i++) {
        const [t0, t1] = [i / n, (i + 1) / n];
        const sag = (t: number) => 0.965 - 0.06 * 4 * t * (1 - t);
        const [x0, x1] = [t0 - 0.5, t1 - 0.5];
        const [y0, y1] = [sag(t0), sag(t1)];
        const len = Math.hypot(x1 - x0, y1 - y0);
        parts.push(paint(new BoxGeometry(len, 0.003, 0.012).rotateZ(Math.atan2(y1 - y0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2, z), '#26252a'));
      }
    }
    return merge(parts);
  },
  scale: (p) => [p.lengthMm! / 1000, p.heightCm! / 100, 1.4],
};

export const mailbox: KitModule = {
  geometry: () => merge([slab(0.12, 0, 0.6, 0.5, '#6b5339'), slab(1, 0.55, 1, 1, '#2f6b3a'), slab(0.3, 0.88, 0.96, 1.01, '#d8432f').translate(0.35, 0, 0)]),
  scale: () => [0.42, 1.15, 0.3],
};

export const waterTower: KitModule = {
  geometry: () =>
    merge([
      drum(1, 0.52, 1, '#9aa3a8', 16),
      drum(0.96, 0.46, 0.52, '#7d868c', 16),
      ...[-0.55, 0.55].flatMap((x) => [-0.55, 0.55].map((z) => slab(0.07, 0, 0.5, 0.07, '#5d666c').translate(x, 0, z))),
    ]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};

/** A gum: pale trunk and two grey-green lobes; a flat disc at the rim keeps the bounds the canopy's radius. */
export const gumTree: KitModule = {
  geometry: () =>
    merge([
      drum(0.05, 0, 0.62, '#d8d0c0'),
      drum(1, 0.5, 0.52, '#6f8a68', 16),
      paint(new SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.48, 1).translate(0, 0.52, 0), '#7f9b7a'),
      paint(new SphereGeometry(0.55, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(0.35, 0.55, 0.25), '#8aa684'),
    ]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};

// A side street's mouth: the main road's tarmac (map.ts SURFACE_COLOURS.tarmac), flush with it, and a give-way line across
// its mouth (the end at -x meets the road).
export const sideStreet: KitModule = {
  geometry: () => merge([slab(1, 0, 1, 1, '#3f3f46'), slab(0.012, 0.99, 1.0, 0.9, '#e8e2cf').translate(-0.47, 0, 0)]),
  scale: (p) => [p.lengthMm! / 1000, 0.12, p.widthMm! / 1000],
};

export const TOWN_MODULES: Record<string, KitModule> = {
  'town/house': house,
  'town/shopfront': shopfront,
  'town/power-pole': powerPole,
  'town/power-line': powerLine,
  'town/mailbox': mailbox,
  'town/water-tower': waterTower,
  'town/gum-tree': gumTree,
  'town/side-street': sideStreet,
};
