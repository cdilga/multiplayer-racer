#!/usr/bin/env node
// extract.mjs (br-bwju.3, from Spike J's refs/extract.mjs): cut each view out of a vehicle's reference sheets and turn it
// into a silhouette mask for the fit page.
//   node tools/vehicles/fit/extract.mjs <vehicle id>  →  art/vehicles/<id>/refs/masks/<sheet>_<view>.{mask,crop}.png + index.json
// The sheets, view windows, any segment options (`segment`: { sat, dark, bright }) the opening radius (`open`, default 5) and the
// component share kept (`keep`, see mask.js largest)
// come from art/vehicles/<id>/refs/sheets.json. Segmentation: car = saturated OR dark; holes are filled by flooding the
// background from the border; an opening (radius `open`) drops whips and antennas (a bike wants a small one: its forks and
// frame are thin, and a wide opening cuts the front wheel off); the largest
// component wins. The fit page applies the same opening to its renders, so thin parts count the same on both sides.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { segment, openMask, largest, bbox, cropMask } from './mask.js';

const id = process.argv[2];
if (!id) { console.error('usage: extract.mjs <vehicle id>'); process.exit(2); }
const dir = path.join('art/vehicles', id, 'refs');
const { sheets, views, segment: seg = {}, open: OPEN = 5, keep: KEEP = 0, patch = {} } = JSON.parse(fs.readFileSync(path.join(dir, 'sheets.json'), 'utf8'));
const write = (file, png) => fs.writeFileSync(path.join(dir, 'masks', file), PNG.sync.write(png));

fs.mkdirSync(path.join(dir, 'masks'), { recursive: true });
const index = {};
for (const [sheet, file] of Object.entries(sheets)) {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
  for (const [view, [x0, y0, x1, y1]] of Object.entries(views)) {
    const w = x1 - x0, h = y1 - y0, rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) rgba.set(png.data.subarray(((y0 + y) * png.width + x0) * 4, ((y0 + y) * png.width + x1) * 4), y * w * 4);
    const seg0 = segment(rgba, w, h, seg);
    // `patch`: { view: [[cx, cy, rx, ry]] } ellipses in sheet pixels added to the mask (a white helmet the grey backdrop swallows; br-bwju.11)
    for (const [cx, cy, rx, ry] of patch[view] ?? []) for (let y = Math.max(0, Math.floor(cy - ry - y0)); y < Math.min(h, Math.ceil(cy + ry - y0)); y++) for (let x = Math.max(0, Math.floor(cx - rx - x0)); x < Math.min(w, Math.ceil(cx + rx - x0)); x++) if (((x + x0 - cx) / rx) ** 2 + ((y + y0 - cy) / ry) ** 2 <= 1) seg0[y * w + x] = 1;
    const m = largest(openMask(seg0, w, h, OPEN), w, h, KEEP), b = bbox(m, w, h), cm = cropMask(m, w, b);
    const mask = new PNG({ width: b.w, height: b.h }), crop = new PNG({ width: b.w, height: b.h });
    for (let i = 0; i < b.w * b.h; i++) { const v = cm[i] ? 255 : 0; mask.data.set([v, v, v, 255], i * 4); }
    for (let y = 0; y < b.h; y++) crop.data.set(rgba.subarray(((b.y + y) * w + b.x) * 4, ((b.y + y) * w + b.x + b.w) * 4), y * b.w * 4);
    write(`${sheet}_${view}.mask.png`, mask);
    write(`${sheet}_${view}.crop.png`, crop);
    index[`${sheet}_${view}`] = { sheet, view, x: x0 + b.x, y: y0 + b.y, w: b.w, h: b.h, aspect: +(b.w / b.h).toFixed(4) };
  }
}
fs.writeFileSync(path.join(dir, 'masks', 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
for (const [k, v] of Object.entries(index)) console.log(k.padEnd(14), `${v.w}×${v.h}`, 'aspect', v.aspect);
