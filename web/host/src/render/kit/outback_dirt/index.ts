// The outback dirt biome's kit pieces (P1-M06, playtest scope): the two vegetation species, a spinifex tussock and a desert oak.
import { SphereGeometry } from 'three';
import { drum, merge, paint, spire } from '../shapes';
import type { KitModule } from '../types';

export const spinifex: KitModule = {
  geometry: () =>
    merge([
      drum(1, 0, 0.05, '#9a6a3a', 12),
      spire(0.3, 0, 0, 1, '#b5ad54', 8),
      ...Array.from({ length: 10 }, (_, k) => {
        const a = (k / 10) * Math.PI * 2;
        return spire(0.22, 0, 0, 0.82, k % 2 ? '#a9a24c' : '#bcb560', 6).translate(Math.cos(a) * 0.74, 0, Math.sin(a) * 0.74);
      }),
    ]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};

/** A desert oak: slim dark trunk under a flat, drooping grey-green crown (the disc keeps the bounds the crown's radius). */
export const desertOak: KitModule = {
  geometry: () =>
    merge([
      drum(0.05, 0, 0.72, '#3a3228'),
      drum(1, 0.62, 0.64, '#5d6a4c', 16),
      paint(new SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.36, 1).translate(0, 0.64, 0), '#6e7c5a'),
    ]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};

export const OUTBACK_DIRT_MODULES: Record<string, KitModule> = {
  'outback_dirt/spinifex': spinifex,
  'outback_dirt/desert-oak': desertOak,
};
