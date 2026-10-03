// generic/post (P1-R03): a white pole with a black top band. Unit radius and height, scaled by the params, so its
// bounds are the collider cylinder's.
import { drum, merge } from '../shapes';
import type { KitModule } from '../types';

export const post: KitModule = {
  geometry: () => merge([drum(1, 0, 0.88, '#f1eee6'), drum(1, 0.88, 1, '#26252a')]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};
