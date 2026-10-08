// The shared wayfinding family (P1-R10; R104-R106; accepted look art/ui/accepted/2026-10-07/poc/world, `#graphics`): a corner
// chevron post, the Australian W-beam guard rail and one leg of the race-banner gantry. Plain code-built geometry in the kit's
// flat vertex colours, unit size scaled by the params like every kit module, and every piece's `geometry()` bounds are its
// registry collider's (web/host/tests/map.test.mjs). The chevron's board and the banner between the gantry legs are visual
// extras (`decor`, and MapRenderer's banner): not part of the collider proxy. No checkpoint graphics (R106).
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Quaternion, Shape, ShapeGeometry, Vector3 } from 'three';
import { drum, merge, paint, slab } from '../shapes';
import type { KitModule } from '../types';

const YELLOW = '#f2c200';
const BLACK = '#1b1b22';
const STEEL = '#aeb4ba';

/** A polygon (x, y points) as a flat shape at depth `z`, painted; `flip` turns it to face -z (a half turn about y). */
function plate(points: [number, number][], z: number, colour: string, flip = false): BufferGeometry {
  const s = new Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const g = new ShapeGeometry(s);
  g.translate(0, 0, z);
  if (flip) g.rotateY(Math.PI);
  return paint(g, colour);
}

/** The chevron: a thick V (arms 0.11 m) whose tip points toward local -x, the road's turn as a driver sees it from either face. */
const CHEVRON_V: [number, number][] = [
  [-0.19, 0],
  [0.01, 0.25],
  [0.12, 0.25],
  [-0.08, 0],
  [0.12, -0.25],
  [0.01, -0.25],
];

/** wayfinding/chevron-post: a white steel post (unit radius and height, so its bounds are the collider's) carrying one
 *  chevron: a yellow board with a black V, on both faces so it reads from either side of the post (R104). */
export const chevronPost: KitModule = {
  geometry: () => merge([drum(1, 0, 0.7, '#f1eee6'), drum(1, 0.7, 1, '#d9d4c7')]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
  ink: true,
  decor: {
    geometry: () => {
      const parts: BufferGeometry[] = [paint(new BoxGeometry(0.58, 0.7, 0.03), BLACK), paint(new BoxGeometry(0.52, 0.64, 0.034), YELLOW)];
      parts.push(plate(CHEVRON_V, 0.0185, BLACK), plate(CHEVRON_V.map(([x, y]) => [-x, y] as [number, number]), 0.0185, BLACK, true));
      // A board 1.7x life size: it has to read at chase distance and in a 24-tile grid.
      return merge(parts.map((g) => (g.index ? g.toNonIndexed() : g))).scale(1.7, 1.7, 1);
    },
    scale: () => [1, 1, 1],
    lift: (p) => p.heightCm! / 100 - 0.55,
    face: true,
  },
};

/** wayfinding/guard-rail: an Australian galvanised W-beam on I-section posts (R105). Unit size: x the run, y the height
 *  (beam on the upper half), z the depth (the post's flanges span it). The beam is double sided and symmetric, so it reads
 *  from either side of the road; yellow delineators ride the posts. */
export const guardRail: KitModule = {
  geometry: () => {
    // W profile in (y, z): front flange, valley, hump, valley, flange; mirrored about z = 0 by drawing both faces.
    const profile: [number, number][] = [
      [0.5, 0.14],
      [0.54, 0.14],
      [0.6, -0.1],
      [0.66, -0.1],
      [0.72, 0.14],
      [0.78, 0.14],
      [0.84, -0.1],
      [0.9, -0.1],
      [0.96, 0.14],
      [1.0, 0.14],
    ];
    const pos: number[] = [];
    const col: number[] = [];
    const push = (a: number[], b: number[], c: number[], d: number[], hex: number) => {
      const r = ((hex >> 16) & 255) / 255;
      const g = ((hex >> 8) & 255) / 255;
      const bl = (hex & 255) / 255;
      for (const v of [a, b, c, a, c, d]) {
        pos.push(...v);
        col.push(r, g, bl);
      }
    };
    for (let k = 0; k + 1 < profile.length; k++) {
      const [y0, z0] = profile[k]!;
      const [y1, z1] = profile[k + 1]!;
      const tone = k % 4 === 2 ? 0xc3c8cd : k % 4 === 0 ? 0xaeb4ba : 0x9aa1a8;
      // The beam's two faces (a thin sheet): one winding each way along its whole length.
      push([-0.5, y0, z0], [0.5, y0, z0], [0.5, y1, z1], [-0.5, y1, z1], tone);
      push([-0.5, y0, z0], [-0.5, y1, z1], [0.5, y1, z1], [0.5, y0, z0], tone);
    }
    const sheet = new BufferGeometry();
    sheet.setAttribute('position', new Float32BufferAttribute(pos, 3));
    sheet.setAttribute('color', new Float32BufferAttribute(col, 3));
    sheet.computeVertexNormals();
    const post = (x: number) => [
      slab(0.026, 0, 0.95, 0.12, '#7c838a').translate(x, 0, -0.44),
      slab(0.026, 0, 0.95, 0.12, '#7c838a').translate(x, 0, 0.44),
      slab(0.012, 0, 0.95, 0.76, '#6d737a').translate(x, 0, 0),
      slab(0.03, 0.88, 0.99, 0.2, YELLOW).translate(x, 0, 0),
    ];
    // The bounds: the beam fixes y 0.5-1.0 and the delineators' top 0.99; the flanges fix z at +-0.5; the ends fix x.
    return merge([sheet, ...post(-0.48), ...post(0), ...post(0.48)].map((g) => (g.index ? g.toNonIndexed() : g)));
  },
  scale: (p) => [p.lengthMm! / 1000, p.heightCm! / 100, p.thicknessMm! / 1000],
  // No ink hull: the beam is a two-sided sheet, so an inverted hull covers its whole face and the galvanised rail read
  // navy at chase distance (eris captures, 2026-10-08). R108 keeps ink mainly on the car's outline anyway.
};

/** wayfinding/finish-gantry: one leg of the race-banner gantry (R106): a light truss tower, four chords with rings and
 *  diagonal braces on a plinth, and a lamp head. Unit size scaled to the collider (0.6 m square, `heightCm` tall). The
 *  banner across the span between the two legs is MapRenderer's. */
export const finishGantry: KitModule = {
  geometry: () => {
    const parts: BufferGeometry[] = [slab(1, 0, 0.03, 1, '#3b4150')];
    const c = 0.46;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(paint(new BoxGeometry(0.1, 0.94, 0.1).translate(sx * c, 0.5, sz * c), '#d6dae0'));
    const bays = 9;
    for (let k = 0; k <= bays; k++) {
      const y = 0.04 + (0.9 * k) / bays;
      for (const sx of [-1, 1]) parts.push(paint(new BoxGeometry(0.06, 0.012, 0.9).translate(sx * c, y, 0), '#aab0b8'));
      for (const sz of [-1, 1]) parts.push(paint(new BoxGeometry(0.9, 0.012, 0.06).translate(0, y, sz * c), '#aab0b8'));
    }
    const brace = (a: Vector3, b: Vector3) => {
      const len = a.distanceTo(b);
      const g = new BoxGeometry(0.035, len, 0.035);
      const dir = b.clone().sub(a).normalize();
      g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir));
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      return paint(g, '#c2c7ce');
    };
    for (let k = 0; k < bays; k++) {
      const y0 = 0.04 + (0.9 * k) / bays;
      const y1 = y0 + 0.9 / bays;
      const flip = k % 2 ? -1 : 1;
      parts.push(brace(new Vector3(-c * flip, y0, c), new Vector3(c * flip, y1, c)), brace(new Vector3(-c * flip, y0, -c), new Vector3(c * flip, y1, -c)));
    }
    parts.push(slab(1, 0.94, 0.985, 1, '#2b3a67'), slab(0.7, 0.985, 1, 0.7, '#d8432f'));
    return merge(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  },
  scale: (p) => [0.6, p.heightCm! / 100, 0.6],
  ink: true,
};

export const WAYFINDING_MODULES: Record<string, KitModule> = {
  'wayfinding/chevron-post': chevronPost,
  'wayfinding/guard-rail': guardRail,
  'wayfinding/finish-gantry': finishGantry,
};

export const WAYFINDING_COLOURS = { YELLOW, BLACK, STEEL };
