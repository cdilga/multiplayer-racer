// The town biome's kit pieces (P1-M04, playtest scope): code-built low-poly geometry in flat vertex colours, unit size scaled
// by the params, so one geometry serves every size and its bounds are the registry collider's. One parametric house and one
// parametric shopfront (their only variation is size), power pole, mailbox, water tower, gum tree and a side street's stub.
// Boxes: x = width/length, y = height, z = depth, front +z. Cylinders: unit radius and height.
import { ExtrudeGeometry, Shape, SphereGeometry, type BufferGeometry } from 'three';
import { drum, merge, paint, slab } from '../shapes';
import type { KitModule } from '../types';

/** A gable roof over the unit footprint: triangle in (z, y) from y0 to y1, along x. */
function gable(y0: number, y1: number, colour: string): BufferGeometry {
  const t = new Shape();
  t.moveTo(-0.5, y0);
  t.lineTo(0.5, y0);
  t.lineTo(0, y1);
  t.closePath();
  const g = new ExtrudeGeometry(t, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5).rotateY(Math.PI / 2);
  return paint(g, colour);
}

const WALL = '#d6cba9';
const ROOF = '#8d969c';
const GLASS = '#2d3a4a';
const VERANDAH = '#3d6b4c';

/** Three windows and a door on the front face (inset a hair so the bounds stay the collider's). */
function frontage(y0: number, y1: number, doors = true): BufferGeometry[] {
  const f = 0.498;
  const parts = [slab(0.14, y0, y1, 0.004, GLASS).translate(-0.3, 0, f), slab(0.14, y0, y1, 0.004, GLASS).translate(0.3, 0, f)];
  if (doors) parts.push(slab(0.12, 0.02, y1, 0.004, '#5b3d2a').translate(0, 0, f));
  return parts;
}

export const house: KitModule = {
  geometry: () =>
    merge([
      slab(1, 0, 0.66, 1, WALL),
      gable(0.66, 1, ROOF),
      // The front verandah: a deck roof across the front and two posts, inside the footprint.
      slab(0.96, 0.5, 0.54, 0.2, VERANDAH).translate(0, 0, 0.395),
      slab(0.03, 0, 0.5, 0.03, '#efe9d8').translate(-0.45, 0, 0.47),
      slab(0.03, 0, 0.5, 0.03, '#efe9d8').translate(0.45, 0, 0.47),
      ...frontage(0.2, 0.42),
    ]),
  scale: (p) => [p.widthMm! / 1000, p.heightCm! / 100, p.depthMm! / 1000],
};

export const shopfront: KitModule = {
  geometry: () =>
    merge([
      slab(1, 0, 0.78, 1, '#c9b48b'),
      // The false front above the verandah, and its signboard.
      slab(1, 0.78, 1, 0.1, '#d6cba9').translate(0, 0, 0.45),
      slab(0.7, 0.84, 0.96, 0.02, '#f0e6c8').translate(0, 0, 0.395),
      slab(0.96, 0.46, 0.5, 0.22, '#4b6a8c').translate(0, 0, 0.39),
      slab(0.03, 0, 0.46, 0.03, '#efe9d8').translate(-0.45, 0, 0.47),
      slab(0.03, 0, 0.46, 0.03, '#efe9d8').translate(0.45, 0, 0.47),
      slab(0.3, 0.12, 0.42, 0.004, GLASS).translate(-0.25, 0, 0.498),
      slab(0.3, 0.12, 0.42, 0.004, GLASS).translate(0.25, 0, 0.498),
    ]),
  scale: (p) => [p.widthMm! / 1000, p.heightCm! / 100, p.depthMm! / 1000],
};

export const powerPole: KitModule = {
  geometry: () => merge([drum(1, 0, 1, '#6b5339'), drum(1, 0.9, 0.96, '#4a3a28'), drum(1, 0.96, 1, '#cfd4d8')]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
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

export const sideStreet: KitModule = {
  geometry: () => merge([slab(1, 0, 1, 1, '#3d3d44'), slab(0.9, 0.99, 1, 0.03, '#d8d4c4')]),
  scale: (p) => [p.lengthMm! / 1000, 0.3, p.widthMm! / 1000],
};

export const TOWN_MODULES: Record<string, KitModule> = {
  'town/house': house,
  'town/shopfront': shopfront,
  'town/power-pole': powerPole,
  'town/mailbox': mailbox,
  'town/water-tower': waterTower,
  'town/gum-tree': gumTree,
  'town/side-street': sideStreet,
};
