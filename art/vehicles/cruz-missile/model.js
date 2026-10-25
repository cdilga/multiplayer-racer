// model.js: the low-poly Cruz Missile built from code (R81; P1-V02 moved it here from Spike J, which stays as evidence;
// rebuilt against its contact sheet in br-bwju.11).
// build(P, lod) → { group, parts, stats } for three.js; soups(P, lod) → plain per-part triangle arrays for the bake
// (tools/vehicles/bake.mjs). P comes from params.json (fitted to refs/lod-plus-1.png with tools/vehicles/fit; silhouette IoU in
// docs/evidence/P1-V-finish/cruz-missile/).
//
// Frame: metres, +Z = nose, +Y up, origin on the ground between the axles (jj.vehicle.v1). In this right-handed frame +X
// is the car's LEFT: a driver facing +Z with +Y up has +X on their left, so door_FL, wheel_FL and the UHF whip sit on +X, as
// jj-sim's wheel order already assumes. The driver sits on the right (cam_fp at −X).
//
// Shape = two flat-shaded lofts (tub + greenhouse) sampled from smooth curves in P, plus the details the sheet shows, each
// measured off the sheet's views (the numbers are in D below, in metres in the model's frame):
//   - cabin: painted pillars and roof, black-framed side glass in two door panes, the black B pillar, body-colour mirrors on
//     stalks, door handles, a black sill; the livery (atlas.js) is traced off the sheet, including the roof and boot bolts;
//   - front: big angular headlamps in dark brows, wrapping onto the wings; a black hex-mesh grille with a round badge; the bent
//     nudge bar (slanted posts, four cyan LED blocks); square fog housings with hex lamps; pink bumper wedges; a black splitter;
//     the UHF whip on the right front wing (a coil, then the whip with its red tip);
//   - rear: angular tail lamps (red, with a dark inner wedge) wrapping onto the quarters; the boot badge; a black diffuser with
//     two fins, a red reverse-light triangle, a hex exhaust and pink L-shaped corners; the raked wing with its pink endplates;
//   - wheels: 16-sided tyres with dark barrels, five-spoke rims and hubs.
// LOD changes only the sampling density and which details exist; part names and pivots are identical at every LOD.
// Damage parts (owner simplification 2026-10-02): front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; everything else is core.
import * as THREE from 'three';
import { swatchUV, REGION } from './atlas.js';

export const LODS = {
  0: { arch: 9, nose: 2, curvePts: true, merge: 0.08, doorMid: true, wheelSeg: 12, bayBoxes: true, windows: true, handles: true, sill: true, seams: false, mirrors: 'stalk', lamps: 'full', grille: 'full', fog: 'full', bar: 'full', aerial: 'coil', splitter: true, wedges: true, corners: true, exhaust: 'ring', diffFins: true, badge: true, spoiler: 'full' },
  1: { arch: 5, nose: 1, curvePts: true, merge: 0.25, doorMid: false, wheelSeg: 8, bayBoxes: false, windows: 'flat', handles: false, sill: false, seams: false, mirrors: 'box', lamps: 'full', grille: 'flat', fog: 'flat', bar: 'simple', aerial: 'rod', splitter: true, wedges: true, corners: true, exhaust: 'flat', diffFins: false, badge: false, spoiler: 'full' },
  2: { arch: 3, nose: 1, curvePts: false, merge: 1, doorMid: false, wheelSeg: 8, bayBoxes: false, windows: 'flat', handles: false, sill: false, seams: false, mirrors: 'box', lamps: 'flat', grille: 'flat', fog: 'none', bar: 'plate', aerial: 'none', splitter: false, wedges: false, corners: false, exhaust: 'none', diffFins: false, badge: false, spoiler: 'plate' },
};

// Measured off the sheet's side, front and rear views (metres in the model's frame, +X the car's left; the rear and front
// points are for the +X side and mirrored). Side glass is in (z, y); the panes are clipped to the greenhouse's glass band.
const D = {
  windows: {
    frame: [[0.665, 1.12], [0.10, 1.56], [-0.95, 1.52], [-1.34, 1.15]],
    panes: [[[0.60, 1.16], [0.15, 1.50], [-0.19, 1.51], [-0.19, 1.16]], [[-0.30, 1.16], [-0.30, 1.51], [-0.88, 1.46], [-1.28, 1.18]]],
  },
  handles: { zF: 0.0, zR: -0.76, y: 0.92 },
  front: {
    lamp: [[.57,.70],[1.0,.75],[.98,.925],[.55,.87]], // on the fascia slope
    brow: [[.545,.68],[1.025,.73],[1.005,.945],[.525,.89]],
    grille: [[-.34,.72],[.34,.72],[.43,.91],[-.43,.91]],
    badge: { y: .815, r: .062 },
    intake: { x: 0.52, y0: 0.30, y1: 0.55 },
    fog: { x: 0.69, y: 0.395, r: 0.055, house: [0.575, 0.80, 0.29, 0.50] },
    led: { x: [0.10, 0.30], y: 0.47, w: 0.115, h: 0.095 },
    wedge: [[0.40, 0.30], [0.55, 0.30], [0.605, 0.165], [0.52, 0.165]],
    lampWrap: [[.03,.75],[.34,.82],[.34,.94],[.03,.925]], // [metres back from the nose, y]
  },
  bar: { top: 0.60, topHw: 0.52, bot: 0.27, botHw: 0.645, rail: 0.075 },
  rear: {
    lamp: [[.90,1.10],[.46,1.07],[.42,.89],[.68,.86],[.94,.88]],
    inner: [[.46,.92],[.43,.89],[.68,.86],[.90,.88],[.89,.925]],
    wrap: [[0,.88],[.28,.92],[.28,1.12],[0,1.10]], // [metres forward of the tail, y]
    badge: { y: 0.93, r: 0.062 },
    diffTop: 0.52, finX: 0.415, tri: { y0: 0.235, y1: 0.375, hw: 0.08 },
    pipe: { x: 0.615, y: 0.30, r: 0.07 },
    L: [[.43,.565],[.82,.565],[.89,.29],[.84,.29],[.77,.515],[.43,.515]],
  },
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
const clip2 = (pts, k, side, axis = 0) => {
  const out = [], inside = p => side * (p[axis]-k) >= -1e-9;
  for(let i=0;i<pts.length;i++) { const a=pts[i],b=pts[(i+1)%pts.length];
    if(inside(a))out.push(a);
    if(inside(a)!==inside(b)){const t=(k-a[axis])/(b[axis]-a[axis]);out.push(a.map((v,j)=>j===axis?k:v+(b[j]-v)*t));}
  } return out.filter((p,i)=>i===0||Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1])>1e-7);
};
const clipZ = (pts,k,side) => clip2(pts,k,side);
const area2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
// Clip a measured graphic to each finished facet, then barycentrically lift it onto that exact plane.
const facetGraphic = (so,poly,tri,axes,sw,offset,out) => {
  const t=tri.map(p=>axes.map(k=>p[k])),den=area2(...t);if(Math.abs(den)<1e-10)return;
  let pc=poly;
  for(let e=0;e<3 && pc.length>=3;e++) { const a=t[e],b=t[(e+1)%3],next=[];
    for(let j=0;j<pc.length;j++){const p=pc[j],q=pc[(j+1)%pc.length],dp=area2(a,b,p)*Math.sign(den),dq=area2(a,b,q)*Math.sign(den);
      if(dp>=-1e-9)next.push(p);if((dp>=-1e-9)!==(dq>=-1e-9)){const f=dp/(dp-dq);next.push(p.map((v,k)=>v+(q[k]-v)*f));}}
    pc=next;
  }
  if(pc.length<3)return;
  so.face(pc.map(p=>{const w0=area2(t[1],t[2],p)/den,w1=area2(t[2],t[0],p)/den,w2=1-w0-w1;
    return [0,1,2].map(k=>w0*tri[0][k]+w1*tri[1][k]+w2*tri[2][k]+offset[k]);}),sw,out);
};

// ───────────────────────── triangle soup builder (non-indexed → flat shading) ─────────────────────────
class Soup {
  constructor() { this.p = []; this.uv = []; this.c = []; this.nc = []; }
  /** Draws fn's triangles as decoration the bake leaves out of the part's collider (the whip, the mirrors). */
  decor(fn) { const a = this.p.length / 3; fn(); this.nc.push([a, this.p.length / 3]); }
  tri(a, b, c, uv, col = 1) {
    if (Math.hypot(...cross(sub(b,a),sub(c,a))) < 1e-10) return;
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
    const n = [0, 0, 0]; // Newell's normal: sound even when the first corners are collinear (clamped window corners)
    for (let i = 0; i < pts.length; i++) { const c = cross(pts[i], pts[(i + 1) % pts.length]); n[0] += c[0]; n[1] += c[1]; n[2] += c[2]; }
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
  /** A square-section beam from a to b (four sides, open ends): struts, posts, the whip. `up` orients its width. */
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
  // prism along an axis: n-gon radius r, from a to b (used for wheels, the whip, pipes)
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
function roofUV() { const [u0, v0, u1, v1] = REGION.roof; return (v) => [u0 + (u1 - u0) * (v[0] / 1.9 + 0.5), v1 - (v1 - v0) * ((0.30 - v[2]) / 1.5)]; }

// ───────────────────────── build ─────────────────────────
function makeSoups(P, lod) {
  const T = LODS[lod], sideEnd = lod === 0 ? 5 : 4;
  const zA = P.zFA - P.archR, zC = P.zRA + P.archR; // door span = between the arches; front/back cut lines
  // stations along z (descending: nose → tail)
  // tub stations: protected = ends, cut lines, arch samples, the fascia slope edge; optional = profile control points
  // (dropped when within T.merge of a kept station, so coarse tiers don't pay for near-duplicate rings)
  const prot = [P.zNose, P.zTail, zA, zC, P.zB, P.zNose - 0.16];
  for (let i = 1; i <= T.nose; i++) prot.push(P.zTail + 0.14 * i / T.nose);
  if (T.doorMid) prot.push((zA + P.zB) / 2, (P.zB + zC) / 2); // longitudinal door crown, not a dent state
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
  const endWarp = ([x,y,z]) => {
    const f=Math.max(0,Math.min(1,(z-(P.zNose-.62))/.62));
    const r=Math.max(0,Math.min(1,((P.zTail+.45)-z)/.45));
    const roll=.10*Math.max(0,Math.min(1,(y-.80)/.30))+.035*Math.max(0,Math.min(1,(.42-y)/.20));
    return [x,y,z-f*((P.frontRound??0)*(.35*(x/.98)**2+.65*(x/.98)**6)+roll)+(P.rearRound??0)*r*(x/.98)**2];
  };
  // Clip the unchanged side profile at an arch; never lift its widest point up with the cut.
  const ring = (z,s) => {
    const yb=lerpCurve(P.yBot,z),ysh=lerpCurve(P.ySh,z),ycr=lerpCurve(P.yCr,z),hw=lerpCurve(P.hw,z);
    const lift=Math.max(yb,archY(z)),y2=Math.max(lift+.025,yb+P.skirt),ym=Math.max(y2,.60),y3=Math.max(ym+.04,ysh-P.sideDrop);
    const shoulder=P.shoulderIn*(z<-.84?.65:1);
    const width=y=>{const t=Math.max(0,Math.min(1,(y-.55)/(ysh-.55)));
      return hw-shoulder*t*t-.045*Math.max(0,Math.min(1,(.42-y)/.20));};
    const pts=[[0,yb,z],[s*Math.min(hw-P.floorIn,width(lift)),lift,z],[s*width(y2),y2,z],
      [s*width(ym),ym,z]];
    if(lod===0)pts.push([s*width(y3),y3,z]);
    pts.push([s*(hw-shoulder),ysh,z]);
    if(lod===0)pts.push([s*(hw-shoulder)*.5,ycr-.012,z]);
    pts.push([0,ycr,z]);return pts.map(endWarp);
  };
  const skinX=(z,y,s)=>{const r=ring(z,s);for(let k=1;k<sideEnd;k++)if(y<=r[k+1][1])return mix(r[k],r[k+1],Math.max(0,Math.min(1,(y-r[k][1])/Math.max(1e-8,r[k+1][1]-r[k][1]))))[0];return r[sideEnd][0];};

  const hull = [], capHull = [];
  const soups = {}; const S = (id) => (soups[id] ??= new Soup());
  const partOfTub = (zm, seg, s) => {
    if (zm > zA + 1e-6) return 'front';
    if (zm < zC - 1e-6) return 'back';
    if (seg >= 1 && seg < sideEnd) return (zm > P.zB ? 'door_F' : 'door_R') + (s > 0 ? 'L' : 'R'); // +X is the car's left
    return 'core';
  };
  const sUV = sideUV(P), tUV = topUV(P), dUV = deckUV(P), rUV = roofUV();
  const segSwatch = (seg, zm) => {
    if (seg === 0) return 'under';
    if (seg === 1) return 'trim';
    if (seg >= sideEnd) return zm > zA ? tUV : zm < P.cabin.at(-1).z ? dUV : 'paint';
    return sUV; // 2, 3: side skin with livery (seg 3 = shoulder chamfer carries livery too)
  };
  for (const s of [1, -1]) {
    for (let i = 0; i < Z.length - 1; i++) {
      const a = ring(Z[i], s), b = ring(Z[i + 1], s), zm = (Z[i] + Z[i + 1]) / 2;
      for (let k = 0; k < a.length-1; k++) {
        // The arch lip is not the floor edge. Lofting it down to the centreline made
        // a huge curved fan underneath each wheel opening, visible from low cameras.
        if(k===0)continue;
        const so = S(partOfTub(zm, k, s));
        hull.push([a[k],b[k],b[k+1]],[a[k],b[k+1],a[k+1]]);
        // winding: outward normals. ring order goes bottom→top on side s; for s>0 use (a_k, b_k, b_k+1, a_k+1)
        if (s > 0) so.quad(a[k], b[k], b[k + 1], a[k + 1], segSwatch(k, zm)); else so.quad(a[k], a[k + 1], b[k + 1], b[k], segSwatch(k, zm));
      }
    }
  }
  // A level floor narrows around the wheels; arch height never pulls it upward.
  // Inner well walls hide the opposite shell without the old diagonal floor fans.
  for(let i=0;i<Z.length-1;i++){
    const za=Z[i],zb=Z[i+1],ya=lerpCurve(P.yBot,za),yb=lerpCurve(P.yBot,zb);
    const wa=archY(za)>ya+.001?.64:Math.abs(ring(za,1)[1][0]);
    const wb=archY(zb)>yb+.001?.64:Math.abs(ring(zb,1)[1][0]);
    S(partOfTub((za+zb)/2,0,1)).face([[-wa,ya,za],[wa,ya,za],[wb,yb,zb],[-wb,yb,zb]].map(endWarp),'under',[0,-1,0]);
    for(const sign of [-1,1]){
      const ha=Math.max(ya,archY(za)),hb=Math.max(yb,archY(zb));
      if(ha<=ya+.001&&hb<=yb+.001)continue;
      S(partOfTub((za+zb)/2,0,sign)).face([[sign*.64,ya,za],[sign*.64,yb,zb],[sign*.64,hb,zb],[sign*.64,ha,za]],'under',[sign,0,0]);
    }
  }
  // Real curved end surfaces, sectioned across x. The fascia has height, rather than being a steep hood ramp.
  const cap=(z,id,dir)=>{
    const R=ring(z,1),L=ring(z,-1),outline=[...R,...L.slice(1,L.length-1).reverse()].map(p=>[p[0],p[1]]);
    const xs=lod===0?[-1.1,-.72,-.38,0,.38,.72,1.1]:[-1.1,-.58,0,.58,1.1];
    const ys=lod===0?[0,.6,.84,1.5]:[0,1.5];
    for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++){
      const pc=clip2(clip2(clip2(clip2(outline,xs[i],1),xs[i+1],-1),ys[j],1,1),ys[j+1],-1,1);
      const pts=pc.map(([x,y])=>endWarp([x,y,z+dir*(lod===0?.06:0)*Math.max(0,1-(x/1.02)**2)*Math.max(0,1-Math.abs(y-.60)/.65)]));
      for(let k=1;k<pts.length-1;k++){const tri=[pts[0],pts[k],pts[k+1]];S(id).face(tri,'paint',[0,0,dir]);capHull.push(tri);}
    }
  };
  cap(P.zNose,'front',1);cap(P.zTail,'back',-1);
  const noseZ=(x,y)=>{
    for(const t of capHull){if(t.some(p=>p[2]<P.zNose-.65))continue;
      const q=t.map(p=>[p[0],p[1]]),d=area2(...q);if(Math.abs(d)<1e-10)continue;
      const a=area2(q[1],q[2],[x,y])/d,b=area2(q[2],q[0],[x,y])/d,c=1-a-b;
      if(Math.min(a,b,c)>=-1e-7)return a*t[0][2]+b*t[1][2]+c*t[2][2];
    }return endWarp([x,y,P.zNose])[2];
  };
  const endGraphic=(so,poly,sw,off,dir)=>{
    for(const tri of capHull){if(!tri.every(p=>dir>0?p[2]>P.zNose-.65:p[2]<P.zTail+.45))continue;
      const n=cross(sub(tri[1],tri[0]),sub(tri[2],tri[0]));if(Math.abs(n[2])<1e-8)continue;
      facetGraphic(so,poly,tri,[0,1],sw,[0,0,dir*off],[0,0,dir]);}
  };

  // ── greenhouse: ring per cabin station, one side: base (belt) → glass top → roof edge → crown. The sides and pillars are
  // painted (the side glass is laid over them below). A station with yr null is the windscreen base or the backlight foot: its
  // ring lies flat on the body. Each station's `roof` says what the span behind it is: glass (the windscreen, the backlight)
  // or the painted roof (carrying the roof bolts). ──
  const cring = (c, s) => {
    const yb = lerpCurve(P.ySh, c.z) - 0.005;
    if (c.yr == null) { const yc = Math.max(yb, lerpCurve(P.yCr, c.z) - 0.005); return [[s * c.wb, yb, c.z], [s * c.wt, yb + 0.002, c.z], [s * (c.wt - P.roofCh), yc, c.z], [0, yc, c.z]]; }
    return [[s * c.wb, yb, c.z], [s * c.wt, c.yr - P.roofCh, c.z], [s * (c.wt - P.roofCh * 1.2), c.yr, c.z], [0, c.yr + P.roofCrown, c.z]];
  };
  const nC = P.cabin.length;
  for (const s of [1, -1]) for (let i = 0; i < nC - 1; i++) {
    const c = P.cabin[i], a = cring(c, s), b = cring(P.cabin[i + 1], s), roof = c.roof === 'paint';
    for (let k = 0; k < 3; k++) {
      const windowUV=v=>{const [u0,v0,u1,v1]=REGION.windscreen;const t=(v[2]-.14)/(.92-.14);return [u0+(u1-u0)*(v[0]/1.95+.5),v1-(v1-v0)*t];};
      const sw = k === 0 ? sUV : roof ? (k === 1 ? 'paint' : rUV) : k === 1 ? 'paint' : c.z>0?windowUV:'glass';
      if (s > 0) S('core').quad(a[k], b[k], b[k + 1], a[k + 1], sw); else S('core').quad(a[k], a[k + 1], b[k + 1], b[k], sw);
    }
  }
  // a point on the greenhouse side of span i at (z, y), pushed out by `off`; y beyond the glass band is pulled onto its edge
  const spanPoint = (i, z, y, s, off) => {
    const c0 = P.cabin[i], c1 = P.cabin[i + 1], u = (c0.z - z) / (c0.z - c1.z);
    const a = cring(c0, s), b = cring(c1, s), lo = mix(a[0], b[0], u), hi = mix(a[1], b[1], u);
    const t = Math.min(0.95, Math.max(0.04, (y - lo[1]) / (hi[1] - lo[1])));
    const p = mix(lo, hi, t), n = cross(sub(hi, lo), [0, 0, 1]), L = Math.hypot(...n) || 1, sg = Math.sign(n[0]) === s ? 1 : -1;
    return [p[0] + sg * n[0] / L * off, p[1] + sg * n[1] / L * off, z];
  };
  // ── side glass: one black frame over the whole glazed band, then the two door panes (the B pillar is the frame between) ──
  if (T.windows) for (const s of [1, -1]) {
    // a (z, y) polygon, cut at every cabin station so each piece lies flat on its own span of the greenhouse
    const poly=(pts,off,sw)=>{for(let i=0;i<nC-1;i++){
      const a=cring(P.cabin[i],s),b=cring(P.cabin[i+1],s);
      for(const tri of [[a[0],b[0],b[1]],[a[0],b[1],a[1]]])
        S('core').decor(()=>facetGraphic(S('core'),pts,tri,[2,1],sw,[s*off,0,0],[s,.2,0]));
    }};
    if (T.windows === true) { poly(D.windows.frame, 0.006, 'black'); for (const pane of D.windows.panes) poly(pane, 0.011, 'glass'); }
    else { poly(D.windows.frame,.008,'glass');if(lod===1)poly([[-.19,1.1],[-.19,1.56],[-.30,1.56],[-.30,1.1]],.012,'black'); } // LOD2: one glazed band
  }

  // ── bays (dark, inside the shell; seen only when a panel is gone) ──
  // (a box at LOD0/1; at LOD2 its two big faces only)
  const bay = (cx, cy, cz, sx, sy, sz) => { if (T.bayBoxes) { S('core').box(cx, cy, cz, sx, sy, sz, 'bay'); return; }
    for (const e of [-1, 1]) S('core').face([[cx - sx / 2, cy - sy / 2, cz + e * sz / 2], [cx + sx / 2, cy - sy / 2, cz + e * sz / 2], [cx + sx / 2, cy + sy / 2, cz + e * sz / 2], [cx - sx / 2, cy + sy / 2, cz + e * sz / 2]], 'bay', [0, 0, e]); };
  { const hwA = lerpCurve(P.hw, zA) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zA)) / 2 - 0.02, zA + 0.03, hwA * 2, lerpCurve(P.ySh, zA) - 0.36, 0.06); } // firewall
  { const hwC = lerpCurve(P.hw, zC) - 0.14; bay(0, (0.30 + lerpCurve(P.ySh, zC)) / 2 - 0.02, zC - 0.03, hwC * 2, lerpCurve(P.ySh, zC) - 0.36, 0.06); } // rear bulkhead
  for (const s of [1, -1]) { const x = s * (lerpCurve(P.hw, 0) - 0.20); S('core').quad(...(s > 0 ? [[x, 0.3, zA], [x, 0.3, zC], [x, 1.05, zC], [x, 1.02, zA]] : [[x, 0.3, zC], [x, 0.3, zA], [x, 1.02, zA], [x, 1.05, zC]]), 'bay'); }

  // Side wraps use the same actual deformed wing facets, including their triangle diagonals.
  const wrap=(so,corners,s,sw,z0,dir,out)=>{
    const poly=corners.map(([dz,y])=>[z0+dir*dz,y]);
    for(const tri of hull){
      const n=cross(sub(tri[1],tri[0]),sub(tri[2],tri[0]));
      if(Math.abs(n[0])<Math.max(Math.abs(n[1])*.65,Math.abs(n[2])*.25))continue;
      if(!tri.every(p=>s*p[0]>=-1e-8))continue;
      if(!tri.every(p=>dir<0?p[2]>P.zNose-.70:p[2]<P.zTail+.55))continue;
      facetGraphic(so,poly,tri,[2,1],sw,[s*.006,0,0],out);
    }
  };

  // ── front fascia (part: front): the grille, lamps and the pink/black lower bumper, then the nudge bar ──
  const F = S('front'),zn=P.zNose+.004,hwN=lerpCurve(P.hw,P.zNose),Fr=D.front;
  const fq=(x0,y0,x1,y1,sw,dz=0)=>endGraphic(F,[[x0,y0],[x1,y0],[x1,y1],[x0,y1]],sw,.006+dz,1);
  const ybN=lerpCurve(P.yBot,P.zNose);
  const yAt=(z,x)=>{const ysh=lerpCurve(P.ySh,z),ycr=lerpCurve(P.yCr,z),xi=lerpCurve(P.hw,z)-P.shoulderIn;return ycr+(ysh-ycr)*Math.min(1,Math.abs(x)/xi);};
  const onSlope=(x,y,k=1)=>endWarp([x,y,P.zNose+.008*k]);
  const slopePoly=(pts,sw,s=1,k=1)=>endGraphic(F,pts.map(([x,y])=>[s*x,y]),sw,.008*k,1);
  // the black hex-mesh grille with its round badge
  slopePoly(Fr.grille, T.grille === 'full' ? 'grille' : 'black', 1, 0.7);
  if (T.grille === 'full') {
    for(const y of [.77,.84])slopePoly([[-.38,y],[.38,y],[.38,y+.012],[-.38,y+.012]],'trim',1,1.4); // two mesh bars
    const b = Fr.badge, pts = Array.from({ length: 8 }, (_, i) => { const a = Math.PI * 2 * (i + 0.5) / 8; return onSlope(Math.cos(a) * b.r, b.y + Math.sin(a) * b.r * 1.05, 1.6); });
    slopePoly(Array.from({length:8},(_,i)=>{const a=Math.PI*2*(i+.5)/8;return [Math.cos(a)*b.r,b.y+Math.sin(a)*b.r*1.05];}),'trim',1,1.6);
  }
  // the headlamps: a dark brow, the lamp, and its wrap onto the wing
  for (const s of [1, -1]) {
    if (T.lamps === 'full') slopePoly(Fr.brow, 'black', s, 0.5);
    slopePoly(Fr.lamp, 'head', s, 1);
    if (T.corners) {
      wrap(F, Fr.lampWrap, s, 'head', P.zNose, -1, [s, 0, 0.2]);
    }
  }
  // the lower intake behind the nudge bar, the fog housings and lamps, the pink wedges
  fq(-Fr.intake.x, Fr.intake.y0, Fr.intake.x, Fr.intake.y1, 'grille', 0.002);
  for (const s of [1, -1]) {
    const f = Fr.fog, [xa, xb, ya, yb] = f.house, cx = s * f.x;
    if (T.fog !== 'none') fq(Math.min(s * xa, s * xb), ya, Math.max(s * xa, s * xb), yb, 'black', 0.003);
    if (T.fog === 'full') F.prism([cx,f.y,noseZ(cx,f.y)+.024],[cx,f.y,noseZ(cx,f.y)+.038], f.r, 6, 'trim', 'fog', Math.PI / 6);
    else if (T.fog === 'flat') slopePoly(Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + Math.PI * 2 * i / 6; return [cx + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r]; }), 'fog', 1, 1.8);
  }
  // the black splitter under the nose
  if(T.splitter)for(let i=0;i<4;i++){const x0=-.98+i*.49,x1=x0+.49;
    const p=(x,y,d)=>[x,y,noseZ(x,Math.max(y,ybN+.01))+d];
    F.face([p(x0,ybN+.03,.045),p(x1,ybN+.03,.045),p(x1,ybN-.015,.045),p(x0,ybN-.015,.045)],'trim',[0,0,1]);
    F.face([p(x0,ybN+.03,-.08),p(x1,ybN+.03,-.08),p(x1,ybN+.03,.045),p(x0,ybN+.03,.045)],'trim',[0,1,0]);}
  // the nudge bar: a top rail, two slanted posts and a bottom rail, with four cyan LED blocks between the posts
  const B = P.bar, Bd = D.bar, bz = B.z - (lod===2?.06:0);
  const barZ=(x,y)=>bz+.025+noseZ(x,y)-noseZ(0,y);
  const barPoint=(x,y)=>[x,y,barZ(x,y)];
  const rail=(y,hw)=>{for(const [a,b] of [[-hw,0],[0,hw]])F.beam(barPoint(a,y),barPoint(b,y),Bd.rail,.07,'trim');};
  if (T.bar === 'full' || T.bar === 'simple') {
    rail(Bd.top,Bd.topHw);rail(Bd.bot,Bd.botHw);
    for (const s of [1, -1]) F.beam(barPoint(s*Bd.topHw,Bd.top),barPoint(s*Bd.botHw,Bd.bot),Bd.rail,.07,'trim',[0,0,1]);
    // All tiers have visible brackets reaching the actual curved bumper, not the old flat nose plane.
    for(const s of [1,-1]){const x=s*Bd.topHw,y=Bd.top;
      F.beam([x,y,barZ(x,y)-.02],[x,y,noseZ(x,y)-.025],.05,.05,'trim');}
    const L = Fr.led;
    for (const x of [-L.x[1], -L.x[0], L.x[0], L.x[1]]) {
      if (T.bar === 'full') F.box(x, L.y, barZ(x,L.y) + 0.012, L.w, L.h, 0.045, { all: 'trim', pz: 'led' });
      else F.face([[x-L.w/2,L.y-L.h/2],[x+L.w/2,L.y-L.h/2],[x+L.w/2,L.y+L.h/2],[x-L.w/2,L.y+L.h/2]].map(([u,v])=>[u,v,barZ(u,v)+.04]),'led',[0,0,1]);
    }
    if (T.bar === 'simple') slopePoly([[-Bd.topHw,L.y-.07],[Bd.topHw,L.y-.07],[Bd.topHw,L.y+.07],[-Bd.topHw,L.y+.07]],'black',1,1.2);
  } else { // LOD2: a flat dark plate with the LEDs as one lit strip
    for(const [a,b] of [[-Bd.topHw,0],[0,Bd.topHw]]){
      F.face([[a,Bd.bot],[b,Bd.bot],[b,Bd.top],[a,Bd.top]].map(([x,y])=>barPoint(x,y)),'black',[0,0,1]);
      F.face([[a,Bd.top,barZ(a,Bd.top)-.07],[b,Bd.top,barZ(b,Bd.top)-.07],barPoint(b,Bd.top),barPoint(a,Bd.top)],'trim',[0,1,0]);}
    for(const [a,b] of [[-.36,0],[0,.36]])F.face([[a,Fr.led.y-.05],[b,Fr.led.y-.05],[b,Fr.led.y+.05],[a,Fr.led.y+.05]].map(([x,y])=>[x,y,barZ(x,y)+.006]),'led',[0,0,1]);
  }
  if (T.wedges) for (const s of [1, -1]) F.face(Fr.wedge.map(([x,y])=>[s*x,y,barZ(s*x,y)+.039]),'pink',[0,0,1]);
  // the UHF whip on the right front wing (+X): a spring coil, then the whip with its red tip, leaning back a touch
  if (T.aerial !== 'none') { const A = P.aerial, y0 = yAt(A.z, A.x) - 0.01, zt = A.z - A.lean, yc = y0 + 0.35, f = (y) => A.z - A.lean * (y - y0) / (A.top - y0);
    F.decor(() => {
      if (T.aerial === 'coil') {
        F.prism([A.x, y0, A.z], [A.x, y0 + 0.05, A.z], A.r * 3.2, 6, 'trim', 'trim');
        for (let i = 0; i < 6; i++) { const y = y0 + 0.05 + i * 0.05; F.prism([A.x, y, f(y)], [A.x, y + 0.03, f(y + 0.03)], A.r * 2.7, 6, 'black', 'black'); }
      } else F.prism([A.x, y0, A.z], [A.x, yc, f(yc)], A.r * 2.2, 4, 'black', 'black');
      F.prism([A.x, yc, f(yc)], [A.x, A.top - 0.09, f(A.top - 0.09)], A.r, T.aerial === 'coil' ? 5 : 3, 'black', 'black');
      F.prism([A.x, A.top - 0.09, f(A.top - 0.09)], [A.x, A.top, zt], A.r, T.aerial === 'coil' ? 5 : 3, 'tail', 'tail');
    }); }

  // ── rear (part: back) ──
  const Bk = S('back'), zt = P.zTail - 0.004, hwT = lerpCurve(P.hw, P.zTail), ybT = lerpCurve(P.yBot, P.zTail), Rr = D.rear;
  const rpoly=(pts,sw,dz=0,s=1)=>endGraphic(Bk,pts.map(([x,y])=>[s*x,y]),sw,.006+dz,-1);
  for (const s of [1, -1]) {
    rpoly(Rr.lamp, 'tail', 0, s);
    if (T.lamps === 'full') rpoly(Rr.inner, 'taildk', 0.003, s);
    if (T.corners) { // the lamp's wrap onto the rear quarter
      wrap(Bk, Rr.wrap, s, 'tail', P.zTail, 1, [s, 0, -0.2]);
    }
  }
  if (T.badge) { const b = Rr.badge; rpoly(Array.from({length:8},(_,i)=>{const a=Math.PI*2*(i+.5)/8;return [Math.cos(a)*b.r,b.y+Math.sin(a)*b.r];}),'under',.014); }
  // the black diffuser, its two fins, the red reverse-light triangle, the hex exhaust and the pink L corners
  { const r = ring(P.zTail, 1), yd = Rr.diffTop;
    rpoly([[r[1][0],r[1][1]],[-r[1][0],r[1][1]],[-r[2][0],r[2][1]],[-r[2][0],yd],[r[2][0],yd],[r[2][0],r[2][1]]],T.diffFins?'under':'black',.008);
    if (T.diffFins) for (const s of [1, -1]) { const x = s * Rr.finX, w = 0.016, d = 0.07, y0 = ybT + 0.02, y1 = yd - 0.03;
      Bk.solid([[[x - w, y0, zt], [x - w, y1, zt], [x - w, y1, zt - d], [x - w, y0, zt - d * 1.4]], [[x + w, y0, zt], [x + w, y1, zt], [x + w, y1, zt - d], [x + w, y0, zt - d * 1.4]], [[x - w, y1, zt - d], [x + w, y1, zt - d], [x + w, y0, zt - d * 1.4], [x - w, y0, zt - d * 1.4]]], 'trim'); }
    const t = Rr.tri; rpoly([[-t.hw,t.y1],[t.hw,t.y1],[0,t.y0]],'tail',.015);
    const c = [Rr.pipe.x, Rr.pipe.y, zt], r0 = Rr.pipe.r;
    if (T.exhaust === 'ring') {
      const n = 6, ring2 = (rr, dz) => Array.from({ length: n }, (_, i) => { const a = Math.PI / 6 + Math.PI * 2 * i / n; return [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, zt - dz]; });
      const o = ring2(r0, 0.05), o0 = ring2(r0, 0), inn = ring2(r0 * 0.72, 0.05), deep = ring2(r0 * 0.72, 0.02);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n;
        Bk.face([o0[i], o0[j], o[j], o[i]], 'chrome', sub(mix(o[i], o[j], 0.5), [c[0], c[1], zt - 0.05]));
        Bk.face([o[i], o[j], inn[j], inn[i]], 'chrome', [0, 0, -1]); }
      Bk.face(deep, 'black', [0, 0, -1]);
    } else if (T.exhaust === 'flat') Bk.face(Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + Math.PI * 2 * i / 6; return [c[0] + Math.cos(a) * r0, c[1] + Math.sin(a) * r0, zt - 0.006]; }), 'chrome', [0, 0, -1]);
    if(T.wedges)for(const s of [1,-1])rpoly(Rr.L,'pink',.012,s);
  }
  // the wing: a body-colour blade on two black uprights, pink raked endplates; a plain plate on two posts at LOD2
  const SP = P.spoiler;
  { Bk.box(0, SP.y, SP.z, SP.span * 2, 0.045, SP.chord, { all: 'paint', px: 'pink', nx: 'pink' }, [SP.tilt, 0, 0]);
    const deck = lerpCurve(P.yCr, SP.z);
    for (const s of [1, -1]) Bk.box(s * SP.span * 0.55, (deck + SP.y) / 2, SP.z + 0.04, 0.05, SP.y - deck, 0.10, 'trim', [-0.25, 0, 0]);
    // endplates: the reference's raked parallelogram, measured off the side view (z, y) and moved with the wing
    if (T.spoiler === 'full') { const dz = SP.z + 1.98, dy = SP.y - 1.42, poly = [[-1.79, 1.13], [-2.12, 1.22], [-2.23, 1.53], [-1.74, 1.32]].map(([z, y]) => [z + dz, y + dy]);
      for (const s of [1, -1]) {
        if(lod===1) { // endplate silhouette and both faces survive; hidden thickness funds conforming lamps
          const q=poly.map(([z,y])=>[s*SP.span,y,z]);Bk.face(q,s>0?sUV:'pink',[1,0,0]);Bk.face(q,s>0?'pink':sUV,[-1,0,0]);
        } else Bk.slab(poly, s * SP.span - 0.018, s * SP.span + 0.018, 'pink', s > 0 ? sUV : 'pink', s > 0 ? 'pink' : sUV);
      } } }

  // ── side details (core and doors): the sill, door seams, handles ──
  if (T.sill) for (const s of [1, -1]) { const x = s * (lerpCurve(P.hw, 0) + 0.012), y0 = lerpCurve(P.yBot, 0) + 0.075;
    S('core').decor(() => S('core').box(x, y0, (zA + zC) / 2, 0.05, 0.075, zA - zC, 'black')); }
  if (T.seams) for (const s of [1, -1]) {
    for (const z of [zA - 0.012, P.zB, zC + 0.012]) {
      const x = skinX(z, 0.9, s) + s * 0.003, y0 = lerpCurve(P.yBot, z) + P.skirt + 0.02, y1 = lerpCurve(P.ySh, z) - 0.05;
      S('core').quad(...(s > 0 ? [[x, y0, z + 0.008], [x, y0, z - 0.008], [x, y1, z - 0.008], [x, y1, z + 0.008]] : [[x, y0, z - 0.008], [x, y0, z + 0.008], [x, y1, z + 0.008], [x, y1, z - 0.008]]), 'trim');
    }
  }
  if (T.handles) for (const s of [1, -1]) for (const [z, door] of [[D.handles.zF, 'door_F'], [D.handles.zR, 'door_R']]) {
    const y = D.handles.y, x = skinX(z, y, s), So = S(door + (s > 0 ? 'L' : 'R'));
    So.face([[x + s * 0.004, y - 0.04, z + 0.085], [x + s * 0.004, y - 0.04, z - 0.085], [x + s * 0.004, y + 0.04, z - 0.085], [x + s * 0.004, y + 0.04, z + 0.085]], 'trim', [s, 0, 0]); // the pocket
    So.box(x + s * 0.008, y, z, 0.016, 0.035, 0.13, 'paint'); // the body-colour handle
  }

  // ── mirrors (core: they stay with the greenhouse): body-colour angular heads on short stalks ──
  const M = P.mirror; // decoration (the physics hulls are frozen: vehicle.json colliderPoints)
  for (const s of [1, -1]) S('core').decor(() => {
    const xb = skinX(M.z, M.y - 0.04, s), x0 = xb + s * M.stalk, x1 = x0 + s * M.out;
    if (T.mirrors === 'box') { S('core').box((xb + x1) / 2, M.y, M.z, Math.abs(x1 - xb), M.h, M.l, 'paint'); return; }
    S('core').beam([xb - s * 0.02, M.y - 0.045, M.z + 0.02], [x0 + s * 0.01, M.y - 0.02, M.z], 0.03, 0.05, 'trim', [0, 0, 1]);
    const f = (x, k) => [[x, M.y - M.h / 2, M.z + M.l / 2 * k], [x, M.y + M.h / 2, M.z + M.l / 2 * k - 0.02], [x, M.y + M.h / 2, M.z - M.l / 2], [x, M.y - M.h / 2 + 0.02, M.z - M.l / 2]];
    const a = f(x0, 1), b = f(x1, 0.45);
    S('core').solid([a, b, ...a.map((p, i) => [p, a[(i + 1) % 4], b[(i + 1) % 4], b[i]])], 'paint');
    S('core').face(a.map((p) => [p[0] - s * 0.002, p[1], p[2]]), 'trim', [-s, 0, 0]); // the dark face against the glass
  });

  // ── wheels: closed faceted tyre shells with atlas barrel/spokes (Hawk method).
  // The circumradius keeps the bottom flat on the ground at every sampling tier.
  const n = T.wheelSeg, tyreR = P.wheelR / Math.cos(Math.PI / n);
  for (const [id, zc, sign] of [['wheel_FL',P.zFA,1],['wheel_FR',P.zFA,-1],['wheel_RL',P.zRA,1],['wheel_RR',P.zRA,-1]]) {
    const wheel=S(id), xw=sign*P.track, xo=xw+sign*P.wheelW/2, xi=xw-sign*P.wheelW/2, yc=P.wheelR;
    const ringAt=x=>Array.from({length:n},(_,i)=>{const a=1.5*Math.PI-Math.PI/n+i*Math.PI*2/n;
      return [x,yc+Math.sin(a)*tyreR,zc+Math.cos(a)*tyreR];});
    const outer=ringAt(xo),inner=ringAt(xi);
    for(let i=0;i<n;i++){const j=(i+1)%n;wheel.face([inner[i],inner[j],outer[j],outer[i]],'tyre',sub(mix(outer[i],outer[j],.5),[xo,yc,zc]));}
    wheel.face(inner,'tyre',[-sign,0,0]);
    const [u0,v0,u1,v1]=REGION.wheel;
    wheel.face(outer,v=>[u0+(u1-u0)*(.5+.46*(v[2]-zc)/tyreR),v0+(v1-v0)*(.5+.46*(v[1]-yc)/tyreR)],[sign,0,0]);
  }

  // ── interior blocks (P1-V03): what a missing panel shows, in vehicle space, the same at every LOD. Drawn only for a
  // car whose part exposes them (vehicle.json `interiors`), so an undamaged field never pays for them. ──
  { const I = S('interior_engine'), zm = (zA + P.zNose) / 2; // under the front piece
    I.box(0, 0.6, zm, 0.95, 0.4, 0.7, 'chrome'); I.box(0, 0.86, zm - 0.05, 0.6, 0.12, 0.45, { all: 'trim', py: 'pink' }); }
  { const I = S('interior_cabin'); // behind the doors: two front seats and the rear bench
    for (const s of [1, -1]) I.box(s * 0.42, 0.72, (zA + P.zB) / 2 - 0.12, 0.5, 0.62, 0.5, 'trim');
    I.box(0, 0.7, (P.zB + zC) / 2 - 0.1, 1.3, 0.56, 0.48, 'trim'); }
  { const I = S('interior_boot'), zm = (zC + P.zTail) / 2; // under the back piece: the spare and a toolbox
    I.prism([0.25, 0.42, zm], [0.25, 0.62, zm], 0.3, 6, 'tyre', 'rim'); I.box(-0.45, 0.55, zm, 0.4, 0.25, 0.5, 'pink'); }

  return { soups, stations: Z.length };
}

// Each part's pivot is its hinge line (P1-V03, plan §6.3): a loose part turns about its hinge axis through the pivot.
// Doors: the front edge on the outer skin (they swing out 0–70° like a real door). Front and back: their top edge where
// they meet the body, at the shoulder line on the cut (they hang 0–25°). Wheels: the hub (±6° camber wobble). Core:
// the vehicle origin. Measured on LOD0, because the contract wants one pivot per part at every LOD.
export function pivots(P) {
  const out = {};
  for (const [id, so] of Object.entries(makeSoups(P, 0).soups)) out[id] = P.physicsPivots?.[id]?.slice() ?? pivotOf(P, id, so.p);
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
