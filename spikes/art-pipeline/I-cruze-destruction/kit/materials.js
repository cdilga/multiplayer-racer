// materials.js — the four slot materials (browser side). All vertex-coloured, all with the kit's fresnel rim.
//   paint  MeshPhysicalMaterial, clearcoat; per car: a clone with the identity colour
//   trim   MeshStandardMaterial with the trim atlas; roughness/metalness per vertex from the `pbr` attribute
//   glass  MeshPhysicalMaterial (opaque, glossy); a shared "smashed" variant
//   lamp   MeshBasicMaterial; per-vertex `emit` class × per-car uniforms (head / brake / indicator); a shared "dead" variant
import * as THREE from 'three';
import { ATLAS } from './slots.js';

const RIM = `float rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.2);
  outgoingLight += vec3(1.0, 0.914, 0.8) * (rimF * 0.35) * (0.35 + 0.65 * dot(diffuseColor.rgb, vec3(0.333)));
  #include <opaque_fragment>`;
function rim(mat, extra) {
  mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', RIM); extra?.(sh); };
  mat.customProgramCacheKey = () => 'jjI-' + mat.name;
  return mat;
}
let atlas = null;
function trimAtlas() {
  if (atlas) return atlas;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d'), w = 256;
  g.fillStyle = '#101014'; g.fillRect(0, 0, w, 64);                      // honeycomb (top half = v .5..1)
  g.strokeStyle = '#3d3f49'; g.lineWidth = 2.4; const r = 9;
  for (let row = -1; row < 64 / (r * 1.5) + 1; row++) for (let col = -1; col < w / (r * 1.75) + 1; col++) {
    const cx = col * r * 1.75 + (row % 2 ? r * 0.875 : 0), cy = row * r * 1.5; g.beginPath();
    for (let q = 0; q < 6; q++) { const an = Math.PI / 6 + (q * Math.PI) / 3; g.lineTo(cx + Math.cos(an) * r * 0.92, cy + Math.sin(an) * r * 0.92); } g.closePath(); g.stroke();
  }
  g.fillStyle = '#16161b'; g.fillRect(0, 64, w, 56); g.fillStyle = '#3a3c46'; for (let i = 0; i < 5; i++) g.fillRect(0, 69 + i * 10, w, 3.5);   // slats v .0625..5
  g.fillStyle = '#ffffff'; g.fillRect(0, 120, w, 8);                                                                                       // white texel strip v 0..0.0625
  atlas = new THREE.CanvasTexture(c); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  return atlas;
}
const shared = {};
export function slotMaterials() {
  if (shared.trim) return shared;
  shared.trim = rim(Object.assign(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, map: trimAtlas() }), { name: 'trim' }), (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vPbr.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vPbr.y;');
  });
  shared.glass = rim(Object.assign(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 }), { name: 'glass' }));
  // swap-in materials keep vertexColors on (the geometry carries colour morphs) but ignore the vertex colour
  shared.glassSmashed = rim(Object.assign(new THREE.MeshStandardMaterial({ color: '#6f8294', roughness: 0.5, metalness: 0.1, vertexColors: true }), { name: 'glassSmashed' }), (sh) => {
    // crazed safety glass: a cheap procedural crack web in view space (no texture), only on the smashed variant
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb = diffuse;
      vec2 cp = gl_FragCoord.xy * 0.045; vec2 cf = abs(fract(cp + 0.5 * sin(cp.yx * 1.7)) - 0.5); float cr = smoothstep(0.06, 0.0, min(cf.x, cf.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92), cr * 0.65);`);
  });
  shared.lampDead = rim(Object.assign(new THREE.MeshStandardMaterial({ color: '#2a2b30', roughness: 0.5, vertexColors: true }), { name: 'lampDead' }), (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = diffuse;');
  });
  shared.paintInner = null;
  return shared;
}
/** per-car instances of the tinted / driven slots */
export function carMaterials(paint) {
  const s = slotMaterials();
  const p = rim(Object.assign(new THREE.MeshPhysicalMaterial({ vertexColors: true, color: paint, metalness: 0.55, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.3 }), { name: 'paint' }));
  const lamp = Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true }), { name: 'lamp' });
  lamp.userData.u = { uHead: { value: 1 }, uBrake: { value: 0.55 }, uInd: { value: 0.8 } };
  lamp.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lamp.userData.u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float emit;\nvarying float vEmit;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = emit;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEmit;\nuniform float uHead, uBrake, uInd;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float k = vEmit < 1.5 ? uHead : (vEmit < 2.5 ? uBrake : uInd);
        diffuseColor.rgb *= mix(0.35, 1.6, k);`);
  };
  lamp.customProgramCacheKey = () => 'jjI-lamp';
  return { paint: p, trim: s.trim, glass: s.glass, lamp };
}
export { ATLAS };
