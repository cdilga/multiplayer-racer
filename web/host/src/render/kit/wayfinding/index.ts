// The shared wayfinding family (P1-R10; R104-R106; accepted look art/ui/accepted/2026-10-07/poc/world, `#graphics`): a corner
// chevron post, the Australian W-beam guard rail and one leg of the race-banner gantry. Plain code-built geometry in the kit's
// flat vertex colours, unit size scaled by the params like every kit module, and every piece's `geometry()` bounds are its
// registry collider's (web/host/tests/map.test.mjs). The chevron's board and the banner between the gantry legs are visual
// extras (`decor`, and MapRenderer's banner): not part of the collider proxy. No checkpoint graphics (R106).
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Quaternion, Shape, ShapeGeometry, TorusGeometry, Vector3 } from 'three';
import { drum, merge, paint, slab } from '../shapes';
import type { KitModule } from '../types';

const YELLOW = '#f2c200';
const BLACK = '#1b1b22';
const STEEL = '#aeb4ba';
const BOARD_Z = 0.175;
const BOARD_HEIGHT = 1.5;

/** Two threaded legs, a rear U bend and a backing channel: the post sits inside the U, behind the sign. */
function chevronBracket(y: number, postRadius: number): BufferGeometry[] {
  const rod = 0.008;
  const radius = postRadius + rod;
  const back = BOARD_Z - 0.015;
  const parts = [
    paint(new TorusGeometry(radius, rod, 4, 12, Math.PI).rotateX(-Math.PI / 2).translate(0, y, 0), STEEL),
    paint(new BoxGeometry(0.31, 0.045, 0.018).translate(0, y, back - 0.009), STEEL),
    // The saddle spacer bears on the post's front; tightening the U clamps it, rather than floating a large hoop.
    paint(new BoxGeometry(0.09, 0.045, back - postRadius).translate(0, y, (back + postRadius) / 2), STEEL),
  ];
  for (const x of [-radius, radius]) {
    parts.push(
      paint(new CylinderGeometry(rod, rod, back, 6).rotateX(Math.PI / 2).translate(x, y, back / 2), STEEL),
      paint(new CylinderGeometry(0.019, 0.019, 0.014, 6).rotateX(Math.PI / 2).translate(x, y, back - 0.014), STEEL),
    );
  }
  return parts;
}

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
    variant: (p) => `${p.rightArrow ? 'right' : 'left'}:${p.radiusMm ?? 60}`,
    geometry: (variant) => {
      const [direction, radiusMm = '60'] = (variant ?? 'left:60').split(':');
      // Australian single-chevron proportions, enlarged for chase distance and grid readability.
      // Scale the printed board first: its U-bolts remain real metre-sized mounting hardware.
      const parts: BufferGeometry[] = [paint(new BoxGeometry(1.2, BOARD_HEIGHT, 0.03), BLACK), paint(new BoxGeometry(1.14, 1.44, 0.034), YELLOW)];
      const arrow = CHEVRON_V.map(([x, y]) => [direction === 'right' ? -x : x, y] as [number, number]);
      parts.push(plate(arrow, 0.0185, BLACK).scale(2.05, 2.05, 1), plate(arrow.map(([x, y]) => [-x, y] as [number, number]), 0.0185, BLACK, true).scale(2.05, 2.05, 1));
      return merge([...parts.map((g) => g.translate(0, 0, BOARD_Z)), ...chevronBracket(-0.38, Number(radiusMm) / 1000), ...chevronBracket(0.38, Number(radiusMm) / 1000)].map((g) => (g.index ? g.toNonIndexed() : g)));
    },
    scale: () => [1, 1, 1],
    lift: (p) => p.heightCm! / 100 - BOARD_HEIGHT / 2 + 0.05,
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
