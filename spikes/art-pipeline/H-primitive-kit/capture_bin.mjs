import { chromium } from 'playwright';
const W = 1200, H = 800;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => { if (['error'].includes(m.type()) && !/404/.test(m.text())) console.log('CONSOLE', m.type(), m.text()); });
await page.goto(`http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&model=bin&w=${W}&h=${H}`);
await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
const shot = async (name) => { await page.evaluate(() => window.__demo.render()); await page.screenshot({ path: `out/${name}.png` }); };
await page.evaluate(() => window.__demo.look([0, 0.55, 0], 38, 16, 5.6, 30));
await shot('bin_00_pristine');
const steps = [
  ['bin_01_dents', [['chassis', 0.45], ['lid', 0.45]], 0.5],
  ['bin_02_lid_loose', [['lid', 0.6]], 0.8],
  ['bin_03_lid_off', [['lid', 0.95]], 0.5],
  ['bin_04_spill', [['chassis', 0.9]], 0.55],
  ['bin_05_settled', [], 2.4],
];
for (const [name, hits, wait] of steps) {
  for (const [id, sev] of hits) console.log(name, id, JSON.stringify(await page.evaluate(([i, s]) => window.__demo.hitPart(i, s), [id, sev])));
  await page.evaluate((w) => window.__demo.step(w), wait);
  await shot(name);
}
await page.evaluate(() => { window.__demo.reset(); window.__demo.look([0, 0.4, 0], 38, 14, 5.2, 30); window.__demo.squish(1); window.__demo.step(0.9); });
await shot('bin_06_squish');
await page.evaluate(() => window.__demo.step(1.6));
await shot('bin_07_squish_settled');
console.log(JSON.stringify(await page.evaluate(() => window.__demo.state())));
await browser.close();
