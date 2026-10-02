// damage.js — the simplified damage model (owner, 2026-10-02): front, back, four doors, four wheels.
// Each part has three states: intact → dented → detached. "Dented" is a second, precomputed geometry per part (crumpled
// toward the car, scuffed), so in the instanced renderer a dented part is just an instance in the "dented" InstancedMesh
// and a detached part is an instance whose matrix the physics drives — no per-car geometry, no extra draws per hit.
// Everything behind a removable part is a dark bay already in the core, so a missing part reads as an opening.
import * as THREE from 'three';

export const PARTS = ['front', 'back', 'door_FL', 'door_FR', 'door_RL', 'door_RR', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];

// impact centre (car space) and push direction per part; depth in metres
function impactFor(id, rest, bb) {
  const c = new THREE.Vector3(...rest);
  if (id === 'front') return { p: new THREE.Vector3(0.35, 0.75, c.z + bb.max.z), dir: new THREE.Vector3(-0.15, -0.25, -1).normalize(), r: 0.75, depth: 0.22 };
  if (id === 'back') return { p: new THREE.Vector3(-0.3, 0.8, c.z + bb.min.z), dir: new THREE.Vector3(0.1, -0.2, 1).normalize(), r: 0.7, depth: 0.2 };
  if (id.startsWith('door')) { const s = Math.sign(c.x); return { p: new THREE.Vector3(c.x + s * 0.05, 0.62, c.z + 0.05), dir: new THREE.Vector3(-s, -0.1, 0).normalize(), r: 0.55, depth: 0.2 }; }
  return null; // wheels don't dent; they wobble then detach
}
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

// crumple a part geometry (local to its pivot); vertices are deduplicated by position so the faceted shell stays closed
export function dentGeometry(geo, id, rest) {
  const g = geo.clone(); g.computeBoundingBox(); const imp = impactFor(id, rest, g.boundingBox); if (!imp) return g;
  const pos = g.attributes.position, col = g.attributes.color, v = new THREE.Vector3(), R = new THREE.Vector3(...rest);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).add(R);
    const d = v.distanceTo(imp.p) / imp.r; if (d >= 1) continue;
    const f = (1 - d * d) ** 2, n = hash(+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)) - 0.5;
    v.addScaledVector(imp.dir, imp.depth * f * (0.8 + 0.5 * n)); v.y += 0.02 * n * f;
    pos.setXYZ(i, v.x - R.x, v.y - R.y, v.z - R.z);
    const k = 1 - 0.35 * f * (0.6 + 0.4 * n); col.setXYZ(i, k, k, k); // scuff: darkens paint only (paint-key shader)
  }
  pos.needsUpdate = col.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// Demo helper for a single (non-instanced) car built by model.js: set a part's state.
// detached parts are re-parented to the scene at a resting pose next to the car (the game would hand them to Rapier).
export function setState(car, scene, id, state, restPose) {
  const mesh = car.parts[id]; if (!mesh) return;
  mesh.userData.intactGeo ??= mesh.geometry;
  mesh.userData.dentGeo ??= dentGeometry(mesh.userData.intactGeo, id, mesh.userData.rest);
  mesh.geometry = state === 'intact' ? mesh.userData.intactGeo : mesh.userData.dentGeo;
  if (state === 'detached') {
    scene.attach(mesh);
    if (restPose) { mesh.position.set(...restPose.p); mesh.rotation.set(...restPose.r); }
  } else if (mesh.parent !== car.group) { car.group.add(mesh); mesh.position.set(...mesh.userData.rest); mesh.rotation.set(0, 0, 0); }
}
