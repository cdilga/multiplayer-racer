// R124 / br-xlvx.6: a car rides the test map's loop in the real host. The uploaded loop triangles are the native
// collision mesh (jj-map looping::loop_mesh), the car is upside down at the top, and the WASM run matches native.
//   JJ_CAPTURE_DIR=docs/evidence/br-xlvx.6 node --test web/tests/journeys/loop-ride.test.mjs
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
const BASE=deployed ? deployed.pathname.replace(/\/?$/,'/') : '/p/loop/';
const out=process.env.JJ_CAPTURE_DIR ?? evidencePath('br-xlvx.6');
// crates/jj-map/tests/loops.rs LOOP_FINGERPRINT (web/host/tests/loop-parity.test.mjs holds loop.ts to it too).
const NATIVE_LOOP='45d155fdea1c1d0c';
const TICKS=360;
// The views of the car at the top: side-on through the loop (an orbit in the car's frame, level with it), and the chase
// camera a player has.
const VIEWS=[['side','follow=0&orbit=90&orbitDistance=34&orbitHeight=0&orbitTargetHeight=0'],['chase','follow=0']];
let scratch,server,mapJson,fixture,native;
before(async()=>{
  mkdirSync(out,{recursive:true});
  scratch=mkdtempSync(join(tmpdir(),'jj-loop-'));
  symlinkSync(resolve('assets'),join(scratch,'assets'),'dir');
  const [bin,...args]=process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo','run','--locked','-q','-p','jj-tools','--bin','jj','--'];
  const mapPath=resolve('maps/test/loop.json');
  mapJson=readFileSync(mapPath,'utf8');
  const map=JSON.parse(mapJson),p=map.features.find(f=>f.kind==='loop').params;
  // Ten route points (25 m) before the entry, a little over the posted entry speed, flat out.
  const i=p.entry-10,a=map.route.points[i],b=map.route.points[i+1],h=Math.atan2(b.x-a.x,b.z-a.z),v=22;
  fixture={scenario:'loop-ride',what:'A Cruz rides the test map loop at speed: over the top upside down, out along the road.',
    map:mapPath,seed:0,ticks:TICKS,cars:[{routePoint:i,lift:.3,linvel:[v*Math.sin(h),0,v*Math.cos(h)]}],race:{laps:1,atTick:0},
    seats:[{name:'Loopy',car:0}],inputs:[{car:0,fromTick:0,toTick:TICKS,throttle:1}],
    expect:[{car:0,metric:'wrecks',min:0,max:0},{car:0,metric:'recoveries',min:0,max:0}]};
  const path=join(scratch,'fixture.json');writeFileSync(path,JSON.stringify(fixture,null,2)+'\n');
  [native]=JSON.parse(execFileSync(bin,[...args,'sim','--json','--out',join(scratch,'native'),path],{encoding:'utf8'}));
  assert.equal(native.ok,true,JSON.stringify(native));assert.equal(native.replayMatches,true);
  server=deployed ? {origin:deployed.origin} : await serve(build('./','loop-ride'),BASE,{JJ_STUN_URLS:''});
});
after(async()=>{await server?.close?.();if(scratch)rmSync(scratch,{recursive:true,force:true});});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
  test(`${name}: the drawn loop is the sim's, the car is upside down at the top and the run matches native`,{timeout:300_000},async()=>{
    const browser=await engine.launch(name==='chromium'?{args:chromiumArgs}:{});
    const errors=[],rows=[],tops=[];
    let hash,shapes;
    try {
      for(const [view,query] of VIEWS) {
        const page=await browser.newPage({viewport:{width:1920,height:1080}});
        page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/loop-ride.json',r=>r.fulfill({contentType:'application/json',body:mapJson}));
        await page.goto(`${server.origin}${BASE}host?test&tiles=1&${query}&look=on&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin+'/loop-ride.json')}`);
        await page.waitForFunction(()=>window.__jjTest&&window.__jjRender);
        await page.evaluate(async({fixture,mapJson})=>{window.__jjRender.hold();await window.__jjTest.load(fixture,mapJson);},{fixture,mapJson});
        shapes=await page.evaluate(()=>window.__jjRender.loopShapes());
        assert.equal(shapes.length,1,JSON.stringify(shapes));
        assert.equal(shapes[0].fingerprint,NATIVE_LOOP,`the uploaded loop triangles are the native collision mesh: ${JSON.stringify(shapes)}`);
        const paint=async()=>{
          const t=await page.evaluate(async()=>(await window.__jjTest.observe()).tick);
          await page.waitForFunction(t=>{window.__jjRender.frame();return window.__jjRender.stats().tick>=t;},t,{polling:100});
        };
        const ride=[];
        let top=null;
        for(let tick=0;tick<TICKS;) {
          await page.evaluate(()=>window.__jjTest.step(2));tick+=2;
          const c=(await page.evaluate(()=>window.__jjTest.observe())).cars[0];
          ride.push({tick,position:c.position,upY:c.upY});
          if(!top&&c.upY<-.9) {
            top={tick,position:c.position,upY:c.upY};
            await page.waitForFunction(()=>!document.querySelector('#jj-caption')?.textContent,undefined,{timeout:20_000});
            for(const [width,height] of [[1920,1080],[1366,768]]) {
              await page.setViewportSize({width,height});await paint();
              const sees=await page.evaluate(async()=>{
                const s=await window.__jjTest.observe();
                return window.__jjRender.tilesSee(s.cars.map(c=>[c.position[0],c.position[1],c.position[2]]));
              });
              assert.ok(sees.length&&sees[0].sees.every(Boolean),'the car at the top is in the tile camera frustum');
              if(view==='chase')assert.equal((await page.evaluate(()=>window.__jjRender.cameras()))[1].loop,0,'the chase is on the loop framing');
              const file=`${name}-top-${view}-${width}x${height}.jpg`;
              if(process.env.JJ_CAPTURE_DIR)await page.screenshot({path:join(out,file),type:'jpeg',quality:85});
              rows.push({file,width,height,view});
            }
          }
        }
        assert.ok(top,`the car goes over the top upside down: ${JSON.stringify(ride.filter((_,k)=>k%10===0))}`);
        assert.ok(top.position[1]>12,`the top is high above the road: ${JSON.stringify(top)}`);
        tops.push(top);
        const last=ride.at(-1);
        assert.ok(last.upY>.9&&last.position[1]<2,`the car is back on the road, upright: ${JSON.stringify(last)}`);
        if(view==='chase') {
          await paint();
          assert.equal((await page.evaluate(()=>window.__jjRender.cameras()))[1].loop,null,'out of the loop, the chase is easing back behind the car');
          if(process.env.JJ_CAPTURE_DIR)await page.screenshot({path:join(out,`${name}-out-chase-1366x768.jpg`),type:'jpeg',quality:85});
        }
        hash=await page.evaluate(()=>window.__jjTest.hash());
        assert.equal(hash.stateHash,native.stateHash,'full native/WASM state matches at the final tick');
        await page.close();
      }
      assert.deepEqual(tops[1],tops[0],'the camera does not change the ride');
      assert.deepEqual(errors,[]);
      writeFileSync(join(out,`${name}-loop-ride.json`),JSON.stringify({browser:name,source:deployed?.href??'local real jj-server',fixture:{...fixture,map:'maps/test/loop.json'},native,shapes,top:tops[0],rows,hash,errors},null,2)+'\n');
    } finally {await browser.close();}
  });
}
