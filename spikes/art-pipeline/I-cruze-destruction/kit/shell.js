// shell.js — geometry primitives for damage-ready vehicles.
//
//   closedShell(sample, ...)  a detachable panel as a CLOSED solid: outer patch + offset inner patch + perimeter rim wall
//   clipOut(geo, regions)     cut panel openings out of a body mesh along exact 2D outlines (no jagged "torn paper" edge)
//   holeBoundary / jamb()     the wall that runs from an opening's edge into the car, built from the cut edges so it is watertight
//   warpGeometry(geo, warp)   apply a smooth space-warp to positions AND normals (n' = cof(J)·n), the basis of every morph target
//
// Everything is plain BufferGeometry so the kit's KitBuilder can paint and merge it.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/**
 * Closed shell over a parametric patch.
 * sample(a, b) → { p: Vector3, n: Vector3 } on the reference surface (n points OUT of the car).
 * The outer skin sits at p + n·off, the inner skin at p + n·(off − thick); a rim wall joins them along every
 * non-degenerate boundary edge. Outer/inner share the grid, so they deform as a pair and stay a closed object.
 * Returns { outer, inner, rim, info } — separate geometries so callers can give each its own material/layer.
 */
export function closedShell(sample, { nu, nv, off = 0, thick, periodicU = false, offFn = null, dirFn = null }) {   // dirFn(a,b,n) → thickness direction (default n)
  if (!(thick > 0)) throw new Error('closedShell: thickness must be > 0');
  const W = nu + 1, H = nv + 1, n = W * H;
  const O = new Float32Array(n * 3), I = new Float32Array(n * 3), N = new Float32Array(n * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const a = i / nu, b = j / nv, h = sample(a, b), k = j * W + i, o = offFn ? offFn(a, b) : off;
    const nn = h.n;
    O[k * 3] = h.p.x + nn.x * o; O[k * 3 + 1] = h.p.y + nn.y * o; O[k * 3 + 2] = h.p.z + nn.z * o;
    const td = dirFn ? dirFn(a, b, nn) : nn;
    I[k * 3] = h.p.x + nn.x * o - td.x * thick; I[k * 3 + 1] = h.p.y + nn.y * o - td.y * thick; I[k * 3 + 2] = h.p.z + nn.z * o - td.z * thick;
    N[k * 3] = nn.x; N[k * 3 + 1] = nn.y; N[k * 3 + 2] = nn.z;
  }
  // triangle winding from the first non-degenerate quad vs the sampled normal
  const idx = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const p = j * W + i, q = p + 1, r = p + W, s = r + 1; idx.push(p, q, s, p, s, r); }
  let flip = 0, votes = 0; const pa = V(), pb = V(), pc = V(), fn = V(), an = V();
  for (let t = 0; t < idx.length; t += 3) {
    pa.fromArray(O, idx[t] * 3); pb.fromArray(O, idx[t + 1] * 3); pc.fromArray(O, idx[t + 2] * 3);
    fn.crossVectors(pb.sub(pa), pc.sub(pa)); if (fn.lengthSq() < 1e-14) continue;
    an.fromArray(N, idx[t] * 3).add(V().fromArray(N, idx[t + 1] * 3)).add(V().fromArray(N, idx[t + 2] * 3));
    votes++; if (fn.dot(an) < 0) flip++;
  }
  const outerIdx = flip > votes / 2 ? reverseTris(idx) : idx;
  const outer = mk(O, N, outerIdx, nu, nv);
  const NI = N.map((x) => -x);
  const inner = mk(I, NI, reverseTris(outerIdx), nu, nv);
  // rim: walk the boundary once; skip degenerate edges (patch tips) and the u-seam of a periodic patch
  const loop = [];
  for (let i = 0; i < nu; i++) loop.push([i, 0, i + 1, 0]);
  if (!periodicU) for (let j = 0; j < nv; j++) loop.push([nu, j, nu, j + 1]);
  for (let i = nu; i > 0; i--) loop.push([i, nv, i - 1, nv]);
  if (!periodicU) for (let j = nv; j > 0; j--) loop.push([0, j, 0, j - 1]);
  // centre of the patch (outer) for orienting the rim outward
  const cen = V(); for (let k = 0; k < n; k++) cen.x += O[k * 3], cen.y += O[k * 3 + 1], cen.z += O[k * 3 + 2]; cen.multiplyScalar(1 / n);
  const rp = [], rn = [], ri = []; const A = V(), B = V(), Ai = V(), Bi = V(), e1 = V(), e2 = V(), nr = V(), mid = V(), nAvg = V();
  let rimEdges = 0;
  for (const [i0, j0, i1, j1] of loop) {
    const ka = j0 * W + i0, kb = j1 * W + i1;
    A.fromArray(O, ka * 3); B.fromArray(O, kb * 3); Ai.fromArray(I, ka * 3); Bi.fromArray(I, kb * 3);
    if (A.distanceToSquared(B) < 1e-10) continue;
    e1.subVectors(B, A); e2.subVectors(Ai, A); nr.crossVectors(e1, e2).normalize();
    mid.addVectors(A, B).multiplyScalar(0.5);
    nAvg.fromArray(N, ka * 3);                       // remove the normal component so "outward" means along the surface
    const out = mid.clone().sub(cen); out.addScaledVector(nAvg, -out.dot(nAvg));
    let quad = [A, B, Bi, Ai];
    if (nr.dot(out) < 0) { nr.negate(); quad = [B, A, Ai, Bi]; }
    const base = rp.length / 3;
    for (const q of quad) { rp.push(q.x, q.y, q.z); rn.push(nr.x, nr.y, nr.z); }
    ri.push(base, base + 1, base + 2, base, base + 2, base + 3); rimEdges++;
  }
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rim.setAttribute('normal', new THREE.Float32BufferAttribute(rn, 3));
  rim.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((rp.length / 3) * 2), 2)); rim.setIndex(ri);
  return { outer, inner, rim, info: { nu, nv, thick, off, rimEdges, periodicU } };
}
function reverseTris(idx) { const o = idx.slice(); for (let t = 0; t < o.length; t += 3) { const x = o[t + 1]; o[t + 1] = o[t + 2]; o[t + 2] = x; } return o; }
function mk(P, N, idx, nu, nv) {
  const g = new THREE.BufferGeometry(), uv = new Float32Array((P.length / 3) * 2);
  for (let j = 0, m = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, m++) { uv[m * 2] = i / nu; uv[m * 2 + 1] = j / nv; }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.userData.grid = { nu, nv };
  return g;
}

/** single-sided grid sampled from {p,n} hits, pushed out by off; `facing: 'out'|'in'` picks the side the normals face */
export function patchGrid(sample, { nu, nv, off = 0, facing = 'out' }) {
  const s = closedShell(sample, { nu, nv, off, thick: 1e-3 });
  return facing === 'out' ? s.outer : (() => { // inner surface at exactly `off`
    const g = s.inner, P = g.attributes.position.array, Nn = g.attributes.normal.array;
    for (let k = 0; k < P.length; k++) P[k] -= Nn[k] * 1e-3;      // inner normals are −n, so this moves it back out by 1 mm
    return g;
  })();
}

// ── clipping a body mesh against convex 2D regions ─────────────────────────────────────────────────────────────
// region: { proj(p:Vector3)->[s,t], poly: [[s,t],...] convex (any winding) | halfPlanes: [[ax,ay,c]] meaning ax*s+ay*t >= c is INSIDE,
//           domain(centroid:Vector3, normal:Vector3) -> bool  (which triangles this outline applies to, e.g. "first hit from the left") }
// Everything INSIDE a region is removed; the parts of straddling triangles outside it are kept, cut exactly on the outline.
export function polyToHalfPlanes(poly) {
  let area = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; }
  const sg = area > 0 ? 1 : -1, hp = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey); if (L < 1e-9) continue;
    const ax = (-ey / L) * sg, ay = (ex / L) * sg;   // inward normal
    hp.push([ax, ay, ax * p[0] + ay * p[1]]);
  }
  return hp;
}
/** grow a convex polygon outward by g (edge offset, corners re-intersected) */
export function growPoly(poly, g) {
  const hp = polyToHalfPlanes(poly).map(([ax, ay, c]) => [ax, ay, c - g]), n = hp.length, out = [];
  for (let i = 0; i < n; i++) {
    const [a1, b1, c1] = hp[(i + n - 1) % n], [a2, b2, c2] = hp[i], det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-9) { const p = poly[i]; out.push([p[0] - a2 * g, p[1] - b2 * g]); continue; }
    out.push([(c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det]);
  }
  return out;
}

export function clipOut(geo, regions) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const P = src.attributes.position.array, Nn = src.attributes.normal.array, U = src.attributes.uv ? src.attributes.uv.array : null;
  const nTri = P.length / 9, outP = [], outN = [], outU = [];
  const regs = regions.map((r) => ({ ...r, hp: r.halfPlanes ?? polyToHalfPlanes(r.poly) }));
  const cen = V(), nor = V();
  const vert = (t, k) => ({ p: [P[(t * 3 + k) * 3], P[(t * 3 + k) * 3 + 1], P[(t * 3 + k) * 3 + 2]], n: [Nn[(t * 3 + k) * 3], Nn[(t * 3 + k) * 3 + 1], Nn[(t * 3 + k) * 3 + 2]], u: U ? [U[(t * 3 + k) * 2], U[(t * 3 + k) * 2 + 1]] : [0, 0] });
  const lerpV = (a, b, t) => ({ p: a.p.map((x, i) => x + (b.p[i] - x) * t), n: a.n.map((x, i) => x + (b.n[i] - x) * t), u: a.u.map((x, i) => x + (b.u[i] - x) * t) });
  // Sutherland–Hodgman against one half-plane; keep side `keepIn`
  const clipHP = (poly, reg, [ax, ay, c], keepIn) => {
    const out = [], f = (v) => { const [s, t] = reg.proj(_tmp.set(v.p[0], v.p[1], v.p[2])); const d = ax * s + ay * t - c; return keepIn ? d : -d; };
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) out.push(lerpV(a, b, fa / (fa - fb)));
    }
    return out;
  };
  const emit = (poly) => { for (let i = 1; i + 1 < poly.length; i++) for (const v of [poly[0], poly[i], poly[i + 1]]) { outP.push(...v.p); outN.push(...v.n); outU.push(...v.u); } };
  let removed = 0, cut = 0;
  for (let t = 0; t < nTri; t++) {
    let pieces = [[vert(t, 0), vert(t, 1), vert(t, 2)]];
    cen.set(0, 0, 0); nor.set(0, 0, 0);
    for (const v of pieces[0]) { cen.x += v.p[0] / 3; cen.y += v.p[1] / 3; cen.z += v.p[2] / 3; nor.x += v.n[0]; nor.y += v.n[1]; nor.z += v.n[2]; }
    nor.normalize();
    for (const reg of regs) {
      if (!reg.domain(cen, nor)) continue;
      const next = [];
      for (const poly of pieces) {
        let inside = poly;
        for (const h of reg.hp) {   // outside pieces = (inside of the previous edges) ∩ (outside of this edge)
          const o = clipHP(inside, reg, h, false); if (o.length >= 3 && area3(o) > 1e-9) next.push(o);
          inside = clipHP(inside, reg, h, true); if (inside.length < 3) break;
        }
        if (inside.length >= 3) { if (next.length) cut++; else removed++; }
      }
      pieces = next;
      if (!pieces.length) break;
    }
    for (const poly of pieces) emit(poly);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(outU, 2));
  const w = weld(g); w.userData.clip = { removed, cut };
  return w;
}
const _tmp = V();
function area3(poly) { const a = V(), b = V(), c = V(); let s = 0; for (let i = 1; i + 1 < poly.length; i++) { a.fromArray(poly[0].p); b.fromArray(poly[i].p).sub(a); c.fromArray(poly[i + 1].p).sub(a); s += b.cross(c).length() / 2; } return s; }

/** weld coincident vertices (same position+normal within tolerance) and index the geometry */
export function weld(g, tol = 1e-5) {
  const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array, map = new Map();
  const pos = [], nor = [], uv = [], idx = [], q = (x) => Math.round(x / tol);
  for (let i = 0; i < P.length / 3; i++) {
    const key = `${q(P[i * 3])},${q(P[i * 3 + 1])},${q(P[i * 3 + 2])},${Math.round(N[i * 3] * 50)},${Math.round(N[i * 3 + 1] * 50)},${Math.round(N[i * 3 + 2] * 50)}`;
    let k = map.get(key);
    if (k === undefined) { k = pos.length / 3; map.set(key, k); pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); nor.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); uv.push(U[i * 2], U[i * 2 + 1]); }
    idx.push(k);
  }
  // drop zero-area triangles produced by clipping slivers
  const out = [], a = V(), b = V(), c = V();
  for (let t = 0; t < idx.length; t += 3) {
    if (idx[t] === idx[t + 1] || idx[t + 1] === idx[t + 2] || idx[t] === idx[t + 2]) continue;
    a.fromArray(pos, idx[t] * 3); b.fromArray(pos, idx[t + 1] * 3).sub(a); c.fromArray(pos, idx[t + 2] * 3).sub(a);
    if (b.cross(c).lengthSq() < 1e-14) continue;
    out.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  const w = new THREE.BufferGeometry();
  w.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); w.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  w.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); w.setIndex(out);
  return w;
}

/** boundary edges of an indexed mesh whose endpoints both satisfy onEdge(p) (i.e. the edges a clip region created) */
export function holeBoundary(g, onEdge, tol = 2e-4) {
  const P = g.attributes.position.array, Nn = g.attributes.normal.array, idx = g.index.array, q = (x) => Math.round(x / tol);
  const key = (i) => `${q(P[i * 3])},${q(P[i * 3 + 1])},${q(P[i * 3 + 2])}`;
  const count = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3], ka = key(a), kb = key(b), k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    const c = count.get(k); if (c) c.n++; else count.set(k, { n: 1, a, b });
  }
  const edges = [], pa = V(), pb = V();
  for (const { n, a, b } of count.values()) {
    if (n !== 1) continue;
    pa.fromArray(P, a * 3); pb.fromArray(P, b * 3);
    const na = V().fromArray(Nn, a * 3).normalize(), nb = V().fromArray(Nn, b * 3).normalize();
    if (typeof onEdge === 'object') {   // {side(p), proj(p)->[s,t], hp:[[ax,ay,c]]}: trim the edge to the region (clipping leaves T-junctions,
      if (!onEdge.side(pa) && !onEdge.side(pb)) continue;   // so one long edge can run from outside the outline to inside it)
      const A2 = onEdge.proj(pa), B2 = onEdge.proj(pb); let t0 = 0, t1 = 1;
      for (const [ax, ay, c] of onEdge.hp) {
        const fa = ax * A2[0] + ay * A2[1] - c + 2e-3, fb = ax * B2[0] + ay * B2[1] - c + 2e-3;
        if (fa < 0 && fb < 0) { t1 = -1; break; }
        if (fa < 0) t0 = Math.max(t0, fa / (fa - fb)); else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
      }
      if (t1 - t0 < 1e-4) continue;
      const lp = (t) => pa.clone().lerp(pb, t), ln = (t) => na.clone().lerp(nb, t).normalize();
      edges.push({ a: lp(t0), b: lp(t1), na: ln(t0), nb: ln(t1) }); continue;
    }
    if (!onEdge(pa) || !onEdge(pb)) continue;
    edges.push({ a: pa.clone(), b: pb.clone(), na, nb });
  }
  return edges;
}
/** wall from each boundary edge into the car (−normal) by `depth`; faces the opening's centre `toward` */
/** `depth` is either metres along −normal, or a function (p, n) → inner point (e.g. projection onto a flat cavity back) */
export function jamb(edges, depth, toward) {
  const pos = [], nor = [], idx = []; const A = V(), B = V(), Ai = V(), Bi = V(), e1 = V(), e2 = V(), nr = V(), mid = V();
  const inner = typeof depth === 'function' ? depth : (p, n) => p.clone().addScaledVector(n, -depth);
  for (const { a, b, na, nb } of edges) {
    A.copy(a); B.copy(b); Ai.copy(inner(a, na)); Bi.copy(inner(b, nb));
    e1.subVectors(B, A); e2.subVectors(Ai, A); nr.crossVectors(e1, e2); if (nr.lengthSq() < 1e-14) continue; nr.normalize();
    mid.addVectors(A, B).add(Ai).add(Bi).multiplyScalar(0.25);
    let quad = [A, B, Bi, Ai];
    if (nr.dot(V().subVectors(toward(mid), mid)) < 0) { nr.negate(); quad = [B, A, Ai, Bi]; }
    const base = pos.length / 3;
    for (const p of quad) { pos.push(p.x, p.y, p.z); nor.push(nr.x, nr.y, nr.z); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)); g.setIndex(idx);
  return g;
}

// ── space warps → morph targets ───────────────────────────────────────────────────────────────────────────────
// A warp is d(x,y,z) → displacement (m) in KIT space. Applying the same smooth warp to every surface of an assembly keeps
// nested surfaces nested as long as det(I + ∇d) > 0 everywhere (the map is then locally injective), which is why the chassis,
// its cavities and the panels over them cannot cross each other at any weight. gates.mjs measures min det for every channel.
const _d = [0, 0, 0], _e = [0, 0, 0];
export function jacobian(warp, x, y, z, h = 2e-3) {
  const J = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let c = 0; c < 3; c++) {
    const p = [x, y, z]; p[c] += h; warp(p[0], p[1], p[2], _d); const d1 = _d.slice();
    p[c] -= 2 * h; warp(p[0], p[1], p[2], _e);
    for (let r = 0; r < 3; r++) J[r][c] += (d1[r] - _e[r]) / (2 * h);
  }
  return J;
}
export const det3 = (J) => J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
/** positions + normals of `geo` (kit space, after `toKit`) under warp. Returns {pos, nor} Float32Arrays in the geometry's own space. */
export function warpGeometry(geo, warp, toKit = null) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, n = P.length / 3;
  const pos = new Float32Array(P.length), nor = new Float32Array(N.length), d = [0, 0, 0], v = V(), w = V();
  const inv = toKit ? toKit.clone().invert() : null;
  for (let i = 0; i < n; i++) {
    v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (toKit) v.applyMatrix4(toKit);
    warp(v.x, v.y, v.z, d);
    w.set(v.x + d[0], v.y + d[1], v.z + d[2]); if (inv) w.applyMatrix4(inv);
    pos[i * 3] = w.x; pos[i * 3 + 1] = w.y; pos[i * 3 + 2] = w.z;
    // normal transforms by the cofactor matrix of J (inverse-transpose up to scale); toKit is rigid+translation, so rotate in/out
    const J = jacobian(warp, v.x, v.y, v.z), nn = V(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
    if (toKit) nn.transformDirection(toKit);
    const C = cof(J), m = V(C[0][0] * nn.x + C[0][1] * nn.y + C[0][2] * nn.z, C[1][0] * nn.x + C[1][1] * nn.y + C[1][2] * nn.z, C[2][0] * nn.x + C[2][1] * nn.y + C[2][2] * nn.z).normalize();
    if (inv) m.transformDirection(inv);
    nor[i * 3] = m.x; nor[i * 3 + 1] = m.y; nor[i * 3 + 2] = m.z;
  }
  return { pos, nor };
}
function cof(J) {   // cofactor matrix: cof(J) = det(J)·J^{-T}
  return [
    [J[1][1] * J[2][2] - J[1][2] * J[2][1], -(J[1][0] * J[2][2] - J[1][2] * J[2][0]), J[1][0] * J[2][1] - J[1][1] * J[2][0]],
    [-(J[0][1] * J[2][2] - J[0][2] * J[2][1]), J[0][0] * J[2][2] - J[0][2] * J[2][0], -(J[0][0] * J[2][1] - J[0][1] * J[2][0])],
    [J[0][1] * J[1][2] - J[0][2] * J[1][1], -(J[0][0] * J[1][2] - J[0][2] * J[1][0]), J[0][0] * J[1][1] - J[0][1] * J[1][0]],
  ];
}
