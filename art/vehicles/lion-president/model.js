// model.js: the low-poly Lion President built from code (R81, R123, br-bwju.3): a caricatured Australian V8 sedan in the
// spirit of the last V8 Commodore (SS-V Redline). Same spec and handling as the Hawk Dash, a different body.
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs). P comes from params.json, fitted to refs/lod-plus-1.png with tools/vehicles/fit (silhouette
// IoU in docs/evidence/br-bwju.3/).
//
// Frame: metres, +Z = nose, +Y up, origin on the ground between the axles (jj.vehicle.v1). +X is the car's LEFT, so door_FL
// and wheel_FL sit on +X. The driver sits on the right (cam_fp at −X).
//
// The body is the Cruz Missile's construction (two flat-shaded lofts, tub + greenhouse, sampled from smooth curves in P);
// what makes it a Lion is its own proportions (shorter and stubbier than the Hawk, a steep short rear window) and details:
// two big forward-facing bonnet nostril scoops, a slim upper grille over a very wide lower grille split by one thick bar,
// sharp angular headlamps with LED fang strips under them, vertical slatted air curtains in the bumper corners, side
// skirts, a tall boot wing on two posts with endplates, slim full-width tail lamps, a black diffuser with quad exhausts
// at the corners, red calipers, the gloss-black roof and the black-and-gold shoulder pinstripe (atlas).
// LOD changes only the sampling density and which details exist; part names and pivots are identical at every LOD.
// Damage parts: front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; everything else is core.
import * as THREE from 'three';
import { swatchUV, REGION, SPAN } from './atlas.js';

export const LODS = {
  0: { arch: 7, nose: 2, curvePts: true, merge: 0.08, doorMid: true, wheelSeg: 12, rim: 5, mirrors: 'shaped', spoiler: 'full', scoops: 'full', curtains: 3, exhaust: 'pipes', seams: true, splitter: true, skirts: true, calipers: true },
  1: { arch: 5, nose: 1, curvePts: true, merge: 0.2, doorMid: true, wheelSeg: 8, rim: 5, mirrors: 'box', spoiler: 'full', scoops: 'full', curtains: 0, exhaust: 'flat', seams: false, splitter: true, skirts: true, calipers: false },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, wheelSeg: 8, rim: 0, mirrors: 'box', spoiler: 'plate', scoops: 'flat', curtains: 0, exhaust: 'none', seams: false, splitter: false, skirts: false, calipers: false },
};

const lerpCurve = (pts, z) => {
  if (z >= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (z >= pts[i][0]) { const [z0, a] = pts[i - 1], [z1, b] = pts[i]; return b + (a - b) * (z - z1) / (z0 - z1); }
  return pts[pts.length - 1][1];
};

// ───────────────────────── triangle soup builder (non-indexed → flat shading) ─────────────────────────
class Soup {
  constructor() { this.p = []; this.uv = []; this.c = []; }
  tri(a, b, c, uv, col = 1) {
    // uv: swatch name, or a function (vertex) → [u,v]
    for (const v of [a, b, c]) {
      this.p.push(v[0], v[1], v[2]);
      const t = typeof uv === 'string' ? swatchUV(uv) : uv(v);
      this.uv.push(t[0], t[1]); this.c.push(col, col, col);
    }
  }
  quad(a, b, c, d, uv, col) { this.tri(a, b, c, uv, col); this.tri(a, c, d, uv, col); }
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
  // prism along an axis: n-gon radius r, from a to b (used for wheels, aerial, posts)
  prism(a, b, r, n, swSide, swCap, phase = 0, r2 = r) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), ax = B.clone().sub(A).normalize();
    const u = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(ax).normalize() : new THREE.Vector3(1, 0, 0).cross(ax).normalize(), w = ax.clone().cross(u);
    const ring = (C, rr) => Array.from({ length: n }, (_, i) => { const t = phase + (i / n) * Math.PI * 2; return C.clone().addScaledVector(u, Math.cos(t) * rr).addScaledVector(w, Math.sin(t) * rr).toArray(); });
    const ra = ring(A, r), rb = ring(B, r2);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(ra[i], ra[j], rb[j], rb[i], swSide); }
    if (swCap) for (let i = 1; i < n - 1; i++) { this.tri(ra[0], ra[i + 1], ra[i], swCap); this.tri(rb[0], rb[i], rb[i + 1], swCap); }
  }
  // polygon in the (z, y) plane (counter-clockwise seen from +X), extruded from x0 to x1 (x0 < x1)
  slab(poly, x0, x1, swSide, swFace, swFace2 = swFace) {
    const n = poly.length, A = poly.map(([z, y]) => [x0, y, z]), B = poly.map(([z, y]) => [x1, y, z]);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(A[i], A[j], B[j], B[i], swSide); }
    for (let i = 1; i < n - 1; i++) { this.tri(B[0], B[i], B[i + 1], swFace); this.tri(A[0], A[i + 1], A[i], swFace2); }
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
  const ring = (z, s) => {
    const yb = lerpCurve(P.yBot, z), ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), hw = lerpCurve(P.hw, z);
    const ay = archY(z), lift = ay > 0 ? Math.max(yb, ay) : yb;
    const y2 = Math.max(lift + 0.03, yb + P.skirt), y3 = Math.max(y2 + 0.06, ysh - P.sideDrop);
    return [[0, yb, z], [s * (hw - P.floorIn), lift, z], [s * hw, y2, z], [s * hw, y3, z], [s * (hw - P.shoulderIn), ysh, z], [0, ycr, z]];
  };

  const soups = {}; const S = (id) => (soups[id] ??= new Soup());
  const partOfTub = (zm, seg, s) => {
    if (zm > zA + 1e-6) return 'front';
    if (zm < zC - 1e-6) return 'back';
    if (seg >= 1 && seg <= 3) return (zm > P.zB ? 'door_F' : 'door_R') + (s > 0 ? 'L' : 'R'); // +X is the car's left
    return 'core';
  };
  const sUV = sideUV(P), tUV = topUV(P);
  const segSwatch = (seg, zm, isArch) => {
    if (seg === 0) return 'under';
    if (seg === 1) return isArch ? 'trim' : 'trim';
    if (seg === 4) return tUV;
    return sUV; // 2, 3: side skin with livery (seg 3 = shoulder chamfer carries livery too)
  };
  for (const s of [1, -1]) {
    for (let i = 0; i < Z.length - 1; i++) {
      const a = ring(Z[i], s), b = ring(Z[i + 1], s), zm = (Z[i] + Z[i + 1]) / 2, isArch = archY(Z[i]) > 0 || archY(Z[i + 1]) > 0;
      for (let k = 0; k < 5; k++) {
        const so = S(partOfTub(zm, k, s));
        const uv = k === 3 ? sUV : segSwatch(k, zm, isArch);
        // winding: outward normals. ring order goes bottom→top on side s; for s>0 use (a_k, b_k, b_k+1, a_k+1)
        if (s > 0) so.quad(a[k], b[k], b[k + 1], a[k + 1], uv); else so.quad(a[k], a[k + 1], b[k + 1], b[k], uv);
      }
    }
  }
  // end caps: nose (front) and tail (back) — fan over both sides' rings
  const cap = (z, id, sign, sw) => {
    // polygon: floor centre, right side up, crown, left side down
    const R = ring(z, 1), Lr = ring(z, -1); const poly = [R[0], R[1], R[2], R[3], R[4], R[5], Lr[4], Lr[3], Lr[2], Lr[1]];
    const c = [0, poly.reduce((t, v) => t + v[1], 0) / poly.length, z];
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; if (sign > 0) S(id).tri(c, p, q, sw); else S(id).tri(c, q, p, sw); }
  };
  cap(P.zNose, 'front', 1, 'paint'); cap(P.zTail, 'back', -1, 'paint');

  // greenhouse: ring per cabin station, one side: base(belt) → glass top → roof edge → crown
  const cring = (c, s) => { const yb = lerpCurve(P.ySh, c.z) - 0.005, collapsed = c.yr == null, yr = collapsed ? lerpCurve(P.yCr, c.z) - 0.005 : c.yr, ch = collapsed ? 0 : P.roofCh;
    return [[s * c.wb, yb, c.z], [s * c.wt, collapsed ? yb : yr - ch, c.z], [s * (c.wt - ch * 1.2) * (collapsed ? 0.5 : 1), yr, c.z], [0, yr + (collapsed ? 0 : P.roofCrown), c.z]]; };
  const nC = P.cabin.length;
  for (const s of [1, -1]) for (let i = 0; i < nC - 1; i++) {
    const c = P.cabin[i], a = cring(c, s), b = cring(P.cabin[i + 1], s);
    for (let k = 0; k < 3; k++) {
      const sw = k === 0 ? (c.side === 'paint' ? sUV : c.side) : c.roof === 'paint' ? 'roofblack' : c.roof; // the gloss-black roof
      if (s > 0) S('core').quad(a[k], b[k], b[k + 1], a[k + 1], sw); else S('core').quad(a[k], a[k + 1], b[k + 1], b[k], sw);
    }
    // the B-pillar: a black strip across the side glass at the door cut, so the greenhouse reads as two windows
    if (P.cabin[i].z >= P.zB && P.cabin[i + 1].z < P.zB && c.side === 'glass') {
      const t = (c.z - P.zB) / (c.z - P.cabin[i + 1].z), at = (k) => a[k].map((v, j) => v + (b[k][j] - v) * t), o = s * 0.006;
      const lo = at(0), hi = at(1), w = 0.05, q = [[lo[0] + o, lo[1], lo[2] + w], [lo[0] + o, lo[1], lo[2] - w], [hi[0] + o, hi[1], hi[2] - w], [hi[0] + o, hi[1], hi[2] + w]];
      if (s > 0) S('core').quad(q[0], q[1], q[2], q[3], 'roofblack'); else S('core').quad(q[0], q[3], q[2], q[1], 'roofblack');
    }
  }

  // ── bays (dark, inside the shell; seen only when a panel is gone) ──
  const bay = (cx, cy, cz, sx, sy, sz) => S('core').box(cx, cy, cz, sx, sy, sz, 'bay');
  { const hwA = lerpCurve(P.hw, zA) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zA)) / 2 - 0.02, zA + 0.03, hwA * 2, lerpCurve(P.ySh, zA) - 0.36, 0.06); } // firewall
  { const hwC = lerpCurve(P.hw, zC) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zC)) / 2 - 0.02, zC - 0.03, hwC * 2, lerpCurve(P.ySh, zC) - 0.36, 0.06); } // rear bulkhead
  for (const s of [1, -1]) { const x = s * (lerpCurve(P.hw, 0) - 0.07); S('core').quad(...(s > 0 ? [[x, 0.3, zA], [x, 0.3, zC], [x, 1.05, zC], [x, 1.02, zA]] : [[x, 0.3, zC], [x, 0.3, zA], [x, 1.02, zA], [x, 1.05, zC]]), 'bay'); }

  // ── bonnet (part: front): two big forward-facing nostril scoops, gloss black, open mouths facing the nose ──
  const F = S('front');
  { const N = P.scoops;
    for (const s of [1, -1]) {
      const x = s * N.x, z0 = N.z, z1 = N.z - N.l, y0 = lerpCurve(P.yCr, z0) - 0.01, y1 = lerpCurve(P.yCr, z1) - 0.01;
      if (T.scoops === 'flat') { F.quad([x - N.w / 2, y0 + 0.012, z0], [x + N.w / 2, y0 + 0.012, z0], [x + N.w / 2, y1 + 0.012, z1], [x - N.w / 2, y1 + 0.012, z1], 'roofblack'); continue; } // a flat black decal at LOD2
      // a wedge: flush at the back, N.h tall at the front, with a dark mouth on its front face
      const a = [x - N.w / 2, y1, z1], b = [x + N.w / 2, y1, z1], c = [x + N.w / 2, y0 + N.h, z0], d = [x - N.w / 2, y0 + N.h, z0], e = [x + N.w / 2, y0, z0], f = [x - N.w / 2, y0, z0];
      F.quad(a, d, c, b, 'roofblack'); // top
      F.tri(b, c, e, 'roofblack'); F.tri(a, f, d, 'roofblack'); // sides
      F.quad(f, e, c, d, 'grille'); // the mouth
    } }

  // ── front fascia (part: front): every detail sits on the vertical nose face at zn, sized relative to its half-width hwN
  // (the fit narrows the nose; the slope above it is only a few centimetres tall) ──
  const zn = P.zNose + 0.004, hwN = lerpCurve(P.hw, P.zNose);
  const fq = (x0, y0, x1, y1, sw, dz = 0) => F.quad([x0, y0, zn + dz], [x1, y0, zn + dz], [x1, y1, zn + dz], [x0, y1, zn + dz], sw);
  const ybN = lerpCurve(P.yBot, P.zNose), yTop = lerpCurve(P.ySh, P.zNose);
  fq(-hwN * 0.48, yTop - 0.10, hwN * 0.48, yTop - 0.04, 'grille', 0.002); // slim upper grille
  for (const s of [1, -1]) {
    // sharp angular lamp: a quad whose outer corner sweeps up, and the LED fang hanging under its inner end
    const q = [[0.44, yTop - 0.17], [0.98, yTop - 0.10], [0.98, yTop - 0.005], [0.50, yTop - 0.05]].map(([x, y]) => [s * x * hwN, y, zn + 0.003]);
    if (s > 0) F.quad(q[0], q[1], q[2], q[3], 'head'); else F.quad(q[0], q[3], q[2], q[1], 'head');
    const g = [[0.62, yTop - 0.26], [0.94, yTop - 0.14], [0.70, yTop - 0.155]].map(([x, y]) => [s * x * hwN, y, zn + 0.003]);
    if (s > 0) F.tri(g[0], g[1], g[2], 'led'); else F.tri(g[0], g[2], g[1], 'led');
    // the vertical air curtains in the bumper corners: a dark pocket with slats
    const xa = 0.80 * hwN, xb = 0.98 * hwN, ya = ybN + 0.08, yb = yTop - 0.30;
    fq(Math.min(s * xa, s * xb), ya, Math.max(s * xa, s * xb), yb, 'grille', 0.002);
    for (let i = 0; i < T.curtains; i++) { const x = s * (xa + (xb - xa) * (i + 0.5) / T.curtains); F.box(x, (ya + yb) / 2, zn + 0.01, 0.015, yb - ya, 0.03, 'trim'); }
  }
  // very wide lower grille split by one thick horizontal bar
  { const yb = ybN + 0.06, yt = yTop - 0.30; fq(-hwN * 0.74, yb, hwN * 0.74, yt, 'grille', 0.002); fq(-hwN * 0.76, (yb + yt) / 2 - 0.03, hwN * 0.76, (yb + yt) / 2 + 0.03, 'trim', 0.006); }
  if (T.splitter) F.box(0, ybN + 0.01, P.zNose - 0.04, hwN * 2 + 0.06, 0.04, 0.24, 'trim');

  // ── side skirts (core) ──
  if (T.skirts) for (const s of [1, -1]) { const za = P.zFA - P.archR - 0.02, zb = P.zRA + P.archR + 0.02, x = s * (lerpCurve(P.hw, 0) + 0.015), y0 = lerpCurve(P.yBot, 0) + 0.02;
    S('core').box(x, y0 + 0.05, (za + zb) / 2, 0.06, 0.10, za - zb, 'trim'); }

  // ── rear (part: back) ──
  const Bk = S('back'), zt = P.zTail - 0.004, hwT = lerpCurve(P.hw, P.zTail), yshT = lerpCurve(P.ySh, P.zTail), ybT = P.yBot.at(-1)[1];
  const bq = (x0, y0, x1, y1, sw, dz = 0) => Bk.quad([x1, y0, zt - dz], [x0, y0, zt - dz], [x0, y1, zt - dz], [x1, y1, zt - dz], sw);
  bq(-hwT * 0.99, yshT - 0.16, hwT * 0.99, yshT - 0.02, 'roofblack'); // a black band across the boot
  bq(-hwT * 0.95, yshT - 0.12, hwT * 0.95, yshT - 0.06, 'tail', 0.003); // and the slim full-width lamp in it
  for (const s of [1, -1]) { // and their wrap onto the rear quarters
    const z0 = P.zTail + 0.22, zz = P.zTail + 0.01, x0 = s * (lerpCurve(P.hw, z0) + 0.006), x1 = s * (lerpCurve(P.hw, zz) + 0.006);
    const yh = lerpCurve(P.ySh, zz) - P.sideDrop + 0.02, yl = yh - 0.07;
    if (s > 0) Bk.quad([x0, yl, z0], [x1, yl, zz], [x1, yh, zz], [x0, yh, z0], 'tail'); else Bk.quad([x0, yl, z0], [x0, yh, z0], [x1, yh, zz], [x1, yl, zz], 'tail');
  }
  bq(-hwT * 0.92, ybT, hwT * 0.92, ybT + 0.20, 'under'); // black diffuser
  for (const s of [1, -1]) for (const x of [0.58, 0.72]) { // quad exhausts at the corners
    if (T.exhaust === 'pipes') Bk.prism([s * x, ybT + 0.09, zt + 0.06], [s * x, ybT + 0.09, zt - 0.05], 0.05, 6, 'chrome', 'under');
    else if (T.exhaust === 'flat') bq(s * x - 0.045, ybT + 0.045, s * x + 0.045, ybT + 0.135, 'chrome');
  }
  // the tall wing on two posts, with endplates (a plain plate at LOD2)
  { const SP = P.spoiler, deck = lerpCurve(P.yCr, SP.z);
    Bk.box(0, SP.y, SP.z, SP.span * 2, 0.04, SP.chord, 'roofblack', [SP.tilt, 0, 0]);
    for (const s of [1, -1]) Bk.box(s * SP.span * 0.6, (deck + SP.y) / 2, SP.z + 0.03, 0.05, SP.y - deck, 0.09, 'trim', [-0.2, 0, 0]);
    if (T.spoiler === 'full') for (const s of [1, -1]) Bk.box(s * SP.span, SP.y + 0.02, SP.z - 0.02, 0.03, 0.16, SP.chord + 0.08, 'roofblack'); }

  // ── mirrors (core: they stay with the greenhouse): black ──
  const M = P.mirror;
  for (const s of [1, -1]) {
    const x = s * (lerpCurve(P.hw, M.z) - 0.05 + M.out / 2);
    S('core').box(x, M.y, M.z, M.out, M.h, M.l, 'roofblack', T.mirrors === 'shaped' ? [0, s * 0.15, 0] : null);
  }
  // door seams (L0): thin dark strips on the door edges
  if (T.seams) for (const s of [1, -1]) for (const z of [zA - 0.012, P.zB, zC + 0.012]) {
    const x = s * (lerpCurve(P.hw, z) + 0.003), y0 = lerpCurve(P.yBot, z) + P.skirt + 0.02, y1 = lerpCurve(P.ySh, z) - 0.05;
    S('core').quad(...(s > 0 ? [[x, y0, z + 0.008], [x, y0, z - 0.008], [x, y1, z - 0.008], [x, y1, z + 0.008]] : [[x, y0, z - 0.008], [x, y0, z + 0.008], [x, y1, z + 0.008], [x, y1, z - 0.008]]), 'trim');
  }

  // ── wheels: tyre prism + rim disc (5-gon, reads as a 5-spoke at low res) ──
  // The tyre's circumradius makes its inscribed radius wheelR, so the bottom flat (phase π/n) touches the ground.
  const tyreR = P.wheelR / Math.cos(Math.PI / T.wheelSeg);
  for (const [id, z, s] of [['wheel_FL', P.zFA, 1], ['wheel_FR', P.zFA, -1], ['wheel_RL', P.zRA, 1], ['wheel_RR', P.zRA, -1]]) {
    const W = S(id), x = s * P.track, hw = P.wheelW / 2;
    W.prism([x - s * hw, P.wheelR, z], [x + s * hw, P.wheelR, z], tyreR, T.wheelSeg, 'tyre', 'rim', Math.PI / T.wheelSeg);
    if (T.rim) { W.prism([x + s * hw, P.wheelR, z], [x + s * (hw + 0.012), P.wheelR, z], P.wheelR * 0.68, T.rim, 'trim', 'trim', Math.PI / 2, P.wheelR * 0.6); W.prism([x + s * (hw + 0.012), P.wheelR, z], [x + s * (hw + 0.03), P.wheelR, z], 0.07, 5, 'rim', 'rim'); }
    if (T.calipers) W.box(x + s * (hw + 0.006), P.wheelR + 0.13, z - 0.08, 0.012, 0.09, 0.12, 'caliper'); // red caliper behind the spokes
  }

  // ── interior blocks (P1-V03): what a missing panel shows, in vehicle space, the same at every LOD. Drawn only for a
  // car whose part exposes them (vehicle.json `interiors`), so an undamaged field never pays for them. ──
  { const I = S('interior_engine'), zm = (zA + P.zNose) / 2; // under the front piece
    I.box(0, 0.6, zm, 0.95, 0.4, 0.7, 'chrome'); I.box(0, 0.86, zm - 0.05, 0.6, 0.12, 0.45, { all: 'trim', py: 'chrome' }); }
  { const I = S('interior_cabin'); // behind the doors: two front seats and the rear bench
    for (const s of [1, -1]) I.box(s * 0.42, 0.72, (zA + P.zB) / 2 - 0.12, 0.5, 0.62, 0.5, 'trim');
    I.box(0, 0.7, (P.zB + zC) / 2 - 0.1, 1.3, 0.56, 0.48, 'trim'); }
  { const I = S('interior_boot'), zm = (zC + P.zTail) / 2; // under the back piece: the spare and a toolbox
    I.prism([0.25, 0.42, zm], [0.25, 0.62, zm], 0.3, 6, 'tyre', 'rim'); I.box(-0.45, 0.55, zm, 0.4, 0.25, 0.5, 'gold'); }

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

/** Plain per-part triangle soups for the bake: { parts: { id: { pivot, positions (part space), uvs (v up), tris } } }. */
export function soups(P, lod = 0) {
  const { soups: raw, stations } = makeSoups(P, lod), pv = pivots(P), parts = {};
  for (const [id, so] of Object.entries(raw)) {
    const pivot = pv[id];
    parts[id] = { pivot, positions: so.p.map((v, i) => v - pivot[i % 3]), uvs: so.uv.slice(), tris: so.tris };
  }
  return { parts, stations };
}

/** The car as a three.js group: one Mesh per part, positioned at its pivot (userData.rest). */
export function build(P, lod = 0) {
  const { parts: soup, stations } = soups(P, lod);
  const group = new THREE.Group(); group.name = 'lion-president'; const parts = {}; let tris = 0; const breakdown = {};
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
