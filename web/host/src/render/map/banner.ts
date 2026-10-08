// The race-banner across the finish (P1-R10, R106): the two `wayfinding/finish-gantry` legs the map places each side of the
// road, a light truss bar between their tops and a long ink banner hung under it, "START · FINISH" with FINISH in saffron,
// a slanted saffron end panel with our name and a chequered end (R102). Never sponsors or "Checkpoint N". Two draws for
// the banner (a face each way, so the type reads the right way round from either side) and one for the truss.
import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from '../kit/shapes';
import { toon } from '../look';
import type { MapJson } from './map';

const GANTRY = 'wayfinding/finish-gantry';
const INK = '#15203a';
const SAFFRON = '#f2a20c';
const PAPER = '#fff4de';
/** Nearer the camera than this (m), the banner isn't drawn. */
const NEAR_M = 4;

/** The banner's artwork, `w` x `h` px. */
export function bannerCanvas(w = 2048, h = 256): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = INK;
  g.fillRect(0, 0, w, h);
  // The slanted saffron end panel with our name.
  g.fillStyle = SAFFRON;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w * 0.27, 0);
  g.lineTo(w * 0.24, h);
  g.lineTo(0, h);
  g.fill();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.font = `900 ${h * 0.3}px "Barlow Condensed", "Arial Narrow", Impact, sans-serif`;
  g.fillText('JOYSTICK', w * 0.125, h * 0.46);
  g.fillText('JAMMERS', w * 0.125, h * 0.78);
  // START · FINISH
  g.font = `900 italic ${h * 0.62}px "Barlow Condensed", "Arial Narrow", Impact, sans-serif`;
  g.textAlign = 'left';
  g.fillStyle = PAPER;
  const start = 'START · ';
  const x0 = w * 0.31;
  g.fillText(start, x0, h * 0.74);
  g.fillStyle = SAFFRON;
  g.fillText('FINISH', x0 + g.measureText(start).width, h * 0.74);
  // The chequered end.
  const cx = w * 0.84;
  const sq = h / 6;
  for (let i = 0; i < Math.ceil((w - cx) / sq); i++) for (let j = 0; j < 6; j++) if ((i + j) % 2 === 0) { g.fillStyle = PAPER; g.fillRect(cx + i * sq, j * sq, sq, sq); }
  g.strokeStyle = PAPER;
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  return c;
}

/** The banner, its back and the truss as scene objects, or null when the map has no pair of gantry legs. */
export function finishBanner(map: MapJson): Object3D[] | null {
  const legs = map.dressing.filter((d) => d.kitPiece === GANTRY);
  if (legs.length < 2) return null;
  const [a, b] = legs as [(typeof legs)[number], (typeof legs)[number]];
  const top = (d: typeof a) => new Vector3(d.pose.x / 1000, d.pose.y / 1000 + (d.params?.heightCm ?? 520) / 100, d.pose.z / 1000);
  const pa = top(a);
  const pb = top(b);
  const span = pa.distanceTo(pb) - 0.6; // between the legs' inner faces
  if (span <= 1) return null;
  const mid = pa.clone().add(pb).multiplyScalar(0.5);
  const yaw = Math.atan2(-(pb.z - pa.z), pb.x - pa.x); // rotation.y that lays a plane's width along a -> b
  const height = Math.min(1.7, span / 7);
  const tex = new CanvasTexture(bannerCanvas());
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  const face = (side: 1 | -1) => {
    const mat = new MeshBasicMaterial({ map: tex, fog: true });
    // A chase camera passes under (or, on a low gantry, through) the banner at the start: within NEAR_M of the camera the
    // banner is not drawn, so it never fills a tile (eris capture, 2026-10-08: the pole car's tile was all "START").
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vBannerDepth;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvBannerDepth = -mvPosition.z;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vBannerDepth;')
        .replace('void main() {', `void main() {\n  if ( vBannerDepth < ${NEAR_M.toFixed(1)} ) discard;`);
    };
    const m = new Mesh(new PlaneGeometry(span - 0.3, height), mat);
    m.rotation.y = yaw + (side === 1 ? 0 : Math.PI);
    m.position.copy(mid);
    m.position.y -= 0.35 + height / 2;
    // Offset along the plane normal so the two faces never fight over the same pixels.
    m.position.x += Math.sin(m.rotation.y) * 0.02;
    m.position.z += Math.cos(m.rotation.y) * 0.02;
    m.name = `finish-banner.${side === 1 ? 'front' : 'back'}`;
    return m;
  };
  // The back reads correctly from the other side: its own flipped texture is a rotation by a half turn, so nothing mirrors.
  const truss = paint(new BoxGeometry(span + 0.6, 0.12, 0.12), '#d6dae0');
  const rail = paint(new BoxGeometry(span + 0.6, 0.05, 0.5).translate(0, 0.2, 0), '#2b3a67');
  const bar = new Mesh(merge2(truss, rail), toon(new MeshLambertMaterial({ vertexColors: true }), {}));
  bar.position.copy(mid);
  bar.position.y -= 0.08;
  bar.rotation.y = yaw;
  bar.castShadow = true;
  bar.name = 'finish-banner.truss';
  return [face(1), face(-1), bar];
}

function merge2(...g: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)))!;
}
