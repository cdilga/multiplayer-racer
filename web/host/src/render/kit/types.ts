// The renderer side of the kit-piece registry (P1-R03, plan §8.1): one code-built geometry module per registry id.

import type { BufferGeometry } from 'three';

export type Params = Record<string, number>;

export interface KitModule {
  /** The piece at its registry default size or at unit size: origin on the ground at the piece's centre, +y up, the
   *  long axis along x (a yaw of 0), flat vertex colours. Scaled by `scale(params)` its bounds are the collider's. */
  geometry(): BufferGeometry;
  /** Per-instance scale (x, y, z) for these params (defaults filled in), so one geometry serves every size. */
  scale(params: Params): [number, number, number];
  /** Outline this piece with the look's ink hull (P1-R10: the wayfinding kit and the generic roadside pieces). */
  ink?: boolean;
  /** Visual-only extras drawn at the piece's placement (a chevron's board): not part of the collider proxy, so the
   *  registry's bounds check measures `geometry()` alone. One more instanced draw per type in use. Geometry in metres,
   *  origin at the extra's own centre; `lift` raises it above the piece's origin. */
  decor?: {
    geometry(): BufferGeometry;
    scale(params: Params): [number, number, number];
    lift(params: Params): number;
    /** A printed sign face (retroreflective sheeting): drawn unlit, in its true colours whatever the sun does, so a
     *  chevron board never reads olive in shade (P1-R10 fresh-eyes review). */
    face?: boolean;
  };
}
