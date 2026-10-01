import { chromium } from 'playwright';
const lod = process.argv[2] ?? '0', model = process.argv[3] ?? 'cruze';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
await page.goto(`http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&w=600&h=400&model=${model}&lod=${lod}&nointact=1`);
await page.waitForFunction(() => document.title === 'READY');
const r = await page.evaluate(() => { const out = {}; let total = 0; const walk = (p) => { let t = 0; const per = {}; p.traverse((o) => { if (o.isMesh) { const n = o.geometry.index.count / 3; t += n; per[o.userData.kind] = (per[o.userData.kind] || 0) + n; } }); if (t) out[p.name] = { t: Math.round(t), ...Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round(v)])) }; total += t; }; window.__demo.car.children.forEach(walk); out.TOTAL = Math.round(total); return out; });
console.log(JSON.stringify(r, null, 0).replace(/},/g, '},\n'));
await browser.close();
