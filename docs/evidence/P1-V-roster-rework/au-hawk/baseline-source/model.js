// model.js: the low-poly AU Hawk built from code (R81; br-bwju.12): a bubbly caricature of the 1998 series-1 Ford AU Falcon
// sedan, built to refs/lod-plus-1.png (round 2: a literal AU, checked with the recognition prompt before modelling; see
// refs/sheets.json and docs/evidence/P1-V-au-hawk/recognition.md).
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs). P comes from params.json, fitted to the sheets with tools/vehicles/fit.
//
// Frame: metres, +Z = nose, +Y up, origin on the ground between the axles (jj.vehicle.v1). +X is the car's LEFT, so door_FL
// and wheel_FL sit on +X. The driver sits on the right (cam_fp at −X).
//
// The body is two flat-shaded lofts (tub + greenhouse) sampled from smooth curves in P. The tub's ring has a tumblehome: the
// flank swells out to its full width at the belly line and tucks in above and below it, so the sides read round (the AU's
// "jellybean" body), not as slab doors. What makes it an AU is measured off the sheet:
//   - face: one big swept teardrop headlamp on each corner, wrapping back into the guard; between them the oval fish-mouth
//     grille, black, with a single body-colour bar across it and a small plain oval badge on the bar (a blank oval: no
//     lettering, no brand colours, R81); a flush round bumper with a thin black slot and two round fog lamps;
//   - body: a long round bonnet falling to the nose, a high round roof over a tall glasshouse with thin black pillars, a short
//     high boot with a winged spoiler on two posts, black mirrors;
//   - rear: rounded triangular tail lamps that wrap round the corners (red, a white reverse lamp inboard), a plain oval badge
//     on the boot lid between them;
//   - wheels: silver 5-spoke rims.
// Lamps, grille, bar, badges and tail lamps are decals: a polygon measured in the sheet's front, rear or top view, cut into
// small cells, each corner ray-cast onto the tub along the view axis and lifted off it along the surface normal, so a lamp
// wraps round a curved corner the way the sheet's does. They exist at every LOD (LOD2 keeps the lamps, grille, bar and both
// badges as shapes).
// LOD changes only the sampling density and which details exist; part names and pivots are identical at every LOD.
// Damage parts: front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; everything else is core.
import * as THREE from 'three';
import { swatchUV, REGION, SPAN } from './atlas.js';

export const LODS = {
  0: { arch: 9, nose: 3, curvePts: true, merge: 0.08, doorMid: true, belly: true, dome: true, wheelSeg: 12, rim: 'flat', bayBoxes: true, hub: false, tyreCap: false, cell: 0.1, lampCell: 0.12, lampOff: 0, oval: 16, lampRim: false, reflector: 0, lampTop: false, fog: 8, slot: true, reverse: true, windows: true, paneCuts: 4, mirrors: 'stalk', posts: false, handles: true, seams: true },
  1: { arch: 4, nose: 1, curvePts: true, merge: 0.4, doorMid: false, belly: true, dome: true, wheelSeg: 6, rim: 'flat', bayBoxes: false, hub: false, tyreCap: false, cell: 0.4, lampCell: 0.18, tailCell: 0.26, grilleCell: 0.22, lampOff: 0.03, oval: 14, badge: 10, lampRim: false, reflector: 0, lampTop: false, fog: 6, slot: true, reverse: true, windows: true, mirrors: 'box', posts: false, handles: false, seams: false },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, doorMid: false, belly: false, wheelSeg: 8, rim: 'disc', bayBoxes: false, hub: false, tyreCap: false, cell: 0.5, lampCell: 0.24, grilleCell: 0.22, lampOff: 0.045, oval: 10, badge: 6, lampRim: false, reflector: 0, lampTop: false, fog: 0, slot: false, reverse: false, windows: 'flat', mirrors: 'box', posts: false, handles: false, seams: false },
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
/** An ellipse as an n-gon, [x, y] pairs. */
const oval = (c, rx, ry, n) => Array.from({ length: n }, (_, i) => [c[0] + rx * Math.cos(2 * Math.PI * (i + 0.5) / n), c[1] + ry * Math.sin(2 * Math.PI * (i + 0.5) / n)]);

// ───────────────────────── triangle soup builder (non-indexed → flat shading) ─────────────────────────
class Soup {
  constructor() { this.p = []; this.uv = []; this.c = []; this.nc = []; }
  /** Draws fn's triangles as decoration the bake leaves out of the part's collider (mirrors). */
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

// ───────────────────────── UV projections for the paint ─────────────────────────
function sideUV(P) { const [u0, v0, u1, v1] = REGION.side; return (v) => [u0 + (u1 - u0) * ((P.zNose - v[2]) / SPAN.side[0]), v0 + (v1 - v0) * (v[1] / SPAN.side[1])]; }
function topUV(P) { const [u0, v0, u1, v1] = REGION.top; return (v) => [u0 + (u1 - u0) * ((P.zNose - v[2]) / SPAN.top[0]), v0 + (v1 - v0) * (v[0] / SPAN.top[1] + 0.5)]; }

// ───────────────────────── build ─────────────────────────
function makeSoups(P, lod) {
  const T = LODS[lod];
  const zA = P.zFA - P.archR, zC = P.zRA + P.archR; // door span = between the arches; front/back cut lines
  // stations along z (descending: nose → tail)
  // protected = ends, cut lines, arch samples, the nose and tail slopes; optional = profile control points (dropped when
  // within T.merge of a kept station, so coarse tiers don't pay for near-duplicate rings)
  const prot = [P.zNose, P.zTail, zA, zC, P.zB];
  for (let i = 1; i <= T.nose; i++) { prot.push(+(P.zNose - P.noseL * i / T.nose).toFixed(4)); prot.push(+(P.zTail + P.tailL * i / T.nose).toFixed(4)); }
  if (T.doorMid) prot.push((zA + P.zB) / 2, (P.zB + zC) / 2); // a ring mid-door so a door has vertices mid-span
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
  // tub ring, one side (s = ±1), from floor centre to crown centre: floor, sill, (belly at full width), upper flank,
  // shoulder, crown. The belly point is the tumblehome; LOD2 drops it and sets the flank halfway.
  const tk = T.belly ? 1 : 0.5;
  const ring0 = (z, s) => {
    const yb = lerpCurve(P.yBot, z), ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), hw = lerpCurve(P.hw, z);
    const ay = archY(z), lift = ay > 0 ? Math.max(yb, ay) : yb;
    const y2 = Math.max(lift + 0.03, yb + P.skirt), y3 = Math.max(y2 + 0.06, ysh - P.sideDrop);
    const pts = [[0, yb, z], [s * (hw - P.floorIn), lift, z], [s * (hw - P.tuck * tk), y2, z]];
    if (T.belly) pts.push([s * hw, y2 + (y3 - y2) * P.bellyT, z]);
    pts.push([s * (hw - (T.belly ? P.tuckTop : 0)), y3, z], [s * (hw - P.shoulderIn), ysh, z]); // (without the belly the flank top keeps the full width, so a door's hinge stays on its skin at every LOD)
    if (T.dome) pts.push([s * (hw - P.shoulderIn) * P.dome.x, ycr - (ycr - ysh) * P.dome.y, z]); // the domed bonnet, roof-side and boot
    pts.push([0, ycr, z]);
    // The arch clips the flank, not its original taper: prevent an upright guard bulge.
    for (let i = 1; i < pts.length - 1; i++) {
      const roll = Math.max(0, Math.min(1, (pts[i][1] - P.section.rollStart) / (ysh - P.section.rollStart)));
      pts[i][0] = s * Math.min(Math.abs(pts[i][0]), hw - P.shoulderIn * roll);
    }
    return pts;
  };
  const NR = 6 + (T.belly ? 1 : 0) + (T.dome ? 1 : 0), DECK = NR - 2 - (T.dome ? 1 : 0); // ring points; the shoulder point (deck segments from it to the crown)
  // the ring as the mesh draws it at any z: interpolated between the two stations either side
  const ring = (z, s) => {
    let i = 0; while (i < Z.length - 2 && Z[i + 1] > z) i++;
    if (Math.abs(z - Z[i]) < 1e-6) return ring0(Z[i], s);
    const a = ring0(Z[i], s), b = ring0(Z[i + 1], s), t = Math.min(1, Math.max(0, (Z[i] - z) / (Z[i] - Z[i + 1])));
    return a.map((p, k) => [p[0] + (b[k][0] - p[0]) * t, p[1] + (b[k][1] - p[1]) * t, z]);
  };
  // the tub's outer skin x at (z, y) on side s (between the sill and the shoulder)
  const skinX = (z, y, s) => {
    const r = ring(z, s);
    if (y <= r[1][1]) return r[1][0];
    for (let k = 1; k < DECK; k++) if (y <= r[k + 1][1]) return mix(r[k], r[k + 1], (y - r[k][1]) / Math.max(1e-6, r[k + 1][1] - r[k][1]))[0];
    return r[DECK][0];
  };

  const soups = {}; const S = (id) => (soups[id] ??= new Soup());
  const hull = []; // the tub's triangles, for the decal ray-casts
  const partOfTub = (zm, seg, s) => {
    if (zm > zA + 1e-6) return 'front';
    if (zm < zC - 1e-6) return 'back';
    if (seg >= 1 && seg < DECK) return (zm > P.zB ? 'door_F' : 'door_R') + (s > 0 ? 'L' : 'R'); // +X is the car's left
    return 'core';
  };
  const sUV = sideUV(P), tUV = topUV(P);
  const segSwatch = (seg) => (seg === 0 ? 'under' : seg >= DECK ? tUV : sUV);
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
  // end caps: nose (front) and tail (back), a fan over both sides' rings
  const capPoly = (z) => { const R = ring0(z, 1), Lr = ring0(z, -1); return [...R, ...Lr.slice(1, NR - 1).reverse()]; };
  const cap = (z, id, sign, sw) => {
    const poly = capPoly(z), c = [0, poly.reduce((t, v) => t + v[1], 0) / poly.length, z];
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; if (sign > 0) S(id).tri(c, p, q, sw); else S(id).tri(c, q, p, sw); hull.push([c, p, q]); }
  };
  cap(P.zNose, 'front', 1, 'paint'); cap(P.zTail, 'back', -1, 'paint');

  // ── decals: a polygon measured in the sheet's front view ((x, y), +x the car's left), rear view (likewise) or top view
  // ((x, z)), cut into cells; each cell corner is ray-cast onto the tub along the view axis and lifted by `off` along the
  // surface normal it lands on. A cell that misses the body is dropped. ──
  const AX = {
    front: { d: [0, 0, -1], o: (a, b) => [a, b, P.zNose + 1] },
    rear: { d: [0, 0, 1], o: (a, b) => [a, b, P.zTail - 1] },
    top: { d: [0, -1, 0], o: (a, b) => [a, 3, b] },
  };
  const ray = (o, d) => {
    let best = null;
    for (const [a, b, c] of hull) {
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
  // Clip graphics against the actual final facets. Subdividing an independent polygon into
  // rectangles left holes where its corners missed the rolled guard and crossed mesh diagonals.
  const decal = (so, poly, sw, off, ax) => {
    const dims = ax === 'top' ? [0, 2] : [0, 1], depth = ax === 'top' ? 1 : 2;
    const towards = ax === 'rear' ? -1 : 1;
    const clipEdge = (pts, a, b, sign) => {
      const side = p => sign * ((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
      const out = [];
      for (let i=0;i<pts.length;i++) {
        const p=pts[i],q=pts[(i+1)%pts.length],dp=side(p),dq=side(q);
        if(dp>=-1e-9)out.push(p);
        if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
      }
      return out;
    };
    for (const tri of hull) {
      const uv=tri.map(v=>dims.map(k=>v[k])),[a,b,c]=uv;
      const det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      if(Math.abs(det)<1e-8)continue;
      let pc=poly;
      for(let i=0;i<3&&pc.length>=3;i++)pc=clipEdge(pc,uv[i],uv[(i+1)%3],Math.sign(det));
      if(pc.length<3)continue;
      const at=([u,v])=>{
        const l=((u-a[0])*(c[1]-a[1])-(v-a[1])*(c[0]-a[0]))/det;
        const m=((b[0]-a[0])*(v-a[1])-(b[1]-a[1])*(u-a[0]))/det;
        return tri[0].map((x,k)=>x+l*(tri[1][k]-x)+m*(tri[2][k]-x));
      };
      const centre=pc.reduce((r,p)=>[r[0]+p[0]/pc.length,r[1]+p[1]/pc.length],[0,0]),hit=ray(AX[ax].o(...centre),AX[ax].d),cp=at(centre);
      if(!hit||Math.abs(hit.p[depth]-cp[depth])>.002||(ax==='top'&&hit.n[1]<.35))continue;
      const points=pc.map(p=>{const q=at(p);q[depth]+=towards*off;return q;});
      so.face(points,sw,AX[ax].d.map(v=>-v));
    }
  };
  const mirrorX = (poly) => poly.map(([x, y]) => [-x, y]).reverse();
  const both = (fn) => { for (const s of [1, -1]) fn(s, (poly) => (s > 0 ? poly : mirrorX(poly))); };

  // ── greenhouse: ring per cabin station, one side: base (belt) → glass top → roof edge → crown. The sides are painted
  // (the pillars); the side glass is laid over them below. A station with yr null is the windscreen base or the backlight
  // foot. Each station's `roof` says what the span behind it is: glass (windscreen, backlight) or the painted roof. ──
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
    // on the mesh's own two triangles (split along the belt-front to glass-top-rear diagonal), not a bilinear patch: a span
    // whose band closes to nothing at the windscreen base is twisted, and panes on the patch let the paint poke through
    const a = cring(c0, s), b = cring(c1, s), [a0, a1, b0, b1] = [a[0], a[1], b[0], b[1]];
    const tt = Math.min(1, Math.max(0, t));
    const lower = tt <= u, p = lower ? [0, 1, 2].map((k) => a0[k] + u * (b0[k] - a0[k]) + tt * (b1[k] - b0[k])) : [0, 1, 2].map((k) => a0[k] + u * (b1[k] - a1[k]) + tt * (a1[k] - a0[k]));
    const n = lower ? cross(sub(b0, a0), sub(b1, a0)) : cross(sub(b1, a0), sub(a1, a0)); const L = Math.hypot(...n) || 1; const sg = Math.sign(n[0]) === s ? 1 : -1;
    return [p[0] + sg * n[0] / L * off, p[1] + sg * n[1] / L * off, p[2] + sg * n[2] / L * off];
  };
  // ── side glass: one black frame over the whole glazed band, then the three panes (front door, rear door, quarter) ──
  const W = P.windows;
  if (T.windows) for (const s of [1, -1]) {
    // each span of the greenhouse side is a non-planar quad, so a pane is cut at the span's middle (z) and at mid-height (t)
    // to stay on top of it instead of sinking through along a diagonal (T.paneCuts pieces along z, three up t; the twisted span
    // behind the windscreen base, where the band closes to nothing, needs the finest cut)
    const poly = (pts, off, sw) => { for (let i = 0; i < nC - 1; i++) {
      const za = P.cabin[i].z, zb = P.cabin[i + 1].z, nz = T.paneCuts ?? 1, zs = Array.from({ length: nz + 1 }, (_, k) => za + (zb - za) * k / nz);
      const nt = T.paneCuts ? 3 : 1, ts = Array.from({ length: nt + 1 }, (_, k) => (k === 0 ? -1 : k === nt ? 2 : k / nt));
      for (let a = 0; a < nz; a++) for (let b = 0; b < nt; b++) { const [z0, z1, t0, t1] = [zs[a], zs[a + 1], ts[b], ts[b + 1]];
        const piece = clip(clip(clipZ(clipZ(pts, z0, -1), z1, 1), t0, 1, 1), t1, -1, 1);
        if (piece.length >= 3) S('core').face(piece.map(([z, t]) => ghPoint(z, t, s, off)), sw, [s, 0.3, 0]);
      }
    } };
    if (T.windows === true) { poly(W.frame, 0.012, 'roofblack'); for (const pane of W.panes) poly(pane, lod === 0 ? 0.018 : lod === 1 ? 0.026 : 0.034, 'glass'); }
    else { poly(W.frame, 0.008, 'glass'); poly(W.bPillar, 0.016, 'roofblack'); } // LOD2: one glazed band and the black B pillar (four doors, not a coupe)
  }

  // ── bays (dark, inside the shell; seen only when a panel is gone) ──
  const bay = (cx, cy, cz, sx, sy, sz) => { if (T.bayBoxes) { S('core').box(cx, cy, cz, sx, sy, sz, 'bay'); return; }
    for (const e of [-1, 1]) S('core').face([[cx - sx / 2, cy - sy / 2, cz + e * sz / 2], [cx + sx / 2, cy - sy / 2, cz + e * sz / 2], [cx + sx / 2, cy + sy / 2, cz + e * sz / 2], [cx - sx / 2, cy + sy / 2, cz + e * sz / 2]], 'bay', [0, 0, e]); };
  { const hwA = lerpCurve(P.hw, zA) - 0.2; bay(0, (0.30 + lerpCurve(P.ySh, zA)) / 2 - 0.02, zA + 0.03, hwA * 2, lerpCurve(P.ySh, zA) - 0.36, 0.06); } // firewall
  { const hwC = lerpCurve(P.hw, zC) - 0.2; bay(0, (0.30 + lerpCurve(P.ySh, zC)) / 2 - 0.02, zC - 0.03, hwC * 2, lerpCurve(P.ySh, zC) - 0.36, 0.06); } // rear bulkhead
  for (const s of [1, -1]) { const x = s * (lerpCurve(P.hw, 0) - 0.2); S('core').quad(...(s > 0 ? [[x, 0.3, zA], [x, 0.3, zC], [x, 1.03, zC], [x, 1.0, zA]] : [[x, 0.3, zC], [x, 0.3, zA], [x, 1.0, zA], [x, 1.03, zC]]), 'bay'); }

  // ── the face (part: front), measured off the sheet's front view, ray-cast onto the nose ──
  const F = S('front'), Fr = P.front, lc = T.lampCell, lo = T.lampOff;
  // the teardrop headlamps: a dark rim (LOD0), the clear lamp
  both((s, m) => {
    // a thin dark outline round the lamp (so a pale lamp still reads on white paint): one quad per lamp edge, between the
    // lamp and its rim polygon, so nothing lies under the lamp to show through it
    if (T.lampRing) { const L = m(Fr.lamp), R = m(Fr.lampRim);
      for (let i = 0; i < L.length; i++) { const j = (i + 1) % L.length; decal(F, [L[i], L[j], R[j], R[i]], 'trim', 0.024 + lo, 'front', T.lampRing); } }
    decal(F, m(Fr.lamp), 'head', 0.024 + lo, 'front', lc);
    // the reflector bowl behind the lens, mid grey at the lamp's round outer end: it keeps the pale lamp readable on white paint
    if (T.reflector) decal(F, m(oval(Fr.reflector.c, Fr.reflector.rx, Fr.reflector.ry, T.reflector)), 'barrel', 0.03 + lo, 'front', lc);
    // the teardrop's tail, sweeping back up over the top of the guard (measured in the top view)
    if (T.lampTop) decal(F, m(Fr.lampTop), 'head', 0.026 + lo, 'top', lc);
  });
  // the oval fish-mouth grille, its single body-colour bar and the plain oval badge on it
  decal(F, oval(Fr.grille.c, Fr.grille.rx, Fr.grille.ry, T.oval), 'grille', 0.012 + lo, 'front', T.grilleCell ?? 0.1);
  decal(F, Fr.bar, 'paint', 0.022 + lo, 'front', T.grilleCell ?? 0.1);
  decal(F, oval(Fr.badge.c, Fr.badge.rx, Fr.badge.ry, T.badge ?? 12), 'chrome', 0.03 + lo, 'front', 0.4);
  // the bumper's thin black slot and the round fog lamps
  if (T.slot) decal(F, Fr.slot, 'grille', 0.01 + lo, 'front', lod === 0 ? 0.1 : 0.5);
  if (T.fog) both((s, m) => decal(F, m(oval(Fr.fog.c, Fr.fog.r, Fr.fog.r, T.fog)), 'fog', 0.012 + lo, 'front', 0.2));

  // the body-side moulding: a thin dark line along the doors (LOD0), following the flank station by station, carried by the doors
  if (T.seams && lod === 0 && P.moulding) for (const s of [1, -1]) for (let i = 0; i < Z.length - 1; i++) {
    const z0 = Math.min(Z[i], zA - 0.02), z1 = Math.max(Z[i + 1], zC + 0.02); if (z0 <= z1) continue;
    const y0 = P.moulding.y, y1 = y0 + P.moulding.h, zm = (z0 + z1) / 2, at = (z, y) => [skinX(z, y, s) + s * 0.006, y, z];
    S(partOfTub(zm, 2, s)).face([at(z0, y0), at(z1, y0), at(z1, y1), at(z0, y1)], 'trim', [s, 0, 0]);
  }
  // door handles: small slots on each door
  if (T.handles) for (const s of [1, -1]) for (const [z, door] of [[P.handles.zF, 'door_F'], [P.handles.zR, 'door_R']]) {
    const y = P.handles.y, x = skinX(z, y, s) + s * 0.005;
    S(door + (s > 0 ? 'L' : 'R')).face([[x, y - 0.016, z + 0.07], [x, y - 0.016, z - 0.07], [x, y + 0.016, z - 0.07], [x, y + 0.016, z + 0.07]], 'trim', [s, 0, 0]);
  }
  // door seams: thin dark strips on the door edges
  if (T.seams) for (const s of [1, -1]) for (const z of [zA - 0.012, P.zB, zC + 0.012]) {
    const y0 = Math.max(lerpCurve(P.yBot, z) + P.skirt, archY(z)) + 0.02, y1 = lerpCurve(P.ySh, z) - P.sideDrop - 0.01, ym = (y0 + y1) / 2;
    const pts = (lod === 0 ? [y0, ym, y1] : [y0, y1]).map((y) => [skinX(z, y, s) + s * 0.006, y]);
    for (let i = 0; i < pts.length - 1; i++) S('core').face([[pts[i][0], pts[i][1], z + 0.008], [pts[i][0], pts[i][1], z - 0.008], [pts[i + 1][0], pts[i + 1][1], z - 0.008], [pts[i + 1][0], pts[i + 1][1], z + 0.008]], 'trim', [s, 0, 0]);
  }

  // ── the tail (part: back), measured off the sheet's rear view, ray-cast onto the tail ──
  const Bk = S('back'), Rr = P.rear;
  both((s, m) => {
    if (T.lampRim) decal(Bk, m(Rr.lampRim), 'taildk', 0.012, 'rear', lc);
    decal(Bk, m(Rr.lamp), 'tail', 0.024 + lo, 'rear', T.tailCell ?? lc);
    if (T.reverse) decal(Bk, m(Rr.reverse), 'white', 0.032 + lo, 'rear', T.tailCell ?? lc);
  });
  decal(Bk, oval(Rr.badge.c, Rr.badge.rx, Rr.badge.ry, T.badge ?? 12), 'chrome', 0.014 + lo, 'rear', 0.4);
  if (T.slot) decal(Bk, Rr.slot, 'trim', 0.01 + lo, 'rear', lod === 0 ? 0.1 : 0.5);
  // the winged spoiler: a body-colour blade on two short posts (LOD0); on the deck lip at LOD1/2
  // (round 2: the base AU has none, and a recognition run read the sheet's wing as a WRX's, so params.json leaves it out)
  if (P.spoiler) { const SP = P.spoiler, xs = SP.span * SP.postX;
    Bk.box(0, SP.y, SP.z, SP.span * 2, 0.035, SP.chord, { all: sUV, py: tUV, ny: 'trim' }, [SP.tilt, 0, 0]);
    if (T.posts) for (const s of [1, -1]) { const x = s * xs, deck = lerpCurve(P.yCr, SP.z) + (lerpCurve(P.ySh, SP.z) - lerpCurve(P.yCr, SP.z)) * Math.min(1, xs / lerpCurve(P.hw, SP.z)); Bk.beam([x, deck - 0.02, SP.z + 0.03], [x, SP.y - 0.01, SP.z], 0.04, 0.08, sUV, [1, 0, 0]); }
  }

  // ── mirrors (core: they stay with the greenhouse): black heads on short stalks at the front of the side glass ──
  const M = P.mirror; // decoration: the collider stays the body's width
  for (const s of [1, -1]) S('core').decor(() => {
    const xb = skinX(M.z, M.y - 0.04, s), x0 = xb + s * M.stalk, x1 = x0 + s * M.out;
    if (T.mirrors === 'box') { S('core').box((xb + x1) / 2, M.y, M.z, Math.abs(x1 - xb), M.h, M.l, 'trim'); return; }
    S('core').beam([xb - s * 0.02, M.y - 0.045, M.z + 0.02], [x0 + s * 0.01, M.y - 0.02, M.z], 0.03, 0.05, 'trim', [0, 0, 1]);
    const f = (x, k) => [[x, M.y - M.h / 2, M.z + M.l / 2 * k], [x, M.y + M.h / 2, M.z + M.l / 2 * k - 0.01], [x, M.y + M.h / 2, M.z - M.l / 2], [x, M.y - M.h / 2 + 0.02, M.z - M.l / 2]];
    const a = f(x0, 1), b = f(x1, 0.5);
    S('core').solid([a, b, ...a.map((p, i) => [p, a[(i + 1) % 4], b[(i + 1) % 4], b[i]])], 'trim');
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
    if (T.rim === 'disc') { Wh.face(to, 'tyre', [s, 0, 0]); Wh.face(ringAt(xo + s * 0.006, rimR), 'rim', [s, 0, 0]); continue; }
    const ro = ringAt(xo, rimR), rd = ringAt(xo - s * depth, rimR);
    if (T.rim === 'spokes') {
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([to[i], to[j], ro[j], ro[i]], 'tyre', [s, 0, 0]); } // sidewall
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([ro[i], ro[j], rd[j], rd[i]], 'rim', sub([xo, yc, zc], mix(ro[i], ro[j], 0.5))); } // the rim lip, facing in
      Wh.face(rd, 'barrel', [s, 0, 0]); // the barrel, mid grey (the sheet's rims read silver)
    } else { Wh.face(to, 'tyre', [s, 0, 0]); Wh.face(ringAt(xo + s * 0.003, rimR, Math.min(n, 8)), 'trim', [s, 0, 0]); } // a flat sidewall, the barrel drawn on it
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
  // Visual refinement keeps the original hinges and wheel hubs fixed.
  if (P.physicsPivots) return structuredClone(P.physicsPivots);
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
  const group = new THREE.Group(); group.name = 'au-hawk'; const parts = {}; let tris = 0; const breakdown = {};
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
