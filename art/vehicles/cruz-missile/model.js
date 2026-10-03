// model.js: the low-poly Cruz Missile built from code (R81; P1-V02 moved it here from Spike J, which stays as evidence).
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs). P comes from params.json (Spike J's final, pixel-fitted parameters).
//
// Frame: metres, +Z = nose, +Y up, origin on the ground between the axles (jj.vehicle.v1). In this right-handed frame +X
// is the car's LEFT: a driver facing +Z with +Y up has +X on their left (Spike J called +X "right"; the parts are named
// physically here, so door_FL, wheel_FL and the UHF whip sit on +X, as jj-sim's wheel order already assumes).
//
// Changes from Spike J (each needed by the vehicle contract, P1-V01):
// - Tyre polygons are sized so their flats rest on the ground (inscribed radius = wheelR). Spike J's 8-sided LOD1/2 tyres
//   left the car 3 cm in the air, and the contract wants the lowest vertex within 2 cm of the origin.
// - LOD2 drops the UHF whip's 9 cm mount block (12 triangles; it sits inside the spring base's footprint, so no bounds
//   change), bringing LOD2 from 606 to 594, inside the 600 budget.
// - Sides are named physically (above). The geometry is otherwise Spike J's, vertex for vertex.
//
// Shape = two flat-shaded lofts (tub + greenhouse) sampled from smooth curves in P, plus box/cylinder details.
// LOD changes only the sampling density and which details exist; part names and pivots are identical at every LOD.
// Damage parts (owner simplification 2026-10-02): front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; everything else is core.
import * as THREE from 'three';
import { swatchUV, REGION } from './atlas.js';

export const LODS = {
  0: { aerialMount: true, arch: 7, nose: 2, curvePts: true, merge: 0.08, doorMid: true, wheelSeg: 12, rim: 5, mirrors: 'shaped', spoiler: 'full', bar: 'full', aerialSeg: 5, fog: true, exhaust: true, seams: true, splitter: true },
  1: { aerialMount: true, arch: 5, nose: 1, curvePts: true, merge: 0.2, doorMid: true, wheelSeg: 8, rim: 5, mirrors: 'box', spoiler: 'full', bar: 'simple', aerialSeg: 3, fog: false, exhaust: false, seams: false, splitter: true },
  2: { aerialMount: false, arch: 3, nose: 1, curvePts: false, merge: 1, wheelSeg: 8, rim: 0, mirrors: 'box', spoiler: 'plate', bar: 'simple', aerialSeg: 3, fog: false, exhaust: false, seams: false, splitter: false },
};

// Default parameters: measured from the owner's "lod + 1" sheet (refs/profile_lod1.json, grid_side.png), metres.
export const DEFAULT_P = {
  L: 4.31, zNose: 2.14, zTail: -2.17,
  wheelR: 0.38, wheelW: 0.30, track: 0.83, zFA: 1.34, zRA: -1.34,
  archR: 0.50, archTop: 0.80, archBase: 0.24, // arch opening: half-length along z, top height, height where it meets the sill
  // tub curves: [z, value] control points (linear between, sampled at the stations). Fascia slopes back from the bumper top
  // (z 2.14, y 0.62) to the bonnet edge (z 1.98, y 0.86); headlights and grille sit on that slope.
  yBot: [[2.14, 0.24], [1.8, 0.21], [0, 0.19], [-1.8, 0.21], [-2.17, 0.28]],
  ySh: [[2.14, 0.62], [1.98, 0.86], [1.6, 0.97], [0.9, 1.04], [-1.3, 1.16], [-2.0, 1.15], [-2.17, 1.08]],
  yCr: [[2.14, 0.66], [1.98, 0.93], [1.6, 1.05], [0.9, 1.15], [-1.3, 1.21], [-2.0, 1.21], [-2.17, 1.13]],
  hw: [[2.14, 0.82], [1.98, 0.92], [1.7, 0.98], [1.3, 1.0], [0, 0.98], [-1.3, 1.0], [-1.8, 0.97], [-2.17, 0.88]],
  shoulderIn: 0.10, sideDrop: 0.13, skirt: 0.10, floorIn: 0.08,
  // greenhouse stations, nose→tail: z, base half-width (at the belt), glass-top half-width, roof height (null = collapsed onto
  // the tub), roof: segment to the next station is glass (windscreen / rear window), side: side glass on that segment.
  cabin: [
    { z: 0.92, wb: 0.88, wt: 0.88, yr: null, roof: 'glass', side: 'glass' },
    { z: 0.50, wb: 0.87, wt: 0.78, yr: 1.40, roof: 'glass', side: 'glass' },
    { z: 0.14, wb: 0.86, wt: 0.72, yr: 1.555, roof: 'paint', side: 'glass' },
    { z: -0.40, wb: 0.86, wt: 0.72, yr: 1.595, roof: 'paint', side: 'glass' },
    { z: -0.92, wb: 0.87, wt: 0.74, yr: 1.555, roof: 'glass', side: 'glass' },
    { z: -1.30, wb: 0.88, wt: 0.80, yr: 1.37, roof: 'glass', side: 'paint' },
    { z: -1.64, wb: 0.89, wt: 0.89, yr: null },
  ],
  roofCh: 0.08, roofCrown: 0.03, zB: -0.15,
  // details
  mirror: { z: 0.66, y: 1.13, out: 0.20, w: 0.12, h: 0.11, l: 0.18 },
  spoiler: { z: -1.98, y: 1.42, chord: 0.42, span: 0.90, tilt: 0.25, plateH: 0.20, plateL: 0.55 },
  aerial: { len: 0.95, r: 0.022 }, // mounted on the nudge bar (see bar)
  bar: { z: 2.24, y0: 0.27, y1: 0.60, hw: 0.62 },
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
function sideUV(P) { const [u0, v0, u1, v1] = REGION.side; return (v) => [u0 + (u1 - u0) * ((P.zNose - v[2]) / 4.5), v0 + (v1 - v0) * (v[1] / 1.6)]; }
function topUV(P) { const [u0, v0, u1, v1] = REGION.top; return (v) => [u0 + (u1 - u0) * (v[0] / 1.9 + 0.5), v1 - (v1 - v0) * ((P.zNose - v[2]) / 1.4)]; }
function deckUV(P) { const [u0, v0, u1, v1] = REGION.deck; return (v) => [u0 + (u1 - u0) * (v[0] / 1.9 + 0.5), v1 - (v1 - v0) * ((v[2] - P.zTail) / 1.4)]; }

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
  const sUV = sideUV(P), tUV = topUV(P), dUV = deckUV(P);
  const segSwatch = (seg, zm, isArch) => {
    if (seg === 0) return 'under';
    if (seg === 1) return isArch ? 'trim' : 'trim';
    if (seg === 4) return zm > zA ? tUV : zm < P.cabin.at(-1).z ? dUV : 'paint';
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
      const sw = k === 0 ? c.side : c.roof;
      if (s > 0) S('core').quad(a[k], b[k], b[k + 1], a[k + 1], sw); else S('core').quad(a[k], a[k + 1], b[k + 1], b[k], sw);
    }
  }

  // ── bays (dark, inside the shell; seen only when a panel is gone) ──
  const bay = (cx, cy, cz, sx, sy, sz) => S('core').box(cx, cy, cz, sx, sy, sz, 'bay');
  { const hwA = lerpCurve(P.hw, zA) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zA)) / 2 - 0.02, zA + 0.03, hwA * 2, lerpCurve(P.ySh, zA) - 0.36, 0.06); } // firewall
  { const hwC = lerpCurve(P.hw, zC) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zC)) / 2 - 0.02, zC - 0.03, hwC * 2, lerpCurve(P.ySh, zC) - 0.36, 0.06); } // rear bulkhead
  for (const s of [1, -1]) { const x = s * (lerpCurve(P.hw, 0) - 0.07); S('core').quad(...(s > 0 ? [[x, 0.3, zA], [x, 0.3, zC], [x, 1.05, zC], [x, 1.02, zA]] : [[x, 0.3, zC], [x, 0.3, zA], [x, 1.02, zA], [x, 1.05, zC]]), 'bay'); }

  // ── front fascia (part: front) ──
  const F = S('front'), zn = P.zNose + 0.004, hwN = lerpCurve(P.hw, P.zNose), z1 = P.zNose - 0.16;
  const fq = (x0, y0, x1, y1, sw, dz = 0) => F.quad([x0, y0, zn + dz], [x1, y0, zn + dz], [x1, y1, zn + dz], [x0, y1, zn + dz], sw);
  // a point on the sloped upper fascia (between the nose station and z1) at (x, y), lifted 12 mm off the surface
  const yAt = (z, x) => { const ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), xi = lerpCurve(P.hw, z) - P.shoulderIn; return Math.abs(x) >= xi ? ysh : ycr + (ysh - ycr) * Math.abs(x) / xi; };
  const onSlope = (x, y) => { const y0 = yAt(P.zNose, x), y1 = yAt(z1, x), t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0))); return [x, y + 0.012, P.zNose - t * (P.zNose - z1) + 0.026]; };
  const slopeQuad = (pts, sw, s = 1) => { const q = pts.map(([x, y]) => onSlope(s * x, y)); if (s > 0) F.quad(q[0], q[1], q[2], q[3], sw); else F.quad(q[0], q[3], q[2], q[1], sw); };
  slopeQuad([[-0.40, 0.64], [0.40, 0.64], [0.44, 0.83], [-0.44, 0.83]], 'trim'); // grille
  for (const s of [1, -1]) {
    slopeQuad([[0.50, 0.66], [0.86, 0.71], [0.88, 0.85], [0.50, 0.83]], 'head', s); // angular headlight, outer corner higher
    if (T.fog) { const fx = s * hwN * 0.84; F.prism([fx, 0.38, zn - 0.01], [fx, 0.38, zn + 0.015], 0.06, 6, 'trim', 'fog', Math.PI / 6); }
  }
  const ybN = lerpCurve(P.yBot, P.zNose);
  fq(-0.52, ybN + 0.07, 0.52, 0.50, 'trim'); // lower intake behind the bull bar
  for (const s of [1, -1]) { const a = s * 0.60, b = s * 0.80; fq(Math.min(a, b), ybN + 0.03, Math.max(a, b), ybN + 0.11, 'pink'); } // pink bumper corners
  if (T.splitter) F.box(0, ybN + 0.01, P.zNose - 0.06, hwN * 2 + 0.06, 0.04, 0.22, { all: 'trim', pz: 'pink' });
  // bull bar with four LED blocks
  const B = P.bar;
  if (T.bar === 'full' || T.bar === 'simple') {
    for (const s of [1, -1]) F.box(s * B.hw, (B.y0 + B.y1) / 2, B.z, 0.07, B.y1 - B.y0, 0.07, 'trim');
    F.box(0, B.y1, B.z, B.hw * 2 + 0.07, 0.07, 0.07, 'trim');
    F.box(0, B.y0, B.z - 0.02, B.hw * 2 + 0.25, 0.07, 0.09, 'trim');
    if (T.bar === 'full') { const n = 4; for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * (B.hw * 2 / n) * 0.9; F.box(x, B.y1 - 0.11, B.z + 0.01, 0.13, 0.10, 0.05, { all: 'trim', pz: 'led' }); } }
    else { const n = 4; for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * (B.hw * 2 / n) * 0.9; F.quad([x - 0.065, B.y1 - 0.16, B.z + 0.036], [x + 0.065, B.y1 - 0.16, B.z + 0.036], [x + 0.065, B.y1 - 0.06, B.z + 0.036], [x - 0.065, B.y1 - 0.06, B.z + 0.036], 'led'); } F.quad([-B.hw, B.y1 - 0.17, B.z + 0.034], [B.hw, B.y1 - 0.17, B.z + 0.034], [B.hw, B.y1 - 0.05, B.z + 0.034], [-B.hw, B.y1 - 0.05, B.z + 0.034], 'trim'); }
    if (T.bar === 'full') for (const s of [1, -1]) F.box(s * (B.hw + 0.16), B.y0 + 0.08, B.z - 0.06, 0.08, 0.16, 0.08, 'trim', [0, 0, s * 0.5]);
  } else {
    fq(-B.hw, B.y1 - 0.16, B.hw, B.y1 - 0.05, 'led', 0.006);
  }
  // UHF whip (front part, +X corner): base spring + thin whip
  // UHF whip clamped to the nudge bar's +X post top (owner, 2026-10-02): mount block, spring base, whip
  const A = P.aerial, ax = B.hw, ay = B.y1 + 0.035, az = B.z;
  if (T.aerialMount) F.box(ax, ay + 0.02, az, 0.09, 0.04, 0.09, 'trim');
  F.prism([ax, ay + 0.04, az], [ax, ay + 0.32, az], A.r * 2.2, T.aerialSeg, 'trim', 'trim');
  F.prism([ax, ay + 0.32, az], [ax, ay + A.len, az], A.r, T.aerialSeg, 'trim', 'pink');

  // ── rear (part: back) ──
  const Bk = S('back'), zt = P.zTail - 0.004, hwT = lerpCurve(P.hw, P.zTail), yshT = lerpCurve(P.ySh, P.zTail);
  const bq = (x0, y0, x1, y1, sw) => Bk.quad([x1, y0, zt], [x0, y0, zt], [x0, y1, zt], [x1, y1, zt], sw);
  for (const s of [1, -1]) { const xa = s * hwT * 0.45, xb = s * hwT * 0.99; if (s > 0) bq(xa, yshT - 0.2, xb, yshT - 0.03, 'tail'); else bq(xb, yshT - 0.2, xa, yshT - 0.03, 'tail'); }
  bq(-hwT * 0.75, P.yBot.at(-1)[1], hwT * 0.75, P.yBot.at(-1)[1] + 0.16, 'trim'); // diffuser
  bq(-0.05, P.yBot.at(-1)[1] + 0.05, 0.05, P.yBot.at(-1)[1] + 0.13, 'tail');
  for (const s of [1, -1]) { // tail-lamp wrap onto the rear quarter, and a pink diffuser edge
    const z0 = P.zTail + 0.24, z1 = P.zTail + 0.01, x0 = s * (lerpCurve(P.hw, z0) + 0.006), x1 = s * (lerpCurve(P.hw, z1) + 0.006);
    const yh = lerpCurve(P.ySh, z1) - P.sideDrop - 0.01, yl = yh - 0.13;
    if (s > 0) Bk.quad([x0, yl, z0], [x1, yl, z1], [x1, yh, z1], [x0, yh, z0], 'tail'); else Bk.quad([x0, yl, z0], [x0, yh, z0], [x1, yh, z1], [x1, yl, z1], 'tail');
    const a = s * hwT * 0.55, b = s * hwT * 0.78; bq(Math.min(a, b), P.yBot.at(-1)[1] + 0.17, Math.max(a, b), P.yBot.at(-1)[1] + 0.22, 'pink');
  }
  if (T.exhaust) Bk.prism([0.55, 0.33, zt + 0.05], [0.55, 0.33, zt - 0.05], 0.06, 6, 'chrome', 'trim');
  // spoiler
  const SP = P.spoiler;
  if (T.spoiler !== 'none') {
    // wing plate + raked endplates (rear edge high, like the reference); uprights down to the deck
    Bk.box(0, SP.y, SP.z, SP.span * 2, 0.045, SP.chord, { all: 'paint', px: 'pink', nx: 'pink' }, [SP.tilt, 0, 0]);
    const deck = lerpCurve(P.yCr, SP.z);
    for (const s of [1, -1]) Bk.box(s * SP.span * 0.55, (deck + SP.y) / 2, SP.z + 0.04, 0.05, SP.y - deck, 0.10, 'trim', [-0.25, 0, 0]);
    // endplates: the reference's raked parallelogram, measured off the side view (z, y) and moved with the wing
    if (T.spoiler === 'full') { const dz = SP.z + 1.98, dy = SP.y - 1.42, poly = [[-1.79, 1.13], [-2.12, 1.22], [-2.23, 1.53], [-1.74, 1.32]].map(([z, y]) => [z + dz, y + dy]);
      for (const s of [1, -1]) Bk.slab(poly.map(([z, y]) => [z, y]), s * SP.span - 0.018, s * SP.span + 0.018, 'pink', s > 0 ? 'lime' : 'pink', s > 0 ? 'pink' : 'lime'); }
  }


  // ── mirrors (core: they stay with the greenhouse) ──
  const M = P.mirror;
  for (const s of [1, -1]) {
    const x = s * (lerpCurve(P.hw, M.z) - 0.05 + M.out / 2);
    S('core').box(x, M.y, M.z, M.out, M.h, M.l, { all: 'paint', pz: 'paint', nz: 'trim' }, T.mirrors === 'shaped' ? [0, s * 0.15, 0] : null);
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
  }

  return { soups, stations: Z.length };
}

// Each part's pivot (its origin as debris, Spike J's choice): the wheel centre, the bounding-box centre for the other
// detachable parts, the vehicle origin for core, always measured on LOD0, because the contract wants one pivot per part
// at every LOD (coarser tiers sample fewer rings, which would move a bounding-box centre by millimetres). P1-V03's
// production pass moves the hinged ones to their hinge lines.
export function pivots(P = DEFAULT_P) {
  const out = {};
  for (const [id, so] of Object.entries(makeSoups(P, 0).soups)) out[id] = pivotOf(P, id, so.p);
  return out;
}

function pivotOf(P, id, positions) {
  if (id === 'core') return [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]); }
  if (id.startsWith('wheel')) return [Math.sign(hi[0] + lo[0]) * P.track, P.wheelR, id[6] === 'F' ? P.zFA : P.zRA];
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
}

/** Plain per-part triangle soups for the bake: { parts: { id: { pivot, positions (part space), uvs (v up), tris } } }. */
export function soups(P = DEFAULT_P, lod = 0) {
  const { soups: raw, stations } = makeSoups(P, lod), pv = pivots(P), parts = {};
  for (const [id, so] of Object.entries(raw)) {
    const pivot = pv[id];
    parts[id] = { pivot, positions: so.p.map((v, i) => v - pivot[i % 3]), uvs: so.uv.slice(), tris: so.tris };
  }
  return { parts, stations };
}

/** The car as a three.js group: one Mesh per part, positioned at its pivot (userData.rest). */
export function build(P = DEFAULT_P, lod = 0) {
  const { parts: soup, stations } = soups(P, lod);
  const group = new THREE.Group(); group.name = 'cruz-missile'; const parts = {}; let tris = 0; const breakdown = {};
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
