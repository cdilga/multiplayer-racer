// bike.js (br-bwju.5): the shared kit for code-built motorbikes (R81, the bike part set of jj.vehicle.v1: core, front, back,
// rider, wheel_F, wheel_R). A bike's model.js imports it and adds its own details; the bake, the fit page and the tests
// only ever load a car's or bike's model.js. This folder has no vehicle.json, so nothing treats it as a vehicle.
//
// Frame: metres, +Z = nose, +Y up, origin on the ground between the axles; +X is the bike's LEFT (as for the cars).
// Every shape is a flat-shaded triangle soup on one atlas: each triangle samples a swatch cell's centre (`swatchUV`).
import * as THREE from 'three';

/** Triangle soup (non-indexed, so flat-shaded): positions, UVs. `uv` is a swatch resolver: name → [u, v]. */
export class Soup {
  constructor(uv) { this.p = []; this.uv = []; this.nc = []; this.sw = uv; }
  /** Draws fn's triangles as decoration the bake leaves out of the part's collider (hand guards, lamps, spokes). */
  decor(fn) { const a = this.p.length / 3; fn(); this.nc.push([a, this.p.length / 3]); }
  tri(a, b, c, sw) {
    const t = this.sw(sw);
    for (const v of [a, b, c]) { this.p.push(v[0], v[1], v[2]); this.uv.push(t[0], t[1]); }
  }
  quad(a, b, c, d, sw) { this.tri(a, b, c, sw); this.tri(a, c, d, sw); }
  /** A box centred at c, sizes s, optional Euler rotation; `sw` a swatch or { all, px, nx, py, ny, pz, nz }. */
  box(c, s, sw, rot = null) {
    const h = s.map((v) => v / 2), m = rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)) : null;
    const V = (x, y, z) => { const v = new THREE.Vector3(x * h[0], y * h[1], z * h[2]); if (m) v.applyMatrix4(m); return [v.x + c[0], v.y + c[1], v.z + c[2]]; };
    const f = (k) => (typeof sw === 'string' ? sw : sw[k] ?? sw.all);
    this.quad(V(1, -1, -1), V(1, 1, -1), V(1, 1, 1), V(1, -1, 1), f('px'));
    this.quad(V(-1, -1, 1), V(-1, 1, 1), V(-1, 1, -1), V(-1, -1, -1), f('nx'));
    this.quad(V(-1, 1, -1), V(-1, 1, 1), V(1, 1, 1), V(1, 1, -1), f('py'));
    this.quad(V(-1, -1, 1), V(-1, -1, -1), V(1, -1, -1), V(1, -1, 1), f('ny'));
    this.quad(V(-1, -1, 1), V(1, -1, 1), V(1, 1, 1), V(-1, 1, 1), f('pz'));
    this.quad(V(1, -1, -1), V(-1, -1, -1), V(-1, 1, -1), V(1, 1, -1), f('nz'));
  }
  /** An n-gon prism from a to b (radius r at a, r2 at b); caps when `cap` is a swatch. */
  prism(a, b, r, n, side, cap = null, phase = 0, r2 = r) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), ax = B.clone().sub(A).normalize();
    const u = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(ax).normalize() : new THREE.Vector3(1, 0, 0).cross(ax).normalize(), w = ax.clone().cross(u);
    const ring = (C, rr) => Array.from({ length: n }, (_, i) => { const t = phase + (i / n) * Math.PI * 2; return C.clone().addScaledVector(u, Math.cos(t) * rr).addScaledVector(w, Math.sin(t) * rr).toArray(); });
    const ra = ring(A, r), rb = ring(B, r2);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(ra[i], ra[j], rb[j], rb[i], side); }
    if (cap) for (let i = 1; i < n - 1; i++) { this.tri(ra[0], ra[i + 1], ra[i], cap); this.tri(rb[0], rb[i], rb[i + 1], cap); }
  }
  /** A box from a to b with cross-section w (across, nearest +X) × d: limbs, tubes, struts. */
  limb(a, b, w, d, sw) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), ax = B.clone().sub(A), len = ax.length();
    ax.normalize();
    const side = Math.abs(ax.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const v = ax.clone().cross(side).normalize(), u = v.clone().cross(ax).normalize();
    const c = (s, t, k) => A.clone().addScaledVector(ax, k * len).addScaledVector(u, (s * w) / 2).addScaledVector(v, (t * d) / 2).toArray();
    const p = (s, t) => [c(s, t, 0), c(s, t, 1)];
    const [a00, b00] = p(-1, -1), [a10, b10] = p(1, -1), [a11, b11] = p(1, 1), [a01, b01] = p(-1, 1);
    this.quad(a00, a10, b10, b00, sw); this.quad(a10, a11, b11, b10, sw); this.quad(a11, a01, b01, b11, sw); this.quad(a01, a00, b00, b01, sw);
    this.quad(a00, a01, a11, a10, sw); this.quad(b00, b10, b11, b01, sw);
  }
  /** A low-poly ellipsoid (helmets, heads, tanks, sacks): `seg` around, `rings` from pole to pole; radii r = [x, y, z]. */
  blob(c, r, seg, rings, sw, swTop = sw) {
    const pt = (i, k) => { const ph = (Math.PI * k) / rings, th = (2 * Math.PI * i) / seg; return [c[0] + r[0] * Math.sin(ph) * Math.cos(th), c[1] + r[1] * Math.cos(ph), c[2] + r[2] * Math.sin(ph) * Math.sin(th)]; };
    for (let k = 0; k < rings; k++) for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg, s = k < rings / 2 ? swTop : sw;
      if (k === 0) this.tri(pt(i, 0), pt(j, 1), pt(i, 1), s);
      else if (k === rings - 1) this.tri(pt(i, k), pt(j, k), pt(i, k + 1), s);
      else this.quad(pt(i, k), pt(j, k), pt(j, k + 1), pt(i, k + 1), s);
    }
  }
  get tris() { return this.p.length / 9; }
}

/**
 * A wheel about the x axis at hub (0, R, z): the tyre is an n-gon prism whose flats rest on the ground (inscribed radius
 * R; n must be a multiple of 4 for a flat to face straight down, or the tyre dips below the ground), a hub disc each side and, at LOD0, spokes. W is the tyre width. `look` = { tyre, rim, hub, spokes }.
 */
export function wheel(S, z, R, W, T, look) {
  const n = T.wheelSeg, Rc = R / Math.cos(Math.PI / n), hw = W / 2;
  if (n % 4) throw new Error(`wheelSeg ${n}: a multiple of 4 keeps a flat on the ground`);
  S.prism([-hw, R, z], [hw, R, z], Rc, n, look.tyre, look.tyre, Math.PI / n);
  if (T.rim) {
    for (const s of [1, -1]) S.prism([s * hw, R, z], [s * (hw + 0.01), R, z], R * 0.62, T.rim, look.rim, look.rim, Math.PI / 2);
    S.prism([-hw - 0.03, R, z], [hw + 0.03, R, z], R * 0.16, 6, look.hub, look.hub);
  }
  if (T.spokes) for (let i = 0; i < T.spokes; i++) {
    const a = (i / T.spokes) * Math.PI;
    S.limb([0, R + Math.cos(a) * R * 0.6, z + Math.sin(a) * R * 0.6], [0, R - Math.cos(a) * R * 0.6, z - Math.sin(a) * R * 0.6], W * 1.15, 0.018, look.spokes);
  }
}

/**
 * The rider (a part of the model, R123): joints in vehicle space, the body built as limbs and blobs. `J` = { hip, knee,
 * foot, shoulder, elbow, hand, head } with knee/foot/elbow/hand given for the +X side (mirrored), `look` the swatches
 * { helmet, visor, skin, shirt, vest?, pants, boots, gloves? }, `R` the head (helmet) radius. Counts scale with T.rider.
 */
export function rider(S, J, look, R, T) {
  const m = (p, s) => [s * p[0], p[1], p[2]], seg = T.rider >= 2 ? 8 : 6, rings = T.rider >= 2 ? 5 : 4;
  // torso: hips to shoulders, a vest over the shirt where there is one
  S.limb(J.hip, J.shoulder, 0.36, 0.22, look.vest ?? look.shirt);
  if (look.vest && T.rider >= 2) S.limb([0, J.shoulder[1] - 0.02, J.shoulder[2]], [0, J.shoulder[1] + 0.06, J.shoulder[2] + 0.02], 0.30, 0.18, look.shirt); // collar
  for (const s of [1, -1]) {
    // legs: hip → knee → foot; boots at the foot
    const hip = [s * 0.11, J.hip[1], J.hip[2]], knee = m(J.knee, s), foot = m(J.foot, s);
    S.limb(hip, knee, 0.15, 0.15, look.pants);
    S.limb(knee, [foot[0], foot[1] + 0.1, foot[2]], 0.12, 0.12, look.pants);
    S.box([foot[0], foot[1] + 0.05, foot[2] + 0.04], [0.11, 0.12, 0.22], look.boots);
    // arms: shoulder → elbow → hand
    const sh = [s * 0.2, J.shoulder[1] - 0.04, J.shoulder[2]], el = m(J.elbow, s), ha = m(J.hand, s);
    S.limb(sh, el, 0.1, 0.1, look.shirt);
    S.limb(el, ha, 0.09, 0.09, look.skin);
    if (T.rider >= 2) S.box(ha, [0.08, 0.07, 0.09], look.gloves ?? look.skin);
  }
  // head: neck, helmet, visor
  S.limb([0, J.shoulder[1], J.shoulder[2]], [J.head[0], J.head[1] - R * 0.8, J.head[2]], 0.09, 0.09, look.skin);
  S.blob(J.head, [R * 0.95, R, R * 1.05], seg, rings, look.helmet);
  S.box([J.head[0], J.head[1] - R * 0.1, J.head[2] + R * 0.9], [R * 1.3, R * 0.55, 0.04], look.visor, [0.2, 0, 0]);
}

/**
 * The bike's per-part pivots (hinge lines, plan §6.3 for bikes): wheels at their hubs, the rider at the hip (it pitches
 * off about x, R121), front and back about the top of the edge where they meet the core, core at the origin. Measured on
 * LOD0. `P` carries the hubs (zF/rF, zR/rR) and the rider's joints.
 */
export function bikePivot(id, positions, P) {
  if (id === 'core' || id.startsWith('interior_')) return [0, 0, 0];
  if (id === 'wheel_F') return [0, P.rF, P.zF];
  if (id === 'wheel_R') return [0, P.rR, P.zR];
  if (id === 'rider') return [0, P.rider.hip[1], P.rider.hip[2]];
  let lo = Infinity, hi = -Infinity, ymax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) { lo = Math.min(lo, positions[i + 2]); hi = Math.max(hi, positions[i + 2]); ymax = Math.max(ymax, positions[i + 1]); }
  // front hangs about its rear top edge (where it meets the core), back about its front top edge
  return id === 'front' ? [0, ymax, lo] : [0, ymax, hi];
}

/** Wraps a bike's makeSoups(P, lod) → { soups: { id: Soup } } into the model.js exports the bake and fit page use. */
export function exportsFor(name, makeSoups) {
  const pivots = (P) => {
    const out = {};
    for (const [id, so] of Object.entries(makeSoups(P, 0).soups)) out[id] = bikePivot(id, so.p, P);
    return out;
  };
  const soups = (P, lod = 0) => {
    const raw = makeSoups(P, lod).soups, pv = pivots(P), parts = {};
    for (const [id, so] of Object.entries(raw)) {
      const pivot = pv[id];
      parts[id] = { pivot, positions: so.p.map((v, i) => v - pivot[i % 3]), uvs: so.uv.slice(), tris: so.tris };
      if (so.nc.length) parts[id].noCollide = so.nc;
    }
    return { parts, stations: 0 };
  };
  const build = (P, lod = 0) => {
    const { parts: soup } = soups(P, lod);
    const group = new THREE.Group(); group.name = name; const parts = {}; let tris = 0; const breakdown = {};
    for (const [id, part] of Object.entries(soup)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
      g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g); mesh.name = id; mesh.position.fromArray(part.pivot); mesh.userData.rest = part.pivot.slice(); mesh.castShadow = true;
      group.add(mesh); parts[id] = mesh; tris += part.tris; if (!id.startsWith('interior_')) breakdown[id] = part.tris;
    }
    return { group, parts, stats: { tris, draws: Object.keys(parts).length, breakdown, stations: 0 } };
  };
  return { pivots, soups, build };
}
