// cruze.js (I, damage-ready) — the Cruz Missile rebuilt so that NO surface has to do two jobs.
//
// What changed from H (spikes/art-pipeline/H-primitive-kit/cruze.js), same recognition cues and shapes:
//   * The chassis is a husk with REAL openings: the radial body mesh is clipped exactly along each panel outline
//     (kit/shell.js clipOut), a jamb wall runs from the cut edge into the car, and every opening has something intentional
//     behind it: door recess + interior hint, engine bay, boot well, crash bar and end panel behind each bumper.
//   * Every detachable panel is a CLOSED shell (outer skin, inner skin, perimeter rim) with deliberate thickness, so a door lying
//     upside down is a door, not a sheet of paper. Inner skins have their own treatment (door card, painted underside, black plastic).
//   * Damage is a small set of designed channels (fields.js) baked as morph targets per LOD: zones damage_FL/FR/RL/RR/ROOF on
//     every attached part, and one dent_<panel> per panel. No runtime vertex editing.
//   * Physics proxies are authored boxes/cylinders in the descriptor; nothing is hulled from render vertices.
//   * Geometry goes into four material slots (kit/slots.js) and two layers (vis = intact-visible, occ = revealed by damage).
//
// Kit space: metres, +Z forward, +Y up, origin on the ground between the axles; kit +X is the car's LEFT.
// build(lod) returns a plain DESCRIPTOR (no THREE.Group, no materials): vehicle.js turns it into templates and instances.
import { THREE, P, lathe, tube, clamp, lerp, sstep, TAU } from '../H-primitive-kit/kit/kit.js';
import { Loft, LoftUnion, quad, line, polyline, coons, softCorners } from '../H-primitive-kit/kit/loft.js';
import { TOY, polyY } from '../H-primitive-kit/recog/spec.js';
import { SlotBuilder, ATLAS, triCount } from './kit/slots.js';
import { closedShell, patchGrid, clipOut, holeBoundary, jamb, growPoly, polyToHalfPlanes } from './kit/shell.js';
import { zoneFields, panelDent, ZONES } from './fields.js';
import { surfaceGrid } from '../H-primitive-kit/kit/kit.js';

export const DIM = { wheelR: 0.41, tyreW: 0.30, wheelX: 0.82, wheelZ: 1.15, wheelY: 0.41, archR: 0.49, zFront: 1.88, zRear: -2.02 };
export const MASS_KG = 1200;
export const PAINT = '#e0a520';
const GAP = 0.008;   // shut-line gap between a panel and its opening (m)

// ── LOD ladder: every primitive reads its resolution from here (no decimation pass) ─────────────────────────────────────────
// Targets (intact triangles): L0 10–15k hero · L1 3–5k gameplay-near · L2 1.2–2k gameplay-far · L3 450–800 tiny/pressure.
// What each rung drops is listed in REPORT.md §LOD. Semantics (parts, pivots, channels, colliders, anchors) are identical.
export const LODS = [
  { id: 'L0', role: 'hero', body: [42, 32], k: 0.5, min: 3, off: 0.003, tol: 0.03, intactPanels: true, intactShells: true, tube: [14, 4], ring: 18, cyl: 16, tyre: { seg: 20, prof: 'smooth' }, rim: 'full', rings: 'all', arch: true, wells: 0.55, eyes: 'full', handles: true, badge: true, interior: 'full', lens: 'dome', fog: true },
  { id: 'L1', role: 'gameplay-near', body: [18, 14], k: 0.24, min: 2, off: 0.005, tol: 0.05, intactPanels: true, intactShells: true, tube: [7, 3], ring: 10, cyl: 10, tyre: { seg: 12, prof: 'light' }, rim: 'flat', rings: 'grille', arch: true, wells: 0.3, eyes: 'disc', handles: false, badge: true, interior: 'simple', lens: 'dome', fog: true },
  { id: 'L2', role: 'gameplay-far', body: [12, 0], zAlign: 1, k: 0.12, min: 2, off: 0.024, tol: 0.08, intactPanels: false, intactShells: true, dentScale: 0.25, tube: [4, 3], ring: 6, cyl: 8, tyre: { seg: 12, prof: 'ring' }, rim: 'disc', rings: false, arch: false, wells: 0.2, eyes: 'dot', handles: false, badge: false, interior: 'box', lens: 'flat', fog: false },
  { id: 'L3', role: 'tiny', body: [10, 0], zAlign: 0, k: 0.06, min: 1, off: 0.036, tol: 0.12, intactPanels: false, intactShells: false, dentScale: 0.25, tube: [3, 3], ring: 4, cyl: 6, tyre: { seg: 8, prof: 'prism' }, rim: 'cap', rings: false, arch: false, wells: 0.12, eyes: 'none', handles: false, badge: false, interior: 'box', lens: 'flat', fog: false },
];
let L = LODS[0];
const N = (n) => Math.max(L.min, Math.round(n * L.k));

// ── body lofts (unchanged from H's shipped default) ───────────────────────────────────────────────────────────────────────
export function makeTub() {
  const S = { pT: 3.3, pB: 4.5, tumble: 0.10 };
  return new Loft({
    stations: [
      { z: DIM.zRear, w: 0.80, yb: 0.38, yt: 0.98, ...S }, { z: -1.75, w: 0.86, yb: 0.34, yt: 1.085, ...S }, { z: -1.10, w: 0.88, yb: 0.32, yt: 1.07, ...S },
      { z: -0.40, w: 0.88, yb: 0.32, yt: 1.05, ...S }, { z: 0.40, w: 0.88, yb: 0.32, yt: 1.03, ...S }, { z: 1.05, w: 0.88, yb: 0.32, yt: 1.02, ...S },
      { z: 1.35, w: 0.87, yb: 0.31, yt: 0.972, ...S }, { z: 1.62, w: 0.85, yb: 0.30, yt: 0.912, ...S }, { z: DIM.zFront, w: 0.82, yb: 0.30, yt: 0.86, ...S },
    ],
    caps: { min: 0.30, max: 0.32 }, capPow: 3.8,
    bulges: [{ z: DIM.wheelZ, sigma: 0.42, dw: 0.06, dyt: 0.07 }, { z: -DIM.wheelZ, sigma: 0.42, dw: 0.06, dyt: 0.07 }],
  });
}
export function makeCabin() {
  const st = (zz, w, yt, pT, tumble, yb = 0.88) => ({ z: zz, w, yb, yt, pT, pB: 3, tumble });
  const roof = (zz) => polyY(TOY.roof, zz);
  return new Loft({
    stations: [
      st(1.16, 0.46, 0.93, 3.6, 0.13, 0.9), st(1.06, 0.62, 1.03, 3.6, 0.13, 0.9), st(0.90, 0.72, roof(0.90), 4.4, 0.12),
      st(0.57, 0.745, roof(0.57), 5.5, 0.11), st(0.31, 0.75, roof(0.31), 6, 0.10), st(0.05, 0.75, roof(0.05), 6, 0.10), st(-0.21, 0.75, roof(-0.21), 6, 0.10),
      st(-0.47, 0.75, roof(-0.47), 6, 0.10), st(-0.73, 0.745, roof(-0.73), 6, 0.10), st(-0.99, 0.725, roof(-0.99), 5.5, 0.11), st(-1.25, 0.685, roof(-1.25), 5, 0.12),
      st(-1.51, 0.62, roof(-1.51), 4, 0.13), st(-1.72, 0.52, 1.06, 3.6, 0.13, 0.9), st(-1.86, 0.40, 0.97, 3.6, 0.13, 0.92),
    ],
  });
}

// ── panel outlines (convex polygons) + their Coons side assignment ─────────────────────────────────────────────────────────
// Door outlines are H's (measured from the daylight openings); the rear door's lower-rear corner moves 4 cm forward so it clears
// the arch. Lids are (x,z) trapezoids; bumpers are cut by planes.
export const OUTLINE = {
  front: { poly: [[0.69, 0.42], [-0.22, 0.42], [-0.25, 1.46], [0.127, 1.41], [0.35, 1.30], [0.53, 1.17], [0.69, 1.0]], sides: { bottom: [0, 1], right: [1, 2], top: [5, 4, 3, 2], left: [0, 6, 5] } },
  rear: { poly: [[-0.27, 0.42], [-0.62, 0.42], [-0.88, 1.385], [-0.75, 1.425], [-0.59, 1.455], [-0.27, 1.465]], sides: { bottom: [0, 1], right: [1, 2], top: [5, 4, 3, 2], left: [0, 5] } },
  bonnet: { poly: [[-0.70, 1.10], [0.70, 1.10], [0.62, 1.50], [-0.62, 1.50]] },
  boot: { poly: [[-0.60, -1.58], [0.60, -1.58], [0.46, -1.90], [-0.46, -1.90]] },
  bumperF: 1.52, bumperR: -1.92,
};
const coonsOf = (poly, sides) => { const pl = (ix) => (ix.length === 2 ? line(poly[ix[0]], poly[ix[1]]) : polyline(ix.map((i) => poly[i]))); return coons(pl(sides.bottom), pl(sides.top), pl(sides.left), pl(sides.right)); };
const lidCoons = (poly) => (a, b) => quad([poly[0], poly[1], poly[2], poly[3]], a, b);

// ── paint (H's function, minus the "under-panel" vertex darkening: openings are real geometry now) ─────────────────────────
const DIRT = new THREE.Color('#7b5a36'), WELL = new THREE.Color('#1c1a20');
function paintBody(c, x, y, zz, ny = 0, o = {}) {
  const coarse = clamp((L.k - 0.08) / 0.3);
  const dirt = (1 - sstep(0.32, 0.72, y)) * (0.55 + 0.45 * Math.sin(zz * 5.1 + x * 3.3) * Math.sin(zz * 2.3 - 1)) * (o.dirt ?? 0.4) * coarse;
  c.lerp(DIRT, clamp(dirt) * 0.6);
  c.multiplyScalar(1 - 0.24 * (1 - sstep(0.30, 0.95, y)) * (0.4 + 0.6 * coarse));
  if (ny < -0.2) c.multiplyScalar(0.7);
  if (o.under) for (const zw of [DIM.wheelZ, -DIM.wheelZ]) { if (Math.abs(x) < 0.55) break; const d = Math.hypot(zz - zw, y - DIM.wheelY); if (d < DIM.archR + 0.01 && y < 1.0) c.lerp(WELL, 1 - sstep(DIM.archR - 0.04, DIM.archR + 0.01, d)); }
  if (o.edge != null) c.multiplyScalar(0.84 + 0.16 * sstep(0, 0.09, o.edge));
  return c;
}
const panelPaint = (dirt) => (x, y, zz, nx, ny, nz, c, u, v) => paintBody(c, x, y, zz, ny, { dirt, edge: Math.min(u, 1 - u, v, 1 - v) });
const shade = (k) => (x, y, zz, nx, ny, nz, c) => c.multiplyScalar(k);

// ── small helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function trapezoid(hwBot, hwTop, y0, y1, cx = 0) { return (a, b) => { const s = 2 * a - 1, hw = lerp(hwBot, hwTop, b); return [cx + s * hw, lerp(y0, y1, b)]; }; }
function outlinePts(fn, n = 28) { const sp = (x) => Math.sign(x) * Math.pow(Math.abs(x), 0.25), p = []; for (let i = 0; i < n; i++) { const th = (i / n) * TAU; p.push(fn(clamp((sp(Math.cos(th)) + 1) / 2), clamp((sp(Math.sin(th)) + 1) / 2))); } return p; }
const _up = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const qFacing = (n) => { _z.copy(n).negate(); _m4.lookAt(new THREE.Vector3(), _z, Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : _up); return new THREE.Quaternion().setFromRotationMatrix(_m4); };
const qDisc = (n) => qFacing(n).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));   // cylinder axis along n
const at = (h, d = 0) => [h.p.x + h.n.x * d, h.p.y + h.n.y * d, h.p.z + h.n.z * d];
const sideName = (sgn) => (sgn > 0 ? 'L' : 'R');
const tb = (key, pts, r, caps = true) => tube(key + L.id, pts, r, L.tube[0], L.tube[1], caps, false);
export const PROBE = { miss: 0 };   // failed surface probes this build (a gate: must be 0)
const hit = (h) => { if (h) return h; PROBE.miss++; return { p: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0) }; };

// ── masses (fractions of 1200 kg; realistic detached masses: door ≈ 22 kg, wheel ≈ 29 kg) ─────────────────────────────────
const MASS = { door_L: 0.018, door_R: 0.018, door_rear_L: 0.016, door_rear_R: 0.016, bonnet: 0.015, boot: 0.014, bumper_front: 0.014, bumper_rear: 0.012, glass: 0.012,
  light_head_L: 0.002, light_head_R: 0.002, light_brake_L: 0.001, light_brake_R: 0.001, mirror_L: 0.001, mirror_R: 0.001, wheel_FL: 0.024, wheel_FR: 0.024, wheel_RL: 0.024, wheel_RR: 0.024 };
const massOf = (id) => (id === 'chassis' ? 1 - Object.values(MASS).reduce((a, b) => a + b, 0) : MASS[id]);

// ── main build ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function build({ lod = 1 } = {}) {
  const t0 = performance.now();
  L = LODS[lod]; PROBE.miss = 0;
  const tub = makeTub(), cab = makeCabin(), body = new LoftUnion(tub, cab, 0.7);
  const ctx = { tub, cab, body, parts: {}, shells: [], openings: [] };
  const zones = zoneFields(DIM);
  ctx.fields = { ...zones };
  ctx.addPart = (id, sb, pivot, meta) => {
    const layers = sb.finish(pivot);
    ctx.parts[id] = { id, pivot, layers, meta: { id, massKg: +(massOf(id) * MASS_KG).toFixed(2), channels: [...ZONES, ...(meta.dent ? ['dent_' + (meta.dentOf ?? id)] : []), ...(meta.follow ?? []).map((p) => 'dent_' + p)], ...meta } };
    return ctx.parts[id];
  };
  buildChassis(ctx);
  buildDoors(ctx);
  buildLids(ctx);
  buildBumpers(ctx);
  buildLamps(ctx);
  buildGlass(ctx);
  buildWheels(ctx);
  const anchors = { lplate_front: [0, 0.53, DIM.zFront - 0.02], lplate_rear: [0, 0.74, DIM.zRear + 0.02], cam_fp: [0, 1.26, 0.06], cam_tp_target: [0, 0.95, 0],
    com: [0, 0.6, 0], exhaust_0: [0.5, 0.4, DIM.zRear + 0.02], roof_number: [0, 1.56, -0.3] };
  for (const w of ['FL', 'FR', 'RL', 'RR']) anchors['susp_' + w] = [(w[1] === 'L' ? 1 : -1) * (DIM.wheelX - 0.06), DIM.wheelY + 0.5, (w[0] === 'F' ? 1 : -1) * DIM.wheelZ];
  return { id: 'cruz_missile', lod, role: L.role, lodSpec: L, parts: ctx.parts, fields: ctx.fields, shells: ctx.shells, openings: ctx.openings, clip: ctx.clip, skin: ctx.skin, anchors, dim: DIM, massKg: MASS_KG,
    chassisColliders: CHASSIS_COLLIDERS, probeMisses: PROBE.miss, buildMs: +(performance.now() - t0).toFixed(1) };
}

// Authored chassis proxies (kit space). Stage variants shorten the nose/tail box and lower the cabin box as zones accumulate; the
// sim swaps them only at stage boundaries (never per frame, never from render vertices).
export const CHASSIS_COLLIDERS = [
  { id: 'col_body', shape: 'cuboid', half: [0.86, 0.27, 1.12], offset: [0, 0.62, -0.08] },
  { id: 'col_nose', shape: 'cuboid', half: [0.80, 0.24, 0.30], offset: [0, 0.60, 1.52], stages: { zone: ['damage_FL', 'damage_FR'], shrinkZ: [0, 0.10, 0.2] } },
  { id: 'col_tail', shape: 'cuboid', half: [0.78, 0.26, 0.30], offset: [0, 0.66, -1.66], stages: { zone: ['damage_RL', 'damage_RR'], shrinkZ: [0, 0.10, 0.2] } },
  { id: 'col_cabin', shape: 'cuboid', half: [0.66, 0.22, 0.85], offset: [0, 1.20, -0.35], stages: { zone: ['damage_ROOF'], lowerY: [0, 0.07, 0.14] } },
];

// ── chassis husk ────────────────────────────────────────────────────────────────────────────────────────────────────────
function sideDomain(body, sgn) {
  // side-facing triangles on this flank; above the belt only the greenhouse side (|x| > 0.6), never the windscreen/roof (|x| < 0.56)
  return (c, n) => sgn * c.x > (c.y > 1.0 ? 0.6 : 0.3) && sgn * n.x > 0.0;
}
function topDomain(body) {
  // top-facing triangles above the shoulder (nothing else faces up under a lid outline; a first-hit test fails on coarse chords)
  return (c, n) => c.y > 0.75 && n.y > 0.3;
}
// Coarse LODs: the radial body with its z-stations ON every cut line (doors, lids, bumpers), so cuts follow grid lines instead of
// slicing long triangles that span the windscreen and the door (the source of jamb "wires" on a 9×6 grid).
const CUT_Z = [DIM.zRear, -1.97, -1.92, -1.90, -1.58, -1.25, -0.88, -0.62, -0.27, -0.22, 0.2, 0.69, 0.92, 1.10, 1.30, 1.50, 1.52, 1.70, DIM.zFront];
function radialZ(body, nu, extra = 0) {
  let zs = [...CUT_Z]; for (let k = 0; k < extra; k++) { const n = []; for (let i = 0; i < zs.length - 1; i++) { n.push(zs[i]); if (zs[i + 1] - zs[i] > 0.3) n.push((zs[i] + zs[i + 1]) / 2); } n.push(zs[zs.length - 1]); zs = n; }
  const m = zs.length - 1, nrm = new THREE.Vector3(), zAt = (v) => { const f = clamp(v) * m, i = Math.min(m - 1, Math.floor(f)); return clamp(lerp(zs[i], zs[i + 1], f - i), body.zMin + 1e-3, body.zMax - 1e-3); };
  const angle = (u) => u * TAU + 0.6 * 0.5 * Math.sin(2 * TAU * u) / 2;
  return surfaceGrid(nu, m, (u, v, out) => {
    const z = zAt(v), y0 = body.originY(z), th = angle(u), dx = Math.sin(th), dy = -Math.cos(th);
    if (body.F(0, y0, z) >= 0) { out[0] = 0; out[1] = y0; out[2] = z; return; }
    let prev = 0, h = -1; for (let t = 0.03; t < 2.6; t += 0.03) { if (body.F(dx * t, y0 + dy * t, z) > 0) { h = t; break; } prev = t; }
    if (h < 0) { out[0] = 0; out[1] = y0; out[2] = z; return; }
    let a = prev, b = h; for (let i = 0; i < 26; i++) { const mm = (a + b) / 2; if (body.F(dx * mm, y0 + dy * mm, z) > 0) b = mm; else a = mm; }
    const t = (a + b) / 2; out[0] = dx * t; out[1] = y0 + dy * t; out[2] = z;
  }, { inside: (u, v, o) => { const z = zAt(v); o[0] = 0; o[1] = body.originY(z); o[2] = z; }, normal: (u, v, p, out) => { body.normalAt(p[0], p[1], p[2], nrm); out[0] = nrm.x; out[1] = nrm.y; out[2] = nrm.z; } });
}
function regions(body) {
  const R = [];
  for (const which of ['front', 'rear']) for (const sgn of [1, -1]) R.push({ key: `door_${which}_${sgn}`, proj: (p) => [p.z, p.y], poly: OUTLINE[which].poly, domain: sideDomain(body, sgn) });
  for (const which of ['bonnet', 'boot']) R.push({ key: which, proj: (p) => [p.x, p.z], poly: OUTLINE[which].poly, domain: topDomain(body) });
  R.push({ key: 'bumperF', proj: (p) => [p.z, 0], halfPlanes: [[1, 0, OUTLINE.bumperF]], domain: () => true });
  R.push({ key: 'bumperR', proj: (p) => [-p.z, 0], halfPlanes: [[1, 0, -OUTLINE.bumperR]], domain: () => true });
  return R;
}
// a hole boundary is any boundary edge inside (or on) the outline: also catches edges left by triangles the domain test kept
const inPoly = (poly, s, t, g = 2e-3) => { const hp = polyToHalfPlanes(poly); return hp.every(([ax, ay, c]) => ax * s + ay * t >= c - g); };
const onPolyEdge = (poly, s, t, tol = 1.5e-3) => {
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], ex = q[0] - p[0], ey = q[1] - p[1], L2 = ex * ex + ey * ey;
    const u = clamp(((s - p[0]) * ex + (t - p[1]) * ey) / L2), dx = p[0] + ex * u - s, dy = p[1] + ey * u - t;
    if (dx * dx + dy * dy < tol * tol) return true;
  }
  return false;
};

function buildChassis(ctx) {
  const { tub, body } = ctx, sb = new SlotBuilder(), REG = regions(body);
  // 1) body skin + arch backdrops + arch beads, all clipped by the same regions so nothing floats over an opening
  if (!L.intactPanels) return buildChassisCoarse(ctx, sb);
  const whole = body.radial({ nu: L.body[0], nv: L.body[1], inset: 0.0 }), skin = clipOut(whole, REG);
  ctx.clip = skin.userData.clip; ctx.skin = skin;
  const bodyPaint = (x, y, zz, nx, ny, nz, c) => paintBody(c, x, y, zz, ny, { under: true, dirt: y > 1.0 ? 0.12 : 0.45 });
  sb.add(skin, 'paint', { layer: 'panel', c: '#fff', space: 'world', g: bodyPaint });
  for (const sgn of [1, -1]) for (const zw of [DIM.wheelZ, -DIM.wheelZ]) {
    const Ra = DIM.archR, wy = DIM.wheelY;
    const polar = (r0, r1) => (a, bb) => { const ph = lerp(-0.22, Math.PI + 0.22, a), r = lerp(r0, r1, bb); return tub.side(zw + r * Math.cos(ph), Math.min(0.985, wy + r * Math.sin(ph)), sgn); };
    const wellG = tub.probed(Math.max(4, Math.round(24 * L.wells)), Math.max(1, Math.round(5 * L.wells)), polar(0.0, Ra), { off: 0.006 });
    sb.add(clipOut(wellG, REG), 'matte', { layer: 'panel', c: '#1c1a20', space: 'world' });
    if (L.arch) {
      const nn = Math.max(6, Math.round(22 * Math.sqrt(L.k))), pts = [];
      for (let i = 0; i <= nn; i++) { const ph = lerp(-0.22, Math.PI + 0.22, i / nn), r = Ra + 0.02; pts.push(at(tub.side(zw + r * Math.cos(ph), Math.min(0.985, wy + r * Math.sin(ph)), sgn), 0.006)); }
      sb.add(clipOut(tb(`arch${sgn}${zw}`, pts, 0.028), REG), 'satin', { layer: 'panel', c: '#3a3941', space: 'world' });
    }
    // hub + strut: only ever seen when the wheel is gone
    sb.add(P.cyl(0.13, 0.13, 0.06, L.cyl), 'metal', { layer: 'occ', p: [sgn * (DIM.wheelX - 0.17), wy, zw], r: [0, 0, Math.PI / 2], c: '#6a6e78' });
    sb.add(P.cyl(0.035, 0.035, 0.22, Math.min(8, L.cyl)), 'metal', { layer: 'occ', p: [sgn * (DIM.wheelX - 0.11), wy, zw], r: [0, 0, Math.PI / 2], c: '#3d4048' });
    sb.add(P.cyl(0.03, 0.03, 0.42, Math.min(8, L.cyl)), 'metal', { layer: 'occ', p: [sgn * (DIM.wheelX - 0.16), wy + 0.27, zw], c: '#3d4048' });
  }
  // 2) openings: jamb wall from the cut edge + a cheap dark back (both 'vis': they show through the shut-line gap) + contents ('occ')
  const jambPaint = (x, y, zz, nx, ny, nz, c) => { if (ny > 0.6 && y < 0.7) c.set('#2e2a33'); else c.multiplyScalar(0.62 + 0.25 * sstep(0.3, 1.2, y)); };   // body-colour jambs, dark carpet sills
  const DEPTH = { door: 0.22, bonnet: 0.21, boot: 0.22, bumper: 0.10, bumperRear: 0.045 };
  for (const which of ['front', 'rear']) for (const sgn of [1, -1]) {
    // door cavity: walls run straight in (−x) from the cut edge to a flat far wall at |x| = XB; sill becomes a floor, the roof rail a ceiling
    const O = OUTLINE[which], edges = holeBoundary(skin, { side: (p) => sgn * p.x > 0.3, proj: (p) => [p.z, p.y], hp: polyToHalfPlanes(O.poly) }), XB = which === 'front' ? 0.5 : 0.505;
    const cz = O.poly.reduce((a, p) => a + p[0], 0) / O.poly.length, cy = O.poly.reduce((a, p) => a + p[1], 0) / O.poly.length;
    sb.add(jamb(edges, (p) => new THREE.Vector3(sgn * XB, p.y, p.z), () => new THREE.Vector3(sgn * (XB + 0.1), cy, cz)), 'paint', { layer: 'panel', c: '#fff', space: 'world', g: jambPaint });
    const grown = growPoly(O.poly, 0.003), skinC = coonsOf(grown, O.sides);
    const back = surfaceGrid(Math.max(1, N(6)), Math.max(1, N(6)), (a, b, o) => { const [zz, y] = skinC(a, b); o[0] = sgn * XB; o[1] = y; o[2] = zz; }, { inside: (a, b, o) => { o[0] = 0; o[1] = cy; o[2] = cz; } });
    sb.add(back, 'matte', { layer: 'panel', c: '#2b2830', space: 'world', g: (x, y, zz, nx, ny, nz, c) => c.multiplyScalar(0.55 + 0.6 * sstep(0.45, 1.3, y)) });
    cabinHints(sb, sgn, which, XB);
    ctx.openings.push({ id: `${which}_${sideName(sgn)}`, edges: edges.length });
  }
  for (const which of ['bonnet', 'boot']) {
    // bay: walls straight down (−y) from the cut edge to a flat floor
    const O = OUTLINE[which], edges = holeBoundary(skin, { side: (p) => p.y > 0.75, proj: (p) => [p.x, p.z], hp: polyToHalfPlanes(O.poly) }), D = DEPTH[which];
    // floor from the LOWEST edge of the opening (the lid crowns: a floor set from its centre lets contents poke out at the corners)
    const cz = O.poly.reduce((a, p) => a + p[1], 0) / 4, yEdge = Math.min(...O.poly.map(([x, z]) => hit(body.top(x, z)).p.y)), yf = yEdge - D * 0.8, centre = new THREE.Vector3(0, yf, cz);
    sb.add(jamb(edges, (p) => new THREE.Vector3(p.x, yf, p.z), () => centre.clone().setY(yf + 0.1)), 'paint', { layer: 'panel', c: '#fff', space: 'world', g: jambPaint });
    const grown = growPoly(O.poly, 0.003), q = lidCoons(grown);
    sb.add(surfaceGrid(Math.max(1, N(8)), Math.max(1, N(5)), (a, b, o) => { const [x, zz] = q(a, b); o[0] = x; o[1] = yf; o[2] = zz; }, { inside: (a, b, o) => { o[0] = 0; o[1] = yf - 1; o[2] = cz; } }), 'matte', { layer: 'panel', c: '#24222a', space: 'world' });
    if (which === 'bonnet') engineBay(sb, centre); else bootWell(sb, centre);
    ctx.openings.push({ id: which, edges: edges.length });
  }
  for (const [key, zc, sz] of [['bumperF', OUTLINE.bumperF, 1], ['bumperR', OUTLINE.bumperR, -1]]) {
    // recess: walls run straight back (along the axis, 5 cm inside the skin, clear of the lid above) 10 cm into the body, closed by a dark end panel
    const edges = holeBoundary(skin, (p) => Math.abs(p.z - zc) < 1.5e-3), ax = tub.axis(zc), D = sz > 0 ? DEPTH.bumper : DEPTH.bumperRear;   // the tail is short: a deep recess would run under the boot well
    sb.add(jamb(edges, (p, n) => new THREE.Vector3(p.x - n.x * 0.05, p.y - n.y * 0.05, zc - sz * D), () => new THREE.Vector3(0, ax[1], zc + sz * 0.3)), 'paint', { layer: 'panel', c: '#fff', space: 'world', g: jambPaint });
    // dark end panel just behind the cut plane: a filled superellipse section of the tub, scaled to tuck under the jamb lip
    const ze = zc - sz * D, Pp = tub.params(ze), nu = Math.max(8, N(32)), nv = Math.max(1, N(3));
    const end = surfaceGrid(nu, nv, (a, b, o) => { const s = tub.section(ze, a); const k = lerp(0.0, 1.0, b); o[0] = s.x * k; o[1] = Pp.yc + (s.y - Pp.yc) * k; o[2] = ze; }, { inside: (a, b, o) => { o[0] = 0; o[1] = Pp.yc; o[2] = ze - sz; } });
    sb.add(end, 'matte', { layer: 'panel', c: '#1f1d23', space: 'world', g: (x, y, zz, nx, ny, nz, c) => c.multiplyScalar(0.8 + 0.4 * sstep(0.3, 0.9, y)) });
    crashBar(sb, zc, sz, D);
    ctx.openings.push({ id: key, edges: edges.length });
  }
  ctx.addPart('chassis', sb, [0, 0, 0], { kind: 'core', hp: 600, joint: 'fixed', detachable: false });
  ctx.parts.chassis.meta.collider = null;   // the chassis uses CHASSIS_COLLIDERS (compound)
}
// Coarse LODs (L2/L3, ≤ 190 px): a cut-and-jamb opening is below what the camera can resolve, and coarse triangles straddling cut
// lines make shards. So the chassis is the UNCUT body (z-stations on the cut lines) and every opening is a dark patch on the SAME
// grid as its panel, tucked inside the panel's thickness ('occ': hidden until the panel leaves). Contents: one crude box each.
function buildChassisCoarse(ctx, sb) {
  const { tub, body } = ctx, whole = radialZ(body, L.body[0], L.zAlign), dark = { c: '#1d1b21', space: 'world' };
  sb.add(whole, 'paint', { c: '#fff', space: 'world', g: (x, y, zz, nx, ny, nz, c) => paintBody(c, x, y, zz, ny, { under: true, dirt: 0.3 }) });
  for (const sgn of [1, -1]) for (const zw of [DIM.wheelZ, -DIM.wheelZ]) {
    const Ra = DIM.archR, wy = DIM.wheelY, polar = (a, bb) => { const ph = lerp(-0.22, Math.PI + 0.22, a), r = lerp(0, Ra, bb); return tub.side(zw + r * Math.cos(ph), Math.min(0.985, wy + r * Math.sin(ph)), sgn); };
    sb.add(tub.probed(Math.max(4, Math.round(24 * L.wells)), 1, polar, { off: 0.006 }), 'matte', { c: '#1c1a20', space: 'world' });
    sb.add(P.flat(0.06, 0.2, 0.2), 'metal', { layer: 'occ', p: [sgn * (DIM.wheelX - 0.17), wy, zw], c: '#55595f' });
  }
  ctx.coarseOpenings = {};
  for (const which of ['front', 'rear']) for (const sgn of [1, -1]) {
    const O = OUTLINE[which], inner = growPoly(O.poly, -GAP), skin = coonsOf(inner, O.sides), g = doorGrid();
    sb.add(patchGrid((a, b) => { const [zz, y] = skin(a, b); return hit(body.side(zz, y, sgn)); }, { nu: g[0], nv: g[1], off: L.off * 0.7 }), 'matte', { layer: 'occ', ...dark });
    ctx.openings.push({ id: `${which}_${sideName(sgn)}`, coarse: true });
  }
  for (const which of ['bonnet', 'boot']) {
    const q = lidCoons(growPoly(OUTLINE[which].poly, -GAP)), g = lidGrid();
    sb.add(patchGrid((a, b) => { const [x, zz] = q(a, b); return hit(body.top(x, zz)); }, { nu: g[0], nv: g[1], off: L.off * 0.7 }), 'matte', { layer: 'occ', ...dark });
    ctx.openings.push({ id: which, coarse: true });
  }
  for (const [zc, sz] of [[OUTLINE.bumperF + GAP, 1], [OUTLINE.bumperR - GAP, -1]]) {
    const v0 = sz > 0 ? tub.vOfZ(zc) : 0, v1 = sz > 0 ? 1 : tub.vOfZ(zc), g = bumperGrid();
    sb.add(tub.patch({ v0, v1, nu: g[0], nv: g[1], off: L.off * 0.7 }), 'matte', { layer: 'occ', ...dark });
    sb.add(P.flat(1.2, 0.12, 0.08), 'metal', { layer: 'occ', p: [0, 0.56, zc + sz * 0.1], c: '#55595f' });
    ctx.openings.push({ id: sz > 0 ? 'bumperF' : 'bumperR', coarse: true });
  }
  ctx.addPart('chassis', sb, [0, 0, 0], { kind: 'core', hp: 600, joint: 'fixed', detachable: false, collider: null });
}
const doorGrid = () => [Math.max(2, N(16)), Math.max(3, N(18))];
const lidGrid = () => [N(22), N(12)];
const bumperGrid = () => [Math.max(8, N(60)), Math.max(3, N(16))];

// contents of openings: a handful of chunky primitives, deliberately cheap ('occ': never drawn on the intact car)
function cabinHints(sb, sgn, which, XB) {
  const zc = which === 'front' ? 0.2 : -0.48, x = sgn * (XB + 0.08);   // seat side 4–12 cm proud of the far wall
  if (L.interior === 'box') { sb.add(P.flat(0.06, 0.42, 0.5), 'matte', { layer: 'occ', p: [x, 0.78, zc], c: '#3b3742' }); return; }
  // seat: cushion + back, plus a door-card-height armrest strip on the far side reads as "cabin"
  sb.add(P.box(0.08, 0.16, 0.5, 0.03, L.interior === 'full' ? 2 : 1), 'matte', { layer: 'occ', p: [x, 0.62, zc], c: '#3b3742' });
  sb.add(P.box(0.08, 0.5, 0.14, 0.03, L.interior === 'full' ? 2 : 1), 'matte', { layer: 'occ', p: [x, 0.9, zc - 0.2], r: [-0.18, 0, 0], c: '#45404d' });
  if (which === 'front' && L.interior === 'full') sb.add(P.torus(0.15, 0.022, 16, 6), 'satin', { layer: 'occ', p: [x - sgn * 0.02, 1.0, zc + 0.28], r: [0, Math.PI / 2, 0.35], c: '#1d1c22' });
}
function engineBay(sb, c) {   // everything ≤ 13 cm above the floor; floor is ≥ 17 cm below the lowest bonnet edge
  const y = c.y, full = L.interior === 'full';
  sb.add(P.box(0.62, 0.1, 0.3, 0.03, full ? 2 : 1), 'metal', { layer: 'occ', p: [0.05, y + 0.05, c.z - 0.02], c: '#5c606b' });                 // block
  sb.add(P.box(0.5, 0.04, 0.22, 0.015, 1), 'satin', { layer: 'occ', p: [0.05, y + 0.115, c.z - 0.02], c: '#9a2b2b' });                     // rocker cover
  sb.add(P.cyl(0.06, 0.06, 0.22, L.cyl), 'satin', { layer: 'occ', p: [-0.38, y + 0.07, c.z - 0.05], r: [Math.PI / 2, 0, 0], c: '#202026' }); // airbox
  sb.add(P.box(0.18, 0.12, 0.13, 0.02, 1), 'satin', { layer: 'occ', p: [0.4, y + 0.06, c.z - 0.12], c: '#1b1b20' });                       // battery
  sb.add(P.flat(1.0, 0.1, 0.04), 'atlas', { layer: 'occ', p: [0, y + 0.05, c.z + 0.15], c: '#fff', uvRect: ATLAS.HEX });                    // radiator
  for (const s of [1, -1]) sb.add(P.cyl(0.06, 0.07, 0.08, Math.min(8, L.cyl)), 'paint', { layer: 'occ', p: [s * 0.52, y + 0.04, c.z - 0.12], c: '#9c8a6a' }); // strut towers
}
function bootWell(sb, c) {
  sb.add(P.torus(0.105, 0.045, Math.max(6, L.ring), 4), 'rubber', { layer: 'occ', p: [-0.2, c.y + 0.05, c.z], r: [Math.PI / 2, 0, 0], c: '#1d1d22' });   // spare: fits the 32 cm well
  sb.add(P.box(0.32, 0.12, 0.2, 0.02, 1), 'matte', { layer: 'occ', p: [0.28, c.y + 0.06, c.z + 0.02], r: [0, 0.3, 0], c: '#c9a46a' });       // a cardboard box
}
function crashBar(sb, zc, sz, D) {   // inside the recess, behind the cut plane: the bumper (any dent) can never reach it
  const y = 0.56, depth = Math.min(0.06, D * 0.65), zb = zc - sz * (0.005 + depth / 2);
  sb.add(P.box(1.24, 0.12, depth, Math.min(0.02, depth / 2 - 1e-3), 1), 'metal', { layer: 'occ', p: [0, y, zb], c: '#55595f' });
  for (const s of [1, -1]) sb.add(P.flat(0.08, 0.09, D - depth - 0.006), 'metal', { layer: 'occ', p: [s * 0.45, y, zc - sz * (depth + 0.005 + (D - depth - 0.006) / 2)], c: '#3a3d43' });
}

// ── doors: closed shells cut from the blended body + glass both sides + handle + mirror ─────────────────────────────────────
function buildDoors(ctx) {
  const { body } = ctx;
  for (const [which, prefix, zHinge] of [['front', 'door_', 0.69], ['rear', 'door_rear_', -0.27]]) for (const sgn of [1, -1]) {
    const id = prefix + sideName(sgn), O = OUTLINE[which], sb = new SlotBuilder();
    const inner = growPoly(O.poly, -GAP), skin = coonsOf(inner, O.sides), hinge = [sgn * 0.84, 0.98, zHinge];
    const sample = (a, b) => { const [zz, y] = skin(a, b); return hit(body.side(zz, y, sgn)); };
    const THICK = 0.02, [dnu, dnv] = doorGrid(), sh = closedShell(sample, { nu: dnu, nv: dnv, off: L.off, thick: THICK });
    ctx.shells.push({ part: id, ...sh.info, outer: sh.outer, inner: sh.inner, rim: sh.rim });
    sb.add(sh.outer, 'paint', { layer: 'panel', c: '#fff', space: 'world', g: panelPaint(0.4) });
    sb.add(sh.rim, 'paint', { layer: 'panel', c: '#fff', space: 'world', g: shade(0.7) });
    sb.add(sh.inner, 'matte', { layer: 'occ', c: '#3d3944', space: 'world', g: (x, y, zz, nx, ny, nz, c) => { c.multiplyScalar(0.8 + 0.3 * sstep(0.5, 1.2, y)); if (y > 0.98) c.set('#2a3442'); } });  // door card; window band reads as glass from inside
    // window glass: measured polygon (Coons, soft corners) as an inlay on the outer skin AND on the inner skin
    const gp = TOY.glass[which], gl = coons(polyline([gp[0], gp[1], gp[2], gp[3]]), polyline([gp[7], gp[6], gp[5], gp[4]]), line(gp[7], gp[0]), line(gp[4], gp[3]));
    const gs = (a, b) => { const [ra, rb] = softCorners(a, b, 0.22); const [zz, y] = gl(ra, rb); return hit(body.side(zz, y, sgn)); };
    const gn = Math.max(2, N(12)), gv = Math.max(1, N(7));
    sb.add(patchGrid(gs, { nu: gn, nv: gv, off: L.off + 0.004 }), 'glass', { c: '#334a63', space: 'world' });
    sb.add(patchGrid(gs, { nu: gn, nv: gv, off: L.off - THICK - 0.004, facing: 'in' }), 'glass', { layer: 'occ', c: '#2b3d52', space: 'world' });
    if (L.handles) { const hh = hit(body.side(lerp(inner[0][0], inner[1][0], 0.78), 0.86, sgn)); sb.add(P.box(0.03, 0.026, 0.13, 0.012, 1), 'chrome', { p: at(hh, L.off + 0.016), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(sgn, 0, 0), hh.n), c: '#e8ebf1' }); }
    // authored debris collider: a thin box over the door's outline (part-local after the pivot shift)
    const zs = inner.map((p) => p[0]), ys = inner.map((p) => p[1]), zc = (Math.min(...zs) + Math.max(...zs)) / 2, yc = (Math.min(...ys) + Math.max(...ys)) / 2, xc = hit(body.side(zc, yc, sgn)).p.x - sgn * 0.02;
    ctx.fields['dent_' + id] = panelDent('door', { sgn, zc: zc + (which === 'front' ? -0.05 : 0.02), yc: 0.78 });
    ctx.addPart(id, sb, hinge, { kind: 'door', hp: 100, joint: 'hinge', detachable: true, attach: 'chassis', side: sgn, dent: true,
      hinge: { point: hinge, axis: [0, 1, 0], sign: sgn, max: 1.15 }, thick: THICK, cavityDepth: 0.22,
      collider: { shape: 'cuboid', half: [0.045, (Math.max(...ys) - Math.min(...ys)) / 2, (Math.max(...zs) - Math.min(...zs)) / 2], offset: [xc - hinge[0], yc - hinge[1], zc - hinge[2]] } });
    if (which === 'front') {   // mirror rides on the front door (contract: child of the door)
      const mb = new SlotBuilder(), base = body.side(0.56, 1.05, sgn), px = Math.abs(base.p.x), mz = 0.6, k = L.k >= 0.2;
      mb.add(k ? P.box(0.13, 0.028, 0.05, 0.012, 1) : P.flat(0.13, 0.028, 0.05), 'satin', { p: [sgn * (px + 0.055), 1.04, mz], c: '#2c2c33' });
      mb.add(k ? P.sphere(L.k >= 0.4 ? 12 : 6) : P.flat(1.6, 1.6, 1.6), 'paint', { p: [sgn * (px + 0.12), 1.09, mz - 0.01], s: [0.045, 0.07, 0.095], c: '#fff' });
      if (L.k >= 0.4) mb.add(P.cyl(0.062, 0.062, 0.008, 16), 'metal', { p: [sgn * (px + 0.122), 1.09, mz - 0.1], r: [0, 0, Math.PI / 2], c: '#b9c3d2' });
      const mp = [sgn * (px + 0.02), 1.04, mz];
      ctx.addPart('mirror_' + sideName(sgn), mb, mp, { kind: 'accessory', hp: 40, joint: 'fixed', detachable: true, attach: id, parentPart: id, side: sgn, follow: [id],
        collider: { shape: 'cuboid', half: [0.07, 0.05, 0.06], offset: [sgn * 0.09, 0.04, -0.01] } });
    }
  }
}

// ── bonnet + boot: closed shells, painted underside, hood creases as an offset function (no extra geometry) ─────────────────
function buildLids(ctx) {
  const { body } = ctx;
  for (const [id, sz, sign] of [['bonnet', 1, -1], ['boot', -1, 1]]) {
    const O = OUTLINE[id], inner = growPoly(O.poly, -GAP), q = lidCoons(inner), sb = new SlotBuilder();
    const z0 = inner[0][1], z1 = inner[2][1], pivot = [0, hit(body.top(0, z0)).p.y + 0.01, z0], THICK = 0.022;
    const crease = id === 'bonnet' ? (a, b) => L.off + 0.006 * (Math.exp(-(((a - 0.2) / 0.05) ** 2)) + Math.exp(-(((a - 0.8) / 0.05) ** 2))) * sstep(0, 0.25, b) : null;
    const [lnu, lnv] = lidGrid(), sh = closedShell((a, b) => { const [x, zz] = q(a, b); return hit(body.top(x, zz)); }, { nu: lnu, nv: lnv, off: L.off, offFn: crease, thick: THICK });
    ctx.shells.push({ part: id, ...sh.info, outer: sh.outer, inner: sh.inner, rim: sh.rim });
    sb.add(sh.outer, 'paint', { layer: 'panel', c: '#fff', space: 'world', g: panelPaint(id === 'bonnet' ? 0.12 : 0.2) });
    sb.add(sh.rim, 'paint', { layer: 'panel', c: '#fff', space: 'world', g: shade(0.7) });
    sb.add(sh.inner, 'paintInner', { layer: 'occ', c: '#fff', space: 'world', g: (x, y, zz, nx, ny, nz, c, u, v) => { c.multiplyScalar(0.55); if (((u * 6) % 1 < 0.12 || (v * 4) % 1 < 0.12) && L.k >= 0.2) c.multiplyScalar(0.75); } });   // painted underside + bracing
    ctx.fields['dent_' + id] = panelDent(id, { z0: Math.min(z0, z1), z1: Math.max(z0, z1), sz });
    const zs = inner.map((p) => p[1]), xs = inner.map((p) => p[0]), zc = (z0 + z1) / 2, yc = hit(body.top(0, zc)).p.y - 0.03;
    ctx.addPart(id, sb, pivot, { kind: 'lid', hp: 100, joint: 'hinge', detachable: true, attach: 'chassis', dent: true, thick: THICK, cavityDepth: id === 'bonnet' ? 0.21 : 0.22,
      hinge: { point: pivot, axis: [1, 0, 0], sign, max: 1.0 },
      collider: { shape: 'cuboid', half: [(Math.max(...xs) - Math.min(...xs)) / 2, 0.05, (Math.max(...zs) - Math.min(...zs)) / 2], offset: [0, yc - pivot[1], zc - pivot[2]], rotX: sz * 0.12 } });
  }
}

// ── bumpers: closed shells over the end caps, fascia cues as decals on the outer skin, lamp sockets underneath ───────────────
function buildBumpers(ctx) {
  const { tub } = ctx, T = TOY.front, Rr = TOY.rear, F = (x, y) => tub.front(x, y), R = (x, y) => tub.rear(x, y);
  const bo = L.off + 0.002, THICK = 0.04;
  for (const [id, zc, sz] of [['bumper_front', OUTLINE.bumperF + GAP, 1], ['bumper_rear', OUTLINE.bumperR - GAP, -1]]) {
    const sb = new SlotBuilder(), v0 = sz > 0 ? tub.vOfZ(zc) : 0, v1 = sz > 0 ? 1 : tub.vOfZ(zc), [nu, nv] = bumperGrid();
    const n = new THREE.Vector3();
    const sample = (a, b) => { const o = [0, 0, 0]; tub.point(a, lerp(v0, v1, b), o); const p = new THREE.Vector3(...o); tub.normalAt(p.x, p.y, p.z, n); return { p, n: n.clone() }; };
    // at the open rim the thickness runs parallel to the cut plane, so the inner skin never crosses into the chassis
    const rimW = (b) => (sz > 0 ? 1 - sstep(0, 0.35, b) : sstep(0.65, 1, b));
    const sh = closedShell(sample, { nu, nv, off: bo, thick: THICK, periodicU: true, dirFn: (a, b, n) => { const w = rimW(b); return new THREE.Vector3(n.x, n.y, n.z * (1 - w)).normalize(); } });
    ctx.shells.push({ part: id, ...sh.info, outer: sh.outer, inner: sh.inner, rim: sh.rim });
    sb.add(sh.outer, 'paint', { layer: 'panel', c: '#fff', space: 'world', g: panelPaint(0.4) });
    sb.add(sh.rim, 'matte', { layer: 'panel', c: '#26242b', space: 'world' });
    sb.add(sh.inner, 'matte', { layer: 'occ', c: '#232228', space: 'world' });   // black plastic inside
    const plate = (fn, kind, c, d, o = {}, nuP = 14, nvP = 6, surf = sz > 0 ? F : R) => sb.add(tub.probed(Math.max(1, N(nuP)), Math.max(1, N(nvP)), (a, b) => { const [x, y] = fn(a, b); return surf(x, y); }, { off: bo + d }), kind, { c, space: 'world', ...o });
    const ring = (fn, r, d, tier) => { if (!L.rings || (L.rings === 'grille' && tier !== 'grille')) return; const pts = outlinePts(fn, L.ring).map(([x, y]) => at(F(x, y), bo + d)); pts.push(pts[0]); sb.add(tb('ring' + r + d + tier + fn(0.3, 0.3)[0], pts, r, false), 'chrome', { c: '#e8ebf1', space: 'world' }); };
    if (sz > 0) {
      plate(trapezoid(T.grille.hwBot, T.grille.hwTop, T.grille.yBot, T.grille.yTop), 'atlas', '#fff', 0.006, { uvRect: ATLAS.HEX }, 18, 8);
      ring(trapezoid(T.grille.hwBot + 0.014, T.grille.hwTop + 0.014, T.grille.yBot - 0.012, T.grille.yTop + 0.012), 0.01, 0.01, 'grille');
      plate(trapezoid(T.bar.hw, T.bar.hw, T.bar.y0, T.bar.y1), 'atlas', '#fff', 0.006, { uvRect: ATLAS.SLAT }, 14, 2);
      ring(trapezoid(T.bar.hw + 0.012, T.bar.hw + 0.012, T.bar.y0 - 0.01, T.bar.y1 + 0.01), 0.006, 0.009, 'grille');
      plate(trapezoid(T.intake.hwBot, T.intake.hwTop, T.intake.yBot, T.intake.yTop), 'atlas', '#fff', 0.006, { uvRect: ATLAS.HEX }, 14, 4);
      if (L.badge) { const bh = F(0, (T.grille.yTop + T.bar.y0) / 2 + 0.005); sb.add(P.cyl(0.05, 0.054, 0.018, L.cyl), 'chrome', { p: at(bh, bo + 0.016), q: qDisc(bh.n), c: '#e8ebf1' }); sb.add(P.cyl(0.034, 0.034, 0.02, L.cyl), 'gloss', { p: at(bh, bo + 0.022), q: qDisc(bh.n), c: '#c9a03a' }); }
      for (const s of [1, -1]) {
        const fg = (a, b) => { const [x, y] = quad([[T.fog.x0 + 0.05, T.fog.y0], [T.fog.x1 - 0.01, T.fog.y0 + 0.01], [T.fog.x1, T.fog.y1], [T.fog.x0, T.fog.y1]], a, b); return [s * x, y]; };
        plate(fg, 'matte', '#26252c', 0.004, {}, 8, 3);
        if (L.fog) { const h = F(s * (T.fog.x0 + T.fog.x1) / 2, (T.fog.y0 + T.fog.y1) / 2 - 0.005); sb.add(L.k >= 0.4 ? P.sphere(10) : P.flat(1.4, 1.4, 1.4), 'headlight', { p: at(h, bo + 0.012), s: [0.045, 0.028, 0.012], q: qFacing(h.n), c: '#e8e2c8' }); }
        // lamp socket: what is left on the bumper when the headlamp is knocked off
        const lens = (a, b) => { const [ra, rb] = softCorners(a, b, 0.3); const [x, y] = quad(T.lamp, ra, rb); return [x * s, y]; };
        plate(lens, 'matte', '#1a191e', 0.0015, { layer: 'occ' }, 8, 4);
      }
    } else {
      plate(trapezoid(Rr.plate.hw * 0.85, Rr.plate.hw * 0.85, Rr.plate.y0, Rr.plate.y1 - 0.02), 'satin', '#a7a496', 0.004, {}, 8, 4);
      for (const s of [1, -1]) {
        plate((a, b) => { const [x, y] = quad([[0.66, 0.44], [0.8, 0.44], [0.8, 0.49], [0.66, 0.49]], a, b); return [s * x, y]; }, 'gloss', '#a3242c', 0.005, {}, 4, 1);
        if (L.k >= 0.4) { const eh = R(s * 0.5, 0.4); sb.add(P.cyl(0.034, 0.038, 0.09, L.cyl), 'chrome', { p: at(eh, bo + 0.01), q: new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(0, 0, -1)), c: '#e8ebf0' }); }
        const oc = Rr.lampOuter; plate((a, b) => { const [x, y] = quad([[oc.x0, oc.y0], [oc.x1, oc.y0 + 0.02], [oc.x1, oc.y1], [oc.x0, oc.y1 - 0.02]], a, b); return [s * x, y]; }, 'matte', '#1a191e', 0.0015, { layer: 'occ' }, 6, 4);
        const ic = Rr.lampInner; plate((a, b) => { const [x, y] = quad([[ic.x0, ic.y0], [ic.x1 - 0.02, ic.y0 + 0.03], [ic.x1, ic.y1], [ic.x0 + 0.03, ic.y1 - 0.02]], a, b); return [s * x, y]; }, 'matte', '#1a191e', 0.0015, { layer: 'occ' }, 5, 3);
      }
    }
    const zEnd = sz > 0 ? DIM.zFront : DIM.zRear;
    ctx.fields['dent_' + id] = panelDent('bumper', { zCut: Math.abs(zc), zEnd: Math.abs(zEnd), sz, yTop: sz > 0 ? 0.62 : 0.7, depth: Math.min(0.09, 0.4 * (Math.abs(zEnd) - Math.abs(zc))) });   // a 10 cm tail cap can't take a 9 cm shove
    const pivot = [0, 0.55, sz > 0 ? 1.5 : -1.5];
    ctx.addPart(id, sb, pivot, { kind: 'bumper', hp: 120, joint: 'fixed', detachable: true, attach: 'chassis', dent: true, thick: THICK,
      collider: { shape: 'cuboid', half: [0.8, 0.26, (Math.abs(zEnd) - Math.abs(zc)) / 2], offset: [0, 0.6 - pivot[1], (zc + zEnd) / 2 - pivot[2]] } });
  }
}

// ── lamps: closed lens shells sitting on the bumper (they ride its dent and leave a socket behind) ───────────────────────────
function buildLamps(ctx) {
  const { tub } = ctx, T = TOY.front, Rr = TOY.rear, F = (x, y) => tub.front(x, y), R = (x, y) => tub.rear(x, y), bo = L.off + 0.002;
  for (const sgn of [1, -1]) {
    const nm = sideName(sgn), mir = (fn) => (a, b) => { const [x, y] = fn(a, b); return [x * sgn, y]; };
    // headlamp: the measured swept parallelogram as a 30 mm lens block; projector + indicator on top
    {
      const sb = new SlotBuilder(), lens = mir((a, b) => { const [ra, rb] = softCorners(a, b, 0.3); return quad(T.lamp, ra, rb); });
      const dome = (a, b) => (L.lens === 'dome' ? 0.016 * (1 - ((2 * a - 1) ** 2 + (2 * b - 1) ** 2) / 2) : 0);
      const sh = closedShell((a, b) => { const [x, y] = lens(a, b); return F(x, y); }, { nu: Math.max(2, N(14)), nv: Math.max(1, N(7)), offFn: (a, b) => bo + 0.034 + dome(a, b), thick: 0.03 });
      ctx.shells.push({ part: 'light_head_' + nm, ...sh.info, outer: sh.outer, inner: sh.inner, rim: sh.rim });
      sb.add(sh.outer, 'glass', { c: '#a8bccb', space: 'world' });
      sb.add(sh.rim, 'satin', { c: '#2a2a31', space: 'world' }); sb.add(sh.inner, 'satin', { layer: 'occ', c: '#2a2a31', space: 'world' });
      const pj = T.projector, ec = F(sgn * pj.x, pj.y);
      if (L.eyes === 'full') { sb.add(P.torus(pj.r, 0.008, L.ring, 4), 'chrome', { p: at(ec, bo + 0.052), q: qFacing(ec.n), c: '#e8ebf1' }); sb.add(P.cyl(pj.r * 0.85, pj.r * 0.85, 0.01, L.cyl), 'metal', { p: at(ec, bo + 0.05), q: qDisc(ec.n), c: '#5c6370' }); sb.add(P.cyl(pj.r * 0.5, pj.r * 0.5, 0.01, L.cyl), 'headlight', { p: at(ec, bo + 0.056), q: qDisc(ec.n), c: '#fff3d0' }); }
      else if (L.eyes === 'disc') { sb.add(P.cyl(pj.r, pj.r, 0.01, 8), 'metal', { p: at(ec, bo + 0.05), q: qDisc(ec.n), c: '#5c6370' }); sb.add(P.cyl(pj.r * 0.55, pj.r * 0.55, 0.01, 8), 'headlight', { p: at(ec, bo + 0.056), q: qDisc(ec.n), c: '#fff3d0' }); }
      else if (L.eyes === 'dot') sb.add(P.flat(pj.r * 1.6, pj.r * 1.6, 0.01), 'headlight', { p: at(ec, bo + 0.052), q: qFacing(ec.n), c: '#fff3d0' });
      const ind = mir((a, b) => quad(T.lamp, lerp(0.62, 0.9, a), lerp(0.72, 0.9, b)));
      sb.add(tub.probed(Math.max(1, N(8)), 1, (a, b) => { const [x, y] = ind(a, b); return F(x, y); }, { off: bo + 0.038 }), 'indicator', { c: '#ffb020', space: 'world' });
      if (L.eyes === 'none') { const cc = mir((a, b) => quad(T.lamp, lerp(0.2, 0.6, a), lerp(0.25, 0.75, b))); sb.add(tub.probed(1, 1, (a, b) => { const [x, y] = cc(a, b); return F(x, y); }, { off: bo + 0.038 }), 'headlight', { c: '#fff3d0', space: 'world' }); }
      const c0 = F(sgn * 0.64, 0.75);
      ctx.addPart('light_head_' + nm, sb, [c0.p.x, c0.p.y, c0.p.z], { kind: 'lamp', hp: 40, joint: 'fixed', detachable: true, attach: 'chassis', side: sgn,
        collider: { shape: 'cuboid', half: [0.16, 0.08, 0.04], offset: [0, 0, 0.02] } });
    }
    // tail lamp: two-piece wrap as two lens blocks, brake core and reverse strip on top
    {
      const sb = new SlotBuilder(), oc = Rr.lampOuter, ic = Rr.lampInner;
      const outer = mir((a, b) => { const [ra, rb] = softCorners(a, b, 0.35); return quad([[oc.x0, oc.y0], [oc.x1, oc.y0 + 0.02], [oc.x1, oc.y1], [oc.x0, oc.y1 - 0.02]], ra, rb); });
      const inner = mir((a, b) => { const [ra, rb] = softCorners(a, b, 0.3); return quad([[ic.x0, ic.y0], [ic.x1 - 0.02, ic.y0 + 0.03], [ic.x1, ic.y1], [ic.x0 + 0.03, ic.y1 - 0.02]], ra, rb); });
      for (const [fn, nuL, nvL] of [[outer, 14, 8], [inner, 10, 6]]) {
        const sh = closedShell((a, b) => { const [x, y] = fn(a, b); return R(x, y); }, { nu: Math.max(2, N(nuL)), nv: Math.max(1, N(nvL)), off: bo + 0.026, thick: 0.022 });
        ctx.shells.push({ part: 'light_brake_' + nm, ...sh.info, outer: sh.outer, inner: sh.inner, rim: sh.rim });
        sb.add(sh.outer, 'gloss', { c: '#8f1f27', space: 'world' }); sb.add(sh.rim, 'satin', { c: '#2a2a31', space: 'world' }); sb.add(sh.inner, 'satin', { layer: 'occ', c: '#2a2a31', space: 'world' });
      }
      const rv = mir((a, b) => quad([[oc.x0 + 0.02, oc.y0 + 0.01], [oc.x1 - 0.02, oc.y0 + 0.03], [oc.x1 - 0.02, oc.y0 + 0.085], [oc.x0 + 0.02, oc.y0 + 0.07]], a, b));
      sb.add(tub.probed(Math.max(1, N(8)), 1, (a, b) => { const [x, y] = rv(a, b); return R(x, y); }, { off: bo + 0.03 }), 'headlight', { c: '#ece7dc', space: 'world' });
      const core = mir((a, b) => quad([[oc.x0 + 0.03, oc.y0 + 0.1], [oc.x1 - 0.03, oc.y0 + 0.11], [oc.x1 - 0.03, oc.y1 - 0.03], [oc.x0 + 0.03, oc.y1 - 0.04]], a, b));
      sb.add(tub.probed(Math.max(1, N(8)), Math.max(1, N(4)), (a, b) => { const [x, y] = core(a, b); return R(x, y); }, { off: bo + 0.031 }), 'brakelight', { c: '#ff4a3c', space: 'world' });
      const c0 = R(sgn * 0.6, 0.84);
      ctx.addPart('light_brake_' + nm, sb, [c0.p.x, c0.p.y, c0.p.z], { kind: 'lamp', hp: 40, joint: 'fixed', detachable: true, attach: 'chassis', side: sgn,
        collider: { shape: 'cuboid', half: [0.2, 0.12, 0.04], offset: [-sgn * 0.05, 0, -0.02] } });
    }
  }
}

// ── fixed glass (windscreen, rear window, quarter lights). Never detaches: it smashes (material swap + shards), so the body
//    under it is never revealed. Inner faces are 'occ'. ────────────────────────────────────────────────────────────────────
function buildGlass(ctx) {
  const { body } = ctx, sb = new SlotBuilder();
  const top = (corners, nu, nv) => {
    const s = (a, b) => { const [x, zz] = quad(corners, a, b); return hit(body.top(x, zz)); };
    sb.add(patchGrid(s, { nu: Math.max(1, N(nu)), nv: Math.max(1, N(nv)), off: 0.016 }), 'glass', { c: '#334a63', space: 'world', g: (x, y, zz, nx, ny, nz, c, u, v) => c.multiplyScalar(0.85 + 0.2 * v) });
  };
  top([[-0.55, 0.93], [0.55, 0.93], [0.42, 0.12], [-0.42, 0.12]], 12, 8);
  top([[-0.46, -1.03], [0.46, -1.03], [0.38, -1.50], [-0.38, -1.50]], 10, 6);
  for (const sgn of [1, -1]) {
    const p = TOY.glass.quarter, gl = coons(polyline([p[7], p[6], p[5]]), polyline([p[1], p[2], p[3], p[4]]), polyline([p[7], p[0], p[1]]), polyline([p[5], p[4]]));
    sb.add(patchGrid((a, b) => { const [ra, rb] = softCorners(a, b, 0.3); const [zz, y] = gl(ra, rb); return hit(body.side(zz, y, sgn)); }, { nu: Math.max(1, N(8)), nv: Math.max(1, N(5)), off: 0.02 }), 'glass', { c: '#334a63', space: 'world' });
  }
  ctx.addPart('glass', sb, [0, 1.3, -0.6], { kind: 'glass', hp: 30, joint: 'fixed', detachable: false, attach: 'chassis', smashes: true, collider: null });
}

// ── wheels: one trim-slot mesh per wheel, all LODs keep a 5-spoke read down to L1, a disc at L2, a cap at L3 ────────────────
function wheelGeometry(sgn) {
  const sb = new SlotBuilder(), R = DIM.wheelR, W = DIM.tyreW / 2, seg = L.tyre.seg;
  const flip = sgn < 0 ? Math.PI : 0;   // outer face is +X on the left wheel; the right wheel is the same wheel turned half a turn
  sb.push({ r: [0, flip, 0] });
  if (L.tyre.prof === 'prism') {
    // 32 triangles: an 8-sided prism whose cap centres are painted silver (the fan gradient reads as a hubcap at ≤ 70 px)
    sb.add(P.cyl(R, R, DIM.tyreW, seg), 'rubber', { r: [0, 0, Math.PI / 2], g: (x, y, z, nx, ny, nz, c) => c.set(Math.hypot(x, z) < 0.01 ? '#c9ced8' : '#1e1e22') });
  } else {
    const PROF = {
      smooth: [[[0.24, -W], [0.31, -W * 1.02], [R * 0.93, -W * 0.86], [R, -W * 0.5], [R, W * 0.5], [R * 0.93, W * 0.86], [0.31, W * 1.02], [0.24, W], [0.24, -W]], 6],
      light: [[[0.24, -W], [R * 0.93, -W * 0.86], [R, -W * 0.4], [R, W * 0.4], [R * 0.93, W * 0.86], [0.24, W], [0.24, -W]], 0],
      ring: [[[0.24, -W], [R, -W * 0.8], [R, W * 0.8], [0.24, W], [0.24, -W]], 0],
    }[L.tyre.prof];
    sb.push({ r: [0, 0, Math.PI / 2] }); sb.add(lathe(PROF[0], seg, PROF[1], 'tyreI' + L.id), 'rubber', { g: (x, y, z, nx, ny, nz, c) => { const r = Math.hypot(x, z); c.set(r > R * 0.94 ? '#1b1b1f' : '#2a2a30'); } }); sb.pop();
    if (L.rim === 'full') {
      sb.push({ r: [0, 0, -Math.PI / 2] });
      sb.add(lathe([[0.001, 0.07], [0.07, 0.07], [0.09, 0.085], [0.25, 0.08], [0.275, 0.108], [0.275, 0.128], [0.26, 0.133], [0.24, 0.123], [0.235, -0.11], [0.001, -0.11]], L.ring, 0, 'rimdishI' + L.id), 'alloy', { g: (x, y, zz, nx, ny, nz, c) => { const r = Math.hypot(x, zz); c.set(y > 0.055 && r < 0.245 ? '#1d1f25' : '#d9dde5'); } });
      sb.pop();
      for (let i = 0; i < 5; i++) { sb.push({ r: [(i / 5) * TAU, 0, 0] }); sb.add(P.flat(0.034, 0.222, 0.082), 'alloy', { p: [0.102, 0.155, 0], c: '#e8ebf1' }); sb.pop(); }
      sb.add(P.cyl(0.056, 0.06, 0.03, L.cyl), 'alloy', { p: [0.11, 0, 0], r: [0, 0, Math.PI / 2], c: '#aeb4bf' });
    } else if (L.rim === 'flat') {
      sb.add(P.cyl(0.25, 0.25, 0.02, 8), 'alloy', { p: [0.09, 0, 0], r: [0, 0, Math.PI / 2], c: '#1d1f25' });
      for (let i = 0; i < 5; i++) { sb.push({ r: [(i / 5) * TAU, 0, 0] }); sb.add(P.flat(0.03, 0.235, 0.08), 'alloy', { p: [0.104, 0.15, 0], c: '#e8ebf1' }); sb.pop(); }
    } else {
      sb.add(P.cyl(0.25, 0.25, 0.02, Math.min(8, seg)), 'alloy', { p: [0.09, 0, 0], r: [0, 0, Math.PI / 2], c: '#b9bfca' });
    }
  }
  sb.pop();
  return sb;
}
function buildWheels(ctx) {
  for (const [fb, zz] of [['F', 1], ['R', -1]]) for (const sgn of [1, -1]) {
    const id = `wheel_${fb}${sideName(sgn)}`, hub = [sgn * DIM.wheelX, DIM.wheelY, zz * DIM.wheelZ];
    const sb = wheelGeometry(sgn), layers = sb.finish([0, 0, 0]);
    ctx.parts[id] = { id, pivot: hub, layers, meta: { id, kind: 'wheel', hp: 140, joint: fb === 'F' ? 'compound' : 'spin', steer: fb === 'F', driven: fb === 'F', detachable: true, attach: 'chassis', side: sgn,
      radius: DIM.wheelR, width: DIM.tyreW, massKg: +(massOf(id) * MASS_KG).toFixed(2), channels: [], hubFollowsZones: true,
      collider: { shape: 'cylinder', radius: DIM.wheelR, halfHeight: DIM.tyreW / 2, axis: 'x' } } };
  }
}

export const report = (desc) => {
  const out = {}; let vis = 0, all = 0;
  for (const [id, p] of Object.entries(desc.parts)) {
    const t = (l) => Object.values(p.layers[l]).reduce((a, g) => a + triCount(g), 0), v = t('vis') + (desc.lodSpec.intactShells ? t('panel') : 0), o = t('panel') + t('occ') + t('vis') - v;
    out[id] = { vis, occ: o }; out[id].vis = v; vis += v; all += v + o;
  }
  return { parts: out, intactTris: vis, assemblyTris: all };
};
