// Triangles seen from both sides (one-sided panels: the back renders as a hole), per car and part, plus a picture.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { PNG } from '../../../node_modules/pngjs/lib/png.js';
const R = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const ids = process.argv.slice(2);
const DIRS = Array.from({ length: 512 }, (_, i) => { const n = 512, y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), t = i * Math.PI * (3 - Math.sqrt(5)); return new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r); });
for (const id of ids) {
  const dir = `${R}/art/vehicles/${id}`, model = await import(pathToFileURL(`${dir}/model.js`).href);
  const V = JSON.parse(fs.readFileSync(`${dir}/vehicle.json`)), P = JSON.parse(fs.readFileSync(`${dir}/params.json`));
  const { parts } = model.soups(P, 0), SET = Object.keys(V.parts);
  const all = [], owner = [];
  for (const p of SET) { const s = parts[p], pv = s.pivot ?? [0, 0, 0]; s.positions.forEach((v, i) => all.push(v + pv[i % 3])); for (let t = 0; t < s.tris; t++) owner.push(p); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(all), 3));
  const bvh = new MeshBVH(g, { indirect: true }), ray = new THREE.Ray();
  const T = all.length / 9, two = new Uint8Array(T), per = {};
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), s = new THREE.Vector3();
  const seen = (t, sg) => { for (const d of DIRS) { if (sg * d.dot(n) < 0.05) continue; s.copy(a).add(b).add(c).divideScalar(3); ray.origin.copy(s).addScaledVector(d, 20); ray.direction.copy(d).negate(); const h = bvh.raycastFirst(ray, THREE.DoubleSide); if (!h || h.faceIndex === t || h.point.distanceTo(s) < 2e-4) return true; } return false; };
  for (let t = 0; t < T; t++) {
    a.fromArray(all, 9 * t); b.fromArray(all, 9 * t + 3); c.fromArray(all, 9 * t + 6);
    n.crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a)); if (n.length() < 1e-9) continue; n.normalize();
    if (seen(t, 1) && seen(t, -1)) { two[t] = 1; per[owner[t]] = (per[owner[t]] ?? 0) + 1; }
  }
  console.log(id, 'two-way', two.reduce((x, y) => x + y, 0), 'of', T, JSON.stringify(per));
  // picture: grey shaded intact car, two-way triangles red, from 4 views (unculled, nearest wins)
  const W = 300, views = [[30, -20], [150, -20], [-90, 0], [0, -89]], png = new PNG({ width: W * 4, height: W });
  let half = 0; for (const v of all) half = Math.max(half, Math.abs(v)); half *= 1.05;
  views.forEach(([yaw, pitch], vi) => {
    const m = new THREE.Matrix4().makeRotationX(pitch * Math.PI / 180).multiply(new THREE.Matrix4().makeRotationY(yaw * Math.PI / 180));
    const depth = new Float32Array(W * W).fill(Infinity), col = new Uint8Array(W * W * 3).fill(240), L = new THREE.Vector3(0.4, 0.7, 0.6).normalize();
    for (let t = 0; t < T; t++) {
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromArray(all, 9 * t + 3 * k).applyMatrix4(m));
      const nn = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0])).normalize();
      const shade = 90 + 130 * Math.abs(nn.dot(L)), cc = two[t] ? [235, 50, 40] : [shade, shade, shade];
      const P2 = v.map((q) => [(q.x / half + 1) * W / 2, (1 - q.y / half) * W / 2, -q.z]);
      const ar = (P2[1][0] - P2[0][0]) * (P2[2][1] - P2[0][1]) - (P2[1][1] - P2[0][1]) * (P2[2][0] - P2[0][0]); if (Math.abs(ar) < 1e-9) continue;
      for (let y = Math.max(0, Math.floor(Math.min(...P2.map((p) => p[1])))); y <= Math.min(W - 1, Math.ceil(Math.max(...P2.map((p) => p[1])))); y++)
        for (let x = Math.max(0, Math.floor(Math.min(...P2.map((p) => p[0])))); x <= Math.min(W - 1, Math.ceil(Math.max(...P2.map((p) => p[0])))); x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((P2[1][0] - px) * (P2[2][1] - py) - (P2[1][1] - py) * (P2[2][0] - px)) / ar, w1 = ((P2[2][0] - px) * (P2[0][1] - py) - (P2[2][1] - py) * (P2[0][0] - px)) / ar, w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * P2[0][2] + w1 * P2[1][2] + w2 * P2[2][2]; if (z >= depth[y * W + x]) continue;
          depth[y * W + x] = z; col.set(cc, (y * W + x) * 3);
        }
    }
    for (let i = 0; i < W * W; i++) png.data.set([col[3 * i], col[3 * i + 1], col[3 * i + 2], 255], ((Math.floor(i / W) * W * 4) + vi * W + (i % W)) * 4);
  });
  fs.writeFileSync(new URL(`./twoway-${id}.png`, import.meta.url), PNG.sync.write(png));
}
