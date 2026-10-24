// optimise.mjs (br-8h3u.10): the bake's mesh pass over a vehicle's per-part triangle soups, so the triangle budget buys
// visible detail.
//
//   orientAndPrune(part)  per part, against its own geometry only (no part state can reveal what its own shell hides):
//                         a triangle whose back face is seen from outside but whose front never is gets flipped (with
//                         front-face culling it was a hole in the car), and one seen from neither side is dropped.
//
// Deterministic (a fixed ray set), so bake --check stays byte-reproducible. The survey and measurements behind it, and
// why meshoptimizer LODs aren't used (parity with the hand LODs once colour seams are kept):
// docs/evidence/P1-mesh-opt/README.md.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/** Ray directions (a Fibonacci sphere) and in-triangle sample points for the visibility test. From 512 directions up,
 *  dropping the hidden set stopped changing any pixel of 64 culled renders across the roster; 1024 keeps a margin (the
 *  dropped counts still wobble at 512). Evidence: docs/evidence/P1-mesh-opt/README.md. */
const DIRS = (() => {
  const n = 1024, out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), t = i * Math.PI * (3 - Math.sqrt(5));
    out.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r));
  }
  return out;
})();
// interior points plus points just inside every edge and corner: a triangle that shows only a thin strip along one edge
// (tucked under a neighbouring panel) is still seen
const SAMPLES = (() => {
  const out = [[1 / 3, 1 / 3], [0.7, 0.15], [0.15, 0.7], [0.15, 0.15]], e = 0.01;
  for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) out.push([t, e], [e, t], [t * (1 - 2 * e) + e, (1 - t) * (1 - 2 * e) + e - e]);
  out.push([1 - 2 * e, e], [e, 1 - 2 * e], [e, e]);
  return out;
})();

/** Per triangle: 1 if its front face is seen from some direction, 2 if only its back face is, 0 if neither. */
export function faceVisibility(positions) {
  const T = positions.length / 9, out = new Uint8Array(T);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
  const bvh = new MeshBVH(g, { indirect: true });
  const ray = new THREE.Ray(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), s = new THREE.Vector3();
  const seen = (t, sign) => {
    for (const d of DIRS) {
      if (sign * d.dot(n) < 0.02) continue;
      for (const [u, v] of SAMPLES) {
        s.copy(a).multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
        ray.origin.copy(s).addScaledVector(d, 20);
        ray.direction.copy(d).negate();
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
        if (!hit || hit.faceIndex === t || hit.point.distanceTo(s) < 2e-4) return true;
      }
    }
    return false;
  };
  for (let t = 0; t < T; t++) {
    a.fromArray(positions, 9 * t); b.fromArray(positions, 9 * t + 3); c.fromArray(positions, 9 * t + 6);
    n.crossVectors(s.subVectors(b, a), new THREE.Vector3().subVectors(c, a));
    if (n.length() < 2e-9) continue; // degenerate: draws nothing, dropped
    n.normalize();
    out[t] = seen(t, 1) ? 1 : seen(t, -1) ? 2 : 0;
  }
  return out;
}

/** The part with back-facing-only triangles flipped and never-seen ones dropped; `stats` counts both. */
export function orientAndPrune(part) {
  const vis = faceVisibility(part.positions), positions = [], uvs = [];
  let flipped = 0, dropped = 0;
  for (let t = 0; t < vis.length; t++) {
    if (!vis[t]) { dropped++; continue; }
    const order = vis[t] === 2 ? (flipped++, [0, 2, 1]) : [0, 1, 2];
    for (const k of order) {
      positions.push(part.positions[9 * t + 3 * k], part.positions[9 * t + 3 * k + 1], part.positions[9 * t + 3 * k + 2]);
      uvs.push(part.uvs[6 * t + 2 * k], part.uvs[6 * t + 2 * k + 1]);
    }
  }
  return { ...part, positions, uvs, tris: positions.length / 9, stats: { flipped, dropped } };
}
