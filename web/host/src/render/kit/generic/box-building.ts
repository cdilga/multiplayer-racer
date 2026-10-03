// generic/box-building (P1-R03): a box standing in for a building until the biome kits land: rendered walls, a
// darker roof slab and a door-height window band. Unit size, scaled by width (x), height (y) and depth (z).
import { merge, slab } from '../shapes';
import type { KitModule } from '../types';

export const boxBuilding: KitModule = {
  geometry: () =>
    merge([
      slab(1, 0, 0.9, 1, '#d9cbb0'),
      slab(1, 0.9, 1, 1, '#8f5a43'),
      // The window band sits a hair proud of the walls on the long faces, inside the collider's bounds.
      slab(0.92, 0.45, 0.62, 1.0, '#5c7a8a'),
    ]),
  scale: (p) => [p.widthMm! / 1000, p.heightCm! / 100, p.depthMm! / 1000],
};
