// compare-bakes.mjs (P1-V03): proves a re-bake left the car's shape alone. For each LOD and each contract part, the
// world-space vertices (node translation + mesh positions) of the working-tree bake against a committed one, so a
// pivot move or an added interior block can be shown not to change the silhouette the IoU was measured on.
//   node tools/vehicles/compare-bakes.mjs <git rev> [art/vehicles/cruz-missile]
// Exit 1 if any part moved by more than 1e-5 m.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import { PARTS } from './bake.mjs';

const [rev, dir = 'art/vehicles/cruz-missile'] = process.argv.slice(2);
if (!rev) throw new Error('usage: compare-bakes.mjs <git rev> [vehicle dir]');
const id = JSON.parse(fs.readFileSync(join(dir, 'vehicle.json'), 'utf8')).id;

/** The committed file's bytes, through LFS when the blob is a pointer. */
function committed(path) {
  const blob = execFileSync('git', ['show', `${rev}:${path}`]);
  return blob.subarray(0, 40).toString('latin1').startsWith('version https://git-lfs') ? execFileSync('git', ['lfs', 'smudge'], { input: blob }) : blob;
}

/** Part id → world-space vertex positions (Float64Array), from a GLB's bytes. */
function worldVerts(bytes) {
  const jsonLen = bytes.readUInt32LE(12);
  const j = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = bytes.subarray(20 + jsonLen + 8);
  const out = {};
  for (const n of j.nodes) {
    if (!PARTS.includes(n.name) || n.mesh === undefined) continue;
    const a = j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION];
    const v = j.bufferViews[a.bufferView];
    const f = new Float32Array(bin.buffer.slice(bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + a.count * 12));
    const t = n.translation ?? [0, 0, 0];
    out[n.name] = Float64Array.from(f, (x, i) => x + t[i % 3]);
  }
  return out;
}

let worst = 0;
for (let lod = 0; lod < 3; lod++) {
  const file = join(dir, `${id}.lod${lod}.glb`);
  const now = worldVerts(fs.readFileSync(file));
  const then = worldVerts(committed(file));
  for (const p of PARTS) {
    const a = now[p];
    const b = then[p];
    if (!a || !b || a.length !== b.length) throw new Error(`LOD${lod} ${p}: vertex count ${a?.length / 3} vs ${b?.length / 3}`);
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    worst = Math.max(worst, d);
  }
  console.log(`LOD${lod}: ${PARTS.length} parts, largest vertex move ${worst.toExponential(2)} m`);
}
if (worst > 1e-5) {
  console.error(`shape changed: a vertex moved ${worst} m`);
  process.exit(1);
}
console.log(`same shape as ${rev} (every part's world-space vertices within 1e-5 m)`);
