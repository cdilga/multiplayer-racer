// model.js: the low-poly Hawk Dash built from code (R81, R123; br-bwju.3, rebuilt against its sheet in br-bwju.11): a
// caricatured Australian V8 sedan in the spirit of the Falcon XR8 Sprint. Same spec and handling as the Lion President, a
// different body.
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs). P comes from params.json, fitted to refs/lod-plus-1.png with tools/vehicles/fit (silhouette
// IoU in docs/evidence/P1-V-hawk-curves/). Wheel/body reallocation: br-8h3u.11.1 (2026-10-25).
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
  0: { arch: 9, nose: 2, curvePts: true, merge: 0.08, doorMid: true, belly: true, dome: true, roofDome: true, wheelSeg: 12, bayBoxes: true, flare: 9, flareLip: true, flareEnds: true, cell: 0.1, lampCell: 0.06, lampOff: 0, lamps: 'full', intakeBars: 0, slots: true, splitter: true, vents: 4, bulge: true, windows: true, mirrors: 'stalk', wing: 'posts', tips: true, exhaust: 'rings', diffFins: 4, handles: true, skirts: true, seams: true, corners: true },
  1: { arch: 5, nose: 1, curvePts: true, merge: 0.25, doorMid: false, wheelSeg: 8, bayBoxes: false, flare: 5, flareLip: false, flareEnds: false, cell: 0.35, lampCell: 0.2, lampOff: 0.02, lamps: 'full', intakeBars: 0, slots: true, splitter: true, vents: 0, bulge: true, windows: true, mirrors: 'box', wing: 'posts', tips: false, exhaust: 'flat', diffFins: 0, handles: false, skirts: false, seams: false, corners: false },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, doorMid: false, wheelSeg: 8, bayBoxes: false, flare: 0, flareLip: false, flareEnds: false, cell: 0.35, lampCell: 0.25, lampOff: 0.025, lamps: 'flat', intakeBars: 0, slots: false, splitter: false, vents: -1, bulge: false, windows: 'flat', mirrors: 'wedge', wing: 'plate', tips: false, exhaust: 'flat', diffFins: 0, handles: false, skirts: false, seams: false, corners: false },
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

// ───────────────────────── triangle soup builder (non-indexed → flat shading) ─────────────────────────
class Soup {
  constructor() { this.p = []; this.uv = []; this.c = []; this.nc = []; }
  /** Draws fn's triangles as decoration the bake leaves out of the part's collider (mirrors, wing tips). */
  decor(fn) { const a = this.p.length / 3; fn(); this.nc.push([a, this.p.length / 3]); }
  tri(a, b, c, uv, col = 1) {
    if (Math.hypot(...cross(sub(b, a), sub(c, a))) < 1e-10) return; // clipped cells can end on an existing vertex
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
    let n = [0, 0, 0];
    for (let i = 1; i < pts.length - 1; i++) { n = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0])); if (Math.hypot(...n) >= 1e-10) break; }
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
  /** A closed slab between matching end polygons (diffuser, fins and wing tips). */
  slab(a, b, uv) { this.solid([a, b, ...a.map((p, i) => [p, a[(i + 1) % a.length], b[(i + 1) % b.length], b[i]])], uv); }
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
  if (T.doorMid) prot.push((zA + P.zB) / 2, (P.zB + zC) / 2); // a ring mid-door so a door has a curved mid-span
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
  // Spend the wheel savings on the visible section: a tucked sill, full flank, rolled shoulder and crowned deck.
  // Same loft construction as the AU Hawk; coarse tiers retain the section's endpoints.
  const ring0 = (z, s) => {
    const yb = lerpCurve(P.yBot, z), ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), hw = lerpCurve(P.hw, z);
    const ay = archY(z), lift = ay > 0 ? Math.max(yb, ay) : yb;
    const y2 = Math.max(lift + 0.03, yb + P.skirt), y3 = Math.max(y2 + 0.06, ysh - P.sideDrop);
    const endT = Math.min(1, (P.zNose-z)/.45, (z-P.zTail)/.45), tuck = .45 + .55 * endT;
    const pts = [[0, yb, z], [s * (hw - P.floorIn*tuck), lift, z], [s * (hw - (T.belly ? P.section.sillTuck*tuck : 0)), y2, z]];
    if (T.belly) pts.push([s * hw, y2 + (y3 - y2) * P.section.bellyT, z]);
    pts.push([s * (hw - P.section.upperTuck), y3, z], [s * (hw - P.shoulderIn), ysh, z]);
    if (T.dome) pts.push([s * (hw - P.shoulderIn) * P.section.deckX, ycr - (ycr - ysh) * P.section.deckDrop, z]);
    pts.push([0, ycr, z]);
    return pts;
  };
  const NR = 6 + (T.belly ? 1 : 0) + (T.dome ? 1 : 0), DECK = NR - 2 - (T.dome ? 1 : 0);
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
    if (y <= r[1][1]) return r[1][0];
    for (let k = 1; k < DECK; k++) if (y <= r[k + 1][1]) return mix(r[k], r[k + 1], (y - r[k][1]) / Math.max(1e-6, r[k + 1][1] - r[k][1]))[0];
    return r[DECK][0];
  };
  // the tub's top surface height at (x, z): the slope from the shoulder to the crown
  const deckY = (x, z) => { const r = ring(z, 1), xx = Math.abs(x); for (let k = DECK; k < NR - 1; k++) if (xx >= r[k + 1][0]) return mix(r[k + 1], r[k], Math.min(1, (xx - r[k + 1][0]) / (r[k][0] - r[k + 1][0])))[1]; return r.at(-1)[1]; };

  const soups = {}; const S = (id) => (soups[id] ??= new Soup());
  const hull = []; // Actual tub triangles, for the AU Hawk's decal ray-casts.
  const partOfTub = (zm, seg, s) => {
    if (zm > zA + 1e-6) return 'front';
    if (zm < zC - 1e-6) return 'back';
    if (seg >= 1 && seg < DECK) return (zm > P.zB ? 'door_F' : 'door_R') + (s > 0 ? 'L' : 'R'); // +X is the car's left
    return 'core';
  };
  const sUV = sideUV(P), tUV = topUV(P);
  const segSwatch = (seg) => (seg === 0 ? 'under' : seg === 1 ? 'trim' : seg >= DECK ? tUV : sUV);
  for (const s of [1, -1]) {
    for (let i = 0; i < Z.length - 1; i++) {
      const a = ring0(Z[i], s), b = ring0(Z[i + 1], s), zm = (Z[i] + Z[i + 1]) / 2;
      for (let k = 0; k < NR - 1; k++) {
        const so = S(partOfTub(zm, k, s));
        // winding: outward normals. ring order goes bottom→top on side s; for s>0 use (a_k, b_k, b_k+1, a_k+1)
        if (s > 0) so.quad(a[k], b[k], b[k + 1], a[k + 1], segSwatch(k)); else so.quad(a[k], a[k + 1], b[k + 1], b[k], segSwatch(k));
        hull.push([a[k], b[k], b[k + 1]], [a[k], b[k + 1], a[k + 1]]);
      }
    }
  }
  // end caps: nose (front) and tail (back) — fan over both sides' rings
  const capPoly = (z) => { const R = ring0(z, 1), Lr = ring0(z, -1); return [...R, ...Lr.slice(1, NR - 1).reverse()]; };
  const cap = (z, id, sign, sw) => {
    if (lod === 0) {
      // Sculpt the bumper and boot across both axes; a single fan left a big flat panel between the lamps.
      const outline = capPoly(z).map(([x, y]) => [x, y]), profile = sign > 0 ? P.section.fascia : P.section.tail;
      const hw = lerpCurve(P.hw, z), xs = P.section.capXs.map((x) => x * hw), ys = [...new Set(outline.map((p) => p[1]).concat(profile.map((p) => p[0])))].sort((a, b) => a - b);
      const widthAt = (y) => { let w = 0; for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; if (Math.abs(y - a[1]) < 1e-8) w = Math.max(w, Math.abs(a[0])); if ((a[1] < y) !== (b[1] < y)) w = Math.max(w, Math.abs(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]))); } return w; };
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
        const pc = clip(clip(clip(clip(outline, xs[i], 1), xs[i + 1], -1), ys[j], 1, 1), ys[j + 1], -1, 1);
        if (pc.length < 3) continue;
        const pts = pc.map(([x, y]) => { const w = widthAt(y), fade = w > 1e-6 ? Math.max(0, 1 - (x / w) ** 2) : 0; return [x, y, z + sign * lerpCurve(profile, y) * fade]; });
        // Triangulate once: decoration must use the identical planes, including on the rear cap.
        for (let k = 1; k < pts.length - 1; k++) { const tri = [pts[0], pts[k], pts[k + 1]]; S(id).face(tri, sw, [0, 0, sign]); hull.push(tri); }
      }
      return;
    }
    const poly = capPoly(z);
    S(id).face(poly, sw, [0, 0, sign]);
    for (let i = 1; i < poly.length - 1; i++) hull.push([poly[0], poly[i], poly[i + 1]]);
  };
  cap(P.zNose, 'front', 1, 'paint'); cap(P.zTail, 'back', -1, 'paint');

  // ── decals on the nose and tail: a polygon measured in the sheet's front (dir 1) or rear (dir −1) view, in metres (x
  // across the car, the rear view's x mirrored so +x is still the car's left; y up), projected along the car's axis onto
  // the tub and lifted off it by `off` along the surface normal. It is cut into T.cell cells so it follows the curve. ──
  const inEnd = (tri, dir) => dir > 0 ? tri.every((p) => p[2] >= zA - 1e-6) : tri.every((p) => p[2] <= zC + 1e-6);
  const ray = (o, d) => {
    let best = null;
    for (const tri of hull) {
      if (!inEnd(tri, -d[2])) continue; // a lamp cannot project through a quarter onto a door or the opposite bumper
      const [a, b, c] = tri;
      const e1 = sub(b, a), e2 = sub(c, a), pv = cross(d, e2), det = dot(e1, pv);
      if (Math.abs(det) < 1e-12) continue;
      const iv = 1 / det, tv = sub(o, a), u = dot(tv, pv) * iv; if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qv = cross(tv, e1), v = dot(d, qv) * iv; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const t = dot(e2, qv) * iv; if (t > 1e-6 && (!best || t < best.t)) best = { t, n: cross(e1, e2) };
    }
    if (!best) return null;
    const L = Math.hypot(...best.n) || 1; let n = best.n.map((x) => x / L); if (dot(n, d) > 0) n = n.map((x) => -x);
    return { p: o.map((v, i) => v + d[i] * best.t), n };
  };
  // Clip decoration to the actual visible facets. Grid decals bridged bumper recesses and disappeared into the skin;
  // a facet owns its exact polygon now, with a constant view-axis offset so adjacent pieces meet without cracks.
  const decal = (so, poly, sw, off, dir, cell = T.cell) => {
    const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const clipPoly = (poly, boundary) => {
      const sign = Math.sign(boundary.reduce((sum,a,i) => { const b=boundary[(i+1)%boundary.length]; return sum+a[0]*b[1]-b[0]*a[1]; },0));
      let pc = poly;
      for (let e = 0; e < boundary.length && pc.length >= 3; e++) {
        const a = boundary[e], b = boundary[(e + 1) % boundary.length], out = [];
        for (let i = 0; i < pc.length; i++) {
          const p = pc[i], q = pc[(i + 1) % pc.length], dp = area(a, b, p) * sign, dq = area(a, b, q) * sign;
          if (dp >= -1e-9) out.push(p);
          if ((dp >= -1e-9) !== (dq >= -1e-9)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
        }
        pc = out;
      }
      return pc;
    };
    const zEnd = dir > 0 ? P.zNose : P.zTail;
    // At distance these are deliberately flat fascia graphics. One continuous polygon avoids grid holes.
    if (lod > 0 && sw !== 'head') {
      const pc = sw === 'stripe' ? clipPoly(poly, capPoly(zEnd).map(([x,y]) => [x,y])) : poly;
      if (pc.length >= 3) so.face(pc.map(([x,y]) => [x,y,zEnd+dir*off]), sw, [0,0,dir]);
      return;
    }
    // Coarse end caps are one plane. Clip once to their outline rather than paying for their fan's internal edges.
    // This keeps lamps and stripes continuous without a grid bridging onto a different quarter-panel plane.
    if (lod > 0) {
      const pc = clipPoly(poly, capPoly(zEnd).map(([x,y]) => [x,y]));
      if (pc.length >= 3) so.face(pc.map(([x,y]) => [x,y,zEnd+dir*off]), sw, [0,0,dir]);
    }
    for (const tri of hull) {
      if (!inEnd(tri, dir) || (lod > 0 && tri.every((p) => Math.abs(p[2]-zEnd)<1e-8))) continue;
      const det = area(...tri); if (Math.abs(det) < 1e-10) continue;
      const pc = clipPoly(poly, tri);
      if (pc.length < 3) continue;
      const at = (p) => { const u = area(tri[0], p, tri[2]) / det, v = area(tri[0], tri[1], p) / det; return [p[0], p[1], tri[0][2] + u * (tri[1][2] - tri[0][2]) + v * (tri[2][2] - tri[0][2])]; };
      const centre = pc.reduce((a, p) => a.map((v, k) => v + p[k] / pc.length), [0, 0]);
      const hit = ray([centre[0], centre[1], dir > 0 ? P.zNose + 1 : P.zTail - 1], [0, 0, -dir]);
      if (!hit || Math.abs(hit.p[2] - at(centre)[2]) > 1e-5) continue;
      so.face(pc.map((p) => { const q = at(p); q[2] += dir * off; return q; }), sw, [0, 0, dir]);
    }
  };
  const mirrorX = (poly) => poly.map(([x, y]) => [-x, y]).reverse();
  const expandLamp = (poly, w) => { const c = poly.reduce((a,p) => a.map((v,k)=>v+p[k]/poly.length),[0,0]); return poly.map(([x,y]) => [x + Math.sign(x-c[0])*w, y + Math.sign(y-c[1])*w]); };
  const both = (fn) => { for (const s of [1, -1]) fn(s, (poly) => (s > 0 ? poly : mirrorX(poly))); };

  // ── greenhouse: ring per cabin station, one side: base (belt) → glass top → roof edge → crown. The sides are painted
  // (the A and C pillars); the side glass is laid over them below. A station with yr null is the windscreen base or the
  // backlight foot: its ring lies flat on the body. Each station's `roof` says what the span behind it is: glass (the
  // windscreen, the backlight) or the painted roof, which carries the stripes. ──
  const cring = (c, s) => {
    const yb = lerpCurve(P.ySh, c.z) - 0.005;
    const yc = c.yr == null ? Math.max(yb, lerpCurve(P.yCr, c.z) - 0.005) : c.yr;
    const edge = c.yr == null ? c.wt - P.roofCh : c.wt - P.roofCh * 1.2;
    const pts = [[s * c.wb, yb, c.z], [s * c.wt, c.yr == null ? yb + 0.002 : yc - P.roofCh, c.z], [s * edge, yc, c.z]];
    // A second transverse facet gives the roof and glass a crown instead of a central tent ridge.
    if (T.roofDome) pts.push([s * edge * 0.55, yc + (c.yr == null ? 0 : P.roofCrown * 0.8), c.z]);
    pts.push([0, yc + (c.yr == null ? 0 : P.roofCrown), c.z]);
    // Bow the glass across the car in plan view; a ruler-straight lower windscreen was conspicuous from above.
    return pts.map((p, i) => i < 2 ? p : [p[0], p[1], p[2] + (c.bow ?? 0) * (1 - (p[0] / edge) ** 2)]);
  };
  const C = P.cabin.filter((c) => c.detail == null || lod <= c.detail), nC = C.length;
  const glassUV = (front) => {
    const base = front ? C[0].z : C.at(-1).z, top = front ? C.find((c) => c.roof === 'paint').z : C.find((c) => c.z < -1 && c.roof === 'glass').z;
    const [u0, v0, u1, v1] = REGION[front ? 'windscreen' : 'backlight'];
    return (v) => { let i = 0; while (i < nC - 2 && C[i + 1].z > v[2]) i++; const a = C[i], b = C[i + 1], t = Math.min(1, Math.max(0, (a.z - v[2]) / (a.z - b.z))), w = a.wt + (b.wt - a.wt) * t - P.roofCh * 1.2; return [u0 + (u1 - u0) * Math.min(1, Math.max(0, (v[0] / w + 1) / 2)), v0 + (v1 - v0) * Math.min(1, Math.max(0, (v[2] - base) / (top - base)))]; };
  };
  const frontGlassUV = glassUV(true), rearGlassUV = glassUV(false);
  for (const s of [1, -1]) for (let i = 0; i < nC - 1; i++) {
    const c = C[i], a = cring(c, s), b = cring(C[i + 1], s), roof = c.roof === 'paint';
    for (let k = 0; k < a.length - 1; k++) {
      const sw = k === 0 ? sUV : roof ? tUV : k === 1 ? sUV : c.z > 0 ? frontGlassUV : rearGlassUV;
      if (s > 0) S('core').quad(a[k], b[k], b[k + 1], a[k + 1], sw); else S('core').quad(a[k], a[k + 1], b[k + 1], b[k], sw);
    }
  }
  // a point on the greenhouse side at (z, t): t = 0 at the belt, 1 at the glass top; pushed out by `off`
  const ghPoint = (z, t, s, off) => {
    let i = 0; while (i < nC - 2 && C[i + 1].z > z) i++;
    const c0 = C[i], c1 = C[i + 1], u = Math.min(1, Math.max(0, (c0.z - z) / (c0.z - c1.z)));
    // Match the actual triangulated side (AU Hawk's fix), rather than a bilinear patch that sinks through it.
    const a = cring(c0, s), b = cring(c1, s), [a0, a1, b0, b1] = [a[0], a[1], b[0], b[1]], tt = Math.min(1, Math.max(0, t));
    const lower = tt <= u, p = lower ? [0, 1, 2].map((k) => a0[k] + u * (b0[k] - a0[k]) + tt * (b1[k] - b0[k])) : [0, 1, 2].map((k) => a0[k] + u * (b1[k] - a1[k]) + tt * (a1[k] - a0[k]));
    const n = lower ? cross(sub(b0, a0), sub(b1, a0)) : cross(sub(b1, a0), sub(a1, a0)); const L = Math.hypot(...n) || 1; const sg = Math.sign(n[0]) === s ? 1 : -1;
    return p.map((v, k) => v + sg * n[k] / L * off);
  };
  // ── side glass: one black frame over the whole glazed band, then the three panes (front door, rear door, quarter) ──
  const W = P.windows;
  if (T.windows) for (const s of [1, -1]) {
    // a (z, t) polygon, cut at every cabin station so each piece lies flat on its own span of the greenhouse
    const poly = (pts, off, sw) => { for (let i = 0; i < nC - 1; i++) {
      const piece = clipZ(clipZ(pts, C[i].z, -1), C[i + 1].z, 1);
      // The side quad is two planes. Split the glass on precisely the same diagonal so no painted triangle pokes through.
      for (const side of [-1, 1]) {
        const distance = ([z, t]) => side * (t - (C[i].z - z) / (C[i].z - C[i + 1].z)), out = [];
        for (let k = 0; k < piece.length; k++) {
          const a = piece[k], b = piece[(k + 1) % piece.length], da = distance(a), db = distance(b);
          if (da >= -1e-9) out.push(a);
          if ((da >= -1e-9) !== (db >= -1e-9)) { const u = da / (da - db); out.push(a.map((v, j) => v + (b[j] - v) * u)); }
        }
        if (out.length >= 3) S('core').face(out.map(([z, t]) => ghPoint(z, t, s, off)), sw, [s, 0.3, 0]);
      }
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
  if (T.bulge) { const G = P.bulge, steps = lod === 0 ? G.profile.map(([t]) => G.z1 + t * (G.z0 - G.z1)) : [G.z1, (G.z0 + G.z1) / 2, G.z0];
    const sec = (z) => {
      if (lod !== 0) { const y = lerpCurve(P.yCr, z) - 0.004, h = G.h * Math.min(1, (G.z0 - z) / (G.z0 - G.z1) * 1.6); return [[-G.hw, y, z], [-G.hw + 0.1, y + h, z], [G.hw - 0.1, y + h, z], [G.hw, y, z]]; }
      const t = (z - G.z1) / (G.z0 - G.z1), row = G.profile.find(([k]) => Math.abs(k - t) < 1e-6), w = G.hw * row[1], h = G.h * row[2];
      return G.section.map(([x, y]) => [x * w, deckY(x * w, z) + 0.004 + h * y, z]);
    };
    for (let i = 0; i < steps.length - 1; i++) { const a = sec(steps[i]), b = sec(steps[i + 1]); for (let k = 0; k < a.length - 1; k++) F.face([a[k], a[k + 1], b[k + 1], b[k]], tUV, [0, 1, 0]); }
    F.face(sec(G.z1), tUV, [0, 0, -1]); }
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
  for (const s of [1, -1]) decal(F, s > 0 ? Fr.stripe : mirrorX(Fr.stripe), 'stripe', 0.004, 1);
  // the black upper grille: a long hexagon between the lamps, framed in trim
  decal(F, Fr.grille, 'trim', 0.006, 1);
  decal(F, Fr.grilleIn, 'grille', 0.009, 1);
  // the big lower intake, its mesh drawn as horizontal bars at LOD0
  decal(F, Fr.intake, 'grille', 0.006, 1);
  for (let i = 0; i < T.intakeBars; i++) { const [y0, y1] = [Fr.intake[3][1], Fr.intake[0][1]], y = y0 + (y1 - y0) * (i + 1) / (T.intakeBars + 1), w = Math.abs(Fr.intake[2][0]) - 0.03;
    decal(F, [[-w, y - 0.008], [w, y - 0.008], [w, y + 0.008], [-w, y + 0.008]], 'trim', 0.01, 1); }
  // the swept headlamps: a dark rim and the lamp itself, wrapping round the corner onto the wing
  both((s, m) => {
    if (lod === 0) decal(F, m(expandLamp(Fr.lamp,.008)), 'trim', .008, 1);
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
    const y0 = Math.max(lerpCurve(P.yBot, z) + P.skirt, archY(z)) + 0.02, y1 = lerpCurve(P.ySh, z) - 0.01;
    const ys = [y0, ...ring(z, s).slice(2, DECK + 1).map((p) => p[1]).filter((y) => y > y0 && y < y1), y1];
    for (let i = 0; i < ys.length - 1; i++) {
      const edge = (y, dz) => [skinX(z + dz, y, s) + s * 0.003, y, z + dz];
      S('core').face([edge(ys[i], .006), edge(ys[i], -.006), edge(ys[i+1], -.006), edge(ys[i+1], .006)], 'trim', [s, 0, 0]);
    }
  }

  // ── rear (part: back): measured off the sheet's rear view, projected onto the tail ──
  const Bk = S('back'), zt = P.zTail, Rr = P.rear;
  for (const s of [1, -1]) decal(Bk, s > 0 ? Rr.stripe : mirrorX(Rr.stripe), 'stripe', 0.004, -1);
  // the tail lamps: a red lamp, its smoked centre, wrapping onto the quarter
  both((s, m) => {
    if (lod === 0) decal(Bk, m(expandLamp(Rr.lamp,.008)), 'trim', .006, -1);
    decal(Bk, m(Rr.lamp), 'tail', 0.008 + T.lampOff, -1, T.lampCell);
    if (T.lamps === 'full') decal(Bk, m(Rr.lampIn), 'taildk', 0.012 + T.lampOff, -1, T.lampCell);
  });
  if (lod === 0) {
    const seam = [[-.58,1.01],[-.53,.77],[-.47,.715],[.47,.715],[.53,.77],[.58,1.01]];
    for (let i=0;i<seam.length-1;i++) {
      const [a,b]=[seam[i],seam[i+1]], dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),w=.003;
      decal(Bk, [[a[0]-dy/len*w,a[1]+dx/len*w],[b[0]-dy/len*w,b[1]+dx/len*w],[b[0]+dy/len*w,b[1]-dx/len*w],[a[0]+dy/len*w,a[1]-dx/len*w]], 'trim', .007,-1);
    }
  }
  // Sculpted six-sided exhaust surround: painted lip, dark bevel, recessed black centre.
  // Keep the broad bottom and angled top corners visible from the rear and three-quarter view.
  { const D = Rr.diffuser;
    const outline = [[-D.w,D.y0],[-D.w+.035,D.y1-.055],[-D.w+D.corner,D.y1],[D.w-D.corner,D.y1],[D.w-.035,D.y1-.055],[D.w,D.y0]];
    const inner = [[-D.w+D.rim,D.y0],[-D.w+.035+D.rim,D.y1-.065],[-D.w+D.corner+D.rim,D.y1-D.rim],[D.w-D.corner-D.rim,D.y1-D.rim],[D.w-.035-D.rim,D.y1-.065],[D.w-D.rim,D.y0]];
    const lip = outline.map(([x,y]) => [x,y,zt-.045]);
    const outer = outline.map(([x,y]) => [x*1.035,y + (y>D.y0 ? .032 : 0),zt-.015]);
    if (lod < 2) for (let i=0;i<outline.length-1;i++) Bk.face([outer[i],outer[i+1],lip[i+1],lip[i]],'paint',[0,0,-1]);
    const inset = inner.map(([x,y]) => [x,y,zt-.025]);
    if (lod === 0) for (let i=0;i<outline.length-1;i++) Bk.face([lip[i],lip[i+1],inset[i+1],inset[i]],'trim',[0,0,-1]);
    Bk.slab(inset, inner.map(([x,y]) => [x,y,zt+D.l]), 'under');
    for (let i = 0; i < T.diffFins; i++) { const x = Rr.finX[i % Rr.finX.length] * (i < Rr.finX.length ? 1 : -1), w = 0.012, d = 0.05, y0 = D.y0 + 0.02, y1 = D.y1 - 0.02;
      Bk.slab([[x - w, y0, zt - 0.03], [x - w, y1, zt - 0.03], [x - w, y1, zt - 0.03 - d * 0.5], [x - w, y0, zt - 0.03 - d]], [[x + w, y0, zt - 0.03], [x + w, y1, zt - 0.03], [x + w, y1, zt - 0.03 - d * 0.5], [x + w, y0, zt - 0.03 - d]], 'trim'); }
    for (const s of [1, -1]) for (const x of Rr.pipeX) {
      const c = [s * x, Rr.pipeY, zt - 0.03], r0 = Rr.pipeR;
      if (T.exhaust === 'rings') {
        const n = 6, ring2 = (rr, dz) => Array.from({ length: n }, (_, i) => { const a = Math.PI * 2 * i / n; return [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, c[2] - dz]; });
        const o = ring2(r0, 0.05), o0 = ring2(r0, 0), inn = ring2(r0 * 0.7, 0.05), deep = ring2(r0 * 0.7, 0.02);
        for (let i = 0; i < n; i++) { const j = (i + 1) % n;
          Bk.face([o0[i], o0[j], o[j], o[i]], 'chrome', sub(mix(o[i], o[j], 0.5), [c[0], c[1], c[2] - 0.05])); // the pipe
          Bk.face([o[i], o[j], inn[j], inn[i]], 'chrome', [0, 0, -1]); } // its rim
        Bk.face(deep, 'under', [0, 0, -1]); // and its dark bore
      } else if (T.exhaust === 'flat') {
        // At the smallest tier each pipe is a single silver facet; keep all four outlets.
        const face = lod === 2
          ? [[c[0] - r0, c[1] - r0, c[2] - 0.004], [c[0] + r0, c[1] - r0, c[2] - 0.004], [c[0], c[1] + r0, c[2] - 0.004]]
          : [[c[0] - r0, c[1] - r0, c[2] - 0.004], [c[0] + r0, c[1] - r0, c[2] - 0.004], [c[0] + r0, c[1] + r0, c[2] - 0.004], [c[0] - r0, c[1] + r0, c[2] - 0.004]];
        Bk.face(face, 'chrome', [0, 0, -1]);
      }
    }
    }
  // the wing: a body-colour blade on two short black posts, its tips turned down (a plain plate on the deck at LOD2)
  { const SP = P.spoiler, xs = SP.span * SP.postX;
    Bk.box(0, SP.y, SP.z, SP.span * 2, 0.035, SP.chord, { all: 'trim', py: tUV, pz: sUV, nz: sUV }, [SP.tilt, 0, 0]);
    if (T.tips) for (const s of [1, -1]) Bk.decor(() => Bk.slab(
      [[s * SP.span, SP.y + 0.015, SP.z + SP.chord / 2], [s * SP.span, SP.y + 0.015, SP.z - SP.chord / 2], [s * (SP.span + 0.05), SP.y - SP.tipDrop, SP.z - SP.chord / 2 + 0.03], [s * (SP.span + 0.05), SP.y - SP.tipDrop, SP.z + SP.chord / 2 - 0.05]],
      [[s * SP.span, SP.y - 0.02, SP.z + SP.chord / 2], [s * SP.span, SP.y - 0.02, SP.z - SP.chord / 2], [s * (SP.span + 0.035), SP.y - SP.tipDrop - 0.01, SP.z - SP.chord / 2 + 0.03], [s * (SP.span + 0.035), SP.y - SP.tipDrop - 0.01, SP.z + SP.chord / 2 - 0.05]],
    sUV));
    if (T.wing === 'posts') for (const s of [1, -1]) { const x = s * xs, deck = deckY(x, SP.z); Bk.beam([x, deck - 0.01, SP.z + 0.02], [x, SP.y, SP.z], 0.035, 0.07, 'trim', [1, 0, 0]); }
  }

  // ── mirrors (core: they stay with the greenhouse): big black angular heads on short stalks at the front of the side glass ──
  const M = P.mirror; // decoration: the collider stays the body's width
  for (const s of [1, -1]) S('core').decor(() => {
    const xb = skinX(M.z, M.y - 0.04, s), x0 = xb + s * M.stalk, x1 = x0 + s * M.out;
    if (T.mirrors === 'wedge') { const end = (z) => [[xb, M.y - M.h / 2, z], [xb, M.y + M.h / 2, z], [x1, M.y, z]]; S('core').slab(end(M.z - M.l / 2), end(M.z + M.l / 2), 'roofblack'); return; }
    if (T.mirrors === 'box') { S('core').box((xb + x1) / 2, M.y, M.z, Math.abs(x1 - xb), M.h, M.l, 'roofblack'); return; }
    S('core').beam([xb - s * 0.02, M.y - 0.045, M.z + 0.02], [x0 + s * 0.01, M.y - 0.02, M.z], 0.03, 0.05, 'roofblack', [0, 0, 1]);
    const f = (x, k) => [[x, M.y - M.h / 2, M.z + M.l / 2 * k], [x, M.y + M.h / 2, M.z + M.l / 2 * k - 0.01], [x, M.y + M.h / 2, M.z - M.l / 2], [x, M.y - M.h / 2 + 0.02, M.z - M.l / 2]];
    const a = f(x0, 1), b = f(x1, 0.4);
    S('core').solid([a, b, ...a.map((p, i) => [p, a[(i + 1) % 4], b[(i + 1) % 4], b[i]])], 'roofblack');
  });

  // ── wheels: closed faceted tyres; the rim lip, five spokes and hub live in the shared code-drawn atlas.
  // Geometry pays only for the outline, tread and both sidewalls (including detached wheels' inner faces).
  // Circumradius makes the inscribed radius wheelR, so a bottom flat touches the ground.
  const n = T.wheelSeg, tyreR = P.wheelR / Math.cos(Math.PI / n);
  for (const [id, zc, s] of [['wheel_FL', P.zFA, 1], ['wheel_FR', P.zFA, -1], ['wheel_RL', P.zRA, 1], ['wheel_RR', P.zRA, -1]]) {
    const Wh = S(id), xw = s * P.track, xo = xw + s * P.wheelW / 2, xi = xw - s * P.wheelW / 2, yc = P.wheelR;
    const ringAt = (x) => Array.from({ length: n }, (_, i) => { const a = 1.5 * Math.PI - Math.PI / n + i * Math.PI * 2 / n; return [x, yc + Math.sin(a) * tyreR, zc + Math.cos(a) * tyreR]; });
    const to = ringAt(xo), ti = ringAt(xi);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([ti[i], ti[j], to[j], to[i]], 'tyre', sub(mix(to[i], to[j], 0.5), [xo, yc, zc])); }
    const [u0, v0, u1, v1] = REGION.wheelFace;
    Wh.face(ti, 'tyre', [-s, 0, 0]);
    Wh.face(to, (p) => [u0 + (u1 - u0) * ((p[2] - zc) / tyreR + 1) / 2, v0 + (v1 - v0) * ((p[1] - yc) / tyreR + 1) / 2], [s, 0, 0]);
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
