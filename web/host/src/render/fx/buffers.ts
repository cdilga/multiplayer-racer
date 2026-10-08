// The effects layers' instance buffers (P1-R12): grown, never capped, as the field emits more.
import { InstancedBufferAttribute, type InstancedBufferGeometry } from 'three';

/** New `cap`-sized position, colour and misc buffers on `geo`. three.js caches an instanced geometry's instance limit on
 *  its first draw (WebGLBindingStates sets `_maxInstanceCount` once) and clamps every later draw to it, so it is cleared
 *  here: without that, a layer that grew past its first 256 slots still drew only 256 particles, a silent cap that hid
 *  every hit burst in a busy field (eris, 2026-10-08). */
export function growBuffers(geo: InstancedBufferGeometry, cap: number): { pos: InstancedBufferAttribute; col: InstancedBufferAttribute; misc: InstancedBufferAttribute } {
  const make = () => new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(35048);
  const out = { pos: make(), col: make(), misc: make() };
  geo.setAttribute('aPos', out.pos);
  geo.setAttribute('aCol', out.col);
  geo.setAttribute('aMisc', out.misc);
  delete (geo as unknown as { _maxInstanceCount?: number })._maxInstanceCount;
  return out;
}
