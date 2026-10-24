// Where do a roster car's triangles go? Hidden faces, slivers, coplanar fragments, and how meshoptimizer LODs compare
// with the hand LODs (silhouette IoU + depth error vs LOD0 over 5 orthographic views).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { MeshoptSimplifier } from 'meshoptimizer';

const REPO = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : JSON.parse(fs.readFileSync(`${REPO}/art/ui/poc/vehicles/roster.json`, 'utf8')).vehicles.map((v) => v.id);
await MeshoptSimplifier.ready;

const PARTS = ['core', 'front', 'back', 'door_FL', 'door_FR', 'door_RL', 'door_RR', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
const BIKE = ['core', 'front', 'back', 'rider', 'wheel_F', 'wheel_R'];

async function load(id) {
  const dir = `${REPO}/art/vehicles/${id}`;
  const model = await import(pathToFileURL(path.join(dir, 'model.js')).href);
  const P = JSON.parse(fs.readFileSync(path.join(dir, 'params.json'), 'utf8'));
  const V = JSON.parse(fs.readFileSync(path.join(dir, 'vehicle.json'), 'utf8'));
  const SET = V.parts.wheel_F ? BIKE : PARTS;
  const lods = V.lods.map((spec, lod) => {
    const { parts } = model.soups(P, lod);
    const out = {};
    for (const p of SET) {
      const s = parts[p], pv = s.pivot ?? [0, 0, 0];
      out[p] = { pos: Float64Array.from(s.positions, (v, i) => v + pv[i % 3]), uv: s.uvs };
    }
    return { maxTris: spec.maxTris, parts: out };
  });
  return { id, SET, lods };
}

const fib = (n) => Array.from({ length: n }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), t = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r);
});
const DIRS = fib(+(process.env.DIRS ?? 256));

function triNormal(p, t) {
  const a = new THREE.Vector3(p[9 * t], p[9 * t + 1], p[9 * t + 2]), b = new THREE.Vector3(p[9 * t + 3], p[9 * t + 4], p[9 * t + 5]), c = new THREE.Vector3(p[9 * t + 6], p[9 * t + 7], p[9 * t + 8]);
  const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
  const area = n.length() / 2;
  return { a, b, c, n: n.normalize(), area };
}

/** Per triangle of `own` (a flat position array), is its front face visible from any direction, with `all` as occluders?
 *  own triangles occupy [ownStart, ownStart+ownCount) of `all`. */
function visibility(all, ownStart, ownCount, flip = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(all), 3));
  const bvh = new MeshBVH(g, { indirect: true });
  const ray = new THREE.Ray(), vis = new Uint8Array(ownCount);
  for (let k = 0; k < ownCount; k++) {
    const t = ownStart + k, { a, b, c, n, area } = triNormal(all, t);
    if (flip) n.negate();
    if (area < 1e-9) continue;
    const samples = [[1 / 3, 1 / 3], [0.7, 0.15], [0.15, 0.7], [0.15, 0.15], [0.45, 0.45], [0.1, 0.45], [0.45, 0.1], [0.9, 0.05], [0.05, 0.9], [0.05, 0.05]].map(([u, v]) =>
      a.clone().multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v));
    outer: for (const d of DIRS) {
      if (d.dot(n) < 0.02) continue;
      for (const s of samples) {
        ray.origin.copy(s).addScaledVector(d, 20);
        ray.direction.copy(d).negate();
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
        if (!hit || hit.faceIndex === t || hit.point.distanceTo(s) < 2e-4) { vis[k] = 1; break outer; }
      }
    }
  }
  return vis;
}

const q = (v, e) => Math.round(v / e);
/** Coplanar same-texture regions in one part: how many triangles a minimal re-triangulation would need. */
function coplanar(pos, uv) {
  const T = pos.length / 9, key = new Map(), vid = (i) => {
    const k = `${q(pos[3 * i], 1e-5)},${q(pos[3 * i + 1], 1e-5)},${q(pos[3 * i + 2], 1e-5)}`;
    if (!key.has(k)) key.set(k, key.size);
    return key.get(k);
  };
  const tv = [], groupKey = [];
  for (let t = 0; t < T; t++) {
    const { a, n, area } = triNormal(pos, t);
    tv.push([vid(3 * t), vid(3 * t + 1), vid(3 * t + 2)]);
    if (area < 1e-9) { groupKey.push(null); continue; }
    // the swatch: a flat-colour atlas, so the triangle's mean UV rounded to the swatch grid identifies its colour
    const u = (uv[6 * t] + uv[6 * t + 2] + uv[6 * t + 4]) / 3, v = (uv[6 * t + 1] + uv[6 * t + 3] + uv[6 * t + 5]) / 3;
    groupKey.push(`${q(n.x, 2e-3)},${q(n.y, 2e-3)},${q(n.z, 2e-3)},${q(n.dot(a), 2e-4)}|${q(u, 1 / 128)},${q(v, 1 / 64)}`);
  }
  const groups = new Map();
  groupKey.forEach((k, t) => { if (k) (groups.get(k) ?? groups.set(k, []).get(k)).push(t); });
  let saved = 0, regions = 0;
  for (const tris of groups.values()) {
    if (tris.length < 2) continue;
    // connected components by shared edge
    const edgeTris = new Map();
    for (const t of tris) for (let e = 0; e < 3; e++) {
      const x = tv[t][e], y = tv[t][(e + 1) % 3], k = x < y ? `${x}_${y}` : `${y}_${x}`;
      (edgeTris.get(k) ?? edgeTris.set(k, []).get(k)).push(t);
    }
    const parent = new Map(tris.map((t) => [t, t])), find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
    for (const ts of edgeTris.values()) for (let i = 1; i < ts.length; i++) parent.set(find(ts[i]), find(ts[0]));
    const comps = new Map();
    for (const t of tris) (comps.get(find(t)) ?? comps.set(find(t), []).get(find(t))).push(t);
    for (const comp of comps.values()) {
      if (comp.length < 2) continue;
      const cnt = new Map();
      for (const t of comp) for (let e = 0; e < 3; e++) {
        const x = tv[t][e], y = tv[t][(e + 1) % 3], k = x < y ? `${x}_${y}` : `${y}_${x}`;
        cnt.set(k, (cnt.get(k) ?? 0) + 1);
      }
      const bEdges = [...cnt].filter(([, c]) => c === 1).map(([k]) => k.split('_').map(Number));
      const bVerts = new Set(bEdges.flat());
      // loops = connected components of the boundary graph
      const par = new Map([...bVerts].map((v) => [v, v])), f = (x) => (par.get(x) === x ? x : (par.set(x, f(par.get(x))), par.get(x)));
      for (const [x, y] of bEdges) par.set(f(x), f(y));
      const loops = new Set([...bVerts].map(f)).size;
      const need = bVerts.size + 2 * (loops - 1) - 2;
      if (need > 0 && need < comp.length) { saved += comp.length - need; regions++; }
    }
  }
  return { saved, regions };
}

/** Weld by position and simplify with meshoptimizer to `target` triangles (shape only: UVs are not carried). */
function simplify(pos, target, uv = null) {
  const map = new Map(), verts = [], idx = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    // with uv: weld by position + UV, so colour borders stay seams meshoptimizer must respect
    const k = `${q(pos[3 * i], 1e-5)},${q(pos[3 * i + 1], 1e-5)},${q(pos[3 * i + 2], 1e-5)}${uv ? `|${q(uv[2 * i], 1e-4)},${q(uv[2 * i + 1], 1e-4)}` : ''}`;
    if (!map.has(k)) { map.set(k, verts.length / 3); verts.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); }
    idx[i] = map.get(k);
  }
  const P = new Float32Array(verts);
  const [out] = MeshoptSimplifier.simplify(idx, P, 3, Math.max(3, target * 3), 1, ['Permissive']);
  const res = new Float64Array(out.length * 3);
  for (let i = 0; i < out.length; i++) for (let c = 0; c < 3; c++) res[3 * i + c] = P[3 * out[i] + c];
  return res;
}

// ---- silhouettes + depth: orthographic CPU raster over 5 views
const VIEWS = [['front', 0, 0], ['rear', 180, 0], ['side', 90, 0], ['top', 0, -90], ['3q', 35, -20]];
const RES = 192;
function viewMat(yaw, pitch) {
  return new THREE.Matrix4().makeRotationX((pitch * Math.PI) / 180).multiply(new THREE.Matrix4().makeRotationY((yaw * Math.PI) / 180));
}
let cull = false, cullSign = 1;
function raster(pos, m, half, res = RES) {
  const RES = res;
  const depth = new Float32Array(RES * RES).fill(Infinity), v = new THREE.Vector3(), P = [];
  for (let i = 0; i < pos.length; i += 3) { v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m); P.push([(v.x / half + 1) * RES / 2, (1 - v.y / half) * RES / 2, -v.z, v.x, v.y]); }
  for (let t = 0; t < P.length; t += 3) {
    const [a, b, c] = [P[t], P[t + 1], P[t + 2]];
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(RES - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(RES - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-12) continue;
    // view space: the camera looks down -z, so a front face's normal has +z (three's CCW convention)
    if (cull && ((b[3] - a[3]) * (a[2] - c[2]) * 0 + (b[3] - a[3]) * (c[4] - a[4]) - (b[4] - a[4]) * (c[3] - a[3])) <= 0) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area, w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
      if (z < depth[y * RES + x]) depth[y * RES + x] = z;
    }
  }
  return depth;
}
function compare(ref, test, half) {
  let iou = 0, dz = 0;
  for (const [, yaw, pitch] of VIEWS) {
    const m = viewMat(yaw, pitch), A = raster(ref, m, half), B = raster(test, m, half);
    let inter = 0, uni = 0, sum = 0;
    for (let i = 0; i < A.length; i++) {
      const a = A[i] < Infinity, b = B[i] < Infinity;
      if (a && b) { inter++; sum += Math.min(0.3, Math.abs(A[i] - B[i])); }
      if (a || b) uni++;
    }
    iou += inter / uni; dz += sum / Math.max(1, inter);
  }
  return { iou: iou / VIEWS.length, depthMm: (1000 * dz) / VIEWS.length };
}
const concat = (arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0), o = new Float64Array(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };

if (process.env.WINDING) {
  for (const id of ids) {
    const car = await load(id);
    for (const [li, L] of car.lods.entries()) {
      let front = 0, inverted = 0, hidden = 0; const per = {};
      for (const p of car.SET) {
        const pp = L.parts[p].pos, n = pp.length / 9, f = visibility(pp, 0, n), b = visibility(pp, 0, n, true);
        let inv = 0; for (let t = 0; t < n; t++) { if (f[t]) front++; else if (b[t]) { inverted++; inv++; } else hidden++; }
        if (inv) per[p] = inv;
      }
      console.error(`${id} lod${li}: front ${front} inverted ${inverted} hidden ${hidden} ${JSON.stringify(per)}`);
    }
  }
  process.exit(0);
}
// --verify: drop self-hidden triangles from LOD0 and diff culled depth renders from 64 directions at 384 px
if (process.env.VERIFY) {
  const VO = await import('../../../tools/vehicles/optimise.mjs');
  cull = true;
  for (const id of ids) {
    const car = await load(id), parts = car.lods[0].parts;
    const full = concat(car.SET.map((p) => parts[p].pos));
    const pruned = concat(car.SET.map((p) => { const pp = parts[p].pos, n = pp.length / 9, vs = VO.faceVisibility(Array.from(pp)), keep = [];
      for (let t = 0; t < vs.length; t++) if (vs[t]) for (let k = 0; k < 9; k++) keep.push(pp[9 * t + k]);
      return Float64Array.from(keep); }));
    let half = 0; for (const v of full) half = Math.max(half, Math.abs(v)); half *= 1.05;
    // pick the culling winding that matches: the one where a full-car render covers the most pixels from the front
    const good = 'normal';
    let diff = 0, px = 0, worst = 0;
    for (const d of fib(64)) {
      const m = new THREE.Matrix4().lookAt(d, new THREE.Vector3(), Math.abs(d.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)).invert();
      const A = raster(full, m, half, 384), B = raster(pruned, m, half, 384);
      let vd = 0; for (let i = 0; i < A.length; i++) { if (A[i] < Infinity) px++; if (Math.abs((A[i] === Infinity ? 99 : A[i]) - (B[i] === Infinity ? 99 : B[i])) > 1e-4) vd++; }
      diff += vd; worst = Math.max(worst, vd);
    }
    console.error(`${id}: removed ${(full.length - pruned.length) / 9} tris; differing pixels ${diff} of ${px} covered (worst view ${worst}) winding ${good}`);
  }
  process.exit(0);
}
if (process.env.SIGN) {
  for (const id of ids) {
    const car = await load(id), all = concat(car.SET.map((p) => car.lods[0].parts[p].pos));
    let half = 0; for (const v of all) half = Math.max(half, Math.abs(v)); half *= 1.05;
    const m = viewMat(30, -20);
    cull = false; const U = raster(all, m, half, 256);
    cull = true; const C = raster(all, m, half, 256);
    let same = 0, cov = 0; for (let i = 0; i < U.length; i++) if (U[i] < Infinity) { cov++; if (Math.abs(U[i] - C[i]) < 1e-4) same++; }
    console.error(`${id}: culled render matches unculled outer surface on ${(100 * same / cov).toFixed(1)}% of ${cov} px`);
  }
  process.exit(0);
}
if (process.env.SHOT) {
  const { PNG } = await import('../../../node_modules/pngjs/lib/png.js');
  const O = await import('../../../tools/vehicles/optimise.mjs');
  cull = true;
  for (const id of ids) {
    const car = await load(id), L = car.lods[0];
    const before = concat(car.SET.map((p) => L.parts[p].pos));
    const after = concat(car.SET.map((p) => Float64Array.from(O.orientAndPrune({ positions: Array.from(L.parts[p].pos), uvs: L.parts[p].uv }).positions)));
    let half = 0; for (const v of before) half = Math.max(half, Math.abs(v)); half *= 1.05;
    const R = 360, views = [[30, -20], [150, -20], [-60, -35], [90, 10]], png = new PNG({ width: R * views.length, height: R * 2 });
    let filled = 0, lost = 0, fullCover = 0;
    views.forEach(([yaw, pitch], vi) => {
      const m = viewMat(yaw, pitch), A = raster(before, m, half, R), B = raster(after, m, half, R);
      for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
        const i = y * R + x;
        for (const [row, D] of [[0, A], [1, B]]) {
          const o = (((row * R + y) * R * views.length) + vi * R + x) * 4, z = D[i];
          let c = z === Infinity ? [235, 235, 235] : Array(3).fill(Math.max(30, Math.min(220, 125 - z * 70)));
          if (row === 1 && B[i] < Infinity && (A[i] === Infinity || A[i] - B[i] > 2e-3)) { c = [230, 40, 40]; filled++; }
          if (row === 1 && A[i] < Infinity && (B[i] === Infinity || B[i] - A[i] > 2e-3)) { c = [40, 90, 230]; lost++; }
          png.data.set([...c, 255], o);
        }
      }
    });
    fs.writeFileSync(`shot-${id}.png`, PNG.sync.write(png));
    console.error(`${id}: ${filled} pixels newly covered (red), ${lost} uncovered (blue) across ${views.length} views`);
  }
  process.exit(0);
}
if (process.env.OPT) {
  const O = await import('../../../tools/vehicles/optimise.mjs');
  await O.ready;
  for (const id of ids) {
    const car = await load(id), t0 = Date.now();
    const soup = (L) => Object.fromEntries(car.SET.map((p) => [p, { positions: Array.from(L.parts[p].pos), uvs: L.parts[p].uv }]));
    const lod0 = soup(car.lods[0]), opt0 = Object.fromEntries(car.SET.map((p) => [p, O.orientAndPrune(lod0[p])]));
    const f = car.SET.reduce((s, p) => s + opt0[p].stats.flipped, 0), d = car.SET.reduce((s, p) => s + opt0[p].stats.dropped, 0);
    const ref = concat(car.SET.map((p) => car.lods[0].parts[p].pos));
    let half = 0; for (const v of ref) half = Math.max(half, Math.abs(v)); half *= 1.05;
    let line = `${id}: LOD0 flipped ${f} dropped ${d} (${Date.now() - t0} ms)`;
    for (const li of [1, 2]) {
      const L = car.lods[li], hand = concat(car.SET.map((p) => L.parts[p].pos));
      const s = O.simplifyLod(opt0, L.maxTris), auto = concat(car.SET.map((p) => Float64Array.from(s.parts[p].positions)));
      const h = compare(ref, hand, half), a = compare(ref, auto, half);
      line += ` | lod${li} hand ${hand.length / 9}t ${h.iou.toFixed(3)}/${h.depthMm.toFixed(1)}mm auto ${auto.length / 9}t ${a.iou.toFixed(3)}/${a.depthMm.toFixed(1)}mm e=${(s.error * 1000).toFixed(1)}mm${s.permissive ? ' P' : ''}`;
    }
    console.error(line);
  }
  process.exit(0);
}
const report = [];
for (const id of ids) {
  const car = await load(id);
  const row = { id, lods: [] };
  const lod0 = concat(car.SET.map((p) => car.lods[0].parts[p].pos));
  let half = 0; for (let i = 0; i < lod0.length; i++) half = Math.max(half, Math.abs(lod0[i])); half *= 1.05;
  for (const [li, L] of car.lods.entries()) {
    const all = concat(car.SET.map((p) => L.parts[p].pos));
    const tris = all.length / 9;
    let sliver = 0;
    for (let t = 0; t < tris; t++) { const { a, b, c, area } = triNormal(all, t); const lmax = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)); if (area < 1e-7 || (2 * area) / lmax < 5e-4) sliver++; }
    // hidden: (1) self-hidden within its own part (always safe to drop: no part state reveals it); (2) hidden in the intact car
    let selfHidden = 0, carHidden = 0, cop = 0, copRegions = 0, start = 0;
    const perPart = {};
    for (const p of car.SET) {
      const pp = L.parts[p].pos, n = pp.length / 9;
      const vs = visibility(pp, 0, n), vc = visibility(all, start, n);
      const sh = n - vs.reduce((s, x) => s + x, 0), ch = n - vc.reduce((s, x) => s + x, 0);
      const c = coplanar(pp, L.parts[p].uv);
      selfHidden += sh; carHidden += ch; cop += c.saved; copRegions += c.regions; start += n;
      perPart[p] = { tris: n, selfHidden: sh, carHidden: ch, coplanarSaved: c.saved };
    }
    const entry = { lod: li, tris, maxTris: L.maxTris, sliver, selfHidden, carHidden, coplanarSaved: cop, coplanarRegions: copRegions, perPart };
    if (li > 0) {
      entry.hand = compare(lod0, all, half);
      // meshopt from LOD0, per part, the same per-part triangle counts as the hand LOD
      const auto = concat(car.SET.map((p) => simplify(car.lods[0].parts[p].pos, L.parts[p].pos.length / 9)));
      entry.meshopt = { tris: auto.length / 9, ...compare(lod0, auto, half) };
      const seam = concat(car.SET.map((p) => simplify(car.lods[0].parts[p].pos, L.parts[p].pos.length / 9, car.lods[0].parts[p].uv)));
      entry.meshoptSeams = { tris: seam.length / 9, ...compare(lod0, seam, half) };
    }
    row.lods.push(entry);
    console.error(`${id} lod${li}: ${tris}/${L.maxTris} sliver ${sliver} selfHidden ${selfHidden} carHidden ${carHidden} coplanar -${cop}${entry.hand ? ` | hand IoU ${entry.hand.iou.toFixed(3)} dz ${entry.hand.depthMm.toFixed(1)}mm | meshopt ${entry.meshopt.tris}t IoU ${entry.meshopt.iou.toFixed(3)} dz ${entry.meshopt.depthMm.toFixed(1)}mm | seams ${entry.meshoptSeams.tris}t IoU ${entry.meshoptSeams.iou.toFixed(3)} dz ${entry.meshoptSeams.depthMm.toFixed(1)}mm` : ''}`);
  }
  report.push(row);
}
fs.writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(report, null, 1));
