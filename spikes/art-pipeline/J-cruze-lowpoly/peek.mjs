// peek.mjs — quick look: node peek.mjs name lod az elev dist fov [wire] [targetY]
import fs from 'node:fs'; import { open, close, OUT, saveDataURL } from './lib.mjs';
const [name = 'peek', lod = 0, az = 60, elev = 10, dist = 11, fov = 26, wire = 0] = process.argv.slice(2);
const page = await open(); const pf = new URL('./params.json', import.meta.url);
await page.evaluate(([P, l, w]) => { if (P) window.__j.setP(P); window.__j.setLod(+l); window.__j.wire(!!+w); }, [fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf)) : null, lod, wire]);
saveDataURL(`${OUT}${name}.png`, await page.evaluate((o) => window.__j.shaded('hero', 1200, 700, o), { az: +az, elev: +elev, dist: +dist, fov: +fov }));
await close();
