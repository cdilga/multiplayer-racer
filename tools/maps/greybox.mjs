#!/usr/bin/env node
// Authors maps/greybox-loop.json (P1-M01, plan §8.2): the ~600 m greybox loop every driving preview uses until procgen
// lands. Tarmac and packed-dirt sections, one jump with a bypass lane, barriers, and the duel segments (§7.3b): a hairpin,
// an S-bend, a straight of at least 150 m and a kerb across the road. Deterministic: rerun after any change and commit
// the JSON; `jj validate maps/greybox-loop.json` must pass.
//
// The centerline is a turtle path (metres; heading in degrees, 0 = +x, a left turn increases it, counter-clockwise
// seen from above). The last turn and straight are solved so the loop closes exactly on the start.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'maps', 'greybox-loop.json');
const STEP = 2.5; // target spacing of centerline points, m
const TARMAC = { surface: 'tarmac', width: 14 }, DIRT = { surface: 'packed-dirt', width: 12 };

const pts = []; // { x, z, h (heading deg), s, width, surface }
const segments = [];
let x = 0, z = 0, h = 0, s = 0;
const rad = (d) => (d * Math.PI) / 180;
const emit = (kind) => pts.push({ x, z, h, s, ...kind });
function straight(name, len, kind) {
  const from = pts.length;
  const n = Math.max(1, Math.round(len / STEP));
  for (let k = 0; k < n; k++) {
    emit(kind);
    x += (len / n) * Math.cos(rad(h)); z += (len / n) * Math.sin(rad(h)); s += len / n;
  }
  if (name) segments.push({ name, from, to: pts.length - 1 });
}
function turn(name, deg, r, kind) { // deg > 0 left, < 0 right
  const from = pts.length;
  const arc = Math.abs(rad(deg)) * r, n = Math.max(2, Math.round(arc / STEP));
  const side = Math.sign(deg); // centre on the left for a left turn
  const cx = x + side * r * -Math.sin(rad(h)), cz = z + side * r * Math.cos(rad(h));
  const h0 = h;
  for (let k = 0; k < n; k++) {
    emit(kind);
    const a = rad(h0 + (deg * (k + 1)) / n - side * 90);
    x = cx + r * Math.cos(a); z = cz + r * Math.sin(a); h = h0 + (deg * (k + 1)) / n; s += arc / n;
  }
  if (name) segments.push({ name, from, to: pts.length - 1 });
}

straight('main-straight', 170, TARMAC);
turn('hairpin', 180, 15, TARMAC);
const kerbAtS = s + 40;
straight('kerb-straight', 80, TARMAC);
const sbendFrom = pts.length;
turn(null, -50, 35, TARMAC);
turn(null, 50, 35, TARMAC);
segments.push({ name: 's-bend', from: sbendFrom, to: pts.length - 1 });
const jumpAtS = s + 20;
straight('jump-straight', 100, DIRT);
turn('sweeper', 90, 30, DIRT);
// Close: straight L1 (heading 270), a left 90° of radius R, straight L2 back to (0, 0) heading 0.
const R = 20, L1 = z - R, L2 = -(x + R);
if (!(L1 >= 0 && L2 >= 0) || Math.abs(h - 270) > 1e-6) throw new Error(`can't close the loop from (${x}, ${z}) heading ${h}`);
const returnFrom = pts.length;
if (L1 > 0) straight(null, L1, DIRT);
turn(null, 90, R, DIRT);
straight(null, L2, TARMAC);
segments.push({ name: 'return', from: returnFrom, to: pts.length - 1 });
if (Math.hypot(x, z) > 1e-6) throw new Error(`loop doesn't close: ends at (${x}, ${z})`);
const total = s;

// Helpers on the finished centerline.
const mm = (v) => Math.round(v * 1000);
const idxAt = (sv) => { const t = ((sv % total) + total) % total; let best = 0; for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i].s - t) < Math.abs(pts[best].s - t)) best = i; return best; };
const leftN = (p) => [-Math.sin(rad(p.h)), Math.cos(rad(p.h))]; // lateral + side (the validator's (−tz, tx))
const pose = (p, lateral, yawDeg = p.h) => { const [nx, nz] = leftN(p); return { x: mm(p.x + nx * lateral), y: 0, z: mm(p.z + nz * lateral), yaw: Math.round((((yawDeg % 360) + 360) % 360) * 100) }; };

// Gates every 40 m from the finish line, 100 m down the main straight.
const finishS = 100;
const gates = [];
for (let g = 0; g * 40 < total - 20; g++) gates.push({ at: idxAt(finishS + g * 40), finish: g === 0 });
gates.sort((a, b) => a.at - b.at);

// The jump: ramp base 20 m into the dirt straight, on the + side, leaving a bypass lane on the − side.
const jp = pts[idxAt(jumpAtS)];
const jump = { rampLengthMm: 8000, rampWidthMm: 4500, lipHeightCm: 120, landingLengthMm: 28000, landingWidthMm: 6000 };
const jumpLateral = 2.5;
const jumpEnd = idxAt(jumpAtS + (jump.rampLengthMm + jump.landingLengthMm) / 1000 + 2);
const jumpStart = idxAt(jumpAtS - 2);

// Barriers: 4 m sections outside every bend and along both sides of the dirt straight.
const dressing = [];
const barrierRow = (from, to, side) => {
  for (let i = from; i <= to; i += 2) {
    const p = pts[i];
    dressing.push({ kitPiece: 'generic/barrier', pose: pose(p, side * (p.width / 2 + 1.7)), params: { lengthMm: 4000, heightCm: 90, thicknessMm: 400 }, collides: true });
  }
};
const seg = (name) => segments.find((g) => g.name === name);
barrierRow(seg('hairpin').from, seg('hairpin').to, -1);
barrierRow(seg('sweeper').from, seg('sweeper').to, -1);
barrierRow(seg('jump-straight').from, seg('jump-straight').to, -1);
barrierRow(seg('jump-straight').from, seg('jump-straight').to, 1);
barrierRow(sbendFrom, sbendFrom + Math.round((seg('s-bend').to - sbendFrom) / 2), 1);
barrierRow(seg('return').from, seg('return').from + 14, -1);
// Finish posts, buildings along the main straight (well clear of the camera margin).
const fp = pts[idxAt(finishS)];
for (const side of [-1, 1]) dressing.push({ kitPiece: 'generic/post', pose: pose(fp, side * (fp.width / 2 + 2.8)), params: { heightCm: 450, radiusMm: 200 }, collides: true });
for (const [at, side] of [[40, 1], [140, -1], [90, -1]]) dressing.push({ kitPiece: 'generic/box-building', pose: pose(pts[idxAt(at)], side * 25), params: { widthMm: 9000, depthMm: 6000, heightCm: 450 }, collides: true });
// Props: cones before the hairpin, bins by a building.
const props = [];
for (const k of [0, 1, 2]) props.push({ kitPiece: 'generic/cone', pose: pose(pts[idxAt(150 + k * 4)], -(TARMAC.width / 2 + 3)), params: {} });
for (const k of [0, 1]) props.push({ kitPiece: 'generic/bin', pose: pose(pts[idxAt(40 + k * 3)], 19.5), params: {} });

// Bounds and a flat 10 m terrain grid whose surface follows the route.
const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
const pad = 45;
const bounds = { minX: mm(Math.min(...xs) - pad), minZ: mm(Math.min(...zs) - pad), maxX: mm(Math.max(...xs) + pad), maxZ: mm(Math.max(...zs) + pad), killY: -20000 };
const spacing = 10_000, originX = Math.floor(bounds.minX / spacing) * spacing, originZ = Math.floor(bounds.minZ / spacing) * spacing;
const cols = Math.ceil((bounds.maxX - originX) / spacing) + 1, rows = Math.ceil((bounds.maxZ - originZ) / spacing) + 1;
const surfaces = [];
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const cx = (originX + c * spacing) / 1000, cz = (originZ + r * spacing) / 1000;
  let best = null, bd = Infinity;
  for (const p of pts) { const d = Math.hypot(p.x - cx, p.z - cz); if (d < bd) { bd = d; best = p; } }
  surfaces.push(bd <= best.width / 2 ? best.surface : 'off-track');
}

const map = {
  header: { version: 'jj.map.v1', generator: { id: 'jj.greybox', version: '1' }, seed: 0, biomes: ['greybox'], bounds, refLapMs: 40000, gameplayHash: null },
  terrain: { originX, originZ, spacing, cols, rows, heights: new Array(cols * rows).fill(0), surfaces },
  route: {
    closed: true,
    points: pts.map((p) => ({ x: mm(p.x), y: 0, z: mm(p.z), width: p.width * 1000, bank: 0, surface: p.surface })),
    gates,
    start: { at: idxAt(finishS), length: 60000, width: 12000, rowSpacing: 8000, columnSpacing: 3500 },
    recovery: [{ from: 0, to: jumpStart - 1 }, { from: jumpEnd + 1, to: pts.length - 1 }],
    segments: segments.map((g) => ({ name: g.name, span: { from: g.from, to: g.to } })),
  },
  features: [
    { kind: 'jump', pose: pose(jp, jumpLateral), params: jump },
    { kind: 'kerb', pose: pose(pts[idxAt(kerbAtS)], 0), params: { heightCm: 12, depthMm: 400 } },
  ],
  dressing,
  props,
};
writeFileSync(out, `${JSON.stringify(map, null, 1)}\n`);
console.log(`greybox: ${pts.length} points, ${(total).toFixed(1)} m, ${gates.length} gates, ${dressing.length} dressing, ${props.length} props, terrain ${cols}×${rows}; segments ${segments.map((g) => `${g.name} ${(pts[g.to].s - pts[g.from].s).toFixed(0)} m`).join(', ')}`);
