// Owner 2026-10-12: real join → vehicle → Ready, with host input administration in the pause menu.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { build } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { serveWithLocalStun } from './lib/stun.mjs';
const deployed = process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE = deployed ? deployed.pathname.replace(/\/?$/, '/') : '/p/owner-lobby/';
const dist = deployed ? null : build('./', 'owner-lobby');
const wait = async (page, fn, arg) => { try { return await page.waitForFunction(fn, arg, { timeout: 30000, polling: 100 }); } catch (e) { console.log('WAIT FAILED', String(fn), await page.evaluate(() => ({room:window.__jjRoom?.view(), seats:JSON.stringify(window.__jjRoom?.view()?.seats), controller:window.__jjController?.inspect(), fault:document.querySelector('[data-fault]')?.textContent, chrome:JSON.stringify(window.__jjChrome?.state), history:JSON.stringify(window.__jjChrome?.history), menuHidden:!!document.querySelector('[data-menu]')?.closest('[hidden]'), menuText:document.querySelector('[data-menu], [data-controllers-view], [data-controls-view]')?.textContent?.slice(0,200)}))); throw e; } };
const shot = async (page, name) => {
  if (!process.env.JJ_CAPTURE_DIR) return;
  mkdirSync(process.env.JJ_CAPTURE_DIR, { recursive: true });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({path: `${process.env.JJ_CAPTURE_DIR}/${name}.jpg`, quality: 85});
};
for (const engine of [chromium, webkit]) test(`${engine.name()}: phone, keys and pad choose visibly; settings preserve pause and controller actions`, { timeout: 300000 }, async () => {
  const server = deployed ? {origin:deployed.origin,close:async()=>{}} : await serveWithLocalStun(dist, BASE);
  const browser = await engine.launch(engine === chromium ? {channel:process.env.JJ_CHROMIUM_GPU==='native'?'chromium':undefined,args: chromiumArgs} : {});
  const errors = [];
  let host;
  try {
    host = await (await browser.newContext({viewport:{width:1366,height:768}})).newPage();
    await host.addInitScript(() => {
      localStorage.setItem('jj.hostVehicle.1', 'tradie-ute');
      window.__pads = [];
      navigator.getGamepads = () => window.__pads;
      window.__pad = (axes, ready = false) => {
        window.__pads[0] = {index:0,id:'Owner journey pad',connected:true,mapping:'standard',axes,buttons:Array.from({length:17},(_,i)=>({pressed:i===9&&ready,value:i===9&&ready?1:0}))};
      };
    });
    host.on('pageerror', e=>errors.push(e.message));
    await host.goto(`${server.origin}${BASE}host?room&test=live`);
    await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
    assert.equal(await host.locator('[data-jj-input-drawer]').count(), 0, 'no floating input panel');
    assert.equal(await host.locator('[data-screen=lobby] [data-act=catch-up]').count(), 0);
    await host.getByRole('button',{name:'Host menu',exact:true}).click();
    for (const name of ['Race rules','Controllers','Display & sound','Advanced']) assert.equal(await host.getByRole('button',{name,exact:true}).count(),1);
    await host.getByRole('button',{name:'Race rules',exact:true}).click();
    assert.match(await host.locator('[data-race-rules]').innerText(),/Give trailing racers a small speed and boost recharge advantage\./);
    assert.equal(await host.getByRole('button',{name:'Light',exact:true}).getAttribute('aria-pressed'),'true');
    await host.getByRole('button',{name:'Off',exact:true}).click();
    await wait(host,()=>window.__jjRoom.view().catchUp===false);
    await host.getByRole('button',{name:'Light',exact:true}).click();
    await wait(host,()=>window.__jjRoom.view().catchUp===true);
    await shot(host,`${engine.name()}-race-rules`);
    await host.getByRole('button',{name:'Back',exact:true}).click();
    await host.getByRole('button',{name:'Controllers',exact:true}).click();
    await host.locator('[data-jj-input-drawer] [data-act=add][data-source="1"]').click();
    await wait(host,()=>window.__jjRoom.view().seats.some(s=>s.localSource===1&&s.vehicle==='tradie-ute'&&s.choosing&&!s.ready));
    await shot(host,`${engine.name()}-controllers`);
    await host.getByRole('button',{name:'Back',exact:true}).click();
    await host.getByRole('button',{name:'Close',exact:true}).click();
    await host.locator('[data-local-use="1"]').click();
    await wait(host,()=>window.__jjRoom.view().seats.find(s=>s.localSource===1)?.choosing===false);
    // A pad's first Start joins only. Steer chooses; the next Start confirms, and a further Start readies.
    await host.evaluate(()=>window.__pad([0,0,0,0],true));
    await wait(host,()=>window.__jjRoom.view().seats.some(s=>s.localSource!==1&&s.localSource!==null));
    const padSource = await host.evaluate(()=>window.__jjRoom.view().seats.find(s=>s.localSource!==1&&s.localSource!==null).localSource);
    await host.evaluate(()=>window.__pad([0,0,0,0],false));
    await wait(host,source=>window.__jjRoom.view().seats.find(s=>s.localSource===source)?.choosing===true,padSource);
    await host.evaluate(()=>window.__pad([0,0,1,0],false));
    await wait(host,source=>window.__jjRoom.view().seats.find(s=>s.localSource===source)?.vehicle==='tradie-ute',padSource);
    // br-bwju.9: a pad player sees where its pick sits in the roster and how many cars there are, as a phone does.
    const options = await host.locator(`[data-local-vehicle="${padSource}"] option`).evaluateAll(os=>os.map(o=>o.value));
    await wait(host,([source,want])=>document.querySelector(`.lb-cc:has([data-local-vehicle="${source}"]) [data-local-count]`)?.textContent===want,[padSource,`Car ${options.indexOf('tradie-ute')+1} of ${options.length}`]);
    assert.ok(await host.locator(`.lb-cc:has([data-local-vehicle="${padSource}"]) [data-local-count]`).isVisible(),'the count is on screen');
    await shot(host,`${engine.name()}-pad-car-count`);
    await host.evaluate(()=>window.__pad([0,0,0,0],true));
    await wait(host,source=>window.__jjRoom.view().seats.find(s=>s.localSource===source)?.choosing===false,padSource);
    assert.equal(await host.evaluate(source=>window.__jjRoom.view().seats.find(s=>s.localSource===source).ready,padSource),false);
    await host.evaluate(()=>window.__pad([0,0,0,0],false));
    await wait(host,source=>window.__jjControls.vehicleChoices().find(p=>p.source===source)?.readyHeld===false,padSource);
    await host.evaluate(()=>window.__pad([0,0,0,0],true));
    await wait(host,source=>window.__jjRoom.view().seats.find(s=>s.localSource===source)?.ready===true,padSource);
    await host.evaluate(()=>window.__pad([0,0,0,0],false));
    const phone = await (await browser.newContext({viewport:{width:412,height:915},hasTouch:true})).newPage();
    // The remembered car is per realm (`jj.car.<realm>`): `test` locally, `preview` on a deployed preview.
    const {realm} = await (await fetch(`${server.origin}${BASE}version`)).json();
    await phone.addInitScript(r=>{localStorage.setItem(`jj.car.${r}`,'tradie-ute');localStorage.setItem('jj.tutorial','done');},realm);
    phone.on('pageerror', e=>errors.push(e.message));
    await phone.goto(await host.evaluate(()=>window.__jjNet.joinUrl()));
    await wait(phone,()=>window.__jjController?.inspect().phase==='ready-to-join');
    await phone.locator('#name').fill('Davo');
    await phone.getByRole('button',{name:'Join the race'}).click();
    await phone.locator('[data-overlay=cars]').waitFor();
    assert.equal(await phone.locator('[data-car-name]').textContent(),'Tradie Ute');
    assert.equal(await phone.locator('[data-act=ready]').isDisabled(),true);
    await shot(phone,`${engine.name()}-phone-choice`);
    await phone.evaluate(async()=>{if(document.fullscreenElement) await document.exitFullscreen();});
    await phone.setViewportSize({width:915,height:412});
    assert.equal(await phone.locator('[data-overlay=cars]').count(),1,'resize rehosts one picker');
    await shot(phone,`${engine.name()}-phone-choice-landscape`);
    await phone.getByRole('button',{name:'Use this vehicle'}).click();
    await wait(host,()=>window.__jjRoom.view().seats.find(s=>s.name==='Davo')?.choosing===false);
    await shot(phone,`${engine.name()}-phone-ready`);
    await shot(host,`${engine.name()}-lobby-three`);
    for(const [width,height] of [[412,915],[915,412],[375,667],[1920,1080],[1366,768]]) {
      await host.setViewportSize({width,height});
      await shot(host,`${engine.name()}-lobby-${width}x${height}`);
      if(width<500) {
        // Visual staging: a just-arrived room update can replace this card while Playwright waits for stability.
        await host.locator(`[data-local-ready="${padSource}"]`).evaluate(el=>el.scrollIntoView({block:'nearest'}));
        await shot(host,`${engine.name()}-lobby-pad-choice-${width}x${height}`);
      }
      await host.getByRole('button',{name:'Host menu',exact:true}).click();
      for(const section of ['Controllers','Race rules','Display & sound','Advanced']) {
        await host.getByRole('button',{name:section,exact:true}).click();
        await shot(host,`${engine.name()}-${section.replaceAll(' ','-').replace('&','and')}-${width}x${height}`);
        if(section==='Controllers' && height<500) {
          await host.getByRole('button',{name:'Back',exact:true}).evaluate(el=>el.scrollIntoView({block:'nearest'}));
          await shot(host,`${engine.name()}-Controllers-scrolled-${width}x${height}`);
        }
        if(section==='Display & sound' && width===1920 && await host.locator('[data-act=fullscreen]').count()) {
          await host.locator('[data-act=fullscreen]').click();
          await wait(host,()=>!!document.fullscreenElement);
          await shot(host,`${engine.name()}-host-fullscreen-${width}x${height}`);
          await host.evaluate(()=>document.exitFullscreen());
        }
        await host.getByRole('button',{name:'Back',exact:true}).click();
      }
      await host.getByRole('button',{name:'Close',exact:true}).click();
    }
    await host.locator('[data-local-ready="1"]').click();
    await wait(host,()=>window.__jjRoom.view().seats.find(s=>s.localSource===1)?.ready===true);
    // br-b2sv: the phone's command counts before Ready: sent (cmds) and dropped on a closed channel, to tell a lost click
    // from a dropped command.
    const cmdsBefore = await phone.evaluate(()=>window.__jjController.inspect().stats);
    await phone.locator('[data-act=ready]').click();
    await wait(host,()=>window.__jjRoom.view().phase==='Running').catch(async e=>{
      console.log('PHONE', JSON.stringify({cmdsBefore, ...await phone.evaluate(()=>({inspect:window.__jjController?.inspect(), ready:document.querySelector('[data-act=ready]')?.outerHTML}))}));
      throw e;
    });
    assert.equal(await host.locator('[data-jj-input-drawer]').count(),0);
    // Manual Recover keeps this damaged vehicle; an out-of-bounds wreck creates a fresh one and persistent dynamic remains.
    await host.evaluate(()=>window.__jjTest.hold(true));
    const car = await host.evaluate(()=>window.__jjRoom.view().seats.find(s=>s.name==='Davo').car);
    const before = await host.evaluate(async car=>(await window.__jjTest.observe()).cars.find(c=>c.car===car),car);
    await host.evaluate(async ({car,before})=>{
      await window.__jjTest.command({cmd:'damage',car,part:'front',health:0});
      await window.__jjTest.command({cmd:'place',car,pose:{x:before.position[0],y:before.position[1]+2,z:before.position[2],headingDeg:before.headingDeg,rollDeg:180},linvel:[0,0,0]});
      await window.__jjTest.step(1);
    },{car,before});
    await phone.locator('[data-act=recover]').click();
    let recovered;
    for(let i=0;i<100;i++) {
      await host.evaluate(()=>window.__jjTest.step(1));
      recovered = await host.evaluate(async car=>(await window.__jjTest.observe()).cars.find(c=>c.car===car),car);
      if(recovered.race.recoveries>before.race.recoveries) break;
      await host.waitForTimeout(20);
    }
    assert.ok(recovered.race.recoveries>before.race.recoveries,'real phone Recover reached the existing car');
    assert.equal(recovered.vehicle,before.vehicle);
    assert.equal(recovered.parts.find(p=>p.part==='front').state,'detached','Recover retains damage');
    assert.equal(recovered.husks,before.husks,'Recover adds no husk');
    await host.evaluate(async car=>{await window.__jjTest.command({cmd:'place',car,pose:{x:0,y:-100,z:0,headingDeg:0},linvel:[0,0,0]});await window.__jjTest.step(360);},car);
    const wrecked = await host.evaluate(()=>window.__jjTest.observe());
    const fresh = wrecked.cars.find(c=>c.car===car);
    assert.equal(fresh.vehicle,before.vehicle,'wreck keeps the selected roster vehicle');
    assert.ok(fresh.race.wrecks>before.race.wrecks);
    assert.ok(fresh.husks>before.husks);
    assert.ok(fresh.parts.every(p=>p.state==='intact'),'wreck respawn restores every part');
    assert.ok(wrecked.debris.length>=before.parts.length,'old husk and parts remain');
    assert.ok(wrecked.debris.every(d=>d.dynamic===true),'all old remains are dynamic');
    await host.evaluate(()=>window.__jjTest.step(240));
    const later = await host.evaluate(()=>window.__jjTest.observe());
    assert.ok(later.debris.length>=wrecked.debris.length,'remains persist beyond the respawn hold');
    assert.ok(later.debris.every(d=>d.dynamic===true));
    await host.evaluate(()=>window.__jjTest.hold(false));
    await host.getByRole('button',{name:'Pause',exact:true}).click();
    await wait(host,async()=>((await window.__jjTest.observe()).host.pauseMask & 1) !== 0);
    await wait(host,()=>window.__jjChrome.state.menu===true && !!document.querySelector('[data-menu] [data-act=display]'));
    await host.getByRole('button',{name:'Display & sound',exact:true}).click();
    await host.locator('#jj-mute').click();
    assert.equal(await host.evaluate(()=>window.__jjAudio.state().muted),true);
    await shot(host,`${engine.name()}-display-sound`);
    await host.getByRole('button',{name:'Back',exact:true}).click();
    await host.getByRole('button',{name:'Advanced',exact:true}).click();
    await host.getByRole('button',{name:'Diagnostics',exact:true}).click();
    await host.locator('[data-diag-code]').waitFor();
    await shot(host,`${engine.name()}-advanced`);
    await host.keyboard.press('Escape');
    assert.equal(await host.evaluate(()=>window.__jjChrome.state.menu),false);
    await wait(host,async()=>((await window.__jjTest.observe()).host.pauseMask & 1) === 0);
    // Controllers actions use the reliable menu lane while paused; the latest Sit out choice wins.
    await host.getByRole('button',{name:'Pause',exact:true}).click();
    await host.getByRole('button',{name:'Controllers',exact:true}).click();
    const localRow = host.locator('[data-jj-input-drawer] li[data-source="1"]');
    await localRow.getByRole('button',{name:'Sit out',exact:true}).click();
    await localRow.getByRole('button',{name:'Return',exact:true}).click();
    await shot(host,`${engine.name()}-controllers-racing-actions`);
    await host.keyboard.press('Escape');
    await host.waitForTimeout(4500);
    await wait(host,()=>window.__jjRoom.view().seats.find(s=>s.localSource===1)?.presence==='Active');
    const oldLocal = await host.evaluate(()=>window.__jjRoom.view().seats.find(s=>s.localSource===1).seat);
    await host.getByRole('button',{name:'Pause',exact:true}).click();
    await host.getByRole('button',{name:'Controllers',exact:true}).click();
    await localRow.getByRole('button',{name:'Leave',exact:true}).click();
    await localRow.getByRole('button',{name:'Add',exact:true}).click();
    await host.evaluate(()=>{
      const pad = window.__pads[0]; window.__pads[0]=null;
      const e = new Event('gamepaddisconnected');
      Object.defineProperty(e,'gamepad',{value:{...pad,connected:false}});
      window.dispatchEvent(e);
    });
    await host.locator(`[data-jj-input-drawer] li[data-source="${padSource}"]`).getByRole('button',{name:'Remove',exact:true}).click();
    await shot(host,`${engine.name()}-controllers-paused-add-remove`);
    await host.keyboard.press('Escape');
    await wait(host,old=>{
      const seats=window.__jjRoom.view().seats;
      return seats.length===2 && seats.some(s=>s.localSource===1 && s.seat!==old && s.car!==null);
    },oldLocal);
    await shot(host,`${engine.name()}-race-after-controllers`);
    assert.deepEqual(errors,[]);
  } catch(e) { console.log('errors', errors, 'host link', JSON.stringify(await host?.evaluate(()=>window.__jjNet?.inspect()).catch(()=>null)), 'menu', JSON.stringify(await host?.evaluate(()=>({state:window.__jjChrome?.state, history:window.__jjChrome?.history, pause:document.querySelector('[data-act=menu]')?.textContent, footers:document.querySelectorAll('footer [data-act=menu]').length, menus:document.querySelectorAll('[data-menu]').length, topAtPause:(()=>{const b=document.querySelector('[data-act=menu]')?.getBoundingClientRect(); const el=b&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2); return el?`${el.nodeName}.${el.className}`:null;})()})).catch(()=>null))); throw e; } finally { await browser.close(); await server.close(); }
});
