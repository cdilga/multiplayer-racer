// node capture_extra.mjs — 24-car grid perf, GLB bake, smash video frames
import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const base = 'http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1';
const results = {};

// ── 1. grid perf: 24 tiles on a 3840x2160 canvas (640x540 tiles like the previous spike); each tile draws only its own car
for (const [name, lod, bake] of [['L0_parts', 0, false], ['L1_parts', 1, false], ['L2_parts', 2, false], ['L2_intact', 2, true], ['L3_intact', 3, true]]) {
  const page = await browser.newPage({ viewport: { width: 3840, height: 2160 } });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.goto(`${base}&w=3840&h=2160&nointact=1`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  const r = await page.evaluate(async ([lod, bake]) => {
    const { build } = await import('/spikes/art-pipeline/H-primitive-kit/cruze.js');
    const { bakeIntact } = await import('/spikes/art-pipeline/H-primitive-kit/kit/intact.js');
    const { instantiate } = await import('/spikes/art-pipeline/H-primitive-kit/kit/instance.js');
    const { stage } = window.__demo; window.__demo.car.visible = false;
    const COL = ['#e0392f', '#1e88e5', '#ffd23f', '#2bb673', '#8e44ad', '#f59f00', '#17b3b0', '#ff4fa3'];
    const t0 = performance.now(); const tpl = await build({ lod }); if (bake) bakeIntact(tpl); const tplMs = performance.now() - t0;
    const t1 = performance.now(); const cars = [];
    for (let i = 0; i < 24; i++) { const c = instantiate(tpl, { paint: COL[i % 8], accent: COL[(i + 3) % 8] }); c.position.set((i % 6) * 6, 0, Math.floor(i / 6) * 6); stage.scene.add(c); cars.push(c); }
    const instMs = performance.now() - t1;
    const r = stage.renderer, gl = r.getContext(), cam = stage.camera;
    const frame = () => {
      r.setScissorTest(true); r.autoClear = false; r.setClearColor('#f3e6cf'); r.clear();
      cars.forEach((c, i) => {
        cars.forEach((o) => (o.visible = o === c));
        const x = (i % 6) * 640, y = 2160 - (Math.floor(i / 6) * 540 + 540); r.setViewport(x, y, 640, 540); r.setScissor(x, y, 640, 540);
        cam.aspect = 640 / 540; cam.fov = 28; cam.updateProjectionMatrix(); const a = (30 + i * 3) * Math.PI / 180;
        cam.position.set(c.position.x + Math.sin(a) * 7.1, 2.8, c.position.z + Math.cos(a) * 7.1); cam.lookAt(c.position.x, 0.75, c.position.z); r.render(stage.scene, cam);
      }); cars.forEach((o) => (o.visible = true)); r.setScissorTest(false); r.autoClear = true;
    };
    frame(); gl.finish(); r.info.autoReset = false; r.info.reset();
    // count main+shadow calls for the whole frame
    frame(); const info = { calls: r.info.render.calls, tris: r.info.render.triangles }; r.info.autoReset = true;
    const N = 20; const t2 = performance.now(); for (let i = 0; i < N; i++) { frame(); gl.finish(); } const ms = (performance.now() - t2) / N;
    let meshes = 0; cars[0].traverse((o) => { if (o.isMesh && o.visible) { let v = true, p = o; while (p) { if (!p.visible) v = false; p = p.parent; } if (v) meshes++; } });
    return { templateMs: Math.round(tplMs), instantiate24Ms: +instMs.toFixed(1), calls: info.calls, tris: info.tris, frameMs: +ms.toFixed(1), meshesPerCar: meshes };
  }, [lod, bake]);
  await page.screenshot({ path: `out/grid24_${name}.png` });
  results[name] = r; console.log(name, JSON.stringify(r));
  await page.close();
}
fs.writeFileSync('out/perf_grid.json', JSON.stringify(results, null, 1));

await browser.close();
