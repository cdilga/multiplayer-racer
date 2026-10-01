// cruze.js (v3, recognition-first) — a Cruze-flavoured toy sedan built ONLY from kit primitives (no GLB, no Blender).
//
// Design rule: the features people use to recognise a Cruze are copied from the reference (recog/spec.js) and only scaled.
// Cuteness comes from proportion (bigger wheels, shorter wheelbase, softer volumes), not from redesigning shapes.
//
// Kit-space: metres, +Z forward, +Y up, origin on the ground midway between the axles. NOTE handedness: facing +Z, kit +X is the
// car's LEFT. Part IDs follow the asset contract (spikes/art-pipeline/G-cruze-v2/ASSET-CONTRACT.md); the bake step rotates the
// asset half a turn about Y to the contract's −Z-forward space, so kit +X (left) ends up at glTF −X (left).
import { THREE, KitBuilder, P, lathe, tube, col, clamp, lerp, sstep, hash, TAU, tintedMaterial, texturedMaterial, canvasTexture, countTris } from './kit/kit.js';
import { Loft, LoftUnion, quad, line, polyline, coons, softCorners } from './kit/loft.js';
import { TOY, polyY } from './recog/spec.js';

export const DIM = { wheelR: 0.41, tyreW: 0.30, wheelX: 0.82, wheelZ: 1.15, wheelY: 0.41, archR: 0.49, zFront: 1.88, zRear: -2.02, susp: { rest: 0.5, travel: [-0.1, 0.12] } };
export const MASS_KG = 1200;
export const GOLD = { paint: '#e0a520', finish: { metalness: 0.55, roughness: 0.3 } };

// LOD is a *parameter of every primitive* (not a decimation pass): body/panel grid resolution, tube/lathe/sphere segments,
// rounded-box subdivision and which optional details exist at all come from this table.  [cooked: sph/sphm/spht unit spheres]
// Tiers follow the contract: 0 hero · 1 baseline close gameplay · 2 medium · 3 distant.  Every tier keeps the SAME parts, pivots and
// recognition features; what changes is how finely each is tessellated and which sub-millimetre trim is dropped (see REPORT.md §opt).
export const LODS = [
  { id: 'L0', role: 'hero', k: 0.6, min: 3, poff: 0.012, body: [44, 34], liner: 'all', tube: [20, 5], ring: 20, sph: 10, cyl: 20, box: 1, tyre: { seg: 22, prof: 'smooth' }, rim: 'full', nuts: true, brake: true, rings: 'all', arch: 'tube', skirts: true, wells: 0.6, eyes: 'full', susp: 'coil', badge: true },
  { id: 'L1', role: 'gameplay', k: 0.3, min: 3, poff: 0.016, body: [22, 18], liner: 'panels', tube: [8, 3], ring: 12, sph: 8, cyl: 10, box: 0, tyre: { seg: 12, prof: 'light' }, rim: 'flat', nuts: false, brake: false, rings: 'grille', arch: 'tube', skirts: false, wells: 0.35, eyes: 'disc', susp: 'strut', badge: true },
  { id: 'L2', role: 'medium', k: 0.16, min: 3, poff: 0.028, body: [14, 10], liner: false, tube: [4, 3], ring: 8, sph: 6, cyl: 8, box: 0, tyre: { seg: 12, prof: 'ring' }, rim: 'disc', nuts: false, brake: false, rings: false, arch: 'tube', skirts: false, wells: 0, eyes: 'dot', susp: 'none', badge: false },
  { id: 'L3', role: 'distant', k: 0.08, min: 2, poff: 0.04, body: [9, 7], liner: false, tube: [4, 3], ring: 6, sph: 5, cyl: 6, box: 0, tyre: { seg: 8, prof: 'ring' }, rim: 'disc', nuts: false, brake: false, rings: false, arch: false, skirts: false, wells: 0, eyes: 'dot', susp: 'none', badge: false },
];
let L = LODS[0];
// Recognition experiments (round 4): opt-in cue sets, OFF by default so the shipped asset, its gates and the
// existing renders do not move until an idea is accepted. Read from real photos (refs/photos) rather than the Codex orthos.
//   tail   round chrome-ringed bulls-eye tail lamps + chrome boot strip      grille  bold chrome-framed front, roundel bar, round fog pods
//   glass  black pillars / window surrounds + darker glass                   hood    visible bonnet crease lines converging on the grille
//   shape  round 5: rear greenhouse + haunch as ONE convex form (no cabin neck / shelf); tunables via build({ shape: { wr, k, pt } }) or ?sh=wr:0.06;k:0.9
//   lightbar  small white LED bar on a black plate-bracket over a front plate      uhf  tall UHF whip aerial on the front bracket
//             (both are on the owner's car in the film photos: 1496626-R1-*.JPG in the reference zip)
//   mirror mirror housing on a dark sail at the A-pillar base, glass facing rearward   (tried + dropped: 'line' - the oversized arches leave no room for a character line)
const RC_ALL = ['tail', 'grille', 'glass', 'hood', 'mirror', 'lightbar', 'uhf', 'shape'];
let RC = new Set();
let SH = null;   // active shape overrides (null = the shipped shape)
// rear greenhouse target cross-section (blended in from mid-cabin to the C-pillar): starts at the belt at the tub's width and tumbles home smoothly
const SHAPE_DEFAULT = { a: 1, k: 0.8, w: 0.84, yb: 0.72, tb: 0.2, pt: 4, bunch: 1.3, rows: 1.35, gres: 2.0 };
const rampRear = (zz) => { const t = clamp((-0.6 - zz) / 0.7); return t * t * (3 - 2 * t); };
const NGf = (N) => (n) => N(n * (SH ? SH.gres : 1));   // glass/frame grids: denser under 'shape' so they hug the curling roof edge instead of chording across it
const bunchTop = (b) => (SH && L.k >= 0.25 ? 1 - Math.pow(1 - b, SH.bunch) : b);   // LOD0/1 only: LOD2/3 doors have 3-4 rows to begin with   // door/glass rows denser toward the roof edge so they hug the corner
const Pk = {
  box: (w, h, d, r) => (L.box === 0 ? P.flat(w, h, d) : P.box(w, h, d, r, L.box)),
  sphere: (n) => (L.sph <= 6 ? P.flat(1.4, 1.4, 1.4) : P.sphere(Math.min(n, L.sph))),          // tiny blobs collapse to a box at the far tier
  cyl: (rt, rb, h, seg = 16) => P.cyl(rt, rb, h, Math.min(seg, L.cyl)),
  torus: (R, r) => P.torus(R, r, L.ring, L.tube[1]),
};
const SOL = (t) => (L.liner ? t : 0);                         // liners on panels: hero + gameplay tiers
const SOLL = (t) => (L.liner === 'all' ? t : 0);              // liners on lamps/glass: hero tier only
const tb = (key, pts, r, caps = true, closed = false) => tube(key + L.id, pts, r, L.tube[0], L.tube[1], caps, closed);

// ── body lofts ──────────────────────────────────────────────────────────────────────────────────
export function makeTub() {
  const S = { pT: 3.3, pB: 4.5, tumble: 0.10 };
  return new Loft({
    stations: [   // hood: real profile ×0.866 in z; deck kicks up toward the tail like the reference
      { z: DIM.zRear, w: 0.80, yb: 0.38, yt: 0.98, ...S },
      { z: -1.75, w: 0.86, yb: 0.34, yt: 1.085, ...S },
      { z: -1.10, w: 0.88, yb: 0.32, yt: 1.07, ...S },
      { z: -0.40, w: 0.88, yb: 0.32, yt: 1.05, ...S },
      { z: 0.40, w: 0.88, yb: 0.32, yt: 1.03, ...S },
      { z: 1.05, w: 0.88, yb: 0.32, yt: 1.02, ...S },
      { z: 1.35, w: 0.87, yb: 0.31, yt: 0.972, ...S },
      { z: 1.62, w: 0.85, yb: 0.30, yt: 0.912, ...S },
      { z: DIM.zFront, w: 0.82, yb: 0.30, yt: 0.86, ...S },
    ],
    caps: { min: 0.30, max: 0.32 }, capPow: 3.8,
    bulges: [{ z: DIM.wheelZ, sigma: 0.42, dw: 0.06, dyt: 0.07 }, { z: -DIM.wheelZ, sigma: 0.42, dw: 0.06, dyt: 0.07 }],
  });
}
/** greenhouse: its centreline top IS the measured roofline (long shallow screen, roof peak behind the wheelbase centre, long rear slope) */
export function makeCabin() {
  const st = (zz, w, yt, pT, tumble, yb = 0.88) => {
    const r = SH && zz > -1.6 ? SH.a * rampRear(zz) : 0;   // the two buried end stations keep their taper
    return { z: zz, w: lerp(w, SH?.w ?? w, r), yb: lerp(yb, SH?.yb ?? yb, r), yt, pT: lerp(pT, SH?.pt ?? pT, r), pB: 3, tumble: lerp(tumble, SH?.tb ?? tumble, r) };
  };
  const roof = (zz) => polyY(TOY.roof, zz);
  return new Loft({
    stations: [   // both ends taper to a hair-thin slab buried in the lower body (no step where the greenhouse stops)
      st(1.16, 0.46, 0.93, 3.6, 0.13, 0.9), st(1.06, 0.62, 1.03, 3.6, 0.13, 0.9), st(0.90, 0.72, roof(0.90), 4.4, 0.12),
      st(0.57, 0.745, roof(0.57), 5.5, 0.11), st(0.31, 0.75, roof(0.31), 6, 0.10), st(0.05, 0.75, roof(0.05), 6, 0.10), st(-0.21, 0.75, roof(-0.21), 6, 0.10),
      st(-0.47, 0.75, roof(-0.47), 6, 0.10), st(-0.73, 0.745, roof(-0.73), 6, 0.10), st(-0.99, 0.725, roof(-0.99), 5.5, 0.11), st(-1.25, 0.685, roof(-1.25), 5, 0.12),
      st(-1.51, 0.62, roof(-1.51), 4, 0.13), st(-1.72, 0.52, 1.06, 3.6, 0.13, 0.9), st(-1.86, 0.40, 0.97, 3.6, 0.13, 0.92),
    ],
  });
}

// ── side panels are defined by their EDGES (Coons patches), copied from the measured daylight-opening polygons ──────────
function doorCurves(which) {
  if (which === 'front') return {
    bottom: line([0.69, 0.42], [-0.22, 0.42]), right: line([-0.22, 0.42], [-0.25, 1.46]),
    top: polyline([[0.53, 1.17], [0.35, 1.30], [0.127, 1.41], [-0.25, 1.46]]), left: polyline([[0.69, 0.42], [0.69, 1.0], [0.53, 1.17]]),
  };
  return {
    bottom: line([-0.27, 0.42], [-0.66, 0.42]), right: line([-0.66, 0.42], [-0.88, 1.385]),
    top: polyline([[-0.27, 1.465], [-0.59, 1.455], [-0.75, 1.425], [-0.88, 1.385]]), left: line([-0.27, 0.42], [-0.27, 1.465]),
  };
}
/** glass = Coons patch of the measured polygon: top edge (front→rear), bottom edge, front edge, rear edge */
function glassCurves(g, poly) {
  if (g === 'front' || g === 'rear') { const p = poly ?? TOY.glass[g]; return { top: polyline([p[0], p[1], p[2], p[3]]), bottom: polyline([p[7], p[6], p[5], p[4]]), left: line(p[7], p[0]), right: line(p[4], p[3]) }; }
  const p = poly ?? TOY.glass.quarter;
  return { top: polyline([p[1], p[2], p[3], p[4]]), bottom: polyline([p[7], p[6], p[5]]), left: polyline([p[7], p[0], p[1]]), right: polyline([p[5], p[4]]) };
}
/** 'glass' experiment: the daylight-opening polygon grown about its box centre by (mz, my) metres, z clamped to the panel it lives on */
function glassFrame(g, mz, my, zMin = -9, zMax = 9, snap = {}) {
  const p0 = TOY.glass[g], zs = p0.map((q) => q[0]), ys = p0.map((q) => q[1]);
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, hz = (Math.max(...zs) - Math.min(...zs)) / 2, hy = (Math.max(...ys) - Math.min(...ys)) / 2;
  return glassCurves(g, p0.map(([zz, y], i) => [snap[i] ?? clamp(cz + (zz - cz) * (1 + mz / hz), zMin, zMax), cy + (y - cy) * (1 + my / hy)]));
}
const sampleOutline = (c, n = 8) => { const o = []; for (let i = 0; i <= n; i++) o.push(c.bottom(i / n)); for (let i = 1; i <= n; i++) o.push(c.right(i / n)); for (let i = n - 1; i >= 0; i--) o.push(c.top(i / n)); for (let i = n - 1; i > 0; i--) o.push(c.left(i / n)); return o; };
let OUTLINE = { front: [], rear: [] };
const HOOD = { z0: 1.10, z1: 1.56, x0: 0.70, x1: 0.62 }, BOOT = { z0: -1.58, z1: -1.92, x0: 0.60, x1: 0.46 };

// how far INSIDE a panel outline a point is (m); soft falloff → a clean, shadowed opening when the panel is gone
const depthIn = (pg, zz, y) => {
  let area = 0, m = 1e9; const n = pg.length;
  for (let i = 0; i < n; i++) { const p = pg[i], q = pg[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  const sg = Math.sign(area) || 1;
  for (let i = 0; i < n; i++) { const p = pg[i], q = pg[(i + 1) % n], ex = q[0] - p[0], ey = q[1] - p[1], len = Math.hypot(ex, ey); if (len < 1e-9) continue; m = Math.min(m, (sg * (ex * (y - p[1]) - ey * (zz - p[0]))) / len); }
  return m;
};
const underPanel = (x, y, zz) => {
  let u = 0;
  if (Math.abs(x) > 0.55) for (const key of ['front', 'rear']) u = Math.max(u, sstep(0.0, 0.05, depthIn(OUTLINE[key], zz, y)));
  if (y > 0.85) {
    u = Math.max(u, sstep(0.0, 0.05, Math.min(0.66 - Math.abs(x), zz - (HOOD.z0 - 0.02), HOOD.z1 + 0.02 - zz)));
    u = Math.max(u, sstep(0.0, 0.05, Math.min(0.56 - Math.abs(x), zz - (BOOT.z1 - 0.02), BOOT.z0 + 0.02 - zz)));
  }
  return u;
};

// ── paint: one function of position → vertex colour (his `g:` paint fn) ────────────────────────────────
const DIRT = new THREE.Color('#7b5a36'), DARK = new THREE.Color('#2a2730'), WELL = new THREE.Color('#1c1a20'), SKIRT = new THREE.Color('#55555c');
export function paintBody(c, x, y, zz, ny = 0, o = {}) {
  const coarse = clamp((L.k - 0.1) / 0.25);                         // no dirt/AO speckle on coarse tiers: it smears across big triangles
  const dirt = (1 - sstep(0.32, 0.72, y)) * (0.55 + 0.45 * Math.sin(zz * 5.1 + x * 3.3) * Math.sin(zz * 2.3 - 1)) * (o.dirt ?? 0.4) * coarse;
  c.lerp(DIRT, clamp(dirt) * 0.6);
  c.multiplyScalar(1 - (1 - (0.76 + 0.24 * sstep(0.30, 0.95, y))) * (0.4 + 0.6 * coarse));           // bottom AO
  if (ny < -0.2) c.multiplyScalar(0.7);                             // belly
  if (o.under) {
    if (Math.abs(x) > 0.55) for (const zw of [DIM.wheelZ, -DIM.wheelZ]) { const d = Math.hypot(zz - zw, y - DIM.wheelY); if (d < DIM.archR + 0.01 && y < 1.0) c.lerp(WELL, 1 - sstep(DIM.archR - 0.04, DIM.archR + 0.01, d)); }
  }
  if (o.edge != null) c.multiplyScalar(0.82 + 0.18 * sstep(0, 0.09, o.edge)); // panel-edge AO
  return c;
}
const panelPaint = (dirt) => (x, y, zz, nx, ny, nz, c, u, v, region) => {
  if (region === 1) c.copy(DARK); else if (region === 2) c.copy(SKIRT);
  else paintBody(c, x, y, zz, ny, { dirt, edge: Math.min(u, 1 - u, v, 1 - v) });
};

// ── generic shaped decal: (a,b)∈[0,1]² → outline in (x,y) ──────────────────────────────────────────────────
function trapezoid(hwBot, hwTop, y0, y1, cx = 0) { return (a, b) => { const s = 2 * a - 1, hw = lerp(hwBot, hwTop, b); return [cx + s * hw, lerp(y0, y1, b)]; }; }
function outlinePts(fn, n = 28) { // walk the BOUNDARY of the decal's unit square (superellipse p≈8), so rings hug the plate outline
  const sp = (x) => Math.sign(x) * Math.pow(Math.abs(x), 0.25), p = [];
  for (let i = 0; i < n; i++) { const th = (i / n) * TAU; p.push(fn(clamp((sp(Math.cos(th)) + 1) / 2), clamp((sp(Math.sin(th)) + 1) / 2))); }
  return p;
}
// ONE trim atlas (256×128) for the whole car: top half = honeycomb (grille + lower intake), bottom half = horizontal slats (bar).
// Sub-rects via KitBuilder `uvRect`; one texture, one material, one draw call for all mesh trim.
const HEX = [0, 0.5, 1, 1], SLAT = [0, 0, 1, 0.5];
const trimTex = () => canvasTexture(256, 128, (g, w, h) => {
  g.fillStyle = '#101014'; g.fillRect(0, 0, w, h);
  g.strokeStyle = RC.has('grille') ? '#2b2d35' : '#3d3f49'; g.lineWidth = 2.4; const r = 9;
  for (let row = -1; row < 64 / (r * 1.5) + 1; row++) for (let colm = -1; colm < w / (r * 1.75) + 1; colm++) {
    const cx = colm * r * 1.75 + (row % 2 ? r * 0.875 : 0), cy = row * r * 1.5; g.beginPath();
    for (let q = 0; q < 6; q++) { const an = Math.PI / 6 + (q * Math.PI) / 3; g.lineTo(cx + Math.cos(an) * r * 0.92, cy + Math.sin(an) * r * 0.92); } g.closePath(); g.stroke();
  }
  g.fillStyle = '#16161b'; g.fillRect(0, 64, w, 64); g.fillStyle = '#3a3c46'; for (let i = 0; i < 6; i++) g.fillRect(0, 70 + i * 9, w, 3.5);
});
const numberTex = (n) => canvasTexture(128, 128, (g) => {
  g.fillStyle = '#fbf6ea'; g.beginPath(); g.arc(64, 64, 62, 0, TAU); g.fill(); g.lineWidth = 7; g.strokeStyle = '#1b1b22'; g.stroke();
  g.fillStyle = '#1b1b22'; g.font = 'bold 84px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 70);
});

/** convex hull (monotone chain) of 2D points, ccw */
function hull2(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}

// orient helpers ---------------------------------------------------------------------------------------
const _up = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const qFacing = (n) => { _z.copy(n).negate(); _m4.lookAt(new THREE.Vector3(), _z, Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : _up); return new THREE.Quaternion().setFromRotationMatrix(_m4); }; // local +Z = n
const at = (h, d = 0) => [h.p.x + h.n.x * d, h.p.y + h.n.y * d, h.p.z + h.n.z * d];
const sideName = (sgn) => (sgn > 0 ? 'L' : 'R');            // kit +X is the car's LEFT (see header)

// ── wheels ──────────────────────────────────────────────────────────────────────────────────────
function buildWheel(id, side, lod, paints) {
  const spin = new KitBuilder(), still = new KitBuilder();
  const R = DIM.wheelR, W = DIM.tyreW / 2, seg = L.tyre.seg;
  const PROF = {
    smooth: [[[0.24, -W], [0.31, -W * 1.02], [R * 0.93, -W * 0.86], [R, -W * 0.5], [R, W * 0.5], [R * 0.93, W * 0.86], [0.31, W * 1.02], [0.24, W], [0.24, -W]], 8],
    light: [[[0.24, -W], [R * 0.93, -W * 0.86], [R, -W * 0.4], [R, W * 0.4], [R * 0.93, W * 0.86], [0.24, W], [0.24, -W]], 0],
    ring: [[[0.24, -W], [R, -W * 0.8], [R, W * 0.8], [0.24, W], [0.24, -W]], 0],
  }[L.tyre.prof];
  spin.push({ r: [0, 0, Math.PI / 2] });
  spin.add(lathe(PROF[0], seg, PROF[1], 'tyre' + L.id + R), 'rubber', {
    g: (x, y, zz, nx, ny, nz, c) => { const r = Math.hypot(x, zz), a = Math.abs(y) / W; c.set(r > R * 0.94 ? '#1b1b1f' : '#2a2a30'); if (a > 0.5 && r > 0.3 && r < 0.315) c.set('#3d3d45'); if (a > 0.9) c.multiplyScalar(0.8); },
  });
  spin.pop();
  // alloy (outer face is +X; the wheel is flipped by its orient group on the other side). Wheels are the single most reliable
  // "car" cue, so every tier keeps a light 5-spoke read; only the tessellation and sub-parts change.
  if (L.rim === 'full') {
    spin.push({ r: [0, 0, -Math.PI / 2] });
    spin.add(lathe([[0.001, 0.07], [0.07, 0.07], [0.09, 0.085], [0.25, 0.08], [0.275, 0.108], [0.275, 0.128], [0.26, 0.133], [0.24, 0.123], [0.235, -0.11], [0.001, -0.11]], 20, 0, 'rimdish' + L.id), 'alloy', {
      g: (x, y, zz, nx, ny, nz, c) => { const r = Math.hypot(x, zz); c.set(y > 0.055 && r < 0.245 ? '#1d1f25' : '#d9dde5'); },
    });
    spin.pop();
    for (let i = 0; i < 5; i++) { spin.push({ r: [(i / 5) * TAU, 0, 0] }); spin.add(P.flat(0.034, 0.222, 0.082), 'alloy', { p: [0.102, 0.155, 0], c: '#e8ebf1' }); spin.pop(); }
    spin.add(Pk.cyl(0.056, 0.06, 0.03, 16), 'alloy', { p: [0.11, 0, 0], r: [0, 0, Math.PI / 2], c: '#aeb4bf' });
    spin.add(Pk.cyl(0.032, 0.032, 0.034, 12), 'gloss', { p: [0.114, 0, 0], r: [0, 0, Math.PI / 2], c: '#2a2e38' });
    for (let i = 0; L.nuts && i < 5; i++) { spin.push({ r: [(i / 5) * TAU + 0.31, 0, 0] }); spin.add(Pk.sphere(6), 'chrome', { p: [0.114, 0.086, 0], s: 0.014, c: '#f4f6fa' }); spin.pop(); }
  } else if (L.rim === 'flat') {
    spin.add(P.cyl(0.25, 0.25, 0.02, 8), 'alloy', { p: [0.09, 0, 0], r: [0, 0, Math.PI / 2], c: '#1d1f25' });                 // dark bore
    for (let i = 0; i < 5; i++) { spin.push({ r: [(i / 5) * TAU, 0, 0] }); spin.add(P.flat(0.03, 0.235, 0.08), 'alloy', { p: [0.104, 0.15, 0], c: '#e8ebf1' }); spin.pop(); }
    spin.add(P.cyl(0.05, 0.05, 0.03, 6), 'alloy', { p: [0.108, 0, 0], r: [0, 0, Math.PI / 2], c: '#aeb4bf' });
  } else {
    spin.add(P.cyl(0.25, 0.25, 0.02, Math.max(6, L.tyre.seg)), 'alloy', { p: [0.09, 0, 0], r: [0, 0, Math.PI / 2], c: '#b9bfca' });
  }
  if (L.brake) { still.add(Pk.cyl(0.2, 0.2, 0.03, 20), 'metal', { p: [-W * 0.55, 0, 0], r: [0, 0, Math.PI / 2], c: '#7d818c' }); still.add(Pk.box(0.05, 0.12, 0.09, 0.02, 1), 'gloss', { p: [-W * 0.4, 0.14, 0.04], c: '#3a3d46' }); }
  const grp = new THREE.Group(); grp.name = id;
  const gs = spin.build(id + '/spin'), gt = still.build(id + '/hub'); gs.name = 'spin'; gt.name = 'hub';
  const orient = new THREE.Group(); orient.name = 'orient'; orient.add(gs, gt); if (side < 0) orient.rotation.y = Math.PI;
  grp.add(orient); grp.userData.spin = gs;
  return grp;
}

// ── mass model and joints (asset contract "Node extras") ─────────────────────────────────────────────────
const MASS = {   // fractions of 1200 kg: realistic detached-part masses (door ≈ 22 kg, wheel+tyre ≈ 29 kg, bonnet ≈ 18 kg)
  door_L: 0.018, door_R: 0.018, door_rear_L: 0.016, door_rear_R: 0.016, bonnet: 0.015, boot: 0.014, bumper_front: 0.014, bumper_rear: 0.012, glass: 0.012,
  light_head_L: 0.002, light_head_R: 0.002, light_brake_L: 0.001, light_brake_R: 0.001, mirror_L: 0.001, mirror_R: 0.001, spoiler: 0,
  wheel_FL: 0.024, wheel_FR: 0.024, wheel_RL: 0.024, wheel_RR: 0.024, susp_FL: 0.004, susp_FR: 0.004, susp_RL: 0.004, susp_RR: 0.004,
};
const ACC_MASS = { lightbar: 0.0004, antenna: 0.0001 };   // experiment accessories: counted only while their flag is on, so the default mass table is unchanged
const accOn = () => Object.entries(ACC_MASS).reduce((a, [id, m]) => a + ((id === 'lightbar' ? RC.has('lightbar') : RC.has('uhf')) ? m : 0), 0);
const massOf = (id) => (id === 'chassis' ? +(1 - Object.values(MASS).reduce((a, b) => a + b, 0) - accOn()).toFixed(6) : (MASS[id] ?? ACC_MASS[id]));

// ── main build ─────────────────────────────────────────────────────────────────────────────────
export async function build({ lod = 0, paint = GOLD.paint, accent = '#d8362f', finish = GOLD.finish, flair = {}, number = '7', rc = [], shape = {} } = {}) {
  L = LODS[lod]; const k = L.k, N = (n) => Math.max(L.min, Math.round(n * k));
  RC = new Set(rc.includes('all') ? RC_ALL : rc);
  SH = RC.has('shape') ? { ...SHAPE_DEFAULT, ...shape } : null;
  const car = new THREE.Group(); car.name = 'cruze';
  const parts = {}; const mats = { paint: tintedMaterial('paint', paint, finish), accent: tintedMaterial('accent', accent) };
  const tub = makeTub(), cab = makeCabin(), body = new LoftUnion(tub, cab, SH ? SH.k : 0.7);
  OUTLINE = { front: sampleOutline(doorCurves('front')), rear: sampleOutline(doorCurves('rear')) };
  const ctx = { tub, cab, body, mats, lod, k, N, paints: { paint, accent }, number, flair: { spoiler: true, ...flair } };
  car.userData.ctx = ctx; car.userData.parts = parts;
  const addPart = (id, grp, meta) => {
    const { parent, ...m } = meta;
    grp.name = id; grp.userData.jj = { id, massFraction: massOf(id), massKg: +(massOf(id) * MASS_KG).toFixed(2), ...m }; (parent ?? car).add(grp); parts[id] = grp; return grp;
  };
  ctx.addPart = addPart;
  buildChassis(car, ctx);
  buildDoors(car, ctx);
  buildLids(car, ctx);
  buildEnds(car, ctx);
  buildLamps(car, ctx);
  buildGlass(car, ctx);
  buildExtras(car, ctx);
  buildAccessories(car, ctx);
  for (const [fb, zz] of [['F', 1], ['R', -1]]) for (const sgn of [1, -1]) {
    const id = `wheel_${fb}${sideName(sgn)}`, w = buildWheel(id, sgn, lod, ctx.paints);
    w.position.set(sgn * DIM.wheelX, DIM.wheelY, zz * DIM.wheelZ);
    addPart(id, w, { kind: 'wheel', hp: 140, radius: DIM.wheelR, width: DIM.tyreW, joint: fb === 'F' ? 'compound' : 'spin', steer: fb === 'F', driven: fb === 'F', detachable: true, attach: 'chassis', side: sgn });
    // suspension: strut + spring, origin at the top mount, hanging to the hub
    const sp = new KitBuilder(), top = [sgn * (DIM.wheelX - 0.06), DIM.wheelY + DIM.susp.rest, zz * DIM.wheelZ];
    if (L.susp !== 'none') {   // hidden inside the arch on most cameras: cheapest possible read
      sp.add(P.cyl(0.024, 0.024, DIM.susp.rest * 0.9, L.susp === 'coil' ? 8 : 5), 'metal', { p: [0, -DIM.susp.rest * 0.45, 0], c: '#3d4048' });
      if (L.susp === 'coil') for (let i = 0; i < 3; i++) sp.add(P.torus(0.055, 0.011, 10, 4), 'metal', { p: [0, -0.12 - i * 0.1, 0], r: [Math.PI / 2, 0, 0], c: '#2a2c33' });
    }
    const sg = sp.build(`susp_${fb}${sideName(sgn)}`, { materials: mats, dentable: [] }); sg.position.set(...top);
    addPart(`susp_${fb}${sideName(sgn)}`, sg, { kind: 'suspension', hp: 1e9, joint: 'suspension', detachable: false, attach: 'chassis', topMount: top, side: sgn });
  }
  // contract anchors (chassis-stable through part loss). roof_number is ABOVE the roof; the game overlays the race number there.
  const marker = (name, p) => { const o = new THREE.Object3D(); o.name = name; o.position.set(...p); car.add(o); parts[name] = o; };
  marker('lplate_front', [0, 0.53, DIM.zFront - 0.02]); marker('lplate_rear', [0, 0.74, DIM.zRear + 0.02]); marker('cam_fp', [0, 1.26, 0.06]); marker('cam_tp_target', [0, 0.95, 0]);
  marker('com', [0, 0.6, 0]); marker('exhaust_0', [0.5, 0.4, DIM.zRear + 0.02]); marker('roof_number', [0, 1.56, -0.3]);
  car.userData.proxy = [{ half: [0.86, 0.34, 1.75], offset: [0, 0.66, -0.06] }, { half: [0.66, 0.3, 0.7], offset: [0, 1.25, -0.4] }];
  return car;
}

function buildChassis(car, { tub, body, mats, N, lod, number, flair }) {
  const b = new KitBuilder();
  // ONE seamless body mesh from the smooth union of lower shell + greenhouse (no crease at the belt line)
  b.add(body.radial({ nu: L.body[0], nv: L.body[1], inset: 0.007 }), 'paint', { c: '#fff', space: 'world', g: (x, y, zz, nx, ny, nz, c) => paintBody(c, x, y, zz, ny, { under: true, dirt: y > 1.0 ? 0.12 : 0.45 }) });
  // wheel-well backdrops + arch beads, hugging the flank via side probes
  for (const sgn of [1, -1]) for (const zw of [DIM.wheelZ, -DIM.wheelZ]) {
    const Ra = DIM.archR, wy = DIM.wheelY;
    const polar = (r0, r1) => (a, bb) => { const ph = lerp(-0.22, Math.PI + 0.22, a), r = lerp(r0, r1, bb); return tub.side(zw + r * Math.cos(ph), Math.min(0.985, wy + r * Math.sin(ph)), sgn); };
    if (L.wells) b.add(tub.probed(Math.max(6, Math.round(24 * L.wells)), Math.max(2, Math.round(6 * L.wells)), polar(0.0, Ra), { off: 0.012 }), 'matte', { c: '#1c1a20', space: 'world' });
    if (L.arch) {
      const nn = Math.max(6, Math.round(24 * Math.sqrt(L.k))), pts = []; for (let i = 0; i <= nn; i++) { const ph = lerp(-0.22, Math.PI + 0.22, i / nn), r = Ra + 0.02; pts.push(at(tub.side(zw + r * Math.cos(ph), Math.min(0.985, wy + r * Math.sin(ph)), sgn), 0.006)); }
      b.add(tb(`arch${sgn}${zw}`, pts, 0.03), 'satin', { c: '#3a3941', space: 'world', g: (x, y, zz, nx, ny, nz, c) => c.multiplyScalar(0.85 + 0.15 * sstep(0.3, 0.9, y)) });
    }
  }
  for (let s = 0; s < 2 && L.skirts; s++) {   // side skirts (dark plastic) between the arches
    const sgn = s ? -1 : 1, pts = []; for (let i = 0; i <= 6; i++) { const zz = lerp(0.6, -0.6, i / 6), h = tub.side(zz, 0.385, sgn); pts.push(at(h, 0.022)); }
    b.add(tb('skirt' + sgn, pts, 0.02), 'satin', { c: '#33323a', space: 'world' });
  }
  if (flair.stripes) b.add(body.probed(4, N(18), (a, bb) => body.top(lerp(-0.13, 0.13, a), lerp(0.30, -0.70, bb)), { off: 0.012 }), 'accent', { c: '#fff', space: 'world' });
  if (flair.roundel) b.add(body.probed(N(14), N(14), (a, bb) => body.top(lerp(-0.23, 0.23, a), lerp(-0.55, -0.09, bb)), { off: 0.014 }), texturedMaterial('roundel' + number, 'satin', () => numberTex(number), { transparent: true, alphaTest: 0.5 }), { c: '#fff', space: 'world' });
  if (RC.has('glass') && L.k >= 0.25) for (const sgn of [1, -1]) {   // B-pillar: the gap between the two doors is gloss black, not body colour
    b.add(body.probed(8, N(14), (a, bb) => body.side(lerp(-0.185, -0.31, a), lerp(1.0, 1.44, bb), sgn), { off: 0.02 }), 'matte', { c: '#0f1014', space: 'world' });
  }
  addBays(b, { body, N });
  const chassis = b.build('chassis', { materials: mats, dentable: ['paint', 'accent', 'matte'] });
  chassis.name = 'chassis'; chassis.userData.jj = { id: 'chassis', kind: 'core', hp: 999, joint: 'fixed', detachable: false, massFraction: massOf('chassis'), massKg: +(massOf('chassis') * MASS_KG).toFixed(2) };
  car.add(chassis); car.userData.parts.chassis = chassis;
}

/** dark "bays" under each hinged panel, as real geometry on the chassis: hidden behind the panel while it is fitted; a clean dark
 *  opening (not a smeared vertex-colour blotch) the moment it is gone, at every LOD. Dented together with the shell. */
function addBays(b, { body, N }) {
  // Same grid as the panel it hides (so coarse-chord error is identical, never poking through) but 14 mm lower; the visible sliver at the edge reads as a shut line.
  for (const which of ['front', 'rear']) for (const sgn of [1, -1]) {
    const C = doorCurves(which), skin = coons(C.bottom, C.top, C.left, C.right);
    b.add(body.probed(N(14), N(18), (a, bb) => { const [zz, y] = skin(a, bb); return body.side(zz, y, sgn); }, { off: 0.002 }), 'matte', { c: '#27242b', space: 'world', g: (x, y, zz, nx, ny, nz, c) => c.multiplyScalar(0.55 + 0.45 * sstep(0.4, 1.3, y)) });
  }
  for (const R of [HOOD, BOOT]) b.add(body.probed(N(22), N(12), (a, bb) => body.top(lerp(R.x0, R.x1, bb) * (2 * a - 1), lerp(R.z0, R.z1, bb)), { off: 0.002 }), 'matte', { c: '#27242b', space: 'world' });
}

function buildDoors(car, { body, mats, N, addPart, paints }) {
  const NG = NGf(N);
  const specs = [['front', 'door_', 0.69], ['rear', 'door_rear_', -0.27]];
  for (const [which, prefix, zHinge] of specs) for (const sgn of [1, -1]) {
    const id = prefix + sideName(sgn), C = doorCurves(which), hinge = [sgn * 0.84, 0.98, zHinge], b = new KitBuilder();
    const skin = coons(C.bottom, C.top, C.left, C.right);
    b.add(body.probed(N(14), Math.round(N(18) * (SH && L.k >= 0.25 ? SH.rows : 1)), (a, bb) => { const [zz, y] = skin(a, bunchTop(bb)); return body.side(zz, y, sgn); },
      { off: (a, bb) => L.poff + 0.007 * Math.exp(-(((bunchTop(bb) - 0.46) / 0.03) ** 2)), solid: SOL(0.03) }), 'paint', { c: '#fff', space: 'world', g: panelPaint(0.4) });   // + a subtle shoulder crease
    const gc = glassCurves(which), gl = coons(gc.bottom, gc.top, gc.left, gc.right), GX = RC.has('glass');
    if (GX && L.k >= 0.25) {   // gloss-black window surround (A/B pillar read), clamped inside this door's own edges
      const fc = which === 'front' ? glassFrame('front', 0.045, 0.045, -0.25, 0.66, { 3: -0.246, 4: -0.226 }) : glassFrame('rear', 0.045, 0.045, -1.04, -0.27, { 0: -0.272, 7: -0.272 }), fr = coons(fc.bottom, fc.top, fc.left, fc.right);
      b.add(body.probed(NG(12), NG(8), (a, bb) => { const [ra, rb] = softCorners(a, bb, 0.22); const [zz, y] = fr(ra, bunchTop(rb)); return body.side(zz, y, sgn); }, { off: L.poff + 0.013 }), 'satin', { c: '#101116', space: 'world' });
    }
    b.add(body.probed(NG(12), NG(8), (a, bb) => { const [ra, rb] = softCorners(a, bb, 0.22); const [zz, y] = gl(ra, bunchTop(rb)); return body.side(zz, y, sgn); }, { off: GX ? L.poff + 0.018 : 0.02 }), 'glass', { c: GX ? '#22344a' : '#334a63', space: 'world' });
    const hh = body.side(lerp(C.bottom(0)[0], C.bottom(1)[0], 0.78), 0.86, sgn);   // handle: chrome bar
    if (L.k >= 0.25) b.add(Pk.box(0.03, 0.026, 0.13, 0.012, 1), 'chrome', { p: at(hh, 0.033), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(sgn, 0, 0), hh.n), c: '#e8ebf1' });
    const door = addPart(id, b.build(id, { pivot: hinge, materials: mats }), { kind: 'door', hp: 100, joint: 'hinge', axisKit: [0, -sgn, 0], rangeDeg: [0, 70], detachable: true, attach: 'chassis', side: sgn, hinge: { point: hinge, axis: [0, 1, 0], sign: sgn, max: 1.15 } });
    if (which === 'front') {   // mirror lives on the front door (contract: mirrors are children of the front doors)
      const mb = new KitBuilder(), base = body.side(0.56, 1.05, sgn), px = Math.abs(base.p.x), mz = 0.6;
      if (RC.has('mirror')) {   // squarer housing on a dark sail; the glass faces the driver (rearward), not out sideways
        mb.add(Pk.box(0.06, 0.055, 0.1, 0.012, 1), 'satin', { p: [sgn * (px + 0.03), 1.05, mz + 0.02], c: '#15161a' });
        mb.add(Pk.box(0.095, 0.078, 0.19, 0.03, 1), 'paint', { p: [sgn * (px + 0.105), 1.085, mz - 0.03], c: '#fff' });
        if (L.k >= 0.5) mb.add(Pk.cyl(0.05, 0.05, 0.008, 18), 'metal', { p: [sgn * (px + 0.105), 1.085, mz - 0.128], r: [Math.PI / 2, 0, 0], c: '#b9c3d2' });
      } else {
      mb.add(Pk.box(0.13, 0.028, 0.05, 0.012, 1), 'satin', { p: [sgn * (px + 0.055), 1.04, mz], c: '#2c2c33' });
      mb.add(Pk.sphere(14), 'paint', { p: [sgn * (px + 0.12), 1.09, mz - 0.01], s: [0.045, 0.07, 0.095], c: '#fff' });
      if (L.k >= 0.5) mb.add(Pk.cyl(0.062, 0.062, 0.008, 18), 'metal', { p: [sgn * (px + 0.122), 1.09, mz - 0.1], r: [0, 0, Math.PI / 2], c: '#b9c3d2' });
      }
      const mpivot = [sgn * (px + 0.02), 1.04, mz], mg = mb.build('mirror_' + sideName(sgn), { pivot: mpivot, materials: mats, dentable: [] });
      mg.position.set(mpivot[0] - hinge[0], mpivot[1] - hinge[1], mpivot[2] - hinge[2]);
      addPart('mirror_' + sideName(sgn), mg, { kind: 'accessory', hp: 40, joint: 'fixed', detachable: true, attach: id, side: sgn, parent: door });
    }
  }
}

function buildLids(car, { body, mats, N, addPart }) {
  const topPatch = (R) => (a, b) => body.top(lerp(R.x0, R.x1, b) * (2 * a - 1), lerp(R.z0, R.z1, b));
  const lid = (id, R, sign, dirt, hood) => {
    const b = new KitBuilder(), pivot = [0, body.top(0, R.z0).p.y + 0.02, R.z0];
    // hood creases: two shallow ridges running from the cowl toward the lamps (a Cruze cue), amplitude 6 mm
    const off = hood ? (a, bb) => L.poff + 0.006 * (Math.exp(-(((a - 0.2) / 0.04) ** 2)) + Math.exp(-(((a - 0.8) / 0.04) ** 2))) * sstep(0, 0.25, bb) : L.poff;
    b.add(body.probed(N(22), N(12), topPatch(R), { off, solid: SOL(0.03) }), 'paint', { c: '#fff', space: 'world', g: panelPaint(dirt) });
    if (hood && RC.has('hood') && L.k >= 0.25) for (const sg of [1, -1]) {   // two crease lines converging on the grille (owner photo 4 / front ortho)
      const pts = []; for (let i = 0; i <= 8; i++) { const bb = i / 8, ac = 0.8 - 0.4 * bb; pts.push(at(body.top(sg * lerp(R.x0, R.x1, bb) * ac, lerp(R.z0, R.z1, bb)), 0.013)); }
      b.add(tb('hcrease' + sg, pts, 0.0065), 'paint', { c: '#fff', space: 'world', g: (x, y, zz, nx, ny, nz, c) => c.multiplyScalar(0.6) });
    }
    addPart(id, b.build(id, { pivot, materials: mats }), { kind: 'lid', hp: 100, joint: 'hinge', axisKit: [sign, 0, 0], rangeDeg: [0, 60], detachable: true, attach: 'chassis', hinge: { point: pivot, axis: [1, 0, 0], sign, max: 1.0 } });
  };
  lid('bonnet', HOOD, -1, 0.12, true);
  lid('boot', BOOT, 1, 0.2, false);
}

function buildEnds(car, { tub, mats, N, addPart, lod }) {
  const F = (x, y) => tub.front(x, y), R = (x, y) => tub.rear(x, y);
  const T = TOY.front, trim = texturedMaterial('trim', 'satin', trimTex);
  // ── front bumper assembly: cover + slatted bar + chrome-framed hex grille + badge + honeycomb intake + wide fog recesses + plate recess
  {
    const b = new KitBuilder();
    b.add(tub.patch({ v0: tub.vOfZ(1.52), v1: 1, nu: N(68), nv: N(12), off: L.poff + 0.002, solid: SOL(0.03) }), 'paint', { c: '#fff', space: 'world', g: panelPaint(0.4) });
    const plate = (fn, mat, c, off, o = {}) => b.add(tub.probed(N(18), N(8), (a, bb) => { const [x, y] = fn(a, bb); return F(x, y); }, { off }), mat, { c, space: 'world', ...o });
    const ring = (fn, r, off, mat = 'chrome', c = '#e8ebf1', tier = 'all') => { if (!L.rings || (L.rings === 'grille' && tier !== 'grille')) return; const pts = outlinePts(fn, L.ring).map(([x, y]) => at(F(x, y), off)); pts.push(pts[0]); b.add(tb('ring' + Math.random(), pts, r, false), mat, { c, space: 'world' }); };
    // 'grille' experiment (owner photo 4): the real front reads as one BOLD dark grille in a chunky chrome frame under a solid chrome bar
    // carrying a big roundel, with round chrome-ringed fog lamps. Measured cues stay where they were; only weight and contrast change.
    const GB = RC.has('grille');
    const Gd = GB ? { hwTop: T.grille.hwTop + 0.03, hwBot: T.grille.hwBot + 0.032, yTop: T.grille.yTop, yBot: T.grille.yBot - 0.028 } : T.grille;
    const Bd = GB ? { hw: T.bar.hw + 0.04, y0: T.bar.y0 - 0.002, y1: T.bar.y1 + 0.016 } : T.bar;
    const gr = trapezoid(Gd.hwBot, Gd.hwTop, Gd.yBot, Gd.yTop), grOut = trapezoid(Gd.hwBot + 0.014, Gd.hwTop + 0.014, Gd.yBot - 0.012, Gd.yTop + 0.012);
    plate(gr, trim, '#fff', 0.02, { uvRect: HEX }); ring(grOut, GB ? 0.017 : 0.01, 0.024, 'chrome', '#e8ebf1', 'grille');
    if (RC.has('lightbar') && L.k >= 0.25) plate(trapezoid(T.plate.hw, T.plate.hw, T.plate.y0, T.plate.y1), texturedMaterial('plateF', 'satin', () => canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = '#f1eee4'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a2d3a'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = '#2a2d3a'; g.font = 'bold 40px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('JAM\u00b7042', w / 2, h / 2 + 2);
    })), '#fff', 0.019);
    const bar = trapezoid(Bd.hw, Bd.hw, Bd.y0, Bd.y1);
    if (GB) plate(bar, 'chrome', '#e6e9ef', 0.024); else plate(bar, trim, '#fff', 0.02, { uvRect: SLAT });
    ring(trapezoid(Bd.hw + 0.012, Bd.hw + 0.012, Bd.y0 - 0.01, Bd.y1 + 0.01), 0.006, 0.023, 'chrome', '#dfe3ea', 'grille');
    const it = trapezoid(T.intake.hwBot, T.intake.hwTop, T.intake.yBot, T.intake.yTop); plate(it, trim, '#fff', 0.02, { uvRect: HEX }); ring(trapezoid(T.intake.hwBot + 0.012, T.intake.hwTop + 0.012, T.intake.yBot - 0.01, T.intake.yTop + 0.01), 0.006, 0.022, 'satin', '#2d2d33');
    const bh = F(0, GB ? Bd.y0 + 0.012 : (T.grille.yTop + T.bar.y0) / 2 + 0.005), qf = qFacing(bh.n).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
    if (L.badge) { const kb = GB ? 1.4 : 1;   // generic roundel badge (no real marque)
      b.add(Pk.cyl(0.05 * kb, 0.054 * kb, 0.018, 24), 'chrome', { p: at(bh, 0.03), q: qf, c: '#e8ebf1' });
      if (GB) b.add(Pk.cyl(0.043 * kb, 0.043 * kb, 0.02, 24), 'gloss', { p: at(bh, 0.036), q: qf, c: '#1b1e29' });
      b.add(Pk.cyl(0.034 * kb, 0.034 * kb, 0.02, 20), 'gloss', { p: at(bh, GB ? 0.042 : 0.036), q: qf, c: '#c9a03a' }); }
    for (const sgn of [1, -1]) {   // fog recesses: wide, shallow, narrowing toward the inner-bottom
      const fg = (a, bb) => { const [x, y] = quad([[T.fog.x0 + 0.05, T.fog.y0], [T.fog.x1 - 0.01, T.fog.y0 + 0.01], [T.fog.x1, T.fog.y1], [T.fog.x0, T.fog.y1]], a, bb); return [sgn * x, y]; };
      plate(fg, 'matte', '#26252c', 0.016);
      const cx = sgn * (T.fog.x0 + T.fog.x1) / 2, cy = (T.fog.y0 + T.fog.y1) / 2 - 0.005, h = F(cx, cy);
      if (GB) {   // round fog lamp in a chrome ring, sitting in the dark pod
        const fq = qFacing(h.n);
        if (L.k >= 0.5) { b.add(Pk.torus(0.05, 0.009), 'chrome', { p: at(h, 0.04), q: fq, c: '#e8ebf1' }); b.add(Pk.sphere(12), 'headlight', { p: at(h, 0.03), s: [0.046, 0.046, 0.016], q: fq, c: '#f3ecd6' }); }
        else { const fd = fq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))); b.add(P.cyl(0.055, 0.055, 0.012, 10), 'chrome', { p: at(h, 0.034), q: fd, c: '#e8ebf1' }); b.add(P.cyl(0.042, 0.042, 0.012, 10), 'headlight', { p: at(h, 0.042), q: fd, c: '#f3ecd6' }); }
      } else b.add(L.sph <= 8 ? P.flat(1.4, 1.4, 1.4) : Pk.sphere(10), 'headlight', { p: at(h, 0.03), s: L.sph <= 8 ? [0.032, 0.02, 0.006] : [0.045, 0.028, 0.02], q: qFacing(h.n), c: '#e8e2c8' });
    }
    addPart('bumper_front', b.build('bumper_front', { pivot: [0, 0.55, 1.5], materials: mats }), { kind: 'bumper', hp: 120, joint: 'fixed', detachable: true, attach: 'chassis' });
  }
  // ── rear bumper assembly: cover + plate + reflectors + exhaust
  {
    const b = new KitBuilder(), Rr = TOY.rear;
    b.add(tub.patch({ v0: 0, v1: tub.vOfZ(-1.92), nu: N(50), nv: N(12), off: L.poff + 0.002, solid: SOL(0.03) }), 'paint', { c: '#fff', space: 'world', g: panelPaint(0.4) });
    const plate = (fn, mat, c, off) => b.add(tub.probed(N(12), N(6), (a, bb) => { const [x, y] = fn(a, bb); return R(x, y); }, { off }), mat, { c, space: 'world' });
    plate(trapezoid(Rr.plate.hw * 0.85, Rr.plate.hw * 0.85, Rr.plate.y0, Rr.plate.y1 - 0.02), 'satin', RC.has('tail') && L.k >= 0.25 ? '#efece2' : '#a7a496', 0.016);
    if (RC.has('tail') && L.k >= 0.25) {   // chrome strip across the boot lid between the lamps + a generic roundel (the real car's bowtie, no marque)
      plate(trapezoid(0.39, 0.39, 0.838, 0.866), 'chrome', '#e8ebf1', 0.021);
      if (L.badge) { const bh = R(-0.2, 0.905), qf = qFacing(bh.n); b.add(Pk.torus(0.032, 0.007), 'chrome', { p: at(bh, 0.026), q: qf, c: '#e8ebf1' }); b.add(Pk.sphere(10), 'gloss', { p: at(bh, 0.02), s: [0.028, 0.028, 0.012], q: qf, c: '#c9a03a' }); }
    }
    for (const sgn of [1, -1]) {
      plate((a, bb) => { const [x, y] = quad([[0.66, 0.44], [0.8, 0.44], [0.8, 0.49], [0.66, 0.49]], a, bb); return [sgn * x, y]; }, 'gloss', '#a3242c', 0.02);   // reflectors
      const eh = R(sgn * 0.5, 0.4);
      if (L.k >= 0.5) b.add(Pk.cyl(0.034, 0.038, 0.09, 14), 'chrome', { p: at(eh, 0.02), q: new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(0, 0, -1)), c: '#e8ebf0' });
    }
    addPart('bumper_rear', b.build('bumper_rear', { pivot: [0, 0.55, -1.5], materials: mats }), { kind: 'bumper', hp: 120, joint: 'fixed', detachable: true, attach: 'chassis' });
  }
}

function buildLamps(car, { tub, mats, N, addPart }) {
  const T = TOY.front, Rr = TOY.rear;
  for (const sgn of [1, -1]) {
    const nm = sideName(sgn), mir = (fn) => (a, bb) => { const [x, y] = fn(a, bb); return [x * sgn, y]; };
    // ── headlamp: the measured tilted parallelogram with the pointed outer-top tip; clear lens, dark reflector, projector, amber indicator
    const b = new KitBuilder(), c = T.lamp;              // corners: inner-bottom, outer-bottom, outer-top, inner-top
    const lens = mir((a, bb) => { const [ra, rb] = softCorners(a, bb, 0.3); return quad(c, ra, rb); });
    const F = (x, y) => tub.front(x, y);
    const domed = (a, bb) => 0.02 + 0.02 * (1 - ((2 * a - 1) ** 2 + (2 * bb - 1) ** 2) / 2);
    b.add(tub.probed(N(16), N(8), (a, bb) => { const [x, y] = lens(a, bb); return F(x, y); }, { off: 0.012 }), 'metal', { c: '#8b93a0', space: 'world' });           // silver reflector bowl
    b.add(tub.probed(N(16), N(8), (a, bb) => { const [x, y] = lens(a, bb); return F(x, y); }, { off: domed, solid: SOLL(0.028) }), 'glass', { c: '#a8bccb', space: 'world' }); // clear lens shell
    if (L.rings === 'all') { const pts = outlinePts((a, bb) => lens(a, bb), L.ring).map(([x, y]) => at(F(x, y), 0.026)); pts.push(pts[0]); b.add(tb('lensrim' + sgn, pts, 0.006, false), 'chrome', { c: '#dfe3ea', space: 'world' }); }
    const pj = T.projector, ec = F(sgn * pj.x, pj.y), eq = qFacing(ec.n);
    if (L.eyes === 'full') {   // projector: chrome ring, dark bowl, warm core — small and realistic, not a cartoon eye
      b.add(Pk.torus(pj.r, 0.008), 'chrome', { p: at(ec, 0.052), q: eq, c: '#e8ebf1' });
      b.add(Pk.sphere(14), 'metal', { p: at(ec, 0.04), s: [pj.r * 0.9, pj.r * 0.9, 0.024], q: eq, c: '#5c6370' });
      b.add(Pk.sphere(12), 'headlight', { p: at(ec, 0.054), s: [pj.r * 0.5, pj.r * 0.5, 0.012], q: eq, c: '#fff3d0' });
    } else if (L.eyes === 'disc') {
      b.add(P.cyl(pj.r, pj.r, 0.02, 8), 'metal', { p: at(ec, 0.04), q: eq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))), c: '#5c6370' });
      b.add(P.cyl(pj.r * 0.55, pj.r * 0.55, 0.02, 8), 'headlight', { p: at(ec, 0.052), q: eq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))), c: '#fff3d0' });
    } else b.add(Pk.sphere(6), 'headlight', { p: at(ec, 0.045), s: [pj.r * 0.9, pj.r * 0.9, 0.02], q: eq, c: '#f3ecd6' });
    const ind = mir((a, bb) => lens(lerp(0.62, 0.9, a), lerp(0.72, 0.9, bb)));   // amber indicator: a sub-region of the lens itself, so it can never leave it
    b.add(tub.probed(N(8), 3, (a, bb) => { const [x, y] = ind(a, bb); return F(x, y); }, { off: 0.034 }), 'indicator', { c: '#ffb020', space: 'world' });
    addPart('light_head_' + nm, b.build('light_head_' + nm, { pivot: [sgn * 0.6, 0.75, 1.8], materials: mats }), { kind: 'lamp', hp: 40, joint: 'fixed', detachable: true, attach: 'chassis', side: sgn });
    // ── tail lamp: two-piece wrap (outer on the quarter, slanted inner on the lid), lighter reverse section low
    const t = new KitBuilder(), R = (x, y) => tub.rear(x, y);
    const dm = (a, bb) => 0.016 + 0.016 * (1 - ((2 * a - 1) ** 2 + (2 * bb - 1) ** 2) / 2);
    const oc = Rr.lampOuter, ic = Rr.lampInner;
    if (RC.has('tail') && L.k >= 0.25) {   // ── bulls-eye tail lamps (owner photo 2): big round chrome-ringed lenses, red bridge housing, clear reverse strip below
      const lensO = { x: 0.638, y: 0.862, r: 0.075 }, lensI = { x: 0.452, y: 0.84, r: 0.048 };
      const bulls = ({ x, y, r }) => {
        const h = R(sgn * x, y), q = qFacing(h.n);
        if (L.k >= 0.5) {   // hero: torus bezel ring, domed lens, groove ring, hot core
          t.add(Pk.torus(r, 0.011), 'chrome', { p: at(h, 0.036), q, c: '#eef0f4' });
          t.add(Pk.sphere(14), 'gloss', { p: at(h, 0.024), s: [r * 0.97, r * 0.97, 0.03], q, c: '#b3222c' });
          t.add(Pk.torus(r * 0.6, 0.008), 'gloss', { p: at(h, 0.05), q, c: '#6d1119' });
          t.add(Pk.sphere(10), 'brakelight', { p: at(h, 0.054), s: [r * 0.5, r * 0.5, 0.014], q, c: '#ff5544' });
        } else {   // gameplay tier: three stacked flat discs give the same chrome-ring / red-lens / bright-core read for ~1/5 of the triangles
          const qd = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
          t.add(P.cyl(r * 1.06, r * 1.06, 0.012, 10), 'chrome', { p: at(h, 0.03), q: qd, c: '#eef0f4' });
          t.add(P.cyl(r * 0.84, r * 0.84, 0.012, 10), 'gloss', { p: at(h, 0.038), q: qd, c: '#b3222c' });
          t.add(P.cyl(r * 0.42, r * 0.42, 0.012, 8), 'brakelight', { p: at(h, 0.046), q: qd, c: '#ff5544' });
        }
      };
      const bridge = mir((a, bb) => quad([[lensI.x, lensI.y - lensI.r * 0.95], [lensO.x, lensO.y - lensO.r * 0.95], [lensO.x, lensO.y + lensO.r * 0.95], [lensI.x, lensI.y + lensI.r * 0.95]], a, bb));
      t.add(tub.probed(N(12), N(6), (a, bb) => { const [x, y] = bridge(a, bb); return R(x, y); }, { off: 0.02 }), 'gloss', { c: '#8f1f27', space: 'world' });
      const strip = mir((a, bb) => quad([[lensI.x - 0.04, 0.742], [lensO.x + lensO.r + 0.022, 0.742], [lensO.x + lensO.r + 0.022, lensO.y - lensO.r - 0.006], [lensI.x - 0.04, lensI.y - lensI.r - 0.006]], a, bb));
      t.add(tub.probed(N(12), 3, (a, bb) => { const [x, y] = strip(a, bb); return R(x, y); }, { off: 0.022 }), 'headlight', { c: '#ece7dc', space: 'world' });
      bulls(lensO); bulls(lensI);
      if (L.rings) {   // chrome bezel: convex hull of the two lenses + the reverse strip
        const cs = []; for (const l of [lensO, lensI]) for (let i = 0; i < 20; i++) { const th = (i / 20) * TAU; cs.push([l.x + Math.cos(th) * (l.r + 0.012), l.y + Math.sin(th) * (l.r + 0.012)]); }
        cs.push([lensI.x - 0.04, 0.738], [lensO.x + lensO.r + 0.022, 0.738]);
        const hp = hull2(cs).map(([x, y]) => at(R(sgn * x, y), 0.03)); hp.push(hp[0]);
        t.add(tb('tailbezel' + sgn, hp, 0.0085, false), 'chrome', { c: '#e2e6ec', space: 'world' });
      }
    } else {
    const outer = mir((a, bb) => { const [ra, rb] = softCorners(a, bb, 0.35); return quad([[oc.x0, oc.y0], [oc.x1, oc.y0 + 0.02], [oc.x1, oc.y1], [oc.x0, oc.y1 - 0.02]], ra, rb); });
    const inner = mir((a, bb) => { const [ra, rb] = softCorners(a, bb, 0.3); return quad([[ic.x0, ic.y0], [ic.x1 - 0.02, ic.y0 + 0.03], [ic.x1, ic.y1], [ic.x0 + 0.03, ic.y1 - 0.02]], ra, rb); });
    t.add(tub.probed(N(16), N(8), (a, bb) => { const [x, y] = outer(a, bb); return R(x, y); }, { off: dm, solid: SOLL(0.028) }), 'gloss', { c: '#8f1f27', space: 'world' });
    t.add(tub.probed(N(12), N(6), (a, bb) => { const [x, y] = inner(a, bb); return R(x, y); }, { off: dm, solid: SOLL(0.028) }), 'gloss', { c: '#8f1f27', space: 'world' });
    const rv = mir((a, bb) => quad([[oc.x0 + 0.02, oc.y0 + 0.01], [oc.x1 - 0.02, oc.y0 + 0.03], [oc.x1 - 0.02, oc.y0 + 0.085], [oc.x0 + 0.02, oc.y0 + 0.07]], a, bb));   // reverse section
    t.add(tub.probed(N(10), 3, (a, bb) => { const [x, y] = rv(a, bb); return R(x, y); }, { off: 0.03 }), 'headlight', { c: '#ece7dc', space: 'world' });
    const core = mir((a, bb) => quad([[oc.x0 + 0.03, oc.y0 + 0.1], [oc.x1 - 0.03, oc.y0 + 0.11], [oc.x1 - 0.03, oc.y1 - 0.03], [oc.x0 + 0.03, oc.y1 - 0.04]], a, bb));
    t.add(tub.probed(N(10), 4, (a, bb) => { const [x, y] = core(a, bb); return R(x, y); }, { off: 0.032 }), 'brakelight', { c: '#ff4a3c', space: 'world' });
    }
    addPart('light_brake_' + nm, t.build('light_brake_' + nm, { pivot: [sgn * 0.6, 0.84, -1.8], materials: mats }), { kind: 'lamp', hp: 40, joint: 'fixed', detachable: true, attach: 'chassis', side: sgn });
  }
}

/** windscreen + rear window (+ both quarter lights): one fixed `glass` part; door windows belong to the doors */
function buildGlass(car, { body, mats, N, addPart }) {
  const NG = NGf(N);
  const b = new KitBuilder(), gcol = { c: RC.has('glass') ? '#22344a' : '#334a63', space: 'world', g: (x, y, zz, nx, ny, nz, c, u, v, region) => { if (region) c.set('#232c38'); else c.multiplyScalar(0.85 + 0.2 * v); } };
  const top = (corners, nu, nv) => b.add(body.probed(NG(nu), NG(nv), (a, bb) => { const [x, zz] = quad(corners, a, bb); return body.top(x, zz); }, { off: RC.has('glass') ? 0.022 : 0.016, solid: SOLL(0.012) }), 'glass', gcol);
  const GX = RC.has('glass');
  if (GX) {   // wider screens (the real windscreen spans ~78% of the car at its base) in a gloss-black surround
    const frame = (corners, nu, nv) => b.add(body.probed(NG(nu), NG(nv), (a, bb) => { const [x, zz] = quad(corners, a, bb); return body.top(x, zz); }, { off: 0.017 }), 'satin', { c: '#101116', space: 'world' });
    frame([[-0.67, 0.99], [0.67, 0.99], [0.57, 0.06], [-0.57, 0.06]], 12, 8); top([[-0.61, 0.955], [0.61, 0.955], [0.51, 0.10], [-0.51, 0.10]], 12, 8);
    frame([[-0.56, -1.0], [0.56, -1.0], [0.47, -1.55], [-0.47, -1.55]], 10, 6); top([[-0.5, -1.04], [0.5, -1.04], [0.41, -1.51], [-0.41, -1.51]], 10, 6);
  } else {
    top([[-0.55, 0.93], [0.55, 0.93], [0.42, 0.12], [-0.42, 0.12]], 12, 8);          // windscreen: long shallow rake (base near the cowl)
    top([[-0.46, -1.03], [0.46, -1.03], [0.38, -1.50], [-0.38, -1.50]], 10, 6);          // rear window
  }
  for (const sgn of [1, -1]) {
    const gc = glassCurves('quarter'), gl = coons(gc.bottom, gc.top, gc.left, gc.right);
    if (GX && L.k >= 0.25) { const fc = glassFrame('quarter', 0.03, 0.03), fr = coons(fc.bottom, fc.top, fc.left, fc.right);
      b.add(body.probed(NG(8), NG(5), (a, bb) => { const [ra, rb] = softCorners(a, bb, 0.3); const [zz, y] = fr(ra, rb); return body.side(zz, y, sgn); }, { off: 0.02 }), 'satin', { c: '#101116', space: 'world' }); }
    b.add(body.probed(NG(8), NG(5), (a, bb) => { const [ra, rb] = softCorners(a, bb, 0.3); const [zz, y] = gl(ra, rb); return body.side(zz, y, sgn); }, { off: GX ? 0.026 : 0.02 }), 'glass', { c: GX ? '#22344a' : '#334a63', space: 'world' });
  }
  addPart('glass', b.build('glass', { pivot: [0, 1.3, -0.6], materials: mats, dentable: [] }), { kind: 'glass', hp: 30, joint: 'fixed', detachable: true, attach: 'chassis' });
}

/** a small body-colour lip spoiler on the boot edge (optional archetype flair, detachable) */
function buildExtras(car, { body, mats, addPart, flair }) {
  if (!flair.spoiler) return;
  const b = new KitBuilder(), zz = -1.86, y = body.top(0, zz).p.y;
  b.add(Pk.box(0.98, 0.03, 0.12, 0.014, 2), 'paint', { p: [0, y + 0.03, zz], r: [0.18, 0, 0], c: '#fff' });
  addPart('spoiler', b.build('spoiler', { pivot: [0, y + 0.03, zz], materials: mats, dentable: [] }), { kind: 'accessory', hp: 60, joint: 'fixed', detachable: true, attach: 'boot' });
}

/** the two accessories on the owner's car (film photos): a small LED lightbar on a black plate bracket, and a UHF whip aerial */
function buildAccessories(car, { tub, mats, addPart }) {
  const F = (x, y) => tub.front(x, y), T = TOY.front, dark = '#15161b';
  if (RC.has('lightbar') && L.k >= 0.25) {
    const b = new KitBuilder(), yBar = T.plate.y1 + 0.02, yLB = yBar + 0.062, hb = F(0, yBar), hl = F(0, yLB), qb = qFacing(hb.n), ql = qFacing(hl.n);
    b.add(Pk.box(0.76, 0.028, 0.032, 0.011, 1), 'satin', { p: at(hb, 0.036), q: qb, c: dark });                          // the black plate bracket bar
    for (const sx of [-0.13, 0.13]) b.add(Pk.box(0.022, 0.06, 0.03, 0.008, 1), 'satin', { p: at(F(sx, yBar + 0.03), 0.034), q: qb, c: dark });   // stand-off legs
    b.add(Pk.box(0.37, 0.056, 0.044, 0.014, 1), 'satin', { p: at(hl, 0.05), q: ql, c: dark });                          // bar housing
    b.add(Pk.box(0.335, 0.034, 0.01, 0.005, 1), 'headlight', { p: at(hl, 0.076), q: ql, c: '#f6f8ff' });                 // emissive LED lens
    if (L.k >= 0.5) for (let i = -3; i <= 3; i++) b.add(Pk.box(0.005, 0.036, 0.012, 0.002, 1), 'satin', { p: at(F(i * 0.0465, yLB), 0.079), q: ql, c: '#2a2d36' });   // LED cell ribs
    addPart('lightbar', b.build('lightbar', { pivot: [0, yLB, hl.p.z], materials: mats, dentable: [] }), { kind: 'accessory', hp: 45, joint: 'fixed', detachable: true, attach: 'bumper_front' });
  }
  if (RC.has('uhf')) {
    const ax = 0.27, ay = T.plate.y1 + 0.04, h0 = F(ax, ay), z0 = h0.p.z + 0.03, b = new KitBuilder();
    if (L.k >= 0.25) b.add(Pk.box(0.05, 0.04, 0.04, 0.012, 1), 'satin', { p: at(h0, 0.034), q: qFacing(h0.n), c: dark });                  // bracket mount
    for (let i = 0; L.k >= 0.5 && i < 3; i++) b.add(Pk.torus(0.017, 0.0048), 'metal', { p: [ax, h0.p.y + 0.045 + i * 0.022, z0], r: [Math.PI / 2, 0, 0], c: '#2a2c33' });   // spring base
    const pts = [[ax, h0.p.y + 0.1, z0], [ax, 1.3, z0 - 0.03], [ax, 2.0, z0 - 0.11]];
    b.add(tb('whip', pts, 0.0075), 'satin', { space: 'world', c: '#131418' });
    b.add(Pk.sphere(8), 'satin', { p: pts[2], s: 0.019, c: '#ececf2' });                                                   // visible tip
    addPart('antenna', b.build('antenna', { pivot: [ax, h0.p.y, z0], materials: mats, dentable: [] }), { kind: 'accessory', hp: 20, joint: 'fixed', detachable: true, attach: 'chassis' });
  }
}

export const report = (car) => countTris(car);
