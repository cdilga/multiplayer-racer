// R124 / br-xlvx.3: two actual cars pass at different heights, with native/WASM and uploaded-mesh parity.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {before,after,test} from 'node:test';
import {readFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium,webkit} from 'playwright';
import {build,serve} from '../../landing/tests/lib/site.mjs';
import {chromiumArgs} from './lib/chromium.mjs';
import {evidencePath} from '../lib/evidence.mjs';

const deployed=process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE=deployed ? deployed.pathname.replace(/\/?$/,'/') : '/p/crossing/';
const out=process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-M-crossings');
const sizes=[[412,915],[915,412],[375,667],[1920,1080],[1366,768]];
let scratch,server,mapJson,fixture,native,bridgeShapes;
before(async()=>{
  mkdirSync(out,{recursive:true});
  scratch=mkdtempSync(join(tmpdir(),'jj-crossing-'));
  symlinkSync(resolve('assets'),join(scratch,'assets'),'dir');
  const [bin,...args]=process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo','run','--locked','-q','-p','jj-tools','--bin','jj','--'];
  const dir=join(scratch,'map');
  execFileSync(bin,[...args,'procgen','--seed','0','--recipe','town','--preset','figureEight','--out',dir,'--json']);
  mapJson=readFileSync(join(dir,'map.json'),'utf8');
  const map=JSON.parse(mapJson),p=map.features.find(f=>f.kind==='bridge').params;
  bridgeShapes=JSON.parse(readFileSync(join(dir,'report.json'),'utf8')).bridgeShapes;
  const middle=(a,b)=>Math.floor((a+b)/2);
  const starts=[middle(p.lowerFrom,p.lowerTo)-6,middle(p.upperFrom,p.upperTo)-6];
  const cars=starts.map(i=>{
    const a=map.route.points[i],b=map.route.points[i+1],h=Math.atan2(b.x-a.x,b.z-a.z);
    return {routePoint:i,lift:.3,linvel:[10*Math.sin(h),0,10*Math.cos(h)]};
  });
  fixture={scenario:'generated-crossing-two-cars',what:'A Cruz passes beneath another Cruz on the actual generated bridge.',
    map:join(dir,'map.json'),seed:0,ticks:300,cars,race:{laps:1,atTick:0},seats:[{name:'Underpass',car:0},{name:'Bridge',car:1}],
    inputs:[0,1].map(car=>({car,fromTick:0,toTick:300,throttle:1})),
    expect:[0,1].flatMap(car=>[{car,metric:'upY',min:.9,max:1.001},{car,metric:'wrecks',min:0,max:0},{car,metric:'recoveries',min:0,max:0}])};
  const path=join(scratch,'fixture.json');writeFileSync(path,JSON.stringify(fixture,null,2)+'\n');
  [native]=JSON.parse(execFileSync(bin,[...args,'sim','--json','--out',join(scratch,'native'),path],{encoding:'utf8'}));
  assert.equal(native.ok,true,JSON.stringify(native));assert.equal(native.replayMatches,true);
  server=deployed ? {origin:deployed.origin} : await serve(build('./','generated-crossing'),BASE,{JJ_STUN_URLS:''});
});
after(async()=>{await server?.close?.();if(scratch)rmSync(scratch,{recursive:true,force:true});});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
  test(`${name}: physical underpass matches native and both cars remain visible`,{timeout:300_000},async()=>{
    const browser=await engine.launch(name==='chromium'?{args:chromiumArgs}:{});
    const errors=[],rows=[],passage=[];
    try {
      const page=await browser.newPage({viewport:{width:1366,height:768}});
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/generated-crossing.json',r=>r.fulfill({contentType:'application/json',body:mapJson}));
      await page.goto(`${server.origin}${BASE}host?test&tiles=1&follow=0&orbit=140&orbitDistance=24&orbitHeight=10&orbitTargetHeight=6&look=on&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin+'/generated-crossing.json')}`);
      await page.waitForFunction(()=>window.__jjTest&&window.__jjRender);
      await page.evaluate(async({fixture,mapJson})=>{window.__jjRender.hold();await window.__jjTest.load(fixture,mapJson);}, {fixture,mapJson});
      assert.deepEqual(await page.evaluate(()=>window.__jjRender.bridgeShapes()),bridgeShapes,'actual uploaded bridge triangles match native collision geometry');
      const paint=async()=>{
        const t=await page.evaluate(async()=>(await window.__jjTest.observe()).tick);
        await page.waitForFunction(t=>{window.__jjRender.frame();return window.__jjRender.stats().tick>=t;},t,{polling:100});
      };
      for(let tick=30;tick<=180;tick+=30) {
        await page.evaluate(()=>window.__jjTest.step(30));
        const state=await page.evaluate(()=>window.__jjTest.observe());
        const [a,b]=state.cars;
        passage.push({tick,lower:a.position,upper:b.position,contacts:state.cars.map(c=>c.wheelsInContact)});
        assert.ok(b.position[1]-a.position[1]>5,'cars physically occupy different layers');
        assert.ok(state.cars.every(c=>c.upY>.9),'both cars stay upright through the crossing');
        if(tick===150) {
          await page.waitForFunction(()=>!document.querySelector('#jj-caption')?.textContent,undefined,{timeout:20_000});
          for(const [width,height] of process.env.JJ_CAPTURE_DIR ? sizes : [[1366,768]]) {
            await page.setViewportSize({width,height});await paint();
            const shot=async state=>{
              const visibility=await page.evaluate(async()=>{
                const s=await window.__jjTest.observe();
                return window.__jjRender.tilesSee(s.cars.map(c=>[c.position[0],c.position[1]+.6,c.position[2]]));
              });
              assert.ok(visibility.length && visibility[0].sees.every(Boolean),'both car centres remain in the actual tile camera frustum');
              const file=`${name}-${state}-${width}x${height}.jpg`;
              if(process.env.JJ_CAPTURE_DIR)await page.screenshot({path:join(out,file),type:'jpeg',quality:85});
              rows.push({file,width,height,state,visibility});
            };
            await shot('underpass');
            if(process.env.JJ_CAPTURE_DIR) {
              const full=await page.evaluate(async()=>{try{await document.documentElement.requestFullscreen();return !!document.fullscreenElement;}catch{return false;}});
              await paint();await shot(full?'fullscreen':'fullscreen-unavailable');
              await page.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});
              await page.setViewportSize({width:height,height:width});await paint();await shot('resized');
            }
          }
        }
      }
      // Passage is near the physical crossing, not just two remote roads at unlike heights.
      assert.ok(passage.some(p=>Math.hypot(p.lower[0]-p.upper[0],p.lower[2]-p.upper[2])<5),JSON.stringify(passage));
      await page.evaluate(()=>window.__jjTest.step(120));
      const hash=await page.evaluate(()=>window.__jjTest.hash());
      assert.equal(hash.stateHash,native.stateHash,'full native/WASM state matches at the final tick');
      assert.deepEqual(errors,[]);
      writeFileSync(join(out,`${name}-crossing.json`),JSON.stringify({browser:name,source:deployed?.href??'local real jj-server',fixture,native,bridgeShapes,passage,rows,hash,errors},null,2)+'\n');
    } finally {await browser.close();}
  });
}
