// model.js: the low-poly Hawk Dash built from code (R81, R123; br-bwju.3, rebuilt against its sheet in br-bwju.11): a
// caricatured Australian V8 sedan in the spirit of the Falcon XR8 Sprint. Same spec and handling as the Lion President, a
// different body.
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs). P comes from params.json, fitted to refs/lod-plus-1.png with tools/vehicles/fit (silhouette
// IoU in docs/evidence/P1-V-finish/hawk-dash/).
//
// Frame: metres, +Z = nose, +Y up, origin on the ground between the axles (jj.vehicle.v1). +X is the car's LEFT, so door_FL
// and wheel_FL sit on +X. The driver sits on the right (cam_fp at −X).
//
// The body is the Cruz Missile's construction (two flat-shaded lofts, tub + greenhouse, sampled from smooth curves in P);
// what makes it a Hawk is its proportions (long, low, a long bonnet) and the details its reference sheet shows, each built
// from numbers measured off the sheet (P.front, P.rear, P.windows…):
//   - cabin: painted A and C pillars, black-framed side glass in three panes (front door, rear door, quarter), a black B
//     pillar, the painted roof carrying the twin stripes;
//   - front: swept "hawk-eye" headlamps that wrap round the corner onto the wing, a black hexagonal upper grille, a big
//     lower intake with mesh bars, vertical LED slots in black surrounds at the bumper corners, a wide black splitter; the
//     bonnet's power bulge and two louvred vents;
//   - wheels: flared arches, dark 5-spoke rims with a hub in a dark barrel;
//   - rear: angular tail lamps (red outline, smoked centre) that wrap onto the quarters, a body-colour wing on two short
//     posts with turned-down tips, a black diffuser with fins and four chrome tail pipes in two pairs;
//   - big black mirrors on stalks, door handles, side skirts, the twin stripes nose to tail (bonnet, nose, roof, boot and
//     tail) and the side "C" graphic with its pinstripe (atlas).
// Fascia and tail decals are measured in the sheet's front and rear views ((x, y) in metres) and projected onto the body
// along the car's axis, cut into small cells so they follow the curved nose and tail.
// LOD changes only the sampling density and which details exist; part names and pivots are identical at every LOD.
// Damage parts: front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; everything else is core.
import * as THREE from 'three';
import { swatchUV, REGION, SPAN } from './atlas.js';

export const LODS = {
  0: { arch: 9, nose: 2, curvePts: true, merge: 0.08, doorMid: true, wheelSeg: 16, rim: 'spokes', bayBoxes: true, hub: true, flare: 9, flareLip: true, flareEnds: true, tyreCap: true, cell: 0.1, lampCell: 0.06, lampOff: 0, lamps: 'full', intakeBars: 3, slots: true, splitter: true, vents: 4, bulge: true, windows: true, mirrors: 'stalk', wing: 'posts', tips: true, exhaust: 'rings', diffFins: 4, handles: true, skirts: true, seams: true, corners: true },
  1: { arch: 5, nose: 1, curvePts: true, merge: 0.25, doorMid: true, wheelSeg: 8, rim: 'flat', bayBoxes: false, hub: false, flare: 5, flareLip: false, flareEnds: false, tyreCap: false, cell: 0.3, lampCell: 0.2, lampOff: 0.02, lamps: 'full', intakeBars: 0, slots: true, splitter: true, vents: 0, bulge: true, windows: true, mirrors: 'box', wing: 'posts', tips: false, exhaust: 'flat', diffFins: 0, handles: false, skirts: false, seams: false, corners: false },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, doorMid: false, wheelSeg: 8, rim: 'flat', bayBoxes: false, hub: false, flare: 0, flareLip: false, flareEnds: false, tyreCap: false, cell: 0.35, lampCell: 0.25, lampOff: 0.025, lamps: 'flat', intakeBars: 0, slots: false, splitter: false, vents: -1, bulge: false, windows: 'flat', mirrors: 'box', wing: 'plate', tips: false, exhaust: 'flat', diffFins: 0, handles: false, skirts: false, seams: false, corners: false },
};

const lerpCurve = (pts, z) => {
  if (z >= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (z >= pts[i][0]) { const [z0, a] = pts[i - 1], [z1, b] = pts[i]; return b + (a - b) * (z - z1) / (z0 - z1); }
  return pts[pts.length - 1][1];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// a convex 2D polygon [[a, b]…] clipped to p[axis] ≤ k (side −1) or p[axis] ≥ k (side 1)
const clip = (pts, k, side, axis = 0) => {
  const inside = (p) => side * (p[axis] - k) >= -1e-9, out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) { const t = (k - a[axis]) / (b[axis] - a[axis]); out.push(axis === 0 ? [k, a[1] + (b[1] - a[1]) * t] : [a[0] + (b[0] - a[0]) * t, k]); }
  }
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-6);
};
const clipZ = (pts, k, side) => clip(pts, k, side, 0);
const inPoly = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

// ───────────────────────── triangle soup builder (non-indexed → flat shading) ─────────────────────────
class Soup {
  constructor() { this.p = []; this.uv = []; this.c = []; this.nc = []; }
  /** Draws fn's triangles as decoration the bake leaves out of the part's collider (mirrors, wing tips). */
  decor(fn) { const a = this.p.length / 3; fn(); this.nc.push([a, this.p.length / 3]); }
  tri(a, b, c, uv, col = 1) {
    // uv: swatch name, or a function (vertex) → [u,v]
    for (const v of [a, b, c]) {
      this.p.push(v[0], v[1], v[2]);
      const t = typeof uv === 'string' ? swatchUV(uv) : uv(v);
      this.uv.push(t[0], t[1]); this.c.push(col, col, col);
    }
  }
  quad(a, b, c, d, uv, col) { this.tri(a, b, c, uv, col); this.tri(a, c, d, uv, col); }
  /** A planar convex polygon, wound so its normal points along `out` (a direction, roughly). */
  face(pts, uv, out) {
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    const P = dot(n, out) >= 0 ? pts : pts.slice().reverse();
    for (let i = 1; i < P.length - 1; i++) this.tri(P[0], P[i], P[i + 1], uv);
  }
  /** A convex solid given as faces (point lists): every face wound outward from the solid's centroid. */
  solid(faces, uv) {
    const all = faces.flat(), c = [0, 1, 2].map((k) => all.reduce((t, v) => t + v[k], 0) / all.length);
    for (const f of faces) {
      const fc = [0, 1, 2].map((k) => f.reduce((t, v) => t + v[k], 0) / f.length);
      this.face(f, uv, sub(fc, c));
    }
  }
  // closed box with optional per-face swatch {px,nx,py,ny,pz,nz}
  box(cx, cy, cz, sx, sy, sz, sw, rot = null) {
    const h = [sx / 2, sy / 2, sz / 2], m = rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)) : null;
    const V = (x, y, z) => { const v = new THREE.Vector3(x * h[0], y * h[1], z * h[2]); if (m) v.applyMatrix4(m); return [v.x + cx, v.y + cy, v.z + cz]; };
    const f = (k) => (typeof sw === 'string' ? sw : sw[k] ?? sw.all);
    this.quad(V(1, -1, -1), V(1, 1, -1), V(1, 1, 1), V(1, -1, 1), f('px'));
    this.quad(V(-1, -1, 1), V(-1, 1, 1), V(-1, 1, -1), V(-1, -1, -1), f('nx'));
    this.quad(V(-1, 1, -1), V(-1, 1, 1), V(1, 1, 1), V(1, 1, -1), f('py'));
    this.quad(V(-1, -1, 1), V(-1, -1, -1), V(1, -1, -1), V(1, -1, 1), f('ny'));
    this.quad(V(-1, -1, 1), V(1, -1, 1), V(1, 1, 1), V(-1, 1, 1), f('pz'));
    this.quad(V(1, -1, -1), V(-1, -1, -1), V(-1, 1, -1), V(1, 1, -1), f('nz'));
  }
  /** A square-section beam from a to b (four sides, open ends): posts, stalks. `up` orients its width. */
  beam(a, b, w, t, sw, up = [0, 1, 0]) {
    const ax = new THREE.Vector3(...sub(b, a)).normalize(), u = new THREE.Vector3(...up).cross(ax);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(ax);
    u.normalize(); const v = ax.clone().cross(u).normalize();
    const off = (p, i, j) => [p[0] + u.x * i * w / 2 + v.x * j * t / 2, p[1] + u.y * i * w / 2 + v.y * j * t / 2, p[2] + u.z * i * w / 2 + v.z * j * t / 2];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]], mid = mix(a, b, 0.5);
    for (let k = 0; k < 4; k++) {
      const [i0, j0] = corners[k], [i1, j1] = corners[(k + 1) % 4];
      const q = [off(a, i0, j0), off(a, i1, j1), off(b, i1, j1), off(b, i0, j0)];
      const fc = mix(q[0], q[2], 0.5); this.face(q, sw, sub(fc, mid));
    }
  }
  get tris() { return this.p.length / 9; }
}

// ───────────────────────── UV projections for the livery ─────────────────────────
function sideUV(P) { const [u0, v0, u1, v1] = REGION.side; return (v) => [u0 + (u1 - u0) * ((P.zNose - v[2]) / SPAN.side[0]), v0 + (v1 - v0) * (v[1] / SPAN.side[1])]; }
function topUV(P) { const [u0, v0, u1, v1] = REGION.top; return (v) => [u0 + (u1 - u0) * ((P.zNose - v[2]) / SPAN.top[0]), v0 + (v1 - v0) * (v[0] / SPAN.top[1] + 0.5)]; }

// ───────────────────────── build ─────────────────────────
function makeSoups(P, lod) {
  const T = LODS[lod];
  const zA = P.zFA - P.archR, zC = P.zRA + P.archR; // door span = between the arches; front/back cut lines
  // stations along z (descending: nose → tail)
  // tub stations: protected = ends, cut lines, arch samples, the fascia slope edge; optional = profile control points
  // (dropped when within T.merge of a kept station, so coarse tiers don't pay for near-duplicate rings)
  const prot = [P.zNose, P.zTail, zA, zC, P.zB, P.zNose - 0.16];
  for (let i = 1; i <= T.nose; i++) prot.push(P.zTail + 0.14 * i / T.nose);
  if (T.doorMid) prot.push((zA + P.zB) / 2, (P.zB + zC) / 2); // a ring mid-door so a door dent has vertices to move
  for (let i = 2; i <= T.nose; i++) prot.push(P.zNose - 0.16 * (i - 1) / T.nose);
  for (const zc of [P.zFA, P.zRA]) for (let i = 0; i < T.arch; i++) prot.push(+(zc + P.archR * Math.cos(Math.PI * i / (T.arch - 1))).toFixed(4));
  const opt = T.curvePts ? [...new Set([...P.ySh, ...P.yCr, ...P.hw].map(([z]) => z))] : [];
  const Z = [];
  for (const z of [...prot, ...opt]) if (z <= P.zNose && z >= P.zTail && !Z.some((k) => Math.abs(k - z) < (prot.includes(z) ? 1e-4 : T.merge))) Z.push(z);
  Z.sort((a, b) => b - a);

  const archY = (z) => {
    let y = -1;
    for (const zc of [P.zFA, P.zRA]) { const d = Math.abs(z - zc); if (d <= P.archR + 1e-6) y = Math.max(y, P.archBase + (P.archTop - P.archBase) * Math.sqrt(Math.max(0, 1 - (d / P.archR) ** 2))); }
    return y;
  };
  // tub ring, one side (s = ±1), from floor centre to crown centre: 6 points
  const ring0 = (z, s) => {
    const yb = lerpCurve(P.yBot, z), ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), hw = lerpCurve(P.hw, z);
    const ay = archY(z), lift = ay > 0 ? Math.max(yb, ay) : yb;
    const y2 = Math.max(lift + 0.03, yb + P.skirt), y3 = Math.max(y2 + 0.06, ysh - P.sideDrop);
    return [[0, yb, z], [s * (hw - P.floorIn), lift, z], [s * hw, y2, z], [s * hw, y3, z], [s * (hw - P.shoulderIn), ysh, z], [0, ycr, z]];
  };
  // the ring as the mesh draws it at any z: interpolated between the two stations either side (so a coarse LOD's decals
  // sit on its own coarser surface)
  const ring = (z, s) => {
    let i = 0; while (i < Z.length - 2 && Z[i + 1] > z) i++;
    if (Math.abs(z - Z[i]) < 1e-6) return ring0(Z[i], s);
    const a = ring0(Z[i], s), b = ring0(Z[i + 1], s), t = Math.min(1, Math.max(0, (Z[i] - z) / (Z[i] - Z[i + 1])));
    return a.map((p, k) => [p[0] + (b[k][0] - p[0]) * t, p[1] + (b[k][1] - p[1]) * t, z]);
  };
  // the tub's outer skin x at (z, y) on side s (the side wall, its shoulder chamfer, its floor chamfer)
  const skinX = (z, y, s) => {
    const r = ring(z, s);
    if (y >= r[3][1]) return mix(r[3], r[4], Math.min(1, (y - r[3][1]) / Math.max(1e-6, r[4][1] - r[3][1])))[0];
    if (y >= r[2][1]) return r[2][0];
    return mix(r[1], r[2], Math.max(0, (y - r[1][1]) / Math.max(1e-6, r[2][1] - r[1][1])))[0];
  };
  // the tub's top surface height at (x, z): the slope from the shoulder to the crown
  const deckY = (x, z) => { const ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), w = lerpCurve(P.hw, z) - P.shoulderIn; return ycr + (ysh - ycr) * Math.min(1, Math.abs(x) / w); };

  const soups = {}; const S = (id) => (soups[id] ??= new Soup());
  const partOfTub = (zm, seg, s) => {
    if (zm > zA + 1e-6) return 'front';
    if (zm < zC - 1e-6) return 'back';
    if (seg >= 1 && seg <= 3) return (zm > P.zB ? 'door_F' : 'door_R') + (s > 0 ? 'L' : 'R'); // +X is the car's left
    return 'core';
  };
  const sUV = sideUV(P), tUV = topUV(P);
  const segSwatch = (seg) => (seg === 0 ? 'under' : seg === 1 ? 'trim' : seg === 4 ? tUV : sUV); // 2, 3: side skin with livery
  for (const s of [1, -1]) {
    for (let i = 0; i < Z.length - 1; i++) {
      const a = ring0(Z[i], s), b = ring0(Z[i + 1], s), zm = (Z[i] + Z[i + 1]) / 2;
      for (let k = 0; k < 5; k++) {
        const so = S(partOfTub(zm, k, s));
        // winding: outward normals. ring order goes bottom→top on side s; for s>0 use (a_k, b_k, b_k+1, a_k+1)
        if (s > 0) so.quad(a[k], b[k], b[k + 1], a[k + 1], segSwatch(k)); else so.quad(a[k], a[k + 1], b[k + 1], b[k], segSwatch(k));
      }
    }
  }
  // end caps: nose (front) and tail (back) — fan over both sides' rings
  const capPoly = (z) => { const R = ring0(z, 1), Lr = ring0(z, -1); return [R[0], R[1], R[2], R[3], R[4], R[5], Lr[4], Lr[3], Lr[2], Lr[1]]; };
  const cap = (z, id, sign, sw) => {
    const poly = capPoly(z), c = [0, poly.reduce((t, v) => t + v[1], 0) / poly.length, z];
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; if (sign > 0) S(id).tri(c, p, q, sw); else S(id).tri(c, q, p, sw); }
  };
  cap(P.zNose, 'front', 1, 'paint'); cap(P.zTail, 'back', -1, 'paint');

  // ── decals on the nose and tail: a polygon measured in the sheet's front (dir 1) or rear (dir −1) view, in metres (x
  // across the car, the rear view's x mirrored so +x is still the car's left; y up), projected along the car's axis onto
  // the tub and lifted off it by `off` along the surface normal. It is cut into T.cell cells so it follows the curve. ──
  const outline = (z) => capPoly(z).map((p) => [p[0], p[1]]);
  const surfZ = (x, y, dir) => {
    const z0 = dir > 0 ? P.zNose : P.zTail, inside = (z) => inPoly(outline(z), x, y);
    if (inside(z0)) return z0;
    let a = z0, b = null;
    for (let d = 0.02; d <= 1.6; d += 0.02) { const z = z0 - dir * d; if (inside(z)) { b = z; break; } a = z; }
    if (b == null) return null;
    for (let i = 0; i < 14; i++) { const m = (a + b) / 2; if (inside(m)) b = m; else a = m; }
    return b;
  };
  const surfPt = (x, y, dir, off) => {
    const z = surfZ(x, y, dir) ?? (dir > 0 ? P.zNose : P.zTail), e = 0.012;
    const zx = ((surfZ(x + e, y, dir) ?? z) - (surfZ(x - e, y, dir) ?? z)) / (2 * e), zy = ((surfZ(x, y + e, dir) ?? z) - (surfZ(x, y - e, dir) ?? z)) / (2 * e);
    const cl = (v) => Math.max(-25, Math.min(25, v)), n = [-dir * cl(zx), -dir * cl(zy), dir], L = Math.hypot(...n);
    return [x + n[0] / L * off, y + n[1] / L * off, z + n[2] / L * off];
  };
  const decal = (so, poly, sw, off, dir, cell = T.cell) => {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell - 1e-6)), ny = Math.max(1, Math.ceil((y1 - y0) / cell - 1e-6));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      let pc = poly;
      if (i > 0) pc = clip(pc, x0 + (x1 - x0) * i / nx, 1, 0);
      if (i < nx - 1) pc = clip(pc, x0 + (x1 - x0) * (i + 1) / nx, -1, 0);
      if (j > 0) pc = clip(pc, y0 + (y1 - y0) * j / ny, 1, 1);
      if (j < ny - 1) pc = clip(pc, y0 + (y1 - y0) * (j + 1) / ny, -1, 1);
      if (pc.length < 3) continue;
      const pts = pc.map(([x, y]) => surfPt(x, y, dir, off)), c = mix(pts[0], pts[Math.floor(pts.length / 2)], 0.5);
      const n = surfPt(c[0], c[1], dir, 1); so.face(pts, sw, sub(n, surfPt(c[0], c[1], dir, 0)));
    }
  };
  const mirrorX = (poly) => poly.map(([x, y]) => [-x, y]).reverse();
  const both = (fn) => { for (const s of [1, -1]) fn(s, (poly) => (s > 0 ? poly : mirrorX(poly))); };

  // ── greenhouse: ring per cabin station, one side: base (belt) → glass top → roof edge → crown. The sides are painted
  // (the A and C pillars); the side glass is laid over them below. A station with yr null is the windscreen base or the
  // backlight foot: its ring lies flat on the body. Each station's `roof` says what the span behind it is: glass (the
  // windscreen, the backlight) or the painted roof, which carries the stripes. ──
  const cring = (c, s) => {
    const yb = lerpCurve(P.ySh, c.z) - 0.005;
    if (c.yr == null) { const yc = Math.max(yb, lerpCurve(P.yCr, c.z) - 0.005); return [[s * c.wb, yb, c.z], [s * c.wt, yb + 0.002, c.z], [s * (c.wt - P.roofCh), yc, c.z], [0, yc, c.z]]; }
    return [[s * c.wb, yb, c.z], [s * c.wt, c.yr - P.roofCh, c.z], [s * (c.wt - P.roofCh * 1.2), c.yr, c.z], [0, c.yr + P.roofCrown, c.z]];
  };
  const nC = P.cabin.length;
  for (const s of [1, -1]) for (let i = 0; i < nC - 1; i++) {
    const c = P.cabin[i], a = cring(c, s), b = cring(P.cabin[i + 1], s), roof = c.roof === 'paint';
    for (let k = 0; k < 3; k++) {
      const sw = k === 0 ? sUV : roof ? tUV : k === 1 ? sUV : 'glass';
      if (s > 0) S('core').quad(a[k], b[k], b[k + 1], a[k + 1], sw); else S('core').quad(a[k], a[k + 1], b[k + 1], b[k], sw);
    }
  }
  // a point on the greenhouse side at (z, t): t = 0 at the belt, 1 at the glass top; pushed out by `off`
  const ghPoint = (z, t, s, off) => {
    let i = 0; while (i < nC - 2 && P.cabin[i + 1].z > z) i++;
    const c0 = P.cabin[i], c1 = P.cabin[i + 1], u = Math.min(1, Math.max(0, (c0.z - z) / (c0.z - c1.z)));
    const a = cring(c0, s), b = cring(c1, s), lo = mix(a[0], b[0], u), hi = mix(a[1], b[1], u), p = mix(lo, hi, t);
    const n = cross(sub(hi, lo), [0, 0, 1]); const L = Math.hypot(...n) || 1; const sg = Math.sign(n[0]) === s ? 1 : -1;
    return [p[0] + sg * n[0] / L * off, p[1] + sg * n[1] / L * off, z];
  };
  // ── side glass: one black frame over the whole glazed band, then the three panes (front door, rear door, quarter) ──
  const W = P.windows;
  if (T.windows) for (const s of [1, -1]) {
    // a (z, t) polygon, cut at every cabin station so each piece lies flat on its own span of the greenhouse
    const poly = (pts, off, sw) => { for (let i = 0; i < nC - 1; i++) {
      const piece = clipZ(clipZ(pts, P.cabin[i].z, -1), P.cabin[i + 1].z, 1);
      if (piece.length >= 3) S('core').face(piece.map(([z, t]) => ghPoint(z, t, s, off)), sw, [s, 0.3, 0]);
    } };
    if (T.windows === true) { poly(W.frame, 0.006, 'roofblack'); for (const pane of W.panes) poly(pane, 0.011, 'glass'); }
    else poly(W.frame, 0.008, 'glass'); // LOD2: one glazed band
  }

  // ── bays (dark, inside the shell; seen only when a panel is gone) ──
  // (a box at LOD0/1; at LOD2 its two big faces only)
  const bay = (cx, cy, cz, sx, sy, sz) => { if (T.bayBoxes) { S('core').box(cx, cy, cz, sx, sy, sz, 'bay'); return; }
    for (const e of [-1, 1]) S('core').face([[cx - sx / 2, cy - sy / 2, cz + e * sz / 2], [cx + sx / 2, cy - sy / 2, cz + e * sz / 2], [cx + sx / 2, cy + sy / 2, cz + e * sz / 2], [cx - sx / 2, cy + sy / 2, cz + e * sz / 2]], 'bay', [0, 0, e]); };
  { const hwA = lerpCurve(P.hw, zA) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zA)) / 2 - 0.02, zA + 0.03, hwA * 2, lerpCurve(P.ySh, zA) - 0.36, 0.06); } // firewall
  { const hwC = lerpCurve(P.hw, zC) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zC)) / 2 - 0.02, zC - 0.03, hwC * 2, lerpCurve(P.ySh, zC) - 0.36, 0.06); } // rear bulkhead
  for (const s of [1, -1]) { const x = s * (lerpCurve(P.hw, 0) - 0.07); S('core').quad(...(s > 0 ? [[x, 0.3, zA], [x, 0.3, zC], [x, 1.05, zC], [x, 1.02, zA]] : [[x, 0.3, zC], [x, 0.3, zA], [x, 1.02, zA], [x, 1.05, zC]]), 'bay'); }

  // ── flared wheel arches: a band round each arch cut, standing proud of the side by P.flare.out at its lip (always clear
  // of the tyre), its outer edge flush with the body P.flare.w further out (front arch: part front; rear arch: part back) ──
  if (T.flare) for (const [zc, id] of [[P.zFA, 'front'], [P.zRA, 'back']]) for (const s of [1, -1]) {
    const So = S(id), n = T.flare, Fw = P.flare.w, Fo = P.flare.out, ht = P.archTop - P.archBase;
    const E = [], Ep = [], O = [], Ei = [];
    for (let i = 0; i < n; i++) {
      const th = Math.PI * i / (n - 1), z = zc + P.archR * Math.cos(th), y = P.archBase + ht * Math.sin(th);
      // the outer edge stops at the part's cut line, so the front (back) part ends at its hinge at every LOD
      const zo0 = zc + (P.archR + Fw) * Math.cos(th), zo = id === 'front' ? Math.max(zo0, zA) : Math.min(zo0, zC), yo = P.archBase + (ht + Fw) * Math.sin(th);
      const x = skinX(z, Math.max(y, lerpCurve(P.yBot, z) + P.skirt), s);
      E.push([x, y, z]); Ep.push([s * Math.max(Math.abs(x) + Fo, P.track + P.wheelW / 2 + 0.02), y, z]); Ei.push([x - s * 0.05, y, z]); O.push([skinX(zo, yo, s) + s * 0.004, yo, zo]);
    }
    for (let i = 0; i < n - 1; i++) {
      const th = Math.PI * (i + 0.5) / (n - 1);
      So.face([Ep[i], Ep[i + 1], O[i + 1], O[i]], sUV, [s, 0.6 * Math.sin(th), 0.6 * Math.cos(th)]); // the proud face
      if (T.flareLip) So.face([Ei[i], Ei[i + 1], Ep[i + 1], Ep[i]], 'trim', [0, -Math.sin(th), -Math.cos(th)]); // the lip's underside
    }
    if (T.flareEnds) for (const i of [0, n - 1]) So.face([Ei[i], Ep[i], O[i]], sUV, [0, -0.2, i === 0 ? 1 : -1]);
  }

  // ── bonnet (part: front): the power bulge, a raised trapezoid that fades out toward the nose, carrying the stripes ──
  const F = S('front');
  if (T.bulge) { const G = P.bulge, steps = [G.z1, (G.z0 + G.z1) / 2, G.z0], tH = (z) => G.h * Math.min(1, (G.z0 - z) / (G.z0 - G.z1) * 1.6);
    const sec = (z) => { const y = lerpCurve(P.yCr, z) - 0.004, h = tH(z); return [[-G.hw, y, z], [-G.hw + 0.1, y + h, z], [G.hw - 0.1, y + h, z], [G.hw, y, z]]; };
    for (let i = 0; i < steps.length - 1; i++) { const a = sec(steps[i]), b = sec(steps[i + 1]); for (let k = 0; k < 3; k++) F.quad(a[k], a[k + 1], b[k + 1], b[k], tUV); }
    const r = sec(G.z1); F.quad(r[0], r[3], r[2], r[1], tUV); } // the bulge's back face, at the windscreen
  // the two louvred vents either side of the bulge: a black well, a painted surround, louvres across it (a decal at LOD2)
  if (T.vents >= 0) for (const s of [1, -1]) {
    const V = P.vents, xc = s * V.x, z0 = V.z + V.l / 2, z1 = V.z - V.l / 2, k = V.skew * s;
    const corner = (u, v) => { const x = xc + u * V.w / 2 + v * k, z = V.z + v * V.l / 2; return [x, deckY(x, z) + 0.006, z]; };
    const well = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
    F.face(well, 'grille', [0, 1, 0]);
    for (let i = 0; i < T.vents; i++) { // a louvre: a thin bar across the well, its top lit
      const v = 1 - 2 * (i + 0.5) / T.vents, a = corner(-0.92, v), b = corner(0.92, v);
      F.solid([[a, b, [b[0], b[1] + 0.022, b[2] - 0.02], [a[0], a[1] + 0.022, a[2] - 0.02]], [[a[0], a[1], a[2] - 0.035], [b[0], b[1], b[2] - 0.035], [b[0], b[1] + 0.022, b[2] - 0.02], [a[0], a[1] + 0.022, a[2] - 0.02]], [a, b, [b[0], b[1], b[2] - 0.035], [a[0], a[1], a[2] - 0.035]]], 'trim');
    }
    void z0; void z1;
  }

  // ── front fascia (part: front): measured off the sheet's front view, (x, y) in metres, projected onto the nose ──
  const Fr = P.front, ybN = lerpCurve(P.yBot, P.zNose);
  // the twin stripes run down the nose to the bumper
  for (const s of [1, -1]) decal(F, s > 0 ? Fr.stripe : mirrorX(Fr.stripe), 'stripe', 0.004 + T.lampOff, 1);
  // the black upper grille: a long hexagon between the lamps, framed in trim
  decal(F, Fr.grille, 'trim', 0.006, 1);
  decal(F, Fr.grilleIn, 'grille', 0.009, 1);
  // the big lower intake, its mesh drawn as horizontal bars at LOD0
  decal(F, Fr.intake, 'grille', 0.006, 1);
  for (let i = 0; i < T.intakeBars; i++) { const [y0, y1] = [Fr.intake[3][1], Fr.intake[0][1]], y = y0 + (y1 - y0) * (i + 1) / (T.intakeBars + 1), w = Math.abs(Fr.intake[2][0]) - 0.03;
    decal(F, [[-w, y - 0.008], [w, y - 0.008], [w, y + 0.008], [-w, y + 0.008]], 'trim', 0.01, 1); }
  // the swept headlamps: a dark rim and the lamp itself, wrapping round the corner onto the wing
  both((s, m) => {
    decal(F, m(Fr.lamp), 'head', 0.01 + T.lampOff, 1, T.lampCell);
  });
  // the bumper corners: vertical LED slots in black surrounds
  if (T.slots) both((s, m) => { decal(F, m(Fr.slotBox), 'grille', 0.006, 1); decal(F, m(Fr.slot), 'led', 0.01, 1); });
  // the splitter: a wide black plate under the nose
  if (T.splitter) { const hwN = lerpCurve(P.hw, P.zNose); F.box(0, ybN - 0.01, P.zNose - 0.14, (hwN + Fr.splitterOut) * 2, 0.04, 0.36, 'trim'); }

  // ── side skirts (core) ──
  if (T.skirts) for (const s of [1, -1]) { const za = P.zFA - P.archR - P.flare.w, zb = P.zRA + P.archR + P.flare.w, x = s * (lerpCurve(P.hw, 0) + 0.015), y0 = lerpCurve(P.yBot, 0) + 0.02;
    S('core').box(x, y0 + 0.05, (za + zb) / 2, 0.06, 0.10, za - zb, 'trim'); }
  // door handles: small black slots on each door
  if (T.handles) for (const s of [1, -1]) for (const [z, door] of [[P.handles.zF, 'door_F'], [P.handles.zR, 'door_R']]) {
    const y = P.handles.y, x = skinX(z, y, s) + s * 0.005;
    S(door + (s > 0 ? 'L' : 'R')).face([[x, y - 0.018, z + 0.07], [x, y - 0.018, z - 0.07], [x, y + 0.018, z - 0.07], [x, y + 0.018, z + 0.07]], 'trim', [s, 0, 0]);
  }
  // door seams: thin dark strips on the door edges
  if (T.seams) for (const s of [1, -1]) for (const z of [zA - 0.012, P.zB, zC + 0.012]) {
    const x = s * (lerpCurve(P.hw, z) + 0.003), y0 = Math.max(lerpCurve(P.yBot, z) + P.skirt, archY(z)) + 0.02, y1 = lerpCurve(P.ySh, z) - P.sideDrop - 0.01;
    S('core').face([[x, y0, z + 0.008], [x, y0, z - 0.008], [x, y1, z - 0.008], [x, y1, z + 0.008]], 'trim', [s, 0, 0]);
  }

  // ── rear (part: back): measured off the sheet's rear view, projected onto the tail ──
  const Bk = S('back'), zt = P.zTail, Rr = P.rear;
  for (const s of [1, -1]) decal(Bk, s > 0 ? Rr.stripe : mirrorX(Rr.stripe), 'stripe', 0.004 + T.lampOff, -1);
  // the tail lamps: a red lamp, its smoked centre, wrapping onto the quarter
  both((s, m) => {
    decal(Bk, m(Rr.lamp), 'tail', 0.008 + T.lampOff, -1, T.lampCell);
    if (T.lamps === 'full') decal(Bk, m(Rr.lampIn), 'taildk', 0.012 + T.lampOff, -1, T.lampCell);
  });
  // the black diffuser hanging under the bumper, with fins, and four chrome tail pipes in two pairs
  { const D = Rr.diffuser, hwT = lerpCurve(P.hw, zt);
    Bk.solid([[[-D.w, D.y0, zt - 0.01], [D.w, D.y0, zt - 0.01], [D.w, D.y1, zt - 0.01], [-D.w, D.y1, zt - 0.01]], [[-D.w, D.y0 + 0.03, zt + D.l], [D.w, D.y0 + 0.03, zt + D.l], [D.w, D.y1, zt + D.l], [-D.w, D.y1, zt + D.l]]], 'under');
    for (let i = 0; i < T.diffFins; i++) { const x = Rr.finX[i % Rr.finX.length] * (i < Rr.finX.length ? 1 : -1), w = 0.012, d = 0.05, y0 = D.y0 + 0.02, y1 = D.y1 - 0.02;
      Bk.solid([[[x - w, y0, zt - 0.01], [x - w, y1, zt - 0.01], [x - w, y1, zt - 0.01 - d * 0.5], [x - w, y0, zt - 0.01 - d]], [[x + w, y0, zt - 0.01], [x + w, y1, zt - 0.01], [x + w, y1, zt - 0.01 - d * 0.5], [x + w, y0, zt - 0.01 - d]]], 'trim'); }
    for (const s of [1, -1]) for (const x of Rr.pipeX) {
      const c = [s * x, Rr.pipeY, zt - 0.01], r0 = Rr.pipeR;
      if (T.exhaust === 'rings') {
        const n = 8, ring2 = (rr, dz) => Array.from({ length: n }, (_, i) => { const a = Math.PI * 2 * (i + 0.5) / n; return [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, c[2] - dz]; });
        const o = ring2(r0, 0.05), o0 = ring2(r0, 0), inn = ring2(r0 * 0.7, 0.05), deep = ring2(r0 * 0.7, 0.02);
        for (let i = 0; i < n; i++) { const j = (i + 1) % n;
          Bk.face([o0[i], o0[j], o[j], o[i]], 'chrome', sub(mix(o[i], o[j], 0.5), [c[0], c[1], c[2] - 0.05])); // the pipe
          Bk.face([o[i], o[j], inn[j], inn[i]], 'chrome', [0, 0, -1]); } // its rim
        Bk.face(deep, 'under', [0, 0, -1]); // and its dark bore
      } else if (T.exhaust === 'flat') Bk.face([[c[0] - r0, c[1] - r0, c[2] - 0.004], [c[0] + r0, c[1] - r0, c[2] - 0.004], [c[0] + r0, c[1] + r0, c[2] - 0.004], [c[0] - r0, c[1] + r0, c[2] - 0.004]], 'chrome', [0, 0, -1]);
    }
    void hwT; }
  // the wing: a body-colour blade on two short black posts, its tips turned down (a plain plate on the deck at LOD2)
  { const SP = P.spoiler, xs = SP.span * SP.postX;
    Bk.box(0, SP.y, SP.z, SP.span * 2, 0.035, SP.chord, { all: 'trim', py: tUV, pz: sUV, nz: sUV }, [SP.tilt, 0, 0]);
    if (T.tips) for (const s of [1, -1]) Bk.decor(() => Bk.solid([
      [[s * SP.span, SP.y + 0.015, SP.z + SP.chord / 2], [s * SP.span, SP.y + 0.015, SP.z - SP.chord / 2], [s * (SP.span + 0.05), SP.y - SP.tipDrop, SP.z - SP.chord / 2 + 0.03], [s * (SP.span + 0.05), SP.y - SP.tipDrop, SP.z + SP.chord / 2 - 0.05]],
      [[s * SP.span, SP.y - 0.02, SP.z + SP.chord / 2], [s * SP.span, SP.y - 0.02, SP.z - SP.chord / 2], [s * (SP.span + 0.035), SP.y - SP.tipDrop - 0.01, SP.z - SP.chord / 2 + 0.03], [s * (SP.span + 0.035), SP.y - SP.tipDrop - 0.01, SP.z + SP.chord / 2 - 0.05]],
    ], sUV));
    if (T.wing === 'posts') for (const s of [1, -1]) { const x = s * xs, deck = deckY(x, SP.z); Bk.beam([x, deck - 0.01, SP.z + 0.02], [x, SP.y, SP.z], 0.035, 0.07, 'trim', [1, 0, 0]); }
  }

  // ── mirrors (core: they stay with the greenhouse): big black angular heads on short stalks at the front of the side glass ──
  const M = P.mirror; // decoration: the collider stays the body's width
  for (const s of [1, -1]) S('core').decor(() => {
    const xb = skinX(M.z, M.y - 0.04, s), x0 = xb + s * M.stalk, x1 = x0 + s * M.out;
    if (T.mirrors === 'box') { S('core').box((xb + x1) / 2, M.y, M.z, Math.abs(x1 - xb), M.h, M.l, 'roofblack'); return; }
    S('core').beam([xb - s * 0.02, M.y - 0.045, M.z + 0.02], [x0 + s * 0.01, M.y - 0.02, M.z], 0.03, 0.05, 'roofblack', [0, 0, 1]);
    const f = (x, k) => [[x, M.y - M.h / 2, M.z + M.l / 2 * k], [x, M.y + M.h / 2, M.z + M.l / 2 * k - 0.01], [x, M.y + M.h / 2, M.z - M.l / 2], [x, M.y - M.h / 2 + 0.02, M.z - M.l / 2]];
    const a = f(x0, 1), b = f(x1, 0.4);
    S('core').solid([a, b, ...a.map((p, i) => [p, a[(i + 1) % 4], b[(i + 1) % 4], b[i]])], 'roofblack');
  });

  // ── wheels: a tyre (tread, sidewall ring, inner cap), a dark barrel behind the rim lip, five broad spokes and a hub;
  // LOD1/2 draw the spokes flat on the barrel. The tyre's circumradius makes its inscribed radius wheelR, so the bottom
  // flat touches the ground. ──
  const n = T.wheelSeg, tyreR = P.wheelR / Math.cos(Math.PI / n), rimR = P.wheelR * P.rim.r, depth = P.rim.depth;
  for (const [id, zc, s] of [['wheel_FL', P.zFA, 1], ['wheel_FR', P.zFA, -1], ['wheel_RL', P.zRA, 1], ['wheel_RR', P.zRA, -1]]) {
    const Wh = S(id), xw = s * P.track, xo = xw + s * P.wheelW / 2, xi = xw - s * P.wheelW / 2, yc = P.wheelR;
    const ringAt = (x, r, k = n, ph = 1.5 * Math.PI - Math.PI / k) => Array.from({ length: k }, (_, i) => { const a = ph + (i / k) * Math.PI * 2; return [x, yc + Math.sin(a) * r, zc + Math.cos(a) * r]; });
    const to = ringAt(xo, tyreR), ti = ringAt(xi, tyreR);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([ti[i], ti[j], to[j], to[i]], 'tyre', sub(mix(to[i], to[j], 0.5), [xo, yc, zc])); }
    if (T.tyreCap) Wh.face(ti, 'tyre', [-s, 0, 0]);
    const ro = ringAt(xo, rimR), rd = ringAt(xo - s * depth, rimR);
    if (T.rim === 'spokes') {
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([to[i], to[j], ro[j], ro[i]], 'tyre', [s, 0, 0]); } // sidewall
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([ro[i], ro[j], rd[j], rd[i]], 'rim', sub([xo, yc, zc], mix(ro[i], ro[j], 0.5))); } // the rim lip, facing in
      Wh.face(rd, 'under', [s, 0, 0]); // the dark barrel
    } else { Wh.face(to, 'tyre', [s, 0, 0]); Wh.face(ringAt(xo + s * 0.003, rimR, Math.min(n, 8)), 'under', [s, 0, 0]); } // a flat sidewall, the barrel drawn on it
    const hubR = P.rim.hubR, xf = T.rim === 'spokes' ? xo - s * 0.008 : xo + s * 0.006;
    for (let k = 0; k < 5; k++) { // a spoke: a tapered blade from the hub to the lip, its face and (LOD0) two sides
      const a = Math.PI / 2 + k * Math.PI * 2 / 5, ca = Math.cos(a), sa = Math.sin(a), pc = -sa, ps = ca;
      const P0 = (r, w, x) => [x, yc + sa * r + ps * w, zc + ca * r + pc * w];
      const w0 = P.rim.spokeW, w1 = P.rim.spokeW * 0.8, rr = rimR - 0.004;
      const fr = [P0(hubR * 0.8, -w0, xf), P0(rr, -w1, xf), P0(rr, w1, xf), P0(hubR * 0.8, w0, xf)];
      Wh.face(fr, 'rim', [s, 0, 0]);
      if (T.rim === 'spokes') { const xb = xo - s * depth * 0.55; for (const e of [-1, 1]) Wh.face([P0(hubR * 0.8, e * w0, xf), P0(rr, e * w1, xf), P0(rr, e * w1, xb), P0(hubR * 0.8, e * w0, xb)], 'trim', [0, ps * e, pc * e]); }
    }
    if (T.hub) { const hub = ringAt(xf + s * 0.014, hubR, 5, Math.PI / 2); Wh.face(hub, 'rim', [s, 0, 0]);
      const hb = ringAt(xf - s * 0.01, hubR, 5, Math.PI / 2); for (let i = 0; i < 5; i++) { const j = (i + 1) % 5; Wh.face([hb[i], hb[j], hub[j], hub[i]], 'trim', sub(mix(hub[i], hub[j], 0.5), [hub[i][0], yc, zc])); } }
  }

  // ── interior blocks (P1-V03): what a missing panel shows, in vehicle space, the same at every LOD. Drawn only for a
  // car whose part exposes them (vehicle.json `interiors`), so an undamaged field never pays for them. ──
  { const I = S('interior_engine'), zm = (zA + P.zNose) / 2; // under the front piece
    I.box(0, 0.6, zm, 0.95, 0.4, 0.7, 'chrome'); I.box(0, 0.86, zm - 0.05, 0.6, 0.12, 0.45, { all: 'trim', py: 'chrome' }); }
  { const I = S('interior_cabin'); // behind the doors: two front seats and the rear bench
    for (const s of [1, -1]) I.box(s * 0.42, 0.72, (zA + P.zB) / 2 - 0.12, 0.5, 0.62, 0.5, 'trim');
    I.box(0, 0.7, (P.zB + zC) / 2 - 0.1, 1.3, 0.56, 0.48, 'trim'); }
  { const I = S('interior_boot'), zm = (zC + P.zTail) / 2; // under the back piece: the spare and a toolbox
    I.box(0.25, 0.52, zm, 0.56, 0.2, 0.56, 'tyre'); I.box(-0.45, 0.55, zm, 0.4, 0.25, 0.5, 'stripe'); }

  return { soups, stations: Z.length };
}

// Each part's pivot is its hinge line (P1-V03, plan §6.3): a loose part turns about its hinge axis through the pivot.
// Doors: the front edge on the outer skin (they swing out 0–70° like a real door). Front and back: their top edge where
// they meet the body, at the shoulder line on the cut (they hang 0–25°). Wheels: the hub (±6° camber wobble). Core:
// the vehicle origin. Measured on LOD0, because the contract wants one pivot per part at every LOD.
export function pivots(P) {
  const out = {};
  for (const [id, so] of Object.entries(makeSoups(P, 0).soups)) out[id] = pivotOf(P, id, so.p);
  return out;
}

function pivotOf(P, id, positions) {
  if (id === 'core' || id.startsWith('interior_')) return [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]); }
  if (id.startsWith('wheel')) return [Math.sign(hi[0] + lo[0]) * P.track, P.wheelR, id[6] === 'F' ? P.zFA : P.zRA];
  const mid = (k) => (lo[k] + hi[k]) / 2;
  if (id.startsWith('door')) return [mid(0) > 0 ? hi[0] : lo[0], mid(1), hi[2]]; // +X is the car's left
  const zA = P.zFA - P.archR, zC = P.zRA + P.archR;
  if (id === 'front') return [0, lerpCurve(P.ySh, zA), lo[2]];
  if (id === 'back') return [0, lerpCurve(P.ySh, zC), hi[2]];
  return [mid(0), mid(1), mid(2)];
}

/** Plain per-part triangle soups for the bake: { parts: { id: { pivot, positions (part space), uvs (v up), tris, noCollide? } } }
 *  (noCollide: [first, end) vertex ranges of decoration the collider leaves out). */
export function soups(P, lod = 0) {
  const { soups: raw, stations } = makeSoups(P, lod), pv = pivots(P), parts = {};
  for (const [id, so] of Object.entries(raw)) {
    const pivot = pv[id];
    parts[id] = { pivot, positions: so.p.map((v, i) => v - pivot[i % 3]), uvs: so.uv.slice(), tris: so.tris, ...(so.nc.length ? { noCollide: so.nc } : {}) };
  }
  return { parts, stations };
}

/** The car as a three.js group: one Mesh per part, positioned at its pivot (userData.rest). */
export function build(P, lod = 0) {
  const { parts: soup, stations } = soups(P, lod);
  const group = new THREE.Group(); group.name = 'hawk-dash'; const parts = {}; let tris = 0; const breakdown = {};
  for (const [id, part] of Object.entries(soup)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g); mesh.name = id; mesh.position.fromArray(part.pivot); mesh.userData.rest = part.pivot.slice(); mesh.castShadow = true;
    group.add(mesh); parts[id] = mesh; tris += part.tris; breakdown[id] = part.tris;
  }
  return { group, parts, stats: { tris, draws: Object.keys(parts).length, breakdown, stations } };
}
