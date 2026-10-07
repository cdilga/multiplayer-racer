// The outback bitumen biome's kit pieces (P1-M07, playtest scope): lane lines (a yellow centre dash (the white edge line is the road ribbon's, so it isn't drawn twice)),
// a white guide post with a red reflector band and a yellow delineator, all placed as pieces.
import { drum, merge, slab } from '../shapes';
import type { KitModule } from '../types';

const lane = (colour: string): KitModule => ({
  geometry: () => slab(1, 0, 1, 1, colour),
  scale: (p) => [p.lengthMm! / 1000, 0.01, 0.15],
});

export const reflectorPost: KitModule = {
  geometry: () => merge([drum(1, 0, 0.74, '#f1eee6'), drum(1, 0.74, 0.88, '#d8432f'), drum(1, 0.88, 1, '#f1eee6')]),
  scale: () => [0.06, 1.1, 0.06],
};

export const delineator: KitModule = {
  geometry: () => merge([drum(1, 0, 0.7, '#e8b923'), drum(1, 0.7, 1, '#26252a')]),
  scale: () => [0.07, 1.0, 0.07],
};

export const OUTBACK_BITUMEN_MODULES: Record<string, KitModule> = {
  'outback_bitumen/centre-line': lane('#e0b422'),
  'outback_bitumen/reflector-post': reflectorPost,
  'outback_bitumen/delineator': delineator,
};
