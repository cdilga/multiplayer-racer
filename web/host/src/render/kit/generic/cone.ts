// generic/cone (P1-R03): a traffic cone at its real size (collider: cylinder r 180 mm, 700 mm high): a square base
// plate, an orange cone and a reflective white band.
import { merge, slab, spire } from '../shapes';
import type { KitModule } from '../types';

export const cone: KitModule = {
  geometry: () =>
    merge([
      slab(0.36, 0, 0.04, 0.36, '#e2591d'),
      spire(0.15, 0.08, 0.04, 0.34, '#ff7a2e'),
      spire(0.08, 0.055, 0.34, 0.46, '#f4f1e8'),
      spire(0.055, 0, 0.46, 0.7, '#ff7a2e'),
    ]),
  scale: () => [1, 1, 1],
};
