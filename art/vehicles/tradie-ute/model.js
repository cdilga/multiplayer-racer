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
// br-bwju.8 (owner 2026-10-11: "keep the rear canopy and the actual roof rack, and dual cab ... a little too generic"):
// rebuilt against the owner's photos (eris morayfield-house-3d twin/site/sources/owner-inbox-2026-10-10/triton-reference.zip):
// the black flat-top canopy on a flat tray, the platform rack with its wind deflector and rolled awning on the left, the MQ
// Triton's chrome "dynamic shield" grille, a solid black bull bar (light bar, fog lamps, winch hook), the snorkel on the right
// (driver's) A-pillar, black wheels with a silver lip, the paint plain (no hi-vis: the owner's car is plain).
//
// Damage parts: front (bonnet, grille, bull bar), back (tray, canopy, tray lamps, tow bar), door_FL/FR/RL/RR, wheel_*;
// everything else (cab, roof rack, snorkel, mirrors, steps) is core.
import * as THREE from 'three';
import { swatchUV, REGION } from './atlas.js';

export const LODS = {
  0: { arch: 6, nose: 2, curvePts: true, merge: 0.10, doorMid: true, wheelSeg: 12, rim: 5, mirrors: 'shaped', bar: 'full', grille: true, snorkel: 3, rack: 'full', steps: true, seams: true, tow: true, tailLamps: true },
  1: { arch: 5, nose: 1, curvePts: true, merge: 0.2, doorMid: true, wheelSeg: 8, rim: 5, mirrors: 'box', bar: 'simple', grille: true, snorkel: 1, rack: 'platform', steps: false, seams: false, tow: false, tailLamps: true },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, wheelSeg: 8, rim: 0, mirrors: 'box', bar: 'simple', grille: false, snorkel: 0, rack: 'simple', steps: false, seams: false, tow: false, tailLamps: false },
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
  // flat n-gon facing ±X (s), centred at c: one-sided, for wheel faces
  disc(c, s, r, n, sw, phase = 0) {
    const P = Array.from({ length: n }, (_, i) => { const t = phase + (i / n) * Math.PI * 2; return [c[0], c[1] + Math.cos(t) * r, c[2] + Math.sin(t) * r]; });
    for (let i = 1; i < n - 1; i++) if (s > 0) this.tri(P[0], P[i], P[i + 1], sw); else this.tri(P[0], P[i + 1], P[i], sw);
  }
  get tris() { return this.p.length / 9; }
}

// ───────────────────────── UV projections for the livery ─────────────────────────
const LEN = 5.3; // matches atlas.js: the side livery spans 5.3 m from the nose
function sideUV(P) { const [u0, v0, u1, v1] = REGION.side; return (v) => [u0 + (u1 - u0) * ((P.zNose - v[2]) / LEN), v0 + (v1 - v0) * (v[1] / 1.7)]; }
function topUV(P) { const [u0, v0, u1, v1] = REGION.top; return (v) => [u0 + (u1 - u0) * (v[0] / 1.9 + 0.5), v1 - (v1 - v0) * ((P.zNose - v[2]) / 1.7)]; }
// the canopy's sides: planar (z, y) over its own box, front edge at u0 (atlas.js draws the doors, seam and locks there)
function canopyUV(P, y0) { const [u0, v0, u1, v1] = REGION.canopy, C = P.canopy; return (v) => [u0 + (u1 - u0) * ((C.z0 - v[2]) / (C.z0 - C.z1)), v0 + (v1 - v0) * ((v[1] - y0) / (C.y1 - y0))]; }

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
  const sUV = sideUV(P), tUV = topUV(P);
  const segSwatch = (seg, zm) => {
    if (seg === 0) return 'under';
    if (seg === 1) return 'trim';
    if (seg === 4) return zm > zA ? tUV : zm < P.cabin.at(-1).z ? 'under' : 'paint'; // behind the cab it is under the tray deck
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
  cap(P.zNose, 'front', 1, 'paint'); cap(P.zTail, 'back', -1, 'under'); // the tray's black rear frame

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
  // the fascia's details are laid out with the grille's chrome header at 0.98 m; fy puts that header at the top of the nose face,
  // so the grille and headlights sit on the Triton's tall blunt front (br-bwju.8), below the bonnet's edge
  const fy = lerpCurve(P.ySh, P.zNose) - 1.0;
  const slopeQuad = (pts, sw, s = 1) => { const q = pts.map(([x, y]) => onSlope(s * x, y + fy)); if (s > 0) F.quad(q[0], q[1], q[2], q[3], sw); else F.quad(q[0], q[3], q[2], q[1], sw); };
  slopeQuad([[-0.46, 0.72], [0.46, 0.72], [0.54, 0.98], [-0.54, 0.98]], 'trim'); // grille: the MQ's tall trapezoid
  slopeQuad([[-0.54, 0.98], [0.54, 0.98], [0.55, 1.01], [-0.55, 1.01]], 'chrome'); // chrome grille header
  if (T.grille) for (let i = 0; i < 6; i++) { const x = -0.40 + i * 0.16; slopeQuad([[x - 0.025, 0.75], [x + 0.025, 0.75], [x + 0.025, 0.96], [x - 0.025, 0.96]], 'chrome'); } // the vertical slats
  for (const s of [1, -1]) slopeQuad([[0.58, 0.84], [0.88, 0.88], [0.89, 1.0], [0.58, 0.98]], 'head', s); // swept headlights
  // the "dynamic shield": a chrome sweep from the grille's lower corner out under each headlight
  if (T.grille) for (const s of [1, -1]) slopeQuad([[0.46, 0.72], [0.86, 0.82], [0.87, 0.86], [0.50, 0.77]], 'chrome', s);
  const ybN = lerpCurve(P.yBot, P.zNose);
  fq(-0.66, ybN + 0.07, 0.66, 0.62 + fy, 'trim'); // lower intake behind the bull bar
  const B = P.bar, bumpT = B.y0 + 0.20, bz = B.z + 0.05; // the bar's solid bumper: B.y0 - 0.06 up to bumpT, face at bz
  F.box(0, ybN + 0.01, P.zNose - 0.06, hwN * 2 + 0.06, 0.04, 0.22, 'trim'); // bash plate
  F.box(0, (B.y0 - 0.06 + bumpT) / 2, B.z - 0.02, B.hw * 2 + 0.30, bumpT - B.y0 + 0.06, 0.14, 'trim'); // the solid black bumper
  for (const s of [1, -1]) F.box(s * B.hw, (bumpT + B.y1) / 2, B.z, 0.08, B.y1 - bumpT, 0.08, 'trim'); // hoop uprights
  F.box(0, B.y1, B.z, B.hw * 2 + 0.08, 0.08, 0.08, 'trim'); // hoop top rail
  const bq0 = (x0, y0, x1, y1, sw) => F.quad([x0, y0, bz + 0.002], [x1, y0, bz + 0.002], [x1, y1, bz + 0.002], [x0, y1, bz + 0.002], sw);
  bq0(-0.22, B.y0 - 0.02, 0.22, B.y0 + 0.10, 'white'); // number plate
  if (T.bar === 'full') {
    F.box(0, bumpT + 0.06, B.z + 0.01, 0.84, 0.08, 0.07, { all: 'trim', pz: 'led' }); // light bar on the bumper, inside the hoop
    for (const s of [1, -1]) { bq0(s > 0 ? 0.52 : -0.62, B.y0 + 0.02, s > 0 ? 0.62 : -0.52, B.y0 + 0.12, 'fog'); // fog lamps
      F.box(s * (B.hw + 0.18), B.y0 + 0.08, B.z - 0.08, 0.08, 0.24, 0.10, 'trim', [0, 0, s * 0.5]); } // wing tips
    F.box(0.12, B.y0 - 0.10, bz + 0.04, 0.06, 0.07, 0.06, 'lime'); // the yellow winch hook
  } else {
    F.quad([-0.4, bumpT + 0.03, bz + 0.002], [0.4, bumpT + 0.03, bz + 0.002], [0.4, bumpT + 0.10, bz + 0.002], [-0.4, bumpT + 0.10, bz + 0.002], 'led');
  }

  // ── back (part: back): the flat tray, the owner's canopy on it, the tray's lamps and plate, tow bar ──
  // The tub under the deck is the tray's black frame and under-tray boxes (atlas.js draws them black behind the cab).
  const Bk = S('back'), zt = P.zTail - 0.004, hwT = lerpCurve(P.hw, P.zTail), deckY = lerpCurve(P.yCr, P.zTail), TR = P.tray, C = P.canopy;
  const trayLen = TR.z0 - TR.z1, trayMid = (TR.z0 + TR.z1) / 2, deckTop = deckY + 0.06;
  Bk.box(0, deckY + 0.03, trayMid, C.hw * 2 + 0.04, 0.06, trayLen + 0.08, 'under'); // the tray deck, wider than the cab
  const cUV = canopyUV(P, deckTop);
  Bk.box(0, (deckTop + C.y1) / 2, (C.z0 + C.z1) / 2, C.hw * 2, C.y1 - deckTop, C.z0 - C.z1, { all: 'canopy', px: cUV, nx: cUV, py: 'paint' }); // the canopy: black like the owner's, its lid in the seat colour so the chase cam sees whose it is
  const bq = (x0, y0, x1, y1, sw) => Bk.quad([x1, y0, zt], [x0, y0, zt], [x0, y1, zt], [x1, y1, zt], sw);
  if (T.tailLamps) for (const s of [1, -1]) { // the tray's combination lamps: amber, white, red from the middle out
    for (const [a, b, sw] of [[0.52, 0.62, 'indicator'], [0.62, 0.70, 'head'], [0.70, 0.94, 'tail']]) { const xa = s * hwT * a, xb = s * hwT * b; bq(Math.min(xa, xb), 0.96, Math.max(xa, xb), 1.08, sw); }
  }
  bq(-0.22, 0.74, 0.22, 0.86, 'white'); // number plate
  if (T.tow) { Bk.box(0, 0.42, zt - 0.06, 0.55, 0.10, 0.14, 'trim'); Bk.prism([0, 0.46, zt - 0.14], [0, 0.56, zt - 0.14], 0.04, 5, 'chrome', 'chrome'); }

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
  if (T.steps) for (const s of [1, -1]) S('core').box(s * (lerpCurve(P.hw, 0) + 0.07), lerpCurve(P.yBot, 0) + 0.02, (zA + zC) / 2, 0.16, 0.05, zA - zC - 0.1, { all: 'trim', py: 'chrome' }); // side steps
  if (T.snorkel) {
    const K = P.snorkel, ro = 0.045, x = K.x, pts = [[x, 1.18, K.zBase], [x, 1.50, K.zBase - 0.08], [x, K.yTop - 0.08, K.zTop + 0.04]];
    if (T.snorkel >= 3) { S('core').prism(pts[0], pts[1], ro, 4, 'trim', 'trim', Math.PI / 4); S('core').prism(pts[1], pts[2], ro, 4, 'trim', 'trim', Math.PI / 4); }
    else S('core').prism(pts[0], pts[2], ro, 4, 'trim', 'trim', Math.PI / 4);
    S('core').box(x, K.yTop, K.zTop + 0.04, 0.10, 0.14, 0.14, 'trim'); // the ram head
  }
  // The platform rack: rails, slats, a wind deflector over the windscreen and the rolled awning on the left (+X). The slats
  // bunch at the ends so the seat number painted on the roof (anchor roof_number) shows through the middle.
  if (T.rack) {
    const R = P.rack, zm = (R.z0 + R.z1) / 2, len = R.z0 - R.z1, Co = S('core');
    if (T.rack === 'full') {
      for (const s of [1, -1]) Co.box(s * R.hw, R.y, zm, 0.06, 0.06, len, 'trim'); // side rails
      for (const z of [R.z0 - 0.05, R.z0 - 0.20, R.z1 + 0.20, R.z1 + 0.05]) Co.box(0, R.y + 0.01, z, R.hw * 2, 0.03, 0.08, 'trim'); // slats
      for (const s of [1, -1]) for (const z of [R.z0 - 0.12, R.z1 + 0.12]) Co.box(s * (R.hw - 0.03), R.y - 0.06, z, 0.05, 0.10, 0.05, 'trim'); // feet
      Co.box(0, R.y + 0.03, R.z0 + 0.05, R.hw * 2, 0.12, 0.03, 'trim', [-0.6, 0, 0]); // wind deflector
      Co.prism([R.hw + 0.07, R.y + 0.03, R.z0 - 0.02], [R.hw + 0.07, R.y + 0.03, R.z1 + 0.02], 0.10, 6, 'awning', 'awning'); // the rolled awning
    } else {
      Co.box(0, R.y, zm, R.hw * 2, 0.05, len, 'trim'); // the rack as one flat platform
      if (T.rack === 'platform') Co.prism([R.hw + 0.07, R.y + 0.03, R.z0 - 0.02], [R.hw + 0.07, R.y + 0.03, R.z1 + 0.02], 0.10, 6, 'awning', 'awning');
    }
  }

  // ── wheels: tyre prism + rim disc (5-spoke at low res) ──
  const tyreR = P.wheelR / Math.cos(Math.PI / T.wheelSeg);
  for (const [id, z, s] of [['wheel_FL', P.zFA, 1], ['wheel_FR', P.zFA, -1], ['wheel_RL', P.zRA, 1], ['wheel_RR', P.zRA, -1]]) {
    const W = S(id), x = s * P.track, hw = P.wheelW / 2;
    W.prism([x - s * hw, P.wheelR, z], [x + s * hw, P.wheelR, z], tyreR, T.wheelSeg, 'tyre', 'tyre', Math.PI / T.wheelSeg);
    // black wheels with a machined silver lip: a silver ring (disc) under a black centre, and a silver hub cap
    if (T.rim) { const n = T.wheelSeg; W.disc([x + s * (hw + 0.006), P.wheelR, z], s, P.wheelR * 0.70, n, 'chrome', Math.PI / n); W.disc([x + s * (hw + 0.012), P.wheelR, z], s, P.wheelR * 0.60, n, 'rim', Math.PI / n); W.disc([x + s * (hw + 0.018), P.wheelR, z], s, P.wheelR * 0.16, T.rim, 'chrome'); }
    else W.disc([x + s * (hw + 0.006), P.wheelR, z], s, P.wheelR * 0.62, 6, 'chrome', Math.PI / 6); // LOD2: the wheel as one silver hexagon
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
