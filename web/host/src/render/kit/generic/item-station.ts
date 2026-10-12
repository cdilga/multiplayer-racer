// generic/item-station (P1-W04, R94): the item pickup. Every pickup is the same cardboard delivery box with packing tape
// and the item it holds printed on all four sides; the box hovers over the road (the sim stands it HOVER_M up). While a
// station recharges only a flat cardboard pad is left on the road. Code-built (R81), collider box 1300 mm.
import { drum, merge, slab } from '../shapes';
import type { KitModule } from '../types';

const CARD = '#c4955a';
const TAPE = '#e9d9a8';
const S = 1.3; // box side, m

/** The four printed faces: `print` builds one picture on the +z face (z just outside the box), rotated to each side. */
function printed(print: () => import('three').BufferGeometry[]) {
  const sides: import('three').BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) for (const g of print()) sides.push(g.rotateY((k * Math.PI) / 2));
  return sides;
}

/** A boomerang: two flat arms in a V. */
function boomerangPrint() {
  const z = S / 2 + 0.006;
  return [
    slab(0.5, -0.05, 0.05, 0.01, '#8a4b1f').rotateZ(0.6).translate(-0.12, S / 2 + 0.08, z),
    slab(0.5, -0.05, 0.05, 0.01, '#8a4b1f').rotateZ(-0.6).translate(0.12, S / 2 + 0.08, z),
    slab(0.36, -0.015, 0.015, 0.012, '#f2c230').rotateZ(0.6).translate(-0.12, S / 2 + 0.08, z + 0.001),
  ];
}

/** A sanga: a bread fold with a sausage in it. */
function sangaPrint() {
  const z = S / 2 + 0.006;
  return [
    slab(0.62, -0.08, 0.1, 0.01, '#f0d9a0').translate(0, S / 2 + 0.08, z),
    drum(0.06, -0.3, 0.3, '#a4402a', 8)
      .rotateZ(Math.PI / 2)
      .scale(1, 1, 0.15)
      .translate(0, S / 2 + 0.1, z + 0.004),
  ];
}

function box(print: () => import('three').BufferGeometry[]) {
  return merge([
    slab(S, 0, S, S, CARD),
    // Packing tape over the top and down two sides.
    slab(0.2, S, S + 0.006, S + 0.012, TAPE),
    slab(0.2, 0.02, S - 0.02, S + 0.012, TAPE).translate(0, 0, 0),
    ...printed(print),
  ]);
}

/** The ready station holding a boomerang (the registry's module: its bounds are the collider's). */
export const itemStation: KitModule = {
  geometry: () => box(boomerangPrint),
  scale: () => [1, 1, 1],
};

// The renderer drops a registry piece by half its collider (0.65 m) to stand it on its origin; these two have no registry
// entry of their own, so they carry that offset (the box) or the whole hover (the pad, on the road) themselves.
const HALF_COLLIDER = 0.65;
const HOVER = 1.1;

/** The ready station holding a sanga. */
export const stationSanga = (): import('three').BufferGeometry => box(sangaPrint).translate(0, -HALF_COLLIDER, 0);

/** A recharging station: a flat cardboard pad on the road. */
export const stationPad = (): import('three').BufferGeometry => slab(S, 0, 0.05, S, CARD).translate(0, -HOVER, 0);
