// Stand-ins for the shared wayfinding family (P1-M03f/M08a; R104-R106) until P1-R10 builds the real pieces under the same
// ids (`assets/kit/wayfinding/`): a chevron post, a W-beam guard rail section and one leg of the race-banner gantry. Plain
// code-built geometry in the kit's flat vertex colours, unit size scaled by the params like every kit module.
import { BoxGeometry } from 'three';
import { drum, merge, paint, slab } from '../shapes';
import type { KitModule } from '../types';

/** wayfinding/chevron-post: a white post with its top banded yellow and black, standing for the chevron (R104). Unit
 *  radius and height, so its bounds are the collider's; P1-R10 draws the real chevron board. */
export const chevronPost: KitModule = {
  geometry: () => merge([drum(1, 0, 0.58, '#f1eee6'), drum(1, 0.58, 0.9, '#f2c200'), drum(1, 0.9, 1, '#26252a')]),
  scale: (p) => [p.radiusMm! / 1000, p.heightCm! / 100, p.radiusMm! / 1000],
};

/** wayfinding/guard-rail: an Australian steel W-beam on posts (R105): a galvanised beam along x with a post at each end. */
export const guardRail: KitModule = {
  geometry: () =>
    merge([
      slab(1, 0.5, 1, 0.7, '#aeb4ba'),
      slab(1, 0.66, 0.74, 1, '#9aa1a8'),
      paint(new BoxGeometry(0.03, 0.5, 1).translate(-0.485, 0.25, 0), '#6d737a'),
      paint(new BoxGeometry(0.03, 0.5, 1).translate(0.485, 0.25, 0), '#6d737a'),
    ]),
  scale: (p) => [p.lengthMm! / 1000, p.heightCm! / 100, p.thicknessMm! / 1000],
};

/** wayfinding/finish-gantry: one leg of the race-banner gantry (R106): a pylon with a red cap. The banner
 *  between the two legs is P1-R10's. Unit size scaled to the collider (0.6 m square, `heightCm` tall). */
export const finishGantry: KitModule = {
  geometry: () => merge([slab(1, 0, 0.9, 1, '#2b3a67'), slab(1, 0.9, 1, 1, '#d8432f')]),
  scale: (p) => [0.6, p.heightCm! / 100, 0.6],
};

export const WAYFINDING_MODULES: Record<string, KitModule> = {
  'wayfinding/chevron-post': chevronPost,
  'wayfinding/guard-rail': guardRail,
  'wayfinding/finish-gantry': finishGantry,
};
