// model.js: the low-poly Tradie Ute (the owner's dual-cab Mitsubishi-style tray ute) built from code (R81 method; R123 persona).
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs). P comes from params.json.
//
// Provenance: the proportions come from the owner's Triton build script (home-digital-twin studies/landscape/catalog/vehicles/
// build_vehicles.py: dual cab, 3.0 m wheelbase, 0.8 m tyres, tray behind the cab, TJM-style bull bar, snorkel on the driver's
// A-pillar, roof rack, side steps), scaled into a caricature that sits in the roster beside the Cruz Missile: the same two-loft
// construction (tub + greenhouse) as cruz-missile/model.js, flat-shaded, parts and pivots identical at every LOD.
// R123 allowed importing the owner's mesh; porting the geometry to code kept R81's method and gives clean part splits.
//
// Frame: metres, +Z = nose, +Y up, origin on the ground between the axles (jj.vehicle.v1); +X is the vehicle's LEFT.
// Damage parts: front (bonnet, grille, bull bar), back (tray, tailgate, tow bar), door_FL/FR/RL/RR, wheel_FL/FR/RL/RR;
// everything else (cab, roof rack, snorkel, mirrors, steps) is core.
import * as THREE from 'three';
import { swatchUV, REGION } from './atlas.js';

export const LODS = {
  0: { arch: 6, nose: 2, curvePts: true, merge: 0.10, doorMid: true, wheelSeg: 12, rim: 5, mirrors: 'shaped', bar: 'full', snorkel: 3, rack: true, steps: true, seams: true, tow: true, tailLamps: true, flares: true, load: true },
  1: { arch: 5, nose: 1, curvePts: true, merge: 0.2, doorMid: true, wheelSeg: 8, rim: 5, mirrors: 'box', bar: 'simple', snorkel: 1, rack: false, steps: false, seams: false, tow: false, tailLamps: true, flares: false, load: false },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, wheelSeg: 8, rim: 0, mirrors: 'box', bar: 'simple', snorkel: 0, rack: false, steps: false, seams: false, tow: false, tailLamps: false, flares: false, load: false },
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
const LEN = 5.3; // matches atlas.js: the side livery spans 5.3 m from the nose
function sideUV(P) { const [u0, v0, u1, v1] = REGION.side; return (v) => [u0 + (u1 - u0) * ((P.zNose - v[2]) / LEN), v0 + (v1 - v0) * (v[1] / 1.7)]; }
function topUV(P) { const [u0, v0, u1, v1] = REGION.top; return (v) => [u0 + (u1 - u0) * (v[0] / 1.9 + 0.5), v1 - (v1 - v0) * ((P.zNose - v[2]) / 1.7)]; }
function deckUV(P) { const [u0, v0, u1, v1] = REGION.deck; return (v) => [u0 + (u1 - u0) * (v[0] / 1.9 + 0.5), v1 - (v1 - v0) * ((v[2] - P.zTail) / 1.7)]; }

// ───────────────────────── build ─────────────────────────
function makeSoups(P, lod) {
  const T = LODS[lod];
  const zA = P.zFA - P.archR, zC = P.zRA + P.archR; // door span = between the arches; front/back cut lines
  const prot = [P.zNose, P.zTail, zA, zC, zC - 0.03, P.zB, P.zNose - 0.16];
  for (let i = 1; i <= T.nose; i++) prot.push(P.zTail + 0.14 * i / T.nose);
  if (T.doorMid) prot.push((zA + P.zB) / 2, (P.zB + zC) / 2);
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
    if (seg >= 1 && seg <= 3) return (zm > P.zB ? 'door_F' : 'door_R') + (s > 0 ? 'L' : 'R'); // +X is the vehicle's left
    return 'core';
  };
  const sUV = sideUV(P), tUV = topUV(P), dUV = deckUV(P);
  const segSwatch = (seg, zm) => {
    if (seg === 0) return 'under';
    if (seg === 1) return 'trim';
    if (seg === 4) return zm > zA ? tUV : zm < P.cabin.at(-1).z ? dUV : 'paint';
    return sUV;
  };
  for (const s of [1, -1]) {
    for (let i = 0; i < Z.length - 1; i++) {
      const a = ring(Z[i], s), b = ring(Z[i + 1], s), zm = (Z[i] + Z[i + 1]) / 2;
      for (let k = 0; k < 5; k++) {
        const so = S(partOfTub(zm, k, s));
        const uv = k === 3 ? sUV : segSwatch(k, zm);
        if (s > 0) so.quad(a[k], b[k], b[k + 1], a[k + 1], uv); else so.quad(a[k], a[k + 1], b[k + 1], b[k], uv);
      }
    }
  }
  const cap = (z, id, sign, sw) => {
    const R = ring(z, 1), Lr = ring(z, -1); const poly = [R[0], R[1], R[2], R[3], R[4], R[5], Lr[4], Lr[3], Lr[2], Lr[1]];
    const c = [0, poly.reduce((t, v) => t + v[1], 0) / poly.length, z];
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; if (sign > 0) S(id).tri(c, p, q, sw); else S(id).tri(c, q, p, sw); }
  };
  cap(P.zNose, 'front', 1, 'paint'); cap(P.zTail, 'back', -1, 'paint');

  // greenhouse (the dual cab): ring per cabin station, one side: base(belt) → glass top → roof edge → crown
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
  { const hwA = lerpCurve(P.hw, zA) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zA)) / 2 - 0.02, zA + 0.03, hwA * 2, lerpCurve(P.ySh, zA) - 0.36, 0.06); }
  { const hwC = lerpCurve(P.hw, zC) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zC)) / 2 - 0.02, zC - 0.03, hwC * 2, lerpCurve(P.ySh, zC) - 0.36, 0.06); }
  for (const s of [1, -1]) { const x = s * (lerpCurve(P.hw, 0) - 0.07); S('core').quad(...(s > 0 ? [[x, 0.3, zA], [x, 0.3, zC], [x, 1.1, zC], [x, 1.1, zA]] : [[x, 0.3, zC], [x, 0.3, zA], [x, 1.1, zA], [x, 1.1, zC]]), 'bay'); }

  // ── front (part: front): bonnet cap, fascia, grille, lamps, bull bar ──
  const F = S('front'), zn = P.zNose + 0.004, hwN = lerpCurve(P.hw, P.zNose), z1 = P.zNose - 0.16;
  const fq = (x0, y0, x1, y1, sw, dz = 0) => F.quad([x0, y0, zn + dz], [x1, y0, zn + dz], [x1, y1, zn + dz], [x0, y1, zn + dz], sw);
  const yAt = (z, x) => { const ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), xi = lerpCurve(P.hw, z) - P.shoulderIn; return Math.abs(x) >= xi ? ysh : ycr + (ysh - ycr) * Math.abs(x) / xi; };
  const onSlope = (x, y) => { const y0 = yAt(P.zNose, x), y1 = yAt(z1, x), t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0))); return [x, y + 0.012, P.zNose - t * (P.zNose - z1) + 0.026]; };
  const slopeQuad = (pts, sw, s = 1) => { const q = pts.map(([x, y]) => onSlope(s * x, y)); if (s > 0) F.quad(q[0], q[1], q[2], q[3], sw); else F.quad(q[0], q[3], q[2], q[1], sw); };
  slopeQuad([[-0.50, 0.84], [0.50, 0.84], [0.54, 0.98], [-0.54, 0.98]], 'trim'); // grille
  slopeQuad([[-0.54, 0.98], [0.54, 0.98], [0.55, 1.01], [-0.55, 1.01]], 'chrome'); // chrome grille header
  for (const s of [1, -1]) slopeQuad([[0.58, 0.84], [0.88, 0.88], [0.89, 1.0], [0.58, 0.98]], 'head', s); // swept headlights
  const ybN = lerpCurve(P.yBot, P.zNose);
  fq(-0.66, ybN + 0.07, 0.66, 0.62, 'trim'); // lower intake behind the bull bar
  for (const s of [1, -1]) { const a = s * 0.70, b = s * 0.86; fq(Math.min(a, b), ybN + 0.03, Math.max(a, b), ybN + 0.13, 'pink'); } // hi-vis bumper corners
  const B = P.bar;
  F.box(0, ybN + 0.01, P.zNose - 0.06, hwN * 2 + 0.06, 0.04, 0.22, { all: 'trim', pz: 'pink' }); // splitter / bash plate
  for (const s of [1, -1]) F.box(s * B.hw, (B.y0 + B.y1) / 2, B.z, 0.08, B.y1 - B.y0, 0.08, 'trim'); // hoop uprights
  F.box(0, B.y1, B.z, B.hw * 2 + 0.08, 0.08, 0.08, 'trim'); // hoop top rail
  F.box(0, B.y0, B.z - 0.02, B.hw * 2 + 0.30, 0.08, 0.10, 'trim'); // bash rail
  if (T.bar === 'full') {
    F.box(0, B.y1 + 0.09, B.z - 0.03, 0.80, 0.09, 0.07, { all: 'trim', pz: 'led' }); // light bar
    for (const s of [1, -1]) F.box(s * (B.hw + 0.18), B.y0 + 0.10, B.z - 0.08, 0.08, 0.20, 0.08, 'trim', [0, 0, s * 0.5]); // wing tips
    F.box(0, (B.y0 + B.y1) / 2, B.z, 0.05, B.y1 - B.y0 - 0.08, 0.05, 'trim'); // centre hoop
  } else {
    F.quad([-0.4, B.y1 + 0.04, B.z + 0.06], [0.4, B.y1 + 0.04, B.z + 0.06], [0.4, B.y1 + 0.13, B.z + 0.06], [-0.4, B.y1 + 0.13, B.z + 0.06], 'led');
  }

  // ── back (part: back): tray, tailgate, tow bar ──
  const Bk = S('back'), zt = P.zTail - 0.004, hwT = lerpCurve(P.hw, P.zTail), deckY = lerpCurve(P.yCr, P.zTail), TR = P.tray, wH = TR.wallH, wT = TR.wallT;
  const trayLen = TR.z0 - TR.z1, trayMid = (TR.z0 + TR.z1) / 2, hwTr = lerpCurve(P.hw, trayMid);
  for (const s of [1, -1]) Bk.box(s * (hwTr - wT / 2), deckY + wH / 2, trayMid, wT, wH, trayLen, { all: 'paint', py: 'chrome', px: sUV, nx: sUV }); // side walls
  Bk.box(0, deckY + wH / 2, TR.z1, (hwTr - wT) * 2, wH, wT, { all: 'paint', py: 'chrome', pz: 'paint', nz: 'paint' }); // tailgate
  Bk.box(0, deckY + (wH + 0.16) / 2, TR.z0, (hwTr - wT) * 2, wH + 0.16, wT, { all: 'paint', pz: 'trim', nz: 'trim' }); // headboard (the cab's rear)
  const bq = (x0, y0, x1, y1, sw) => Bk.quad([x1, y0, zt], [x0, y0, zt], [x0, y1, zt], [x1, y1, zt], sw);
  if (T.tailLamps) for (const s of [1, -1]) { const xa = s * hwT * 0.55, xb = s * hwT * 0.97; bq(Math.min(xa, xb), 0.74, Math.max(xa, xb), 1.02, 'tail'); }
  bq(-0.30, 0.50, 0.30, 0.60, 'trim'); // plate recess below the tailgate
  if (T.tow) { Bk.box(0, 0.42, zt - 0.06, 0.55, 0.10, 0.14, 'trim'); Bk.prism([0, 0.46, zt - 0.14], [0, 0.56, zt - 0.14], 0.04, 5, 'chrome', 'chrome'); }
  if (T.load) {
    Bk.box(0, deckY + 0.15, TR.z0 - 0.42, 1.55, 0.26, 0.46, { all: 'chrome', py: 'trim' }); // alloy toolbox behind the headboard
    Bk.prism([-0.55, deckY + 0.20, TR.z1 + 0.55], [0.55, deckY + 0.20, TR.z1 + 0.55], 0.20, 6, 'bay', 'bay'); // rolled swag
  }
  // bumper step corner (hi-vis) on the tail
  for (const s of [1, -1]) { const a = s * hwT * 0.60, b = s * hwT * 0.96; bq(Math.min(a, b), 0.40, Math.max(a, b), 0.50, 'pink'); }

  // ── core details: mirrors, steps, snorkel, roof rack ──
  const M = P.mirror;
  for (const s of [1, -1]) {
    const x = s * (lerpCurve(P.hw, M.z) + M.out / 2 - 0.02);
    S('core').box(x, M.y, M.z, M.out, M.h, M.l, { all: 'trim', pz: 'trim', nz: 'chrome' }, T.mirrors === 'shaped' ? [0, s * 0.12, 0] : null);
  }
  if (T.seams) for (const s of [1, -1]) for (const z of [zA - 0.012, P.zB, zC + 0.012]) {
    const x = s * (lerpCurve(P.hw, z) + 0.003), y0 = lerpCurve(P.yBot, z) + P.skirt + 0.02, y1 = lerpCurve(P.ySh, z) - 0.05;
    S('core').quad(...(s > 0 ? [[x, y0, z + 0.008], [x, y0, z - 0.008], [x, y1, z - 0.008], [x, y1, z + 0.008]] : [[x, y0, z - 0.008], [x, y0, z + 0.008], [x, y1, z + 0.008], [x, y1, z - 0.008]]), 'trim');
  }
  if (T.steps) for (const s of [1, -1]) S('core').box(s * (lerpCurve(P.hw, 0) + 0.07), 0.30, (zA + zC) / 2, 0.16, 0.05, zA - zC - 0.1, { all: 'trim', py: 'chrome' }); // side steps
  if (T.snorkel) {
    const K = P.snorkel, ro = 0.045, x = K.x, pts = [[x, 1.18, K.zBase], [x, 1.50, K.zBase - 0.08], [x, K.yTop - 0.08, K.zTop + 0.04]];
    if (T.snorkel >= 3) { S('core').prism(pts[0], pts[1], ro, 4, 'trim', 'trim', Math.PI / 4); S('core').prism(pts[1], pts[2], ro, 4, 'trim', 'trim', Math.PI / 4); }
    else S('core').prism(pts[0], pts[2], ro, 4, 'trim', 'trim', Math.PI / 4);
    S('core').box(x, K.yTop, K.zTop + 0.04, 0.10, 0.14, 0.14, 'trim'); // the ram head
  }
  if (T.rack) {
    const R = P.rack, zm = (R.z0 + R.z1) / 2, len = R.z0 - R.z1;
    for (const s of [1, -1]) S('core').box(s * R.hw, R.y, zm, 0.05, 0.05, len, 'trim');
    S('core').box(0, R.y, R.z0 - 0.04, R.hw * 2, 0.04, 0.05, 'trim');
    S('core').box(0, R.y, R.z1 + 0.04, R.hw * 2, 0.04, 0.05, 'trim');
  }

  // ── wheels: tyre prism + rim disc (5-spoke at low res) ──
  const tyreR = P.wheelR / Math.cos(Math.PI / T.wheelSeg);
  for (const [id, z, s] of [['wheel_FL', P.zFA, 1], ['wheel_FR', P.zFA, -1], ['wheel_RL', P.zRA, 1], ['wheel_RR', P.zRA, -1]]) {
    const W = S(id), x = s * P.track, hw = P.wheelW / 2;
    W.prism([x - s * hw, P.wheelR, z], [x + s * hw, P.wheelR, z], tyreR, T.wheelSeg, 'tyre', 'rim', Math.PI / T.wheelSeg);
    if (T.rim) { W.prism([x + s * hw, P.wheelR, z], [x + s * (hw + 0.012), P.wheelR, z], P.wheelR * 0.68, T.rim, 'trim', 'trim', Math.PI / 2, P.wheelR * 0.6); W.prism([x + s * (hw + 0.012), P.wheelR, z], [x + s * (hw + 0.03), P.wheelR, z], 0.08, 5, 'rim', 'rim'); }
  }

  // ── interior blocks (what a missing panel shows, vehicle space, the same at every LOD) ──
  { const I = S('interior_engine'), zm = (zA + P.zNose) / 2; // under the bonnet: a big diesel
    I.box(0, 0.68, zm, 1.0, 0.46, 0.8, 'chrome'); I.box(0, 0.98, zm - 0.05, 0.6, 0.12, 0.5, { all: 'trim', py: 'pink' }); }
  { const I = S('interior_cabin'); // behind the doors: two front seats and the rear bench
    for (const s of [1, -1]) I.box(s * 0.44, 0.78, (zA + P.zB) / 2 - 0.12, 0.5, 0.62, 0.5, 'trim');
    I.box(0, 0.76, (P.zB + zC) / 2 - 0.1, 1.4, 0.56, 0.48, 'trim'); }
  { const I = S('interior_boot'), zm = (zC + P.zTail) / 2; // under the tray: ladder chassis, the spare and a jerry can
    I.box(0, 0.58, zm, 0.9, 0.16, 1.5, 'trim'); I.prism([0.25, 0.46, zm + 0.1], [0.25, 0.72, zm + 0.1], 0.34, 6, 'tyre', 'rim'); I.box(-0.45, 0.78, zm - 0.1, 0.34, 0.4, 0.2, 'pink'); }

  return { soups, stations: Z.length };
}

// Each part's pivot is its hinge line (plan §6.3): a loose part turns about its hinge axis through the pivot.
// Doors: the front edge on the outer skin. Front and back: their top edge where they meet the body, at the shoulder line.
// Wheels: the hub. Core: the vehicle origin. Measured on LOD0, because the contract wants one pivot per part at every LOD.
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
  if (id.startsWith('door')) return [mid(0) > 0 ? hi[0] : lo[0], mid(1), hi[2]];
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

/** The ute as a three.js group: one Mesh per part, positioned at its pivot (userData.rest). */
export function build(P, lod = 0) {
  const { parts: soup, stations } = soups(P, lod);
  const group = new THREE.Group(); group.name = 'tradie-ute'; const parts = {}; let tris = 0; const breakdown = {};
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
