// intact.js — "intact fast path": bake every non-wheel part into one merged mesh per material; hide the per-part
// meshes until the car is first damaged. Draw calls per undamaged car drop from ~75 to ~20 with zero visual change.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function bakeIntact(car, { keepSeparate = (p) => p.userData.jj?.kind === 'wheel' } = {}) {
  car.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(car.matrixWorld).invert();
  const buckets = new Map(); let parts = 0;
  for (const part of car.children) {
    if (part.userData.intactProxy || (part.userData.jj && keepSeparate(part)) || !part.isGroup) continue;
    part.traverse((m) => {
      if (!m.isMesh || m.userData.isInk) return;
      const g = m.geometry.clone(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const key = m.material.uuid; let b = buckets.get(key); if (!b) { b = { mat: m.material, list: [], name: m.userData.kind }; buckets.set(key, b); } b.list.push(g);
    });
    parts++;
  }
  const proxy = new THREE.Group(); proxy.name = 'intactProxy'; proxy.userData.intactProxy = true;
  for (const b of buckets.values()) { const mesh = new THREE.Mesh(mergeGeometries(b.list, false), b.mat); mesh.castShadow = b.name !== 'glass'; mesh.receiveShadow = true; mesh.userData.kind = b.name; proxy.add(mesh); }
  car.add(proxy); car.userData.intact = proxy; setPartsVisible(car, false);
  return { meshes: proxy.children.length, parts };
}
export function setPartsVisible(car, on) {
  for (const part of car.children) if (!part.userData.intactProxy && part.isGroup && !(part.userData.jj?.kind === 'wheel')) part.visible = on;
}
export function wake(car) {   // first damage: swap the merged proxy for the individual parts
  const p = car.userData.intact; if (!p || !p.visible) return;
  p.visible = false; setPartsVisible(car, true);
}
export function showIntact(car) { const p = car.userData.intact; if (!p) return; p.visible = true; setPartsVisible(car, false); }
