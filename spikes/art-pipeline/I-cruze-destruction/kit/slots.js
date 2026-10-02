// slots.js — four semantic material SLOTS instead of fourteen material kinds.
//
// The H kit merged per *kind* (paint/matte/satin/gloss/rubber/metal/chrome/alloy/atlas/glass/head/brake/indicator…), so one car
// was ~20 draws intact and ~75 in parts. Here a "kind" only decides vertex data:
//   paint  identity paint, tinted per car (vertex colour = relative shading)
//   trim   everything opaque that is not paint: plastics, rubber, chrome, alloy, the grille atlas. Roughness/metalness ride in a
//          per-vertex `pbr` attribute; the trim atlas carries the honeycomb/slat textures and a white texel for everything else.
//   glass  windows and lamp lenses
//   lamp   emissive; per-vertex `emit` class (1 head · 2 brake · 3 indicator) lets the runtime drive lights per car with uniforms.
// The part hierarchy (what detaches) and the material hierarchy (what merges) are separate concerns.
//
// Every add() also chooses a LAYER: 'vis' (seen on the intact car) or 'occ' (only exists to be revealed: cavity contents, panel
// inner skins, sockets). The intact fast path merges only 'vis'; the damage-ready assembly carries both.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KitBuilder } from '../../H-primitive-kit/kit/kit.js';

export const SLOTS = ['paint', 'trim', 'glass', 'lamp'];
// layers: vis   in the intact car and the assembly (decals, glass, lamps, trim)
//         panel the cut chassis, jambs, cavity backs and panel outer skins: assembly always, intact only where the LOD keeps shut lines
//         occ   only revealed by damage (inner skins, cavity contents, sockets): assembly only
//         whole the UNCUT body for coarse intact LODs (no seams to see at that size): intact only
export const LAYERS = ['vis', 'panel', 'occ', 'whole'];
// kind → slot + [roughness, metalness] (+ emit class)
export const KINDS = {
  paint: { slot: 'paint', pbr: [0.3, 0.55] },
  paintInner: { slot: 'paint', pbr: [0.6, 0.3] },
  matte: { slot: 'trim', pbr: [0.72, 0] }, satin: { slot: 'trim', pbr: [0.46, 0] }, gloss: { slot: 'trim', pbr: [0.26, 0] },
  rubber: { slot: 'trim', pbr: [0.92, 0] }, metal: { slot: 'trim', pbr: [0.36, 0.75] }, chrome: { slot: 'trim', pbr: [0.14, 1] },
  alloy: { slot: 'trim', pbr: [0.28, 0.9] }, atlas: { slot: 'trim', pbr: [0.5, 0] },
  glass: { slot: 'glass', pbr: [0.08, 0] },
  headlight: { slot: 'lamp', pbr: [1, 0], emit: 1 }, brakelight: { slot: 'lamp', pbr: [1, 0], emit: 2 }, indicator: { slot: 'lamp', pbr: [1, 0], emit: 3 },
};
// trim atlas layout (v up): honeycomb v∈[.5,1], slats v∈[.0625,.5], white texel strip v∈[0,.0625]
export const ATLAS = { HEX: [0, 0.5, 1, 1], SLAT: [0, 0.0625, 1, 0.5], WHITE: [0.5, 0.03] };
const ATLAS_KIND = { uuid: 'atlas', name: 'atlas' };

export class SlotBuilder {
  constructor() { this.b = Object.fromEntries(LAYERS.map((l) => [l, new KitBuilder()])); }
  push(t) { this.b.vis.push(t); this.b.occ.push(t); return this; }
  pop() { this.b.vis.pop(); this.b.occ.pop(); return this; }
  /** same options as KitBuilder.add plus { layer: 'vis'|'occ' } */
  add(geo, kind, o = {}) {
    if (!KINDS[kind]) throw new Error('unknown kind ' + kind);
    this.b[o.layer ?? 'vis'].add(geo, kind === 'atlas' ? ATLAS_KIND : { uuid: kind, name: kind }, o);
    return this;
  }
  /** → { vis: {slot: geo}, occ: {slot: geo} } in the part's own space (origin at `pivot`, kit axes) */
  finish(pivot = [0, 0, 0]) {
    const out = {};
    for (const layer of LAYERS) {
      const per = {};
      for (const [, bucket] of this.b[layer].buckets) {
        const k = KINDS[bucket.kind];
        for (const g of bucket.list) {
          const n = g.attributes.position.count, pbr = new Float32Array(n * 2), emit = new Float32Array(n);
          for (let i = 0; i < n; i++) { pbr[i * 2] = k.pbr[0]; pbr[i * 2 + 1] = k.pbr[1]; emit[i] = k.emit ?? 0; }
          g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 2)); g.setAttribute('emit', new THREE.BufferAttribute(emit, 1));
          if (bucket.kind !== 'atlas') { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, ATLAS.WHITE[0], ATLAS.WHITE[1]); }
          dropDegenerate(g);
          g.translate(-pivot[0], -pivot[1], -pivot[2]);
          (per[k.slot] ??= []).push(g);
        }
      }
      out[layer] = Object.fromEntries(Object.entries(per).map(([s, list]) => [s, list.length === 1 ? list[0] : mergeGeometries(list, false)]));
    }
    return out;
  }
}
export const triCount = (g) => (g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0);

/** remove zero-area triangles (patch tips, lathe poles, clipped slivers): they never render but they are noise in every count */
function dropDegenerate(g) {
  const P = g.attributes.position.array, idx = g.index.array, out = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz > 1e-16) out.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  if (out.length !== idx.length) g.setIndex(out);
}
