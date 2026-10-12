// br-xlvx.4: the real room prepares a rock track, then R90 stages its seated car at the climb and crest.
// JJ_BIN supplies an independently generated native route for comparison. Outputs belong in JJ_CAPTURE_DIR.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium,webkit} from 'playwright';
import {build,serve} from '../../web/landing/tests/lib/site.mjs';
import {chromiumArgs} from '../../web/tests/journeys/lib/chromium.mjs';

const out=process.env.JJ_CAPTURE_DIR;
assert.ok(out&&process.env.JJ_BIN,'set JJ_CAPTURE_DIR and JJ_BIN');
mkdirSync(out,{recursive:true});
const seed=7;
const dir=join(out,'generated');
execFileSync(process.env.JJ_BIN,['procgen','--seed',String(seed),'--recipe','rocks','--out',dir,'--json']);
const map=JSON.parse(readFileSync(join(dir,'map.json'),'utf8'));
const points=map.route.points, n=points.length;
const after=(i,k)=>points[(i+k)%n];
const climb=points.reduce((best,p,i)=>after(i,40).y-p.y>after(best,40).y-points[best].y?i:best,0);
const crest=points.reduce((best,p,i)=>p.y>points[best].y?i:best,0);
const deployed=process.env.JJ_PREVIEW_URL?new URL(process.env.JJ_PREVIEW_URL):null;
const base=deployed?deployed.pathname.replace(/\/?$/,'/'):'/p/rock-relief/';
const server=deployed?{origin:deployed.origin,close:async()=>{}}:await serve(build('./','rock-relief'),base,{JJ_STUN_URLS:''});
const rows=[];
try {
  for(const engine of process.env.JJ_REVIEW_ENGINE==='chromium'?[chromium]:process.env.JJ_REVIEW_ENGINE==='webkit'?[webkit]:[chromium,webkit]) {
    const browser=await engine.launch(engine===chromium?{args:chromiumArgs}:{});
    const errors=[];
    try {
      const page=await browser.newPage({viewport:{width:1920,height:1080}});
      page.setDefaultTimeout(60000);
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`${server.origin}${base}host?test&room&recipe=rocks&laps=9&look=on&camdist=mid&res=1&autores=off`);
      console.log(engine.name(),'host page loaded');
      await page.waitForFunction(()=>window.__jjPrepare&&window.__jjRoom&&window.__jjNet?.code());
      const renderer=await page.evaluate(()=>{
        const gl=document.querySelector('canvas')?.getContext('webgl2');
        const ext=gl?.getExtension('WEBGL_debug_renderer_info');
        return gl&&ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;
      });
      console.log(engine.name(),'renderer',renderer);
      console.log(engine.name(),'real Lobby ready');
      await page.evaluate(()=>window.__jjTest.join('Rock driver',{lobby:true}));
      console.log(engine.name(),'review driver seated');
      // The session starts at seed 1; each real Lobby reroll advances it. Let every async worker job finish.
      let built;
      do {
        const count=await page.evaluate(()=>window.__jjPrepare.seeds().length);
        await page.evaluate(async()=>{window.__jjPrepare.reroll();await window.__jjTest.step(1);});
        await page.waitForFunction(count=>{const s=window.__jjPrepare.seeds();return s.length>count&&s.at(-1).lengthM!==undefined&&window.__jjPrepare.stats().delivered===s.length;},count,{timeout:60000});
        built=await page.evaluate(()=>window.__jjPrepare.seeds().at(-1));
        console.log(engine.name(),'prepared seed',built.seed);
        assert.ok(built.seed<=seed,'the fixed review seed was not skipped');
      } while(built.seed<seed);
      // The accepted second Start now skips a forced countdown, after the map is ready.
      await page.evaluate(async()=>{window.__jjRoom.start();await window.__jjTest.step(1);window.__jjRoom.start();await window.__jjTest.step(1);});
      await page.waitForFunction(()=>window.__jjRoom.view()?.phase==='Running',undefined,{timeout:60000});
      console.log(engine.name(),'real director Running');
      await page.waitForFunction(()=>window.__jjPrepare.stats().committed===1,{},{timeout:60000});
      const info=await page.evaluate(()=>window.__jjPrepare.mapInfo());
      assert.deepEqual(info.route,points.map(p=>[p.x/1000,p.z/1000,p.y/1000]),'native and actual WASM-prepared route match');
      await page.evaluate(()=>window.__jjTest.command({cmd:'autopilot',on:false}));
      console.log(engine.name(),'real seed-7 rock round ready');
      const paint=async()=>{
        const tick=await page.evaluate(async()=>(await window.__jjTest.observe()).tick);
        await page.waitForFunction(t=>{window.__jjRender.frame();return window.__jjRender.stats().tick>=t;},tick,{polling:100,timeout:60000});
        await page.evaluate(()=>window.__jjRender.frame());
        await page.evaluate(async()=>{
          await document.fonts.ready;
          await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        });
      };
      for(const [state,point] of [['climb',climb],['crest',crest],['field-around-driver',null]]) {
        if(point!==null) {
          const staged=await page.evaluate(async target=>{
            const route=window.__jjPrepare.mapInfo().route;
            const p=route[target],q=route[(target+1)%route.length];
            await window.__jjTest.command({cmd:'place',car:0,pose:{x:p[0],y:p[2]+.6,z:p[1],headingDeg:Math.atan2(q[0]-p[0],q[1]-p[1])*180/Math.PI},linvel:[0,0,0]});
            await window.__jjTest.step(120);
            return (await window.__jjTest.observe()).cars[0];
          },point);
          assert.equal(staged.race.recoveries,0,'no Recover in the staged view');
          assert.equal(staged.race.wrecks,0,'no wreck in the staged view');
        }
        await page.evaluate(point=>window.__jjRender.setFollow(point===null?null:[0]),point);
        await page.waitForFunction(()=>!document.querySelector('#jj-caption')?.textContent,undefined,{timeout:20000});
        const sizes=state==='climb'?[[412,915],[915,412],[375,667],[1366,768],[1920,1080]]:[[1920,1080]];
        for(const [width,height] of sizes) {
          await page.setViewportSize({width,height});await paint();
          const file=`${engine.name()}-${state}-${width}x${height}.jpg`;
          await page.screenshot({path:join(out,file),type:'jpeg',quality:90});
          rows.push({browser:engine.name(),renderer,state,point,file,width,height});
          console.log('captured',file);
        }
        if(state==='climb') {
          const fullscreen=await page.evaluate(async()=>{try{await document.documentElement.requestFullscreen();return !!document.fullscreenElement;}catch{return false;}});
          await paint();const file=`${engine.name()}-climb-fullscreen-${fullscreen}.jpg`;
          await page.screenshot({path:join(out,file),type:'jpeg',quality:90});rows.push({browser:engine.name(),state,point,file,fullscreen});
          await page.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});
          await page.setViewportSize({width:915,height:412});await paint();
          const resized=`${engine.name()}-climb-after-resize.jpg`;
          await page.screenshot({path:join(out,resized),type:'jpeg',quality:90});rows.push({browser:engine.name(),state,point,file:resized,width:915,height:412});
        }
      }
      assert.deepEqual(errors,[]);
    } finally {await browser.close();}
  }
} finally {await server.close();}
writeFileSync(join(out,'capture.json'),JSON.stringify({source:deployed?.href??'local real jj-server',seed,recipe:'rocks',generator:map.header.generator,reliefM:(Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)))/1000,climb100mRiseM:(after(climb,40).y-points[climb].y)/1000,climb,crest,reference:'art/references/australia/generated/biome-rocks-olgas.png',method:'real Lobby rerolls, preparation and director; R90 Place stages the actual seated car for visual review; native/WASM route parity; emulated host viewports; unaided laps qualified separately by the physical fixture bank',rows},null,2)+'\n');
console.log(`Captured ${rows.length} frames; inspect every image in ${out}.`);
