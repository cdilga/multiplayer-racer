import fs from 'node:fs'; import { open, close, OUT, saveDataURL } from './lib.mjs';
const page = await open(); await page.evaluate((P) => window.__j.setP(P), JSON.parse(fs.readFileSync('params.json')));
for (const [n, st] of [['a', {}], ['b', { front: 'dented', door_FR: 'dented', door_RR: 'dented' }]]) { await page.evaluate((st) => window.__j.damage(st), st); saveDataURL(`${OUT}dent_${n}.png`, await page.evaluate(() => window.__j.shaded('hero', 900, 520, { az: 55, elev: 14, dist: 8, fov: 30 }))); }
await close();
