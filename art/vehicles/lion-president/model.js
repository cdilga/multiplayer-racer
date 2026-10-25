// model.js: the low-poly Lion President built from code (R81, R123; br-bwju.3, rebuilt against its sheet in br-bwju.11): a
// caricatured Australian V8 sedan in the spirit of the last V8 Commodore (SS-V Redline). Same spec and handling as the Hawk
// Dash, a different body.
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs). P comes from params.json, fitted to refs/lod-plus-1.png with tools/vehicles/fit (silhouette
// IoU in docs/evidence/P1-V-finish/lion-president/).
//
// Frame: metres, +Z = nose, +Y up, origin on the ground between the axles (jj.vehicle.v1). +X is the car's LEFT, so door_FL
// and wheel_FL sit on +X. The driver sits on the right (cam_fp at −X).
//
// The body is the Cruz Missile's construction (two flat-shaded lofts, tub + greenhouse, sampled from smooth curves in P);
// what makes it a Lion is its proportions (shorter and stubbier than the Hawk, a tall sedan cabin with strong tumblehome)
// and the details its reference sheet shows, each built from numbers measured off the sheet (P.front, P.rear, P.windows…):
//   - cabin: painted A and C pillars, black-framed side glass in three panes (front door, rear door, quarter), black B
//     pillar, gloss-black roof, a shark fin; a whip aerial on the right front wing;
//   - front: big fanged headlamps (a dark housing, a yellow chevron and two hanging fangs, wrapping onto the wings), a
//     barred upper grille, a black lower bumper with slatted intakes either side and four LED blocks in the middle, a black
//     splitter with a painted lip; two raised body-colour bonnet scoops with black mouths;
//   - wheels: flared arches, 5-spoke dark rims with a hex hub in a dark barrel, red calipers (on the core: they don't spin);
//   - rear: a tall wing on swan-neck posts with an N brace and tall endplates, a full-width tail-lamp bar (red outline,
//     dark core) in a black band, a black diffuser with fins and four chrome tail pipes;
//   - mirrors on stalks, door handles, side skirts and the black-and-gold side swoosh (atlas).
// LOD changes only the sampling density and which details exist; part names and pivots are identical at every LOD.
// Damage parts: front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; everything else is core.
import * as THREE from 'three';
import { swatchUV, REGION, SPAN } from './atlas.js';

export const LODS = {
  0: { arch: 9, nose: 2, curvePts: true, merge: 0.08, doorMid: true, wheelSeg: 12, rim: 'flat', bayBoxes: true, hub: true, flare: 9, flareLip: true, flareEnds: true, tyreCap: false, band: true, lamps: 'full', grilleBars: 2, slats: 5, splitter: true, scoops: 'box', aerial: true, fin: true, windows: true, mirrors: 'stalk', wing: 'swan', exhaust: 'rings', diffFins: 4, handles: true, skirts: true, calipers: true, corners: true },
  1: { arch: 4, nose: 1, curvePts: true, merge: 0.4, doorMid: true, wheelSeg: 6, rim: 'flat', bayBoxes: false, hub: false, flare: 4, flareLip: false, flareEnds: true, tyreCap: false, band: false, lamps: 'full', grilleBars: 0, slats: 0, splitter: true, scoops: 'box', aerial: false, fin: false, windows: true, mirrors: 'box', wing: 'plate', exhaust: 'flat', diffFins: 0, handles: false, skirts: false, calipers: false, corners: true },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, doorMid: false, wheelSeg: 6, rim: 'flat', bayBoxes: false, hub: false, flare: 3, flareLip: false, flareEnds: false, tyreCap: false, band: false, lamps: 'flat', grilleBars: 0, slats: 0, splitter: false, scoops: 'flat', aerial: false, fin: false, windows: 'flat', mirrors: 'box', wing: 'plate', exhaust: 'none', diffFins: 0, handles: false, skirts: false, calipers: false, corners: false },
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
// a convex 2D polygon [[z, t]…] clipped to z ≤ k (side −1) or z ≥ k (side 1)
const clipZ = (pts, k, side) => {
  const inside = (p) => side * (p[0] - k) >= -1e-9, out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) { const t = (k - a[0]) / (b[0] - a[0]); out.push([k, a[1] + (b[1] - a[1]) * t]); }
  }
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-6);
};

// ───────────────────────── triangle soup builder (non-indexed → flat shading) ─────────────────────────
class Soup {
  constructor() { this.p = []; this.uv = []; this.c = []; this.nc = []; }
  /** Draws fn's triangles as decoration the bake leaves out of the part's collider (aerial, fin, calipers, mirrors). */
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
  /** A square-section beam from a to b (four sides, open ends): struts, posts, the aerial. `up` orients its width. */
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
  // prism along an axis: n-gon radius r, from a to b (used for wheels, pipes)
  prism(a, b, r, n, swSide, swCap, phase = 0, r2 = r) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), ax = B.clone().sub(A).normalize();
    const u = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(ax).normalize() : new THREE.Vector3(1, 0, 0).cross(ax).normalize(), w = ax.clone().cross(u);
    const ring = (C, rr) => Array.from({ length: n }, (_, i) => { const t = phase + (i / n) * Math.PI * 2; return C.clone().addScaledVector(u, Math.cos(t) * rr).addScaledVector(w, Math.sin(t) * rr).toArray(); });
    const ra = ring(A, r), rb = ring(B, r2);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(ra[i], ra[j], rb[j], rb[i], swSide); }
    if (swCap) for (let i = 1; i < n - 1; i++) { this.tri(ra[0], ra[i + 1], ra[i], swCap); this.tri(rb[0], rb[i], rb[i + 1], swCap); }
  }
  get tris() { return this.p.length / 9; }
}

// ───────────────────────── UV projections for the livery ─────────────────────────
function sideUV(P) { const [u0, v0, u1, v1] = REGION.side; return (v) => [u0 + (u1 - u0) * ((P.zNose - v[2]) / SPAN.side[0]), v0 + (v1 - v0) * (v[1] / SPAN.side[1])]; }
function topUV(P) { const [u0, v0, u1, v1] = REGION.top; return (v) => [u0 + (u1 - u0) * ((P.zNose - v[2]) / SPAN.top[0]), v0 + (v1 - v0) * (v[0] / SPAN.top[1] + 0.5)]; }

// ───────────────────────── build ─────────────────────────
function makeSoups(P, lod) {
  const T = LODS[lod];
  // Coarser tiers retain roof/rake breaks while dropping redundant coplanar stations.
  const C = P.cabin.filter((c,i) => lod===0 || (lod===1 ? [0,2,4,6,8] : [0,2,4,6,8]).includes(i));
  const zA = P.zFA - P.archR, zC = P.zRA + P.archR; // door span = between the arches; front/back cut lines
  // stations along z (descending: nose → tail)
  // tub stations: protected = ends, cut lines, arch samples, the fascia slope edge; optional = profile control points
  // (dropped when within T.merge of a kept station, so coarse tiers don't pay for near-duplicate rings)
  const prot = [P.zNose, P.zTail, zA, zC, P.zB, P.zNose - 0.16, 1.8, ...(lod < 2 ? [0, -1.85] : [])];
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
    // Independent lower crease, broad lower flank and shoulder rollover. Evaluate
    // this original section at the arch cut rather than lifting the full-width belt.
    const ys=[yb,yb+P.skirt,.52,ysh-P.sideDrop,ysh],xs=[hw-P.floorIn,hw-.025,hw,hw-.035,hw-P.shoulderIn];
    const width=y=>{for(let i=1;i<ys.length;i++)if(y<=ys[i])return xs[i-1]+(xs[i]-xs[i-1])*(y-ys[i-1])/Math.max(.001,ys[i]-ys[i-1]);return xs.at(-1);};
    const levels=[lift,Math.max(lift+.008,ys[1]),Math.max(lift+.016,ys[2]),Math.max(lift+.024,ys[3]),ysh];
    return [[0,yb,z],...levels.map(y=>[s*width(y),y,z]),[0,ycr,z]];
  };
  const skinX = (z,y,s) => {
    let i=0;while(i<Z.length-2&&Z[i+1]>z)i++;
    const u=Math.max(0,Math.min(1,(Z[i]-z)/(Z[i]-Z[i+1]))),r=ring(Z[i],s).map((p,k)=>mix(p,ring(Z[i+1],s)[k],u));
    if(y<=r[1][1])return r[1][0];
    for(let k=1;k<r.length-1;k++)if(y<=r[k+1][1])return mix(r[k],r[k+1],(y-r[k][1])/Math.max(.001,r[k+1][1]-r[k][1]))[0];
    return r.at(-2)[0];
  };
  // the tub's top surface height at (x, z): the slope from the shoulder to the crown
  const deckY = (x, z) => { const ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), w = lerpCurve(P.hw, z) - P.shoulderIn; return ycr + (ysh - ycr) * Math.min(1, Math.abs(x) / w); };

  const soups = {}; const S = (id) => (soups[id] ??= new Soup());
  const partOfTub = (zm, seg, s) => {
    if (zm > zA + 1e-6) return 'front';
    if (zm < zC - 1e-6) return 'back';
    if (seg >= 1 && seg <= 4) return (zm > P.zB ? 'door_F' : 'door_R') + (s > 0 ? 'L' : 'R'); // +X is the car's left
    return 'core';
  };
  const sUV = sideUV(P), tUV = topUV(P);
  const segSwatch = (seg) => (seg === 0 ? 'under' : seg === 1 ? 'trim' : seg === 5 ? tUV : sUV); // 2, 3: side skin with livery
  for (const s of [1, -1]) {
    for (let i = 0; i < Z.length - 1; i++) {
      const a = ring(Z[i], s), b = ring(Z[i + 1], s), zm = (Z[i] + Z[i + 1]) / 2;
      for (let k = 0; k < 6; k++) {
        const so = S(partOfTub(zm, k, s));
        // winding: outward normals. ring order goes bottom→top on side s; for s>0 use (a_k, b_k, b_k+1, a_k+1)
        if (s > 0) so.quad(a[k], b[k], b[k + 1], a[k + 1], segSwatch(k)); else so.quad(a[k], a[k + 1], b[k + 1], b[k], segSwatch(k));
      }
    }
  }
  // end caps: nose (front) and tail (back) — fan over both sides' rings
  const cap = (z, id, sign, sw) => {
    const R = ring(z, 1), Lr = ring(z, -1); const poly = [...R, ...Lr.slice(1,-1).reverse()];
    const c = [0, poly.reduce((t, v) => t + v[1], 0) / poly.length, z];
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; if (sign > 0) S(id).tri(c, p, q, sw); else S(id).tri(c, q, p, sw); }
  };
  cap(P.zNose, 'front', 1, 'paint'); cap(P.zTail, 'back', -1, 'paint');

  // ── greenhouse: ring per cabin station, one side: base (belt) → glass top → roof edge → crown. The sides are painted
  // (the A and C pillars); the side glass is laid over them below. A station with yr null is the windscreen base or the
  // backlight foot: its ring lies flat on the body. Each station's `roof` says what the span behind it is: glass (the
  // windscreen, the backlight) or the gloss-black roof. ──
  const cring = (c, s) => {
    const yb = lerpCurve(P.ySh, c.z) - 0.005;
    if (c.yr == null) { const zc=c.z+P.glassBow*(c.z>0?1:-1); return [[s*c.wb,deckY(c.wb,c.z)-.003,c.z],[s*c.wt,deckY(c.wt,c.z)-.003,c.z],[s*(c.wt-P.roofCh),deckY(c.wt-P.roofCh,c.z)-.003,c.z],[0,deckY(0,zc)-.003,zc]]; }
    return [[s * c.wb, yb, c.z], [s * c.wt, c.yr - P.roofCh, c.z], [s * (c.wt - P.roofCh * 1.2), c.yr, c.z], [0,c.yr+P.roofCrown,c.z+P.glassBow*Math.max(-1,Math.min(1,c.z*2))]];
  };
  const nC = C.length;
  for (const s of [1, -1]) for (let i = 0; i < nC - 1; i++) {
    const c = C[i], a = cring(c, s), b = cring(C[i + 1], s), roof = c.roof === 'paint';
    for (let k = 0; k < 3; k++) {
      const sw = k === 0 ? sUV : roof ? 'roofblack' : k === 1 ? sUV : 'glass';
      if (s > 0) S('core').quad(a[k], b[k], b[k + 1], a[k + 1], sw); else S('core').quad(a[k], a[k + 1], b[k + 1], b[k], sw);
    }
  }
  // a point on the greenhouse side at (z, t): t = 0 at the belt, 1 at the glass top; pushed out by `off`
  const ghPoint = (z, t, s, off) => {
    let i = 0; while (i < nC - 2 && C[i + 1].z > z) i++;
    const c0 = C[i], c1 = C[i + 1], u = Math.min(1, Math.max(0, (c0.z - z) / (c0.z - c1.z)));
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
    // Clip on the exact substrate diagonal in (u,t), so each pane triangle shares
    // the painted greenhouse facet instead of floating across its twisted quad.
    const poly = (pts, off, sw) => {for(let i=0;i<nC-1;i++){
      const za=C[i].z,zb=C[i+1].z;
      const piece=clipZ(clipZ(pts,za,-1),zb,1);
      const diagonal=(pts,side)=>{const out=[];const d=p=>side*(p[1]-(za-p[0])/(za-zb));
        for(let k=0;k<pts.length;k++){const a=pts[k],b=pts[(k+1)%pts.length],da=d(a),db=d(b);
          if(da>=-1e-9)out.push(a);if((da>=0)!==(db>=0))out.push(mix(a,b,da/(da-db)));}return out;};
      for(const side of [-1,1]){const q=diagonal(piece,side);if(q.length>=3)S('core').face(q.map(([z,t])=>ghPoint(z,t,s,off)),sw,[s,.3,0]);}
    }};
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

  // ── flared wheel arches: a band round each arch cut, standing proud of the side by P.flare.out at its lip, its outer edge
  // flush with the body P.flare.w further out (front arch: part front; rear arch: part back) ──
  if (T.flare) for (const [zc, id] of [[P.zFA, 'front'], [P.zRA, 'back']]) for (const s of [1, -1]) {
    const So = S(id), n = T.flare, Fw = P.flare.w, Fo = P.flare.out, ht = P.archTop - P.archBase;
    const E = [], Ep = [], O = [], Ei = [];
    for (let i = 0; i < n; i++) {
      const th = Math.PI * i / (n - 1), z = zc + P.archR * Math.cos(th), y = P.archBase + ht * Math.sin(th);
      const zo = zc + (P.archR + Fw) * Math.cos(th), yo = P.archBase + (ht + Fw) * Math.sin(th);
      const x = skinX(z, Math.max(y, lerpCurve(P.yBot, z) + P.skirt), s);
      // Above the tyre crown the flare rolls back towards the shoulder instead of
      // carrying the widest wheel clearance all the way up the arch.
      const roll = Math.max(0, Math.min(1, (y - .72) / .18));
      E.push([x, y, z]); Ep.push([s * Math.max(Math.abs(x) + Fo * (1 - .8 * roll), P.track + P.wheelW / 2 + 0.02 - .08 * roll), y, z]); Ei.push([x - s * 0.05, y, z]); O.push([skinX(zo, yo, s) + s * 0.004, yo, zo]);
    }
    for (let i = 0; i < n - 1; i++) {
      const th = Math.PI * (i + 0.5) / (n - 1);
      So.face([Ep[i], Ep[i + 1], O[i + 1], O[i]], sUV, [s, 0.6 * Math.sin(th), 0.6 * Math.cos(th)]); // the proud face
      if (T.flareLip) So.face([Ei[i], Ei[i + 1], Ep[i + 1], Ep[i]], 'trim', [0, -Math.sin(th), -Math.cos(th)]); // the lip's underside
    }
    if (T.flareEnds) for (const i of [0, n - 1]) So.face([Ei[i], Ep[i], O[i]], sUV, [0, -0.2, i === 0 ? 1 : -1]);
  }

  // ── bonnet (part: front): two raised body-colour scoops with black mouths facing the nose ──
  const F = S('front');
  { const N = P.scoops;
    for (const s of [1, -1]) {
      const xc = s * N.x, z0 = N.z, z1 = N.z - N.l, xa = xc - N.w / 2, xb = xc + N.w / 2, ti = N.w * 0.12;
      const g0a = deckY(xa, z0) + 0.004, g0b = deckY(xb, z0) + 0.004, g1a = deckY(xa, z1) - 0.01, g1b = deckY(xb, z1) - 0.01;
      if (T.scoops === 'flat') { F.face([[xa, g0a + 0.01, z0], [xb, g0b + 0.01, z0], [xb, g1b + 0.012, z1], [xa, g1a + 0.012, z1]], 'grille', [0, 1, 0]); continue; } // a flat black decal at LOD2
      const top = Math.max(g0a, g0b) + N.h;
      const bfa = [xa, g0a, z0], bfb = [xb, g0b, z0], tfa = [xa + ti, top, z0 - 0.03], tfb = [xb - ti, top, z0 - 0.03], ra = [xa + ti * 0.5, g1a, z1], rb = [xb - ti * 0.5, g1b, z1];
      F.face([tfa, tfb, rb, ra], tUV, [0, 1, 0.1]); // the top
      F.face([bfa, tfa, ra], sUV, [-1, 0.3, 0]); F.face([bfb, tfb, rb], sUV, [1, 0.3, 0]); // the sides
      F.face([bfa, bfb, tfb, tfa], sUV, [0, 0.2, 1]); // the front, then its black mouth just in front of it
      const m = (p, q, r) => mix(p, r, 0.16);
      const mc = mix(mix(bfa, bfb, 0.5), mix(tfa, tfb, 0.5), 0.5);
      F.face([m(bfa, bfa, mc), m(bfb, bfb, mc), m(tfb, tfb, mc), m(tfa, tfa, mc)].map((p) => [p[0], p[1] - 0.008, p[2] + 0.006]), 'grille', [0, 0.2, 1]);
    } }

  // ── front fascia (part: front): measured off the sheet's front view in units of the nose half-width hwN (u) and metres
  // below the nose's top corner yTop (v). Everything sits on the vertical nose face at zn. ──
  const zn = P.zNose, hwN = lerpCurve(P.hw, P.zNose), yTop = lerpCurve(P.ySh, P.zNose), ybN = lerpCurve(P.yBot, P.zNose), Fr = P.front;
  const fpt = (u, v, dz = 0.004, s = 1) => [s * u * hwN, yTop - v, zn + dz];
  const fpoly = (uvs, sw, dz, s = 1) => F.face(uvs.map(([u, v]) => fpt(u, v, dz, s)), sw, [0, 0, 1]);
  const frect = (u0, v0, u1, v1, sw, dz) => fpoly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], sw, dz);
  // the black lower bumper: the whole face below the lamps, following the face's own outline at the floor corners
  { const r = ring(P.zNose, 1), yt = yTop - Fr.bumperTop;
    F.face([[-r[1][0], r[1][1], zn + 0.002], [r[1][0], r[1][1], zn + 0.002], [r[2][0], r[2][1], zn + 0.002], [r[2][0], yt, zn + 0.002], [-r[2][0], yt, zn + 0.002], [-r[2][0], r[2][1], zn + 0.002]], 'trim', [0, 0, 1]); }
  // its solid upper band stands forward of the intakes
  if (T.band) F.box(0, yTop - (Fr.bumperTop + Fr.bandH / 2), zn + 0.02, hwN * 1.98, Fr.bandH, 0.04, 'trim');
  // intakes: a dark recess either side (with vertical slats at LOD0) and the centre one with the four LED blocks
  { const v0 = Fr.bumperTop + Fr.bandH + 0.01, v1 = yTop - ybN - 0.07;
    for (const s of [1, -1]) {
      fpoly([[Fr.slatU[0], v0], [Fr.slatU[1], v0], [Fr.slatU[1], v1], [Fr.slatU[0], v1]], 'grille', 0.005, s);
      for (let i = 0; i < T.slats; i++) { // a slat: its front and two sides
        const u = Fr.slatU[0] + (Fr.slatU[1] - Fr.slatU[0]) * (i + 0.5) / T.slats, x = s * u * hwN, w = 0.009, d = 0.03, y0 = yTop - v1, y1 = yTop - v0;
        F.face([[x - w, y0, zn + d], [x + w, y0, zn + d], [x + w, y1, zn + d], [x - w, y1, zn + d]], 'rim', [0, 0, 1]);
        for (const e of [-1, 1]) F.face([[x + e * w, y0, zn], [x + e * w, y0, zn + d], [x + e * w, y1, zn + d], [x + e * w, y1, zn]], 'trim', [e, 0, 0]);
      }
    }
    frect(-Fr.centreU, v0, Fr.centreU, v1, 'grille', 0.005);
    for (const u of Fr.ledU) for (const s of [1, -1]) fpoly([[u - Fr.ledW / 2, Fr.ledV - Fr.ledH / 2], [u + Fr.ledW / 2, Fr.ledV - Fr.ledH / 2], [u + Fr.ledW / 2, Fr.ledV + Fr.ledH / 2], [u - Fr.ledW / 2, Fr.ledV + Fr.ledH / 2]], 'led', T.lamps === 'full' ? 0.008 : 0.007, s);
  }
  // the barred upper grille between the lamps
  frect(-Fr.grilleU, Fr.grilleV[0], Fr.grilleU, Fr.grilleV[1], 'grille', 0.004);
  for (let i = 0; i < T.grilleBars; i++) { const v = Fr.grilleV[0] + (Fr.grilleV[1] - Fr.grilleV[0]) * (i + 1) / (T.grilleBars + 1); F.box(0, yTop - v, zn + 0.008, Fr.grilleU * hwN * 2, 0.014, 0.012, 'rim'); }
  // the headlamps: a dark housing, a yellow chevron down its outer end, a yellow bar along its foot and two fangs hanging
  // from it; at LOD0/1 the chevron wraps round the corner onto the wing
  for (const s of [1, -1]) {
    fpoly(Fr.lampHousing, 'trim', 0.006, s);
    const Lp = T.lamps === 'full' ? Fr.lampYellow : Fr.lampYellow.slice(0, 2);
    for (const p of Lp) fpoly(p, 'head', 0.008, s);
    for (const p of T.lamps === 'full' ? Fr.fangs : Fr.fangs.slice(0, 1)) fpoly(p, 'head', 0.008, s);
    if (T.corners) { // the wrap onto the wing, and the black bumper corner below it
      const pts = Fr.lampWrap.map(([dz, v]) => { const z = P.zNose - dz, y = yTop - v; return [skinX(z, y, s) + s * 0.006, y, z]; });
      F.face(pts, 'head', [s, 0, 0.2]);
      const zb = P.zNose - Fr.cornerL, yt = yTop - Fr.bumperTop;
      const cp = [[P.zNose, ybN + P.skirt], [zb, lerpCurve(P.yBot, zb) + P.skirt], [zb, yt - 0.04], [P.zNose, yt]].map(([z, y]) => [skinX(z, y, s) + s * 0.004, y, z]);
      F.face(cp, 'trim', [s, 0, 0]);
      if (T.slats) for (let i = 0; i < 3; i++) { const z = P.zNose - Fr.cornerL * (0.25 + 0.25 * i), y0 = lerpCurve(P.yBot, z) + P.skirt + 0.05, y1 = yt - 0.08;
        F.face([[skinX(z, y0, s) + s * 0.008, y0, z + 0.012], [skinX(z, y0, s) + s * 0.008, y0, z - 0.012], [skinX(z, y1, s) + s * 0.008, y1, z - 0.012], [skinX(z, y1, s) + s * 0.008, y1, z + 0.012]], 'grille', [s, 0, 0]); }
    }
  }
  // the splitter: a black plate under the nose, its front edge painted (the sheet's red lip)
  if (T.splitter) F.box(0, ybN - 0.005, P.zNose - 0.08, (hwN + Fr.splitterOut) * 2, 0.04, 0.32, { all: 'trim', pz: 'paint' });
  // the whip aerial on the right front wing (the sheet's tall antenna)
  if (T.aerial) { const A = P.aerial, y0 = deckY(A.x, A.z); F.decor(() => F.beam([A.x, y0, A.z], [A.x, A.top, A.z - 0.02], 0.014, 0.014, 'trim')); }

  // ── side skirts (core) ──
  if (T.skirts) for (const s of [1, -1]) { const za = P.zFA - P.archR - P.flare.w, zb = P.zRA + P.archR + P.flare.w, x = s * (lerpCurve(P.hw, 0) + 0.015), y0 = lerpCurve(P.yBot, 0) + 0.02;
    S('core').box(x, y0 + 0.05, (za + zb) / 2, 0.06, 0.10, za - zb, 'trim'); }
  // door handles: small black slots on each door
  if (T.handles) for (const s of [1, -1]) for (const [z, door] of [[P.handles.zF, 'door_F'], [P.handles.zR, 'door_R']]) {
    const y = P.handles.y, x = skinX(z, y, s) + s * 0.005;
    S(door + (s > 0 ? 'L' : 'R')).face([[x, y - 0.018, z + 0.07], [x, y - 0.018, z - 0.07], [x, y + 0.018, z - 0.07], [x, y + 0.018, z + 0.07]], 'trim', [s, 0, 0]);
  }

  // ── rear (part: back) ──
  const Bk = S('back'), zt = P.zTail, hwT = lerpCurve(P.hw, P.zTail), yshT = lerpCurve(P.ySh, P.zTail), ybT = lerpCurve(P.yBot, P.zTail), Rr = P.rear;
  const rpt = (u, y, dz = 0.004, s = 1) => [s * u * hwT, y, zt - dz];
  const rpoly = (pts, sw, dz, s = 1) => Bk.face(pts.map(([u, y]) => rpt(u, y, dz, s)), sw, [0, 0, -1]);
  // the full-width tail lamp: a black band, the red lamp bar (pointed ends) and its dark core
  { const [l0, l1] = Rr.lampY, ym = (l0 + l1) / 2, pts = (U, a, b) => [[-U, ym], [-U + 0.05, a], [U - 0.05, a], [U, ym], [U - 0.05, b], [-U + 0.05, b]];
    rpoly([[-0.99, l0 - 0.025], [0.99, l0 - 0.025], [0.99, l1 + 0.025], [-0.99, l1 + 0.025]], 'roofblack', 0.003);
    rpoly(pts(0.96, l0, l1), 'tail', 0.006);
    if (T.lamps === 'full') rpoly(pts(0.91, l0 + 0.03, l1 - 0.03), 'taildk', 0.009);
    if (T.corners) for (const s of [1, -1]) { // the lamp's wrap onto the rear quarter
      const pts2 = [[0.005, l0], [Rr.wrapL, l0 + 0.02], [Rr.wrapL, l1 - 0.01], [0.005, l1]].map(([dz, y]) => { const z = P.zTail + dz; return [skinX(z, y, s) + s * 0.006, y, z]; });
      Bk.face(pts2, 'tail', [s, 0, -0.2]);
      const cp = [[P.zTail, ybT + P.skirt], [P.zTail + Rr.cornerL, lerpCurve(P.yBot, P.zTail + Rr.cornerL) + P.skirt], [P.zTail + Rr.cornerL, Rr.diffTop], [P.zTail, Rr.diffTop]].map(([z, y]) => [skinX(z, y, s) + s * 0.004, y, z]);
      Bk.face(cp, 'trim', [s, 0, 0]);
    }
  }
  // the black diffuser across the bottom, its fins and the four tail pipes in two pairs
  { const r = ring(P.zTail, 1);
    Bk.face([[r[1][0], r[1][1], zt - 0.003], [-r[1][0], r[1][1], zt - 0.003], [-r[2][0], r[2][1], zt - 0.003], [-r[2][0], Rr.diffTop, zt - 0.003], [r[2][0], Rr.diffTop, zt - 0.003], [r[2][0], r[2][1], zt - 0.003]], 'under', [0, 0, -1]);
    for (let i = 0; i < T.diffFins; i++) { const u = Rr.finU[i % Rr.finU.length] * (i < Rr.finU.length ? 1 : -1), x = u * hwT, w = 0.012, d = 0.07, y0 = ybT, y1 = ybT + 0.16;
      Bk.solid([[[x - w, y0, zt], [x - w, y1, zt], [x - w, y1, zt - d], [x - w, y0, zt - d * 1.4]], [[x + w, y0, zt], [x + w, y1, zt], [x + w, y1, zt - d], [x + w, y0, zt - d * 1.4]], [[x - w, y1, zt - d], [x + w, y1, zt - d], [x + w, y0, zt - d * 1.4], [x - w, y0, zt - d * 1.4]]], 'trim'); }
    for (const s of [1, -1]) for (const x of Rr.pipeX) {
      const c = [s * x, Rr.pipeY, zt], r0 = Rr.pipeR;
      if (T.exhaust === 'rings') {
        const n = 8, ring2 = (rr, dz) => Array.from({ length: n }, (_, i) => { const a = Math.PI * 2 * (i + 0.5) / n; return [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, zt - dz]; });
        const o = ring2(r0, 0.05), o0 = ring2(r0, 0), inn = ring2(r0 * 0.72, 0.05), deep = ring2(r0 * 0.72, 0.02);
        for (let i = 0; i < n; i++) { const j = (i + 1) % n;
          Bk.face([o0[i], o0[j], o[j], o[i]], 'chrome', sub(mix(o[i], o[j], 0.5), [c[0], c[1], zt - 0.05])); // the pipe
          Bk.face([o[i], o[j], inn[j], inn[i]], 'chrome', [0, 0, -1]); } // its rim
        Bk.face(deep, 'under', [0, 0, -1]); // and its dark bore
      } else if (T.exhaust === 'flat') rpoly([[(s * x - r0) / hwT, Rr.pipeY - r0], [(s * x + r0) / hwT, Rr.pipeY - r0], [(s * x + r0) / hwT, Rr.pipeY + r0], [(s * x - r0) / hwT, Rr.pipeY + r0]], 'chrome', 0.006);
    } }
  // the tall wing: a black blade, tall endplates, and swan-neck posts that rise behind it and hook over onto its top, with an
  // N brace from the boot (the sheet's side view); a plain plate on two posts at LOD2
  { const SP = P.spoiler, xs = SP.span * SP.postX;
    if(lod===0)Bk.box(0, SP.y, SP.z, SP.span * 2, 0.035, SP.chord, 'roofblack', [SP.tilt, 0, 0]);
    else {
      Bk.face([[-SP.span,SP.y,SP.z+SP.chord/2],[SP.span,SP.y,SP.z+SP.chord/2],[SP.span,SP.y+.035,SP.z-SP.chord/2],[-SP.span,SP.y+.035,SP.z-SP.chord/2]],'roofblack',[0,1,0]);
      for(const s of [-1,1])Bk.face([[s*SP.span,SP.y-SP.plateLo,SP.z+SP.chord/2],[s*SP.span,SP.y+SP.plateHi,SP.z+SP.chord/2-.04],[s*SP.span,SP.y+SP.plateHi,SP.z-SP.chord/2-.05],[s*SP.span,SP.y-SP.plateLo,SP.z-SP.chord/2]],'roofblack',[s,0,0]);
    }
    if (T.wing !== 'plate') for (const s of [1, -1]) Bk.solid([
      [[s * SP.span, SP.y - SP.plateLo, SP.z + SP.chord / 2 + 0.02], [s * SP.span, SP.y + SP.plateHi, SP.z + SP.chord / 2 - 0.04], [s * SP.span, SP.y + SP.plateHi, SP.z - SP.chord / 2 - 0.05], [s * SP.span, SP.y - SP.plateLo, SP.z - SP.chord / 2 + 0.02]],
      [[s * (SP.span + 0.025), SP.y - SP.plateLo, SP.z + SP.chord / 2 + 0.02], [s * (SP.span + 0.025), SP.y + SP.plateHi, SP.z + SP.chord / 2 - 0.04], [s * (SP.span + 0.025), SP.y + SP.plateHi, SP.z - SP.chord / 2 - 0.05], [s * (SP.span + 0.025), SP.y - SP.plateLo, SP.z - SP.chord / 2 + 0.02]],
    ].flatMap((f, k, all) => (k === 0 ? [f, all[1], ...f.map((p, i) => [p, f[(i + 1) % 4], all[1][(i + 1) % 4], all[1][i]])] : [])), 'roofblack');
    for (const s of [1, -1]) {
      const x = s * xs, deckF = deckY(x, SP.z + SP.chord * 0.3), deckR = deckY(x, SP.z - SP.chord * 0.3);
      const base = [x, deckR, SP.z - SP.chord * 0.3], crest = [x, SP.y + 0.05, SP.z - SP.chord * 0.62], hook = [x, SP.y + 0.025, SP.z - SP.chord * 0.05];
      if (T.wing === 'swan') { Bk.beam(base, crest, 0.035, 0.06, 'roofblack', [1, 0, 0]); Bk.beam(crest, hook, 0.035, 0.05, 'roofblack', [1, 0, 0]); Bk.beam([x, deckF, SP.z + SP.chord * 0.3], [x, SP.y - 0.04, SP.z - SP.chord * 0.45], 0.03, 0.05, 'roofblack', [1, 0, 0]); }
      else {
        // Crossed thin planes retain post width from both diagnostic directions.
        Bk.face([[x-.02,deckF,SP.z],[x+.02,deckF,SP.z],[x+.02,SP.y,SP.z],[x-.02,SP.y,SP.z]],'roofblack',[0,0,1]);
        Bk.face([[x,deckF,SP.z-.03],[x,deckF,SP.z+.03],[x,SP.y,SP.z+.03],[x,SP.y,SP.z-.03]],'roofblack',[1,0,0]);
      }
    }
  }
  // the shark fin at the back of the roof
  if (T.fin) { const c = C.find((k) => k.roof === 'paint' && k.z < -0.5) ?? C[3], y0 = c.yr + P.roofCrown - 0.005, z0 = c.z + 0.05;
    S('core').decor(() => S('core').solid([[[-0.02, y0, z0], [-0.02, y0, z0 - 0.17], [-0.008, y0 + 0.045, z0 - 0.15]], [[0.02, y0, z0], [0.02, y0, z0 - 0.17], [0.008, y0 + 0.045, z0 - 0.15]], [[-0.02, y0, z0], [0.02, y0, z0], [0.008, y0 + 0.045, z0 - 0.15], [-0.008, y0 + 0.045, z0 - 0.15]], [[-0.02, y0, z0 - 0.17], [0.02, y0, z0 - 0.17], [0.008, y0 + 0.045, z0 - 0.15], [-0.008, y0 + 0.045, z0 - 0.15]]], 'roofblack')); }

  // ── mirrors (core: they stay with the greenhouse): black angular heads on short stalks at the front of the side glass ──
  const M = P.mirror; // decoration: the collider stays the body's width
  for (const s of [1, -1]) S('core').decor(() => {
    const xb = skinX(M.z, M.y - 0.04, s), x0 = xb + s * M.stalk, x1 = x0 + s * M.out;
    if (T.mirrors === 'box') { S('core').box((xb + x1) / 2, M.y, M.z, Math.abs(x1 - xb), M.h, M.l, 'roofblack'); return; }
    S('core').beam([xb - s * 0.02, M.y - 0.045, M.z + 0.02], [x0 + s * 0.01, M.y - 0.02, M.z], 0.03, 0.05, 'roofblack', [0, 0, 1]);
    const f = (x, k) => [[x, M.y - M.h / 2, M.z + M.l / 2 * k], [x, M.y + M.h / 2, M.z + M.l / 2 * k - 0.01], [x, M.y + M.h / 2, M.z - M.l / 2], [x, M.y - M.h / 2 + 0.02, M.z - M.l / 2]];
    const a = f(x0, 1), b = f(x1, 0.4);
    S('core').solid([a, b, ...a.map((p, i) => [p, a[(i + 1) % 4], b[(i + 1) % 4], b[i]])], 'roofblack');
  });

  // ── wheels: a tyre (tread, sidewall ring, inner cap), a dark barrel behind the rim lip, five spokes and a hex hub;
  // LOD1 draws the spokes flat on the barrel, LOD2 a 5-gon decal. The tyre's circumradius makes its inscribed radius
  // wheelR, so the bottom flat (phase π/n) touches the ground. ──
  const n = T.wheelSeg, tyreR = P.wheelR / Math.cos(Math.PI / n), rimR = P.wheelR * P.rim.r, depth = P.rim.depth;
  for (const [id, zc, s] of [['wheel_FL', P.zFA, 1], ['wheel_FR', P.zFA, -1], ['wheel_RL', P.zRA, 1], ['wheel_RR', P.zRA, -1]]) {
    const Wh = S(id), xw = s * P.track, xo = xw + s * P.wheelW / 2, xi = xw - s * P.wheelW / 2, yc = P.wheelR;
    const ringAt = (x, r, k = n, ph = 1.5 * Math.PI - Math.PI / k) => Array.from({ length: k }, (_, i) => { const a = ph + (i / k) * Math.PI * 2; return [x, yc + Math.sin(a) * r, zc + Math.cos(a) * r]; });
    const to = ringAt(xo, tyreR), ti = ringAt(xi, tyreR);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([ti[i], ti[j], to[j], to[i]], 'tyre', sub(mix(to[i], to[j], 0.5), [xo, yc, zc])); }
    if (T.tyreCap) Wh.face(ti, 'tyre', [-s, 0, 0]);
    if (T.rim === 'decal') { Wh.face(to, 'tyre', [s, 0, 0]); Wh.face(ringAt(xo + s * 0.006, P.wheelR * 0.6, 5, Math.PI / 2), 'rim', [s, 0, 0]); continue; }
    const ro = ringAt(xo, rimR), rd = ringAt(xo - s * depth, rimR);
    if (T.rim === 'spokes') {
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([to[i], to[j], ro[j], ro[i]], 'tyre', [s, 0, 0]); } // sidewall
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([ro[i], ro[j], rd[j], rd[i]], 'rim', sub([xo, yc, zc], mix(ro[i], ro[j], 0.5))); } // the rim lip, facing in
      Wh.face(rd, 'under', [s, 0, 0]); // the dark barrel
    } else { Wh.face(to, 'tyre', [s, 0, 0]); Wh.face(ringAt(xo + s * (lod===0?-.018:.003), rimR,lod===2?5:n), 'under', [s, 0, 0]); } // LOD1: a flat sidewall, the barrel drawn on it
    // A shallow dished rim lip catches light around the five-spoke wheel. The
    // coarse tiers keep the same neutral rim as a flat face.
    if(lod===0){const outer=ringAt(xo+s*.012,rimR,8),inner=ringAt(xo-s*.014,rimR*.83,8);
      for(let i=0;i<8;i++){const j=(i+1)%8;Wh.face([outer[i],outer[j],inner[j],inner[i]],'rim',[s,0,0]);}}
    const hubR = 0.07, xf = T.rim === 'spokes' ? xo - s * 0.008 : xo + s * 0.006;
    for (let k = 0; k < 5; k++) { // a spoke: a tapered blade from the hub to the lip, its face and (LOD0) two sides
      const a = Math.PI / 2 + k * Math.PI * 2 / 5, ca = Math.cos(a), sa = Math.sin(a), pc = -sa, ps = ca;
      const P0 = (r, w, x) => [x, yc + sa * r + ps * w, zc + ca * r + pc * w];
      const w0 = P.rim.spokeW, w1 = P.rim.spokeW * 0.7, rr = rimR - 0.004;
      const fr = [P0(hubR * 0.8, -w0, xf), P0(rr, -w1, xf), P0(rr, w1, xf), P0(hubR * 0.8, w0, xf)];
      Wh.face(lod===2?[[xf,yc,zc],fr[1],fr[2]]:fr, 'rim', [s, 0, 0]);
      if (T.rim === 'spokes') { const xb = xo - s * depth * 0.55; for (const e of [-1, 1]) Wh.face([P0(hubR * 0.8, e * w0, xf), P0(rr, e * w1, xf), P0(rr, e * w1, xb), P0(hubR * 0.8, e * w0, xb)], 'trim', [0, ps * e, pc * e]); }
    }
    const hub = ringAt(xf + s * 0.012, hubR, 6, 0);
    if (T.hub) Wh.face(hub, 'rim', [s, 0, 0]);
    if (T.rim === 'spokes') { const hb = ringAt(xf - s * 0.01, hubR, 6, 0); for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; Wh.face([hb[i], hb[j], hub[j], hub[i]], 'trim', sub(mix(hub[i], hub[j], 0.5), [hub[i][0], yc, zc])); } }
    // the red caliper: on the core (it doesn't turn with the wheel), up and behind the axle, inside the spokes
    if (T.calipers) { const ang = (P.rim.caliperDeg * Math.PI) / 180, r = rimR * 0.68, cz = zc - Math.cos(ang) * r, cy = yc + Math.sin(ang) * r;
      S('core').decor(() => S('core').box(xo - s * depth * 0.62, cy, cz, 0.03, 0.08, rimR * 0.6, 'caliper', [-(Math.PI / 2 - ang), 0, 0])); }
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

  // Recess the broad face's corners into two deliberately faceted planes. Split crossing
  // triangles on the centreline first so fascia, grille and substrate share the same crease.
  // This changes visual geometry only; collider points and hinge pivots stay frozen.
  if (P.section?.noseRound) for (const [id, so] of Object.entries(soups)) {
    if (id !== 'front') continue;
    const pp = [], uu = [];
    const push = v => {
      const p = v.p.slice(), t = Math.max(0, Math.min(1, (p[2] - (P.zNose - .45)) / .45));
      p[2] -= P.section.noseRound * t * (lod===0?Math.max(0,(Math.abs(p[0])-.45)/.45):Math.abs(p[0])/lerpCurve(P.hw,P.zNose));
      pp.push(...p); uu.push(...v.uv);
    };
    const half = (tri, sign, cut=0) => {
      const out=[];
      for(let i=0;i<tri.length;i++){
        const a=tri[i],b=tri[(i+1)%tri.length],da=sign*(a.p[0]-cut),db=sign*(b.p[0]-cut);
        if(da>=-1e-9)out.push(a);
        if((da>=0)!==(db>=0)){const t=da/(da-db);out.push({p:mix(a.p,b.p,t),uv:a.uv.map((v,k)=>v+(b.uv[k]-v)*t)});}
      }
      return out;
    };
    for(let i=0;i<so.p.length;i+=9){
      const tri=[0,1,2].map(k=>({p:so.p.slice(i+k*3,i+k*3+3),uv:so.uv.slice(i/3*2+k*2,i/3*2+k*2+2)}));
      let pieces=[tri];
      if(tri.some(v=>v.p[2]>P.zNose-.45))for(const cut of (lod===0?[-.45,.45]:[0]))pieces=pieces.flatMap(poly=>
        poly.some(v=>v.p[0]<cut-1e-8)&&poly.some(v=>v.p[0]>cut+1e-8)?[half(poly,1,cut),half(poly,-1,cut)]:[poly]);
      for(const poly of pieces)for(let k=1;k<poly.length-1;k++)for(const v of [poly[0],poly[k],poly[k+1]])push(v);
    }
    so.p=pp;so.uv=uu;
    // Whip is the only noncollision front decoration; the collision set is frozen independently.
    so.nc=[];
  }
  // Preserve each door's original hinge skin while refining the neighbouring shoulder.
  if (P.physicsPivots) for (const [id, so] of Object.entries(soups)) if (id.startsWith('door')) {
    const outer = Math.abs(P.physicsPivots[id][0]) + .015;
    for (let i=0;i<so.p.length;i+=3) so.p[i] = Math.sign(so.p[i]) * Math.min(Math.abs(so.p[i]), outer);
  }
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
