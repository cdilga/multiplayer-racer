// extract.mjs — cut the orthographic-ish views out of the owner's reference sheets and turn each into a silhouette mask.
// node refs/extract.mjs  →  refs/masks/<sheet>_<view>.{mask.png,crop.png} + refs/masks/index.json
// Segmentation: car = saturated OR dark; holes (white livery, headlights) are filled by flooding the background from the
// window border; a morphological opening (radius OPEN) drops the whip aerial; the largest component wins. The same
// opening is applied to our renders (mask.js), so thin parts are treated identically on both sides.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { segment, openMask, largest, bbox, cropMask } from '../mask.js';
function writeMask(file, m, w, h) {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) { const v = m[i] ? 255 : 0; p.data[i * 4] = p.data[i * 4 + 1] = p.data[i * 4 + 2] = v; p.data[i * 4 + 3] = 255; }
  fs.writeFileSync(file, PNG.sync.write(p));
}

const HERE = new URL('./', import.meta.url).pathname;
const SHEETS = { lod1: '../../lod + 1.png', lowest: '../../lowest-lod.png', lod2: '../../lod + 2.png', max: '../../max lod.png' };
// [x0, y0, x1, y1] windows on the 1672×941 sheets; each holds exactly one view (largest component is taken).
const VIEWS = { hero: [20, 20, 1262, 612], top: [1280, 0, 1672, 668], front: [20, 612, 412, 941], side: [412, 622, 1205, 941], rear: [1215, 640, 1672, 941] };
export const OPEN = 5;

fs.mkdirSync(HERE + 'masks', { recursive: true });
const index = {};
for (const [sheet, file] of Object.entries(SHEETS)) {
  const png = PNG.sync.read(fs.readFileSync(HERE + file));
  for (const [view, [x0, y0, x1, y1]] of Object.entries(VIEWS)) {
    const w = x1 - x0, h = y1 - y0, rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) rgba.set(png.data.subarray(((y0 + y) * png.width + x0) * 4, ((y0 + y) * png.width + x1) * 4), y * w * 4);
    const m = largest(openMask(segment(rgba, w, h), w, h, OPEN), w, h);
    const b = bbox(m, w, h);
    const cm = cropMask(m, w, b);
    writeMask(HERE + `masks/${sheet}_${view}.mask.png`, cm, b.w, b.h);
    const crop = new PNG({ width: b.w, height: b.h });
    for (let y = 0; y < b.h; y++) crop.data.set(rgba.subarray(((b.y + y) * w + b.x) * 4, ((b.y + y) * w + b.x + b.w) * 4), y * b.w * 4);
    fs.writeFileSync(HERE + `masks/${sheet}_${view}.crop.png`, PNG.sync.write(crop));
    index[`${sheet}_${view}`] = { sheet, view, x: x0 + b.x, y: y0 + b.y, w: b.w, h: b.h, aspect: +(b.w / b.h).toFixed(4) };
  }
}
fs.writeFileSync(HERE + 'masks/index.json', JSON.stringify(index, null, 1));
for (const [k, v] of Object.entries(index)) console.log(k.padEnd(14), `${v.w}×${v.h}`, 'aspect', v.aspect);
