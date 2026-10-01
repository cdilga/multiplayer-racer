// Determinism check: the same hit list on two fresh cars must give identical vertex buffers (=> dents are replayable from hit records).
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto('http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&w=800&h=500&nointact=1');
await page.waitForFunction(() => document.title === 'READY');
const r = await page.evaluate(async () => {
  const { instantiate } = await import('/spikes/art-pipeline/H-primitive-kit/kit/instance.js');
  const d = window.__demo, tpl = d.car; const sim = d.sim; const A = instantiate(tpl, { paint: '#e0392f', accent: '#ffd23f' }), B = instantiate(tpl, { paint: '#1e88e5', accent: '#fff' });
  A.position.set(20, 0, 0); B.position.set(40, 0, 0); d.stage.scene.add(A, B); sim.addCar(A, { position: [20, 0, 0] }); sim.addCar(B, { position: [40, 0, 0] });
  const hits = [['door_FR', [0.95, 0.72, 0.22], [-1, 0, 0.15], 0.6], ['door_FR', [0.9, 0.8, 0.3], [-1, 0, 0], 0.4], ['bonnet', [0.15, 1.02, 1.25], [0, -0.55, -0.85], 0.7], ['bumper_front', [0.3, 0.58, 1.86], [0, 0, -1], 0.5], ['chassis', [0.9, 0.62, 0.9], [-1, 0, 0], 0.3]];
  const run = (car) => { for (const [id, p, dir, sev] of hits) { car.updateMatrixWorld(true); sim.hit(car, { partId: id, point: car.localToWorld(new (tpl.position.constructor)(...p)), dir: new (tpl.position.constructor)(...dir).transformDirection(car.matrixWorld), severity: sev }); } };
  run(A); run(B);
  const sum = (car) => { let h = 0, n = 0; car.traverse((o) => { if (o.isMesh && o.userData.ownGeo) { const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i++) { h = (h * 31 + Math.round(a[i] * 1e5)) | 0; } n += a.length; } }); return { h, n }; };
  const sA = sum(A), sB = sum(B); const tplUntouched = (() => { let mod = 0; tpl.traverse((o) => { if (o.isMesh && o.userData.ownGeo) mod++; }); return mod; })();
  return { A: sA, B: sB, identical: sA.h === sB.h && sA.n === sB.n && sA.n > 0, templateMeshesWithPrivateGeo: tplUntouched, dentsA: Object.values(A.userData.dmg.parts).reduce((s, P) => s + P.dents.length, 0) };
});
console.log(JSON.stringify(r)); await browser.close();
