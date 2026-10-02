// calib.mjs — pick the evaluation camera distance that best explains the reference views for the current model.
import fs from 'node:fs'; import { open, close } from './lib.mjs';
const page = await open(); const pf = new URL('./params.json', import.meta.url);
if (fs.existsSync(pf)) await page.evaluate((P) => window.__j.setP(P), JSON.parse(fs.readFileSync(pf)));
for (const d of [0, 40, 20, 14, 10, 8, 6.5]) {
  const r = await page.evaluate(async (d) => { window.__j.setCamD(d); return window.__j.evaluate('lod1'); }, d);
  console.log(String(d).padStart(4), r.score, Object.entries(r.views).map(([k, v]) => `${k} ${v.iou} a${v.aspect}`).join('  '));
}
await close();
