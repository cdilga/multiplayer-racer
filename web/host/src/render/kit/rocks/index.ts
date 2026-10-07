// The rocks biome's kit pieces (P1-M05, playtest scope): one banded dome family (tall and towering), a flowering shrub and a
// spinifex tussock. Unit radius and height, scaled by the params, so the bounds are the collider cylinder's.
import { SphereGeometry } from 'three';
import { drum, merge, paint, spire } from '../shapes';
import type { KitModule } from '../types';

/** The dome: stacked frustums following a hemisphere's profile (radius sqrt(1 - t^2)), each a band of red rock in turn, so the
 *  top is rounded, not conical. Unit radius and height. */
export const dome: KitModule = {
  geometry: () => {
    const n = 12;
    const colours = ['#a8472a', '#bb5632', '#9a3f25', '#c4623b', '#a34429', '#b24f2e', '#8f3b22'];
    const radius = (k: number) => Math.sqrt(Math.max(0, 1 - (k / n) ** 2));
    return merge(Array.from({ length: n }, (_, k) => spire(radius(k), radius(k + 1), k / n, (k + 1) / n, colours[(k * 5) % colours.length]!, 20)));
  },
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};

const hemisphere = (colour: string) => paint(new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), colour);

export const shrub: KitModule = {
  geometry: () =>
    merge([
      hemisphere('#5e7a3c'),
      // A few pink flowers set on the surface.
      ...[
        [0.6, 0.64, 0.48],
        [-0.5, 0.7, 0.5],
        [0.1, 0.92, -0.38],
        [-0.3, 0.6, -0.74],
      ].map(([x, y, z]) => paint(new SphereGeometry(0.09, 5, 3).translate(x!, y!, z!), '#d96aa8')),
    ]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};

export const spinifex: KitModule = {
  geometry: () =>
    merge([
      drum(1, 0, 0.05, '#8a7a45', 12),
      spire(0.3, 0, 0, 1, '#b0aa58', 8),
      ...Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2;
        return spire(0.24, 0, 0, 0.85, k % 2 ? '#a39b4e' : '#b9b362', 6).translate(Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72);
      }),
    ]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};

export const ROCKS_MODULES: Record<string, KitModule> = {
  'rocks/dome': dome,
  'rocks/shrub': shrub,
  'rocks/spinifex': spinifex,
};
