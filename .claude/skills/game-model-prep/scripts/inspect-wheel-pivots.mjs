#!/usr/bin/env node
// Generic GLB wheel-pivot inspector.
// Reports, per wheel mesh, the geometry offset PERPENDICULAR to the spin axis (X by convention)
// = sqrt(centerY^2 + centerZ^2). That — not raw 3D offset — is what causes a wheel to "orbit"
// when it spins. Offset purely along the axle (X) is benign.
//
// Usage: node inspect-wheel-pivots.mjs model1.glb [model2.glb ...]
//        node inspect-wheel-pivots.mjs --eps 0.05 --axis x model.glb
//
// Exit code is non-zero if any wheel exceeds --eps (default 0.05), so it can gate CI.

import { readFileSync } from 'node:fs';

function parseGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const length = dv.getUint32(8, true);
  let off = 12, json = null;
  while (off < length) {
    const clen = dv.getUint32(off, true);
    const ctype = dv.getUint32(off + 4, true);
    const chunk = buf.subarray(off + 8, off + 8 + clen);
    if (ctype === 0x4e4f534a /* JSON */) json = JSON.parse(new TextDecoder().decode(chunk));
    off += 8 + clen;
  }
  return json;
}

function perp(center, axis) {
  if (axis === 'x') return Math.hypot(center[1], center[2]);
  if (axis === 'y') return Math.hypot(center[0], center[2]);
  return Math.hypot(center[0], center[1]);
}

function inspect(path, eps, axis) {
  const g = parseGlb(readFileSync(path));
  const nodes = g.nodes || [], meshes = g.meshes || [], acc = g.accessors || [];
  let worst = 0, wheels = 0, fails = 0;
  console.log(`\n=== ${path.split('/').pop()} === nodes=${nodes.length} meshes=${meshes.length}`);
  for (const n of nodes) {
    if (n.mesh == null) continue;
    const name = n.name || `mesh${n.mesh}`;
    const prim = meshes[n.mesh].primitives[0];
    const a = acc[prim.attributes.POSITION];
    if (!a || !a.min || !a.max) continue;
    const c = [(a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2, (a.min[2] + a.max[2]) / 2];
    const isWheel = /wheel|tyre|tire|rim/i.test(name);
    if (!isWheel) continue;
    wheels++;
    const p = perp(c, axis);
    worst = Math.max(worst, p);
    const ok = p < eps;
    if (!ok) fails++;
    console.log(`  ${ok ? 'OK ' : 'BAD'} '${name}'  geomCenter=(${c.map(v => v.toFixed(3)).join(',')})  perp(${axis})=${p.toFixed(3)}`);
  }
  if (wheels === 0) console.log('  (no wheel-named meshes found — pack may fuse/rename wheels; inspect manually)');
  console.log(`  wheels=${wheels} worstPerp=${worst.toFixed(3)} fails=${fails} (eps=${eps})`);
  return fails;
}

const args = process.argv.slice(2);
let eps = 0.05, axis = 'x';
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--eps') eps = parseFloat(args[++i]);
  else if (args[i] === '--axis') axis = args[++i];
  else files.push(args[i]);
}
if (!files.length) { console.error('usage: inspect-wheel-pivots.mjs [--eps 0.05] [--axis x] model.glb ...'); process.exit(2); }
let totalFails = 0;
for (const f of files) { try { totalFails += inspect(f, eps, axis); } catch (e) { console.error(`${f}: ${e.message}`); totalFails++; } }
process.exit(totalFails ? 1 : 0);
