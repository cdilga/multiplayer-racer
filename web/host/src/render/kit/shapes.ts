// Small helpers for code-built kit pieces (P1-R03): primitive parts with a flat vertex colour, merged into one
// geometry per piece so a piece type is one draw however many instances a map places.
import { BoxGeometry, BufferAttribute, Color, ConeGeometry, CylinderGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const c = new Color();

/** Paints every vertex of `g` one colour (non-indexed, so flat faces stay flat). */
export function paint(g: BufferGeometry, colour: string): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const n = out.attributes.position!.count;
  const a = new Float32Array(n * 3);
  c.set(colour);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  out.setAttribute('color', new BufferAttribute(a, 3));
  out.deleteAttribute('uv');
  return out;
}

/** A box from y0 to y1 (ground at 0), centred on x and z. */
export function slab(w: number, y0: number, y1: number, d: number, colour: string): BufferGeometry {
  return paint(new BoxGeometry(w, y1 - y0, d).translate(0, (y0 + y1) / 2, 0), colour);
}

/** A cylinder from y0 to y1, radius r (a multiple of 4 segments puts vertices on both axes, so its bounds are 2r). */
export function drum(r: number, y0: number, y1: number, colour: string, segments = 12): BufferGeometry {
  return paint(new CylinderGeometry(r, r, y1 - y0, segments).translate(0, (y0 + y1) / 2, 0), colour);
}

/** A cone (or a frustum with `top` > 0) from y0 to y1. */
export function spire(r: number, top: number, y0: number, y1: number, colour: string, segments = 12): BufferGeometry {
  const g = top > 0 ? new CylinderGeometry(top, r, y1 - y0, segments) : new ConeGeometry(r, y1 - y0, segments);
  return paint(g.translate(0, (y0 + y1) / 2, 0), colour);
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('kit piece parts have mismatched attributes');
  g.computeBoundingBox();
  return g;
}
