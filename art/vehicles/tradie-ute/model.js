// model.js: the low-poly Tradie Ute (the owner's dual-cab Mitsubishi-style tray ute) built from code (R81 method; R123 persona).
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs). P comes from params.json.
//
// Authoritative evidence (2026-10-25): refs/measured-reference.json. Owner photos from 2026-10-21 and
// tape dimensions supersede the earlier generated contact sheet. Geometry is authored here, borrowing proportions
// from the newer home model build_triton(), not importing its smooth/bevelled mesh. Metres, +Z nose, +X vehicle left.
// The cab/rack heights and positions are estimates; tray/canopy sizes and bar-to-tail distance are measured.
// Physics remains the pre-rebuild hull and pivots (colliders.json/pivots.json), including the old wheel spacing.
// Damage parts remain unchanged. Cab rack, left awning, right snorkel are core; tray/guards/canopy/hitch are back.
import * as THREE from 'three';
import { swatchUV, REGION } from './atlas.js';
// Frozen attachment locations: visual refinement must not change simulation or damage articulation.
const REST_PIVOTS = {
  "front": [
    0,
    1.31,
    0.7899999999999999
  ],
  "core": [
    0,
    0,
    0
  ],
  "door_FL": [
    1,
    0.8605,
    0.8999999999999999
  ],
  "door_RL": [
    0.99,
    0.8474999999999999,
    0
  ],
  "back": [
    0,
    1.24,
    -0.7899999999999999
  ],
  "door_FR": [
    -1,
    0.8605,
    0.8999999999999999
  ],
  "door_RR": [
    -0.99,
    0.8474999999999999,
    0
  ],
  "wheel_FL": [
    0.88,
    0.43,
    1.45
  ],
  "wheel_FR": [
    -0.88,
    0.43,
    1.45
  ],
  "wheel_RL": [
    0.88,
    0.43,
    -1.45
  ],
  "wheel_RR": [
    -0.88,
    0.43,
    -1.45
  ],
  "interior_engine": [
    0,
    0,
    0
  ],
  "interior_cabin": [
    0,
    0,
    0
  ],
  "interior_boot": [
    0,
    0,
    0
  ]
};

export const LODS = {
  0: { arch: 9, nose: 2, curvePts: true, merge: 0.08, doorMid: true, wheelSeg: 10, rim: 'flat', spokes: 6, hub: true, flare: 9, flareLip: true, flareEnds: true, tyreCap: true, windows: true, scoop: false, vents: false, mirrors: 'stalk', bar: 'full', grille: true, snorkel: 3, rack: 'full', steps: true, seams: true, tow: true, tailLamps: true },
  1: { arch: 4, nose: 1, curvePts: true, merge: 0.25, doorMid: true, wheelSeg: 8, rim: 'flat', spokes: 5, hub: false, flare: 4, flareLip: false, flareEnds: true, tyreCap: false, windows: true, scoop: false, vents: false, mirrors: 'box', bar: 'simple', grille: true, snorkel: 1, rack: 'platform', steps: false, seams: false, tow: false, tailLamps: true },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, wheelSeg: 6, rim: 'decal', hub: false, flare: 4, flareLip: false, flareEnds: false, tyreCap: false, windows: 'flat', scoop: false, vents: false, mirrors: 'box', bar: 'simple', grille: false, snorkel: 1, rack: 'platform', steps: false, seams: false, tow: false, tailLamps: false },
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
// the canopy's back (planar x, y) and its lid (planar x, z): atlas.js draws the rear door, window and chevrons, and the lid's ribs
function canopyRearUV(P, y0) { const [u0, v0, u1, v1] = REGION.canopyRear, C = P.canopy; return (v) => [u0 + (u1 - u0) * ((v[0] + C.hw) / (2 * C.hw)), v0 + (v1 - v0) * ((v[1] - y0) / (C.y1 - y0))]; }
function canopyTopUV(P) { const [u0, v0, u1, v1] = REGION.canopyTop, C = P.canopy; return (v) => [u0 + (u1 - u0) * ((v[0] + C.hw) / (2 * C.hw)), v1 - (v1 - v0) * ((C.z0 - v[2]) / (C.z0 - C.z1))]; }
function canopyUV(P, y0) { const [u0, v0, u1, v1] = REGION.canopy, C = P.canopy; return (v) => [u0 + (u1 - u0) * ((C.z0 - v[2]) / (C.z0 - C.z1)), v0 + (v1 - v0) * ((v[1] - y0) / (C.y1 - y0))]; }

// ───────────────────────── build ─────────────────────────
function makeSoups(P, lod) {
  // Coarse cab retains windshield rake, roof crown and cab back; intermediate stations disappear.
  if (lod===2) P={...P,cabin:P.cabin.filter((_,i)=>[0,1,3,5].includes(i))};
  const T = LODS[lod];
  const zA = P.zFA - P.archR, zC = P.zRA + P.archR; // door span = between the arches; front/back cut lines
  const cabBack = P.cabin.at(-1).z;
  const prot = [P.zNose, cabBack, zA, P.zB, P.zNose - 0.16];
  for (let i = 1; i <= T.nose; i++) prot.push(cabBack + 0.14 * i / T.nose);
  if (T.doorMid) prot.push((zA + P.zB) / 2, (P.zB + cabBack) / 2);
  for (let i = 2; i <= T.nose; i++) prot.push(P.zNose - 0.16 * (i - 1) / T.nose);
  for (const zc of [P.zFA]) for (let i = 0; i < T.arch; i++) prot.push(+(zc + P.archR * Math.cos(Math.PI * i / (T.arch - 1))).toFixed(4));
  const opt = T.curvePts ? [...new Set([...P.ySh, ...P.yCr, ...P.hw].map(([z]) => z))] : [];
  const Z = [];
  for (const z of [...prot, ...opt]) if (z <= P.zNose && z >= cabBack && !Z.some((k) => Math.abs(k - z) < (prot.includes(z) ? 1e-4 : T.merge))) Z.push(z);
  Z.sort((a, b) => b - a);

  const archY = (z) => {
    let y = -1;
    for (const zc of [P.zFA]) { const d = Math.abs(z - zc); if (d <= P.archR + 1e-6) y = Math.max(y, P.archBase + (P.archTop - P.archBase) * Math.sqrt(Math.max(0, 1 - (d / P.archR) ** 2))); }
    return y;
  };
  const ring = (z, s) => {
    const yb = lerpCurve(P.yBot, z), ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), hw = lerpCurve(P.hw, z);
    const ay = archY(z), lift = ay > 0 ? Math.max(yb, ay) : yb;
    // Preserve the original section when the arch clips it: lifting a cut does not lift the widest flank.
    const y2 = yb + P.skirt, y3 = ysh - P.sideDrop;
    const section = [[yb,hw-P.floorIn],[y2,hw],[(y2+y3)/2,hw-.004],[y3,hw-.022],[(y3+ysh)/2,hw-.037],[ysh,hw-P.shoulderIn]];
    const widthAt = y => { for(let i=1;i<section.length;i++) if(y<=section[i][0]) {
      const [a,wa]=section[i-1],[b,wb]=section[i]; return wa+(wb-wa)*Math.max(0,(y-a)/(b-a));
    } return section.at(-1)[1]; };
    const samples=lod===0?[y2,(y2+y3)/2,y3,(y3+ysh)/2]:[y2,y3];
    const ys=[lift,...samples.map((y,i)=>Math.max(lift+.010*(i+1),y))];
    return [[0,yb,z],...ys.map(y=>[s*widthAt(y),y,z]),[s*(hw-P.shoulderIn),ysh,z],[0,ycr,z]];
  };

  // the tub's outer skin x at (z, y) on side s, and its top surface height at (x, z) (as the Lion's)
  const skinX = (z,y,s) => {
    const r=ring(z,s);
    for(let i=2;i<r.length-1;i++) if(y<=r[i][1]) return mix(r[i-1],r[i],Math.min(1,Math.max(0,(y-r[i-1][1])/Math.max(1e-6,r[i][1]-r[i-1][1]))))[0];
    return r.at(-2)[0];
  };
  const topY = (x, z) => { const ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), w = lerpCurve(P.hw, z) - P.shoulderIn; return ycr + (ysh - ycr) * Math.min(1, Math.abs(x) / w); };

  const soups = {}; const S = (id) => (soups[id] ??= new Soup());
  const partOfTub = (zm, seg, s) => {
    if (zm > zA + 1e-6) return 'front';
    // The alloy tray is separate: no painted pickup tub behind the cab.
    if (seg >= 1 && seg <= (lod===0?5:3)) return (zm > P.zB ? 'door_F' : 'door_R') + (s > 0 ? 'L' : 'R'); // +X is the vehicle's left
    return 'core';
  };
  const sUV = sideUV(P), tUV = topUV(P);
  const segSwatch = (seg, zm) => {
    if (seg === 0) return 'under';
    if (seg === 1) return 'trim';
    if (seg === (lod===0?6:4)) return zm > zA ? tUV : zm < P.cabin.at(-1).z ? 'under' : 'paint'; // behind the cab it is under the tray deck
    return sUV;
  };
  for (const s of [1, -1]) {
    for (let i = 0; i < Z.length - 1; i++) {
      const a = ring(Z[i], s), b = ring(Z[i + 1], s), zm = (Z[i] + Z[i + 1]) / 2;
      for (let k = 0; k < a.length-1; k++) {
        const so = S(partOfTub(zm, k, s));
        const uv = k === a.length-3 ? sUV : segSwatch(k, zm);
        if (s > 0) so.quad(a[k], b[k], b[k + 1], a[k + 1], uv); else so.quad(a[k], a[k + 1], b[k + 1], b[k], uv);
      }
    }
  }
  const cap = (z, id, sign, sw) => {
    const R = ring(z, 1), Lr = ring(z, -1); const poly = [...R,...Lr.slice(1,-1).reverse()];
    const c = [0, poly.reduce((t, v) => t + v[1], 0) / poly.length, z];
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; if (sign > 0) S(id).tri(c, p, q, sw); else S(id).tri(c, q, p, sw); }
  };
  cap(P.zNose, 'front', 1, 'paint'); cap(cabBack, 'core', -1, 'paint'); // the tailgate, painted

  // greenhouse (the dual cab): ring per cabin station, one side: base(belt) → glass top → roof edge → crown. The sides are
  // painted (A, B, C pillars); the side glass is laid over them below (a black frame, then a pane per door and the quarter).
  const cring = (c, s) => {
    const yb = lerpCurve(P.ySh, c.z) - 0.005;
    if (c.yr == null) { const yc = Math.max(yb, lerpCurve(P.yCr, c.z) - 0.005); return [[s * c.wb, yb, c.z], [s * c.wt, yb + 0.002, c.z], [s * (c.wt - P.roofCh), yc, c.z], ...(lod===0?[[s*c.wt*.45,yc,c.z]]:[]),[0, yc, c.z]]; }
    return [[s*c.wb,yb,c.z],[s*c.wt,c.yr-P.roofCh,c.z],[s*(c.wt-P.roofCh*1.2),c.yr,c.z],...(lod===0?[[s*c.wt*.45,c.yr+P.roofCrown*.85,c.z]]:[]),[0,c.yr+P.roofCrown,c.z]];
  };
  const nC = P.cabin.length;
  for (const s of [1, -1]) for (let i = 0; i < nC - 1; i++) {
    const c = P.cabin[i], a = cring(c, s), b = cring(P.cabin[i + 1], s);
    for (let k = 0; k < a.length-1; k++) {
      const sw = k === 0 ? sUV : k === 1 ? sUV : c.roof === 'paint' ? 'paint' : 'glass';
      if (s > 0) S('core').quad(a[k], b[k], b[k + 1], a[k + 1], sw); else S('core').quad(a[k], a[k + 1], b[k + 1], b[k], sw);
    }
  }
  // Rear of the dual cab stays closed when the canopy/tray detaches.
  { const c=P.cabin.at(-1),a=cring(c,1),b=cring(c,-1);
    S('core').face([...a,...b.slice(0,-1).reverse()],'paint',[0,0,-1]);
  }
  const ghPoint = (z, t, s, off) => {
    let i = 0; while (i < nC - 2 && P.cabin[i + 1].z > z) i++;
    const c0 = P.cabin[i], c1 = P.cabin[i + 1], u = Math.min(1, Math.max(0, (c0.z - z) / (c0.z - c1.z)));
    const a=cring(c0,s),b=cring(c1,s);
    // Match the substrate's exact diagonal a0→b1 instead of bilinear interpolation.
    const pts=t<=u?[a[0],b[0],b[1]]:[a[0],b[1],a[1]], weights=t<=u?[1-u,u-t,t]:[1-t,u,t-u];
    const p=[0,1,2].map(k=>pts.reduce((v,q,j)=>v+q[k]*weights[j],0));
    const n=cross(sub(pts[1],pts[0]),sub(pts[2],pts[0])),L=Math.hypot(...n)||1,sg=Math.sign(n[0])===s?1:-1;
    return p.map((v,k)=>v+sg*n[k]/L*off);
  };
  const W = P.windows;
  if (T.windows) for (const s of [1, -1]) {
    const poly = (pts, off, sw) => { for (let i = 0; i < nC - 1; i++) {
      const piece=clipZ(clipZ(pts,P.cabin[i].z,-1),P.cabin[i+1].z,1);
      const diag=p=>p[1]-(P.cabin[i].z-p[0])/(P.cabin[i].z-P.cabin[i+1].z);
      const half=sign=>{
        const q=[];for(let j=0;j<piece.length;j++) {
          const a=piece[j],b=piece[(j+1)%piece.length],da=diag(a),db=diag(b),ai=sign*da>=-1e-8,bi=sign*db>=-1e-8;
          if(ai)q.push(a);if(ai!==bi){const t=da/(da-db);q.push(a.map((v,k)=>v+(b[k]-v)*t));}
        }
        if(q.length>=3)S('core').face(q.map(([z,t])=>ghPoint(z,t,s,off)),sw,[s,.3,0]);
      };
      half(-1);half(1);
    } };
    if (T.windows === true) { poly(W.frame, 0.006, 'trim'); for (const pane of W.panes) poly(pane, 0.011, 'glass'); }
    else poly(W.frame, 0.008, 'glass');
  }

  // ── bays (dark, inside the shell; seen only when a panel is gone) ──
  const bay = (cx, cy, cz, sx, sy, sz) => S('core').box(cx, cy, cz, sx, sy, sz, 'bay');
  { const hwA = lerpCurve(P.hw, zA) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zA)) / 2 - 0.02, zA + 0.03, hwA * 2, lerpCurve(P.ySh, zA) - 0.36, 0.06); }
  { const hwC = lerpCurve(P.hw, zC) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zC)) / 2 - 0.02, zC - 0.03, hwC * 2, lerpCurve(P.ySh, zC) - 0.36, 0.06); }
  for (const s of [1, -1]) { const x = s * (lerpCurve(P.hw, 0) - 0.07); S('core').quad(...(s > 0 ? [[x, 0.3, zA], [x, 0.3, zC], [x, 1.1, zC], [x, 1.1, zA]] : [[x, 0.3, zC], [x, 0.3, zA], [x, 1.1, zA], [x, 1.1, zC]]), 'bay'); }

  // ── flared wheel arches: a band round each arch cut, standing proud of the side by P.flare.out at its lip, its outer edge
  // flush with the body P.flare.w further out (front arch: part front; rear arch: part back) ──
  if (T.flare) for (const [zc, id] of [[P.zFA, 'front']]) for (const s of [1, -1]) {
    const So = S(id), n = T.flare, Fw = P.flare.w, Fo = P.flare.out, ht = P.archTop - P.archBase;
    const E = [], Ep = [], O = [], Ei = [];
    for (let i = 0; i < n; i++) {
      const th = Math.PI * i / (n - 1), z = zc + P.archR * Math.cos(th), y = P.archBase + ht * Math.sin(th);
      const zo = zc + (P.archR + Fw) * Math.cos(th), yo = P.archBase + (ht + Fw) * Math.sin(th);
      const x = skinX(z, Math.max(y, lerpCurve(P.yBot, z) + P.skirt), s);
      E.push([x, y, z]); Ep.push([s * Math.max(Math.abs(x) + Fo, P.track + P.wheelW / 2 + 0.02), y, z]); Ei.push([x - s * 0.05, y, z]); O.push([skinX(zo, yo, s) + s * 0.004, yo, zo]);
    }
    for (let i = 0; i < n - 1; i++) {
      const th = Math.PI * (i + 0.5) / (n - 1);
      So.face([Ep[i], Ep[i + 1], O[i + 1], O[i]], 'trim', [s, 0.6 * Math.sin(th), 0.6 * Math.cos(th)]); // the proud face
      if (T.flareLip) So.face([Ei[i], Ei[i + 1], Ep[i + 1], Ep[i]], 'trim', [0, -Math.sin(th), -Math.cos(th)]); // the lip's underside
    }
    if (T.flareEnds) for (const i of [0, n - 1]) So.face([Ei[i], Ep[i], O[i]], 'trim', [0, -0.2, i === 0 ? 1 : -1]);
  }

  // ── front (part: front): bonnet cap, fascia, grille, lamps, bull bar ──
  const F = S('front'), zn = P.zNose + 0.004, hwN = lerpCurve(P.hw, P.zNose), z1 = P.zNose - 0.16;
  const fq = (x0, y0, x1, y1, sw, dz = 0) => F.quad([x0, y0, zn + dz], [x1, y0, zn + dz], [x1, y1, zn + dz], [x0, y1, zn + dz], sw);
  const yAt = (z, x) => { const ysh = lerpCurve(P.ySh, z), ycr = lerpCurve(P.yCr, z), xi = lerpCurve(P.hw, z) - P.shoulderIn; return Math.abs(x) >= xi ? ysh : ycr + (ysh - ycr) * Math.abs(x) / xi; };
  // Lamps follow the hood's real longitudinal facets. The source MQ swept lens drops from the
  // shoulder near zNose-.24 toward the grille; it is neither a top decal nor a horizontal slit.
  const hoodPoint = (x,z,off=.009) => [x,topY(x,z)+off,z+.006];
  const fy = lerpCurve(P.ySh, P.zNose) - 1.0;
  const fascia = (pts,sw) => F.face(pts.map(([x,y])=>[x,y,zn+.009]),sw,[0,0,1]);
  fascia(lod===2?[[-.44,.82],[.44,.82],[.44,1.065],[-.44,1.065]]:[[-.45,.82],[.45,.82],[.49,1.065],[-.49,1.065]],'grille');
  for(const y of (lod===0?[.925,1.025]:lod===1?[1.025]:[])) {const w=lod===0?.48:.44;fascia([[-w,y],[w,y],[w,y+.026],[-w,y+.026]],'chrome');}
  for(const sign of [1,-1]) {
    const strips = lod===0 ? [P.zNose,P.zNose-.08,P.zNose-.24] : [P.zNose,P.zNose-.24];
    for(let i=0;i<strips.length-1;i++) {
      const a=strips[i],b=strips[i+1];
      F.face([hoodPoint(sign*.50,a),hoodPoint(sign*.79,a),hoodPoint(sign*.79,b),hoodPoint(sign*.50,b)],'head',[sign*.2,.65,1]);
    }
    // Dark return under each swept lens gives the front face its downturned outer corner.
    if(lod===0)fascia([[sign*.49,.96],[sign*.77,.96],[sign*.77,1.035],[sign*.49,1.035]],'grille');
  }
  const ybN = lerpCurve(P.yBot, P.zNose);
  if(lod===0)fq(-0.66, ybN + 0.07, 0.66, 0.62 + fy, 'trim'); // lower intake behind the bull bar
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

  // ── actual alloy flat tray and closed black canopy (owner tape, 2026-10-21) ──
  // Open space under the deck is deliberate: there is no painted pickup tub. Rectangular rear lamps sit in a
  // horizontal rear beam, with checker guards, mudflaps and under-tray boxes beneath the thin deck.
  const Bk = S('back'), TR = P.tray, C = P.canopy, deckTop=TR.y, zt=TR.z1-0.006;
  Bk.box(0, deckTop-.025, (TR.z0+TR.z1)/2, TR.hw*2, .05, TR.z0-TR.z1, 'chrome');
  Bk.box(0, deckTop-.11, TR.z1+.035, TR.hw*2, .12, .07, 'trim');
  Bk.box(0, (deckTop+C.y1)/2, (C.z0+C.z1)/2, C.hw*2, C.y1-deckTop, C.z0-C.z1,
    {all:'canopy',px:canopyUV(P,deckTop),nx:canopyUV(P,deckTop),nz:canopyRearUV(P,deckTop),py:canopyTopUV(P)});
  // The checker guard has sloped shoulders either side of the rear tyre, unlike a pickup flare.
  for (const sign of [1,-1]) {
    const guard=[[P.zRA+.57,.62],[P.zRA+.41,1.035],[P.zRA-.42,1.035],[P.zRA-.60,.62],
      [P.zRA-.53,.62],[P.zRA-.36,.975],[P.zRA+.36,.975],[P.zRA+.50,.62]];
    if(lod===0) Bk.slab(guard,sign>0?.65:-.9675,sign>0?.9675:-.65,'trim','chrome');
    else if(lod===1) {
      Bk.face(guard.map(([z,y])=>[sign*.9675,y,z]),'chrome',[sign,0,0]);
      for(const [a,b] of [[0,1],[1,2],[2,3]]) Bk.face([[sign*.65,guard[a][1],guard[a][0]],[sign*.9675,guard[a][1],guard[a][0]],[sign*.9675,guard[b][1],guard[b][0]],[sign*.65,guard[b][1],guard[b][0]]],'trim',[0,1,0]);
    }
    else Bk.face(guard.map(([z,y])=>[sign*.9675,y,z]),'chrome',[sign,0,0]);
    if(lod<2) Bk.box(sign*.80,.48,P.zRA-.58,.30,.34,.025,'tyre');
    else Bk.face([[sign*.65,.31,P.zRA-.60],[sign*.95,.31,P.zRA-.60],[sign*.95,.65,P.zRA-.60],[sign*.65,.65,P.zRA-.60]],'tyre',[0,0,-1]);
    if(lod<2) Bk.box(sign*.735,.83,(P.zRA-.65+TR.z1+.08)/2,.34,.26,(P.zRA-.65)-(TR.z1+.08),'trim');
    else Bk.face([[sign*.9175,.70,TR.z1+.08],[sign*.9175,.96,TR.z1+.08],[sign*.9175,.96,P.zRA-.65],[sign*.9175,.70,P.zRA-.65]],'trim',[sign,0,0]);
    // Three adjacent amber/red/white LED blocks, never tall vertical corners.
    const x=sign*.73;
    for (const [dx,sw] of [[-.10,'indicator'],[0,'tail'],[.10,'head']]) {
      const cx=x+sign*dx;
      Bk.quad([cx+.045,.945,zt],[cx-.045,.945,zt],[cx-.045,1.025,zt],[cx+.045,1.025,zt],sw);
    }
  }
  // Chassis rails and rear hitch stay visible beneath the tray, including at coarse tiers.
  if(lod<2) for (const sign of [1,-1]) Bk.box(sign*.40,.69,(TR.z0+TR.z1)/2,.10,.15,TR.z0-TR.z1,'under');
  if(lod===0) Bk.box(0,.64,TR.z1+.015,.38,.15,.02,'white');
  else Bk.face([[-.19,.565,TR.z1],[-.19,.715,TR.z1],[.19,.715,TR.z1],[.19,.565,TR.z1]],'white',[0,0,-1]);
  if(lod===0) Bk.box(0,.50,TR.z1-.035,.55,.08,.07,'trim');
  Bk.box(0,.49,TR.z1-.085,.07,.06,.14,'trim');
  Bk.prism([0,.49,TR.z1-.135],[0,.55,TR.z1-.135],.025,lod===2?4:5,'chrome','chrome');

  // ── core details: mirrors, steps, snorkel, roof rack ──
  const M = P.mirror; // decoration: the collider stays the body's width
  for (const s of [1, -1]) S('core').decor(() => {
    const xb = skinX(M.z, M.y - 0.04, s), x0 = xb + s * M.stalk, x1 = x0 + s * M.out;
    if (T.mirrors === 'box') { S('core').box((xb + x1) / 2, M.y, M.z, Math.abs(x1 - xb), M.h, M.l, 'trim'); return; }
    S('core').beam([xb - s * 0.02, M.y - 0.06, M.z + 0.02], [x0 + s * 0.01, M.y - 0.03, M.z], 0.04, 0.06, 'trim', [0, 0, 1]);
    const f = (x, k) => [[x, M.y - M.h / 2, M.z + M.l / 2 * k], [x, M.y + M.h / 2, M.z + M.l / 2 * k - 0.01], [x, M.y + M.h / 2, M.z - M.l / 2], [x, M.y - M.h / 2 + 0.02, M.z - M.l / 2]];
    const a = f(x0, 1), b = f(x1, 0.5);
    S('core').solid([a, b, ...a.map((p, i) => [p, a[(i + 1) % 4], b[(i + 1) % 4], b[i]])], 'trim');
  });
  if (T.seams) for (const s of [1, -1]) for (const z of [zA - 0.012, P.zB, cabBack + 0.035]) {
    const y0=lerpCurve(P.yBot,z)+.06,y1=lerpCurve(P.ySh,z)-.025, ym=lerpCurve(P.ySh,z)-P.sideDrop;
    for(const [lo,hi] of [[y0,ym],[ym,y1]]) S('core').face([[skinX(z,lo,s)+s*.004,lo,z-.006],[skinX(z,lo,s)+s*.004,lo,z+.006],[skinX(z,hi,s)+s*.004,hi,z+.006],[skinX(z,hi,s)+s*.004,hi,z-.006]],'trim',[s,0,0]);
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
    const R=P.rack,Co=S('core'), zm=(R.z0+R.z1)/2;
    for (const sign of [1,-1]) {
      if(lod===0) Co.box(sign*R.hw,R.y,zm,.04,.04,R.z0-R.z1,'trim');
      else {
        const xa=sign*R.hw-.02,xb=sign*R.hw+.02;
        Co.face([[xa,R.y+.02,R.z0],[xa,R.y+.02,R.z1],[xb,R.y+.02,R.z1],[xb,R.y+.02,R.z0]],'trim',[0,1,0]);
        Co.face([[sign*(R.hw+.02),R.y-.02,R.z0],[sign*(R.hw+.02),R.y+.02,R.z0],[sign*(R.hw+.02),R.y+.02,R.z1],[sign*(R.hw+.02),R.y-.02,R.z1]],'trim',[sign,0,0]);
      }
    }
    for (const z of [R.z0,R.z1]) {
      if(lod===0) Co.box(0,R.y,z,R.hw*2,.04,.05,'trim');
      else {
        Co.face([[-R.hw,R.y+.02,z-.025],[-R.hw,R.y+.02,z+.025],[R.hw,R.y+.02,z+.025],[R.hw,R.y+.02,z-.025]],'trim',[0,1,0]);
        const ze=z+(z===R.z0?.025:-.025);
        Co.face([[-R.hw,R.y-.02,ze],[-R.hw,R.y+.02,ze],[R.hw,R.y+.02,ze],[R.hw,R.y-.02,ze]],'trim',[0,0,z===R.z0?1:-1]);
      }
    }
    // Slats leave the number anchor visible between them. The awning belongs on the LEFT (+X).
    if (lod===0) for (const z of [R.z0-.14,R.z1+.14]) Co.box(0,R.y,z,R.hw*2,.025,.04,'trim');
    Co.prism([R.hw+.07,R.y+.065,R.z0+.12],[R.hw+.07,R.y+.065,R.z1-.12],.075,lod===0?6:4,'awning','awning');
    if (lod===0) for (const sign of [1,-1]) for(const z of [R.z0-.12,R.z1+.12]) Co.box(sign*(R.hw-.06),R.y-.075,z,.04,.12,.05,'trim');
  }

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
    if (T.rim === 'decal') { Wh.face(to, 'tyre', [s, 0, 0]); Wh.face(ringAt(xo + s * 0.006, P.wheelR * 0.6, 5, Math.PI / 2), 'chrome', [s, 0, 0]); continue; }
    const ro = ringAt(xo, rimR), rd = ringAt(xo - s * depth, rimR);
    if (T.rim === 'spokes') {
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([to[i], to[j], ro[j], ro[i]], 'tyre', [s, 0, 0]); } // sidewall
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; Wh.face([ro[i], ro[j], rd[j], rd[i]], 'chrome', sub([xo, yc, zc], mix(ro[i], ro[j], 0.5))); } // the rim lip, facing in
      Wh.face(rd, 'under', [s, 0, 0]); // the dark barrel
    } else { Wh.face(to, 'tyre', [s, 0, 0]); Wh.face(ringAt(xo + s * 0.003, rimR), 'under', [s, 0, 0]); } // LOD1: a flat sidewall, the barrel drawn on it
    const hubR = 0.07, xf = T.rim === 'spokes' ? xo - s * 0.008 : xo + s * 0.006;
    for (let k = 0; k < (T.spokes ?? P.rim.spokes ?? 5); k++) { // a spoke: a tapered blade from the hub to the lip, its face and (LOD0) two sides
      const a = Math.PI / 2 + k * Math.PI * 2 / (T.spokes ?? P.rim.spokes ?? 5), ca = Math.cos(a), sa = Math.sin(a), pc = -sa, ps = ca;
      const P0 = (r, w, x) => [x, yc + sa * r + ps * w, zc + ca * r + pc * w];
      const w0 = P.rim.spokeW, w1 = P.rim.spokeW * 0.7, rr = rimR - 0.004;
      const fr = [P0(hubR * 0.8, -w0, xf), P0(rr, -w1, xf), P0(rr, w1, xf), P0(hubR * 0.8, w0, xf)];
      Wh.face(fr, 'chrome', [s, 0, 0]);
      if (T.rim === 'spokes') { const xb = xo - s * depth * 0.55; for (const e of [-1, 1]) Wh.face([P0(hubR * 0.8, e * w0, xf), P0(rr, e * w1, xf), P0(rr, e * w1, xb), P0(hubR * 0.8, e * w0, xb)], 'trim', [0, ps * e, pc * e]); }
    }
    const hub = ringAt(xf + s * 0.012, hubR, 6, 0);
    if (T.hub) Wh.face(hub, 'chrome', [s, 0, 0]);
    if (T.rim === 'spokes') { const hb = ringAt(xf - s * 0.01, hubR, 6, 0); for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; Wh.face([hb[i], hb[j], hub[j], hub[i]], 'trim', sub(mix(hub[i], hub[j], 0.5), [hub[i][0], yc, zc])); } }
    // the red caliper: on the core (it doesn't turn with the wheel), up and behind the axle, inside the spokes
  }

  // ── interior blocks (what a missing panel shows, vehicle space, the same at every LOD) ──
  { const I = S('interior_engine'), zm = (zA + P.zNose) / 2; // under the bonnet: a big diesel
    I.box(0, 0.68, zm, 1.0, 0.46, 0.8, 'chrome'); I.box(0, 0.98, zm - 0.05, 0.6, 0.12, 0.5, { all: 'trim', py: 'pink' }); }
  { const I = S('interior_cabin'); // behind the doors: two front seats and the rear bench
    for (const s of [1, -1]) I.box(s * 0.44, 0.78, (zA + P.zB) / 2 - 0.12, 0.5, 0.62, 0.5, 'trim');
    I.box(0, 0.76, (P.zB + cabBack) / 2 - 0.1, 1.4, 0.56, 0.48, 'trim'); }
  { const I = S('interior_boot'), zm = (zC + P.zTail) / 2; // under the tray: ladder chassis, the spare and a jerry can
    I.box(0, 0.58, zm, 0.9, 0.16, 1.5, 'trim'); I.prism([0.25, 0.46, zm + 0.1], [0.25, 0.72, zm + 0.1], 0.34, 6, 'tyre', 'rim'); I.box(-0.45, 0.78, zm - 0.1, 0.34, 0.4, 0.2, 'trim'); }

  // Split the existing nose facets laterally before bending. Without these intermediate
  // sections the centre-to-corner chord makes a pointed V, even if its extrema are correct.
  {
    const so=soups.front, out=new Soup(), cuts=lod===0?[-.65,-.35,.35,.65]:[-.45,.45];
    const clip=(poly,k,sign)=>{
      const r=[]; for(let i=0;i<poly.length;i++) {
        const a=poly[i],b=poly[(i+1)%poly.length],ai=sign*(a.p[0]-k)>=-1e-8,bi=sign*(b.p[0]-k)>=-1e-8;
        if(ai)r.push(a);if(ai!==bi){const t=(k-a.p[0])/(b.p[0]-a.p[0]);r.push({p:mix(a.p,b.p,t),uv:a.uv.map((v,j)=>v+(b.uv[j]-v)*t)});}
      }return r;
    };
    for(let i=0;i<so.p.length;i+=9) {
      const tri=[0,1,2].map(j=>({p:so.p.slice(i+j*3,i+j*3+3),uv:so.uv.slice(i/3*2+j*2,i/3*2+j*2+2)}));
      const zs=tri.map(v=>v.p[2]);let polys=[tri];
      if(Math.max(...zs)>2.30&&Math.max(...zs)<P.zNose+.015&&Math.max(...tri.map(v=>v.p[1]))>.76) {
        for(const k of cuts) polys=polys.flatMap(poly=>{
          const xs=poly.map(v=>v.p[0]);return Math.min(...xs)<k-1e-8&&Math.max(...xs)>k+1e-8?[clip(poly,k,-1),clip(poly,k,1)]:[poly];
        });
      }
      for(const poly of polys) for(let j=1;j<poly.length-1;j++) {
        for(const v of [poly[0],poly[j],poly[j+1]]){out.p.push(...v.p);out.uv.push(...v.uv);out.c.push(1,1,1);}
      }
    }
    soups.front=out;
  }
  // The full nose skin and its graphics share one deformation. The centre stays forward while
  // both front corners sweep back, unlike a flat end cap with trim covering square corners.
  for(const id of ['front','core','door_FL','door_FR','door_RL','door_RR']) {
    const so=soups[id];
    for(let i=0;i<so.p.length;i+=3) {
      const x=so.p[i],y=so.p[i+1],z=so.p[i+2];
      // Keep the steel bar/hoop angular and fully forward of the body.
      if(z>P.zNose+.015 || z<1.65 || y<.76) continue;
      const t=Math.min(1,Math.max(0,(z-1.65)/(P.zNose-1.65)));
      so.p[i+2]-=.20*Math.pow(Math.min(1,Math.abs(x)/.86),3)*t*t;
    }
  }
  return { soups, stations: Z.length };
}

// Each part's pivot is its hinge line (plan §6.3): a loose part turns about its hinge axis through the pivot.
// Doors: the front edge on the outer skin. Front and back: their top edge where they meet the body, at the shoulder line.
// Wheels: the hub. Core: the vehicle origin. Frozen from the pre-rebuild production car at every LOD.
export function pivots(P) { return Object.fromEntries(Object.entries(REST_PIVOTS).map(([id,p])=>[id,p.slice()])); }

function pivotOf(P, id, positions) {
  if (id === 'core' || id.startsWith('interior_')) return [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < a.length-1; k++) { lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]); }
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
