// Pixel comparison for the kit tests (art/ui/lib/shot.mjs only captures; it has no compare mode). Decodes two PNGs with
// pngjs (repo-root dev dependency) and reports the share of pixels whose largest channel difference exceeds `channel`.
import { PNG } from 'pngjs';

/** @returns {{ width: number, height: number, sameSize: boolean, differing: number, ratio: number }} */
export function compare(aPng, bPng, channel = 40) {
  const a = PNG.sync.read(aPng);
  const b = PNG.sync.read(bPng);
  if (a.width !== b.width || a.height !== b.height) return { width: a.width, height: a.height, sameSize: false, differing: a.width * a.height, ratio: 1 };
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (d > channel) differing++;
  }
  return { width: a.width, height: a.height, sameSize: true, differing, ratio: differing / (a.width * a.height) };
}

/** Decodes a PNG to { width, height, data } (RGBA). */
export const decode = (png) => PNG.sync.read(png);
