// generic/bin (P1-R03): a wheelie bin at its real size (collider box 600 × 1050 × 700 mm): green body, yellow lid,
// black wheels at the back.
import { drum, merge, slab } from '../shapes';
import type { KitModule } from '../types';

export const bin: KitModule = {
  geometry: () =>
    merge([
      slab(0.56, 0.06, 0.96, 0.66, '#2f6b3a'),
      slab(0.6, 0.96, 1.05, 0.7, '#e8c02a'),
      // An axle-long wheel pair across the back: built upright about the origin, turned onto x, then placed.
      drum(0.1, -0.28, 0.28, '#1f1e22', 8).rotateZ(Math.PI / 2).translate(0, 0.1, -0.24),
    ]),
  scale: () => [1, 1, 1],
};
