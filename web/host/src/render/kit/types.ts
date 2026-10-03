// The renderer side of the kit-piece registry (P1-R03, plan §8.1): one code-built geometry module per registry id.

import type { BufferGeometry } from 'three';

export type Params = Record<string, number>;

export interface KitModule {
  /** The piece at its registry default size or at unit size: origin on the ground at the piece's centre, +y up, the
   *  long axis along x (a yaw of 0), flat vertex colours. Scaled by `scale(params)` its bounds are the collider's. */
  geometry(): BufferGeometry;
  /** Per-instance scale (x, y, z) for these params (defaults filled in), so one geometry serves every size. */
  scale(params: Params): [number, number, number];
}
