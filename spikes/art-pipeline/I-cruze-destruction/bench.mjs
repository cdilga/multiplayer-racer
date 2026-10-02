// bench.mjs — performance evidence (system Chrome, GPU). node bench.mjs → out/bench.json
// Cohort sizes here (24 cars, 16 active + 10 wrecks …) are benchmark samples, never runtime limits.
import fs from 'node:fs';
import { open, close, OUT } from './lib.mjs';
const page = await open(1920, 1080);
const run = (code, arg) => page.evaluate(async ([c, a]) => { const D = window.__demo; return await (new Function('D', 'A', `return (async()=>{${c}})()`))(D, a); }, [code, arg]);
const size = async (w, h) => { await page.setViewportSize({ width: w, height: h }); await run(`D.setSize(${w}, ${h});`); };
const out = { when: new Date().toISOString(), ua: await page.evaluate(() => navigator.userAgent), gl: await page.evaluate(() => { const g = window.__demo.renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }) };

// 1. one car per LOD: template numbers + render cost of that car alone filling a 1080p frame
out.single = [];
await size(1920, 1080);
const info = await run(`return D.buildInfo;`);
for (const lod of (process.env.FIELD_ONLY ? [] : [0, 1, 2, 3])) {
  const t = await run(`const t = D.tpls[${lod}]; const v = (g) => g ? g.attributes.position.count : 0; let iv = 0, av = 0; for (const g of Object.values(t.intact)) iv += v(g); for (const p of Object.values(t.parts)) for (const g of Object.values(p.slots)) av += v(g); for (const id of ['wheel_FL','wheel_FR','wheel_RL','wheel_RR']) for (const g of Object.values(t.parts[id].slots)) iv += v(g); return { intactVerts: iv, assemblyVerts: av };`);
  await run(`await D.scene('single',{lod:${lod}}); D.look([0,0.7,0],34,15,7.5,30);`);
  const intact = await run(`return await D.bench({frames: 120, simulate: false});`);
  await run(`D.cars[0].v.wake();`);
  const assembly = await run(`return await D.bench({frames: 120, simulate: false});`);
  out.single.push({ lod, ...info[lod], ...t, materials: 4, intact: { calls: intact.info.calls, tris: intact.info.triangles, renderMs: intact.render, gpuMs: intact.gpu }, assembly: { calls: assembly.info.calls, tris: assembly.info.triangles, renderMs: assembly.render, gpuMs: assembly.gpu } });
  console.log('single L' + lod, JSON.stringify(out.single.at(-1)).slice(0, 220));
}

// 2. 24 pristine cars, overview camera, at 1080p and 4K: auto LOD (bias 0/1/2) vs everything forced to L0 / L1
out.grid24 = [];
for (const [w, h] of (process.env.FIELD_ONLY ? [] : [[1920, 1080], [3840, 2160]])) {
  await size(w, h);
  for (const mode of ['auto', 'L0', 'L1']) for (const bias of mode === 'auto' ? [0, 1, 2] : [0]) {
    await run(`await D.scene('grid24',{lod:${mode === 'auto' ? 'null' : +mode[1]}}); D.setBias(${bias}); D.look([0,0,0],30,48,46,40); D.updateLods(${h});`);
    const b = await run(`return await D.bench({frames: 150, simulate: false});`);
    out.grid24.push({ res: `${w}x${h}`, mode, bias, calls: b.info.calls, tris: b.info.triangles, sceneDraws: b.scene.draws, lodHist: b.lodHist, renderMs: b.render, gpuMs: b.gpu, interval: b.interval });
    console.log('grid24', w, mode, bias, b.info.calls, b.info.triangles, JSON.stringify(b.render), JSON.stringify(b.lodHist));
  }
}

// 3. destruction field: active cars driving through wrecks + loose parts + shards; physics stepping included (CPU)
out.field = [];
await size(1920, 1080);
for (const bias of [0, 1, 2]) {
  await run(`await D.scene('field',{active:16, wrecks:10, settle:6}); D.setBias(${bias}); D.look([0,0,0],30,50,40,40); D.updateLods();`);
  const b = await run(`return await D.bench({frames: 240, simulate: true});`);
  out.field.push({ bias, calls: b.info.calls, tris: b.info.triangles, sceneDraws: b.scene.draws, lodHist: b.lodHist, physics: b.physics, simMs: b.sim, lodMs: b.lod, renderMs: b.render, gpuMs: b.gpu, interval: b.interval });
  console.log('field bias', bias, b.info.calls, b.info.triangles, JSON.stringify(b.render), JSON.stringify(b.sim), JSON.stringify(b.physics));
}
// 3b. same field, governor test: a host that misses budget raises the bias by itself (physics untouched)
{
  await run(`await D.scene('field',{active:16, wrecks:10, settle:6}); D.look([0,0,0],30,50,40,40);`);
  out.governor = await run(`const g = D.governor({ budgetMs: 1.0 }); let t = 0; for (let i = 0; i < 300; i++) { await new Promise((r) => requestAnimationFrame(r)); const t0 = performance.now(); D.updateLods(); D.render(); const ms = performance.now() - t0 + 1.5; t += 1/60; D.setBias(g.update(ms, 1/60, t)); } return { finalBias: g.bias, changes: g.changes, physics: D.sim.stats() };`);
  console.log('governor', JSON.stringify(out.governor));
}
fs.writeFileSync(OUT + 'bench.json', JSON.stringify(out, null, 1));
await close();
