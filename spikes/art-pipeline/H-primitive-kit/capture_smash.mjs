// node capture_smash.mjs  — scripted, deterministic smash sequence → out/smash_XX.png (+ state json)
import { chromium } from 'playwright';
const W = 1200, H = 800;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/404/.test(m.text())) console.log('CONSOLE', m.type(), m.text()); });
await page.goto(`http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&w=${W}&h=${H}`);
await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
const shot = async (name) => { await page.evaluate(() => window.__demo.render()); await page.screenshot({ path: `out/${name}.png` }); };
await page.evaluate(() => window.__demo.look([0, 0.7, 0.3], 40, 16, 6.6, 30));
await shot('smash_00_pristine');
const steps = [
  ['smash_01_dents', [['bumper_front', 0.55], ['bonnet', 0.6], ['door_L', 0.5]], 0.5],
  ['smash_02_ajar', [['door_L', 0.7], ['bonnet', 0.6]], 0.7],
  ['smash_03_doorgone', [['door_L', 0.9], ['light_head_L', 1.0]], 0.35],
  ['smash_04_doorflying', [], 0.5],
  ['smash_05_wheel', [['wheel_FL', 1.4], ['wheel_FL', 1.3], ['wheel_FL', 1.0]], 0.9],
  ['smash_06_settled', [['bumper_front', 1.2]], 2.2],
];
for (const [name, hits, wait] of steps) {
  for (const [id, sev] of hits) console.log(name, id, JSON.stringify(await page.evaluate(([i, s]) => window.__demo.hitPart(i, s), [id, sev])));
  await page.evaluate((w) => window.__demo.step(w), wait);
  await shot(name);
}
console.log(JSON.stringify(await page.evaluate(() => window.__demo.state())));
await browser.close();
