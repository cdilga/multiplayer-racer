// node capture_all.mjs — generates every evidence image/video/metric for the spike into out/.
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = 'out';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const url = (o) => `http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&${o}`;
async function open(w, h, opts = '') {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()); });
  await page.goto(url(`w=${w}&h=${h}&${opts}`));
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  return page;
}
const snap = async (page, name) => { await page.evaluate(() => window.__demo.render()); await page.screenshot({ path: `${OUT}/${name}.png` }); };
const look = (page, t, az, el, d, fov = 30) => page.evaluate(([t, az, el, d, fov]) => window.__demo.look(t, az, el, d, fov), [t, az, el, d, fov]);
const metrics = {};

// ── Cruze: heroes, turnaround, orthographic views, ink, wireframe, exploded
for (const [tag, paint, accent] of [['gold', 'e0a520', 'd8362f'], ['red', 'e0392f', 'ffd23f'], ['silver', 'b6bac3', 'e0392f'], ['teal', '17b3b0', 'ffd23f']]) {
  const page = await open(1400, 900, `model=cruze&paint=${paint}&accent=${accent}&nointact=1`);
  await look(page, [0, 0.75, 0.1], 34, 15, 7.2, 28); await snap(page, `cruze_hero_${tag}`);
  await look(page, [0, 0.72, -0.1], 148, 15, 6.9, 28); await snap(page, `cruze_hero_rear_${tag}`);
  if (tag === 'gold') {
    await page.setViewportSize({ width: 2400, height: 1200 }); await page.evaluate(() => window.__demo.stage.setSize(2400, 1200));
    const cw = 800, ch = 600, T = [0, 0.75, 0], d = 9;
    await page.evaluate(([cw, ch, T, d]) => {
      const s = window.__demo.stage; s.renderViews([
        { x: 0, y: 0, w: cw, h: ch, target: T, az: 35, el: 16, dist: d, fov: 28 }, { x: cw, y: 0, w: cw, h: ch, target: T, az: 90, el: 1, dist: d * 1.9, fov: 14 }, { x: 2 * cw, y: 0, w: cw, h: ch, target: T, az: 145, el: 16, dist: d, fov: 28 },
        { x: 0, y: ch, w: cw, h: ch, target: T, az: 0, el: 1, dist: d * 1.9, fov: 14 }, { x: cw, y: ch, w: cw, h: ch, target: T, az: 0, el: 89, dist: d * 1.9, fov: 14 }, { x: 2 * cw, y: ch, w: cw, h: ch, target: T, az: 180, el: 1, dist: d * 1.9, fov: 14 }]);
    }, [cw, ch, T, d]);
    await page.screenshot({ path: `${OUT}/cruze_turnaround.png` });
    await page.setViewportSize({ width: 1400, height: 900 }); await page.evaluate(() => window.__demo.stage.setSize(1400, 900));
    // near-orthographic elevations for the reference comparison
    for (const [n, az, el] of [['front', 0, 0.5], ['side', 90, 0.5], ['rear', 180, 0.5]]) { await look(page, [0, 0.8, 0], az, el, 40, 6.2); await snap(page, `cruze_ortho_${n}`); }
    // ink
    await page.evaluate(() => window.__demo.setInk(true)); await look(page, [0, 0.72, 0.15], 34, 15, 6.9, 28); await snap(page, 'cruze_hero_ink'); await page.evaluate(() => window.__demo.setInk(false));
    // wireframe
    await page.evaluate(() => window.__demo.car.traverse((o) => { if (o.isMesh) o.material.wireframe = true; })); await snap(page, 'cruze_wire');
    await page.evaluate(() => window.__demo.car.traverse((o) => { if (o.isMesh) o.material.wireframe = false; }));
    // exploded
    await look(page, [0, 0.9, 0], 38, 22, 11.5, 28); await page.evaluate(() => window.__demo.explode(1.3)); await snap(page, 'cruze_exploded'); await page.evaluate(() => window.__demo.explode(0));
  }
  await page.close();
}
// ── bin: hero, turnaround, ink
{
  const page = await open(1400, 900, 'model=bin&nointact=1');
  await look(page, [0, 0.55, 0], 36, 14, 4.6, 28); await snap(page, 'bin_hero');
  await page.evaluate(() => window.__demo.setInk(true)); await snap(page, 'bin_hero_ink'); await page.evaluate(() => window.__demo.setInk(false));
  await page.setViewportSize({ width: 2400, height: 1200 }); await page.evaluate(() => window.__demo.stage.setSize(2400, 1200));
  const cw = 800, ch = 600, T = [0, 0.55, 0], d = 5;
  await page.evaluate(([cw, ch, T, d]) => { const s = window.__demo.stage; s.renderViews([
    { x: 0, y: 0, w: cw, h: ch, target: T, az: 35, el: 14, dist: d, fov: 28 }, { x: cw, y: 0, w: cw, h: ch, target: T, az: 90, el: 1, dist: d * 1.9, fov: 14 }, { x: 2 * cw, y: 0, w: cw, h: ch, target: T, az: 145, el: 14, dist: d, fov: 28 },
    { x: 0, y: ch, w: cw, h: ch, target: T, az: 0, el: 1, dist: d * 1.9, fov: 14 }, { x: cw, y: ch, w: cw, h: ch, target: T, az: 0, el: 89, dist: d * 1.9, fov: 14 }, { x: 2 * cw, y: ch, w: cw, h: ch, target: T, az: 180, el: 1, dist: d * 1.9, fov: 14 }]); }, [cw, ch, T, d]);
  await page.screenshot({ path: `${OUT}/bin_turnaround.png` });
  await page.close();
}
// ── LOD comparison + metrics
for (const lod of [0, 1, 2, 3]) {
  const page = await open(900, 600, `model=cruze&lod=${lod}&nointact=1`);
  await look(page, [0, 0.72, 0.15], 34, 15, 6.9, 28); await snap(page, `cruze_lod${lod}`);
  await page.evaluate(() => window.__demo.car.traverse((o) => { if (o.isMesh) o.material.wireframe = true; })); await snap(page, `cruze_lod${lod}_wire`);
  metrics[`cruze_lod${lod}`] = await page.evaluate(() => { const c = window.__demo.car; let tris = 0, draws = 0, bytes = 0; const mats = new Set(); c.traverse((o) => { if (o.isMesh) { draws++; tris += o.geometry.index.count / 3; mats.add(o.material.uuid); for (const a of Object.values(o.geometry.attributes)) bytes += a.array.byteLength; bytes += o.geometry.index.array.byteLength; } }); return { tris: Math.round(tris), draws, materials: mats.size, geometryKB: Math.round(bytes / 1024), buildMs: Math.round(c.userData.buildMs) }; });
  await page.close();
}
for (const lod of [0, 1, 2]) {
  const page = await open(900, 600, `model=bin&lod=${lod}&nointact=1`);
  metrics[`bin_lod${lod}`] = await page.evaluate(() => { const c = window.__demo.car; let tris = 0, draws = 0, bytes = 0; const mats = new Set(); c.traverse((o) => { if (o.isMesh) { draws++; tris += o.geometry.index.count / 3; mats.add(o.material.uuid); for (const a of Object.values(o.geometry.attributes)) bytes += a.array.byteLength; bytes += o.geometry.index.array.byteLength; } }); return { tris: Math.round(tris), draws, materials: mats.size, geometryKB: Math.round(bytes / 1024), buildMs: Math.round(c.userData.buildMs) }; });
  await page.close();
}
// intact fast path
{
  const page = await open(900, 600, 'model=cruze');
  metrics.cruze_intact = await page.evaluate(() => { window.__demo.render(); const i = window.__demo.stage.renderer.info; return { draws: i.render.calls, tris: i.render.triangles, bake: window.__demo.car.userData.intactInfo }; });
  await page.close();
}
fs.writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 1));
console.log(JSON.stringify(metrics, null, 1));
await browser.close();
