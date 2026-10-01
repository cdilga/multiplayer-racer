// loft.js — an analytic "bean body": superellipse cross-sections swept along a station table.
//
// This is the part of the method his bundle does with `R_/Qn` (parametric surface + finite-difference normals)
// but for non-round bodies. One analytic surface S(u,v) gives us:
//   * the tub / greenhouse meshes  (grid over the whole surface)
//   * panels cut from the SAME surface (doors, bonnet, boot, bumpers) so seams line up exactly
//   * decals/details placed by probing the surface with a ray (headlights, grille, arch cladding...)
// Because the surface is analytic, LOD = number of grid samples. No decimation, no re-authoring.

import { THREE, clamp, lerp, TAU, surfaceGrid } from './kit.js';

// monotone cubic (PCHIP) so station tables never overshoot
function pchip(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (x) => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const sgnpow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

export class Loft {
  /** stations: [{z, w, yb, yt, pT, pB, tumble}] (half-width, bottom y, top y, top/bottom exponent, top narrowing)
   *  caps: {min, max} lengths over which the section shrinks to a rounded nose; bulges: [{z, sigma, dw}] extra width */
  constructor({ stations, caps = { min: 0, max: 0 }, capPow = 2.4, bulges = [], clip }) {
    stations = [...stations].sort((a, b) => a.z - b.z);   // spline needs ascending z
    this.st = stations; this.caps = caps; this.capPow = capPow; this.bulges = bulges;
    this.zMin = stations[0].z; this.zMax = stations[stations.length - 1].z;
    const zs = stations.map((s) => s.z);
    this.f = {}; for (const k of ['w', 'yb', 'yt', 'pT', 'pB', 'tumble']) this.f[k] = pchip(zs, stations.map((s) => s[k]));
    this.clip = clip;
  }
  endScale(z) {
    let s = 1; const { min, max } = this.caps, p = this.capPow;
    if (min > 0 && z < this.zMin + min) { const t = 1 - (z - this.zMin) / min; s = Math.pow(Math.max(0, 1 - Math.pow(clamp(t), p)), 1 / p); }
    if (max > 0 && z > this.zMax - max) { const t = 1 - (this.zMax - z) / max; s = Math.min(s, Math.pow(Math.max(0, 1 - Math.pow(clamp(t), p)), 1 / p)); }
    return s;
  }
  params(z) {
    if (z === this._lz) return this._lp;
    let w = this.f.w(z), dyt = 0; for (const b of this.bulges) { const e = Math.exp(-(((z - b.z) / b.sigma) ** 2)); w += b.dw * e; dyt += (b.dyt || 0) * e; }
    const yb = this.f.yb(z), yt = this.f.yt(z) + dyt, s = this.endScale(z);
    this._lz = z; return (this._lp = { w: w * s, hh: ((yt - yb) / 2) * s, yc: (yt + yb) / 2, pT: this.f.pT(z), pB: this.f.pB(z), tumble: this.f.tumble(z), s });
  }
  zOfV(v) { const e = 0.5 - 0.5 * Math.cos(Math.PI * v); return this.zMin + (this.zMax - this.zMin) * lerp(v, e, 0.55); }
  vOfZ(z) { let a = 0, b = 1; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (this.zOfV(m) < z) a = m; else b = m; } return (a + b) / 2; }
  /** u: 0 bottom-centre → 0.25 right flank → 0.5 top-centre → 0.75 left flank → 1 bottom-centre */
  section(z, u, out = new THREE.Vector3()) {
    const P = this.params(z), phi = u * TAU - Math.PI / 2, c = Math.cos(phi), sn = Math.sin(phi);
    const p = sn > 0 ? P.pT : P.pB, ny = sgnpow(sn, 2 / p), nx = sgnpow(c, 2 / p);
    const f = 1 - P.tumble * Math.pow(Math.max(0, ny), 1.5);
    return out.set(P.w * nx * f, P.yc + P.hh * ny, z);
  }
  point(u, v, out) { const p = this.section(this.zOfV(v), u, _t); out[0] = p.x; out[1] = p.y; out[2] = p.z; return out; }
  /** implicit: <0 inside, 0 on surface */
  F(x, y, z) {
    if (z < this.zMin || z > this.zMax) return 1;
    const P = this.params(z); if (P.w < 1e-4 || P.hh < 1e-4) return 1;
    const ny = (y - P.yc) / P.hh, p = ny > 0 ? P.pT : P.pB, f = 1 - P.tumble * Math.pow(Math.max(0, ny), 1.5);
    const nx = x / (P.w * f);
    return Math.pow(Math.abs(nx), p) + Math.pow(Math.abs(ny), p) - 1;
  }
  normalAt(x, y, z, out = new THREE.Vector3()) {
    const e = 1e-3;
    out.set(this.F(x + e, y, z) - this.F(x - e, y, z), this.F(x, y + e, z) - this.F(x, y - e, z), this.F(x, y, z + e) - this.F(x, y, z - e));
    return out.lengthSq() < 1e-16 ? out.set(0, 1, 0) : out.normalize();
  }
  /** first surface hit along origin + t*dir (origin outside). Returns {p, n} or null. */
  probe(ox, oy, oz, dx, dy, dz, tMax = 8) {
    const step = 0.04; let prev = 0, hit = -1;
    for (let t = 0; t <= tMax; t += step) {
      if (this.F(ox + dx * t, oy + dy * t, oz + dz * t) < 0) { hit = t; break; } prev = t;
    }
    if (hit < 0) return null;
    let a = prev, b = hit;
    for (let i = 0; i < 34; i++) { const m = (a + b) / 2; if (this.F(ox + dx * m, oy + dy * m, oz + dz * m) < 0) b = m; else a = m; }
    const t = (a + b) / 2, p = new THREE.Vector3(ox + dx * t, oy + dy * t, oz + dz * t);
    return { p, n: this.normalAt(p.x, p.y, p.z, new THREE.Vector3()) };
  }
  // direction-specific probes; each falls back to the nearest reachable point if the ray misses.
  side(z, y, sgn = 1) {
    let h = this.probe(sgn * 4, y, z, -sgn, 0, 0);
    if (!h) { const P = this.params(clamp(z, this.zMin + 0.02, this.zMax - 0.02)); h = this.probe(sgn * 4, clamp(y, P.yc - P.hh * 0.95, P.yc + P.hh * 0.95), clamp(z, this.zMin + 0.02, this.zMax - 0.02), -sgn, 0, 0); }
    return h;
  }
  top(x, z) { return this.probe(x, 6, z, 0, -1, 0) ?? this.probe(clamp(x, -0.3, 0.3), 6, z, 0, -1, 0); }
  front(x, y) { return this.probe(x, y, this.zMax + 2, 0, 0, -1) ?? this.probe(x * 0.5, y, this.zMax + 2, 0, 0, -1); }
  rear(x, y) { return this.probe(x, y, this.zMin - 2, 0, 0, 1) ?? this.probe(x * 0.5, y, this.zMin - 2, 0, 0, 1); }
  axis(z) { const P = this.params(clamp(z, this.zMin, this.zMax)); return [0, P.yc, z]; }

  // ── geometry ────────────────────────────────────────────────────────────────────────────────
  /** parameter-space patch of the surface, optionally pushed out along the normal and given thickness */
  patch({ u0 = 0, u1 = 1, v0 = 0, v1 = 1, nu = 32, nv = 32, off = 0, solid = 0, mirrorU = false }) {
    const tmp = [0, 0, 0], n = new THREE.Vector3();
    return surfaceGrid(nu, nv, (a, b, out) => {
      const u = lerp(u0, u1, a), v = lerp(v0, v1, b);
      this.point(mirrorU ? 1 - u : u, v, out);
      if (off) { this.normalAt(out[0], out[1], out[2], n); out[0] += n.x * off; out[1] += n.y * off; out[2] += n.z * off; }
    }, { solid, inside: (u, v, o) => { const z = this.zOfV(lerp(v0, v1, v)); const ax = this.axis(z); o[0] = ax[0]; o[1] = ax[1]; o[2] = ax[2]; } });
  }
  /** patch defined by a mapping (a,b)∈[0,1]² → a probe hit (side/top/front/rear), pushed out `off`, optional thickness */
  probed(nu, nv, map, { off = 0, solid = 0, axisZ } = {}) {
    return surfaceGrid(nu, nv, (a, b, out) => {
      const h = map(a, b); if (!h) { out[0] = out[1] = out[2] = 0; return; }
      const o = typeof off === 'function' ? off(a, b) : off;
      out[0] = h.p.x + h.n.x * o; out[1] = h.p.y + h.n.y * o; out[2] = h.p.z + h.n.z * o;
    }, { solid, inside: (a, b, o) => { const h = map(a, b); const ax = this.axis(h ? h.p.z : 0); o[0] = ax[0]; o[1] = ax[1]; o[2] = ax[2]; } });
  }
}
const _t = new THREE.Vector3();

/** bilinear interpolation of 4 (s,t) corners: order (a=0,b=0) (a=1,b=0) (a=1,b=1) (a=0,b=1) */
export function quad(c, a, b) {
  const x0 = lerp(c[0][0], c[1][0], a), x1 = lerp(c[3][0], c[2][0], a);
  const y0 = lerp(c[0][1], c[1][1], a), y1 = lerp(c[3][1], c[2][1], a);
  return [lerp(x0, x1, b), lerp(y0, y1, b)];
}

// ── smooth union of two lofts ───────────────────────────────────────────────────────────────────────
// The body is a lower shell plus a greenhouse. Meshing them separately leaves a hard concave crease at the belt line
// (the "pinch"). A smooth-min of the two implicit functions fills that crease with a fillet, and everything that
// touches the side of the car (chassis mesh, door skins, glass, bonnet, boot) is cut from THIS surface.
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export class LoftUnion {
  constructor(base, top, k = 0.6, topRange = 0.25) { this.a = base; this.b = top; this.k = k; this.zMin = base.zMin; this.zMax = base.zMax; this.topRange = topRange; }
  F(x, y, z) { return smin(this.a.F(x, y, z), this.b.F(x, y, z), this.k); }
  params(z) { return this.a.params(clamp(z, this.a.zMin, this.a.zMax)); }              // only used for probe fallbacks
  /** a point on the axis that is inside BOTH lofts wherever the greenhouse exists (keeps the union star-shaped) */
  originY(z) {
    const zb0 = this.b.zMin, zb1 = this.b.zMax, r = this.topRange, ss = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
    const w = ss((z - zb0) / r) * (1 - ss((z - (zb1 - r)) / r)), tub = this.a.params(clamp(z, this.a.zMin + 1e-3, this.a.zMax - 1e-3));
    return lerp(tub.yc, 0.96, w);
  }
  axis(z) { return [0, this.originY(z), z]; }
  /** whole-body mesh: rays from the axis, so it has no seams and no crease at the belt */
  radial({ nu = 56, nv = 84, inset = 0, flank = 0.6 } = {}) {
    const n = new THREE.Vector3();
    // ray density: the belt fillet and shoulders are seen almost edge-on from the axis, so bunch the rays up around the flanks
    const angle = (u) => u * TAU + flank * 0.5 * Math.sin(2 * TAU * u) / 2;
    const march = (u, v, out) => {
      const z = clamp(this.a.zOfV(v), this.zMin + 1e-3, this.zMax - 1e-3), y0 = this.originY(z), th = angle(u), dx = Math.sin(th), dy = -Math.cos(th);
      if (this.F(0, y0, z) >= 0) { out[0] = 0; out[1] = y0; out[2] = z; return; }         // degenerate tip
      let prev = 0, hit = -1; for (let t = 0.03; t < 2.6; t += 0.03) { if (this.F(dx * t, y0 + dy * t, z) > 0) { hit = t; break; } prev = t; }
      if (hit < 0) { out[0] = 0; out[1] = y0; out[2] = z; return; }
      let a = prev, b = hit; for (let i = 0; i < 26; i++) { const m = (a + b) / 2; if (this.F(dx * m, y0 + dy * m, z) > 0) b = m; else a = m; }
      const t = (a + b) / 2; out[0] = dx * t; out[1] = y0 + dy * t; out[2] = z;
      if (inset) { this.normalAt(out[0], out[1], out[2], n); out[0] -= n.x * inset; out[1] -= n.y * inset; out[2] -= n.z * inset; }
    };
    return surfaceGrid(nu, nv, march, {
      inside: (u, v, o) => { const z = clamp(this.a.zOfV(v), this.zMin + 1e-3, this.zMax - 1e-3); o[0] = 0; o[1] = this.originY(z); o[2] = z; },
      normal: (u, v, p, out) => { this.normalAt(p[0], p[1], p[2], n); out[0] = n.x; out[1] = n.y; out[2] = n.z; },
    });
  }
}
for (const m of ['normalAt', 'probe', 'side', 'top', 'front', 'rear', 'probed']) LoftUnion.prototype[m] = Loft.prototype[m];

// ── boundary-curve patches ─────────────────────────────────────────────────────────────────────────────────
// Panels and glass are defined by their four EDGES (polylines), not by a warped rectangle: straight edges stay straight and the
// outline is exactly the measured reference polygon. `line(p,q)` / `polyline(pts)` return t∈[0,1] → [s,t] curves.
export const line = (p, q) => (t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
export const polyline = (pts) => (t) => {
  const n = pts.length - 1, f = clamp(t) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  return [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u)];
};
/** Coons patch: bottom(a), top(a), left(b), right(b) → (a,b) ↦ [s,t]. Corners must agree (bottom(0)=left(0) …). */
export function coons(bottom, top, left, right) {
  const P00 = bottom(0), P10 = bottom(1), P01 = top(0), P11 = top(1);
  return (a, b) => {
    const B = bottom(a), T = top(a), Lf = left(b), R = right(b), o = [0, 0];
    for (let k = 0; k < 2; k++) o[k] = (1 - b) * B[k] + b * T[k] + (1 - a) * Lf[k] + a * R[k] - ((1 - a) * (1 - b) * P00[k] + a * (1 - b) * P10[k] + (1 - a) * b * P01[k] + a * b * P11[k]);
    return o;
  };
}
/** unit square → unit square with softened corners (r≈0.2–0.6); edges stay straight, only the corners are cut */
export const softCorners = (a, b, r) => { const s = 2 * a - 1, t = 2 * b - 1; return [(s * Math.sqrt(1 - (r * t * t) / 2) + 1) / 2, (t * Math.sqrt(1 - (r * s * s) / 2) + 1) / 2]; };
