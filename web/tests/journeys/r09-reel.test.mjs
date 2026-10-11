// P1-R09: real Rust server, real host WASM, two phones over WebRTC; explicit R90 damage setup, then two rounds.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const deployed = process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE = deployed ? deployed.pathname.replace(/\/?$/, '/') : '/p/reel/';
const engine = process.env.JJ_REEL_BROWSER === 'webkit' ? webkit : chromium;
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-R09');
let server, browser;
before(async()=>{
  mkdirSync(out,{recursive:true});
  server = deployed ? {origin:deployed.origin,close:async()=>{}} : await serve(build('./','r09-reel'),BASE,{JJ_STUN_URLS:''});
  browser = await engine.launch(engine===chromium ? {args:chromiumArgs} : {});
});
after(async()=>{await browser?.close();await server?.close();});
const wait = (page,fn,arg,timeout=30_000)=>page.waitForFunction(fn,arg,{timeout,polling:100});

test('two real controllers: retained damage plays beside results and QR; Hide leaves the next-round timer running', {timeout:240_000}, async()=>{
  const host = await (await browser.newContext({viewport:{width:1366,height:768}})).newPage();
  const errors=[]; host.on('pageerror',e=>errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&map=greybox-loop&laps=99&res=1&autores=off`);
  await wait(host,()=>window.__jjNet?.code()&&window.__jjRoom?.view()?.phase==='Lobby'&&window.__jjReel);
  const url=await host.evaluate(()=>window.__jjNet.joinUrl());
  const phones=[];
  for(const name of ['Roo','Gazza']){
    const phone=await (await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:915,height:412}})).newPage();
    phone.on('pageerror',e=>errors.push(e.message));
    await phone.goto(url);
    await wait(phone,()=>window.__jjController?.inspect().phase==='ready-to-join');
    await phone.locator('#name').fill(name);
    await phone.getByRole('button',{name:'Join the race'}).click();
    await wait(phone,()=>window.__jjController.inspect().phase==='playing');
    await phone.getByRole('button',{name:'Skip tutorial'}).click();
    phones.push(phone);
  }
  await wait(host,()=>window.__jjRoom.view().seats.length===2);
  console.log('# R09: two phones joined');
  await host.getByRole('button',{name:'Start race',exact:true}).click();
  await wait(host,()=>window.__jjRoom.view().phase==='Running',undefined,60_000);
  await host.evaluate(()=>window.__jjTest.hold(true));
  console.log('# R09: round running, test clock held');
  const seats=await host.evaluate(()=>window.__jjRoom.view().seats.map(s=>({seat:s.seat,car:s.car,name:s.name,number:s.number})));
  assert.equal(seats.length,2);
  await host.evaluate(async seats=>{
    const s=window.__jjTest;
    // Fresh complete baselines every four 120Hz ticks (30Hz), through the shipped snapshot lifecycle.
    const step=async ticks=>{for(let i=0;i<ticks;i+=4) await s.step(4);};
    await step(480);
    await s.command({cmd:'damage',car:seats[0].car,part:'front',health:0});
    await step(60);
    await s.command({cmd:'damage',car:seats[1].car,part:'door_FL',health:0});
    await step(60);
    // Explicit out-of-bounds setup exercises the real wreck event, without a stuck autopilot recovering first.
    await s.command({cmd:'place',car:seats[0].car,pose:{x:0,y:-100,z:0,headingDeg:0},linvel:[0,0,0]});
    await step(480);
  },seats);
  const recorded=await host.evaluate(()=>window.__jjReel.inspect().recorder);
  const damageObserved=await host.evaluate(()=>window.__jjTest.observe());
  writeFileSync(join(out,'damage-observed.json'),JSON.stringify({recorded,damageObserved},null,2)+'\n');
  console.log('# R09: recorded',JSON.stringify(recorded));
  const events=recorded.clips.flatMap(c=>c.events);
  assert.ok(events.some(e=>e.kind==='detach'&&e.actors[0].name==='Roo'));
  assert.ok(events.some(e=>e.kind==='detach'&&e.actors[0].name==='Gazza'));
  assert.ok(events.some(e=>e.kind==='wreck'&&e.actors[0].name==='Roo'),JSON.stringify(events));
  assert.ok(recorded.ownedBytes<=recorded.budgetBytes);
  await host.evaluate(async()=>{await window.__jjTest.command({cmd:'finishRace'});await window.__jjTest.step(2);});
  await wait(host,()=>window.__jjRoom.view().phase==='Intermission');
  // The test clock is held, so process the queued next-map result before measuring the deadline.
  await host.evaluate(async()=>{
    for(let i=0;i<100&&!window.__jjRoom.view().preparation?.prepared;i++){
      await window.__jjTest.step(2);await new Promise(r=>setTimeout(r,50));
    }
  });
  assert.equal(await host.evaluate(()=>window.__jjRoom.view().preparation?.prepared),true,'next map prepared during results');
  console.log('# R09: results, loading playback',JSON.stringify(await host.evaluate(()=>window.__jjReel.inspect().player)));
  await wait(host,()=>window.__jjReel.inspect().player.drawnFrames>2,undefined,45_000);
  await host.evaluate(()=>{window.__jjReel.pause(true);window.__jjReel.seek(3.7);});
  await wait(host,()=>window.__jjReel.inspect().player.paused&&window.__jjReel.inspect().player.drawnFrames>4);
  const before=await host.evaluate(async()=>({reel:window.__jjReel.inspect(),room:window.__jjRoom.view(),hash:await window.__jjTest.hash(),
    standingsWidth:document.querySelector('[data-results]').getBoundingClientRect().width}));
  assert.equal(before.reel.player.separateWorld,true);
  assert.equal(before.room.results.length,2);
  for(const selector of ['[data-results]','.rs-join .qr','.jj-reel canvas']) assert.ok(await host.locator(selector).isVisible(),selector);

  if(process.env.JJ_CAPTURE_DIR){
    for(const [state,seconds] of [['roo-detach',3.1],['gazza-detach',3.7],['roo-wreck',4.1]]){
      await host.evaluate(seconds=>window.__jjReel.seek(seconds),seconds);
      await host.waitForTimeout(120);
      await host.screenshot({path:join(out,`reel-${state}-1366x768.jpg`),type:'jpeg',quality:85});
    }
    await host.evaluate(()=>window.__jjReel.seek(3.7));
    for(const [width,height] of [[412,915],[915,412],[375,667],[1920,1080],[1366,768]]){
      await host.setViewportSize({width,height}); await host.waitForTimeout(120);
      await host.screenshot({path:join(out,`reel-${width}x${height}.jpg`),type:'jpeg',quality:85});
      await host.evaluate(async()=>{try{await document.documentElement.requestFullscreen();}catch{}});
      await host.waitForTimeout(120);
      await host.screenshot({path:join(out,`reel-fullscreen-${width}x${height}.jpg`),type:'jpeg',quality:85});
      await host.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});
    }
    for(const [i,phone] of phones.entries())await phone.screenshot({path:join(out,`phone-results-${i+1}.jpg`),type:'jpeg',quality:85});
    await host.setViewportSize({width:1366,height:768});
  }
  const hashWhilePlaying=await host.evaluate(()=>window.__jjTest.hash());
  assert.deepEqual(hashWhilePlaying,before.hash,'playback does not advance or modify the held live simulation');
  await host.getByRole('button',{name:'Hide replay',exact:true}).click();
  const hidden=await host.evaluate(async()=>({reel:window.__jjReel.inspect(),room:window.__jjRoom.view(),hash:await window.__jjTest.hash(),
    width:document.querySelector('[data-results]').getBoundingClientRect().width}));
  assert.equal(hidden.reel.player.state,'hidden');
  assert.deepEqual(hidden.hash,before.hash);
  assert.deepEqual(hidden.room,before.room,'Hide sends no authoritative UI command');
  assert.ok(hidden.width>before.standingsWidth*1.5,'Hide returns the replay area to standings');
  assert.equal(await host.locator('.jj-reel').count(),0);
  if(process.env.JJ_CAPTURE_DIR)await host.screenshot({path:join(out,'reel-hidden-1366x768.jpg'),type:'jpeg',quality:85});
  // Advance the existing intermission policy; replay never inserts a delay or needs a Start command.
  const deadline=hidden.room.remainingMs;
  assert.ok(deadline>0);
  const progression=await host.evaluate(async deadline=>{
    let stepped=0;
    while(stepped<(deadline/1000+5)*120){
      const room=window.__jjRoom.view();
      if(room.round===2&&room.phase==='Running')return {stepped,room};
      await window.__jjTest.step(30);stepped+=30;
    }
    // Room presentation is throttled to 150 ms of wall time. Give the final held-clock state
    // time to publish without stepping any further; this cannot extend the simulation deadline.
    await new Promise(r=>setTimeout(r,200));
    return {stepped,room:window.__jjRoom.view()};
  },deadline);
  // The deadline usually falls between the 30-tick batches. The final batch is part of the bound,
  // and its published room may arrive as the loop exits (worker acknowledgements precede room delivery).
  assert.ok(progression.stepped<=Math.ceil((deadline/1000+5)*120/30)*30,JSON.stringify({deadline,progression}));
  assert.equal(progression.room.phase,'Running');
  assert.equal(progression.room.round,2);
  await wait(host,()=>window.__jjRoom.view().round===2&&window.__jjRoom.view().phase==='Running');
  const next=await host.evaluate(()=>({room:window.__jjRoom.view(),reel:window.__jjReel.inspect()}));
  assert.equal(next.room.seats.length,2);
  assert.equal(next.reel.player.state,'idle');
  assert.equal(next.reel.recorder.retainedClips,0);
  await host.evaluate(async()=>{await window.__jjTest.command({cmd:'finishRace'});await window.__jjTest.step(2);});
  await wait(host,()=>window.__jjRoom.view().phase==='Intermission'&&window.__jjRoom.view().round===2);
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,'browser-run.json'),JSON.stringify({takenAt:new Date().toISOString(),browser:`${engine===chromium?'Chromium':'WebKit'} ${browser.version()}, ${process.platform}/${process.arch}`,preview:deployed?.href??null,
    cohort:2,realWebRTC:true,frameStepped:true,damageSetup:true,recorded,before,hidden,next,progression},null,2)+'\n');
});
