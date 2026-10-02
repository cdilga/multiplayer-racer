// evidence.mjs — damage strip, LOD ladder (shaded + wire + 100/40 px thumbnails), recolours. node evidence.mjs [only=damage,ladder,paint]
import fs from 'node:fs'; import { open, close, OUT, saveDataURL } from './lib.mjs';
const only = (process.argv.find((a) => a.startsWith('only=')) ?? '').slice(5).split(',').filter(Boolean), want = (k) => !only.length || only.includes(k);
const page = await open(); const P = JSON.parse(fs.readFileSync(new URL('./params.json', import.meta.url)));
await page.evaluate((P) => window.__j.setP(P), P);
const D = `${OUT}evidence/`; fs.mkdirSync(D, { recursive: true });
const shot = async (file, w, h, o) => saveDataURL(D + file, await page.evaluate(([w, h, o]) => window.__j.shaded('hero', w, h, o), [w, h, o]));
const meta = {};
if (want('damage')) {
  const STAGES = [
    ['0_intact', {}],
    ['1_dented', { front: 'dented', door_FR: 'dented', back: 'dented' }],
    ['2_doors_wheel', { front: 'dented', door_FR: 'detached', door_RR: 'dented', wheel_FR: 'detached', back: 'dented' }],
    ['3_front_gone', { front: 'detached', door_FR: 'detached', door_RR: 'detached', wheel_FR: 'detached', back: 'dented' }],
    ['4_shell', { front: 'detached', back: 'detached', door_FR: 'detached', door_RR: 'detached', door_FL: 'detached', wheel_FR: 'detached', wheel_RR: 'detached' }],
  ];
  for (const lod of [0, 1]) { await page.evaluate((l) => window.__j.setLod(l), lod);
    for (const [name, st] of STAGES) { await page.evaluate((st) => window.__j.damage(st), st); await shot(`damage_L${lod}_${name}.png`, 640, 420, { az: 50, elev: 16, dist: 10.5, fov: 26 }); }
    await page.evaluate((st) => window.__j.damage(st), STAGES[4][1]); await shot(`damage_L${lod}_4_shell_rear.png`, 640, 420, { az: 145, elev: 18, dist: 14, fov: 26 });
  }
  await page.evaluate(() => window.__j.damage({}));
}
if (want('ladder')) {
  meta.lods = {};
  for (const lod of [0, 1, 2]) {
    const st = await page.evaluate((l) => window.__j.setLod(l), lod); meta.lods[lod] = st;
    for (const [v, o] of [['hero', { az: 50, elev: 12, dist: 11, fov: 26 }], ['rear', { az: 140, elev: 14, dist: 11, fov: 26 }]]) {
      await shot(`ladder_L${lod}_${v}.png`, 900, 520, o);
      await page.evaluate(() => window.__j.wire(true)); await shot(`ladder_L${lod}_${v}_wire.png`, 900, 520, o); await page.evaluate(() => window.__j.wire(false));
    }
    // thumbnails as a game tile would see them: chase-cam framing at 100 px and 40 px car height
    for (const px of [100, 40]) await shot(`ladder_L${lod}_thumb${px}.png`, Math.round(px * 2.6), Math.round(px * 1.3), { az: 160, elev: 14, dist: 10, fov: 26 });
    meta.lods[lod].eval_lod1 = (await page.evaluate(() => window.__j.evaluate('lod1'))).views;
    meta.lods[lod].eval_lowest = (await page.evaluate(() => window.__j.evaluate('lowest'))).views;
  }
  await page.evaluate(() => window.__j.setLod(0));
}
if (want('paint')) {
  for (const [n, c] of [['cyan', '#22c3e6'], ['gold', '#f2b51c'], ['red', '#e8322b'], ['purple', '#7a4dff']]) { await page.evaluate((c) => window.__j.repaint({ paint: c }), c); await shot(`paint_${n}.png`, 520, 300, { az: 40, elev: 12, dist: 11, fov: 26 }); }
  await page.evaluate(() => window.__j.repaint({}));
}
fs.writeFileSync(D + 'meta.json', JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta.lods ? Object.fromEntries(Object.entries(meta.lods).map(([k, v]) => [k, { tris: v.tris, draws: v.draws, lod1: Object.values(v.eval_lod1).map((x) => x.iou), lowest: Object.values(v.eval_lowest).map((x) => x.iou) }])) : {}));
await close();
