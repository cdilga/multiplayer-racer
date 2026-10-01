// kit.js — a primitives-only modelling kit, reverse-engineered from dontdie.wtf/cooked (game.js).
//
// What his shipped bundle shows (see ../REPORT.md for the evidence trail):
//   * No model files. Every object is code: cached unit primitives + spline-lathes + parametric surfaces.
//   * ONE material per "kind" (matte/satin/paint/gloss/metal/chrome/glass/emit), all with vertexColors:true
//     and a white base colour. All colour comes from per-vertex colours.
//   * Colour is *painted by a function of position* (`g(x,y,z,nx,ny,nz,colour,u,v)`), so bands, dirt, AO,
//     rims and emblems cost zero textures.  Fake AO = vertex-colour darkening near bottoms/creases.
//   * A builder (`Je`) collects primitives with a transform stack, bakes colour + transform into each clone,
//     then mergeGeometries() per material kind => an object is 1–4 draw calls.
//   * Geometry is cached by string key (`At`/`An`), materials by kind, so 100 objects share buffers.
//
// Everything here is written from scratch to the same idea (his code is minified/unlicensed; we borrow the
// method, not the source).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export { THREE };
export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const hash = (n) => { const t = Math.sin(n * 127.1 + 311.7) * 43758.5453; return t - Math.floor(t); }; // his `lc`
export const rng = (seed = 1337) => { let i = seed; return () => (i = (i * 16807) % 2147483647) / 2147483647; }; // his `ei`

const _cols = new Map();
export const col = (hex) => { let c = _cols.get(hex); if (!c) { c = new THREE.Color(hex); _cols.set(hex, c); } return c; };
export const shade = (hex, other, t) => '#' + new THREE.Color(hex).lerp(new THREE.Color(other), t).getHexString(); // his `Ur`

// ── geometry cache ──────────────────────────────────────────────────────────────────────────────
// [cooked: At(key, factory) — cache by name; guarantee a `color` attribute so every geo merges]
const _geo = new Map();
export function geo(key, make) {
  let g = _geo.get(key);
  if (!g) {
    g = make();
    if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    _geo.set(key, g);
  }
  return g;
}

// ── materials by kind (all vertex-coloured) ─────────────────────────────────────────────────────
// [cooked: T2(kind) — matte/satin/gloss(Physical+clearcoat)/metal/chrome/paint/emit/glass...]
const KINDS = {
  matte: () => new THREE.MeshStandardMaterial({ roughness: 0.72 }),
  satin: () => new THREE.MeshStandardMaterial({ roughness: 0.46 }),
  paint: () => new THREE.MeshPhysicalMaterial({ roughness: 0.46, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  accent: () => new THREE.MeshPhysicalMaterial({ roughness: 0.46, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
  gloss: () => new THREE.MeshPhysicalMaterial({ roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  rubber: () => new THREE.MeshStandardMaterial({ roughness: 0.92 }),
  metal: () => new THREE.MeshStandardMaterial({ roughness: 0.36, metalness: 0.75 }),
  chrome: () => new THREE.MeshStandardMaterial({ roughness: 0.14, metalness: 1.0 }),
  glass: () => new THREE.MeshPhysicalMaterial({ roughness: 0.08, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 }),
  emit: () => new THREE.MeshBasicMaterial({ toneMapped: true }),
  // semantic emissives (contract §materials): separate kinds so each exports as its own jj_* material with an emissiveFactor
  headlight: () => new THREE.MeshBasicMaterial({ toneMapped: true }),
  brakelight: () => new THREE.MeshBasicMaterial({ toneMapped: true }),
  indicator: () => new THREE.MeshBasicMaterial({ toneMapped: true }),
  alloy: () => new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.9 }),      // wheel hardware (contract semantic: wheel)
};
const _mats = new Map();
export function material(kind) {
  let m = _mats.get(kind);
  if (!m) {
    if (!KINDS[kind]) throw new Error('unknown material kind ' + kind);
    m = KINDS[kind]();
    m.vertexColors = true; m.color.set(0xffffff); m.name = kind;
    if (!['emit', 'headlight', 'brakelight', 'indicator'].includes(kind)) installRim(m, 0.35, '#ffe9cc');
    _mats.set(kind, m);
  }
  return m;
}
/** Per-instance tint of a kind (identity paint): clone once, keep vertex colours as relative shading. */
export function tintedMaterial(kind, hex, finish = {}) {
  const m = material(kind).clone(); m.color.set(hex); m.name = kind + ':' + hex;
  if (finish.metalness != null) m.metalness = finish.metalness; if (finish.roughness != null) m.roughness = finish.roughness;
  if (finish.clearcoat != null) m.clearcoat = finish.clearcoat;
  installRim(m, 0.35, '#ffe9cc');
  return m;
}
/** Variant of a kind with an image (canvas) map. [cooked: In(name, texFactory, kind)] */
const _texMats = new Map();
export function texturedMaterial(name, kind, makeTexture, extra = {}) {
  let m = _texMats.get(name);
  if (!m) { m = material(kind).clone(); m.map = makeTexture(); Object.assign(m, extra); m.name = name; installRim(m, 0.2, '#ffe9cc'); _texMats.set(name, m); }
  return m;
}
export function canvasTexture(w, h, draw, { repeat, aniso = 4 } = {}) { // [cooked: Ji]
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

/** Fresnel rim light injected with onBeforeCompile — the "toy pop". [cooked: vR() "chefrim1"] */
export function installRim(mat, strength = 0.35, colour = '#ffe9cc') {
  mat.userData.rim = { value: strength }; mat.userData.rimCol = { value: new THREE.Color(colour) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = mat.userData.rim; sh.uniforms.uRimCol = mat.userData.rimCol;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;\nuniform vec3 uRimCol;')
      .replace('#include <opaque_fragment>',
        `float rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.2);
         outgoingLight += uRimCol * (rimF * uRim) * (0.35 + 0.65 * dot(diffuseColor.rgb, vec3(0.333)));
         #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'jjrim1';
}

// ── cached primitive factories ──────────────────────────────────────────────────────────────────
// [cooked: mR/jn/A_ unit spheres at 3 detail levels, gR cone, Os half-sphere, yR capsule, ee/Ze rounded box]
export const P = {
  sphere: (seg = 14) => geo(`sph${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(5, Math.round(seg * 0.7)))),
  cyl: (rt, rb, h, seg = 16) => geo(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1)),
  cone: (seg = 14) => geo(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg).translate(0, 0.5, 0)),
  capsule: (r, len, seg = 8) => geo(`cap${r},${len},${seg}`, () => new THREE.CapsuleGeometry(r, len, seg, seg * 2)),
  torus: (R, r, seg = 24, tube = 8, arc = TAU) => geo(`tor${R},${r},${seg},${tube},${arc}`, () => new THREE.TorusGeometry(R, r, tube, seg, arc)),
  flat: (w, h, d) => geo(`flat${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  ico: (r, d = 1) => geo(`ico${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  // rounded box, radius clamped so it is always valid  [cooked: Ze/ee]
  box: (w, h, d, r = 0.05, seg) => {
    const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    const s = seg ?? (rr >= 0.04 ? 3 : rr >= 0.02 ? 2 : 1);
    return geo(`box${w},${h},${d},${rr},${s}`, () => new RoundedBoxGeometry(w, h, d, s, rr));
  },
};

/** Spline-profile lathe: (x=radius, y=height) control points, Catmull-Rom smoothed, revolved. [cooked: Vn/Qn] */
export function lathe(points, seg = 28, smooth = 0, key) {
  const k = key ?? 'lathe' + JSON.stringify(points) + seg + ',' + smooth;
  return geo(k, () => {
    let pts = points.map(([x, y]) => new THREE.Vector2(x, y));
    if (smooth) pts = new THREE.SplineCurve(pts).getPoints(smooth);
    return new THREE.LatheGeometry(pts, seg);
  });
}
/** Bevelled extrusion of a 2D shape, centred. [cooked: Ca(name, shape, depth, bevel)] */
export function extrude(key, shape, depth = 0.05, bevel = 0.02, curveSeg = 12) {
  return geo(key, () => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: curveSeg });
    g.center(); return g;
  });
}
/** Tube along a Catmull-Rom path with round end caps. [cooked: zr] */
export function tube(key, pts, r = 0.03, segs = 32, radial = 8, caps = true, closed = false) {
  return geo(key, () => {
    const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed);
    const parts = [strip(new THREE.TubeGeometry(c, segs, r, radial, closed))];
    if (caps && !closed) for (const p of [pts[0], pts[pts.length - 1]]) parts.push(strip(new THREE.SphereGeometry(r, Math.max(4, radial), 3).translate(...p)));
    return mergeGeometries(parts, false);
  });
}
export const roundedRect = (w, h, r) => { // centred Shape
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
};
/** Polygon with rounded corners (points ccw). */
export function roundedPoly(pts, r) {
  const n = pts.length, s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    const ab = new THREE.Vector2(a[0] - b[0], a[1] - b[1]), cb = new THREE.Vector2(c[0] - b[0], c[1] - b[1]);
    const rr = Math.min(r, ab.length() * 0.45, cb.length() * 0.45);
    const p0 = b.slice(), p1 = b.slice();
    ab.normalize().multiplyScalar(rr); cb.normalize().multiplyScalar(rr);
    p0[0] += ab.x; p0[1] += ab.y; p1[0] += cb.x; p1[1] += cb.y;
    if (i === 0) s.moveTo(p0[0], p0[1]); else s.lineTo(p0[0], p0[1]);
    s.quadraticCurveTo(b[0], b[1], p1[0], p1[1]);
  }
  s.closePath(); return s;
}

// ── parametric surface with finite-difference normals ───────────────────────────────────────────
// [cooked: R_(name, nu, nv, fn) — the workhorse for organic bodies: fn(u,v,out)->xyz; normals by central
//  differences; winding auto-flipped by sampling triangles against the normals]
export function surfaceGrid(nu, nv, fn, { solid = 0, inside, reverse = false, normal } = {}) {
  let cx = 0, cy = 0, cz = 0; // default interior reference: centroid of the sampled grid
  const defaultInside = (u, v, out) => { out[0] = cx; out[1] = cy; out[2] = cz; };
  const N = (nu + 1) * (nv + 1);
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), uvs = new Float32Array(N * 2);
  const o = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0];
  const e = 0.004;
  let m = 0;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    for (let i = 0; i <= nu; i++, m++) {
      const u = i / nu;
      fn(u, v, o); pos.set(o, m * 3); uvs[m * 2] = u; uvs[m * 2 + 1] = v;
      if (normal) { normal(u, v, o, a); nor.set(a, m * 3); continue; }        // analytic normal supplied (e.g. gradient of an implicit surface)
      const uc = clamp(u, e * 2, 1 - e * 2), vc = clamp(v, e * 2, 1 - e * 2);
      fn(uc + e, vc, a); fn(uc - e, vc, b); fn(uc, vc + e, c); fn(uc, vc - e, d);
      const tu = new THREE.Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]), tv = new THREE.Vector3(c[0] - d[0], c[1] - d[1], c[2] - d[2]);
      const n = new THREE.Vector3().crossVectors(tv, tu).normalize(); // sign fixed below
      nor.set([n.x, n.y, n.z], m * 3);
    }
  }
  for (let i = 0; i < N; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
  cx /= N; cy /= N; cz /= N;
  const idx = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const p = j * (nu + 1) + i, q = p + 1, r = p + nu + 1, s = r + 1;
    idx.push(p, q, s, p, s, r);
  }
  // orientation: normals must point away from an interior reference point (`inside(u,v)->[x,y,z]`); winding follows.
  let away = 0, cnt = 0;
  const rp = [0, 0, 0];
  for (let m2 = 0; m2 < N; m2 += Math.max(1, Math.floor(N / 80))) {
    const u = (m2 % (nu + 1)) / nu, v = Math.floor(m2 / (nu + 1)) / nv;
    (inside || defaultInside)(u, v, rp);
    const dx = pos[m2 * 3] - rp[0], dy = pos[m2 * 3 + 1] - rp[1], dz = pos[m2 * 3 + 2] - rp[2];
    cnt++; if (dx * nor[m2 * 3] + dy * nor[m2 * 3 + 1] + dz * nor[m2 * 3 + 2] > 0) away++;
  }
  if ((away < cnt / 2) !== reverse) for (let t = 0; t < nor.length; t++) nor[t] = -nor[t];
  let bad = 0, tot = 0;
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), fn3 = new THREE.Vector3(), an = new THREE.Vector3();
  const step = 3 * Math.max(1, Math.floor(idx.length / 3 / 60));
  for (let t = 0; t < idx.length; t += step) {
    pa.fromArray(pos, idx[t] * 3); pb.fromArray(pos, idx[t + 1] * 3); pc.fromArray(pos, idx[t + 2] * 3);
    fn3.crossVectors(pb.sub(pa), pc.sub(pa)); if (fn3.lengthSq() < 1e-14) continue;
    an.fromArray(nor, idx[t] * 3); tot++; if (fn3.dot(an) < 0) bad++;
  }
  if (bad > tot / 2) for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.userData.grid = { nu, nv };
  return solid ? solidify(g, solid) : g;
}

/** Give a single-sided grid a thickness with a HALF-RESOLUTION liner and no skirts (cheap: ~1.25× the skin instead of ~2.3×).
 *  The liner is a decimated copy of the skin pushed inward by `thick`, easing to zero at the border so it closes against the skin.
 *  Adds a `region` attribute (0 skin, 1 liner) so paint functions can colour the underside differently. */
export function solidify(g, thick, div = 2) {
  const { nu, nv } = g.userData.grid;
  const P0 = g.attributes.position.array, N0 = g.attributes.normal.array, U0 = g.attributes.uv.array, n = P0.length / 3;
  const idxList = (m) => { const a = []; for (let i = 0; i < m; i += div) a.push(i); a.push(m); return a; };
  const iu = idxList(nu), iv = idxList(nv), pos = Array.from(P0), nor = Array.from(N0), uv = Array.from(U0), reg = new Array(n).fill(0), idx = Array.from(g.index.array);
  const base = n;
  for (let jj = 0; jj < iv.length; jj++) for (let ii = 0; ii < iu.length; ii++) {
    const o = iv[jj] * (nu + 1) + iu[ii], edge = Math.min(ii, iu.length - 1 - ii, jj, iv.length - 1 - jj), r = Math.min(1, edge), t = thick * r * r * (3 - 2 * r);
    pos.push(P0[o * 3] - N0[o * 3] * t, P0[o * 3 + 1] - N0[o * 3 + 1] * t, P0[o * 3 + 2] - N0[o * 3 + 2] * t);
    nor.push(-N0[o * 3], -N0[o * 3 + 1], -N0[o * 3 + 2]); uv.push(U0[o * 2], U0[o * 2 + 1]); reg.push(1);
  }
  const W = iu.length;
  for (let jj = 0; jj < iv.length - 1; jj++) for (let ii = 0; ii < W - 1; ii++) {
    const p = base + jj * W + ii, q = p + 1, r = p + W, s = r + 1;
    idx.push(p, s, q, p, r, s);                                   // reversed winding: the liner faces inward
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.setAttribute('region', new THREE.Float32BufferAttribute(reg, 1)); out.setIndex(idx);
  out.userData.grid = { nu, nv, solid: true };
  return out;
}

// ── vertex-colour AO helpers ───────────────────────────────────────────────────────────────────
/** Darken toward the bottom of a geometry [cooked: rr(geo, min) "aoBottom"]. */
export function aoBottom(g, min = 0.7, span = 0.62) {
  g.computeBoundingBox();
  const { min: lo, max: hi } = g.boundingBox, p = g.attributes.position, c = new Float32Array(p.count * 3), h = Math.max(1e-5, hi.y - lo.y);
  for (let i = 0; i < p.count; i++) { const t = clamp((p.getY(i) - lo.y) / h), l = min + (1 - min) * sstep(0, span, t); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = l; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
}

function prepared(src) { // strip to position/normal/uv, ensure index
  const g = src.clone();
  const keep = new Set(['position', 'normal', 'uv']);
  const region = g.attributes.region;
  for (const k of Object.keys(g.attributes)) if (!keep.has(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.index) { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
  return { g, region };
}
const strip = (g) => { // keep only position/normal/uv/index (drop everything else), non-indexed -> indexed
  const out = g.index ? g.clone() : g.clone();
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  if (!out.index) { const n = out.attributes.position.count, ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; out.setIndex(new THREE.BufferAttribute(ix, 1)); }
  return out;
};

// ── the builder ────────────────────────────────────────────────────────────────────────────────
// [cooked: class Je — buckets Map(materialKey → {mat, list[]}), transform stack push/pop, add(geo, kind, {p,r,s,q,c,g,order}),
//  box(), build(name) => Group with one Mesh per bucket, mergeGeometries per bucket]
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
function compose(o, out) {
  _v.set(0, 0, 0); if (o.p) _v.set(o.p[0], o.p[1], o.p[2]);
  if (o.q) _q.copy(o.q); else { _e.set(0, 0, 0, o.ro || 'XYZ'); if (o.r) _e.set(o.r[0], o.r[1], o.r[2], o.ro || 'XYZ'); _q.setFromEuler(_e); }
  if (o.s == null) _s.set(1, 1, 1); else if (typeof o.s === 'number') _s.set(o.s, o.s, o.s); else _s.set(o.s[0], o.s[1], o.s[2]);
  return out.compose(_v, _q, _s);
}
export class KitBuilder {
  constructor() { this.buckets = new Map(); this.top = new THREE.Matrix4(); this.stack = []; }
  push(t = {}) { this.stack.push(this.top); this.top = new THREE.Matrix4().multiplyMatrices(this.top, compose(t, _m)); return this; }
  pop() { this.top = this.stack.pop(); return this; }
  /** @param o {p,r,s,q,ro, c:'#hex' flat colour, g:paint fn, space:'local'|'world', order, tag} */
  add(g, kind, o = {}) {
    const { g: s, region } = prepared(g);
    const n = s.attributes.position.count, colors = new Float32Array(n * 3);
    const base = col(o.c ?? '#ffffff');
    const xf = new THREE.Matrix4().multiplyMatrices(this.top, compose(o, new THREE.Matrix4()));
    const worldPaint = o.space === 'world';
    if (worldPaint) s.applyMatrix4(xf);
    const P = s.attributes.position, N = s.attributes.normal, U = s.attributes.uv;
    for (let i = 0; i < n; i++) {
      _c.copy(base);
      if (o.g) o.g(P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), _c, U.getX(i), U.getY(i), region ? region.getX(i) : 0);
      colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
    }
    s.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!worldPaint) s.applyMatrix4(xf);
    if (o.uvRect) { const uvA = s.attributes.uv, [u0, v0, u1, v1] = o.uvRect; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, u0 + uvA.getX(i) * (u1 - u0), v0 + uvA.getY(i) * (v1 - v0)); }   // sub-rect of a shared trim atlas
    const key = typeof kind === 'string' ? kind : kind.uuid;
    let b = this.buckets.get(key);
    if (!b) { b = { mat: typeof kind === 'string' ? material(kind) : kind, kind: typeof kind === 'string' ? kind : kind.name, list: [], order: o.order || 0 }; this.buckets.set(key, b); }
    b.list.push(s); return this;
  }
  box(w, h, d, r, kind, o = {}) { return this.add(P.box(w, h, d, r, o.seg), kind, o); }
  /** Merge per material bucket into a Group. `pivot` re-centres geometry so the group can hinge/detach about it.
   *  `materials` overrides kinds (identity paint). `dentable` = kinds whose meshes take CPU dents. */
  build(name = 'kit', { pivot, materials = {}, dentable = ['paint', 'accent'] } = {}) {
    const grp = new THREE.Group(); grp.name = name; let tris = 0;
    for (const [, b] of this.buckets) {
      const list = b.list;
      if (pivot) for (const g of list) g.translate(-pivot[0], -pivot[1], -pivot[2]);
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      merged.computeBoundingSphere(); merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, materials[b.kind] || b.mat);
      mesh.name = `${name}:${b.kind}`; mesh.castShadow = b.kind !== 'glass'; mesh.receiveShadow = true;
      mesh.userData.kind = b.kind; mesh.userData.dentable = dentable.includes(b.kind);
      if (b.order) mesh.renderOrder = b.order;
      tris += merged.index.count / 3; grp.add(mesh);
    }
    if (pivot) grp.position.set(...pivot);
    grp.userData.tris = tris; return grp;
  }
}

export const countTris = (root) => { // counts only what would actually be drawn (respects hidden parents)
  let t = 0, d = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isInk) return; let p = o; while (p) { if (!p.visible) return; p = p.parent; }
    d++; t += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  });
  return { tris: t | 0, draws: d };
};
