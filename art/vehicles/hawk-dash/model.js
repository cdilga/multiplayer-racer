// model.js: the low-poly Hawk Dash built from code (R81, R123, br-bwju.3): a caricatured Australian V8 sedan in the spirit
// of the Falcon XR8 Sprint. build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle
// arrays for the bake (tools/vehicles/bake.mjs). P comes from params.json, fitted to refs/lod-plus-1.png with
// tools/vehicles/fit (silhouette IoU in docs/evidence/br-bwju.3/).
//
// Frame: metres, +Z = nose, +Y up, origin on the ground between the axles (jj.vehicle.v1). +X is the car's LEFT, so door_FL
// and wheel_FL sit on +X. The driver sits on the right (cam_fp at −X).
//
// The body is the Cruz Missile's construction (two flat-shaded lofts, tub + greenhouse, sampled from smooth curves in P);
// what makes it a Hawk is its own proportions (longer, lower, longer bonnet) and details: the bonnet power bulge and two
// vents, the gaping hexagonal lower grille under a thin upper slot, swept narrow headlamps, vertical lamp slots in the bumper
// corners, wide wrap-around tail lamps, quad exhausts, a ducktail lip spoiler, and the twin stripes and side "C" stripe in
// the atlas (the top livery runs nose to tail, so the stripes cross bonnet, roof and boot).
// LOD changes only the sampling density and which details exist; part names and pivots are identical at every LOD.
// Damage parts: front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; everything else is core.
import * as THREE from 'three';
import { swatchUV, REGION, SPAN } from './atlas.js';

export const LODS = {
  0: { arch: 7, nose: 2, curvePts: true, merge: 0.08, doorMid: true, wheelSeg: 12, rim: 5, mirrors: 'shaped', spoiler: 'posts', vents: true, slots: true, exhaust: 'pipes', seams: true, splitter: true },
  1: { arch: 5, nose: 1, curvePts: true, merge: 0.2, doorMid: true, wheelSeg: 8, rim: 5, mirrors: 'box', spoiler: 'posts', vents: true, slots: true, exhaust: 'flat', seams: false, splitter: true },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, wheelSeg: 8, rim: 0, mirrors: 'box', spoiler: 'plate', vents: false, slots: false, exhaust: 'none', seams: false, splitter: false },
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
    if (seg === 4) return tUV; // bonnet, deck and boot carry the stripes
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
      const sw = (k === 0 ? c.side : c.roof) === 'paint' ? tUV : k === 0 ? c.side : c.roof; // painted roof carries the stripes
      if (s > 0) S('core').quad(a[k], b[k], b[k + 1], a[k + 1], sw); else S('core').quad(a[k], a[k + 1], b[k + 1], b[k], sw);
    }
  }

  // ── bays (dark, inside the shell; seen only when a panel is gone) ──
  const bay = (cx, cy, cz, sx, sy, sz) => S('core').box(cx, cy, cz, sx, sy, sz, 'bay');
  { const hwA = lerpCurve(P.hw, zA) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zA)) / 2 - 0.02, zA + 0.03, hwA * 2, lerpCurve(P.ySh, zA) - 0.36, 0.06); } // firewall
  { const hwC = lerpCurve(P.hw, zC) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zC)) / 2 - 0.02, zC - 0.03, hwC * 2, lerpCurve(P.ySh, zC) - 0.36, 0.06); } // rear bulkhead
  for (const s of [1, -1]) { const x = s * (lerpCurve(P.hw, 0) - 0.07); S('core').quad(...(s > 0 ? [[x, 0.3, zA], [x, 0.3, zC], [x, 1.05, zC], [x, 1.02, zA]] : [[x, 0.3, zC], [x, 0.3, zA], [x, 1.02, zA], [x, 1.05, zC]]), 'bay'); }

  // ── bonnet (part: front): the power bulge, a raised trapezoid that fades out toward the nose, and two vents ──
  const F = S('front');
  { const G = P.bulge, steps = [G.z1, (G.z0 + G.z1) / 2, G.z0], tH = (z) => G.h * Math.min(1, (G.z0 - z) / (G.z0 - G.z1) * 1.6);
    const sec = (z) => { const y = lerpCurve(P.yCr, z) - 0.004, h = tH(z); return [[-G.hw, y, z], [-G.hw + 0.1, y + h, z], [G.hw - 0.1, y + h, z], [G.hw, y, z]]; };
    for (let i = 0; i < steps.length - 1; i++) { const a = sec(steps[i]), b = sec(steps[i + 1]); for (let k = 0; k < 3; k++) F.quad(a[k], a[k + 1], b[k + 1], b[k], tUV); }
    const r = sec(G.z1); F.quad(r[0], r[3], r[2], r[1], tUV); } // the bulge's back face, at the windscreen
  if (T.vents) for (const s of [1, -1]) { const V = P.vents, x = s * V.x, y = lerpCurve(P.yCr, V.z) - (lerpCurve(P.yCr, V.z) - lerpCurve(P.ySh, V.z)) * (V.x / (lerpCurve(P.hw, V.z) - P.shoulderIn));
    F.box(x, y + 0.012, V.z, V.w, 0.03, V.l, { all: 'trim', py: 'grille' }, [0, s * 0.35, 0]); }

  // ── front fascia (part: front) ──
  const zn = P.zNose + 0.004, hwN = lerpCurve(P.hw, P.zNose);
  const fq = (x0, y0, x1, y1, sw, dz = 0) => F.quad([x0, y0, zn + dz], [x1, y0, zn + dz], [x1, y1, zn + dz], [x0, y1, zn + dz], sw);
  const ybN = lerpCurve(P.yBot, P.zNose), yTop = lerpCurve(P.ySh, P.zNose);
  // The fitted nose slope is only a few centimetres tall, so the lamps and the upper slot sit on the nose face; the bonnet's top
  // livery already carries the stripes over the slope.
  fq(-hwN * 0.50, yTop - 0.085, hwN * 0.50, yTop - 0.035, 'grille', 0.003); // thin upper slot
  for (const s of [1, -1]) {
    { const q = [[hwN * 0.56, yTop - 0.11], [hwN * 0.97, yTop - 0.05], [hwN * 0.97, yTop - 0.005], [hwN * 0.60, yTop - 0.045]].map(([x, y]) => [s * x, y, zn + 0.004]); // swept "hawk-eye" lamp, outer corner high
      if (s > 0) F.quad(q[0], q[1], q[2], q[3], 'head'); else F.quad(q[0], q[3], q[2], q[1], 'head'); }
    if (T.slots) fq(Math.min(s * hwN * 0.86, s * hwN * 0.94), ybN + 0.14, Math.max(s * hwN * 0.86, s * hwN * 0.94), yTop - 0.10, 'led', 0.002); // vertical corner lamp slots
  }
  // the gaping hexagonal lower grille, black mesh, framed in trim
  { const yb = ybN + 0.08, yt = yTop - 0.15, g = hwN * 0.80, poly = [[-g * 0.80, yb], [g * 0.80, yb], [g, (yb + yt) / 2], [g * 0.87, yt], [-g * 0.87, yt], [-g, (yb + yt) / 2]], c = [0, (yb + yt) / 2, zn + 0.002];
    for (let i = 0; i < poly.length; i++) { const [xa, ya] = poly[i], [xb, yb2] = poly[(i + 1) % poly.length]; F.tri(c, [xa, ya, zn + 0.002], [xb, yb2, zn + 0.002], 'grille'); }
    for (const s of [1, -1]) fq(Math.min(s * 0.04, s * 0.26), yt, Math.max(s * 0.04, s * 0.26), yTop, 'stripe', 0.002); }
  if (T.splitter) F.box(0, ybN + 0.01, P.zNose - 0.04, hwN * 2 + 0.08, 0.04, 0.24, 'trim');

  // ── rear (part: back) ──
  const Bk = S('back'), zt = P.zTail - 0.004, hwT = lerpCurve(P.hw, P.zTail), yshT = lerpCurve(P.ySh, P.zTail), ybT = P.yBot.at(-1)[1];
  const bq = (x0, y0, x1, y1, sw) => Bk.quad([x1, y0, zt], [x0, y0, zt], [x0, y1, zt], [x1, y1, zt], sw);
  for (const s of [1, -1]) {
    const xa = s * 0.30, xb = s * hwT * 0.99;
    if (s > 0) bq(xa, yshT - 0.17, xb, yshT - 0.04, 'tail'); else bq(xb, yshT - 0.17, xa, yshT - 0.04, 'tail'); // wide lamps
    if (s > 0) bq(0.04, yshT - 0.40, 0.26, yshT + 0.005, 'stripe'); else bq(-0.26, yshT - 0.40, -0.04, yshT + 0.005, 'stripe'); // stripes down the boot
    // the lamp wraps onto the rear quarter
    const z0 = P.zTail + 0.26, zz = P.zTail + 0.01, x0 = s * (lerpCurve(P.hw, z0) + 0.006), x1 = s * (lerpCurve(P.hw, zz) + 0.006);
    const yh = lerpCurve(P.ySh, zz) - P.sideDrop - 0.01, yl = yh - 0.12;
    if (s > 0) Bk.quad([x0, yl, z0], [x1, yl, zz], [x1, yh, zz], [x0, yh, z0], 'tail'); else Bk.quad([x0, yl, z0], [x0, yh, z0], [x1, yh, zz], [x1, yl, zz], 'tail');
  }
  bq(-hwT * 0.80, ybT, hwT * 0.80, ybT + 0.17, 'trim'); // diffuser band
  for (const s of [1, -1]) for (const x of [0.50, 0.66]) { // quad exhausts, a pair each side
    if (T.exhaust === 'pipes') Bk.prism([s * x, ybT + 0.09, zt + 0.06], [s * x, ybT + 0.09, zt - 0.05], 0.055, 6, 'chrome', 'under');
    else if (T.exhaust === 'flat') bq(s * x - 0.05, ybT + 0.04, s * x + 0.05, ybT + 0.14, 'chrome');
  }
  // ducktail lip spoiler on two short posts (a plain plate at LOD2)
  { const SP = P.spoiler, deck = lerpCurve(P.yCr, SP.z);
    Bk.box(0, SP.y, SP.z, SP.span * 2, 0.04, SP.chord, { all: 'trim', py: tUV }, [SP.tilt, 0, 0]);
    if (T.spoiler === 'posts') for (const s of [1, -1]) Bk.box(s * SP.span * 0.7, (deck + SP.y) / 2, SP.z, 0.05, SP.y - deck, 0.08, 'trim'); }

  // ── mirrors (core: they stay with the greenhouse): black caps ──
  const M = P.mirror;
  for (const s of [1, -1]) {
    const x = s * (lerpCurve(P.hw, M.z) - 0.05 + M.out / 2);
    S('core').box(x, M.y, M.z, M.out, M.h, M.l, 'trim', T.mirrors === 'shaped' ? [0, s * 0.15, 0] : null);
  }
  // door seams (L0): thin dark strips on the door edges
  if (T.seams) for (const s of [1, -1]) for (const z of [zA - 0.012, P.zB, zC + 0.012]) {
    const x = s * (lerpCurve(P.hw, z) + 0.003), y0 = Math.max(lerpCurve(P.yBot, z) + P.skirt, archY(z)) + 0.02, y1 = lerpCurve(P.ySh, z) - P.sideDrop - 0.01; // on the flat side wall only
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

  // ── interior blocks (P1-V03): what a missing panel shows, in vehicle space, the same at every LOD. Drawn only for a
  // car whose part exposes them (vehicle.json `interiors`), so an undamaged field never pays for them. ──
  { const I = S('interior_engine'), zm = (zA + P.zNose) / 2; // under the front piece
    I.box(0, 0.6, zm, 0.95, 0.4, 0.7, 'chrome'); I.box(0, 0.86, zm - 0.05, 0.6, 0.12, 0.45, { all: 'trim', py: 'chrome' }); }
  { const I = S('interior_cabin'); // behind the doors: two front seats and the rear bench
    for (const s of [1, -1]) I.box(s * 0.42, 0.72, (zA + P.zB) / 2 - 0.12, 0.5, 0.62, 0.5, 'trim');
    I.box(0, 0.7, (P.zB + zC) / 2 - 0.1, 1.3, 0.56, 0.48, 'trim'); }
  { const I = S('interior_boot'), zm = (zC + P.zTail) / 2; // under the back piece: the spare and a toolbox
    I.prism([0.25, 0.42, zm], [0.25, 0.62, zm], 0.3, 6, 'tyre', 'rim'); I.box(-0.45, 0.55, zm, 0.4, 0.25, 0.5, 'stripe'); }

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
