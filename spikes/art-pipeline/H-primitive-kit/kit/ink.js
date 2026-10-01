// ink.js — comic outline as an inverted hull that pushes along the vertex normal in the vertex shader.
// Shares the mesh's BufferGeometry, so it follows CPU dents and detached parts for free (no rebuild).
import * as THREE from 'three';

let _mat;
function inkMaterial(width, color) {
  if (_mat) return _mat;
  _mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  _mat.userData.w = { value: width };
  _mat.onBeforeCompile = (sh) => {
    sh.uniforms.uInk = _mat.userData.w;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uInk;')
      .replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * uInk;');
  };
  _mat.customProgramCacheKey = () => 'jjink1';
  return _mat;
}
export function setInk(root, on, { width = 0.014, color = '#1b1511' } = {}) {
  const mat = inkMaterial(width, color);
  root.traverse((m) => {
    if (!m.isMesh || m.userData.isInk) return;
    const kind = m.userData.kind, mm = m.material;
    if (kind === 'emit' || mm.transparent || mm.alphaTest > 0) return;        // decals/lights don't get outlines
    const existing = m.children.find((c) => c.userData.isInk);
    if (on && !existing) {
      const h = new THREE.Mesh(m.geometry, mat); h.userData.isInk = true; h.castShadow = false; h.receiveShadow = false; h.renderOrder = -1;
      m.add(h);
    } else if (!on && existing) m.remove(existing);
  });
}
