// The derby's weapons in play (br-bhkz.3), code-built (R81) and cartoon-sized so they read on a TV across the room:
// a magpie in flight, a lit bunger and a fitted roo bar. Each is drawn at a debris record of its own snapshot kind
// (`jj_sim::Sim::weapon_poses`): the magpie faces +z along its flight, the bunger stands where it lies, and the roo bar's
// origin is the middle of its car's nose at ground height, +z forward.
import type { BufferGeometry } from 'three';
import { drum, merge, slab, spire } from '../shapes';

const BLACK = '#17181c';
const WHITE = '#f4f1ea';

/** A magpie, wings out: black with the white nape, wing bars and tail band, a grey beak. About 2.6 m across. */
export function magpieGeometry(): BufferGeometry {
  const along = (g: BufferGeometry) => g.rotateX(Math.PI / 2); // a vertical drum or spire laid along +z
  const wing = (side: 1 | -1) => [
    slab(1.25, 0, 0.09, 0.62, BLACK).translate(side * 0.72, 0, 0.05).rotateZ(side * 0.22),
    slab(0.95, 0.09, 0.12, 0.24, WHITE).translate(side * 0.74, 0, 0.1).rotateZ(side * 0.22),
  ];
  return merge([
    along(drum(0.3, -0.62, 0.5, BLACK, 8)),
    along(drum(0.22, 0.5, 0.82, BLACK, 8)),
    along(spire(0.09, 0.01, 0.82, 1.2, '#c9ccd1', 6)),
    slab(0.4, 0.2, 0.31, 0.5, WHITE).translate(0, 0, 0.2),
    ...wing(1),
    ...wing(-1),
    slab(0.5, -0.03, 0.05, 0.55, BLACK).translate(0, 0, -0.85),
    slab(0.5, 0.05, 0.08, 0.22, WHITE).translate(0, 0, -0.72),
  ]);
}

/** A lit bunger: a fat red firecracker with yellow bands, a fuse and its spark. About a metre tall. */
export function bungerGeometry(): BufferGeometry {
  return merge([
    drum(0.34, -0.2, 0.62, '#d8452f', 10),
    drum(0.35, -0.08, 0.04, '#f2c230', 10),
    drum(0.35, 0.38, 0.5, '#f2c230', 10),
    drum(0.05, 0.62, 0.92, '#3b3a40', 6),
    drum(0.13, 0.9, 1.02, '#fff3a0', 6),
  ]);
}

/** A roo bar: a chrome frame of three rails on two posts with a pair of spot lamps, across the nose. */
export function rooBarGeometry(): BufferGeometry {
  const CHROME = '#d9dde2';
  const rail = (y: number, w: number) => slab(w, y - 0.045, y + 0.045, 0.09, CHROME).translate(0, 0, 0.16);
  const post = (x: number) => slab(0.1, 0.28, 1.02, 0.1, CHROME).translate(x, 0, 0.16);
  const lamp = (x: number) => drum(0.11, 0, 0.08, '#fff3a0', 8).rotateX(Math.PI / 2).translate(x, 1.02, 0.2);
  return merge([rail(0.36, 1.78), rail(0.66, 1.78), rail(0.96, 1.5), post(-0.55), post(0.55), slab(0.09, 0.3, 0.9, 0.3, '#9aa1ab').translate(-0.84, 0, 0.02), slab(0.09, 0.3, 0.9, 0.3, '#9aa1ab').translate(0.84, 0, 0.02), lamp(-0.3), lamp(0.3)]);
}
