#!/usr/bin/env node
// bake.mjs (P1-V02): bakes a code-built vehicle (R81) to the jj.vehicle.v1 contract. It writes one GLB per LOD, the atlas
// and emissive PNGs, and the `<id>.asset.json` sidecar, all byte-reproducible.
//
//   node tools/vehicles/bake.mjs [<vehicle dir>]            bake into the vehicle dir (default art/vehicles/cruz-missile)
//   node tools/vehicles/bake.mjs --out <dir> [<vehicle dir>] bake somewhere else
//   node tools/vehicles/bake.mjs --check [<vehicle dir>]     bake in memory and compare with the committed files (an LFS
//                                                            pointer is compared by its sha256 oid); exit 1 on any change
//
// The vehicle dir holds model.js (soups(P, lod), pivots(P), LODS), atlas.js (drawAtlas()), params.json and vehicle.json
// (mass split, hinges, collider kinds, anchors, LOD budgets).
//
// GLB layout (the contract): scene root = the vehicle; children = one node per part (named by part id, translated to its
// pivot, one mesh with POSITION/NORMAL/TEXCOORD_0 and the single atlas material), the anchors (empty nodes), and in LOD0
// the collider proxies (`collider_<part>`: convex hulls in vehicle space, no material, never rendered).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';

import { GlbBuilder } from './glb.mjs';
import { encodePNG } from './png.mjs';

export const PARTS = ['core', 'front', 'back', 'door_FL', 'door_FR', 'door_RL', 'door_RR', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Per-triangle (flat) normals from float32-rounded positions, as three's computeVertexNormals gives non-indexed meshes. */
function flatNormals(positions) {
  const f = Float32Array.from(positions), n = new Float32Array(f.length);
  for (let i = 0; i < f.length; i += 9) {
    const ax = f[i + 3] - f[i], ay = f[i + 4] - f[i + 1], az = f[i + 5] - f[i + 2];
    const bx = f[i + 6] - f[i], by = f[i + 7] - f[i + 1], bz = f[i + 8] - f[i + 2];
    let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
    const len = Math.hypot(x, y, z) || 1;
    x /= len; y /= len; z /= len;
    for (let k = 0; k < 3; k++) { n[i + 3 * k] = x; n[i + 3 * k + 1] = y; n[i + 3 * k + 2] = z; }
  }
  return n;
}

/** A convex hull of the part's vehicle-space vertices as triangle positions (vehicle space). */
function hull(points) {
  const seen = new Set(), pts = [];
  for (const p of points) {
    const key = p.map((v) => v.toFixed(6)).join(',');
    if (!seen.has(key)) { seen.add(key); pts.push(new THREE.Vector3(...p)); }
  }
  const h = new ConvexHull().setFromPoints(pts), out = [];
  for (const face of h.faces) {
    let edge = face.edge;
    const loop = [];
    do { loop.push(edge.head().point); edge = edge.next; } while (edge !== face.edge);
    for (let i = 1; i + 1 < loop.length; i++) for (const v of [loop[0], loop[i], loop[i + 1]]) out.push(v.x, v.y, v.z);
  }
  return out;
}

export async function bake(vehicleDir = path.join(REPO, 'art/vehicles/cruz-missile')) {
  const url = (f) => pathToFileURL(path.join(vehicleDir, f)).href;
  const model = await import(url('model.js'));
  const { drawAtlas } = await import(url('atlas.js'));
  const P = JSON.parse(fs.readFileSync(path.join(vehicleDir, 'params.json'), 'utf8'));
  const V = JSON.parse(fs.readFileSync(path.join(vehicleDir, 'vehicle.json'), 'utf8'));
  const id = V.id, pivots = model.pivots(P), files = new Map(), report = { id, lods: [] };

  const atlas = drawAtlas();
  const atlasPng = encodePNG(atlas.width, atlas.height, atlas.base);
  const emissivePng = encodePNG(atlas.width, atlas.height, atlas.emissive);
  files.set(`${id}.atlas.png`, atlasPng);
  files.set(`${id}.emissive.png`, emissivePng);

  V.lods.forEach((lodSpec, lod) => {
    const { parts } = model.soups(P, lod);
    const missing = PARTS.filter((p) => !parts[p]);
    if (missing.length) throw new Error(`LOD${lod} has no ${missing.join(', ')}`);
    const g = new GlbBuilder(), j = g.json;
    j.images = [
      { bufferView: g.view(atlasPng), mimeType: 'image/png', name: 'atlas' },
      { bufferView: g.view(emissivePng), mimeType: 'image/png', name: 'emissive' },
    ];
    j.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    j.textures = [{ sampler: 0, source: 0 }, { sampler: 0, source: 1 }];
    j.materials = [{
      name: id,
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.05, roughnessFactor: 0.55 },
      emissiveTexture: { index: 1 },
      emissiveFactor: [1, 1, 1],
      extras: { paintKey: 'pure-white texels tint by the car colour (instanceColor); everything else keeps its colour' },
    }];
    j.meshes = [];
    j.nodes = [{ name: id, children: [] }];
    const child = (node) => { j.nodes.push(node); j.nodes[0].children.push(j.nodes.length - 1); };
    const breakdown = {};
    let tris = 0;
    for (const p of PARTS) {
      const part = parts[p];
      // glTF puts the texture origin at the top-left; the model's UVs have v up.
      const uvs = part.uvs.map((v, i) => (i % 2 ? 1 - v : v));
      const prim = {
        attributes: {
          POSITION: g.floats(part.positions, 'VEC3', true),
          NORMAL: (g.json.accessors.push({ bufferView: g.view(flatNormals(part.positions), 34962), componentType: 5126, count: part.positions.length / 3, type: 'VEC3' }), g.json.accessors.length - 1),
          TEXCOORD_0: g.floats(uvs, 'VEC2'),
        },
        material: 0,
        mode: 4,
      };
      j.meshes.push({ name: p, primitives: [prim] });
      const node = { name: p, mesh: j.meshes.length - 1 };
      if (pivots[p].some((v) => v !== 0)) node.translation = pivots[p];
      child(node);
      breakdown[p] = part.tris;
      tris += part.tris;
    }
    for (const [a, at] of Object.entries(V.anchors)) child({ name: a, translation: at });
    if (lod === 0) {
      for (const p of PARTS) {
        const part = parts[p], pv = pivots[p], pts = [];
        for (let i = 0; i < part.positions.length; i += 3) {
          const q = [part.positions[i] + pv[0], part.positions[i + 1] + pv[1], part.positions[i + 2] + pv[2]];
          // The UHF whip and its mount (on the bull bar's +X post) aren't a collision surface.
          if (p === 'front' && Math.abs(q[0] - P.bar.hw) < 0.08 && Math.abs(q[2] - P.bar.z) < 0.08 && q[1] > P.bar.y1 + 0.03) continue;
          pts.push(q);
        }
        const positions = hull(pts);
        j.meshes.push({ name: `collider_${p}`, primitives: [{ attributes: { POSITION: g.floats(positions, 'VEC3', true) }, mode: 4 }] });
        child({ name: `collider_${p}`, mesh: j.meshes.length - 1, extras: { collider: V.parts[p].collider } });
      }
    }
    j.scenes = [{ nodes: [0] }];
    j.scene = 0;
    const file = `${id}.lod${lod}.glb`, bytes = g.bytes();
    files.set(file, bytes);
    report.lods.push({ file, tris, maxTris: lodSpec.maxTris, breakdown });
  });

  const sidecar = {
    contract: 'jj.vehicle.v1',
    id,
    units: 'm',
    forward: '+z',
    up: '+y',
    lods: report.lods.map((l) => ({ file: l.file, maxTris: l.maxTris })),
    parts: Object.fromEntries(PARTS.map((p) => [p, {
      pivot: pivots[p],
      hinge: V.parts[p].hinge,
      massFraction: V.parts[p].massFraction,
      collider: { type: V.parts[p].collider },
    }])),
    anchors: V.anchors,
    material: { count: 1, atlas: `${id}.atlas.png` },
  };
  files.set(`${id}.asset.json`, new TextEncoder().encode(JSON.stringify(sidecar, null, 1) + '\n'));
  report.files = Object.fromEntries([...files].map(([f, b]) => [f, { bytes: b.length, sha256: sha256(b) }]));
  return { files, report };
}

/** The sha256 of a committed file, read through an LFS pointer when the checkout has one. */
export function committedSha(file) {
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  const text = bytes.subarray(0, 200).toString('latin1');
  if (text.startsWith('version https://git-lfs.github.com/spec/v1')) {
    const m = /oid sha256:([0-9a-f]{64})/.exec(bytes.toString('latin1'));
    return m ? m[1] : null;
  }
  return sha256(bytes);
}

async function main(argv) {
  let check = false, out = null, dir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '-h' || argv[i] === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n')); return 0; }
    else dir = argv[i];
  }
  const vehicleDir = path.resolve(dir ?? path.join(REPO, 'art/vehicles/cruz-missile'));
  const { files, report } = await bake(vehicleDir);
  for (const l of report.lods) console.log(`${l.file}: ${l.tris} tris (budget ${l.maxTris}) ${JSON.stringify(l.breakdown)}`);
  if (check) {
    const changed = [];
    for (const [f, info] of Object.entries(report.files)) {
      const committed = committedSha(path.join(vehicleDir, f));
      console.log(`${committed === info.sha256 ? 'same   ' : 'CHANGED'} ${f} ${info.sha256}${committed && committed !== info.sha256 ? ` (committed ${committed})` : committed ? '' : ' (not committed)'}`);
      if (committed !== info.sha256) changed.push(f);
    }
    if (changed.length) {
      console.log(`bake --check: ${changed.length} file(s) differ from a fresh bake; rebake with node tools/vehicles/bake.mjs and commit`);
      return 1;
    }
    console.log('bake --check: the committed files are exactly what the model script bakes');
    return 0;
  }
  const target = path.resolve(out ?? vehicleDir);
  fs.mkdirSync(target, { recursive: true });
  for (const [f, bytes] of files) fs.writeFileSync(path.join(target, f), bytes);
  for (const [f, info] of Object.entries(report.files)) console.log(`wrote ${path.join(path.relative(REPO, target) || '.', f)} ${info.bytes} B sha256 ${info.sha256}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
