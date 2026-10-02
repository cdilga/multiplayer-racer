// node peek.mjs '<js using D=window.__demo>' name [az el dist] — ad-hoc look while iterating
import { open, close, snap, look } from './lib.mjs';
const [, , code, name = 'peek', az = 35, el = 16, d = 7.5, tx = 0, ty = 0.7, tz = 0, fov = 30] = process.argv;
const page = await open(1400, 900);
const r = await page.evaluate(async (c) => { const D = window.__demo; return JSON.stringify(await (new Function('D', `return (async()=>{${c}})()`))(D)); }, code);
if (r && r !== 'undefined') console.log(r);
await look(page, [+tx, +ty, +tz], +az, +el, +d, +fov); await snap(page, name);
await close();
