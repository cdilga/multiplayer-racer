// measure.mjs — profiles from the reference masks, in metres (scale from L = 4.5 m).
// side: top/bottom height per station; top view: half width per station; front/rear: half width per height.
import fs from 'node:fs'; import { PNG } from 'pngjs';
const sheet = process.argv[2] || 'lod1', L = 4.5;
const rd = (v) => { const p = PNG.sync.read(fs.readFileSync(new URL(`./masks/${sheet}_${v}.mask.png`, import.meta.url))); const m = (x, y) => p.data[(y * p.width + x) * 4] > 127; return { w: p.width, h: p.height, m }; };
const S = rd('side'), T = rd('top'), F = rd('front'), R = rd('rear');
const mpp = L / S.w; // side: car faces LEFT in the sheet (nose at x=0)
const out = { sheet, L, H: +(S.h * mpp).toFixed(3), side: [], plan: [], front: [], rear: [] };
for (let i = 0; i <= 40; i++) {
  const t = i / 40, x = Math.min(S.w - 1, Math.round(t * (S.w - 1)));
  let top = -1, bot = -1; for (let y = 0; y < S.h; y++) if (S.m(x, y)) { if (top < 0) top = y; bot = y; }
  out.side.push([+(L / 2 - t * L).toFixed(3), +((S.h - top) * mpp).toFixed(3), +((S.h - 1 - bot) * mpp).toFixed(3)]); // [z (front +), y_top, y_bottom]
}
const tm = L / T.h; // top view: nose at the BOTTOM of the sheet
out.W = +(T.w * tm).toFixed(3);
for (let i = 0; i <= 40; i++) {
  const t = i / 40, y = Math.min(T.h - 1, Math.round(t * (T.h - 1)));
  let a = -1, b = -1; for (let x = 0; x < T.w; x++) if (T.m(x, y)) { if (a < 0) a = x; b = x; }
  out.plan.push([+(-L / 2 + t * L).toFixed(3), +((b - a + 1) / 2 * tm).toFixed(3)]);
}
for (const [k, V] of [['front', F], ['rear', R]]) {
  const mp = out.H / V.h; out[k + 'W'] = +(V.w * mp).toFixed(3);
  for (let i = 0; i <= 20; i++) { const y = Math.min(V.h - 1, Math.round((1 - i / 20) * (V.h - 1))); let a = -1, b = -1; for (let x = 0; x < V.w; x++) if (V.m(x, y)) { if (a < 0) a = x; b = x; } out[k].push([+((i / 20) * out.H).toFixed(3), +((b - a + 1) / 2 * mp).toFixed(3)]); }
}
fs.writeFileSync(new URL(`./profile_${sheet}.json`, import.meta.url), JSON.stringify(out));
console.log('L', L, 'H', out.H, 'W(top)', out.W, 'W(front)', out.frontW, 'W(rear)', out.rearW);
console.log('side [z, top, bottom]:', out.side.map((r) => r.join('/')).join('  '));
console.log('plan [z, halfW]:', out.plan.map((r) => r.join('/')).join('  '));
console.log('front [y, halfW]:', out.front.map((r) => r.join('/')).join('  '));
console.log('rear [y, halfW]:', out.rear.map((r) => r.join('/')).join('  '));
