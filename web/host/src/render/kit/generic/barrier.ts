// generic/barrier (P1-R03): a concrete barrier section with a red-and-white capping band. Unit size, scaled by length
// (x), height (y) and thickness (z), so its bounds are the collider box.
import { merge, slab } from '../shapes';
import type { KitModule } from '../types';

export const barrier: KitModule = {
  geometry: () => merge([slab(1, 0, 0.82, 1, '#c9c3b6'), slab(1, 0.82, 1, 1, '#d8432f')]),
  scale: (p) => [p.lengthMm! / 1000, p.heightCm! / 100, p.thicknessMm! / 1000],
};
