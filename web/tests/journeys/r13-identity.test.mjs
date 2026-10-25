// P1-R13: real phone/host identity, and rendered 1/4/24 cohorts with actual pattern-on/off draw counts.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, gpu } from './lib/chromium.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';
import { serveWithLocalStun } from './lib/stun.mjs';
import { CVD_TYPES, simulateCvd } from '../../../art/ui/lib/color.mjs';

const deployed = process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE = deployed ? deployed.pathname.replace(/\/?$/, '/') : '/p/r13/';
const dist = deployed ? null : build('./', 'r13');
const capture = process.env.JJ_CAPTURE_DIR;
const accepted = JSON.parse(readFileSync(new URL('../../../art/ui/accepted/2026-10-07/tokens.json', import.meta.url)));
const patterns = JSON.parse(readFileSync(new URL('../../../art/ui/tokens.json', import.meta.url))).identity.patterns;
const pattern = n => patterns[(n - 1) % patterns.length].id;
if (capture) mkdirSync(capture, { recursive: true });
const shot = async (p, name) => capture && p.screenshot({ path: `${capture}/${name}.jpg`, quality: 90 });
const wait = async (p, f, arg) => {
  try {return await p.waitForFunction(f, arg, { timeout: 60000 });}
  catch(e) {console.log('identity wait failed',String(f),JSON.stringify(await p.evaluate(()=>({room:window.__jjRoom?.view(),controller:window.__jjController?.inspect()}))));throw e;}
};
const server = () => deployed ? {origin:deployed.origin,close:async()=>{}} : serveWithLocalStun(dist, BASE);

for (const engine of [chromium, webkit]) test(`${engine.name()}: identity matches real phones, car paint, HUD and other-view nameplates`, {timeout:180000}, async () => {
  const s = await server();
  const b = await engine.launch(engine === chromium ? {channel:process.env.JJ_CHROMIUM_GPU==='native'?'chromium':undefined,args:chromiumArgs} : {});
  const errors=[];
  let host;
  try {
    host = await b.newPage({viewport:{width:1366,height:768}});
    host.on('pageerror', e=>errors.push(e.message));
    host.on('console', m=>{if (m.type()==='error' && /shader|WebGLProgram/i.test(m.text())) errors.push(m.text());});
    await host.goto(`${s.origin}${BASE}host?room&test=live&autores=off`);
    await wait(host,()=>window.__jjNet?.code() && window.__jjRoom?.view()?.phase==='Lobby');
    const url=await host.evaluate(()=>window.__jjNet.joinUrl());
    const phones=[];
    for (let n=1;n<=2;n++) {
      const ctx=await b.newContext({viewport:{width:412,height:915},hasTouch:true});
      await ctx.addInitScript(()=>localStorage.setItem('jj.tutorial','done'));
      const p=await ctx.newPage(); p.on('pageerror',e=>errors.push(e.message));
      await p.goto(url); await wait(p,()=>window.__jjController?.inspect().phase==='ready-to-join');
      await p.locator('#name').fill(`Pattern ${n}`); await p.getByRole('button',{name:'Join the race'}).click();
      await confirmInitialVehicle(p);
      assert.equal(await p.locator('.seatno').getAttribute('data-identity-pattern'),pattern(n));
      assert.match(await p.locator('.seatno').textContent(),new RegExp(`#${n}$`));
      await shot(p,`${engine.name()}-phone-${n}-portrait`);
      await p.evaluate(async()=>{if(document.fullscreenElement) await document.exitFullscreen();});
      await p.setViewportSize({width:915,height:412});
      await wait(p, () => {
        const zones = [...document.querySelectorAll('.zone')];
        return !!document.querySelector('.sticks.with-pod') && zones.length === 2 && zones.every(zone => {
          const z = zone.getBoundingClientRect(), b = zone.querySelector('.base')?.getBoundingClientRect();
          return b && b.width > 20 && b.height > 20 && b.left >= z.left && b.right <= z.right && b.top >= z.top && b.bottom <= z.bottom;
        });
      });
      await shot(p,`${engine.name()}-phone-${n}-landscape`);
      phones.push(p);
    }
    // Hold across real HUD updates: rewriting an unchanged label during the press used to
    // suppress WebKit's native click. Both phones must still ready through the real button.
    for (const p of phones) await p.getByRole('button',{name:/^Ready/}).click({delay:350});
    // br-b2sv: WebKit on CI has left the room in the Lobby after both Readys; on a miss, say what each phone thinks.
    await wait(host,()=>window.__jjRoom.view().phase==='Running').catch(async (e) => {
      for (const p of phones) console.log('phone after Ready', JSON.stringify(await p.evaluate(()=>({c:window.__jjController?.inspect(), ready:document.querySelector('[data-act=ready]')?.outerHTML?.slice(0,300)})).catch((x)=>String(x))));
      throw e;
    });
    await wait(host,()=>window.__jjRender.vehicles()?.cars===2 && document.querySelectorAll('.hud-badge[data-identity-pattern]').length===2);
    const identity=await host.evaluate(()=>({render:window.__jjRender.vehicles(),badges:[...document.querySelectorAll('.hud-badge')].map(b=>({text:b.textContent,pattern:b.dataset.identityPattern}))}));
    for (let i=0;i<2;i++) {
      assert.equal(identity.render.identities[i].number,i+1); assert.equal(identity.render.identities[i].pattern,pattern(i+1));
      assert.equal(identity.badges[i].pattern,pattern(i+1));
    }
    assert.ok(identity.render.materials.every(m=>m.count===1),'one material per vehicle kind, shared by all its cars');
    // A real other-player view: both cars start on the grid; the nameplate ring belongs to the car it labels.
    await wait(host,()=>document.querySelector('.identity-nameplate[data-identity-pattern]'));
    const rings=await host.locator('.identity-nameplate').evaluateAll(els=>els.map(el=>({number:Number(el.dataset.number),pattern:el.dataset.identityPattern,text:el.textContent})));
    for (const ring of rings) { assert.equal(ring.pattern,pattern(ring.number)); assert.match(ring.text,new RegExp(`#${ring.number}`)); }
    for (const [width,height] of [[375,667],[412,915],[915,412],[1366,768],[1920,1080]]) {
      await host.setViewportSize({width,height}); await host.waitForTimeout(200); await shot(host,`${engine.name()}-host-${width}x${height}`);
    }
    if(engine===chromium) {
      // After the rendering checks, software draws at 1080p can starve input IPC.
      // Keep the sim live and explicitly paint the menu captures; GPU stays live throughout.
      if (!gpu) await host.evaluate(() => window.__jjRender.hold());
      await host.locator('.jj-foot [data-act=menu]').click();
      await host.getByRole('button',{name:'Display & sound',exact:true}).click();
      await host.getByRole('button',{name:'Full screen',exact:true}).click();
      await wait(host,()=>!!document.fullscreenElement);
      if (!gpu) await host.evaluate(() => window.__jjRender.frame());
      await shot(host,'chromium-host-fullscreen');
      await host.evaluate(()=>document.exitFullscreen());
      if (!gpu) await host.evaluate(() => window.__jjRender.frame());
      await shot(host,'chromium-host-after-fullscreen');
    }
    assert.deepEqual(errors,[]);
  } catch(e) {console.log('host signalling',JSON.stringify(await host?.evaluate(()=>window.__jjNet?.inspect()).catch(()=>null)));throw e;}
  finally {await b.close();await s.close();}
});

test('identity patterns add zero draws at 1/4/24 tiles; roof numbers and CVD sheet stay distinct', {timeout:240000,skip:!gpu && 'rendered 24-tile cohort needs GPU'}, async()=>{
  const s=await server();const b=await chromium.launch({channel:process.env.JJ_CHROMIUM_GPU==='native'?'chromium':undefined,args:chromiumArgs});const report=[];
  try {
    for(const n of [1,4,24]) {
      const p=await b.newPage({viewport:{width:1920,height:1080}});const errors=[];
      p.on('console',m=>{if(m.type()==='error' && /shader|WebGLProgram/i.test(m.text()))errors.push(m.text());});
      // Wall-clock particles emit/fade between frames; isolate the identity material's draw cost.
      await p.goto(`${s.origin}${BASE}host?synthetic=${n}&tiles=${n}&freeze=100&fx=off&autores=off&map&orbit=${Array(n).fill(20).join(',')}&orbitHeight=4`);
      await wait(p,n=>window.__jjRender?.vehicles()?.cars===n,n); await p.evaluate(()=>window.__jjRender.hold());
      const on=await p.evaluate(()=>{window.__jjRender.frame();return {stats:window.__jjRender.stats(),vehicles:window.__jjRender.vehicles(0)};});
      await shot(p,`cars-${n}-tiles-${n}`);
      const a=await p.screenshot();
      const off=await p.evaluate(()=>{window.__jjRender.setIdentityPatterns(false);window.__jjRender.frame();return window.__jjRender.stats();});
      const z=await p.screenshot();
      assert.equal(on.stats.drawCalls,off.drawCalls,'actual GPU draws do not change with patterns');
      assert.equal(on.stats.triangles,off.triangles,'patterns add no geometry');
      assert.notDeepEqual(a,z,'the real shader paints visible patterns');
      assert.equal(on.vehicles.drawsPerTile,8); assert.ok(on.vehicles.materials.every(m=>m.count===1));
      assert.ok(on.vehicles.types.every(t=>t.shared),'LOD buffers share identity attributes');
      assert.deepEqual(on.vehicles.parts.find(p=>p.part==='core').numberChunks,[1,0,0,1]);
      for(const id of on.vehicles.identities)assert.equal(id.pattern,pattern(id.number));
      const largeNumbers = await p.evaluate(() => [108, 10000, 16777217, 4294967295].map(number => ({ number, chunks: Array.from(new Float32Array(window.__jjRender.identityNumberChunks(number))) })));
      for (const { number, chunks } of largeNumbers) assert.equal(chunks[0] + chunks[1] * 10000 + chunks[2] * 100000000, number, 'GPU attributes retain every digit beyond float integer precision');
      const bounds = await p.locator('.identity-nameplate').evaluateAll(els => els.map(el => ({tile:el.dataset.tile,...el.getBoundingClientRect().toJSON()})));
      for(let i=0;i<bounds.length;i++) for(let j=i+1;j<bounds.length;j++) if(bounds[i].tile===bounds[j].tile) {
        const a=bounds[i], z=bounds[j];
        assert.ok(a.right<=z.left+.1 || z.right<=a.left+.1 || a.bottom<=z.top+.1 || z.bottom<=a.top+.1, 'all visible nameplates fit without intersecting');
      }
      assert.deepEqual(errors,[]);report.push({n,on:on.stats,off,vehicles:on.vehicles,largeNumbers,bounds});await p.close();
    }
    // The complete colour×pattern cycle and its wrap, plus large labels; the number remains distinct on repeated combinations.
    const p=await b.newPage({viewport:{width:1440,height:1200}});
    for(const view of ['normal',...CVD_TYPES]) {
      const see=h=>view==='normal'?h:simulateCvd(h,view);
      const chips=Array.from({length:accepted.identity.colors.length*patterns.length+1},(_,i)=>i+1).concat([108,10000,4294967295]);
      await p.setContent(`<style>body{background:#f4f1ea;color:#15203a;font:20px sans-serif}h1{font-size:32px}.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:14px}.seat{border:3px solid #15203a;padding:12px;font-size:28px;font-weight:900}.seat small{display:block;font-size:15px}</style><h1>Identity · ${view} · full combination cycle + wrap</h1><div class="grid">${chips.map(n=>{
        const c=accepted.identity.colors[(n-1)%accepted.identity.colors.length],pat=patterns[(n-1)%patterns.length];
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="${pat.svg}" fill="${see('#15203a')}" fill-opacity=".28"/></svg>`;
        return `<div class="seat" style="color:${see(accepted.palette[c.on].hex)};background:url('data:image/svg+xml,${encodeURIComponent(svg)}') 0 0 / 32px 32px repeat,${see(c.hex)}">#${n}<small>${pat.name}</small></div>`;
      }).join('')}</div>`);
      await shot(p,`cvd-${view}`);
      for(let i=0;i<chips.length-1;i++)assert.ok(pattern(chips[i])!==pattern(chips[i+1])||chips[i]!==chips[i+1]);
    }
    if(capture)writeFileSync(`${capture}/draw-counts.json`,JSON.stringify({browser:b.version(),platform:`${process.platform}/${process.arch}`,gpuMode:process.env.JJ_CHROMIUM_GPU,cohorts:report},null,2)+'\n');
  }finally{await b.close();await s.close();}
});
