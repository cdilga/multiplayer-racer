// instance.js — build once per LOD, instantiate per car. Geometry and materials are shared until a car is damaged
// (geometry is cloned lazily on first dent). Paint/accent are per-car tinted materials (identity colour).
import * as THREE from 'three';
import { tintedMaterial } from './kit.js';

export function instantiate(tpl, { paint, accent }) {
  // Object3D.clone() JSON-copies userData: hide live scene-graph / physics references while cloning, restore after
  const stash = [];
  tpl.traverse((o) => { const u = o.userData, keep = {}; let strip = false;
    for (const k of Object.keys(u)) if (['parts', 'ctx', 'intact', 'intactInfo', 'dmg', 'baseRot', 'spin', 'instanceOf', 'homeParent', 'home'].includes(k)) { keep[k] = u[k]; delete u[k]; strip = true; }
    if (strip) stash.push([o, keep]); });
  const car = tpl.clone(true);
  for (const [o, keep] of stash) Object.assign(o.userData, keep);
  const mats = { paint: tintedMaterial('paint', paint), accent: tintedMaterial('accent', accent) };
  car.traverse((o) => { if (o.isMesh && mats[o.userData.kind]) o.material = mats[o.userData.kind]; });
  const parts = {};
  for (const id of Object.keys(tpl.userData.parts)) parts[id] = car.getObjectByName(id);
  for (const p of Object.values(parts)) if (p?.userData?.jj?.kind === 'wheel') p.userData.spin = p.getObjectByName('spin');
  car.userData.parts = parts; car.userData.intact = car.children.find((c) => c.userData.intactProxy) ?? null;
  car.userData.instanceOf = tpl; return car;
}
/** called before a mesh's geometry is first modified: give it private buffers (and keep ink hulls in sync) */
export function ownGeometry(mesh) {
  if (mesh.userData.ownGeo) return; mesh.userData.ownGeo = true;
  const g = mesh.geometry.clone(); g.userData = {}; mesh.geometry = g;
  for (const c of mesh.children) if (c.userData.isInk) c.geometry = g;
}
