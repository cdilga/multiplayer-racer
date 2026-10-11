// The derby bowl (P1-M10): the very triangles the sim collides with (jj-map `arena.rs` `bowl_mesh`), drawn as quads with the
// rocks biome's quarry colours: banded red strata up the vertical wall, a pale flat lip, packed-dirt tone at the foot of the
// bank. One revolved profile (quarter-circle bank tangent to the floor and to the wall, a vertical top wall, a flat lip, an
// outer face that reaches below the floor), `libm` maths in Rust and plain `Math` here: they agree to float precision, which
// is all a picture needs. The collider is Rust's; nothing here decides containment.
import type { Params } from '../kit/types';

/** Segments along the quarter-circle bank (jj-map `BANK_STEPS`). */
const BANK_STEPS = 24;
const WALL_STEP_M = 2;
const RING_CHORD_M = 1.25;
const SKIRT_M = 2;

export interface BowlDesign {
  cx: number;
  cz: number;
  baseY: number;
  floorR: number;
  bankR: number;
  wallH: number;
  lipW: number;
}

/** The bowl a `bowl` feature describes (metres), or null when its params are incomplete. */
export function bowlDesign(pose: { x: number; y: number; z: number }, p: Params): BowlDesign | null {
  const { floorRadiusMm, bankRadiusMm, wallHeightCm, lipWidthMm } = p;
  if (floorRadiusMm === undefined || bankRadiusMm === undefined || wallHeightCm === undefined || lipWidthMm === undefined) return null;
  return {
    cx: pose.x / 1000,
    cz: pose.z / 1000,
    baseY: pose.y / 1000,
    floorR: floorRadiusMm / 1000,
    bankR: bankRadiusMm / 1000,
    wallH: wallHeightCm / 100,
    lipW: lipWidthMm / 1000,
  };
}

/** The profile's corner points (radius, height above the floor) from the foot of the bank outwards, and which part of the
 *  bowl each edge after the point belongs to. */
export function bowlProfile(d: BowlDesign): { pts: [number, number][]; part: ('bank' | 'wall' | 'lip' | 'outer')[] } {
  const pts: [number, number][] = [];
  const part: ('bank' | 'wall' | 'lip' | 'outer')[] = [];
  for (let k = 0; k <= BANK_STEPS; k++) {
    const a = (Math.PI / 2) * (k / BANK_STEPS);
    pts.push([d.floorR + d.bankR * Math.sin(a), d.bankR * (1 - Math.cos(a))]);
    if (k < BANK_STEPS) part.push('bank');
  }
  const wallR = d.floorR + d.bankR;
  pts[pts.length - 1] = [wallR, d.bankR];
  const cuts = Math.max(1, Math.ceil(d.wallH / WALL_STEP_M));
  for (let k = 1; k <= cuts; k++) {
    pts.push([wallR, d.bankR + (d.wallH * k) / cuts]);
    part.push('wall');
  }
  pts.push([wallR + d.lipW, d.bankR + d.wallH]);
  part.push('lip');
  pts.push([wallR + d.lipW, -SKIRT_M]);
  part.push('outer');
  return { pts, part };
}

/** Quarry strata: bands about 1.1 m tall in a few reds, the same on every bowl so the look is the biome's, not the seed's. */
const STRATA = ['#b4452a', '#9a3a22', '#c4603a', '#a8412a', '#8a3320', '#cf6e44'];

/** Draws the bowl as quads: `emit(a, b, c, d, colour)` with corners counter-clockwise seen from the side the face is for. */
export function bowlQuads(d: BowlDesign, emit: (a: number[], b: number[], c: number[], e: number[], colour: string) => void): void {
  const { pts, part } = bowlProfile(d);
  const outer = d.floorR + d.bankR + d.lipW;
  const n = Math.ceil((2 * Math.PI * outer) / RING_CHORD_M / 4) * 4;
  const at = (i: number, j: number): number[] => {
    const a = (2 * Math.PI * j) / n;
    const [r, h] = pts[i]!;
    return [d.cx + r * Math.cos(a), d.baseY + h, d.cz + r * Math.sin(a)];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [r0, h0] = pts[i]!;
    const [, h1] = pts[i + 1]!;
    const hMid = (h0 + h1) / 2;
    let colour: string;
    switch (part[i]) {
      case 'bank':
        // Packed dirt at the foot, taking on the rock's red as it climbs.
        colour = i < 6 ? '#c9854f' : i < 14 ? '#b8683f' : '#a8523a';
        break;
      case 'wall':
        colour = STRATA[Math.floor(hMid / 1.1) % STRATA.length]!;
        break;
      case 'lip':
        colour = '#e1ad74';
        break;
      default:
        colour = '#7a3a26';
    }
    void r0;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      // Winding: the solid is to the right of the profile direction, and this order has the face looking out of it.
      emit(at(i, j), at(i, j1), at(i + 1, j1), at(i + 1, j), colour);
    }
  }
}
